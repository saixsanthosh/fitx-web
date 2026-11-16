-- FITX Phase 3: planner_events becomes the one store for To-Dos and the schedule.
--
-- Additive. Existing events keep their rows, ids, policies and grants. Every row gets the user's
-- calendar day (local_date), so untimed To-Dos (starts_at null) and timed events sit on the same
-- day list. New columns: completed_at (kept in step with status by a trigger), sort_order (the
-- order the user arranged a day in) and goal_id (a To-Do that counts toward a goal). Sessions can
-- point at the planner item they were started from or ticked off (workout_sessions.planner_event_id).
--
-- The app works before this is applied: it detects the missing columns and shows the To-Do list
-- as "not available yet", while the week view keeps reading timed events as before.
begin;

-- A time zone name the server accepts, or 'UTC'. Turns stored timestamps into calendar days.
create or replace function public.fitx_safe_timezone(p_tz text)
returns text
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_tz is null or btrim(p_tz) = '' then
    return 'UTC';
  end if;
  perform pg_catalog.now() at time zone p_tz;
  return p_tz;
exception when others then
  return 'UTC';
end $$;

-- The caller's time zone: the browser's when it sends a valid one, else the saved preference, else UTC.
create or replace function public.fitx_user_timezone(p_tz text default null)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  tz text := public.fitx_safe_timezone(p_tz);
begin
  if tz = 'UTC' and coalesce(btrim(p_tz), '') not in ('UTC', 'Etc/UTC') then
    select public.fitx_safe_timezone(up.timezone) into tz
      from public.user_preferences up
     where up.user_id = (select auth.uid());
  end if;
  return coalesce(tz, 'UTC');
end $$;

alter table public.planner_events
  add column if not exists local_date date,
  add column if not exists completed_at timestamptz,
  add column if not exists sort_order integer not null default 0,
  add column if not exists goal_id uuid;

-- Untimed To-Dos have no start time.
alter table public.planner_events alter column starts_at drop not null;

-- Existing events get the calendar day they were scheduled on, in the user's saved time zone.
update public.planner_events pe
   set local_date = (pe.starts_at at time zone coalesce(
         (select public.fitx_safe_timezone(up.timezone) from public.user_preferences up where up.user_id = pe.user_id),
         'UTC'))::date
 where pe.local_date is null
   and pe.starts_at is not null;

alter table public.planner_events alter column local_date set not null;

-- 'task' joins the existing event types. The old check is found by its definition, since its
-- generated name may differ between databases.
do $$
declare c record;
begin
  for c in
    select conname from pg_catalog.pg_constraint
     where conrelid = 'public.planner_events'::regclass
       and contype = 'c'
       and pg_catalog.pg_get_constraintdef(oid) like '%event_type%'
  loop
    execute format('alter table public.planner_events drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.planner_events add constraint planner_events_event_type_check
  check (event_type in ('task', 'workout', 'meal', 'rest', 'goal', 'other'));

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'planner_events_untimed_end_check') then
    alter table public.planner_events add constraint planner_events_untimed_end_check
      check (starts_at is not null or ends_at is null);
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'planner_events_sort_order_check') then
    alter table public.planner_events add constraint planner_events_sort_order_check
      check (sort_order between 0 and 100000);
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'planner_events_description_length') then
    alter table public.planner_events add constraint planner_events_description_length
      check (description is null or char_length(description) <= 1000) not valid;
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'planner_events_id_user_key') then
    alter table public.planner_events add constraint planner_events_id_user_key unique (id, user_id);
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'planner_events_goal_fk') then
    alter table public.planner_events add constraint planner_events_goal_fk
      foreign key (goal_id, user_id) references public.goals (id, user_id) on delete set null (goal_id);
  end if;
end $$;

create index if not exists planner_events_user_day_idx on public.planner_events (user_id, local_date, sort_order);
create index if not exists planner_events_goal_idx on public.planner_events (goal_id) where goal_id is not null;

-- Fills local_date for timed events written without one (older clients), follows the start time when
-- an older client moves a timed event to another day without sending the day, and keeps completed_at
-- in step with status. The day the client sends otherwise wins: giving an untimed To-Do a time, or
-- changing a time within the same day, never moves it. Runs with the writer's rights (RLS applies).
create or replace function public.fitx_planner_events_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  tz text;
begin
  if new.starts_at is not null and new.local_date is null then
    select public.fitx_safe_timezone(up.timezone) into tz
      from public.user_preferences up
     where up.user_id = new.user_id;
    new.local_date := (new.starts_at at time zone coalesce(tz, 'UTC'))::date;
  elsif tg_op = 'UPDATE'
    and new.starts_at is not null
    and old.starts_at is not null
    and new.starts_at is distinct from old.starts_at
    and new.local_date is not distinct from old.local_date then
    select public.fitx_safe_timezone(up.timezone) into tz
      from public.user_preferences up
     where up.user_id = new.user_id;
    tz := coalesce(tz, 'UTC');
    if (new.starts_at at time zone tz)::date <> (old.starts_at at time zone tz)::date then
      new.local_date := (new.starts_at at time zone tz)::date;
    end if;
  end if;

  if new.status <> 'completed' then
    new.completed_at := null;
  elsif tg_op = 'INSERT' or old.status <> 'completed' then
    new.completed_at := coalesce(new.completed_at, pg_catalog.now());
  end if;
  return new;
end $$;

drop trigger if exists planner_events_defaults on public.planner_events;
create trigger planner_events_defaults before insert or update on public.planner_events
  for each row execute function public.fitx_planner_events_defaults();

drop trigger if exists planner_events_touch on public.planner_events;
create trigger planner_events_touch before update on public.planner_events
  for each row execute function public.touch_updated_at();

-- A session can name the planner item it was started from (fitx_start_workout_session sets it) or, once
-- finished, the item it ticked off.
alter table public.workout_sessions add column if not exists planner_event_id uuid;
do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'workout_sessions_planner_event_fk') then
    alter table public.workout_sessions add constraint workout_sessions_planner_event_fk
      foreign key (planner_event_id, user_id) references public.planner_events (id, user_id) on delete set null (planner_event_id);
  end if;
end $$;
create index if not exists workout_sessions_planner_event_idx on public.workout_sessions (planner_event_id)
  where planner_event_id is not null;

-- Saves the order of one day's To-Dos in a single request: p_ids[1] becomes position 0.
-- Only the caller's rows on that day change.
create or replace function public.fitx_reorder_todo(p_local_date date, p_ids uuid[])
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
  with ordered as (
    select t.id, (t.ord - 1)::integer as position
      from unnest(p_ids) with ordinality as t(id, ord)
     where cardinality(p_ids) <= 500
  ), changed as (
    update public.planner_events pe
       set sort_order = o.position
      from ordered o
     where pe.id = o.id
       and pe.user_id = (select auth.uid())
       and pe.local_date = p_local_date
       and pe.sort_order is distinct from o.position
    returning 1
  )
  select count(*)::integer from changed
$$;

-- Marks the planner item behind a finished workout as done, at most one item per session:
--   1. the item the session was started from (workout_sessions.planner_event_id), and only that one:
--      nothing is ticked when it is no longer scheduled (ticked by hand or cancelled meanwhile);
--   2. otherwise the plan's scheduled workout on the day the session started (nearest start time first);
--   3. otherwise the plan's most recent overdue scheduled workout. A later day's item is never touched.
-- Days are the caller's (p_tz: the browser's time zone, else the saved one, else UTC). A timed item is on
-- the day its start time falls in that zone, as the browser shows it, even when its local_date was worked
-- out in an older saved zone; an untimed To-Do is on its local_date.
-- The item ticked under 2 or 3 is then recorded on the session, so calling this again for the same
-- session ticks nothing more. Returns the completed item's id, or null when there was nothing to complete.
create or replace function public.fitx_complete_workout_event(p_session_id uuid, p_tz text default null)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  s record;
  tz text;
  session_day date;
  target uuid;
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  -- Locked, so two calls for one session cannot each tick an item.
  select ws.id, ws.plan_id, ws.planner_event_id, ws.started_at, ws.status
    into s
    from public.workout_sessions ws
   where ws.id = p_session_id and ws.user_id = uid
     for update;
  if not found or s.status <> 'completed' then
    return null;
  end if;

  if s.planner_event_id is not null then
    update public.planner_events pe
       set status = 'completed'
     where pe.id = s.planner_event_id and pe.user_id = uid and pe.status = 'scheduled';
    if found then
      return s.planner_event_id;
    end if;
    return null;
  end if;
  if s.plan_id is null then
    return null;
  end if;

  tz := public.fitx_user_timezone(p_tz);
  session_day := (s.started_at at time zone tz)::date;
  select pe.id into target
    from public.planner_events pe
   cross join lateral (select coalesce((pe.starts_at at time zone tz)::date, pe.local_date) as item_day) d
   where pe.user_id = uid
     and pe.workout_plan_id = s.plan_id
     and pe.event_type = 'workout'
     and pe.status = 'scheduled'
     and d.item_day <= session_day
   order by (d.item_day = session_day) desc,
            d.item_day desc,
            abs(extract(epoch from (coalesce(pe.starts_at, s.started_at) - s.started_at))) asc,
            pe.sort_order asc
   limit 1;
  if target is null then
    return null;
  end if;

  update public.planner_events pe
     set status = 'completed'
   where pe.id = target and pe.user_id = uid and pe.status = 'scheduled';
  if not found then
    return null;
  end if;
  update public.workout_sessions ws
     set planner_event_id = target
   where ws.id = p_session_id and ws.user_id = uid;
  return target;
end $$;

revoke all on function public.fitx_safe_timezone(text) from public, anon;
revoke all on function public.fitx_user_timezone(text) from public, anon;
revoke all on function public.fitx_planner_events_defaults() from public, anon, authenticated;
revoke all on function public.fitx_reorder_todo(date, uuid[]) from public, anon;
revoke all on function public.fitx_complete_workout_event(uuid, text) from public, anon;
grant execute on function public.fitx_safe_timezone(text) to authenticated;
grant execute on function public.fitx_user_timezone(text) to authenticated;
grant execute on function public.fitx_reorder_todo(date, uuid[]) to authenticated;
grant execute on function public.fitx_complete_workout_event(uuid, text) to authenticated;

comment on column public.planner_events.local_date is
  'The user''s calendar day for this item. Untimed To-Dos have only this; timed events also have starts_at.';
comment on column public.planner_events.completed_at is
  'When the item was marked done; set and cleared with status by the planner_events_defaults trigger. Null for items completed before this column existed.';
comment on column public.planner_events.sort_order is
  'Position within the day as the user arranged it (0 first).';
comment on column public.planner_events.goal_id is
  'Optional goal this To-Do counts toward (goals with metric tasks_completed).';
comment on column public.workout_sessions.planner_event_id is
  'The planner item this session was started from or completed; fitx_complete_workout_event ticks it off when the session finishes, once.';

commit;
