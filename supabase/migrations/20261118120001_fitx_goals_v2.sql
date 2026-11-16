-- FITX Phase 3: goals v2. Daily, weekly and long-term goals whose progress comes from what the user
-- already logs (meals, water, workouts, weigh-ins and linked To-Dos), plus manual goals.
--
-- Additive. Existing goals stay manual and long-term with their entries. The manual total is now kept
-- by a trigger instead of a browser read-modify-write, and entries may be negative so a mistake can
-- be corrected. Needs 20261118120000 (planner_events.local_date and goal_id).
begin;

alter table public.goals
  add column if not exists period text not null default 'long_term',
  add column if not exists direction text not null default 'increase',
  add column if not exists baseline_value numeric(12,2),
  add column if not exists completed_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'goals_period_check') then
    alter table public.goals add constraint goals_period_check
      check (period in ('daily', 'weekly', 'long_term'));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'goals_direction_check') then
    alter table public.goals add constraint goals_direction_check
      check (direction in ('increase', 'decrease', 'limit'));
  end if;
  -- NOT VALID: applies to new writes and leaves any unexpected old value in place.
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'goals_metric_check') then
    alter table public.goals add constraint goals_metric_check
      check (metric in ('manual', 'calories_kcal', 'protein_g', 'water_ml', 'workouts_completed', 'body_weight_kg', 'tasks_completed')) not valid;
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'goals_weight_long_term_check') then
    alter table public.goals add constraint goals_weight_long_term_check
      check (metric <> 'body_weight_kg' or period = 'long_term') not valid;
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'goals_baseline_range') then
    alter table public.goals add constraint goals_baseline_range
      check (baseline_value is null or baseline_value >= 0);
  end if;
end $$;

-- Entries may be negative (a correction) but never zero.
do $$
declare c record;
begin
  for c in
    select conname from pg_catalog.pg_constraint
     where conrelid = 'public.goal_progress_entries'::regclass
       and contype = 'c'
       and pg_catalog.pg_get_constraintdef(oid) like '%amount%'
  loop
    execute format('alter table public.goal_progress_entries drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.goal_progress_entries add constraint goal_progress_entries_amount_check check (amount <> 0);

-- Bring existing manual totals in line with their entries once.
update public.goals g
   set current_value = greatest(0, coalesce(g.baseline_value, 0) + coalesce(
         (select sum(e.amount) from public.goal_progress_entries e where e.goal_id = g.id and e.user_id = g.user_id), 0))
 where g.metric = 'manual'
   and g.current_value is distinct from greatest(0, coalesce(g.baseline_value, 0) + coalesce(
         (select sum(e.amount) from public.goal_progress_entries e where e.goal_id = g.id and e.user_id = g.user_id), 0));

-- Keeps a manual goal's lifetime total (baseline + entries) and completed_at in step.
create or replace function public.fitx_goals_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.metric = 'manual' and (
       tg_op = 'INSERT'
       or new.baseline_value is distinct from old.baseline_value
       or new.metric is distinct from old.metric
     ) then
    new.current_value := greatest(0, coalesce(new.baseline_value, 0) + coalesce(
      (select sum(e.amount) from public.goal_progress_entries e where e.goal_id = new.id and e.user_id = new.user_id), 0));
  end if;

  if new.status <> 'completed' then
    new.completed_at := null;
  elsif tg_op = 'INSERT' or old.status <> 'completed' then
    new.completed_at := coalesce(new.completed_at, pg_catalog.now());
  end if;
  return new;
end $$;

drop trigger if exists goals_before_write on public.goals;
create trigger goals_before_write before insert or update on public.goals
  for each row execute function public.fitx_goals_before_write();

drop trigger if exists goals_touch on public.goals;
create trigger goals_touch before update on public.goals
  for each row execute function public.touch_updated_at();

create or replace function public.fitx_goal_entries_sync()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  affected record;
begin
  for affected in
    select distinct x.goal_id, x.user_id
      from (
        select old.goal_id, old.user_id where tg_op in ('UPDATE', 'DELETE')
        union all
        select new.goal_id, new.user_id where tg_op in ('INSERT', 'UPDATE')
      ) x
  loop
    update public.goals g
       set current_value = greatest(0, coalesce(g.baseline_value, 0) + coalesce(
             (select sum(e.amount) from public.goal_progress_entries e where e.goal_id = g.id and e.user_id = g.user_id), 0))
     where g.id = affected.goal_id
       and g.user_id = affected.user_id
       and g.metric = 'manual';
  end loop;
  return null;
end $$;

drop trigger if exists goal_progress_entries_sync on public.goal_progress_entries;
create trigger goal_progress_entries_sync after insert or update or delete on public.goal_progress_entries
  for each row execute function public.fitx_goal_entries_sync();

-- Every goal the caller has (except cancelled ones) with its progress for the period that contains
-- p_local_date: that day (daily), its Monday-to-Sunday week (weekly), or starts_on to the due date or
-- today, whichever is earlier (long_term). Values come from:
--   calories_kcal, protein_g  the meals logged on those days
--   water_ml                  the water logged on those days
--   workouts_completed        completed sessions that started on those days (in the user's time zone)
--   body_weight_kg            the newest weigh-in up to the period end; start_value is the baseline,
--                             else the last weigh-in on or before starts_on, else the first after it
--   tasks_completed           completed To-Dos linked to the goal (on those days; any day for long_term)
--   manual                    entries logged on those days (long_term: baseline plus every entry)
-- current_value is null when there is nothing to measure yet (no weigh-in). Security invoker, so RLS
-- applies; every source is also filtered to the caller.
create or replace function public.fitx_goal_progress(p_local_date date, p_tz text default null)
returns table (
  id uuid,
  title text,
  category text,
  metric text,
  period text,
  direction text,
  target_value numeric,
  baseline_value numeric,
  unit text,
  starts_on date,
  due_on date,
  status text,
  notes text,
  created_at timestamptz,
  updated_at timestamptz,
  completed_at timestamptz,
  period_start date,
  period_end date,
  current_value numeric,
  value_as_of date,
  start_value numeric,
  linked_todos integer,
  linked_todos_done integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := (select auth.uid());
  tz text;
  week_start date;
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_local_date is null then
    raise exception using errcode = '22004', message = 'p_local_date is required';
  end if;
  tz := public.fitx_user_timezone(p_tz);
  week_start := p_local_date - (extract(isodow from p_local_date)::integer - 1);

  return query
  with g as (
    select gl.*,
           case gl.period when 'daily' then p_local_date when 'weekly' then week_start else gl.starts_on end as win_start,
           case gl.period when 'daily' then p_local_date when 'weekly' then week_start + 6
                else least(coalesce(gl.due_on, p_local_date), p_local_date) end as win_end
      from public.goals gl
     where gl.user_id = uid
       and gl.status <> 'cancelled'
  )
  select
    g.id, g.title, g.category, g.metric, g.period, g.direction, g.target_value, g.baseline_value, g.unit,
    g.starts_on, g.due_on, g.status, g.notes, g.created_at, g.updated_at, g.completed_at,
    g.win_start, g.win_end,
    case g.metric
      when 'calories_kcal' then (
        select coalesce(sum(m.calories), 0)::numeric from public.meals m
         where m.user_id = uid and m.date between g.win_start and g.win_end)
      when 'protein_g' then (
        select coalesce(sum(m.protein), 0)::numeric from public.meals m
         where m.user_id = uid and m.date between g.win_start and g.win_end)
      when 'water_ml' then (
        select coalesce(sum(w.amount_ml), 0)::numeric from public.water_logs w
         where w.user_id = uid and w.local_date between g.win_start and g.win_end)
      when 'workouts_completed' then (
        select count(*)::numeric from public.workout_sessions s
         where s.user_id = uid and s.status = 'completed'
           and s.started_at >= (g.win_start::timestamp at time zone tz)
           and s.started_at < ((g.win_end + 1)::timestamp at time zone tz))
      when 'body_weight_kg' then latest.weight
      when 'tasks_completed' then todos.done::numeric
      else (
        (case when g.period = 'long_term' then coalesce(g.baseline_value, 0) else 0 end)
        + coalesce((
            select sum(e.amount) from public.goal_progress_entries e
             where e.user_id = uid and e.goal_id = g.id
               and (g.period = 'long_term'
                    or (e.logged_at >= (g.win_start::timestamp at time zone tz)
                        and e.logged_at < ((g.win_end + 1)::timestamp at time zone tz)))), 0))
    end,
    case when g.metric = 'body_weight_kg' then latest.weighed_on end,
    case
      when g.metric = 'body_weight_kg' then coalesce(g.baseline_value, (
        select bm.weight from public.body_metrics bm
         where bm.user_id = uid and bm.weight is not null and bm.date <= g.starts_on
         order by bm.date desc, bm.created_at desc nulls last limit 1), (
        select bm.weight from public.body_metrics bm
         where bm.user_id = uid and bm.weight is not null and bm.date > g.starts_on
         order by bm.date asc, bm.created_at asc nulls last limit 1))
      else g.baseline_value
    end,
    todos.total::integer,
    todos.done::integer
  from g
  left join lateral (
    select bm.weight::numeric as weight, bm.date as weighed_on
      from public.body_metrics bm
     where g.metric = 'body_weight_kg'
       and bm.user_id = uid and bm.weight is not null and bm.date <= g.win_end
     order by bm.date desc, bm.created_at desc nulls last
     limit 1
  ) latest on true
  left join lateral (
    select count(*) filter (where t.status <> 'cancelled') as total,
           count(*) filter (where t.status = 'completed') as done
      from public.planner_events t
     where t.user_id = uid and t.goal_id = g.id
       and (g.period = 'long_term' or t.local_date between g.win_start and g.win_end)
  ) todos on true
  order by g.created_at;
end $$;

revoke all on function public.fitx_goals_before_write() from public, anon, authenticated;
revoke all on function public.fitx_goal_entries_sync() from public, anon, authenticated;
revoke all on function public.fitx_goal_progress(date, text) from public, anon;
grant execute on function public.fitx_goal_progress(date, text) to authenticated;

comment on column public.goals.period is 'daily and weekly goals restart each day / Monday-to-Sunday week; long_term runs from starts_on to due_on.';
comment on column public.goals.direction is 'increase: reach at least the target. decrease: come down to it (body weight). limit: stay at or under it (calories).';
comment on column public.goals.baseline_value is 'Starting point: the weigh-in a weight goal started from, or an opening amount for a manual goal.';
comment on column public.goals.completed_at is 'When the goal was marked complete; kept in step with status by the goals_before_write trigger.';

commit;
