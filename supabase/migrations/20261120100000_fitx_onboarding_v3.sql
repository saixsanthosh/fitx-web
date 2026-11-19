-- FITX onboarding v3: the three setup pages (personal details, food and nutrition, workout setup).
-- Values match src/lib/domain/profile-options.ts.
--
-- Additive only, safe to re-run:
--   1. profiles.date_of_birth (a date, from 1900 on). Members may set it on their own row only, like the other
--      profile fields (20261117100000); signed-out visitors get nothing. A trigger keeps profiles.age equal to
--      the age the birth date gives whenever the row is saved with a birth date, so everything that reads age
--      (Home, Nutrition, the AI coach) stays in step. Rows without a birth date keep the age they have;
--   2. user_preferences.primary_goal also accepts maintain_weight;
--   3. new user_preferences columns, null until answered: food_source (home, outside, both) and
--      nutrition_focus (high_protein, balanced, none). Meals a day, training days a week and the vegan and
--      eggetarian diets already exist (20260924170604, 20261118110000), so they are not added again.
-- No existing row changes. The app works before this runs: it detects the missing columns, keeps the age
-- it works out from the birth date in profiles.age, and leaves out the choices that cannot be saved yet.
begin;

-- 1. Date of birth.
alter table public.profiles add column if not exists date_of_birth date;
comment on column public.profiles.date_of_birth is 'Date of birth from onboarding; profiles.age follows it (profiles_age_from_birth_date).';

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_date_of_birth_check') then
    alter table public.profiles add constraint profiles_date_of_birth_check
      check (date_of_birth is null or date_of_birth >= date '1900-01-01');
  end if;
end $$;

grant update (date_of_birth) on table public.profiles to authenticated;

-- Whole years between the birth date and today (the database's date). Not security definer: it only
-- changes the row being written, as whoever writes it.
create or replace function public.fitx_profiles_age_from_birth_date()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.date_of_birth is not null then
    new.age := extract(year from pg_catalog.age(current_date, new.date_of_birth))::integer;
  end if;
  return new;
end $$;

revoke all on function public.fitx_profiles_age_from_birth_date() from public, anon, authenticated;

drop trigger if exists profiles_age_from_birth_date on public.profiles;
create trigger profiles_age_from_birth_date
  before insert or update on public.profiles
  for each row execute function public.fitx_profiles_age_from_birth_date();

-- 2. Goals: the seven from 20261118110000 plus maintain_weight. That check was rebuilt by name there.
do $$
declare existing text;
begin
  for existing in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.user_preferences'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%primary_goal%'
      and pg_get_constraintdef(c.oid) not ilike '%maintain_weight%'
  loop
    execute format('alter table public.user_preferences drop constraint %I', existing);
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.user_preferences'::regclass and conname = 'user_preferences_primary_goal_check') then
    alter table public.user_preferences add constraint user_preferences_primary_goal_check
      check (primary_goal in ('muscle_gain', 'weight_gain', 'fat_loss', 'weight_loss', 'general_fitness', 'strength', 'endurance', 'maintain_weight'));
  end if;
end $$;

-- 3. Food source and nutrition focus. No default, so adding them does not rewrite the table.
alter table public.user_preferences
  add column if not exists food_source text,
  add column if not exists nutrition_focus text;

comment on column public.user_preferences.food_source is 'Where meals mostly come from: home (home-cooked), outside (outside food) or both; null until answered.';
comment on column public.user_preferences.nutrition_focus is 'Nutrition goal: high_protein, balanced or none (no specific preference); null until answered.';

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.user_preferences'::regclass and conname = 'user_preferences_food_source_check') then
    alter table public.user_preferences add constraint user_preferences_food_source_check
      check (food_source is null or food_source in ('home', 'outside', 'both'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.user_preferences'::regclass and conname = 'user_preferences_nutrition_focus_check') then
    alter table public.user_preferences add constraint user_preferences_nutrition_focus_check
      check (nutrition_focus is null or nutrition_focus in ('high_protein', 'balanced', 'none'));
  end if;
end $$;

commit;
