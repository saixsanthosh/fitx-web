-- FITX "next level" wave 1: the Workouts first-time setup and room for wave-2 demonstration media.
--
-- 1. public.user_preferences
--    workout_setup_at timestamptz  When the member last finished the Workouts first-time setup (null: not yet).
--                                  The setup reuses the existing columns: workout_location, equipment,
--                                  fitness_level, workouts_per_week, limitations, plus user_equipment_profiles.
--    demo_model text               Which demonstration model to show: 'male', 'female', or null (follow
--                                  profiles.gender when that is male or female, otherwise the member picks).
--    Backfill, so nobody who has answered these questions is asked again:
--    - on the run that adds the column (and only then), workout_setup_at = now() for every member who has
--      finished onboarding (profiles.onboarded). Until this release onboarding asked where they train, their
--      experience, days and equipment, and it saved no equipment list for a gym member who kept the full-gym
--      default. The runbook applies this file before the new app (which no longer asks) is deployed, so these
--      are exactly the members who answered. Later runs skip this step, so a member who joins afterwards is
--      still asked once (an Undo followed by a new run after the deploy would count everyone onboarded by then);
--    - on every run, workout_setup_at = now() for members who already have a saved equipment list
--      (any user_equipment_profiles row).
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

-- Members who finished onboarding answered its training questions: counted as set up once, on the run that adds
-- the column (later runs leave it alone, so members who join after the deploy are still asked).
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'user_preferences'
                   and column_name = 'workout_setup_at') then
    alter table public.user_preferences add column workout_setup_at timestamptz;
    update public.user_preferences up
    set workout_setup_at = now()
    where exists (select 1 from public.profiles p where p.id = up.user_id and p.onboarded);
  end if;
end $$;

alter table public.user_preferences add column if not exists demo_model text;

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
