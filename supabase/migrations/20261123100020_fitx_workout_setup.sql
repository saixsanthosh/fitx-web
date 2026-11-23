-- FITX "next level" wave 1: the Workouts first-time setup and room for wave-2 demonstration media.
--
-- 1. public.user_preferences
--    workout_setup_at timestamptz  When the member last finished the Workouts first-time setup (null: not yet).
--                                  The setup reuses the existing columns: workout_location, equipment,
--                                  fitness_level, workouts_per_week, limitations, plus user_equipment_profiles.
--    demo_model text               Which demonstration model to show: 'male', 'female', or null (follow
--                                  profiles.gender when that is male or female, otherwise the member picks).
--    Backfill: workout_setup_at = now() for members who already have a saved equipment list
--    (any user_equipment_profiles row), so nobody who has set up training is asked again.
-- 2. public.exercise_media (wave 2 adds demonstration media for every exercise)
--    model text    'male', 'female', or null when the photo or video is not tied to one model.
--    caption text  A short caption shown with the media (at most 280 characters).
--    The unique key (exercise_id, kind, position) stays: 20261118130020 runs `on conflict` on it. Wave 2 gives
--    male and female variants distinct positions, or replaces the key in its own migration.
--
-- The existing owner policy and table grants on user_preferences cover the new columns; exercise_media keeps
-- its read-only policy. Nothing here creates a table. Additive and safe to run more than once.
--
-- Check (expected: 4):
--   select count(*) from information_schema.columns where table_schema = 'public'
--     and ((table_name = 'user_preferences' and column_name in ('workout_setup_at', 'demo_model'))
--       or (table_name = 'exercise_media' and column_name in ('model', 'caption')));
-- Undo:
--   alter table public.exercise_media drop constraint if exists exercise_media_caption_check,
--     drop constraint if exists exercise_media_model_check, drop column if exists caption, drop column if exists model;
--   alter table public.user_preferences drop constraint if exists user_preferences_demo_model_check,
--     drop column if exists demo_model, drop column if exists workout_setup_at;

alter table public.user_preferences
  add column if not exists workout_setup_at timestamptz,
  add column if not exists demo_model text;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.user_preferences'::regclass and conname = 'user_preferences_demo_model_check') then
    alter table public.user_preferences add constraint user_preferences_demo_model_check
      check (demo_model is null or demo_model in ('male', 'female'));
  end if;
end $$;

comment on column public.user_preferences.workout_setup_at is 'When the member last finished the Workouts first-time setup; null until then.';
comment on column public.user_preferences.demo_model is 'Demonstration model: male or female; null follows profiles.gender (male or female), otherwise the member picks.';

-- Members with a saved equipment list have set up their training already.
update public.user_preferences up
set workout_setup_at = now()
where up.workout_setup_at is null
  and exists (select 1 from public.user_equipment_profiles e where e.user_id = up.user_id);

do $$
begin
  if to_regclass('public.exercise_media') is null then
    return;
  end if;
  alter table public.exercise_media add column if not exists model text;
  alter table public.exercise_media add column if not exists caption text;
  if not exists (select 1 from pg_constraint where conrelid = 'public.exercise_media'::regclass and conname = 'exercise_media_model_check') then
    alter table public.exercise_media add constraint exercise_media_model_check check (model is null or model in ('male', 'female'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.exercise_media'::regclass and conname = 'exercise_media_caption_check') then
    alter table public.exercise_media add constraint exercise_media_caption_check check (caption is null or char_length(caption) <= 280);
  end if;
  comment on column public.exercise_media.model is 'Demonstration model shown: male, female, or null when not tied to one model.';
  comment on column public.exercise_media.caption is 'Short caption shown with the media; at most 280 characters.';
end $$;
