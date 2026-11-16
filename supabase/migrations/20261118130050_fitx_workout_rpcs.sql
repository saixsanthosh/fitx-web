-- FITX Workouts v2 (6 of 6): save, start and finish a workout atomically.
-- Before this, each was several requests from the browser with client-side rollback, so a dropped
-- connection could leave a plan without exercises or a half-built session. Each function now runs as
-- one transaction. They are SECURITY INVOKER: row level security still applies, and every statement
-- is scoped to auth.uid(). The app falls back to its older multi-request path until this is applied.
-- Needs 20261115110000 (target and duration columns), 20261118120000 (fitx_complete_workout_event, which
-- ticks off the planner item behind a finished workout) and 20261118130030 (programme columns).

-- One workout in progress per user. Older duplicates, if any exist, are closed as abandoned (newest kept).
with ranked as (
  select id, row_number() over (partition by user_id order by started_at desc, created_at desc) as position
  from public.workout_sessions
  where status = 'in_progress'
)
update public.workout_sessions s set status = 'abandoned'
from ranked r
where s.id = r.id and r.position > 1;
create unique index if not exists workout_sessions_one_in_progress on public.workout_sessions (user_id) where status = 'in_progress';

-- Creates or replaces a plan and its exercises in one step. p_plan: {id?, title, split, workout_location,
-- planned_for (YYYY-MM-DD or null), notes, programme_enrolment_id?, programme_day_index?}. p_exercises: an
-- array of {exercise_id, exercise_name, target_sets, reps_min, reps_max, rest_seconds, target_weight_kg,
-- target_duration_seconds}, in order. Planner events stay with the app. Returns the plan id.
create or replace function public.fitx_save_workout_plan(p_plan jsonb, p_exercises jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_plan uuid := nullif(p_plan->>'id', '')::uuid;
  v_planned date := nullif(p_plan->>'planned_for', '')::date;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_exercises is null or jsonb_typeof(p_exercises) <> 'array' or jsonb_array_length(p_exercises) not between 1 and 20 then
    raise exception using errcode = '22023', message = 'a workout needs between 1 and 20 exercises';
  end if;

  if v_plan is null then
    insert into public.workout_plans (user_id, title, split, workout_location, planned_for, status, notes, programme_enrolment_id, programme_day_index)
    values (
      v_user, btrim(p_plan->>'title'), coalesce(nullif(p_plan->>'split', ''), 'custom'), coalesce(nullif(p_plan->>'workout_location', ''), 'gym'),
      v_planned, case when v_planned is null then 'draft' else 'scheduled' end, nullif(btrim(coalesce(p_plan->>'notes', '')), ''),
      nullif(p_plan->>'programme_enrolment_id', '')::uuid, nullif(p_plan->>'programme_day_index', '')::smallint
    )
    returning id into v_plan;
  else
    update public.workout_plans set
      title = btrim(p_plan->>'title'),
      split = coalesce(nullif(p_plan->>'split', ''), split),
      workout_location = coalesce(nullif(p_plan->>'workout_location', ''), workout_location),
      planned_for = v_planned,
      status = case when v_planned is null then 'draft' else 'scheduled' end,
      notes = nullif(btrim(coalesce(p_plan->>'notes', '')), ''),
      updated_at = now()
    where id = v_plan and user_id = v_user;
    if not found then
      raise exception using errcode = 'P0002', message = 'workout plan not found';
    end if;
    delete from public.workout_plan_exercises where plan_id = v_plan and user_id = v_user;
  end if;

  insert into public.workout_plan_exercises (user_id, plan_id, exercise_id, exercise_name, sort_order, target_sets, reps_min, reps_max,
    rest_seconds, target_weight_kg, target_duration_seconds)
  select v_user, v_plan, nullif(item->>'exercise_id', ''), item->>'exercise_name', (ordinal - 1)::smallint,
    (item->>'target_sets')::smallint, (item->>'reps_min')::smallint, (item->>'reps_max')::smallint, (item->>'rest_seconds')::smallint,
    nullif(item->>'target_weight_kg', '')::numeric, nullif(item->>'target_duration_seconds', '')::integer
  from jsonb_array_elements(p_exercises) with ordinality as entries (item, ordinal);

  return v_plan;
end $$;

-- Starts a session from a plan: the session, its exercises and their sets in one step. Returns
-- {session_id, resumed}; resumed is true when a workout was already in progress (its id is returned).
create or replace function public.fitx_start_workout_session(p_plan_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_session uuid;
  v_title text;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  select id into v_session from public.workout_sessions where user_id = v_user and status = 'in_progress' limit 1;
  if v_session is not null then
    return jsonb_build_object('session_id', v_session, 'resumed', true);
  end if;
  select title into v_title from public.workout_plans where id = p_plan_id and user_id = v_user;
  if v_title is null then
    raise exception using errcode = 'P0002', message = 'workout plan not found';
  end if;
  if not exists (select 1 from public.workout_plan_exercises where plan_id = p_plan_id and user_id = v_user) then
    raise exception using errcode = '22023', message = 'this plan has no exercises';
  end if;

  insert into public.workout_sessions (user_id, plan_id, name, status)
  values (v_user, p_plan_id, v_title, 'in_progress')
  returning id into v_session;

  insert into public.workout_session_exercises (user_id, session_id, exercise_id, exercise_name, sort_order, target_sets, reps_min,
    reps_max, rest_seconds, target_weight_kg, target_duration_seconds)
  select v_user, v_session, exercise_id, exercise_name, (row_number() over (order by sort_order) - 1)::smallint, target_sets, reps_min,
    reps_max, rest_seconds, target_weight_kg, target_duration_seconds
  from public.workout_plan_exercises
  where plan_id = p_plan_id and user_id = v_user;

  -- A movement with a target in seconds (a hold, a stretch, cardio) is logged by time: its sets get no
  -- rep target, so no rep count is filled in for it.
  insert into public.workout_sets (user_id, session_exercise_id, set_number, target_reps, weight_kg)
  select v_user, se.id, n::smallint,
    case when se.target_duration_seconds is null then round((se.reps_min + se.reps_max) / 2.0)::smallint end,
    coalesce(se.target_weight_kg, 0)
  from public.workout_session_exercises se
  cross join lateral generate_series(1, se.target_sets) as n
  where se.session_id = v_session and se.user_id = v_user;

  return jsonb_build_object('session_id', v_session, 'resumed', false);
end $$;

-- Finishes a session: totals from the saved sets, personal records, the planner item behind it and the
-- programme's next day, in one step. The planner item is ticked off by fitx_complete_workout_event, the
-- rule the whole app shares: the item the session was started from, else the plan's scheduled workout on
-- the session's day (nearest time first, untimed To-Do workouts included), else its most recent overdue
-- one; never a later day's, and one item at most. p_tz is the browser's time zone, which decides the
-- session's day (else the saved one, else UTC). Returns {duration_seconds, total_volume, sets, records,
-- planner_event_id}, the last null when no item was ticked.
-- An earlier draft took the session's day as two timestamps instead of p_tz; it is removed wherever it
-- was applied, so only this version can be called.
drop function if exists public.fitx_finish_workout_session(uuid, integer, timestamptz, timestamptz);
create or replace function public.fitx_finish_workout_session(p_session_id uuid, p_duration_seconds integer, p_tz text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_plan uuid;
  v_sets integer;
  v_volume numeric(12, 2);
  v_records integer := 0;
  v_event uuid;
  v_enrolment uuid;
  v_day smallint;
  v_day_count integer;
  v_duration integer := greatest(0, coalesce(p_duration_seconds, 0));
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  select plan_id into v_plan
  from public.workout_sessions
  where id = p_session_id and user_id = v_user and status = 'in_progress'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'this session was already closed or does not exist';
  end if;

  select count(*), coalesce(sum(case when coalesce(ws.reps, 0) > 0 then ws.reps * ws.weight_kg else 0 end), 0)
  into v_sets, v_volume
  from public.workout_session_exercises se
  join public.workout_sets ws on ws.session_exercise_id = se.id and ws.user_id = se.user_id
  where se.session_id = p_session_id and se.user_id = v_user and ws.completed_at is not null
    and (coalesce(ws.reps, 0) > 0 or coalesce(ws.duration_seconds, 0) > 0);
  if v_sets = 0 then
    raise exception using errcode = '22023', message = 'complete at least one set before finishing';
  end if;

  update public.workout_sessions
  set status = 'completed', completed_at = now(), duration_seconds = v_duration, total_volume = v_volume
  where id = p_session_id and user_id = v_user;

  with lifts as (
    select se.exercise_id, se.exercise_name, ws.weight_kg, ws.reps,
      round(ws.weight_kg * (1 + least(ws.reps, 12) / 30.0), 1) as e1rm
    from public.workout_session_exercises se
    join public.workout_sets ws on ws.session_exercise_id = se.id and ws.user_id = se.user_id
    where se.session_id = p_session_id and se.user_id = v_user and ws.completed_at is not null and coalesce(ws.reps, 0) > 0
  ),
  heaviest as (
    select distinct on (exercise_name) exercise_name, exercise_id, weight_kg as best_weight, reps as best_weight_reps
    from lifts
    order by exercise_name, weight_kg desc, reps desc
  ),
  strongest as (
    select exercise_name, max(e1rm) as e1rm from lifts group by exercise_name
  ),
  improved as (
    select h.exercise_name, h.exercise_id, h.best_weight, h.best_weight_reps, s.e1rm,
      pr.best_weight_kg as old_weight, pr.best_reps as old_reps, pr.estimated_one_rep_max as old_e1rm
    from heaviest h
    join strongest s using (exercise_name)
    left join public.personal_records pr on pr.user_id = v_user and pr.exercise_name = h.exercise_name
    where pr.id is null or h.best_weight > pr.best_weight_kg or s.e1rm > pr.estimated_one_rep_max
  ),
  written as (
    insert into public.personal_records (user_id, exercise_id, exercise_name, best_weight_kg, best_reps, estimated_one_rep_max, session_id, achieved_at)
    select v_user, i.exercise_id, i.exercise_name, greatest(coalesce(i.old_weight, 0), i.best_weight),
      case when i.old_weight is null or i.best_weight > i.old_weight then least(500, i.best_weight_reps) else i.old_reps end,
      greatest(coalesce(i.old_e1rm, 0), i.e1rm), p_session_id, now()
    from improved i
    on conflict (user_id, exercise_name) do update set
      exercise_id = excluded.exercise_id, best_weight_kg = excluded.best_weight_kg, best_reps = excluded.best_reps,
      estimated_one_rep_max = excluded.estimated_one_rep_max, session_id = excluded.session_id, achieved_at = excluded.achieved_at
    returning 1
  )
  select count(*) into v_records from written;

  -- The session is completed above, which fitx_complete_workout_event requires. It runs in this
  -- transaction with the caller's rights, so it sees that change and only the caller's rows.
  v_event := public.fitx_complete_workout_event(p_session_id, p_tz);

  if v_plan is not null then
    select programme_enrolment_id, programme_day_index into v_enrolment, v_day
    from public.workout_plans where id = v_plan and user_id = v_user;
    if v_enrolment is not null and v_day is not null then
      select count(*) into v_day_count
      from public.training_programme_days d
      join public.programme_enrolments e on e.programme_id = d.programme_id
      where e.id = v_enrolment and e.user_id = v_user;
      update public.programme_enrolments set
        next_day_index = case when v_day_count > 0 then ((v_day + 1) % v_day_count)::smallint else 0 end,
        sessions_completed = sessions_completed + 1,
        last_session_at = now(),
        updated_at = now()
      where id = v_enrolment and user_id = v_user and status = 'active';
    end if;
  end if;

  return jsonb_build_object('duration_seconds', v_duration, 'total_volume', v_volume, 'sets', v_sets, 'records', v_records,
    'planner_event_id', v_event);
end $$;

revoke all on function public.fitx_save_workout_plan(jsonb, jsonb) from public, anon;
revoke all on function public.fitx_start_workout_session(uuid) from public, anon;
revoke all on function public.fitx_finish_workout_session(uuid, integer, text) from public, anon;
grant execute on function public.fitx_save_workout_plan(jsonb, jsonb) to authenticated;
grant execute on function public.fitx_start_workout_session(uuid) to authenticated;
grant execute on function public.fitx_finish_workout_session(uuid, integer, text) to authenticated;
