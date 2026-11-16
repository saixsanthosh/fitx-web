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
reset role;
select pg_temp.check(not exists (select 1 from pg_proc where proname = 'ai_coach_local_day'), 'no time-zone helper: the limit is a rolling 24 hours');
select pg_temp.check((select column_default = 'false' from information_schema.columns where table_schema = 'public' and table_name = 'ai_coach_consents' and column_name = 'share_personal_data'), 'data sharing is off unless the member chooses it');
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
  '{"workout": {"title": "Push day", "location": "home", "exercises": [{"exercise_id": "push_up_t", "exercise_name": "Push-Up T", "sets": 3, "reps_min": 8, "reps_max": 12, "rest_seconds": 90, "hold_seconds": 0}, {"exercise_id": "push_up_t", "exercise_name": "Push-Up hold", "sets": 3, "reps_min": 1, "reps_max": 1, "rest_seconds": 45, "hold_seconds": 30}]}}');

-- quota: 30 chats, the 31st is refused, release hands one back
select pg_temp.check((select allowed from public.ai_coach_take_quota('chat')), 'first chat allowed');
select count(*) from (select public.ai_coach_take_quota('chat') from generate_series(1, 29)) s;
select pg_temp.check(not (select allowed from public.ai_coach_take_quota('chat')), '31st chat refused');
select pg_temp.check((select used = 30 and daily_limit = 30 from public.ai_coach_quota_status() where quota_kind = 'chat'), 'status shows 30 of 30');
select pg_temp.check((select resets_at > now() + interval '23 hours' and resets_at <= now() + interval '24 hours' from public.ai_coach_quota_status() where quota_kind = 'chat'), 'the next one is back 24 hours after the oldest counted request');
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
select pg_temp.check((select count(*) = 2 from public.workout_plan_exercises where exercise_id = 'push_up_t'), 'plan has both exercises');
select pg_temp.check((select target_duration_seconds is null from public.workout_plan_exercises where sort_order = 0), 'a rep exercise has no hold time');
select pg_temp.check((select target_duration_seconds = 30 and reps_min = 1 from public.workout_plan_exercises where sort_order = 1), 'a hold keeps its seconds');
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
select pg_temp.check((select allowed from public.ai_coach_take_quota('plan')), 'B''s limit is separate (and no time zone is read)');

-- ── delete my data (A) ──
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
select pg_temp.check((select threads_deleted = 1 and consent_withdrawn from public.ai_coach_delete_my_data()), 'delete my coach data');
select pg_temp.check((select count(*) = 0 from public.ai_coach_messages) and (select count(*) = 0 from public.ai_coach_actions), 'messages and actions cascade');
select pg_temp.check((select count(*) = 1 from public.custom_foods), 'added foods stay');
select pg_temp.check((select used = 30 from public.ai_coach_quota_status() where quota_kind = 'chat'), 'the 24-hour limit still holds after delete');
reset role;

-- ── the limit counts the last 24 hours, whatever the member's time zone says ──
update public.user_preferences set timezone = 'Pacific/Kiritimati' where user_id = '11111111-1111-4111-8111-111111111111';
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
select pg_temp.check((select used = 30 from public.ai_coach_quota_status() where quota_kind = 'chat'), 'changing time zone frees nothing');
select pg_temp.check(not (select allowed from public.ai_coach_take_quota('chat')), 'still refused after changing time zone');
reset role;
update public.ai_coach_usage_events set created_at = now() - interval '25 hours'
where id in (select id from public.ai_coach_usage_events where user_id = '11111111-1111-4111-8111-111111111111' and kind = 'chat' order by created_at limit 5);
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
select pg_temp.check((select used = 25 from public.ai_coach_quota_status() where quota_kind = 'chat'), 'requests older than 24 hours no longer count');
select pg_temp.check((select allowed and used = 26 from public.ai_coach_take_quota('chat')), 'so the member can ask again');
reset role;

-- ── Nutrition v2's custom_foods columns (20261118140001), once applied, are filled automatically ──
\ir ../../../supabase/migrations/20261118140001_fitx_nutrition_user_data.sql
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
insert into public.ai_coach_threads (id, user_id, title) values ('aaaaaaaa-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 't');
insert into public.ai_coach_messages (id, user_id, thread_id, role, content) values ('bbbbbbbb-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'aaaaaaaa-0000-4000-8000-000000000002', 'assistant', 'x');
insert into public.ai_coach_actions (id, user_id, thread_id, message_id, kind, payload) values
 ('cccccccc-0000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222', 'aaaaaaaa-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002', 'meal',
  '{"custom_food": {"name": "Breakfast: idli and sambar", "serving_size": "1 meal (362 g)", "serving_grams": 362, "calories_per_100g": 99.3, "protein_per_100g": 5, "carbs_per_100g": 15.9, "fat_per_100g": 1.3, "value_basis": "recipe_calculated", "image_url": null, "image_attribution": null, "source_ref": null}}'),
 ('cccccccc-0000-4000-8000-000000000004', '22222222-2222-4222-8222-222222222222', 'aaaaaaaa-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002', 'food',
  '{"custom_food": {"name": "Masti Spiced Buttermilk", "brand": "Amul", "serving_size": "200 ml", "serving_grams": 200, "calories_per_100g": 15, "protein_per_100g": 0.8, "carbs_per_100g": 1.6, "fat_per_100g": 0.6, "value_basis": "label", "image_url": "https://images.openfoodfacts.org/images/products/890/126/201/0016/front_en.3.200.jpg", "image_attribution": "Photo: Open Food Facts contributors (CC BY-SA)", "source_ref": "8901262010016"}}'),
 ('cccccccc-0000-4000-8000-000000000005', '22222222-2222-4222-8222-222222222222', 'aaaaaaaa-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002', 'food',
  '{"custom_food": {"name": "Ragi mudde", "serving_size": "1 piece (about 150 g)", "serving_grams": 150, "calories_per_100g": 113, "protein_per_100g": 2.7, "carbs_per_100g": 24, "fat_per_100g": 0.7, "value_basis": "ai_suggested", "image_url": "http://example.test/not-https.jpg", "image_attribution": "x", "source_ref": null}}');
select pg_temp.check((select not already_applied from public.ai_coach_apply_action('cccccccc-0000-4000-8000-000000000003')), 'apply meal');
select pg_temp.check((select origin = 'ai_coach' and value_basis = 'recipe_calculated' from public.custom_foods where name like 'Breakfast%'), 'a meal: origin ai_coach, values FITX added up');
select pg_temp.check((select not already_applied from public.ai_coach_apply_action('cccccccc-0000-4000-8000-000000000004')), 'apply a packaged food');
select pg_temp.check((select origin = 'ai_coach' and value_basis = 'label' and source_ref = '8901262010016' and image_url like 'https://images.openfoodfacts.org/%' and image_attribution like 'Photo: Open Food Facts%'
  from public.custom_foods where name = 'Masti Spiced Buttermilk'), 'a packaged food: label values, its barcode and the licensed photo');
select pg_temp.check((select not already_applied from public.ai_coach_apply_action('cccccccc-0000-4000-8000-000000000005')), 'apply an AI estimate');
select pg_temp.check((select value_basis = 'ai_suggested' and image_url is null and source_ref is null from public.custom_foods where name = 'Ragi mudde'), 'an estimate is marked ai_suggested; a non-https image is not saved');
-- Archiving the food in Nutrition makes the button add it again; pressing again after that is idempotent.
update public.custom_foods set archived_at = now() where name = 'Masti Spiced Buttermilk';
select pg_temp.check((select not already_applied from public.ai_coach_apply_action('cccccccc-0000-4000-8000-000000000004')), 'an archived food is added again');
select pg_temp.check((select already_applied from public.ai_coach_apply_action('cccccccc-0000-4000-8000-000000000004')), 'and pressing again returns the new row');
select pg_temp.check((select count(*) = 2 and count(*) filter (where archived_at is null) = 1 from public.custom_foods where name = 'Masti Spiced Buttermilk'), 'one archived, one active');
reset role;
select 'ALL SQL CHECKS PASSED';
