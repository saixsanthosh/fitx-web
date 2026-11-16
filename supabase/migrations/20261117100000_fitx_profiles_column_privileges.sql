-- Profiles: each user may read and edit only their own row, and only the columns the app edits.
-- plan, level, xp, streak, best_streak, email, diet_mode, id and created_at become server-owned, so
-- for example `plan` can never be raised from the browser. Rows are still created only by the
-- handle_new_user trigger (security definer) and deleted with the auth user (on delete cascade).
-- Range checks are NOT VALID: they apply to new writes without rejecting any existing row.
begin;

alter table public.profiles add column if not exists intro_completed_at timestamptz;

drop policy if exists profiles_self on public.profiles;
drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated
  using ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

revoke all on table public.profiles from anon;
revoke insert, update, delete, truncate, references, trigger on table public.profiles from authenticated;
grant select on table public.profiles to authenticated;
grant update (name, avatar, gender, age, height, weight, target_weight, experience, workout_mode, goals,
              onboarded, intro_completed_at, updated_at)
  on table public.profiles to authenticated;

alter table public.profiles drop constraint if exists profiles_age_range;
alter table public.profiles add constraint profiles_age_range check (age is null or age between 13 and 100) not valid;
alter table public.profiles drop constraint if exists profiles_height_range;
alter table public.profiles add constraint profiles_height_range check (height is null or height between 90 and 250) not valid;
alter table public.profiles drop constraint if exists profiles_weight_range;
alter table public.profiles add constraint profiles_weight_range check (weight is null or weight between 30 and 500) not valid;
alter table public.profiles drop constraint if exists profiles_target_weight_range;
alter table public.profiles add constraint profiles_target_weight_range check (target_weight is null or target_weight between 30 and 500) not valid;
alter table public.profiles drop constraint if exists profiles_name_length;
alter table public.profiles add constraint profiles_name_length check (name is null or char_length(name) <= 120) not valid;

-- New accounts: no search_path lookups inside a security definer function, and bounded metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name, avatar)
  values (
    new.id,
    new.email,
    left(coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)), 120),
    case when (new.raw_user_meta_data->>'avatar_url') like 'https://%' then left(new.raw_user_meta_data->>'avatar_url', 2048) end
  )
  on conflict (id) do nothing;
  return new;
end $$;

commit;
