-- FITX experience 2.0. Additive user features; existing tables and records remain intact.

alter table public.exercise_library
  add column if not exists aliases text[] not null default '{}'::text[],
  add column if not exists tags text[] not null default '{}'::text[],
  add column if not exists form_cues text[] not null default '{}'::text[],
  add column if not exists common_mistakes text[] not null default '{}'::text[],
  add column if not exists breathing text;

create table if not exists public.exercise_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_id text not null references public.exercise_library(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, exercise_id)
);
alter table public.exercise_favorites enable row level security;
drop policy if exists exercise_favorites_owner on public.exercise_favorites;
create policy exercise_favorites_owner on public.exercise_favorites for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, delete on public.exercise_favorites to authenticated;

alter table public.workout_plan_exercises
  add column if not exists target_weight_kg numeric(8,2),
  add column if not exists target_duration_seconds integer,
  add column if not exists target_distance_meters numeric(10,2);
alter table public.workout_session_exercises
  add column if not exists target_weight_kg numeric(8,2),
  add column if not exists target_duration_seconds integer,
  add column if not exists target_distance_meters numeric(10,2);
alter table public.workout_sets
  add column if not exists duration_seconds integer,
  add column if not exists distance_meters numeric(10,2);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'workout_plan_exercises_targets_nonnegative' and conrelid = 'public.workout_plan_exercises'::regclass) then
    alter table public.workout_plan_exercises add constraint workout_plan_exercises_targets_nonnegative
      check ((target_weight_kg is null or target_weight_kg >= 0) and (target_duration_seconds is null or target_duration_seconds >= 0) and (target_distance_meters is null or target_distance_meters >= 0)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'workout_session_exercises_targets_nonnegative' and conrelid = 'public.workout_session_exercises'::regclass) then
    alter table public.workout_session_exercises add constraint workout_session_exercises_targets_nonnegative
      check ((target_weight_kg is null or target_weight_kg >= 0) and (target_duration_seconds is null or target_duration_seconds >= 0) and (target_distance_meters is null or target_distance_meters >= 0)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'workout_sets_time_distance_nonnegative' and conrelid = 'public.workout_sets'::regclass) then
    alter table public.workout_sets add constraint workout_sets_time_distance_nonnegative
      check ((duration_seconds is null or duration_seconds >= 0) and (distance_meters is null or distance_meters >= 0)) not valid;
  end if;
end $$;
alter table public.workout_sessions
  add column if not exists paused_at timestamptz,
  add column if not exists paused_duration_seconds integer not null default 0,
  add column if not exists rest_timer_ends_at timestamptz;

alter table public.custom_foods
  add column if not exists barcode text,
  add column if not exists additional_nutrients jsonb not null default '{}'::jsonb,
  add column if not exists ingredients text,
  add column if not exists allergens text;
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'custom_foods_barcode_format_check'
      and conrelid = 'public.custom_foods'::regclass
  ) then
    alter table public.custom_foods add constraint custom_foods_barcode_format_check
      check (barcode is null or (length(barcode) in (8, 12, 13, 14) and barcode !~ '[^0-9]'));
  end if;
end $$;
create unique index if not exists custom_foods_user_barcode_unique
  on public.custom_foods (user_id, barcode) where barcode is not null;

create table if not exists public.food_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (char_length(source) between 1 and 80),
  food_id text not null check (char_length(food_id) between 1 and 160),
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, source, food_id)
);
alter table public.food_favorites enable row level security;
drop policy if exists food_favorites_owner on public.food_favorites;
create policy food_favorites_owner on public.food_favorites for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.food_favorites to authenticated;

create table if not exists public.outdoor_activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_idempotency_key uuid not null,
  activity_type text not null check (activity_type in ('walk', 'run', 'cycle')),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  elapsed_seconds integer not null check (elapsed_seconds >= 0),
  moving_seconds integer not null check (moving_seconds >= 0 and moving_seconds <= elapsed_seconds),
  distance_meters numeric(12,2) not null check (distance_meters >= 0),
  average_pace_seconds_per_km integer check (average_pace_seconds_per_km is null or average_pace_seconds_per_km >= 0),
  average_speed_mps numeric(8,3) check (average_speed_mps is null or average_speed_mps >= 0),
  calories_estimate integer check (calories_estimate is null or calories_estimate >= 0),
  elevation_gain_meters numeric(10,2) check (elevation_gain_meters is null or elevation_gain_meters >= 0),
  route_geojson jsonb not null default '{"type":"LineString","coordinates":[]}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, local_idempotency_key),
  unique (id, user_id)
);
create index if not exists outdoor_activities_owner_started_idx
  on public.outdoor_activities (user_id, started_at desc);
alter table public.outdoor_activities enable row level security;
drop policy if exists outdoor_activities_owner on public.outdoor_activities;
create policy outdoor_activities_owner on public.outdoor_activities for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.outdoor_activities to authenticated;

create table if not exists public.activity_shares (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique check (length(token) between 32 and 80),
  visibility text not null default 'private' check (visibility in ('private', 'link_only', 'public')),
  share_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (activity_id, user_id) references public.outdoor_activities(id, user_id) on delete cascade,
  unique (activity_id, user_id)
);
create index if not exists activity_shares_owner_idx on public.activity_shares (user_id, activity_id);
alter table public.activity_shares enable row level security;
drop policy if exists activity_shares_owner on public.activity_shares;
create policy activity_shares_owner on public.activity_shares for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.activity_shares to authenticated;

-- This token-scoped function returns only the share card's allowlisted fields.
-- Raw activities, owners, account data, and share rows are never selectable by anon.
create or replace function public.get_activity_share(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select pg_catalog.jsonb_build_object(
    'activityType', s.share_payload -> 'activityType',
    'distanceMeters', s.share_payload -> 'distanceMeters',
    'elapsedSeconds', s.share_payload -> 'elapsedSeconds',
    'movingSeconds', s.share_payload -> 'movingSeconds',
    'averagePaceSecondsPerKm', s.share_payload -> 'averagePaceSecondsPerKm',
    'averageSpeedMps', s.share_payload -> 'averageSpeedMps',
    'calories', s.share_payload -> 'calories',
    'elevationGainMeters', s.share_payload -> 'elevationGainMeters',
    'coordinates', case
      when pg_catalog.jsonb_typeof(s.share_payload -> 'coordinates') = 'array' then
        case when pg_catalog.jsonb_array_length(s.share_payload -> 'coordinates') <= 5000
          then s.share_payload -> 'coordinates' else '[]'::jsonb end
      else '[]'::jsonb
    end,
    'createdAt', s.created_at
  )
  from public.activity_shares as s
  where s.token = p_token
    and p_token ~ '^[A-Za-z0-9_-]{32,80}$'
    and s.visibility in ('link_only', 'public')
  limit 1;
$$;
revoke all on function public.get_activity_share(text) from public;
grant execute on function public.get_activity_share(text) to anon, authenticated;

create table if not exists public.user_release_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  version text not null check (char_length(version) between 1 and 40),
  read_at timestamptz not null default now(),
  primary key (user_id, version)
);
alter table public.user_release_reads enable row level security;
drop policy if exists user_release_reads_owner on public.user_release_reads;
create policy user_release_reads_owner on public.user_release_reads for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update on public.user_release_reads to authenticated;

