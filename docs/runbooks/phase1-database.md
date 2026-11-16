# Phase 1 database runbook

All Phase 1 changes are additive. Each step is shown to the owner and applied only after the owner's OK
(through the owner's Supabase connector, or pasted into the Supabase SQL editor).

## 1. Read-only inventory (schema facts and counts only, no user data)

```sql
select table_name, column_name
from information_schema.columns
where table_schema = 'public' and (table_name, column_name) in (
  ('workout_sessions','active_duration_seconds'), ('workout_sessions','resumed_at'), ('workout_sessions','paused_at'),
  ('workout_plan_exercises','target_weight_kg'), ('workout_plan_exercises','target_duration_seconds'),
  ('workout_session_exercises','target_weight_kg'), ('workout_session_exercises','target_duration_seconds'),
  ('workout_sets','duration_seconds'), ('profiles','intro_completed_at'))
order by 1, 2;

select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'profiles' and grantee in ('anon','authenticated') order by 1, 2;

select polname, polcmd from pg_policy where polrelid = 'public.profiles'::regclass order by 1;

-- counts only: profile values outside the ranges the app accepts (needed before any future range checks)
select count(*) filter (where age is not null and age not between 13 and 100) as age_out,
       count(*) filter (where height is not null and height not between 90 and 250) as height_out,
       count(*) filter (where weight is not null and weight not between 30 and 500) as weight_out,
       count(*) filter (where target_weight is not null and target_weight not between 30 and 500) as target_out,
       count(*) filter (where char_length(name) > 120) as name_out
from public.profiles;
```

## 2. Workout columns (only if step 1 shows them missing)

Apply `supabase/migrations/20261115100000_fitx_workout_session_pause_timing.sql`, then
`supabase/migrations/20261115110000_fitx_workout_prescription_targets.sql`, then
`notify pgrst, 'reload schema';`. Re-run step 1: all eight workout columns listed.

## 3. Intro flag and profile privileges

Apply `20261117090000_fitx_profiles_intro_flag.sql`, then `20261117100000_fitx_profiles_column_privileges.sql`,
then `notify pgrst, 'reload schema';`.

Verify:

```sql
-- expect: authenticated has SELECT only at table level; anon has nothing
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'profiles' and grantee in ('anon','authenticated');
-- expect exactly: age, avatar, experience, gender, goals, height, intro_completed_at, name, onboarded,
-- target_weight, updated_at, weight, workout_mode
select column_name from information_schema.column_privileges
where table_schema = 'public' and table_name = 'profiles' and grantee = 'authenticated' and privilege_type = 'UPDATE'
order by 1;
```

Rollback (only if something breaks): recreate the previous policy and grants.

```sql
begin;
drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_self on public.profiles for all to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
grant select, insert, update, delete on table public.profiles to authenticated;
commit;
notify pgrst, 'reload schema';
```

## 4. Food search limit

Apply `20261117110000_fitx_food_search_quota.sql`, then `notify pgrst, 'reload schema';`. Until it is applied the
search route skips the limit. Check: `select * from public.fitx_take_food_search_quota();` run as a signed-in user
returns `allowed = true`; as the SQL editor's service role it raises "authentication required".
