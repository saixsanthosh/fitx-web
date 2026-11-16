-- Profiles: each user may read and edit only their own row, and only the columns the app edits.
-- plan, level, xp, streak, best_streak, email, diet_mode, id and created_at become server-owned, so
-- for example `plan` can never be raised from the browser. Rows are still created only by the
-- handle_new_user trigger (security definer) and deleted with the auth user (on delete cascade).
-- (Range checks on age, height and weight are deferred: a CHECK applies to the whole row on every
-- update, so one old out-of-range value would block unrelated saves. Count such rows first; see the runbook.)
begin;

-- The grant below names this column, so it is added here too when 20261117090000 has not run. Never a
-- backfill here: only the step that first adds the column in 20261117090000 marks existing accounts as
-- having seen the film, so applying either migration again leaves a null intro_completed_at null.
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
