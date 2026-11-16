\set ON_ERROR_STOP 1
\set QUIET 1
-- Functional checks for the Phase 10 migrations on a throwaway database. Each block raises with a
-- label when an expectation fails.

-- Fixtures ------------------------------------------------------------------------------------
insert into auth.users (id, email, email_confirmed_at, last_sign_in_at, created_at, raw_app_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'owner@example.com', now(), now() - interval '1 hour', now() - interval '40 days', '{"providers":["google"]}'),
  ('00000000-0000-4000-8000-00000000000b', 'agent@example.com', now(), now() - interval '2 days', now() - interval '20 days', '{"providers":["google"]}'),
  ('00000000-0000-4000-8000-00000000000c', 'customer@example.com', now(), now() - interval '3 hours', now() - interval '5 days', '{"providers":["email"]}'),
  ('00000000-0000-4000-8000-00000000000d', 'other@example.com', null, null, now() - interval '1 day', '{"providers":["email"]}'),
  ('00000000-0000-4000-8000-00000000000e', null, null, null, now(), '{}'),
  ('00000000-0000-4000-8000-00000000000f', 'gone@example.com', now(), now(), now(), '{"providers":["email"]}'),
  ('00000000-0000-4000-8000-000000000010', 'temp@example.com', now(), now(), now(), '{"providers":["google"]}');
update auth.users set is_anonymous = true where id = '00000000-0000-4000-8000-00000000000e';
update auth.users set deleted_at = now() where id = '00000000-0000-4000-8000-00000000000f';

-- The README's first super-admin bootstrap, verbatim apart from the email.
do $$
declare
  owner_id uuid;
begin
  select id into strict owner_id from auth.users where lower(email) = lower('OWNER@example.com');
  insert into public.fitx_admin_members (user_id, role, is_active, created_by)
  values (owner_id, 'super_admin', true, owner_id)
  on conflict (user_id) do update set role = 'super_admin', is_active = true, updated_at = now();
  insert into public.fitx_admin_audit_logs (actor_id, action, resource_type, resource_id, details)
  values (owner_id, 'admin_member_bootstrapped', 'admin_member', owner_id::text,
    jsonb_build_object('role', 'super_admin', 'is_active', true));
end;
$$;
\echo ok bootstrap SQL from the README

-- Roles and membership ------------------------------------------------------------------------
do $$ begin
  if not public.fitx_admin_actor_can('00000000-0000-4000-8000-00000000000a', 'access.manage') then raise exception 'owner should manage access'; end if;
  if public.fitx_admin_actor_can('00000000-0000-4000-8000-00000000000b', 'support.view') then raise exception 'non-member must have no permissions'; end if;
  perform public.fitx_admin_set_member('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b', 'support_agent', true);
  if not public.fitx_admin_actor_can('00000000-0000-4000-8000-00000000000b', 'support.reply') then raise exception 'agent should reply'; end if;
  if public.fitx_admin_actor_can('00000000-0000-4000-8000-00000000000b', 'people.suspend') then raise exception 'agent must not suspend'; end if;
end $$;
do $$ begin
  perform public.fitx_admin_set_member('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000c', 'admin', true);
  raise exception 'a support agent granted access';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform public.fitx_admin_set_member('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000c', 'owner', true);
  raise exception 'an unknown role was accepted';
exception when sqlstate '22023' then null; end $$;
do $$ begin
  perform public.fitx_admin_set_member('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000a', 'admin', true);
  raise exception 'the last super-admin was demoted';
exception when check_violation then null; end $$;
do $$ declare n int; e text; begin
  select count(*) into n from public.fitx_admin_find_user_by_email(' Customer@Example.com ');
  if n <> 1 then raise exception 'find by email (any case) found % rows', n; end if;
  select count(*) into n from public.fitx_admin_find_user_by_email('gone@example.com');
  if n <> 0 then raise exception 'a deleted account was found by email'; end if;
  select email into e from public.fitx_admin_list_members() where role = 'support_agent';
  if e <> 'agent@example.com' then raise exception 'member list email was %', e; end if;
  select count(*) into n from public.fitx_admin_user_emails(array['00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000c']::uuid[]);
  if n <> 2 then raise exception 'user_emails returned % rows', n; end if;
end $$;
\echo ok roles, permissions, last super-admin protection, lookups

-- Audit log -----------------------------------------------------------------------------------
do $$ declare d jsonb; begin
  select details into d from public.fitx_admin_audit_logs where action = 'admin_member_updated' order by id desc limit 1;
  if d -> 'after' ->> 'role' <> 'support_agent' or d -> 'before' <> 'null'::jsonb then raise exception 'member audit details were %', d; end if;
end $$;
do $$ begin
  update public.fitx_admin_audit_logs set action = 'tampered';
  raise exception 'the audit log accepted an update (even as owner)';
exception when insufficient_privilege then null; end $$;
do $$ begin
  delete from public.fitx_admin_audit_logs;
  raise exception 'the audit log accepted a delete';
exception when insufficient_privilege then null; end $$;
do $$ begin
  truncate public.fitx_admin_audit_logs;
  raise exception 'the audit log accepted truncate';
exception when insufficient_privilege then null; end $$;
set role service_role;
do $$ begin
  update public.fitx_admin_audit_logs set action = 'tampered';
  raise exception 'service_role could update the audit log';
exception when insufficient_privilege then null; end $$;
reset role;
do $$ declare log_id bigint; actor uuid; begin
  log_id := public.fitx_admin_log_event('00000000-0000-4000-8000-000000000010', 'user_viewed', 'user', 'x', '{"note":"temp"}');
  delete from auth.users where id = '00000000-0000-4000-8000-000000000010';
  select actor_id into actor from public.fitx_admin_audit_logs l where l.id = log_id;
  if actor is not null then raise exception 'deleting the account did not clear actor_id'; end if;
  if (select count(*) from public.fitx_admin_audit_logs l where l.id = log_id) <> 1 then raise exception 'the audit row disappeared'; end if;
end $$;
do $$ begin perform public.fitx_admin_log_event(null, 'Bad Action', 'user'); raise exception 'bad action accepted'; exception when sqlstate '22023' then null; end $$;
do $$ begin perform public.fitx_admin_log_event(null, 'user_viewed', 'user', null, '[1,2]'); raise exception 'array details accepted'; exception when sqlstate '22023' then null; end $$;
do $$ begin perform public.fitx_admin_log_event(null, 'user_viewed', 'user', null, jsonb_build_object('x', repeat('y', 5000))); raise exception 'huge details accepted'; exception when sqlstate '22023' then null; end $$;
do $$ declare log_id bigint; begin
  log_id := public.fitx_admin_log_event('00000000-0000-4000-8000-0000000000ff', 'user_viewed', 'user');
  if (select actor_id from public.fitx_admin_audit_logs l where l.id = log_id) is not null then raise exception 'unknown actor stored'; end if;
end $$;
\echo ok audit log is append-only, account deletion still works, log_event validates input

-- Metrics -------------------------------------------------------------------------------------
insert into public.meals (user_id, meal, food_name, created_at) values
  ('00000000-0000-4000-8000-00000000000c', 'Lunch', 'Idli', now() - interval '1 minute'),
  ('00000000-0000-4000-8000-00000000000a', 'Lunch', 'Admin lunch', now());
insert into public.workout_sessions (user_id, name, status, started_at, created_at) values
  ('00000000-0000-4000-8000-00000000000c', 'Push', 'completed', now() - interval '3 days', now() - interval '3 days');
do $$ declare m jsonb; begin
  m := public.fitx_admin_metrics();
  if (m ->> 'accounts')::int <> 2 then raise exception 'accounts should exclude admins, anonymous and deleted: %', m; end if;
  if (m ->> 'confirmed_accounts')::int <> 1 then raise exception 'confirmed: %', m; end if;
  if (m ->> 'signed_in_24h')::int <> 1 or (m ->> 'signed_in_30d')::int <> 1 then raise exception 'signed in: %', m; end if;
  if (m ->> 'active_24h')::int <> 1 or (m ->> 'active_7d')::int <> 1 then raise exception 'active (admin activity must not count): %', m; end if;
  if (m ->> 'workouts_completed_7d')::int <> 1 or (m ->> 'meals_logged_7d')::int <> 1 then raise exception 'volume: %', m; end if;
  if (m ->> 'admin_team_accounts')::int <> 2 then raise exception 'admin team: %', m; end if;
  if (m ->> 'published_exercises')::int < 1 then raise exception 'exercises: %', m; end if;
end $$;
do $$ declare n int; today_new int; today_active int; begin
  select count(*) into n from public.fitx_admin_daily_trends(7);
  if n <> 7 then raise exception 'trends returned % days', n; end if;
  select count(*) into n from public.fitx_admin_daily_trends(1000);
  if n <> 180 then raise exception 'trend range is not capped at 180 (got %)', n; end if;
  select active_accounts into today_active from public.fitx_admin_daily_trends(7) order by day desc limit 1;
  if today_active <> 1 then raise exception 'today active = %', today_active; end if;
end $$;
\echo ok metrics follow their definitions and trends are bounded

-- People --------------------------------------------------------------------------------------
do $$ declare n int; total bigint; begin
  select count(*), max(total_count) into n, total from public.fitx_admin_search_users('example.com', 25, 0);
  if total <> 4 then raise exception 'search total should leave out anonymous and deleted accounts: %', total; end if;
  select count(*) into n from public.fitx_admin_search_users('CUSTOMER', 25, 0);
  if n <> 1 then raise exception 'case-insensitive search found %', n; end if;
  select count(*) into n from public.fitx_admin_search_users('00000000-0000-4000-8000-00000000000C', 25, 0);
  if n <> 1 then raise exception 'search by ID found %', n; end if;
  select count(*) into n from public.fitx_admin_search_users('%', 25, 0);
  if n <> 0 then raise exception 'a literal %% matched % rows', n; end if;
  select count(*) into n from public.fitx_admin_search_users(null, 2, 0);
  if n <> 2 then raise exception 'limit ignored: %', n; end if;
  if (select admin_role from public.fitx_admin_search_users('agent@', 5, 0)) <> 'support_agent' then raise exception 'admin role missing'; end if;
end $$;
insert into auth.sessions (user_id) values ('00000000-0000-4000-8000-00000000000c'), ('00000000-0000-4000-8000-00000000000c'), ('00000000-0000-4000-8000-00000000000a');
do $$ declare n int; begin
  n := public.fitx_admin_revoke_user_sessions('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000c', 'lost phone');
  if n <> 2 then raise exception 'revoked % sessions', n; end if;
  if exists (select 1 from auth.sessions where user_id = '00000000-0000-4000-8000-00000000000c') then raise exception 'sessions remain'; end if;
  if (select details ->> 'reason' from public.fitx_admin_audit_logs where action = 'user_sessions_revoked' order by id desc limit 1) <> 'lost phone' then raise exception 'revoke not audited'; end if;
end $$;
do $$ begin perform public.fitx_admin_revoke_user_sessions('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000a', 'x'); raise exception 'an agent signed out a super-admin'; exception when insufficient_privilege then null; end $$;
do $$ begin perform public.fitx_admin_revoke_user_sessions('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000a', 'x'); raise exception 'self revoke allowed'; exception when sqlstate '22023' then null; end $$;
do $$ begin perform public.fitx_admin_revoke_user_sessions('00000000-0000-4000-8000-00000000000d', '00000000-0000-4000-8000-00000000000c', 'x'); raise exception 'a non-member revoked sessions'; exception when insufficient_privilege then null; end $$;
\echo ok people search and sign-out-everywhere with role checks

-- Support (customer side through RLS) ------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000c', false) \gset ignored_
do $$ declare first_id uuid; begin
  first_id := public.fitx_submit_support_request('problem', 'Timer stops', 'It stops after a minute every time.', '/workouts');
  perform public.fitx_submit_support_request('question', 'Second one', 'Another question for the team.');
  perform public.fitx_submit_support_request('feedback', 'Third one', 'Some feedback for the team here.');
  perform set_config('fitx.first_request', first_id::text, false);
end $$;
do $$ begin
  perform public.fitx_submit_support_request('other', 'Fourth one', 'This should be rate limited now.');
  raise exception 'the fourth request in an hour was accepted';
exception when sqlstate 'PT429' then null; end $$;
do $$ declare n int; begin
  select count(*) into n from public.support_requests;
  if n <> 3 then raise exception 'customer sees % own requests', n; end if;
end $$;
do $$ begin perform author_id from public.support_messages; raise exception 'customer can read staff author IDs'; exception when insufficient_privilege then null; end $$;
do $$ begin perform assigned_to from public.support_requests; raise exception 'customer can read assignees'; exception when insufficient_privilege then null; end $$;
do $$ begin insert into public.support_requests (user_id, category, subject, body) values (auth.uid(), 'other', 'Direct insert', 'Bypassing the rate limit'); raise exception 'direct insert allowed'; exception when insufficient_privilege then null; end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000d', false) \gset ignored_
do $$ declare n int; begin
  select count(*) into n from public.support_requests;
  if n <> 0 then raise exception 'another account sees % of the customer''s requests', n; end if;
  perform public.fitx_reply_support_request(current_setting('fitx.first_request')::uuid, 'Not mine');
  raise exception 'another account replied to the customer''s request';
exception when sqlstate 'PT404' then null; end $$;
reset role;
\echo ok support requests: rate limit, own rows only, hidden staff columns, no direct writes

-- Support (staff side) -----------------------------------------------------------------------------
do $$ declare rid uuid := current_setting('fitx.first_request')::uuid; s text; d jsonb; begin
  perform public.fitx_admin_support_reply('00000000-0000-4000-8000-00000000000b', rid, 'Thanks, fixed in the next update.', 'waiting_on_user');
  select status into s from public.support_requests where id = rid;
  if s <> 'waiting_on_user' then raise exception 'status after reply = %', s; end if;
  select details into d from public.fitx_admin_audit_logs where action = 'support_reply_sent' order by id desc limit 1;
  if d ? 'body' or (d ->> 'characters')::int <> 33 then raise exception 'reply audit details = %', d; end if;
  perform public.fitx_admin_support_update('00000000-0000-4000-8000-00000000000b', rid, 'in_progress', 'high', '00000000-0000-4000-8000-00000000000b');
  begin
    perform public.fitx_admin_support_update('00000000-0000-4000-8000-00000000000b', rid, 'open', 'normal', '00000000-0000-4000-8000-00000000000c');
    raise exception 'a non-member became the assignee';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.fitx_admin_support_update('00000000-0000-4000-8000-00000000000b', rid, null, 'normal', null);
    raise exception 'a null status was accepted';
  exception when sqlstate '22023' then null; end;
  if (public.fitx_admin_support_counts() ->> 'in_progress')::int <> 1 then raise exception 'counts = %', public.fitx_admin_support_counts(); end if;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000c', false) \gset ignored_
do $$ declare rid uuid := current_setting('fitx.first_request')::uuid; n int; begin
  perform public.fitx_reply_support_request(rid, 'Thank you!');
  select count(*) into n from public.support_messages where request_id = rid;
  if n <> 2 then raise exception 'customer sees % messages', n; end if;
end $$;
reset role;
\echo ok staff replies and updates are audited; assignees must be support members

-- Announcements -------------------------------------------------------------------------------
do $$ declare aid uuid; begin
  begin
    perform public.fitx_admin_save_announcement('00000000-0000-4000-8000-00000000000b', null, 'Nope', 'Agents cannot write', 'info', null, null, null, null);
    raise exception 'a support agent wrote an announcement';
  exception when insufficient_privilege then null; end;
  aid := public.fitx_admin_save_announcement('00000000-0000-4000-8000-00000000000a', null, 'New plans', 'Try the new programmes.', 'success', '/workouts', 'Open workouts', null, null);
  perform set_config('fitx.announcement', aid::text, false);
  begin
    perform public.fitx_admin_save_announcement('00000000-0000-4000-8000-00000000000a', null, 'Bad link', 'x', 'info', '//evil.example', 'Go', null, null);
    raise exception 'a protocol-relative link was accepted';
  exception when check_violation then null; end;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000c', false) \gset ignored_
do $$ begin if (select count(*) from public.announcements) <> 0 then raise exception 'a draft is visible'; end if; end $$;
reset role;
select public.fitx_admin_set_announcement_status('00000000-0000-4000-8000-00000000000a', current_setting('fitx.announcement')::uuid, 'published') \gset ignored_
set role authenticated;
do $$ begin
  if (select count(*) from public.announcements) <> 1 then raise exception 'the published announcement is not visible'; end if;
  insert into public.announcement_dismissals (announcement_id) values (current_setting('fitx.announcement')::uuid);
  begin
    insert into public.announcement_dismissals (announcement_id, user_id) values (current_setting('fitx.announcement')::uuid, '00000000-0000-4000-8000-00000000000d');
    raise exception 'dismissed on behalf of another account';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.announcements set ends_at = now() - interval '1 minute', starts_at = now() - interval '2 days' where id = current_setting('fitx.announcement')::uuid;
set role authenticated;
do $$ begin if (select count(*) from public.announcements) <> 0 then raise exception 'an ended announcement is visible'; end if; end $$;
reset role;
do $$ declare n bigint; a text; begin
  select dismissals into n from public.fitx_admin_announcement_dismissals(array[current_setting('fitx.announcement')::uuid]);
  if n <> 1 then raise exception 'dismissals = %', n; end if;
  select string_agg(action, ',' order by id) into a from public.fitx_admin_audit_logs where resource_type = 'announcement';
  if a <> 'announcement_created,announcement_published' then raise exception 'announcement audit = %', a; end if;
end $$;
set role anon;
do $$ begin perform 1 from public.announcements; raise exception 'anon can read announcements'; exception when insufficient_privilege then null; end $$;
do $$ begin perform public.fitx_submit_support_request('other', 'Anon', 'Anonymous request body'); raise exception 'anon can submit'; exception when insufficient_privilege then null; end $$;
reset role;
\echo ok announcements: drafts hidden, window respected, own dismissals only, audited

-- Function privileges ---------------------------------------------------------------------------
set role authenticated;
do $$ begin perform public.fitx_admin_metrics(); raise exception 'authenticated can read metrics'; exception when insufficient_privilege then null; end $$;
do $$ begin perform public.fitx_admin_log_event(null, 'user_viewed', 'user'); raise exception 'authenticated can write audit rows'; exception when insufficient_privilege then null; end $$;
do $$ begin perform public.fitx_admin_set_member(auth.uid(), auth.uid(), 'super_admin', true); raise exception 'authenticated can call set_member'; exception when insufficient_privilege then null; end $$;
reset role;
set role service_role;
do $$ begin perform public.fitx_admin_metrics(); perform public.fitx_admin_support_counts(); end $$;
reset role;
\echo ok privileged functions are service_role only

-- Content -------------------------------------------------------------------------------------
do $$ declare ex text; d jsonb; begin
  select id into ex from public.exercise_library order by id limit 1;
  perform public.fitx_admin_set_exercise_active('00000000-0000-4000-8000-00000000000a', ex, false);
  select details into d from public.fitx_admin_audit_logs where action = 'exercise_visibility_updated' order by id desc limit 1;
  if d -> 'before' ->> 'is_active' <> 'true' or d -> 'after' ->> 'is_active' <> 'false' then raise exception 'exercise audit = %', d; end if;
  begin
    perform public.fitx_admin_set_exercise_active('00000000-0000-4000-8000-00000000000b', ex, true);
    raise exception 'a support agent changed exercise visibility';
  exception when insufficient_privilege then null; end;
end $$;
\echo ok exercise visibility audited with before and after
\echo ALL PHASE 10 DATABASE CHECKS PASSED
