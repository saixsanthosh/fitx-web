-- FITX Phase 3: the Home dashboard. One summary request for today's numbers, and each user's
-- widget arrangement.
--
-- Additive. Needs 20261118120000 (planner_events.local_date). Before this is applied the app adds
-- up today's rows itself and shows the default widget layout without saving changes.
begin;

-- The user's Home widgets in order, with which are shown: {"version": 1, "items": [{"id", "visible"}]}.
-- Null means the default layout. The existing owner policy and grants on user_preferences cover it.
alter table public.user_preferences add column if not exists dashboard_layout jsonb;
do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'user_preferences_dashboard_layout_check') then
    alter table public.user_preferences add constraint user_preferences_dashboard_layout_check
      check (dashboard_layout is null
             or (jsonb_typeof(dashboard_layout) = 'object' and octet_length(dashboard_layout::text) <= 4096));
  end if;
end $$;

comment on column public.user_preferences.dashboard_layout is
  'Home widget order and visibility, written by the dashboard; null means the default layout.';

-- Today's numbers for Home in one request: food and water logged on p_local_date, completed workouts
-- today and this Monday-to-Sunday week (by start time in the user's time zone), the newest weigh-in
-- (and the one before it), the profile and preference inputs for targets, today's planned workouts
-- and the To-Do count. Every sum runs in the database, so there is no row cap. Security invoker:
-- RLS applies, and every source is also filtered to the caller.
create or replace function public.fitx_today_summary(p_local_date date, p_tz text default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  tz text;
  week_start date;
  day_start timestamptz;
  day_end timestamptz;
  week_from timestamptz;
  week_to timestamptz;
  result jsonb;
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_local_date is null then
    raise exception using errcode = '22004', message = 'p_local_date is required';
  end if;
  tz := public.fitx_user_timezone(p_tz);
  week_start := p_local_date - (extract(isodow from p_local_date)::integer - 1);
  day_start := p_local_date::timestamp at time zone tz;
  day_end := (p_local_date + 1)::timestamp at time zone tz;
  week_from := week_start::timestamp at time zone tz;
  week_to := (week_start + 7)::timestamp at time zone tz;

  select jsonb_build_object(
    'local_date', p_local_date,
    'timezone', tz,
    'week_start', week_start,
    'nutrition', (
      select jsonb_build_object(
        'calories', coalesce(sum(m.calories), 0),
        'protein', coalesce(sum(m.protein), 0),
        'carbs', coalesce(sum(m.carbs), 0),
        'fat', coalesce(sum(m.fat), 0),
        'entries', count(*))
        from public.meals m
       where m.user_id = uid and m.date = p_local_date),
    'water', (
      select jsonb_build_object('ml', coalesce(sum(w.amount_ml), 0), 'entries', count(*))
        from public.water_logs w
       where w.user_id = uid and w.local_date = p_local_date),
    'workouts', jsonb_build_object(
      'today', (
        select count(*) from public.workout_sessions s
         where s.user_id = uid and s.status = 'completed' and s.started_at >= day_start and s.started_at < day_end),
      'week', (
        select count(*) from public.workout_sessions s
         where s.user_id = uid and s.status = 'completed' and s.started_at >= week_from and s.started_at < week_to),
      'week_days', (
        select coalesce(jsonb_agg(jsonb_build_object('date', d.day, 'count', d.n) order by d.day), '[]'::jsonb)
          from (
            select (s.started_at at time zone tz)::date as day, count(*) as n
              from public.workout_sessions s
             where s.user_id = uid and s.status = 'completed' and s.started_at >= week_from and s.started_at < week_to
             group by 1
          ) d)),
    'weight', (
      select jsonb_build_object('kg', bm.weight, 'date', bm.date)
        from public.body_metrics bm
       where bm.user_id = uid and bm.weight is not null and bm.date <= p_local_date
       order by bm.date desc, bm.created_at desc nulls last
       limit 1),
    'previous_weight', (
      select jsonb_build_object('kg', bm.weight, 'date', bm.date)
        from public.body_metrics bm
       where bm.user_id = uid and bm.weight is not null and bm.date <= p_local_date
       order by bm.date desc, bm.created_at desc nulls last
       offset 1 limit 1),
    'profile', (
      select jsonb_build_object(
        'name', p.name, 'age', p.age, 'gender', p.gender, 'height', p.height,
        'weight', p.weight, 'target_weight', p.target_weight)
        from public.profiles p
       where p.id = uid),
    'preferences', (
      select jsonb_build_object(
        'workouts_per_week', up.workouts_per_week,
        'daily_water_goal_ml', up.daily_water_goal_ml,
        'activity_level', up.activity_level,
        'primary_goal', up.primary_goal)
        from public.user_preferences up
       where up.user_id = uid),
    'planned_workouts', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', pe.id, 'title', pe.title, 'starts_at', pe.starts_at,
               'status', pe.status, 'workout_plan_id', pe.workout_plan_id)
             order by pe.starts_at nulls first, pe.sort_order), '[]'::jsonb)
        from public.planner_events pe
       where pe.user_id = uid and pe.local_date = p_local_date
         and pe.event_type = 'workout' and pe.status <> 'cancelled'),
    'todo', (
      select jsonb_build_object(
        'total', count(*) filter (where pe.status <> 'cancelled'),
        'completed', count(*) filter (where pe.status = 'completed'))
        from public.planner_events pe
       where pe.user_id = uid and pe.local_date = p_local_date)
  ) into result;
  return result;
end $$;

revoke all on function public.fitx_today_summary(date, text) from public, anon;
grant execute on function public.fitx_today_summary(date, text) to authenticated;

commit;
