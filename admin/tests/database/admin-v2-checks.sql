\set ON_ERROR_STOP 1
\set QUIET 1
-- Functional checks for 20261121100030_fitx_admin_v2 on a throwaway database: operators, sessions,
-- sign-in limits and the operator versions of the Admin write functions. Each block raises with a
-- label when an expectation fails. Names, hashes and tokens are made up.

-- Fixtures ------------------------------------------------------------------------------------------
insert into auth.users (id, email, email_confirmed_at, created_at, raw_app_meta_data) values
  ('00000000-0000-4000-8000-0000000002c1', 'v2-member@example.com', now(), now() - interval '3 days', '{"providers":["email"]}');

create temporary table v2_ids (name text primary key, id uuid);
grant all on v2_ids to public;

-- Tables, row level security and grants -------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['admin_operators', 'admin_web_sessions', 'admin_login_attempts'] loop
    if not exists (select 1 from pg_class where oid = ('public.' || t)::regclass and relrowsecurity and relforcerowsecurity) then
      raise exception '% must have row level security on and forced', t;
    end if;
    if exists (select 1 from pg_policy where polrelid = ('public.' || t)::regclass) then
      raise exception '% must have no policy (service_role and the definer functions only)', t;
    end if;
    if has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('authenticated', 'public.' || t, 'select')
       or has_table_privilege('authenticated', 'public.' || t, 'insert') or has_table_privilege('anon', 'public.' || t, 'insert') then
      raise exception '% must be closed to anon and authenticated', t;
    end if;
    if not has_table_privilege('service_role', 'public.' || t, 'select') then
      raise exception 'service_role must read %', t;
    end if;
    if has_table_privilege('service_role', 'public.' || t, 'delete') then
      raise exception 'service_role must not delete from %', t;
    end if;
  end loop;
  if has_table_privilege('service_role', 'public.admin_operators', 'insert') or has_table_privilege('service_role', 'public.admin_operators', 'update')
     or has_table_privilege('service_role', 'public.admin_login_attempts', 'insert') then
    raise exception 'operators and attempts are written only through the definer functions';
  end if;
  if not has_table_privilege('service_role', 'public.admin_web_sessions', 'insert') or not has_table_privilege('service_role', 'public.admin_web_sessions', 'update') then
    raise exception 'service_role must create and end sessions';
  end if;
end $$;
\echo ok admin tables: RLS forced, no policies, closed to the API roles

do $$
declare
  f record;
begin
  for f in
    select p.oid, p.proname, p.prosecdef, p.proconfig from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and (p.proname like 'fitx_admin_op\_%' or p.proname like 'fitx_admin_login\_%' or p.proname = 'fitx_admin_role_permissions')
  loop
    if has_function_privilege('anon', f.oid, 'execute') or has_function_privilege('authenticated', f.oid, 'execute') then
      raise exception '% must not be callable by anon or authenticated', f.proname;
    end if;
    if not has_function_privilege('service_role', f.oid, 'execute') then raise exception '% must be callable by service_role', f.proname; end if;
    if not coalesce(f.proconfig @> array['search_path=""'], false) then raise exception '% must pin search_path', f.proname; end if;
  end loop;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'fitx_admin_op\_%') < 14 then
    raise exception 'operator functions are missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'fitx_admin_log_event') or not exists (select 1 from pg_proc where proname = 'fitx_admin_actor_can') then
    raise exception 'the older Admin functions must stay';
  end if;
end $$;
\echo ok every new function is service_role only with a pinned search path; old ones stay

-- Root and operators ---------------------------------------------------------------------------------
do $$
declare
  root_id uuid;
  again uuid;
begin
  root_id := public.fitx_admin_op_root_sign_in('Test-Owner');
  again := public.fitx_admin_op_root_sign_in('test-owner');
  if root_id is distinct from again then raise exception 'the root must keep one row'; end if;
  if not exists (select 1 from public.admin_operators where id = root_id and is_root and role = 'super_admin' and is_active and password_hash is null and username = 'test-owner' and last_login_at is not null) then
    raise exception 'root row shape';
  end if;
  insert into v2_ids values ('root', root_id);
  begin
    insert into public.admin_operators (username, role, is_root) values ('second-root', 'super_admin', true);
    raise exception 'a second root row was accepted';
  exception when unique_violation then null; end;
  begin
    insert into public.admin_operators (username, role, is_root, is_active) values ('off-root', 'super_admin', true, false);
    raise exception 'an inactive root was accepted';
  exception when check_violation or unique_violation then null; end;
end $$;
\echo ok root operator: one row, always an active super-admin without a stored hash

do $$
declare
  root_id uuid := (select id from v2_ids where name = 'root');
  hash text := 'scrypt:32768:8:1:AAAAAAAAAAAAAAAAAAAAAA:' || repeat('B', 86);
  agent uuid;
  viewer uuid;
  editor uuid;
  audit record;
begin
  agent := public.fitx_admin_op_create_operator(root_id, ' Agent.One ', 'support_agent', hash);
  viewer := public.fitx_admin_op_create_operator(root_id, 'viewer-one', 'viewer', hash);
  editor := public.fitx_admin_op_create_operator(root_id, 'editor_one', 'content_editor', hash);
  insert into v2_ids values ('agent', agent), ('viewer', viewer), ('editor', editor);
  if not exists (select 1 from public.admin_operators where id = agent and username = 'agent.one' and must_change_password and created_by = root_id and not is_root) then
    raise exception 'a new operator starts with a temporary password';
  end if;
  select * into audit from public.fitx_admin_audit_logs where action = 'operator_created' and resource_id = agent::text;
  if audit.actor_operator_id is distinct from root_id or audit.actor_username <> 'test-owner' or audit.actor_id is not null
     or audit.details <> jsonb_build_object('username', 'agent.one', 'role', 'support_agent') then
    raise exception 'operator_created audit row: %', row_to_json(audit);
  end if;
  begin perform public.fitx_admin_op_create_operator(viewer, 'not-allowed', 'admin', hash); raise exception 'a viewer created an operator';
  exception when insufficient_privilege then null; end;
  begin perform public.fitx_admin_op_create_operator(root_id, 'agent.one', 'admin', hash); raise exception 'a duplicate username was accepted';
  exception when unique_violation then null; end;
  begin perform public.fitx_admin_op_create_operator(root_id, 'test-owner', 'admin', hash); raise exception 'the root username was accepted';
  exception when unique_violation then null; end;
  begin perform public.fitx_admin_op_create_operator(root_id, 'x', 'admin', hash); raise exception 'a short username was accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.fitx_admin_op_create_operator(root_id, 'new-owner', 'owner', hash); raise exception 'an unknown role was accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.fitx_admin_op_create_operator(root_id, 'bad-hash', 'admin', 'plain-password'); raise exception 'a plain password was stored';
  exception when check_violation then null; end;
  begin perform public.fitx_admin_op_root_sign_in('agent.one'); raise exception 'the root took an operator''s name';
  exception when unique_violation then null; end;
end $$;
\echo ok operators: created by super-admins only, temporary password, unique names, audited

do $$
declare
  root_id uuid := (select id from v2_ids where name = 'root');
  agent uuid := (select id from v2_ids where name = 'agent');
  viewer uuid := (select id from v2_ids where name = 'viewer');
begin
  if not public.fitx_admin_op_can(root_id, 'settings.manage') or not public.fitx_admin_op_can(root_id, 'access.manage') then raise exception 'root holds every permission'; end if;
  if not public.fitx_admin_op_can(agent, 'support.reply') or public.fitx_admin_op_can(agent, 'people.suspend') then raise exception 'agent permissions'; end if;
  if public.fitx_admin_op_can(viewer, 'people.view') or not public.fitx_admin_op_can(viewer, 'reports.view') then raise exception 'viewer permissions'; end if;
  if public.fitx_admin_op_can(null, 'overview.view') or public.fitx_admin_op_can(gen_random_uuid(), 'overview.view') then raise exception 'unknown operators have nothing'; end if;
  if public.fitx_admin_op_can(agent, 'made.up') then raise exception 'unknown permissions are refused'; end if;
  if not ('nutrition.manage' = any (public.fitx_admin_role_permissions('content_editor'))) or ('billing.manage' = any (public.fitx_admin_role_permissions('admin'))) then
    raise exception 'v2 role table';
  end if;
end $$;
\echo ok operator permissions follow the role table

-- Sessions end on deactivation and password changes ----------------------------------------------------
do $$
declare
  root_id uuid := (select id from v2_ids where name = 'root');
  agent uuid := (select id from v2_ids where name = 'agent');
  viewer uuid := (select id from v2_ids where name = 'viewer');
  ended integer;
  new_hash text := 'scrypt:32768:8:1:CCCCCCCCCCCCCCCCCCCCCC:' || repeat('D', 86);
begin
  insert into public.admin_web_sessions (operator_id, token_hash, credential_stamp)
  values (agent, repeat('a', 64), repeat('0', 16)), (agent, repeat('b', 64), repeat('0', 16)), (viewer, repeat('c', 64), repeat('0', 16));
  begin insert into public.admin_web_sessions (operator_id, token_hash, credential_stamp) values (agent, repeat('a', 64), repeat('0', 16)); raise exception 'a token hash was reused';
  exception when unique_violation then null; end;
  begin insert into public.admin_web_sessions (operator_id, token_hash, credential_stamp) values (agent, 'raw-token', repeat('0', 16)); raise exception 'a raw token was stored';
  exception when check_violation then null; end;

  begin perform public.fitx_admin_op_update_operator(root_id, root_id, 'admin', false); raise exception 'the root changed itself';
  exception when sqlstate '22023' then null; end;
  begin perform public.fitx_admin_op_update_operator(agent, root_id, 'viewer', false); raise exception 'an agent changed the root';
  exception when insufficient_privilege then null; end;
  begin perform public.fitx_admin_op_set_operator_password(agent, viewer, new_hash, true); raise exception 'an agent reset someone else''s password';
  exception when insufficient_privilege then null; end;
  begin perform public.fitx_admin_op_set_operator_password(root_id, root_id, new_hash, false); raise exception 'the root password was stored';
  exception when insufficient_privilege then null; end;

  perform public.fitx_admin_op_update_operator(root_id, agent, 'admin', null);
  if (select role from public.admin_operators where id = agent) <> 'admin' then raise exception 'role change'; end if;
  if (select count(*) from public.admin_web_sessions where operator_id = agent and revoked_at is null) <> 2 then raise exception 'a role change keeps sessions'; end if;
  perform public.fitx_admin_op_update_operator(root_id, agent, 'support_agent', false);
  if (select count(*) from public.admin_web_sessions where operator_id = agent and revoked_at is null) <> 0 then raise exception 'deactivation ends sessions'; end if;
  if (select details ->> 'sessions_ended' from public.fitx_admin_audit_logs where action = 'operator_updated' and resource_id = agent::text order by id desc limit 1) <> '2' then
    raise exception 'operator_updated records the sessions ended';
  end if;
  if public.fitx_admin_op_can(agent, 'support.view') then raise exception 'an inactive operator has no permissions'; end if;
  perform public.fitx_admin_op_update_operator(root_id, agent, null, true);

  ended := public.fitx_admin_op_set_operator_password(viewer, viewer, new_hash, false);
  if ended <> 1 or (select must_change_password from public.admin_operators where id = viewer) then raise exception 'own password change: % sessions', ended; end if;
  if (select action from public.fitx_admin_audit_logs where resource_id = viewer::text order by id desc limit 1) <> 'operator_password_changed' then raise exception 'own change audit'; end if;
  begin perform public.fitx_admin_op_set_operator_password(viewer, viewer, new_hash, false); raise exception 'the same hash was accepted';
  exception when sqlstate '22023' then null; end;
  perform public.fitx_admin_op_set_operator_password(root_id, viewer, 'scrypt:32768:8:1:EEEEEEEEEEEEEEEEEEEEEE:' || repeat('F', 86), true);
  if not (select must_change_password from public.admin_operators where id = viewer) then raise exception 'a reset leaves a temporary password'; end if;
  if (select action from public.fitx_admin_audit_logs where resource_id = viewer::text order by id desc limit 1) <> 'operator_password_reset' then raise exception 'reset audit'; end if;
  if exists (select 1 from public.fitx_admin_audit_logs where details::text like '%scrypt:%') then raise exception 'a password hash reached the audit log'; end if;
end $$;
\echo ok sessions end on deactivation and password changes; the root cannot be changed here

-- Sign-in limits ----------------------------------------------------------------------------------------
do $$
declare
  result text;
  key text := public.fitx_admin_login_username_key('Lock-A');
begin
  if key <> encode(sha256(convert_to('lock-a', 'UTF8')), 'hex') then raise exception 'username key is the SHA-256 of the lower-case name'; end if;
  result := public.fitx_admin_login_check('lock-a', 'ip-1');
  if result <> 'ok' then raise exception 'first check: %', result; end if;
  if not exists (select 1 from public.admin_login_attempts where username_key = key and succeeded is null) then raise exception 'an open attempt row'; end if;
  if exists (select 1 from public.admin_login_attempts where username_key in ('lock-a', 'Lock-A')) then raise exception 'a typed username was stored as typed'; end if;
  result := public.fitx_admin_login_record('lock-a', 'ip-1', false);
  if result <> 'recorded' then raise exception 'first failure: %', result; end if;
  if (select count(*) from public.admin_login_attempts where username_key = key) <> 1 then raise exception 'the record closes the open row'; end if;

  -- Three more failures in the window: the fifth (this one) locks.
  insert into public.admin_login_attempts (username_key, ip_key, succeeded, created_at)
  values (key, 'ip-1', false, now() - interval '10 minutes'), (key, 'ip-1', false, now() - interval '8 minutes'), (key, 'ip-1', false, now() - interval '6 minutes');
  result := public.fitx_admin_login_check('lock-a', 'ip-1');
  if result <> 'ok' then raise exception 'fifth attempt is still checked: %', result; end if;
  result := public.fitx_admin_login_record('lock-a', 'ip-1', false);
  if result <> 'locked_now' then raise exception 'fifth failure should lock: %', result; end if;
  result := public.fitx_admin_login_check('LOCK-A', 'ip-1');
  if result <> 'locked' then raise exception 'locked on that IP for any letter case: %', result; end if;
  if not exists (select 1 from public.admin_login_attempts where username_key is null and ip_key = 'ip-1') then raise exception 'a refused attempt counts for its IP'; end if;
  -- Usernames are not secret: one IP's failures must not keep the operator out everywhere.
  result := public.fitx_admin_login_check('lock-a', 'ip-2');
  if result <> 'ok' then raise exception 'another IP is not locked by one IP''s failures: %', result; end if;
  if public.fitx_admin_login_record('lock-a', 'ip-2', true) <> 'recorded' then raise exception 'a success from another IP'; end if;
  if public.fitx_admin_login_check('lock-a', 'ip-1') <> 'locked' then raise exception 'a success elsewhere does not lift the lock on ip-1'; end if;
end $$;
\echo ok five failures from one IP in 15 minutes lock the username on that IP only; refused attempts are stored without it

do $$
declare
  key text := public.fitx_admin_login_username_key('lock-b');
  ends timestamptz;
begin
  -- Locked at its fifth failure 10 minutes ago, so it ends 5 minutes from now; refusals do not extend it.
  insert into public.admin_login_attempts (username_key, ip_key, succeeded, created_at)
  select key, 'ip-3', false, now() - interval '10 minutes' - (n * interval '1 minute') from generate_series(0, 4) n;
  insert into public.admin_login_attempts (username_key, ip_key, succeeded, created_at)
  select null, 'ip-3', false, now() - interval '1 minute' from generate_series(1, 5);
  ends := public.fitx_admin_login_locked_until(key);
  if ends is null or abs(extract(epoch from ends - (now() + interval '5 minutes'))) > 1 then raise exception 'lock ends 15 minutes after the fifth: %', ends; end if;
  if public.fitx_admin_login_locked_until(key, 'ip-3') is distinct from ends then raise exception 'the lock is on ip-3'; end if;
  if public.fitx_admin_login_locked_until(key, 'ip-4') is not null then raise exception 'no lock on ip-4'; end if;
  if public.fitx_admin_login_check('lock-b', 'ip-3') <> 'locked' then raise exception 'lock-b should be locked on ip-3'; end if;
  if public.fitx_admin_login_locked_until(key) <> ends then raise exception 'a refused attempt extended the lock'; end if;
end $$;
do $$
declare
  key text := public.fitx_admin_login_username_key('lock-c');
begin
  -- The fifth failure was 15 minutes and a second ago: the lock is over.
  insert into public.admin_login_attempts (username_key, ip_key, succeeded, created_at)
  select key, 'ip-5', false, now() - interval '15 minutes 1 second' - (n * interval '1 minute') from generate_series(0, 4) n;
  if public.fitx_admin_login_check('lock-c', 'ip-5') <> 'ok' then raise exception 'an expired lock still refused'; end if;
  perform public.fitx_admin_login_record('lock-c', 'ip-5', true);
end $$;
do $$
declare
  key text := public.fitx_admin_login_username_key('lock-d');
begin
  -- Five failures four minutes apart: never five inside one 15-minute window.
  insert into public.admin_login_attempts (username_key, ip_key, succeeded, created_at)
  select key, 'ip-7', false, now() - (n * interval '4 minutes') from generate_series(1, 4) n;
  if public.fitx_admin_login_check('lock-d', 'ip-7') <> 'ok' then raise exception 'lock-d fourth check'; end if;
  if public.fitx_admin_login_record('lock-d', 'ip-7', false) <> 'recorded' then raise exception 'spread-out failures must not lock'; end if;
  -- A success is not a failure: four failures and a success leave it open.
  if public.fitx_admin_login_check('lock-e', 'ip-8') <> 'ok' then raise exception 'lock-e'; end if;
  perform public.fitx_admin_login_record('lock-e', 'ip-8', true);
  if not exists (select 1 from public.admin_login_attempts where username_key = public.fitx_admin_login_username_key('lock-e') and succeeded) then raise exception 'success recorded'; end if;
end $$;
\echo ok the lock lasts 15 minutes from the fifth failure, never longer, and needs five inside the window

do $$
declare
  key text := public.fitx_admin_login_username_key('lock-f');
  ends timestamptz;
begin
  -- 49 failures in 10 minutes from 13 IPs, at most four from each, so no IP is locked; the fiftieth locks
  -- the username on every IP for 5 minutes.
  insert into public.admin_login_attempts (username_key, ip_key, succeeded, created_at)
  select key, 'wide-' || (n % 13), false, now() - interval '10 minutes' + n * interval '5 seconds' from generate_series(1, 49) n;
  if public.fitx_admin_login_locked_until(key) is not null then raise exception '49 spread failures must not lock'; end if;
  if public.fitx_admin_login_check('lock-f', 'wide-new') <> 'ok' then raise exception 'the fiftieth attempt is still checked'; end if;
  if public.fitx_admin_login_record('lock-f', 'wide-new', false) <> 'locked_now' then raise exception 'the fiftieth failure should lock the username'; end if;
  ends := public.fitx_admin_login_locked_until(key, 'never-used');
  if ends is null or abs(extract(epoch from ends - (now() + interval '5 minutes'))) > 1 then raise exception 'the username lock lasts 5 minutes: %', ends; end if;
  if public.fitx_admin_login_check('LOCK-F', 'never-used') <> 'locked' then raise exception 'the username lock holds on every IP'; end if;
  if public.fitx_admin_login_locked_until(key) <> ends then raise exception 'a refused attempt extended the username lock'; end if;
end $$;
do $$
declare
  key text := public.fitx_admin_login_username_key('lock-g');
begin
  -- The same 50, the last one 5 minutes and a second ago: that lock is over.
  insert into public.admin_login_attempts (username_key, ip_key, succeeded, created_at)
  select key, 'wide-' || (n % 13), false, now() - interval '5 minutes 1 second' - n * interval '10 seconds' from generate_series(0, 49) n;
  if public.fitx_admin_login_check('lock-g', 'wide-new') <> 'ok' then raise exception 'an expired username lock still refused'; end if;
  if public.fitx_admin_login_record('lock-g', 'wide-new', true) <> 'recorded' then raise exception 'lock-g success'; end if;
end $$;
\echo ok 50 failures from any IPs in 15 minutes lock the username everywhere for 5 minutes

do $$
declare
  result text;
begin
  insert into public.admin_login_attempts (username_key, ip_key, succeeded, created_at)
  select null, 'ip-busy', false, now() - interval '20 minutes' from generate_series(1, 30);
  if public.fitx_admin_login_check('someone-1', 'ip-busy') <> 'ok' then raise exception 'old attempts do not count for the IP'; end if;
  insert into public.admin_login_attempts (username_key, ip_key, succeeded, created_at)
  select null, 'ip-busy', false, now() - interval '5 minutes' from generate_series(1, 19);
  result := public.fitx_admin_login_check('someone-2', 'ip-busy');
  if result <> 'ip_limited' then raise exception 'the 21st attempt in 15 minutes: %', result; end if;
  if exists (select 1 from public.admin_login_attempts where username_key = public.fitx_admin_login_username_key('someone-2')) then raise exception 'an IP-limited attempt opened a row'; end if;
  insert into public.admin_login_attempts (username_key, ip_key, succeeded, created_at) values (null, 'ip-old', false, now() - interval '31 days');
  insert into public.admin_web_sessions (operator_id, token_hash, credential_stamp, created_at)
  values ((select id from v2_ids where name = 'editor'), repeat('e', 64), repeat('0', 16), now() - interval '31 days');
  perform public.fitx_admin_login_record('someone-3', 'ip-9', false);
  if exists (select 1 from public.admin_login_attempts where ip_key = 'ip-old') or exists (select 1 from public.admin_web_sessions where token_hash = repeat('e', 64)) then
    raise exception 'rows over 30 days are pruned';
  end if;
  if not exists (select 1 from public.admin_login_attempts where username_key = public.fitx_admin_login_username_key('someone-3') and succeeded = false) then
    raise exception 'a record without an open row still records';
  end if;
  begin perform public.fitx_admin_login_record('someone-3', 'ip-9', null); raise exception 'a null result was accepted';
  exception when sqlstate '22023' then null; end;
end $$;
\echo ok at most 20 attempts per IP in 15 minutes; rows over 30 days are pruned

-- Operator versions of the Admin write functions ---------------------------------------------------------
do $$
declare
  root_id uuid := (select id from v2_ids where name = 'root');
  agent uuid := (select id from v2_ids where name = 'agent');
  viewer uuid := (select id from v2_ids where name = 'viewer');
  editor uuid := (select id from v2_ids where name = 'editor');
  ex text;
  previous boolean;
  audit record;
  revoked integer;
begin
  select id, is_active into ex, previous from public.exercise_library order by id limit 1;
  begin perform public.fitx_admin_op_set_exercise_active(viewer, ex, not previous); raise exception 'a viewer changed an exercise';
  exception when insufficient_privilege then null; end;
  perform public.fitx_admin_op_set_exercise_active(editor, ex, not previous);
  select * into audit from public.fitx_admin_audit_logs where action = 'exercise_visibility_updated' order by id desc limit 1;
  if audit.actor_operator_id <> editor or audit.actor_username <> 'editor_one' or audit.actor_id is not null
     or audit.details -> 'after' ->> 'is_active' <> (not previous)::text then
    raise exception 'exercise audit row: %', row_to_json(audit);
  end if;
  perform public.fitx_admin_op_set_exercise_active(editor, ex, previous);

  insert into auth.sessions (id, user_id) values (gen_random_uuid(), '00000000-0000-4000-8000-0000000002c1'), (gen_random_uuid(), '00000000-0000-4000-8000-0000000002c1');
  begin perform public.fitx_admin_op_revoke_user_sessions(viewer, '00000000-0000-4000-8000-0000000002c1', 'test'); raise exception 'a viewer signed someone out';
  exception when insufficient_privilege then null; end;
  revoked := public.fitx_admin_op_revoke_user_sessions(agent, '00000000-0000-4000-8000-0000000002c1', 'Lost phone');
  if revoked <> 2 or exists (select 1 from auth.sessions where user_id = '00000000-0000-4000-8000-0000000002c1') then raise exception 'sign out everywhere: %', revoked; end if;
  begin perform public.fitx_admin_op_revoke_user_sessions(agent, gen_random_uuid(), 'x'); raise exception 'an unknown account was accepted';
  exception when no_data_found then null; end;
  if (select actor_username from public.fitx_admin_audit_logs where action = 'user_sessions_revoked' order by id desc limit 1) <> 'agent.one' then raise exception 'revoke audit'; end if;
end $$;
\echo ok exercise visibility and sign-out-everywhere for operators, role-checked and audited

do $$
declare
  agent uuid := (select id from v2_ids where name = 'agent');
  viewer uuid := (select id from v2_ids where name = 'viewer');
  editor uuid := (select id from v2_ids where name = 'editor');
  request uuid;
  seen timestamptz;
  reply uuid;
  msg record;
begin
  insert into public.support_requests (user_id, category, subject, body, assigned_to)
  values ('00000000-0000-4000-8000-0000000002c1', 'question', 'Operator queue', 'A question for the operators', '00000000-0000-4000-8000-0000000002c1')
  returning id, updated_at into request, seen;
  begin perform public.fitx_admin_op_support_update(agent, request, 'in_progress', 'high', editor, seen); raise exception 'an editor without support access was assigned';
  exception when sqlstate '22023' then null; end;
  perform public.fitx_admin_op_support_update(agent, request, 'in_progress', 'high', agent, seen);
  if not exists (select 1 from public.support_requests where id = request and assigned_operator_id = agent and assigned_to is null and status = 'in_progress') then raise exception 'support update'; end if;
  begin perform public.fitx_admin_op_support_update(agent, request, 'resolved', 'high', agent, seen - interval '1 second'); raise exception 'a stale save went through';
  exception when serialization_failure then null; end;
  begin perform public.fitx_admin_op_support_reply(viewer, request, 'Hello', 'waiting_on_user'); raise exception 'a viewer replied';
  exception when insufficient_privilege then null; end;
  reply := public.fitx_admin_op_support_reply(agent, request, '  Thanks, looking now.  ', 'waiting_on_user');
  select * into msg from public.support_messages where id = reply;
  if msg.author_operator_id <> agent or msg.author_id is not null or msg.author_kind <> 'staff' or msg.body <> 'Thanks, looking now.' then raise exception 'staff reply row'; end if;
  if exists (select 1 from public.fitx_admin_audit_logs where details::text like '%looking now%') then raise exception 'reply text reached the audit log'; end if;
  if (select details ->> 'characters' from public.fitx_admin_audit_logs where action = 'support_reply_sent' order by id desc limit 1) <> '20' then raise exception 'reply length audited'; end if;
end $$;
\echo ok support updates and replies by operators; assignees need support access; no message text audited

do $$
declare
  editor uuid := (select id from v2_ids where name = 'editor');
  viewer uuid := (select id from v2_ids where name = 'viewer');
  saved uuid;
begin
  begin perform public.fitx_admin_op_save_announcement(viewer, null, 'Title here', 'Body text', 'info', null, null, null, null, false); raise exception 'a viewer wrote an announcement';
  exception when insufficient_privilege then null; end;
  saved := public.fitx_admin_op_save_announcement(editor, null, ' Gym closed ', 'Body for members', 'info', null, null, null, null, false);
  if not exists (select 1 from public.announcements where id = saved and created_by_operator_id = editor and updated_by_operator_id = editor and created_by is null and status = 'draft' and title = 'Gym closed') then
    raise exception 'announcement row';
  end if;
  perform public.fitx_admin_op_set_announcement_status(editor, saved, 'published');
  begin perform public.fitx_admin_op_save_announcement(editor, saved, 'Gym closed', 'Changed body', 'info', null, null, null, null, false); raise exception 'a live edit without confirmation';
  exception when sqlstate '55000' then null; end;
  perform public.fitx_admin_op_save_announcement(editor, saved, 'Gym closed', 'Changed body', 'warning', null, null, null, null, true);
  if exists (select 1 from public.fitx_admin_audit_logs where action like 'announcement_%' and actor_operator_id = editor and (details::text like '%Changed body%' or details::text like '%operator_id%')) then
    raise exception 'announcement audit holds only lengths and fingerprints';
  end if;
  if (select count(*) from public.fitx_admin_audit_logs where resource_id = saved::text and actor_operator_id = editor) <> 3 then raise exception 'three announcement audit rows'; end if;
end $$;
\echo ok announcements by operators, live edits need confirmation, audited without the text

do $$
declare
  new_id bigint;
begin
  new_id := public.fitx_admin_op_log_event(null, 'admin_login_failed', 'admin_operator', null, '{"username":"agent.one"}');
  if (select actor_operator_id from public.fitx_admin_audit_logs where fitx_admin_audit_logs.id = new_id) is not null then raise exception 'a refused sign-in has no actor'; end if;
  begin perform public.fitx_admin_op_log_event(null, 'Bad Action', 'admin_session'); raise exception 'a bad action was accepted';
  exception when sqlstate '22023' then null; end;
  begin update public.fitx_admin_audit_logs set actor_username = 'someone' where fitx_admin_audit_logs.id = new_id; raise exception 'an audit row was changed';
  exception when insufficient_privilege then null; end;
end $$;
set role authenticated;
do $$ begin
  perform assigned_operator_id from public.support_requests limit 1;
  raise exception 'members can read the operator assignee column';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform created_by_operator_id from public.announcements limit 1;
  raise exception 'members can read the announcement operator columns';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform 1 from public.admin_operators limit 1;
  raise exception 'members can read operators';
exception when insufficient_privilege then null; end $$;
reset role;
\echo ok the audit log stays append-only; members never see operator columns

\echo ALL ADMIN V2 DATABASE CHECKS PASSED
