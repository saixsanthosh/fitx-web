-- FITX Admin Phase 10: platform metrics with exact definitions, and daily trends.
--
-- Definitions (the Admin screens repeat them next to every number):
-- * Accounts: Supabase Auth accounts that are not deleted, not anonymous and not Admin team members.
-- * Signed in during a window: the account's most recent fresh sign-in (Auth last_sign_in_at) falls in
--   the window. Token refreshes do not count, so people who stay signed in are undercounted.
-- * Active during a window: the account recorded at least one workout session, workout set, meal,
--   water entry, body measurement, goal progress entry or activity (a walk, run or ride, recorded or
--   imported) in the window (by the row's created_at). Needs 20261118160000 (activities).
--   Signing in alone does not make an account active.
-- * Days are calendar days in India Standard Time (Asia/Kolkata).
-- Both functions return counts only and are executable by service_role only.

create or replace function public.fitx_admin_metrics()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with accounts as (
    select u.id, u.created_at, u.last_sign_in_at, u.email_confirmed_at
    from auth.users u
    where u.deleted_at is null
      and not coalesce(u.is_anonymous, false)
      and not exists (select 1 from public.fitx_admin_members m where m.user_id = u.id)
  ),
  activity as (
    select user_id, created_at from public.workout_sessions where created_at >= now() - interval '30 days'
    union all
    select user_id, created_at from public.workout_sets where created_at >= now() - interval '30 days'
    union all
    select user_id, created_at from public.meals where created_at >= now() - interval '30 days'
    union all
    select user_id, created_at from public.water_logs where created_at >= now() - interval '30 days'
    union all
    select user_id, created_at from public.body_metrics where created_at >= now() - interval '30 days'
    union all
    select user_id, created_at from public.goal_progress_entries where created_at >= now() - interval '30 days'
    union all
    select user_id, created_at from public.activities where created_at >= now() - interval '30 days'
  ),
  last_activity as (
    select a.user_id, max(a.created_at) as at
    from activity a
    join accounts on accounts.id = a.user_id
    group by a.user_id
  )
  select jsonb_build_object(
    'accounts', (select count(*) from accounts),
    'confirmed_accounts', (select count(*) from accounts where email_confirmed_at is not null),
    'new_accounts_7d', (select count(*) from accounts where created_at >= now() - interval '7 days'),
    'new_accounts_30d', (select count(*) from accounts where created_at >= now() - interval '30 days'),
    'signed_in_24h', (select count(*) from accounts where last_sign_in_at >= now() - interval '24 hours'),
    'signed_in_7d', (select count(*) from accounts where last_sign_in_at >= now() - interval '7 days'),
    'signed_in_30d', (select count(*) from accounts where last_sign_in_at >= now() - interval '30 days'),
    'active_24h', (select count(*) from last_activity where at >= now() - interval '24 hours'),
    'active_7d', (select count(*) from last_activity where at >= now() - interval '7 days'),
    'active_30d', (select count(*) from last_activity),
    'workouts_completed_7d', (
      select count(*) from public.workout_sessions s join accounts on accounts.id = s.user_id
      where s.status = 'completed' and s.started_at >= now() - interval '7 days'),
    'workouts_completed_30d', (
      select count(*) from public.workout_sessions s join accounts on accounts.id = s.user_id
      where s.status = 'completed' and s.started_at >= now() - interval '30 days'),
    'meals_logged_7d', (
      select count(*) from public.meals ml join accounts on accounts.id = ml.user_id
      where ml.created_at >= now() - interval '7 days'),
    'meals_logged_30d', (
      select count(*) from public.meals ml join accounts on accounts.id = ml.user_id
      where ml.created_at >= now() - interval '30 days'),
    'published_exercises', (select count(*) from public.exercise_library where is_active),
    'admin_team_accounts', (select count(*) from public.fitx_admin_members),
    'generated_at', now()
  );
$function$;

-- One row per IST calendar day, oldest first, for the last p_days days (7 to 180, default 30).
create or replace function public.fitx_admin_daily_trends(p_days integer default 30)
returns table (
  day date,
  new_accounts integer,
  active_accounts integer,
  workouts_completed integer,
  meals_logged integer
)
language sql
stable
security definer
set search_path = ''
as $function$
  with bounds as (
    select least(greatest(coalesce(p_days, 30), 7), 180) as days,
           (now() at time zone 'Asia/Kolkata')::date as today
  ),
  days as (
    select generate_series(b.today - (b.days - 1), b.today, interval '1 day')::date as day
    from bounds b
  ),
  since as (
    select ((select min(day) from days)::timestamp at time zone 'Asia/Kolkata') as start_at
  ),
  accounts as (
    select u.id, u.created_at
    from auth.users u
    where u.deleted_at is null
      and not coalesce(u.is_anonymous, false)
      and not exists (select 1 from public.fitx_admin_members m where m.user_id = u.id)
  ),
  activity as (
    select user_id, created_at from public.workout_sessions where created_at >= (select start_at from since)
    union all
    select user_id, created_at from public.workout_sets where created_at >= (select start_at from since)
    union all
    select user_id, created_at from public.meals where created_at >= (select start_at from since)
    union all
    select user_id, created_at from public.water_logs where created_at >= (select start_at from since)
    union all
    select user_id, created_at from public.body_metrics where created_at >= (select start_at from since)
    union all
    select user_id, created_at from public.goal_progress_entries where created_at >= (select start_at from since)
    union all
    select user_id, created_at from public.activities where created_at >= (select start_at from since)
  ),
  new_daily as (
    select (a.created_at at time zone 'Asia/Kolkata')::date as day, count(*) as n
    from accounts a
    where a.created_at >= (select start_at from since)
    group by 1
  ),
  active_daily as (
    select (act.created_at at time zone 'Asia/Kolkata')::date as day, count(distinct act.user_id) as n
    from activity act
    join accounts a on a.id = act.user_id
    group by 1
  ),
  workouts_daily as (
    select (s.started_at at time zone 'Asia/Kolkata')::date as day, count(*) as n
    from public.workout_sessions s
    join accounts a on a.id = s.user_id
    where s.status = 'completed' and s.started_at >= (select start_at from since)
    group by 1
  ),
  meals_daily as (
    select (ml.created_at at time zone 'Asia/Kolkata')::date as day, count(*) as n
    from public.meals ml
    join accounts a on a.id = ml.user_id
    where ml.created_at >= (select start_at from since)
    group by 1
  )
  select d.day,
         coalesce(nd.n, 0)::integer,
         coalesce(ad.n, 0)::integer,
         coalesce(wd.n, 0)::integer,
         coalesce(md.n, 0)::integer
  from days d
  left join new_daily nd on nd.day = d.day
  left join active_daily ad on ad.day = d.day
  left join workouts_daily wd on wd.day = d.day
  left join meals_daily md on md.day = d.day
  order by d.day;
$function$;

revoke all on function public.fitx_admin_metrics() from public, anon, authenticated;
revoke all on function public.fitx_admin_daily_trends(integer) from public, anon, authenticated;
grant execute on function public.fitx_admin_metrics() to service_role;
grant execute on function public.fitx_admin_daily_trends(integer) to service_role;
