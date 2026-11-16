-- Smoke test for fitx_save_workout_plan, fitx_start_workout_session and fitx_finish_workout_session as two
-- signed-in test users on the local check database. The ERROR lines it prints are expected refusals.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'a@example.test'), ('22222222-2222-2222-2222-222222222222', 'b@example.test');
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false) \g /dev/null

select public.fitx_save_workout_plan('{"title":"Push day","split":"push_pull_legs","workout_location":"gym","planned_for":"2026-11-16","notes":""}'::jsonb,
  '[{"exercise_id":"bench_press","exercise_name":"Barbell Bench Press","target_sets":3,"reps_min":6,"reps_max":8,"rest_seconds":150,"target_weight_kg":60,"target_duration_seconds":null},
    {"exercise_id":"plank","exercise_name":"Front Plank","target_sets":2,"reps_min":1,"reps_max":1,"rest_seconds":45,"target_weight_kg":null,"target_duration_seconds":40}]'::jsonb) as plan_id \gset
select 'saved' as step, status, (select count(*) from workout_plan_exercises where plan_id = :'plan_id') as exercises from workout_plans where id = :'plan_id';

select public.fitx_save_workout_plan(jsonb_build_object('id', :'plan_id', 'title', 'Push day v2', 'planned_for', '2026-11-16'),
  '[{"exercise_id":"bench_press","exercise_name":"Barbell Bench Press","target_sets":2,"reps_min":6,"reps_max":8,"rest_seconds":150,"target_weight_kg":60},
    {"exercise_id":"plank","exercise_name":"Front Plank","target_sets":1,"reps_min":1,"reps_max":1,"rest_seconds":45,"target_duration_seconds":40}]'::jsonb) = :'plan_id'::uuid as same_id;
select 'updated' as step, title, (select string_agg(exercise_name || ':' || target_sets, ', ' order by sort_order) from workout_plan_exercises where plan_id = :'plan_id') from workout_plans where id = :'plan_id';

insert into planner_events (user_id, title, starts_at, workout_plan_id, status) values
  ('11111111-1111-1111-1111-111111111111', 'Push yesterday', '2026-11-15 18:00+05:30', :'plan_id', 'scheduled'),
  ('11111111-1111-1111-1111-111111111111', 'Push today', '2026-11-16 18:00+05:30', :'plan_id', 'scheduled'),
  ('11111111-1111-1111-1111-111111111111', 'Push tomorrow', '2026-11-17 18:00+05:30', :'plan_id', 'scheduled');

select (public.fitx_start_workout_session(:'plan_id'))->>'session_id' as session_id \gset
-- 09:00 in India on the 16th, so "today" below is the 16th whenever this runs.
update workout_sessions set started_at = '2026-11-16 09:00+05:30' where id = :'session_id';
select 'started' as step, (select count(*) from workout_session_exercises where session_id = :'session_id') as exercises,
  (select count(*) from workout_sets ws join workout_session_exercises se on se.id = ws.session_exercise_id where se.session_id = :'session_id') as sets,
  (select string_agg(target_reps || '@' || weight_kg, ',' order by set_number) from workout_sets ws join workout_session_exercises se on se.id = ws.session_exercise_id where se.session_id = :'session_id' and se.exercise_id = 'bench_press') as bench_sets;
select 'start again' as step, public.fitx_start_workout_session(:'plan_id') ->> 'resumed' as resumed;

\set ON_ERROR_STOP 0
select public.fitx_finish_workout_session(:'session_id', 1800, 'Asia/Kolkata');
\set ON_ERROR_STOP 1
update workout_sets ws set reps = 8, weight_kg = 60, completed_at = now() from workout_session_exercises se where se.id = ws.session_exercise_id and se.session_id = :'session_id' and se.exercise_id = 'bench_press' and ws.set_number = 1;
update workout_sets ws set reps = 6, weight_kg = 70, completed_at = now() from workout_session_exercises se where se.id = ws.session_exercise_id and se.session_id = :'session_id' and se.exercise_id = 'bench_press' and ws.set_number = 2;
update workout_sets ws set duration_seconds = 40, completed_at = now() from workout_session_exercises se where se.id = ws.session_exercise_id and se.session_id = :'session_id' and se.exercise_id = 'plank';
select 'finished' as step, public.fitx_finish_workout_session(:'session_id', 1800, 'Asia/Kolkata') as summary;
select 'session' as step, status, duration_seconds, total_volume from workout_sessions where id = :'session_id';
select 'records' as step, exercise_name, best_weight_kg, best_reps, estimated_one_rep_max from personal_records;
select 'planner' as step, title, status from planner_events order by starts_at;
\set ON_ERROR_STOP 0
select public.fitx_finish_workout_session(:'session_id', 1800, 'Asia/Kolkata');
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false) \g /dev/null
select public.fitx_save_workout_plan(jsonb_build_object('id', :'plan_id', 'title', 'Hijack'), '[{"exercise_id":"plank","exercise_name":"Front Plank","target_sets":1,"reps_min":1,"reps_max":1,"rest_seconds":45}]'::jsonb);
select public.fitx_start_workout_session(:'plan_id');
select 'other user sees plans' as step, count(*) from workout_plans;
\set ON_ERROR_STOP 1
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false) \g /dev/null
insert into programme_enrolments (user_id, programme_id, context, weekdays) values ('11111111-1111-1111-1111-111111111111', 'ppl-3', 'gym', '{1,3,5}') returning id as enrolment_id \gset
select public.fitx_save_workout_plan(jsonb_build_object('title', 'PPL · Legs', 'planned_for', '2026-11-16', 'programme_enrolment_id', :'enrolment_id', 'programme_day_index', 2),
  '[{"exercise_id":"bodyweight_squat","exercise_name":"Bodyweight Squat","target_sets":1,"reps_min":10,"reps_max":12,"rest_seconds":60}]'::jsonb) as legs_plan \gset
select (public.fitx_start_workout_session(:'legs_plan'))->>'session_id' as legs_session \gset
update workout_sets ws set reps = 12, completed_at = now() from workout_session_exercises se where se.id = ws.session_exercise_id and se.session_id = :'legs_session';
select 'programme finish' as step, public.fitx_finish_workout_session(:'legs_session', 900, 'Asia/Kolkata');
select 'enrolment' as step, next_day_index, sessions_completed, last_session_at is not null as touched from programme_enrolments;
