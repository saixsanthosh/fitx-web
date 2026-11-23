-- FITX nutrition v2 (wave 1 of the "next level" job): the Nutrition first-time setup.
--
-- Onboarding no longer asks the food questions (diet, allergies, food rules, dislikes, meals a day, food source,
-- nutrition goal); Nutrition asks them once, on the member's first visit, and saves them to the user_preferences
-- columns that already hold them. This adds only the moment that setup was answered:
--   user_preferences.nutrition_setup_at timestamptz, null until the member finishes (or has finished) the setup.
-- Backfill: the old onboarding required a diet, so every row with diet_type set has answered these questions
-- already and is marked done now; nobody is asked again. Rows without a diet stay null and see the setup.
--
-- Additive and safe to re-run: the column is added only when missing, and the backfill only touches rows still
-- null, so a second run changes nothing. No default, so adding it does not rewrite the table. The existing owner
-- policy (user_preferences_owner) and table grants already cover the new column; nothing else changes.
-- The app works before this runs: it treats a stored diet as "setup done" and saves the answers without the
-- timestamp (src/lib/food/setup.ts).
begin;

alter table public.user_preferences add column if not exists nutrition_setup_at timestamptz;

comment on column public.user_preferences.nutrition_setup_at is
  'When the member finished the Nutrition first-time setup (diet, allergies, food rules, meals, food source, nutrition goal); null until then. Backfilled for rows with diet_type set.';

update public.user_preferences
   set nutrition_setup_at = now()
 where nutrition_setup_at is null
   and diet_type is not null;

commit;
