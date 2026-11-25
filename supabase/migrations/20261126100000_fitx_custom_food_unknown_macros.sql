-- FITX custom foods: protein, carbs and fat may be unknown (release 3; runbook #56). Builds on
-- 20260924170604_fitx_v1_core_product.sql, which made public.custom_foods with protein_per_100g, carbs_per_100g and
-- fat_per_100g as "not null default 0".
--
-- Why: a member who left protein, carbs or fat blank on one of their own foods (the label does not list it, or they
-- do not know it) had it saved as 0 g, and every total then counted that 0 as real (bug 4 of the 2026-11-25 bug
-- hunt). The app now keeps a blank value unknown, as it already does for catalogue foods and logged entries: it shows
-- "unknown", logs the entry's value as NULL and leaves it out of totals. NULL in these columns means "not known".
--
-- What it changes: only the NOT NULL rule of the three columns. Their default (0) and their checks (>= 0, which a NULL
-- passes) stay, so a writer that names no value still stores 0 as before; the app always names all three. No row
-- changes: foods saved with 0 keep 0. What reads the columns already copes with NULL: search_foods (20261118140002)
-- returns them as they are; ai_coach_apply_action (20261118150000) writes them from the coach's payload, which always
-- has numbers (a payload without one would now be stored as unknown instead of failing); Admin's reports only count
-- custom foods; "Download my data" exports them as they are.
--
-- Safe to run again: dropping a NOT NULL that is already gone does nothing, so a second run ends as the first did.
--
-- Undo (blank values become 0 again, which is what they were saved as before this file):
--   begin;
--   update public.custom_foods set protein_per_100g = coalesce(protein_per_100g, 0), carbs_per_100g = coalesce(carbs_per_100g, 0),
--     fat_per_100g = coalesce(fat_per_100g, 0) where protein_per_100g is null or carbs_per_100g is null or fat_per_100g is null;
--   alter table public.custom_foods alter column protein_per_100g set not null, alter column carbs_per_100g set not null,
--     alter column fat_per_100g set not null;
--   commit;

do $do$ begin perform pg_catalog.set_config('lock_timeout', '5s', true); end $do$;

alter table public.custom_foods
  alter column protein_per_100g drop not null,
  alter column carbs_per_100g drop not null,
  alter column fat_per_100g drop not null;

notify pgrst, 'reload schema';
