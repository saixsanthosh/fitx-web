-- FITX activity tracking: walks, runs and rides recorded with the phone's GPS.
--
-- public.activities             one summary row per finished activity (distance, times, speeds,
--                               estimated calories, splits, interruptions, a simplified route and a
--                               privacy-trimmed route for share images). Kept until the owner deletes it.
-- public.activity_track_chunks  the full-resolution GPS points in compact encoded chunks. Kept for a
--                               limited time: public.fitx_prune_activity_track_chunks() removes the
--                               points of activities that ended more than 90 days ago by default (never
--                               fewer than 7). The next migration schedules it daily with pg_cron.
--
-- Size limits match what the app produces, and each account may add at most 50 activities and
-- 1,000 chunks a day, so one account cannot fill the database. The daily caps raise SQLSTATE 54000
-- (program_limit_exceeded), which the app retries later; data that can never fit raises 23514 or
-- P0001, which it keeps on the device without retrying.
--
-- Both tables are owner-only (row-level security with (select auth.uid())); anon gets nothing.
-- Additive only: no existing table, policy or function is changed.
begin;

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Generated on the device when recording starts, so a retried upload never creates a duplicate.
  client_id uuid not null,
  sport text not null check (sport in ('walk', 'run', 'ride')),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  elapsed_seconds integer not null check (elapsed_seconds between 0 and 172800),
  moving_seconds integer not null check (moving_seconds >= 0),
  paused_seconds integer not null default 0 check (paused_seconds >= 0),
  distance_m numeric(9, 1) not null check (distance_m between 0 and 1000000),
  avg_speed_mps numeric(6, 3) check (avg_speed_mps between 0 and 50),
  max_speed_mps numeric(6, 3) check (max_speed_mps between 0 and 50),
  avg_pace_seconds_per_km integer check (avg_pace_seconds_per_km > 0),
  elevation_gain_m numeric(7, 1) check (elevation_gain_m >= 0),
  -- Null when no body weight was known: calories are never guessed.
  kcal_estimate integer check (kcal_estimate between 0 and 20000),
  kcal_method text check (char_length(kcal_method) <= 300),
  weight_kg_used numeric(5, 1) check (weight_kg_used between 30 and 500),
  gap_count integer not null default 0 check (gap_count >= 0),
  gap_seconds integer not null default 0 check (gap_seconds >= 0),
  -- [{ index, distance_m, moving_s, elapsed_s }]
  splits jsonb not null default '[]'::jsonb check (jsonb_typeof(splits) = 'array'),
  -- [{ kind: 'hidden' | 'signal' | 'jump', start, end, straight_line_m }]: parts left out, never counted.
  gaps jsonb not null default '[]'::jsonb check (jsonb_typeof(gaps) = 'array'),
  -- [[type, ms after started_at]]: start, pause, resume, hidden, visible, finish.
  timeline jsonb not null default '[]'::jsonb check (jsonb_typeof(timeline) = 'array'),
  -- Encoded polylines (precision 5), one per continuous stretch, separated by a single space.
  route_polyline text check (char_length(route_polyline) <= 100000),
  -- The same route with the area around the start and the finish removed, for share images.
  share_polyline text check (char_length(share_polyline) <= 100000),
  -- [west, south, east, north] of share_polyline: bounds that do not reveal the start or finish.
  share_bbox double precision[] check (share_bbox is null or cardinality(share_bbox) = 4),
  point_count integer not null default 0 check (point_count >= 0),
  -- 48 hours of one fix a second is 192 chunks of 900 fixes.
  chunk_count integer not null default 0 check (chunk_count between 0 and 200),
  engine_version smallint not null default 1 check (engine_version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint activities_time_order check (ended_at >= started_at),
  constraint activities_moving_within_elapsed check (moving_seconds <= elapsed_seconds),
  constraint activities_owner_client_unique unique (user_id, client_id),
  constraint activities_id_owner_unique unique (id, user_id)
);
create index if not exists activities_user_started_idx on public.activities (user_id, started_at desc);
create index if not exists activities_user_created_idx on public.activities (user_id, created_at);
create index if not exists activities_ended_idx on public.activities (ended_at);

comment on table public.activities is
  'One finished walk, run or ride. Summary data, kept until the owner deletes it. Owner-only RLS.';
comment on column public.activities.moving_seconds is
  'Time spent moving while recording: excludes pauses, stops and interruptions without GPS data.';
comment on column public.activities.elapsed_seconds is
  'Wall-clock time from start to finish, including pauses and interruptions.';
comment on column public.activities.kcal_estimate is
  'Estimated calories from MET values (2024 Adult Compendium) x body weight x moving time; null without a weight.';
comment on column public.activities.route_polyline is
  'Simplified route: encoded polylines (precision 5), one per continuous stretch, separated by a space. Gaps are never joined.';
comment on column public.activities.share_polyline is
  'route_polyline with the area around the start and the finish removed; the only route used in share images.';

create table if not exists public.activity_track_chunks (
  activity_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  seq integer not null check (seq between 0 and 199),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  point_count integer not null check (point_count between 1 and 1000),
  -- 1: src/lib/activity/polyline.ts encodeTrackChunk (delta-encoded time, position, accuracy,
  -- altitude and speed per GPS fix).
  encoding smallint not null default 1 check (encoding = 1),
  -- About 20 characters a fix, 900 fixes a chunk; the limit leaves twice that.
  points text not null check (char_length(points) between 1 and 40000),
  created_at timestamptz not null default now(),
  primary key (activity_id, seq),
  constraint activity_track_chunks_time_order check (ended_at >= started_at),
  foreign key (activity_id, user_id) references public.activities (id, user_id) on delete cascade
);
create index if not exists activity_track_chunks_activity_owner_idx on public.activity_track_chunks (activity_id, user_id);
create index if not exists activity_track_chunks_user_created_idx on public.activity_track_chunks (user_id, created_at);

comment on table public.activity_track_chunks is
  'Full-resolution GPS points of an activity in encoded chunks. Removed with the rest of their activity''s points after the retention period (90 days by default, at least 7) by fitx_prune_activity_track_chunks; the activity summary stays.';

alter table public.activities enable row level security;
alter table public.activity_track_chunks enable row level security;

drop policy if exists activities_owner on public.activities;
create policy activities_owner on public.activities for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists activity_track_chunks_owner on public.activity_track_chunks;
create policy activity_track_chunks_owner on public.activity_track_chunks for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on table public.activities, public.activity_track_chunks from public, anon;
grant select, insert, update, delete on table public.activities, public.activity_track_chunks to authenticated;

-- Removes the detailed GPS points of activities that ended more than keep_days ago (never fewer
-- than 7 days), all chunks of an activity together, for every account. Summaries and their
-- simplified routes are not touched. Runs as the caller (no security definer): only the database
-- owner (pg_cron) and service_role may execute it.
create or replace function public.fitx_prune_activity_track_chunks(keep_days integer default 90)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  removed integer;
begin
  delete from public.activity_track_chunks c
  using public.activities a
  where a.id = c.activity_id
    and a.user_id = c.user_id
    and a.ended_at < now() - make_interval(days => greatest(coalesce(keep_days, 90), 7));
  get diagnostics removed = row_count;
  return removed;
end $$;

revoke all on function public.fitx_prune_activity_track_chunks(integer) from public, anon, authenticated;
grant execute on function public.fitx_prune_activity_track_chunks(integer) to service_role;

-- Per-account limits, checked as the inserting user (row-level security applies, so each count
-- sees only that account's rows). Errors use P0001; the app treats them as final, not retryable.
create or replace function public.fitx_activities_daily_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.activities where user_id = new.user_id and created_at > now() - interval '1 day') >= 50 then
    raise exception using errcode = '54000', message = 'activity limit reached: at most 50 activities a day';
  end if;
  return new;
end $$;

create or replace function public.fitx_activity_chunks_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed integer;
begin
  select chunk_count into allowed from public.activities where id = new.activity_id and user_id = new.user_id;
  if allowed is null or new.seq >= allowed then
    raise exception using errcode = 'P0001', message = 'chunk number outside the activity''s chunk_count';
  end if;
  if tg_op = 'INSERT' and (select count(*) from public.activity_track_chunks where user_id = new.user_id and created_at > now() - interval '1 day') >= 1000 then
    raise exception using errcode = '54000', message = 'GPS data limit reached: at most 1000 chunks a day';
  end if;
  return new;
end $$;

revoke all on function public.fitx_activities_daily_limit() from public, anon, authenticated;
revoke all on function public.fitx_activity_chunks_limit() from public, anon, authenticated;

drop trigger if exists fitx_activities_daily_limit on public.activities;
create trigger fitx_activities_daily_limit before insert on public.activities
  for each row execute function public.fitx_activities_daily_limit();
drop trigger if exists fitx_activity_chunks_limit on public.activity_track_chunks;
create trigger fitx_activity_chunks_limit before insert or update on public.activity_track_chunks
  for each row execute function public.fitx_activity_chunks_limit();

commit;
