-- Behaviour checks for supabase/migrations/20261118150000_fitx_ai_coach.sql on a throwaway local Postgres.
-- Run with tests/ai/sql/run-local-postgres.sh (never against a real Supabase project).
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
-- two members, one exercise
insert into auth.users (id, email) values ('11111111-1111-4111-8111-111111111111', 'a@example.test'), ('22222222-2222-4222-8222-222222222222', 'b@example.test');
insert into public.user_preferences (user_id, timezone) values ('11111111-1111-4111-8111-111111111111', 'Asia/Kolkata'), ('22222222-2222-4222-8222-222222222222', 'Not/AZone');
insert into public.exercise_library (id, name, primary_muscle, difficulty, movement_pattern) values ('push_up_t', 'Push-Up T', 'chest', 'beginner', 'horizontal_push') on conflict do nothing;

create or replace function pg_temp.check(ok boolean, label text) returns text language plpgsql as $$
begin if not ok then raise exception 'FAIL: %', label; end if; return 'ok: ' || label; end $$;

-- ── anon gets nothing ──
set role anon;
select pg_temp.check(not has_table_privilege('anon', 'public.ai_coach_threads', 'select'), 'anon cannot select threads');
select pg_temp.check(not has_table_privilege('anon', 'public.ai_coach_usage_events', 'insert'), 'anon cannot insert usage');
select pg_temp.check(not has_function_privilege('anon', 'public.ai_coach_take_quota(text)', 'execute'), 'anon cannot take quota');
select pg_temp.check(not has_function_privilege('authenticated', 'public.ai_coach_local_day(uuid)', 'execute'), 'members cannot call the local-day helper');
reset role;
select pg_temp.check(not has_table_privilege('authenticated', 'public.ai_coach_usage_events', 'select'), 'members cannot read usage rows directly');
select pg_temp.check(not has_table_privilege('authenticated', 'public.ai_coach_limits', 'update'), 'members cannot change limits');
select pg_temp.check(not has_column_privilege('authenticated', 'public.ai_coach_actions', 'payload', 'update'), 'members cannot edit a proposal payload');
select pg_temp.check(has_column_privilege('authenticated', 'public.ai_coach_actions', 'status', 'update'), 'members can change proposal status');
select pg_temp.check(not has_table_privilege('authenticated', 'public.ai_coach_messages', 'update'), 'messages are not editable');

-- every coach table has RLS on
select pg_temp.check(bool_and(c.relrowsecurity), 'RLS on all coach tables') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname like 'ai_coach_%' and c.relkind = 'r';
-- every definer function pins search_path to ''
select pg_temp.check(bool_and(p.proconfig @> array['search_path=""']), 'definer functions pin search_path') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'ai_coach_%' and p.prosecdef;

-- ── member A ──
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
insert into public.ai_coach_consents (user_id, share_personal_data) values ('11111111-1111-4111-8111-111111111111', true);
insert into public.ai_coach_threads (id, user_id, title) values ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Plan my meals');
insert into public.ai_coach_messages (id, user_id, thread_id, role, task, content) values ('bbbbbbbb-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-000000000001', 'assistant', 'meal_plan', 'Here is a plan');
insert into public.ai_coach_actions (id, user_id, thread_id, message_id, kind, payload) values
 ('cccccccc-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'food',
  '{"custom_food": {"name": "Idli", "serving_size": "3 pieces (114 g)", "serving_grams": 114, "calories_per_100g": 128, "protein_per_100g": 6.36, "carbs_per_100g": 24.98, "fat_per_100g": 0.35}}'),
 ('cccccccc-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'workout_plan',
  '{"workout": {"title": "Push day", "location": "home", "exercises": [{"exercise_id": "push_up_t", "exercise_name": "Push-Up T", "sets": 3, "reps_min": 8, "reps_max": 12, "rest_seconds": 90}]}}');

-- quota: 30 chats, the 31st is refused, release hands one back
select pg_temp.check((select allowed from public.ai_coach_take_quota('chat')), 'first chat allowed');
select count(*) from (select public.ai_coach_take_quota('chat') from generate_series(1, 29)) s;
select pg_temp.check(not (select allowed from public.ai_coach_take_quota('chat')), '31st chat refused');
select pg_temp.check((select used = 30 and daily_limit = 30 from public.ai_coach_quota_status() where quota_kind = 'chat'), 'status shows 30 of 30');
select pg_temp.check((select resets_at > now() and resets_at <= now() + interval '1 day' from public.ai_coach_quota_status() where quota_kind = 'chat'), 'resets within a day (member timezone)');
do $$ declare e uuid; begin
  select event_id into e from public.ai_coach_take_quota('plan');
  if not public.ai_coach_release_quota(e) then raise exception 'FAIL: release'; end if;
  if public.ai_coach_release_quota(e) then raise exception 'FAIL: double release'; end if;
end $$;
select pg_temp.check((select used = 0 from public.ai_coach_quota_status() where quota_kind = 'plan'), 'released plan request does not count');

-- apply: one custom food, pressing twice returns the same row, nothing logged as a meal
select pg_temp.check((select not already_applied and action_kind = 'food' from public.ai_coach_apply_action('cccccccc-0000-4000-8000-000000000001')), 'apply food creates a row');
select pg_temp.check((select already_applied from public.ai_coach_apply_action('cccccccc-0000-4000-8000-000000000001')), 'second apply is idempotent');
select pg_temp.check((select count(*) = 1 from public.custom_foods where name = 'Idli' and serving_grams = 114), 'exactly one custom food');
select pg_temp.check((select count(*) = 0 from public.meals), 'no meal was logged');
select pg_temp.check((select status = 'applied' and applied_ref is not null from public.ai_coach_actions where id = 'cccccccc-0000-4000-8000-000000000001'), 'action marked applied');
select pg_temp.check((select not already_applied from public.ai_coach_apply_action('cccccccc-0000-4000-8000-000000000002')), 'apply workout creates a draft');
select pg_temp.check((select count(*) = 1 from public.workout_plans where status = 'draft' and title = 'Push day' and workout_location = 'home'), 'one draft plan');
select pg_temp.check((select count(*) = 1 from public.workout_plan_exercises where exercise_id = 'push_up_t'), 'plan has the exercise');
-- deleting the custom food lets the member add it again
delete from public.custom_foods where name = 'Idli';
select pg_temp.check((select not already_applied from public.ai_coach_apply_action('cccccccc-0000-4000-8000-000000000001')), 'apply again after the food was deleted');

-- ── member B sees nothing of A ──
set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
select pg_temp.check((select count(*) = 0 from public.ai_coach_threads), 'B sees no threads of A');
select pg_temp.check((select count(*) = 0 from public.ai_coach_actions), 'B sees no actions of A');
do $$ begin
  perform public.ai_coach_apply_action('cccccccc-0000-4000-8000-000000000001');
  raise exception 'FAIL: B applied A''s action';
exception when sqlstate 'P0002' then null; end $$;
do $$ begin
  insert into public.ai_coach_messages (user_id, thread_id, role, content) values ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-0000-4000-8000-000000000001', 'user', 'hi');
  raise exception 'FAIL: B attached a message to A''s thread';
exception when foreign_key_violation then null; end $$;
do $$ begin
  insert into public.ai_coach_threads (user_id, title) values ('11111111-1111-4111-8111-111111111111', 'spoof');
  raise exception 'FAIL: B wrote a row for A';
exception when insufficient_privilege then null; end $$;
select pg_temp.check((select allowed from public.ai_coach_take_quota('plan')), 'B quota independent (invalid timezone falls back to UTC)');

-- ── delete my data (A) ──
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
select pg_temp.check((select threads_deleted = 1 and consent_withdrawn from public.ai_coach_delete_my_data()), 'delete my coach data');
select pg_temp.check((select count(*) = 0 from public.ai_coach_messages) and (select count(*) = 0 from public.ai_coach_actions), 'messages and actions cascade');
select pg_temp.check((select count(*) = 1 from public.custom_foods), 'added foods stay');
select pg_temp.check((select used = 30 from public.ai_coach_quota_status() where quota_kind = 'chat'), 'today''s limit still holds after delete');
reset role;

-- ── origin column (added later by the nutrition stream) is used automatically ──
alter table public.custom_foods add column origin text not null default 'user';
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
insert into public.ai_coach_threads (id, user_id, title) values ('aaaaaaaa-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 't');
insert into public.ai_coach_messages (id, user_id, thread_id, role, content) values ('bbbbbbbb-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'aaaaaaaa-0000-4000-8000-000000000002', 'assistant', 'x');
insert into public.ai_coach_actions (id, user_id, thread_id, message_id, kind, payload) values ('cccccccc-0000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222', 'aaaaaaaa-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002', 'meal',
  '{"custom_food": {"name": "Breakfast: idli and sambar", "serving_size": "1 meal (362 g)", "serving_grams": 362, "calories_per_100g": 99.3, "protein_per_100g": 5, "carbs_per_100g": 15.9, "fat_per_100g": 1.3}}');
select pg_temp.check((select not already_applied from public.ai_coach_apply_action('cccccccc-0000-4000-8000-000000000003')), 'apply meal');
select pg_temp.check((select origin = 'ai_coach' from public.custom_foods where name like 'Breakfast%'), 'origin set to ai_coach when the column exists');
reset role;
select 'ALL SQL CHECKS PASSED';
