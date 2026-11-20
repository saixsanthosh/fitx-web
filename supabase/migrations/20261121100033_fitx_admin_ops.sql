-- FITX Admin ops (wave 2, admin-core): platform settings read by the app, targeted notices to chosen
-- accounts, the support inbox (a complaint category, unread tracking), account search with phone,
-- sign-in methods, status and plan filters, overview extras and the security summary.
--
-- Additive and safe to run again. New tables have row level security on: platform_settings can be read
-- by everyone (it holds only switches, a maintenance notice and public contact details) and written only
-- through fitx_admin_op_save_platform_settings; member_notifications rows are read and dismissed only
-- by the account they were sent to. Every function below is security definer with search_path '' and
-- is executable by service_role only. Nothing here reads profiles, workouts, meals or body data.
-- The app works before this runs: each screen detects the missing tables and functions.

-- Wait at most 5 seconds for a table lock (the ALTER TABLEs below), then stop; nothing stays and it can be
-- run again.
do $do$ begin perform pg_catalog.set_config('lock_timeout', '5s', true); end $do$;

-- Platform settings ---------------------------------------------------------------------------------------

-- One row (id 1). features: { ai_coach, home_workout, activity, subscriptions, support } booleans; a missing
-- key means on. maintenance: null, or { title, body, startsAt, endsAt } shown to signed-in members.
-- site: { supportEmail, instagramUrl }. The app falls back to its defaults when this table is missing.
create table if not exists public.platform_settings (
  id smallint primary key default 1 check (id = 1),
  features jsonb not null default '{}'::jsonb check (jsonb_typeof(features) = 'object'),
  maintenance jsonb check (maintenance is null or jsonb_typeof(maintenance) = 'object'),
  site jsonb not null default '{}'::jsonb check (jsonb_typeof(site) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by_operator_id uuid references public.admin_operators (id) on delete set null
);

create index if not exists platform_settings_updated_by_idx on public.platform_settings (updated_by_operator_id);

insert into public.platform_settings (id) values (1) on conflict (id) do nothing;

alter table public.platform_settings enable row level security;
revoke all on table public.platform_settings from public, anon, authenticated, service_role;
grant select (id, features, maintenance, site, updated_at) on table public.platform_settings to anon, authenticated;
grant select on table public.platform_settings to service_role;

drop policy if exists platform_settings_read on public.platform_settings;
create policy platform_settings_read
  on public.platform_settings
  for select
  to anon, authenticated
  using (id = 1);

-- Saves all three parts at once (settings.manage). p_expected_updated_at is updated_at when the form
-- loaded: if it changed since, nothing is written (40001). The audit row records the switches and the
-- site details before and after; the maintenance text only as its length and a fingerprint.
create or replace function public.fitx_admin_op_save_platform_settings(
  p_operator_id uuid,
  p_features jsonb,
  p_maintenance jsonb,
  p_site jsonb,
  p_expected_updated_at timestamptz default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $function$
declare
  feature_keys constant text[] := array['ai_coach', 'home_workout', 'activity', 'subscriptions', 'support'];
  previous public.platform_settings%rowtype;
  saved_at timestamptz;
  starts timestamptz;
  ends timestamptz;
  v_title text;
  v_body text;
  v_email text;
  v_instagram text;
  maintenance_summary jsonb;
  previous_summary jsonb;
begin
  if not public.fitx_admin_op_can(p_operator_id, 'settings.manage') then
    raise exception using errcode = '42501', message = 'Settings permission required';
  end if;

  if p_features is null or pg_catalog.jsonb_typeof(p_features) <> 'object'
     or exists (select 1 from pg_catalog.jsonb_each(p_features) e
                where e.key <> all (feature_keys) or pg_catalog.jsonb_typeof(e.value) <> 'boolean') then
    raise exception using errcode = '22023', message = 'Invalid feature switches';
  end if;

  if p_maintenance is not null and pg_catalog.jsonb_typeof(p_maintenance) = 'null' then
    p_maintenance := null;
  end if;
  if p_maintenance is not null then
    if pg_catalog.jsonb_typeof(p_maintenance) <> 'object'
       or exists (select 1 from pg_catalog.jsonb_object_keys(p_maintenance) k where k <> all (array['title', 'body', 'startsAt', 'endsAt'])) then
      raise exception using errcode = '22023', message = 'Invalid maintenance notice';
    end if;
    v_title := pg_catalog.btrim(coalesce(p_maintenance ->> 'title', ''));
    v_body := pg_catalog.btrim(coalesce(p_maintenance ->> 'body', ''));
    if pg_catalog.char_length(v_title) not between 3 and 120 or pg_catalog.char_length(v_body) not between 1 and 600 then
      raise exception using errcode = '22023', message = 'Invalid maintenance notice';
    end if;
    begin
      starts := nullif(p_maintenance ->> 'startsAt', '')::timestamptz;
      ends := nullif(p_maintenance ->> 'endsAt', '')::timestamptz;
    exception when others then
      raise exception using errcode = '22023', message = 'Invalid maintenance times';
    end;
    if starts is not null and ends is not null and ends <= starts then
      raise exception using errcode = '22023', message = 'Invalid maintenance times';
    end if;
    p_maintenance := pg_catalog.jsonb_build_object('title', v_title, 'body', v_body, 'startsAt', starts, 'endsAt', ends);
  end if;

  if p_site is null or pg_catalog.jsonb_typeof(p_site) <> 'object'
     or exists (select 1 from pg_catalog.jsonb_object_keys(p_site) k where k <> all (array['supportEmail', 'instagramUrl'])) then
    raise exception using errcode = '22023', message = 'Invalid website information';
  end if;
  v_email := nullif(pg_catalog.btrim(coalesce(p_site ->> 'supportEmail', '')), '');
  v_instagram := nullif(pg_catalog.btrim(coalesce(p_site ->> 'instagramUrl', '')), '');
  if v_email is not null and (pg_catalog.char_length(v_email) > 254 or v_email !~ '^[^@\s<>"]+@[^@\s<>"]+\.[A-Za-z]{2,}$') then
    raise exception using errcode = '22023', message = 'Invalid support email';
  end if;
  if v_instagram is not null and (pg_catalog.char_length(v_instagram) > 200
     or v_instagram !~ '^https://(www\.)?instagram\.com/[A-Za-z0-9._]{1,30}/?$') then
    raise exception using errcode = '22023', message = 'Invalid Instagram address';
  end if;
  p_site := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('supportEmail', v_email, 'instagramUrl', v_instagram));

  insert into public.platform_settings (id) values (1) on conflict (id) do nothing;
  select * into previous from public.platform_settings where id = 1 for update;
  if p_expected_updated_at is not null and previous.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'platform_settings_changed';
  end if;

  update public.platform_settings
  set features = p_features, maintenance = p_maintenance, site = p_site,
      updated_at = pg_catalog.clock_timestamp(), updated_by_operator_id = p_operator_id
  where id = 1
  returning updated_at into saved_at;

  maintenance_summary := case when p_maintenance is null then pg_catalog.jsonb_build_object('on', false)
    else pg_catalog.jsonb_build_object('on', true, 'title_characters', pg_catalog.char_length(v_title),
      'body_fingerprint', pg_catalog.left(pg_catalog.md5(v_body), 12), 'starts_at', starts, 'ends_at', ends) end;
  previous_summary := case when previous.maintenance is null then pg_catalog.jsonb_build_object('on', false)
    else pg_catalog.jsonb_build_object('on', true,
      'title_characters', pg_catalog.char_length(coalesce(previous.maintenance ->> 'title', '')),
      'body_fingerprint', pg_catalog.left(pg_catalog.md5(coalesce(previous.maintenance ->> 'body', '')), 12),
      'starts_at', previous.maintenance -> 'startsAt', 'ends_at', previous.maintenance -> 'endsAt') end;
  perform public.fitx_admin_op_log_event(p_operator_id, 'platform_settings_updated', 'platform_settings', '1',
    pg_catalog.jsonb_build_object(
      'before', pg_catalog.jsonb_build_object('features', previous.features, 'maintenance', previous_summary, 'site', previous.site),
      'after', pg_catalog.jsonb_build_object('features', p_features, 'maintenance', maintenance_summary, 'site', p_site)));
  return saved_at;
end;
$function$;

-- Targeted notices ----------------------------------------------------------------------------------------

-- A notice sent from Admin to chosen accounts: one row per recipient, grouped by batch_id. The member sees
-- it in the app's banner until they dismiss it. Operators' IDs are never readable by members.
create table if not exists public.member_notifications (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  body text not null check (char_length(body) between 1 and 600),
  tone text not null default 'info' check (tone in ('info', 'success', 'warning')),
  link_url text check (
    link_url is null
    or (char_length(link_url) <= 300 and (link_url ~ '^/([^/\\]|$)' or link_url ~ '^https://[^\s]+$'))
  ),
  link_label text check (link_label is null or char_length(link_label) between 1 and 40),
  created_at timestamptz not null default now(),
  created_by_operator_id uuid references public.admin_operators (id) on delete set null,
  dismissed_at timestamptz,
  constraint member_notifications_link_pair_check check ((link_url is null) = (link_label is null))
);

create index if not exists member_notifications_user_idx on public.member_notifications (user_id, created_at desc);
create index if not exists member_notifications_batch_idx on public.member_notifications (batch_id);
create index if not exists member_notifications_operator_idx on public.member_notifications (created_by_operator_id);

alter table public.member_notifications enable row level security;
revoke all on table public.member_notifications from public, anon, authenticated, service_role;
-- user_id too, so the account data export (src/lib/account/export.ts) can ask for the member's own rows.
grant select (id, user_id, title, body, tone, link_url, link_label, created_at, dismissed_at) on table public.member_notifications to authenticated;
grant update (dismissed_at) on table public.member_notifications to authenticated;
grant select on table public.member_notifications to service_role;

drop policy if exists member_notifications_read_own on public.member_notifications;
create policy member_notifications_read_own
  on public.member_notifications
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists member_notifications_dismiss_own on public.member_notifications;
create policy member_notifications_dismiss_own
  on public.member_notifications
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- A dismissal is stamped by the database and never undone or moved.
create or replace function public.fitx_member_notification_dismiss_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  new.dismissed_at := case when old.dismissed_at is not null then old.dismissed_at
                           when new.dismissed_at is not null then pg_catalog.now()
                           else null end;
  return new;
end;
$function$;

drop trigger if exists member_notifications_dismiss_guard on public.member_notifications;
create trigger member_notifications_dismiss_guard
  before update on public.member_notifications
  for each row execute function public.fitx_member_notification_dismiss_guard();

-- Sends one notice to up to 500 accounts (notifications.send). Every recipient must be an account that is
-- not deleted (P0002 otherwise). The audit row holds the count, the style and the text's length and
-- fingerprint, never the text or the recipients' addresses.
create or replace function public.fitx_admin_op_send_notifications(
  p_operator_id uuid,
  p_user_ids uuid[],
  p_title text,
  p_body text,
  p_tone text,
  p_link_url text,
  p_link_label text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  recipients uuid[];
  found_count integer;
  batch uuid := pg_catalog.gen_random_uuid();
  v_title text := pg_catalog.btrim(coalesce(p_title, ''));
  v_body text := pg_catalog.btrim(coalesce(p_body, ''));
  v_link text := nullif(pg_catalog.btrim(coalesce(p_link_url, '')), '');
  v_label text := nullif(pg_catalog.btrim(coalesce(p_link_label, '')), '');
  sent integer;
begin
  if not public.fitx_admin_op_can(p_operator_id, 'notifications.send') then
    raise exception using errcode = '42501', message = 'Notification permission required';
  end if;
  recipients := array(select distinct r from pg_catalog.unnest(coalesce(p_user_ids, array[]::uuid[])) r where r is not null);
  if pg_catalog.cardinality(recipients) = 0 then
    raise exception using errcode = '22023', message = 'Choose at least one account';
  end if;
  if pg_catalog.cardinality(recipients) > 500 then
    raise exception using errcode = '22023', message = 'At most 500 accounts at a time';
  end if;
  select pg_catalog.count(*) into found_count from auth.users u where u.id = any (recipients) and u.deleted_at is null;
  if found_count <> pg_catalog.cardinality(recipients) then
    raise exception using errcode = 'P0002', message = 'An account was not found';
  end if;

  insert into public.member_notifications (batch_id, user_id, title, body, tone, link_url, link_label, created_by_operator_id)
  select batch, r, v_title, v_body, coalesce(p_tone, 'info'), v_link, v_label, p_operator_id
  from pg_catalog.unnest(recipients) r;
  get diagnostics sent = row_count;

  perform public.fitx_admin_op_log_event(p_operator_id, 'notification_sent', 'notification_batch', batch::text,
    pg_catalog.jsonb_build_object('recipients', sent, 'tone', coalesce(p_tone, 'info'), 'has_link', v_link is not null,
      'title_characters', pg_catalog.char_length(v_title), 'body_characters', pg_catalog.char_length(v_body),
      'body_fingerprint', pg_catalog.left(pg_catalog.md5(v_body), 12)));
  return pg_catalog.jsonb_build_object('batch_id', batch, 'sent', sent);
end;
$function$;

-- Sent notices, newest first: one row per batch with its current recipients (deleted accounts drop out)
-- and how many of them dismissed it.
create or replace function public.fitx_admin_notification_history(p_limit integer default 50)
returns table (
  batch_id uuid,
  title text,
  body text,
  tone text,
  link_url text,
  link_label text,
  sent_at timestamptz,
  recipients integer,
  dismissed integer,
  operator_username text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select n.batch_id,
         (pg_catalog.array_agg(n.title))[1],
         (pg_catalog.array_agg(n.body))[1],
         (pg_catalog.array_agg(n.tone))[1],
         (pg_catalog.array_agg(n.link_url))[1],
         (pg_catalog.array_agg(n.link_label))[1],
         pg_catalog.min(n.created_at),
         pg_catalog.count(*)::integer,
         pg_catalog.count(n.dismissed_at)::integer,
         (select o.username from public.admin_operators o where o.id = (pg_catalog.array_agg(n.created_by_operator_id))[1])
  from public.member_notifications n
  group by n.batch_id
  order by pg_catalog.min(n.created_at) desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$function$;

-- The FITX account for each of up to 100 email addresses (any letter case), in one call, so a pasted list of
-- recipients is not looked up one address at a time. Addresses with no account are left out; when two
-- accounts share an address, the older one is used, as in fitx_admin_find_user_by_email.
create or replace function public.fitx_admin_find_users_by_emails(p_emails text[])
returns table (email text, user_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if coalesce(pg_catalog.cardinality(p_emails), 0) > 100 then
    raise exception using errcode = '22023', message = 'At most 100 emails per call';
  end if;
  return query
    select distinct on (pg_catalog.lower(u.email::text)) pg_catalog.lower(u.email::text), u.id
    from auth.users u
    where u.deleted_at is null
      and pg_catalog.lower(u.email::text) in (select pg_catalog.lower(pg_catalog.btrim(e)) from pg_catalog.unnest(coalesce(p_emails, array[]::text[])) e)
    order by pg_catalog.lower(u.email::text), u.created_at;
end;
$function$;

-- Support inbox -------------------------------------------------------------------------------------------

-- Complaints get their own category, next to questions, problems, feedback, account and other.
do $do$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_catalog.pg_constraint con
    where con.conrelid = 'public.support_requests'::regclass
      and con.contype = 'c'
      and pg_catalog.pg_get_constraintdef(con.oid) ilike '%category%'
      and pg_catalog.pg_get_constraintdef(con.oid) not ilike '%complaint%'
  loop
    execute pg_catalog.format('alter table public.support_requests drop constraint %I', c.conname);
  end loop;
  if not exists (
    select 1 from pg_catalog.pg_constraint con
    where con.conrelid = 'public.support_requests'::regclass and con.conname = 'support_requests_category_check'
  ) then
    alter table public.support_requests add constraint support_requests_category_check
      check (category in ('question', 'problem', 'complaint', 'feedback', 'account', 'other'));
  end if;
end
$do$;

-- When an operator last read the request. Unread: never read, or a message arrived after. Members cannot
-- read this column (the support tables use column grants).
-- Requests already there when the column is first added count as read when they are resolved or closed, or
-- when support wrote the newest message; the rest stay unread. Only that first run backfills: a re-run, or a
-- request read since, is left alone.
do $do$
declare
  first_run boolean := not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'support_requests' and column_name = 'staff_seen_at'
  );
begin
  alter table public.support_requests add column if not exists staff_seen_at timestamptz;
  if first_run then
    update public.support_requests r
    set staff_seen_at = r.last_message_at
    where r.status in ('resolved', 'closed')
       or (select m.author_kind from public.support_messages m
           where m.request_id = r.id
           order by m.created_at desc, m.id desc
           limit 1) = 'staff';
  end if;
end
$do$;
-- The same rule as a column, so the Admin inbox can filter on it.
alter table public.support_requests add column if not exists staff_unread boolean
  generated always as (staff_seen_at is null or last_message_at > staff_seen_at) stored;
create index if not exists support_requests_unread_idx on public.support_requests (last_message_at desc) where staff_unread;

-- A staff reply means the request was read.
create or replace function public.fitx_support_staff_seen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.author_kind = 'staff' then
    update public.support_requests set staff_seen_at = pg_catalog.now() where id = new.request_id;
  end if;
  return null;
end;
$function$;

drop trigger if exists support_messages_staff_seen on public.support_messages;
create trigger support_messages_staff_seen
  after insert on public.support_messages
  for each row execute function public.fitx_support_staff_seen();

-- Marks a request read when an operator opens it (support.view). True when it was unread; audited then.
-- It never touches updated_at, which the Details form uses to spot changes made by someone else.
create or replace function public.fitx_admin_op_support_mark_seen(p_operator_id uuid, p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  changed integer;
begin
  if not public.fitx_admin_op_can(p_operator_id, 'support.view') then
    raise exception using errcode = '42501', message = 'Support permission required';
  end if;
  update public.support_requests
  set staff_seen_at = pg_catalog.now()
  where id = p_request_id and (staff_seen_at is null or staff_seen_at < last_message_at);
  get diagnostics changed = row_count;
  if changed = 0 then
    if not exists (select 1 from public.support_requests where id = p_request_id) then
      raise exception using errcode = 'P0002', message = 'Support request not found';
    end if;
    return false;
  end if;
  perform public.fitx_admin_op_log_event(p_operator_id, 'support_request_read', 'support_request', p_request_id::text, '{}'::jsonb);
  return true;
end;
$function$;

-- Counts for the inbox: by status, open work by category, and unread (overall and by category).
create or replace function public.fitx_admin_support_inbox()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'by_status', coalesce((select pg_catalog.jsonb_object_agg(s.status, s.n)
                           from (select r.status, pg_catalog.count(*) as n from public.support_requests r group by r.status) s), '{}'::jsonb),
    'open_by_category', coalesce((select pg_catalog.jsonb_object_agg(c.category, c.n)
                                  from (select r.category, pg_catalog.count(*) as n from public.support_requests r
                                        where r.status in ('open', 'in_progress', 'waiting_on_user') group by r.category) c), '{}'::jsonb),
    'unread', (select pg_catalog.count(*) from public.support_requests r
               where r.staff_seen_at is null or r.last_message_at > r.staff_seen_at),
    'unread_by_category', coalesce((select pg_catalog.jsonb_object_agg(c.category, c.n)
                                    from (select r.category, pg_catalog.count(*) as n from public.support_requests r
                                          where r.staff_seen_at is null or r.last_message_at > r.staff_seen_at group by r.category) c), '{}'::jsonb)
  );
$function$;

-- Accounts --------------------------------------------------------------------------------------------------

-- Searches accounts by part of the email, the phone number (digits), the name from sign-in, or the exact
-- account ID, newest first, with filters: p_status active | suspended | unconfirmed; p_method a sign-in
-- method (google, email, phone, …); p_plan premium | free (live Razorpay subscriptions only). Sign-in
-- methods come from Auth identities and app metadata. Account fields only, plus the subscription status.
create or replace function public.fitx_admin_search_users_v2(
  p_query text default null,
  p_status text default null,
  p_method text default null,
  p_plan text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  user_id uuid,
  email text,
  phone text,
  display_name text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz,
  phone_confirmed_at timestamptz,
  banned_until timestamptz,
  providers text[],
  subscription_status text,
  premium boolean,
  admin_role text,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $function$
  with params as (
    select nullif(pg_catalog.btrim(coalesce(p_query, '')), '') as q,
           nullif(pg_catalog.regexp_replace(coalesce(p_query, ''), '[^0-9]', '', 'g'), '') as digits,
           nullif(pg_catalog.btrim(coalesce(p_status, '')), '') as status,
           nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_method, ''))), '') as method,
           nullif(pg_catalog.btrim(coalesce(p_plan, '')), '') as plan,
           least(greatest(coalesce(p_limit, 25), 1), 100) as lim,
           least(greatest(coalesce(p_offset, 0), 0), 100000) as off
  ),
  accounts as (
    select u.id, u.email::text as email, u.phone::text as phone, u.created_at, u.last_sign_in_at,
           u.email_confirmed_at, u.phone_confirmed_at, u.banned_until,
           coalesce(nullif(pg_catalog.btrim(u.raw_user_meta_data ->> 'full_name'), ''),
                    nullif(pg_catalog.btrim(u.raw_user_meta_data ->> 'name'), '')) as display_name,
           array(
             select distinct m.method from (
               select pg_catalog.jsonb_array_elements_text(
                 case when pg_catalog.jsonb_typeof(u.raw_app_meta_data -> 'providers') = 'array'
                      then u.raw_app_meta_data -> 'providers' else '[]'::jsonb end) as method
               union
               select i.provider from auth.identities i where i.user_id = u.id
             ) m
             where m.method is not null
             order by m.method
           ) as providers,
           (select s.status from public.billing_subscriptions s
            where s.user_id = u.id and s.mode = 'live' and s.abandoned_at is null
            order by s.created_at desc limit 1) as subscription_status,
           exists (select 1 from public.billing_subscriptions s
                   where s.user_id = u.id and s.mode = 'live' and public.billing_grants_access(s.status, s.paid_until)) as premium
    from auth.users u
    where u.deleted_at is null
      and not coalesce(u.is_anonymous, false)
  ),
  matched as (
    select a.*
    from accounts a, params p
    where (
        p.q is null
        or a.email ilike '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(p.q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
        or a.display_name ilike '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(p.q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
        or (p.digits is not null and pg_catalog.char_length(p.digits) >= 4 and a.phone like '%' || p.digits || '%')
        or a.id::text = pg_catalog.lower(p.q)
      )
      and (
        p.status is null
        or (p.status = 'suspended' and a.banned_until > pg_catalog.now())
        or (p.status = 'active' and (a.banned_until is null or a.banned_until <= pg_catalog.now()))
        or (p.status = 'unconfirmed' and a.email_confirmed_at is null and a.phone_confirmed_at is null)
      )
      and (p.method is null or p.method = any (a.providers))
      and (p.plan is null or (p.plan = 'premium' and a.premium) or (p.plan = 'free' and not a.premium))
  )
  select m.id, m.email, m.phone, m.display_name, m.created_at, m.last_sign_in_at, m.email_confirmed_at,
         m.phone_confirmed_at, m.banned_until, m.providers, m.subscription_status, m.premium,
         (select am.role from public.fitx_admin_members am where am.user_id = m.id),
         pg_catalog.count(*) over ()
  from matched m
  order by m.created_at desc, m.id
  limit (select lim from params)
  offset (select off from params);
$function$;

-- Counts for the Overview next to fitx_admin_metrics, over the same accounts (not deleted, not anonymous,
-- not old Admin team members): suspended now, accounts per sign-in method, the latest paid-for live
-- subscription's status per account (accounts that never paid are left out), and accounts with premium access now.
create or replace function public.fitx_admin_overview_extras()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with accounts as (
    select u.id, u.banned_until, u.raw_app_meta_data
    from auth.users u
    where u.deleted_at is null
      and not coalesce(u.is_anonymous, false)
      and not exists (select 1 from public.fitx_admin_members m where m.user_id = u.id)
  ),
  methods as (
    select distinct a.id, m.method
    from accounts a
    cross join lateral (
      select pg_catalog.jsonb_array_elements_text(
        case when pg_catalog.jsonb_typeof(a.raw_app_meta_data -> 'providers') = 'array'
             then a.raw_app_meta_data -> 'providers' else '[]'::jsonb end) as method
      union
      select i.provider from auth.identities i where i.user_id = a.id
    ) m
    where m.method is not null
  ),
  -- Each account's newest live subscription that was ever paid for (a captured payment, refunded or not), so
  -- a checkout that was opened and never paid does not count as a subscriber.
  latest as (
    select distinct on (s.user_id) s.user_id, s.status
    from public.billing_subscriptions s
    join accounts a on a.id = s.user_id
    where s.mode = 'live' and s.abandoned_at is null
      and exists (select 1 from public.billing_payments p
                  where p.subscription_id = s.id and p.mode = 'live' and p.status in ('captured', 'refunded'))
    order by s.user_id, s.created_at desc
  )
  select pg_catalog.jsonb_build_object(
    'suspended', (select pg_catalog.count(*) from accounts a where a.banned_until > pg_catalog.now()),
    'methods', coalesce((select pg_catalog.jsonb_object_agg(x.method, x.n)
                         from (select method, pg_catalog.count(*) as n from methods group by method) x), '{}'::jsonb),
    'subscriptions', coalesce((select pg_catalog.jsonb_object_agg(x.status, x.n)
                               from (select status, pg_catalog.count(*) as n from latest group by status) x), '{}'::jsonb),
    'premium', (select pg_catalog.count(distinct s.user_id) from public.billing_subscriptions s
                join accounts a on a.id = s.user_id
                where s.mode = 'live' and public.billing_grants_access(s.status, s.paid_until)),
    'generated_at', pg_catalog.now()
  );
$function$;

-- Security --------------------------------------------------------------------------------------------------

-- Admin sign-in attempts in the last day and week, addresses at their limit now, operators locked now (and
-- how many unknown usernames are), and the last 14 IST days of results. Counts and usernames only: no IP,
-- typed username or password ever leaves the table.
create or replace function public.fitx_admin_security_overview()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with limits as (select public.fitx_admin_login_limits() as l),
  operator_keys as (
    select o.id, o.username, public.fitx_admin_login_username_key(o.username) as username_key
    from public.admin_operators o
  ),
  locks as (
    select k.id, k.username, public.fitx_admin_login_locked_until(k.username_key) as locked_until
    from operator_keys k
  ),
  recent_keys as (
    select distinct a.username_key
    from public.admin_login_attempts a
    where a.username_key is not null
      and a.succeeded is not true
      and a.created_at > pg_catalog.now() - interval '30 minutes'
      and a.username_key not in (select username_key from operator_keys)
  ),
  days as (
    select pg_catalog.generate_series(
      (pg_catalog.now() at time zone 'Asia/Kolkata')::date - 13,
      (pg_catalog.now() at time zone 'Asia/Kolkata')::date,
      interval '1 day')::date as day
  ),
  daily as (
    select (a.created_at at time zone 'Asia/Kolkata')::date as day,
           pg_catalog.count(*) filter (where a.succeeded) as succeeded,
           pg_catalog.count(*) filter (where a.succeeded is false) as failed
    from public.admin_login_attempts a
    where a.created_at >= ((select pg_catalog.min(day) from days)::timestamp at time zone 'Asia/Kolkata')
    group by 1
  )
  select pg_catalog.jsonb_build_object(
    'succeeded_24h', (select pg_catalog.count(*) from public.admin_login_attempts a
                      where a.succeeded and a.created_at > pg_catalog.now() - interval '24 hours'),
    'failed_24h', (select pg_catalog.count(*) from public.admin_login_attempts a
                   where a.succeeded is false and a.created_at > pg_catalog.now() - interval '24 hours'),
    'failed_7d', (select pg_catalog.count(*) from public.admin_login_attempts a
                  where a.succeeded is false and a.created_at > pg_catalog.now() - interval '7 days'),
    'ip_limited_now', (select pg_catalog.count(*) from (
                         select a.ip_key from public.admin_login_attempts a, limits
                         where a.created_at > pg_catalog.now() - pg_catalog.make_interval(mins => (limits.l ->> 'ipWindowMinutes')::integer)
                         group by a.ip_key, limits.l
                         having pg_catalog.count(*) >= (limits.l ->> 'ipAttempts')::integer) x),
    'locked', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('operator_id', l.id, 'username', l.username,
                                                                                  'locked_until', l.locked_until) order by l.username)
                        from locks l where l.locked_until is not null), '[]'::jsonb),
    'locked_unknown', (select pg_catalog.count(*) from recent_keys r
                       where public.fitx_admin_login_locked_until(r.username_key) is not null),
    'daily', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('day', d.day,
                                                                                 'succeeded', coalesce(x.succeeded, 0),
                                                                                 'failed', coalesce(x.failed, 0)) order by d.day)
                       from days d left join daily x on x.day = d.day), '[]'::jsonb),
    'generated_at', pg_catalog.now()
  );
$function$;

-- Execute rights: service_role only -------------------------------------------------------------------------

revoke all on function public.fitx_admin_op_save_platform_settings(uuid, jsonb, jsonb, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.fitx_member_notification_dismiss_guard() from public, anon, authenticated;
revoke all on function public.fitx_admin_op_send_notifications(uuid, uuid[], text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.fitx_admin_notification_history(integer) from public, anon, authenticated;
revoke all on function public.fitx_admin_find_users_by_emails(text[]) from public, anon, authenticated;
revoke all on function public.fitx_support_staff_seen() from public, anon, authenticated;
revoke all on function public.fitx_admin_op_support_mark_seen(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fitx_admin_support_inbox() from public, anon, authenticated;
revoke all on function public.fitx_admin_search_users_v2(text, text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.fitx_admin_overview_extras() from public, anon, authenticated;
revoke all on function public.fitx_admin_security_overview() from public, anon, authenticated;

grant execute on function public.fitx_admin_op_save_platform_settings(uuid, jsonb, jsonb, jsonb, timestamptz) to service_role;
grant execute on function public.fitx_admin_op_send_notifications(uuid, uuid[], text, text, text, text, text) to service_role;
grant execute on function public.fitx_admin_notification_history(integer) to service_role;
grant execute on function public.fitx_admin_find_users_by_emails(text[]) to service_role;
grant execute on function public.fitx_admin_op_support_mark_seen(uuid, uuid) to service_role;
grant execute on function public.fitx_admin_support_inbox() to service_role;
grant execute on function public.fitx_admin_search_users_v2(text, text, text, text, integer, integer) to service_role;
grant execute on function public.fitx_admin_overview_extras() to service_role;
grant execute on function public.fitx_admin_security_overview() to service_role;
