-- FITX profile v2: the preferences behind onboarding v2, the rebuilt Profile and the AI coach.
-- Values match src/lib/domain/profile-options.ts.
--
-- Additive only, safe to re-run:
--   1. user_preferences.primary_goal also accepts weight_gain and weight_loss;
--   2. new user_preferences columns: diet type, food rules, cuisines, foods the user doesn't eat, budget
--      level, monthly food budget (INR), injuries/limitations and display units (metric by default).
--      user_preferences keeps its table-level grants and owner-only policy, so authenticated users
--      read and write these columns on their own row only; nothing is granted to anon;
--   3. diet type and food rules are backfilled from the labels the first onboarding stored in
--      dietary_preferences (that column is left as it is);
--   4. fitx_ensure_profile() recreates a missing profile row for the signed-in user, because inserts into
--      profiles are server-only since 20261117100000 (onboarding calls it when no row exists).
-- The app works before this runs: it detects the missing columns, keeps to the original fields and
-- hides the new choices until they exist.
--
-- Rollback (only if nothing has been written to the new columns yet):
--   alter table public.user_preferences drop column diet_type, drop column food_rules, drop column cuisines,
--     drop column food_dislikes, drop column food_budget_level, drop column monthly_food_budget_inr,
--     drop column limitations, drop column height_unit, drop column weight_unit;
--   drop function public.fitx_ensure_profile();
--   (Restoring the five-goal check needs every weight_gain/weight_loss row changed first.)
begin;

-- 1. Goals. The original check was declared inline, so look it up by definition rather than by name.
do $$
declare existing text;
begin
  for existing in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.user_preferences'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%primary_goal%'
  loop
    execute format('alter table public.user_preferences drop constraint %I', existing);
  end loop;
end $$;
alter table public.user_preferences add constraint user_preferences_primary_goal_check
  check (primary_goal in ('muscle_gain', 'weight_gain', 'fat_loss', 'weight_loss', 'general_fitness', 'strength', 'endurance'));

-- 2. New preferences. Constant defaults, so adding them does not rewrite the table.
alter table public.user_preferences
  add column if not exists diet_type text,
  add column if not exists food_rules text[] not null default '{}'::text[],
  add column if not exists cuisines text[] not null default '{}'::text[],
  add column if not exists food_dislikes text[] not null default '{}'::text[],
  add column if not exists food_budget_level text,
  add column if not exists monthly_food_budget_inr integer,
  add column if not exists limitations text[] not null default '{}'::text[],
  add column if not exists height_unit text not null default 'cm',
  add column if not exists weight_unit text not null default 'kg';

comment on column public.user_preferences.diet_type is 'vegetarian, non_vegetarian, both (veg some days), vegan or eggetarian; null until answered.';
comment on column public.user_preferences.food_rules is 'Keys from FOOD_RULE_OPTIONS: halal, jain, no_onion_garlic, no_beef, no_pork, pescatarian, low_carb.';
comment on column public.user_preferences.cuisines is 'Preferred cuisines, keys from CUISINE_OPTIONS.';
comment on column public.user_preferences.food_dislikes is 'Foods the user does not eat, in their own words.';
comment on column public.user_preferences.food_budget_level is 'tight, moderate or flexible; null until answered.';
comment on column public.user_preferences.monthly_food_budget_inr is 'Optional monthly food budget in Indian rupees.';
comment on column public.user_preferences.limitations is 'Injuries or limitations: keys from LIMITATION_OPTIONS plus the user''s own entries.';
comment on column public.user_preferences.height_unit is 'How heights are shown and typed (cm or ft_in); always stored in cm.';
comment on column public.user_preferences.weight_unit is 'How weights are shown and typed (kg or lb); always stored in kg.';

-- Checks on the new columns only (existing rows hold the defaults, so they all pass). Free-text lists
-- are bounded in count and total length; the app trims each entry to 40-60 characters.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.user_preferences'::regclass and conname = 'user_preferences_diet_type_check') then
    alter table public.user_preferences add constraint user_preferences_diet_type_check
      check (diet_type is null or diet_type in ('vegetarian', 'non_vegetarian', 'both', 'vegan', 'eggetarian'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.user_preferences'::regclass and conname = 'user_preferences_food_rules_check') then
    alter table public.user_preferences add constraint user_preferences_food_rules_check
      check (food_rules <@ array['halal', 'jain', 'no_onion_garlic', 'no_beef', 'no_pork', 'pescatarian', 'low_carb']::text[]);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.user_preferences'::regclass and conname = 'user_preferences_cuisines_check') then
    alter table public.user_preferences add constraint user_preferences_cuisines_check
      check (cuisines <@ array['north_indian', 'south_indian', 'east_indian', 'west_indian', 'northeast_indian', 'indo_chinese', 'continental', 'mediterranean', 'middle_eastern', 'east_asian']::text[]);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.user_preferences'::regclass and conname = 'user_preferences_food_dislikes_check') then
    alter table public.user_preferences add constraint user_preferences_food_dislikes_check
      check (cardinality(food_dislikes) <= 30 and char_length(array_to_string(food_dislikes, '')) <= 1500);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.user_preferences'::regclass and conname = 'user_preferences_food_budget_level_check') then
    alter table public.user_preferences add constraint user_preferences_food_budget_level_check
      check (food_budget_level is null or food_budget_level in ('tight', 'moderate', 'flexible'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.user_preferences'::regclass and conname = 'user_preferences_monthly_food_budget_check') then
    alter table public.user_preferences add constraint user_preferences_monthly_food_budget_check
      check (monthly_food_budget_inr is null or monthly_food_budget_inr between 500 and 500000);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.user_preferences'::regclass and conname = 'user_preferences_limitations_check') then
    alter table public.user_preferences add constraint user_preferences_limitations_check
      check (cardinality(limitations) <= 20 and char_length(array_to_string(limitations, '')) <= 1000);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.user_preferences'::regclass and conname = 'user_preferences_height_unit_check') then
    alter table public.user_preferences add constraint user_preferences_height_unit_check
      check (height_unit in ('cm', 'ft_in'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.user_preferences'::regclass and conname = 'user_preferences_weight_unit_check') then
    alter table public.user_preferences add constraint user_preferences_weight_unit_check
      check (weight_unit in ('kg', 'lb'));
  end if;
end $$;

-- 3. Backfill from the labels earlier versions stored in dietary_preferences: the first onboarding's
-- "Vegetarian", "Vegan", "Pescatarian", "Halal" and "Low carb", and the diet labels this version writes
-- there while the migration is pending ("Non-vegetarian", "Both", "Eggetarian"). Only empty new
-- columns are filled; dietary_preferences itself is not changed.
update public.user_preferences
set diet_type = case
    when dietary_preferences && array['Vegan', 'vegan']::text[] then 'vegan'
    when dietary_preferences && array['Eggetarian', 'eggetarian']::text[] then 'eggetarian'
    when dietary_preferences && array['Non-vegetarian', 'non-vegetarian', 'Non vegetarian']::text[] then 'non_vegetarian'
    when dietary_preferences && array['Both', 'both']::text[] then 'both'
    else 'vegetarian'
  end
where diet_type is null
  and dietary_preferences && array['Vegan', 'vegan', 'Vegetarian', 'vegetarian', 'Eggetarian', 'eggetarian',
    'Non-vegetarian', 'non-vegetarian', 'Non vegetarian', 'Both', 'both']::text[];

update public.user_preferences p
set food_rules = coalesce((
    select array_agg(distinct mapped.rule order by mapped.rule)
    from (
      select case lower(item)
          when 'halal' then 'halal'
          when 'pescatarian' then 'pescatarian'
          when 'low carb' then 'low_carb'
        end as rule
      from unnest(p.dietary_preferences) as item
    ) as mapped
    where mapped.rule is not null
  ), '{}'::text[])
where p.food_rules = '{}'::text[]
  and p.dietary_preferences && array['Halal', 'Pescatarian', 'Low carb', 'halal', 'pescatarian', 'low carb']::text[];

-- 4. A missing profile row (deleted by hand, or a failed sign-up trigger) would keep a user in onboarding
-- forever. Same values as handle_new_user; it only ever inserts the caller's own row and never
-- overwrites one.
create or replace function public.fitx_ensure_profile()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  insert into public.profiles (id, email, name, avatar)
  select
    u.id,
    u.email,
    left(coalesce(u.raw_user_meta_data->>'name', u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)), 120),
    case when (u.raw_user_meta_data->>'avatar_url') like 'https://%' then left(u.raw_user_meta_data->>'avatar_url', 2048) end
  from auth.users as u
  where u.id = uid
  on conflict (id) do nothing;
end $$;

revoke all on function public.fitx_ensure_profile() from public, anon;
grant execute on function public.fitx_ensure_profile() to authenticated;

commit;
