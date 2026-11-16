-- FITX camera form coach: record where a set's reps (or seconds) came from, so workout history can
-- show which sets the on-device camera counted. Only this label is stored: no video, images or body
-- positions ever leave the user's device.
--
-- Additive and safe to re-run. Nullable with no default, so existing rows and older app versions are
-- unaffected; null means the set was logged before this column existed. The existing owner-only RLS
-- policy (workout_sets_owner) and the table-level grants to `authenticated` already cover it.
alter table public.workout_sets
  add column if not exists rep_source text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'workout_sets_rep_source_check'
  ) then
    alter table public.workout_sets
      add constraint workout_sets_rep_source_check
      check (rep_source is null or rep_source in ('manual', 'camera'));
  end if;
end $$;

comment on column public.workout_sets.rep_source is
  'How the reps or seconds were entered: manual (typed) or camera (counted on the device by the form coach and confirmed by the user). Null for sets logged before this column existed.';
