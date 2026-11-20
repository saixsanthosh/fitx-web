-- FITX Admin v2: username and password sign-in for Admin operators (no Google), database-backed
-- Admin sessions, sign-in limits, and operator versions of every Admin write function.
--
-- Operators are not FITX member accounts. The root operator's name and password hash live in the
-- Admin project's environment (FITX_ADMIN_USERNAME, FITX_ADMIN_PASSWORD_HASH); its one row here
-- (is_root, no password hash) is upserted at its sign-in so sessions and audit rows have an ID.
-- Other operators are made in Admin by a super-admin and keep a scrypt hash here.
--
-- Every new table has row level security on and no policy: only service_role (which bypasses RLS,
-- and is the only role the Admin server uses) and the security definer functions below reach them.
-- Every function is executable by service_role only. The older fitx_admin_* functions,
-- fitx_admin_members and all audit history stay as they are. Safe to run again.

-- Wait at most 5 seconds for a table lock (the ALTER TABLEs below), then stop; nothing stays and it can be
-- run again.
do $do$ begin perform pg_catalog.set_config('lock_timeout', '5s', true); end $do$;

-- Operators ----------------------------------------------------------------------------------------

create table if not exists public.admin_operators (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
  password_hash text check (
    password_hash is null
    or password_hash ~ '^scrypt:[0-9]{5,7}:[0-9]{1,2}:[0-9]:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]{86}$'
  ),
  role text not null check (role in ('super_admin', 'admin', 'support_agent', 'content_editor', 'viewer')),
  is_active boolean not null default true,
  is_root boolean not null default false,
  must_change_password boolean not null default false,
  created_by uuid references public.admin_operators (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz,
  password_changed_at timestamptz,
  -- The root is always an active super-admin whose password lives only in the environment.
  constraint admin_operators_root_check check (
    not is_root or (role = 'super_admin' and is_active and password_hash is null and not must_change_password)
  ),
  constraint admin_operators_password_check check (is_root or password_hash is not null)
);

create unique index if not exists admin_operators_single_root on public.admin_operators ((true)) where is_root;
create index if not exists admin_operators_created_by_idx on public.admin_operators (created_by);

alter table public.admin_operators enable row level security;
alter table public.admin_operators force row level security;
revoke all on table public.admin_operators from public, anon, authenticated, service_role;
grant select on table public.admin_operators to service_role;

-- Sessions ------------------------------------------------------------------------------------------

create table if not exists public.admin_web_sessions (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.admin_operators (id) on delete cascade,
  -- SHA-256 (hex) of the cookie's token; the token itself is never stored.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- 16 hex characters of the SHA-256 of the password hash in use at sign-in: a new password, or a
  -- new FITX_ADMIN_PASSWORD_HASH for the root, ends every older session.
  credential_stamp text not null check (credential_stamp ~ '^[0-9a-f]{16}$'),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ip_key text check (ip_key is null or char_length(ip_key) between 1 and 64),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  revoked_at timestamptz,
  revoked_reason text check (revoked_reason is null or char_length(revoked_reason) between 1 and 120)
);

create index if not exists admin_web_sessions_operator_idx on public.admin_web_sessions (operator_id, created_at desc);
create index if not exists admin_web_sessions_created_idx on public.admin_web_sessions (created_at desc);

alter table public.admin_web_sessions enable row level security;
alter table public.admin_web_sessions force row level security;
revoke all on table public.admin_web_sessions from public, anon, authenticated, service_role;
grant select, insert, update on table public.admin_web_sessions to service_role;

-- Sign-in attempts ----------------------------------------------------------------------------------

-- username_key is the SHA-256 (hex) of the typed username in lower case, so a password typed into
-- the username box by mistake is never stored as typed. ip_key is an HMAC of the client IP made by
-- the Admin server; no raw IP reaches the database. succeeded is null while the password is being
-- checked (counted as a failure until recorded). Rows older than 30 days are pruned.
create table if not exists public.admin_login_attempts (
  id bigint generated always as identity primary key,
  username_key text check (username_key is null or username_key ~ '^[0-9a-f]{64}$'),
  ip_key text not null check (char_length(ip_key) between 1 and 64),
  succeeded boolean,
  created_at timestamptz not null default now()
);

create index if not exists admin_login_attempts_user_idx on public.admin_login_attempts (username_key, created_at desc);
create index if not exists admin_login_attempts_ip_idx on public.admin_login_attempts (ip_key, created_at desc);
create index if not exists admin_login_attempts_created_idx on public.admin_login_attempts (created_at);

alter table public.admin_login_attempts enable row level security;
alter table public.admin_login_attempts force row level security;
revoke all on table public.admin_login_attempts from public, anon, authenticated, service_role;
grant select on table public.admin_login_attempts to service_role;

-- Who did what: operator columns next to the member-account ones --------------------------------------

-- No foreign key on the audit log: its rows are append-only (a trigger refuses every update), so an
-- "on delete set null" key could never run; the username is kept in actor_username instead.
alter table public.fitx_admin_audit_logs add column if not exists actor_operator_id uuid;
alter table public.fitx_admin_audit_logs add column if not exists actor_username text;
create index if not exists fitx_admin_audit_logs_operator_idx on public.fitx_admin_audit_logs (actor_operator_id, created_at desc);

alter table public.support_requests add column if not exists assigned_operator_id uuid
  references public.admin_operators (id) on delete set null;
alter table public.support_messages add column if not exists author_operator_id uuid
  references public.admin_operators (id) on delete set null;
alter table public.announcements add column if not exists created_by_operator_id uuid
  references public.admin_operators (id) on delete set null;
alter table public.announcements add column if not exists updated_by_operator_id uuid
  references public.admin_operators (id) on delete set null;

create index if not exists support_requests_operator_idx on public.support_requests (assigned_operator_id);
create index if not exists support_messages_operator_idx on public.support_messages (author_operator_id);
create index if not exists announcements_created_by_operator_idx on public.announcements (created_by_operator_id);
create index if not exists announcements_updated_by_operator_idx on public.announcements (updated_by_operator_id);

-- Roles: mirrors admin/src/lib/roles.ts (admin/tests/roles.test.mjs fails if they drift) ---------------

create or replace function public.fitx_admin_role_permissions(p_role text)
returns text[]
language sql
immutable
set search_path = ''
as $function$
  select case p_role
    when 'super_admin' then array['overview.view', 'reports.view', 'people.view', 'people.support', 'people.suspend', 'people.delete', 'support.view', 'support.reply', 'content.manage', 'announcements.manage', 'audit.view', 'audit.export', 'access.view', 'access.manage', 'settings.view', 'billing.view', 'nutrition.manage', 'billing.manage', 'notifications.send', 'settings.manage', 'security.view']::text[]
    when 'admin' then array['overview.view', 'reports.view', 'people.view', 'people.support', 'people.suspend', 'support.view', 'support.reply', 'content.manage', 'announcements.manage', 'audit.view', 'access.view', 'settings.view', 'billing.view', 'nutrition.manage', 'notifications.send', 'security.view']::text[]
    when 'support_agent' then array['overview.view', 'people.view', 'people.support', 'support.view', 'support.reply']::text[]
    when 'content_editor' then array['overview.view', 'content.manage', 'announcements.manage', 'nutrition.manage', 'notifications.send']::text[]
    when 'viewer' then array['overview.view', 'reports.view']::text[]
    else array[]::text[]
  end;
$function$;

-- True when the operator is active and its role grants the permission.
create or replace function public.fitx_admin_op_can(p_operator_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.admin_operators o
    where o.id = p_operator_id
      and o.is_active
      and p_permission = any (public.fitx_admin_role_permissions(o.role))
  );
$function$;

-- Audit ----------------------------------------------------------------------------------------------

-- Records one Admin event by an operator (or by nobody, for refused sign-ins), with the operator's
-- username copied in. Details are a small JSON object of codes, counts and statuses.
create or replace function public.fitx_admin_op_log_event(
  p_operator_id uuid,
  p_action text,
  p_resource_type text,
  p_resource_id text default null,
  p_details jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  new_id bigint;
  details jsonb := coalesce(p_details, '{}'::jsonb);
  actor public.admin_operators%rowtype;
begin
  if p_action is null or p_action !~ '^[a-z][a-z0-9_]{2,79}$' then
    raise exception using errcode = '22023', message = 'Invalid audit action';
  end if;
  if p_resource_type is null or p_resource_type !~ '^[a-z][a-z0-9_]{1,79}$' then
    raise exception using errcode = '22023', message = 'Invalid audit resource type';
  end if;
  if p_resource_id is not null and char_length(p_resource_id) > 200 then
    raise exception using errcode = '22023', message = 'Audit resource ID is too long';
  end if;
  if jsonb_typeof(details) <> 'object' or octet_length(details::text) > 4000 then
    raise exception using errcode = '22023', message = 'Audit details must be a JSON object under 4 KB';
  end if;
  if p_operator_id is not null then
    select * into actor from public.admin_operators where id = p_operator_id;
  end if;

  insert into public.fitx_admin_audit_logs (actor_id, actor_operator_id, actor_username, action, resource_type, resource_id, details)
  values (null, actor.id, actor.username, p_action, p_resource_type, p_resource_id, details)
  returning id into new_id;
  return new_id;
end;
$function$;

-- Sign-in limits ---------------------------------------------------------------------------------------

-- The limits, mirrored in admin/src/lib/login-guard.ts (LOGIN_LIMITS; admin/tests/login-guard.test.mjs
-- compares them): 5 failures for one username from one client IP in 15 minutes lock that username on
-- that IP for 15 minutes from the fifth; at most 20 attempts of any kind per client IP in 15 minutes.
-- The lock is per username and IP because usernames are not secret: a lock on the username alone would
-- let anyone keep its operator (the root too) out for good with five wrong passwords every 15 minutes.
create or replace function public.fitx_admin_login_limits()
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select '{"userFailures": 5, "userWindowMinutes": 15, "lockMinutes": 15, "ipAttempts": 20, "ipWindowMinutes": 15}'::jsonb;
$function$;

-- The limit for one username across every IP: 50 failures in 15 minutes lock it everywhere for 5 minutes
-- from the fiftieth. With five per IP before the per-IP lock, that takes at least ten addresses; it slows
-- a guessing run spread over many of them, and the short lock keeps the owner's wait short.
create or replace function public.fitx_admin_login_username_limits()
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select '{"usernameFailures": 50, "usernameWindowMinutes": 15, "usernameLockMinutes": 5}'::jsonb;
$function$;

create or replace function public.fitx_admin_login_username_key(p_username text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.lower(pg_catalog.left(pg_catalog.btrim(coalesce(p_username, '')), 200)), 'UTF8')),
    'hex');
$function$;

-- When the lock on this username from this IP ends, or null when there is none; with no IP, when the
-- latest lock on the username from any IP ends (Admin's Security summary). Two locks count:
--   * from one IP: a failure from it that is the fifth (or later) within 15 minutes starts a lock on
--     that IP, lasting 15 minutes from it;
--   * from every IP: a failure that is the fiftieth (or later) within 15 minutes, from any IPs, starts a
--     lock on all of them, lasting 5 minutes from it.
-- Attempts refused during a lock are stored without a username, so they never extend it.
create or replace function public.fitx_admin_login_locked_until(p_username_key text, p_ip_key text default null)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $function$
  with limits as (
    select (l ->> 'userFailures')::integer as failures,
           pg_catalog.make_interval(mins => (l ->> 'userWindowMinutes')::integer) as span,
           pg_catalog.make_interval(mins => (l ->> 'lockMinutes')::integer) as lock_for,
           (w ->> 'usernameFailures')::integer as wide_failures,
           pg_catalog.make_interval(mins => (w ->> 'usernameWindowMinutes')::integer) as wide_span,
           pg_catalog.make_interval(mins => (w ->> 'usernameLockMinutes')::integer) as wide_lock_for
    from (select public.fitx_admin_login_limits() as l, public.fitx_admin_login_username_limits() as w) source
  ),
  recent as (
    select a.created_at, a.ip_key
    from public.admin_login_attempts a, limits
    where a.username_key = p_username_key
      and a.succeeded is not true
      and a.created_at > pg_catalog.now() - greatest(limits.span + limits.lock_for, limits.wide_span + limits.wide_lock_for)
  ),
  locks as (
    select r.created_at + limits.lock_for as ends
    from recent r, limits
    where (p_ip_key is null or r.ip_key = p_ip_key)
      and r.created_at + limits.lock_for > pg_catalog.now()
      and (select pg_catalog.count(*) from recent r2
           where r2.ip_key = r.ip_key and r2.created_at > r.created_at - limits.span and r2.created_at <= r.created_at) >= limits.failures
    union all
    select r.created_at + limits.wide_lock_for
    from recent r, limits
    where r.created_at + limits.wide_lock_for > pg_catalog.now()
      and (select pg_catalog.count(*) from recent r2
           where r2.created_at > r.created_at - limits.wide_span and r2.created_at <= r.created_at) >= limits.wide_failures
  )
  select max(l.ends) from locks l;
$function$;

-- Before a password is checked: 'ip_limited', 'locked' (refused without checking the password) or
-- 'ok', in which case an attempt row is opened and counts as a failure until it is recorded.
create or replace function public.fitx_admin_login_check(p_username text, p_ip_key text)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_key text := public.fitx_admin_login_username_key(p_username);
  v_ip text := pg_catalog.left(coalesce(nullif(pg_catalog.btrim(p_ip_key), ''), 'unknown'), 64);
  limits jsonb := public.fitx_admin_login_limits();
begin
  -- The IP first, then the username, in both functions, so parallel attempts queue instead of
  -- slipping past the limits together.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fitx_admin_login_ip:' || v_ip, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fitx_admin_login_user:' || v_key, 0));

  if (select pg_catalog.count(*) from public.admin_login_attempts a
      where a.ip_key = v_ip
        and a.created_at > pg_catalog.now() - pg_catalog.make_interval(mins => (limits ->> 'ipWindowMinutes')::integer))
     >= (limits ->> 'ipAttempts')::integer then
    return 'ip_limited';
  end if;

  if public.fitx_admin_login_locked_until(v_key, v_ip) is not null then
    insert into public.admin_login_attempts (username_key, ip_key, succeeded) values (null, v_ip, false);
    return 'locked';
  end if;

  insert into public.admin_login_attempts (username_key, ip_key, succeeded) values (v_key, v_ip, null);
  return 'ok';
end;
$function$;

-- After the password check: closes the attempt opened by fitx_admin_login_check. Returns 'locked_now'
-- when this failure starts a lock, else 'recorded'. Also prunes attempts and sessions over 30 days old.
create or replace function public.fitx_admin_login_record(p_username text, p_ip_key text, p_succeeded boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_key text := public.fitx_admin_login_username_key(p_username);
  v_ip text := pg_catalog.left(coalesce(nullif(pg_catalog.btrim(p_ip_key), ''), 'unknown'), 64);
  attempt_id bigint;
  attempt_at timestamptz;
  lock_ends timestamptz;
begin
  if p_succeeded is null then
    raise exception using errcode = '22023', message = 'The attempt result is required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fitx_admin_login_ip:' || v_ip, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fitx_admin_login_user:' || v_key, 0));

  select a.id, a.created_at into attempt_id, attempt_at
  from public.admin_login_attempts a
  where a.username_key = v_key and a.ip_key = v_ip and a.succeeded is null
    and a.created_at > pg_catalog.now() - interval '5 minutes'
  order by a.created_at desc, a.id desc
  limit 1;
  if attempt_id is null then
    insert into public.admin_login_attempts (username_key, ip_key, succeeded) values (v_key, v_ip, p_succeeded)
    returning id, created_at into attempt_id, attempt_at;
  else
    update public.admin_login_attempts set succeeded = p_succeeded where id = attempt_id;
  end if;

  delete from public.admin_login_attempts where created_at < pg_catalog.now() - interval '30 days';
  delete from public.admin_web_sessions where created_at < pg_catalog.now() - interval '30 days';

  if not p_succeeded then
    lock_ends := public.fitx_admin_login_locked_until(v_key, v_ip);
    if lock_ends is not null
       and lock_ends in (attempt_at + pg_catalog.make_interval(mins => (public.fitx_admin_login_limits() ->> 'lockMinutes')::integer),
                         attempt_at + pg_catalog.make_interval(mins => (public.fitx_admin_login_username_limits() ->> 'usernameLockMinutes')::integer)) then
      return 'locked_now';
    end if;
  end if;
  return 'recorded';
end;
$function$;

-- Operator accounts --------------------------------------------------------------------------------------

-- The root operator's sign-in: creates or renames its one row (the name comes from FITX_ADMIN_USERNAME)
-- and stamps the sign-in. Refused (23505) when another operator already uses that name.
create or replace function public.fitx_admin_op_root_sign_in(p_username text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_name text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_username, '')));
  root_id uuid;
begin
  if v_name !~ '^[a-z0-9][a-z0-9._-]{2,31}$' then
    raise exception using errcode = '22023', message = 'Invalid root username';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(847281034);
  if exists (select 1 from public.admin_operators where username = v_name and not is_root) then
    raise exception using errcode = '23505', message = 'Another operator uses the root username';
  end if;
  update public.admin_operators
  set username = v_name, last_login_at = pg_catalog.now(),
      updated_at = case when username = v_name then updated_at else pg_catalog.now() end
  where is_root
  returning id into root_id;
  if root_id is null then
    insert into public.admin_operators (username, role, is_active, is_root, last_login_at)
    values (v_name, 'super_admin', true, true, pg_catalog.now())
    returning id into root_id;
  end if;
  return root_id;
end;
$function$;

-- Stamps an operator's successful sign-in.
create or replace function public.fitx_admin_op_mark_signed_in(p_operator_id uuid)
returns void
language sql
security definer
set search_path = ''
as $function$
  update public.admin_operators set last_login_at = pg_catalog.now() where id = p_operator_id and is_active;
$function$;

-- Ends every open session of an operator; returns how many.
create or replace function public.fitx_admin_op_end_sessions(p_target_id uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  ended integer;
begin
  update public.admin_web_sessions
  set revoked_at = pg_catalog.now(), revoked_reason = pg_catalog.left(coalesce(nullif(pg_catalog.btrim(p_reason), ''), 'revoked'), 120)
  where operator_id = p_target_id and revoked_at is null;
  get diagnostics ended = row_count;
  return ended;
end;
$function$;

-- A super-admin adds an operator. The password is a temporary one: the new operator sets their own at
-- first sign-in (must_change_password). The audit row holds the username and role.
create or replace function public.fitx_admin_op_create_operator(
  p_operator_id uuid,
  p_username text,
  p_role text,
  p_password_hash text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_name text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_username, '')));
  new_id uuid;
begin
  if not public.fitx_admin_op_can(p_operator_id, 'access.manage') then
    raise exception using errcode = '42501', message = 'Access management permission required';
  end if;
  if v_name !~ '^[a-z0-9][a-z0-9._-]{2,31}$' then
    raise exception using errcode = '22023', message = 'Invalid username';
  end if;
  if p_role is null or p_role not in ('super_admin', 'admin', 'support_agent', 'content_editor', 'viewer') then
    raise exception using errcode = '22023', message = 'Invalid Admin role';
  end if;
  if p_password_hash is null then
    raise exception using errcode = '22023', message = 'A password hash is required';
  end if;
  if exists (select 1 from public.admin_operators where username = v_name) then
    raise exception using errcode = '23505', message = 'That username is taken';
  end if;

  insert into public.admin_operators (username, password_hash, role, is_active, must_change_password, created_by, password_changed_at)
  values (v_name, p_password_hash, p_role, true, true, p_operator_id, pg_catalog.now())
  returning id into new_id;
  perform public.fitx_admin_op_log_event(p_operator_id, 'operator_created', 'admin_operator', new_id::text,
    pg_catalog.jsonb_build_object('username', v_name, 'role', p_role));
  return new_id;
end;
$function$;

-- A super-admin changes another operator's role or status (null keeps it). The root and your own row
-- cannot be changed here. Switching an operator off ends their sessions.
create or replace function public.fitx_admin_op_update_operator(
  p_operator_id uuid,
  p_target_id uuid,
  p_role text default null,
  p_is_active boolean default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  previous public.admin_operators%rowtype;
  next_role text;
  next_active boolean;
  ended integer := 0;
begin
  if not public.fitx_admin_op_can(p_operator_id, 'access.manage') then
    raise exception using errcode = '42501', message = 'Access management permission required';
  end if;
  if p_target_id = p_operator_id then
    raise exception using errcode = '22023', message = 'operator_self';
  end if;
  select * into previous from public.admin_operators where id = p_target_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Operator not found';
  end if;
  if previous.is_root then
    raise exception using errcode = '42501', message = 'operator_root';
  end if;
  next_role := coalesce(p_role, previous.role);
  next_active := coalesce(p_is_active, previous.is_active);
  if next_role not in ('super_admin', 'admin', 'support_agent', 'content_editor', 'viewer') then
    raise exception using errcode = '22023', message = 'Invalid Admin role';
  end if;

  update public.admin_operators
  set role = next_role, is_active = next_active, updated_at = pg_catalog.now()
  where id = p_target_id;
  if previous.is_active and not next_active then
    ended := public.fitx_admin_op_end_sessions(p_target_id, 'operator_deactivated');
  end if;
  perform public.fitx_admin_op_log_event(p_operator_id, 'operator_updated', 'admin_operator', p_target_id::text,
    pg_catalog.jsonb_build_object(
      'before', pg_catalog.jsonb_build_object('role', previous.role, 'is_active', previous.is_active),
      'after', pg_catalog.jsonb_build_object('role', next_role, 'is_active', next_active),
      'sessions_ended', ended));
end;
$function$;

-- Sets an operator's password hash and ends all their sessions. Your own change (actor = target) needs
-- only an active operator; anyone else's needs access.manage and leaves them a temporary password
-- (p_must_change). The root's password is not stored here and cannot be set.
create or replace function public.fitx_admin_op_set_operator_password(
  p_operator_id uuid,
  p_target_id uuid,
  p_password_hash text,
  p_must_change boolean
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target public.admin_operators%rowtype;
  own boolean := p_operator_id = p_target_id;
  ended integer;
begin
  if own then
    if not exists (select 1 from public.admin_operators where id = p_operator_id and is_active) then
      raise exception using errcode = '42501', message = 'Active operator required';
    end if;
  elsif not public.fitx_admin_op_can(p_operator_id, 'access.manage') then
    raise exception using errcode = '42501', message = 'Access management permission required';
  end if;
  if p_password_hash is null or p_must_change is null then
    raise exception using errcode = '22023', message = 'A password hash and its status are required';
  end if;
  select * into target from public.admin_operators where id = p_target_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Operator not found';
  end if;
  if target.is_root then
    raise exception using errcode = '42501', message = 'operator_root';
  end if;
  if target.password_hash = p_password_hash then
    raise exception using errcode = '22023', message = 'operator_same_password';
  end if;

  update public.admin_operators
  set password_hash = p_password_hash, must_change_password = p_must_change,
      password_changed_at = pg_catalog.now(), updated_at = pg_catalog.now()
  where id = p_target_id;
  ended := public.fitx_admin_op_end_sessions(p_target_id, case when own then 'password_changed' else 'password_reset' end);
  perform public.fitx_admin_op_log_event(p_operator_id,
    case when own then 'operator_password_changed' else 'operator_password_reset' end,
    'admin_operator', p_target_id::text,
    pg_catalog.jsonb_build_object('sessions_ended', ended, 'must_change_password', p_must_change));
  return ended;
end;
$function$;

-- Operator versions of the Admin write functions ------------------------------------------------------
-- Same arguments as the fitx_admin_* versions, with the operator first in place of the member account.

create or replace function public.fitx_admin_op_set_exercise_active(
  p_operator_id uuid,
  p_exercise_id text,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  previous boolean;
begin
  if not public.fitx_admin_op_can(p_operator_id, 'content.manage') then
    raise exception using errcode = '42501', message = 'Content permission required';
  end if;
  if p_is_active is null then
    raise exception using errcode = '22023', message = 'Visibility is required';
  end if;
  select is_active into previous from public.exercise_library where id = p_exercise_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Exercise not found';
  end if;
  update public.exercise_library set is_active = p_is_active where id = p_exercise_id;
  perform public.fitx_admin_op_log_event(p_operator_id, 'exercise_visibility_updated', 'exercise', p_exercise_id,
    pg_catalog.jsonb_build_object('before', pg_catalog.jsonb_build_object('is_active', previous),
                                  'after', pg_catalog.jsonb_build_object('is_active', p_is_active)));
end;
$function$;

-- Ends every sign-in session of a member account (all devices). Operators are not member accounts, so
-- there is no Admin team rule here.
create or replace function public.fitx_admin_op_revoke_user_sessions(
  p_operator_id uuid,
  p_user_id uuid,
  p_reason text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  revoked integer;
begin
  if not public.fitx_admin_op_can(p_operator_id, 'people.support') then
    raise exception using errcode = '42501', message = 'People support permission required';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception using errcode = 'P0002', message = 'Account not found';
  end if;
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics revoked = row_count;
  perform public.fitx_admin_op_log_event(p_operator_id, 'user_sessions_revoked', 'user', p_user_id::text,
    pg_catalog.jsonb_build_object('sessions_revoked', revoked, 'reason', pg_catalog.left(pg_catalog.btrim(coalesce(p_reason, '')), 200)));
  return revoked;
end;
$function$;

-- Status, priority and assignee (an operator with support access, or nobody). p_expected_updated_at is
-- the request's updated_at when the page loaded: if it changed since, nothing is written (40001).
create or replace function public.fitx_admin_op_support_update(
  p_operator_id uuid,
  p_request_id uuid,
  p_status text,
  p_priority text,
  p_assigned_operator_id uuid,
  p_expected_updated_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  previous public.support_requests%rowtype;
begin
  if not public.fitx_admin_op_can(p_operator_id, 'support.reply') then
    raise exception using errcode = '42501', message = 'Support permission required';
  end if;
  if p_status is null or p_status not in ('open', 'in_progress', 'waiting_on_user', 'resolved', 'closed') then
    raise exception using errcode = '22023', message = 'Invalid status';
  end if;
  if p_priority is null or p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception using errcode = '22023', message = 'Invalid priority';
  end if;
  select * into previous from public.support_requests where id = p_request_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Support request not found';
  end if;
  if p_expected_updated_at is not null and previous.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'support_request_changed';
  end if;
  if p_assigned_operator_id is not null
     and p_assigned_operator_id is distinct from previous.assigned_operator_id
     and not public.fitx_admin_op_can(p_assigned_operator_id, 'support.view') then
    raise exception using errcode = '22023', message = 'The assignee must be an active operator with support access';
  end if;

  -- An assignee from the old member-account Admin (assigned_to) is cleared on the first operator save.
  update public.support_requests
  set status = p_status, priority = p_priority, assigned_operator_id = p_assigned_operator_id,
      assigned_to = null, updated_at = pg_catalog.now()
  where id = p_request_id;
  perform public.fitx_admin_op_log_event(p_operator_id, 'support_request_updated', 'support_request', p_request_id::text,
    pg_catalog.jsonb_build_object(
      'before', pg_catalog.jsonb_build_object('status', previous.status, 'priority', previous.priority,
                                              'assigned_operator_id', previous.assigned_operator_id, 'assigned_to', previous.assigned_to),
      'after', pg_catalog.jsonb_build_object('status', p_status, 'priority', p_priority,
                                             'assigned_operator_id', p_assigned_operator_id, 'assigned_to', null)));
end;
$function$;

-- Reply as FITX Support and set the status in the same step. The audit row records the reply's
-- length, never its text.
create or replace function public.fitx_admin_op_support_reply(
  p_operator_id uuid,
  p_request_id uuid,
  p_body text,
  p_status text default 'waiting_on_user'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  previous_status text;
  reply text := pg_catalog.btrim(coalesce(p_body, ''));
  new_id uuid;
begin
  if not public.fitx_admin_op_can(p_operator_id, 'support.reply') then
    raise exception using errcode = '42501', message = 'Support permission required';
  end if;
  if p_status is null or p_status not in ('open', 'in_progress', 'waiting_on_user', 'resolved', 'closed') then
    raise exception using errcode = '22023', message = 'Invalid status';
  end if;
  select status into previous_status from public.support_requests where id = p_request_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Support request not found';
  end if;

  insert into public.support_messages (request_id, author_id, author_operator_id, author_kind, body)
  values (p_request_id, null, p_operator_id, 'staff', reply)
  returning id into new_id;
  update public.support_requests
  set status = p_status, last_message_at = pg_catalog.now(), updated_at = pg_catalog.now()
  where id = p_request_id;
  perform public.fitx_admin_op_log_event(p_operator_id, 'support_reply_sent', 'support_request', p_request_id::text,
    pg_catalog.jsonb_build_object('characters', pg_catalog.char_length(reply),
                                  'before', pg_catalog.jsonb_build_object('status', previous_status),
                                  'after', pg_catalog.jsonb_build_object('status', p_status)));
  return new_id;
end;
$function$;

-- Create (p_id null) or edit an announcement, as fitx_admin_save_announcement. Editing a published one
-- needs p_confirm_live (55000 otherwise). The message is audited only as its length and a fingerprint.
create or replace function public.fitx_admin_op_save_announcement(
  p_operator_id uuid,
  p_id uuid,
  p_title text,
  p_body text,
  p_tone text,
  p_link_url text,
  p_link_label text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_confirm_live boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  previous public.announcements%rowtype;
  saved public.announcements%rowtype;
  hidden_fields constant text[] := array['id', 'body', 'created_by', 'updated_by', 'created_by_operator_id',
                                         'updated_by_operator_id', 'created_at', 'updated_at'];
begin
  if not public.fitx_admin_op_can(p_operator_id, 'announcements.manage') then
    raise exception using errcode = '42501', message = 'Announcement permission required';
  end if;

  if p_id is null then
    insert into public.announcements (title, body, tone, link_url, link_label, starts_at, ends_at,
                                      created_by_operator_id, updated_by_operator_id)
    values (pg_catalog.btrim(p_title), pg_catalog.btrim(p_body), coalesce(p_tone, 'info'),
            nullif(pg_catalog.btrim(coalesce(p_link_url, '')), ''), nullif(pg_catalog.btrim(coalesce(p_link_label, '')), ''),
            p_starts_at, p_ends_at, p_operator_id, p_operator_id)
    returning * into saved;
    perform public.fitx_admin_op_log_event(p_operator_id, 'announcement_created', 'announcement', saved.id::text,
      pg_catalog.jsonb_build_object('after', (pg_catalog.to_jsonb(saved) - hidden_fields)
        || pg_catalog.jsonb_build_object('body_characters', pg_catalog.char_length(saved.body),
                                         'body_fingerprint', pg_catalog.left(pg_catalog.md5(saved.body), 12))));
    return saved.id;
  end if;

  select * into previous from public.announcements where id = p_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Announcement not found';
  end if;
  if previous.status = 'published' and not coalesce(p_confirm_live, false) then
    raise exception using errcode = '55000', message = 'Saving a published announcement needs confirmation';
  end if;
  update public.announcements
  set title = pg_catalog.btrim(p_title),
      body = pg_catalog.btrim(p_body),
      tone = coalesce(p_tone, 'info'),
      link_url = nullif(pg_catalog.btrim(coalesce(p_link_url, '')), ''),
      link_label = nullif(pg_catalog.btrim(coalesce(p_link_label, '')), ''),
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      updated_by_operator_id = p_operator_id,
      updated_at = pg_catalog.now()
  where id = p_id
  returning * into saved;
  perform public.fitx_admin_op_log_event(p_operator_id, 'announcement_updated', 'announcement', p_id::text,
    pg_catalog.jsonb_build_object(
      'before', (pg_catalog.to_jsonb(previous) - hidden_fields)
        || pg_catalog.jsonb_build_object('body_characters', pg_catalog.char_length(previous.body),
                                         'body_fingerprint', pg_catalog.left(pg_catalog.md5(previous.body), 12)),
      'after', (pg_catalog.to_jsonb(saved) - hidden_fields)
        || pg_catalog.jsonb_build_object('body_characters', pg_catalog.char_length(saved.body),
                                         'body_fingerprint', pg_catalog.left(pg_catalog.md5(saved.body), 12))));
  return p_id;
end;
$function$;

-- Publish, return to draft, or archive.
create or replace function public.fitx_admin_op_set_announcement_status(p_operator_id uuid, p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  previous_status text;
begin
  if not public.fitx_admin_op_can(p_operator_id, 'announcements.manage') then
    raise exception using errcode = '42501', message = 'Announcement permission required';
  end if;
  if p_status is null or p_status not in ('draft', 'published', 'archived') then
    raise exception using errcode = '22023', message = 'Invalid announcement status';
  end if;
  select status into previous_status from public.announcements where id = p_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Announcement not found';
  end if;
  update public.announcements
  set status = p_status,
      published_at = case when p_status = 'published' then coalesce(published_at, pg_catalog.now()) else published_at end,
      updated_by_operator_id = p_operator_id,
      updated_at = pg_catalog.now()
  where id = p_id;
  perform public.fitx_admin_op_log_event(p_operator_id,
    case p_status when 'published' then 'announcement_published'
                  when 'archived' then 'announcement_archived'
                  else 'announcement_unpublished' end,
    'announcement', p_id::text,
    pg_catalog.jsonb_build_object('before', pg_catalog.jsonb_build_object('status', previous_status),
                                  'after', pg_catalog.jsonb_build_object('status', p_status)));
end;
$function$;

-- Execute rights: service_role only ------------------------------------------------------------------------

revoke all on function public.fitx_admin_role_permissions(text) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_can(uuid, text) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_log_event(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.fitx_admin_login_limits() from public, anon, authenticated;
revoke all on function public.fitx_admin_login_username_key(text) from public, anon, authenticated;
revoke all on function public.fitx_admin_login_username_limits() from public, anon, authenticated;
revoke all on function public.fitx_admin_login_locked_until(text, text) from public, anon, authenticated;
revoke all on function public.fitx_admin_login_check(text, text) from public, anon, authenticated;
revoke all on function public.fitx_admin_login_record(text, text, boolean) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_root_sign_in(text) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_mark_signed_in(uuid) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_end_sessions(uuid, text) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_create_operator(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_update_operator(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_set_operator_password(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_set_exercise_active(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_revoke_user_sessions(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_support_update(uuid, uuid, text, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_support_reply(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_save_announcement(uuid, uuid, text, text, text, text, text, timestamptz, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_set_announcement_status(uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.fitx_admin_role_permissions(text) to service_role;
grant execute on function public.fitx_admin_op_can(uuid, text) to service_role;
grant execute on function public.fitx_admin_op_log_event(uuid, text, text, text, jsonb) to service_role;
grant execute on function public.fitx_admin_login_limits() to service_role;
grant execute on function public.fitx_admin_login_username_key(text) to service_role;
grant execute on function public.fitx_admin_login_username_limits() to service_role;
grant execute on function public.fitx_admin_login_locked_until(text, text) to service_role;
grant execute on function public.fitx_admin_login_check(text, text) to service_role;
grant execute on function public.fitx_admin_login_record(text, text, boolean) to service_role;
grant execute on function public.fitx_admin_op_root_sign_in(text) to service_role;
grant execute on function public.fitx_admin_op_mark_signed_in(uuid) to service_role;
grant execute on function public.fitx_admin_op_end_sessions(uuid, text) to service_role;
grant execute on function public.fitx_admin_op_create_operator(uuid, text, text, text) to service_role;
grant execute on function public.fitx_admin_op_update_operator(uuid, uuid, text, boolean) to service_role;
grant execute on function public.fitx_admin_op_set_operator_password(uuid, uuid, text, boolean) to service_role;
grant execute on function public.fitx_admin_op_set_exercise_active(uuid, text, boolean) to service_role;
grant execute on function public.fitx_admin_op_revoke_user_sessions(uuid, uuid, text) to service_role;
grant execute on function public.fitx_admin_op_support_update(uuid, uuid, text, text, uuid, timestamptz) to service_role;
grant execute on function public.fitx_admin_op_support_reply(uuid, uuid, text, text) to service_role;
grant execute on function public.fitx_admin_op_save_announcement(uuid, uuid, text, text, text, text, text, timestamptz, timestamptz, boolean) to service_role;
grant execute on function public.fitx_admin_op_set_announcement_status(uuid, uuid, text) to service_role;
