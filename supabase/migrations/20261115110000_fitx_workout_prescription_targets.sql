-- Optional targets support loaded work and timed movements without changing
-- existing plans, sessions, set records, or their owner-scoped RLS policies.
alter table public.workout_plan_exercises
  add column if not exists target_weight_kg numeric(8,2),
  add column if not exists target_duration_seconds integer;

alter table public.workout_session_exercises
  add column if not exists target_weight_kg numeric(8,2),
  add column if not exists target_duration_seconds integer;

alter table public.workout_sets
  add column if not exists duration_seconds integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'workout_plan_exercises_target_weight_kg_check'
  ) then
    alter table public.workout_plan_exercises
      add constraint workout_plan_exercises_target_weight_kg_check
      check (target_weight_kg is null or target_weight_kg between 0 and 2000);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'workout_plan_exercises_target_duration_seconds_check'
  ) then
    alter table public.workout_plan_exercises
      add constraint workout_plan_exercises_target_duration_seconds_check
      check (target_duration_seconds is null or target_duration_seconds between 1 and 7200);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'workout_session_exercises_target_weight_kg_check'
  ) then
    alter table public.workout_session_exercises
      add constraint workout_session_exercises_target_weight_kg_check
      check (target_weight_kg is null or target_weight_kg between 0 and 2000);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'workout_session_exercises_target_duration_seconds_check'
  ) then
    alter table public.workout_session_exercises
      add constraint workout_session_exercises_target_duration_seconds_check
      check (target_duration_seconds is null or target_duration_seconds between 1 and 7200);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'workout_sets_duration_seconds_check'
  ) then
    alter table public.workout_sets
      add constraint workout_sets_duration_seconds_check
      check (duration_seconds is null or duration_seconds between 1 and 86400);
  end if;
end $$;

comment on column public.workout_plan_exercises.target_weight_kg is
  'Optional planned working load in kilograms; null means no load target was set.';
comment on column public.workout_plan_exercises.target_duration_seconds is
  'Optional target duration for a timed movement or hold.';
comment on column public.workout_session_exercises.target_weight_kg is
  'Snapshot of the optional planned working load when the session started.';
comment on column public.workout_session_exercises.target_duration_seconds is
  'Snapshot of the optional planned duration when the session started.';
comment on column public.workout_sets.duration_seconds is
  'Observed duration for a timed set, in seconds.';
