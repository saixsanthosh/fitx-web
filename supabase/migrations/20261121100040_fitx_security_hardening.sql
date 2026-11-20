-- FITX security hardening (phase 15): the database review's fixes, after 20261121100030 to 20261121100036.
--
-- What it changes, and why:
--   1. Signed-out visitors lose get_activity_share(text), and the API roles lose every right on the four
--      tables experience 2.0 left on production (food_favorites, outdoor_activities, activity_shares,
--      user_release_reads). Nothing in FITX uses them (docs/runbooks/platform-database.md, section 1.8):
--      today anyone with the publishable key can call the function, and any member can store rows there
--      that "Download my data" and the 90-day GPS clean-up never see. The tables and their rows stay.
--   2. workout_sessions leaves the supabase_realtime publication. Nothing subscribes to it, and Realtime
--      sends DELETE events without row level security, so any visitor with the publishable key could
--      watch members' workouts being deleted (their ids and times).
--   3. A member's private photo folder (fitx-user-media/<uid>/) holds at most 1,000 files and 250 MB, and
--      at most 100 of the files in it may be under an hour old. The browser uploads there directly with the
--      member's own key, so without a limit in the database one account could fill the project's storage,
--      which every member shares. Files the member deleted are not counted (storage keeps no record of
--      them), so this limits what is stored, not how often a script can upload and delete.
--   4. Each member may write at most 10,000 rows and 50 MB an hour, and 50,000 rows and 150 MB in 24
--      hours, to the tables members write directly with their own key (counted per statement, inserts and
--      updates). Without it one account could fill the database for everyone with a script. Normal use is
--      far below it (a heavy day is a few thousand rows and a few MB). Writes by the server key, Admin and
--      sign-up are not counted.
--   5. A member can join only a published programme, and can bring back a left or completed enrolment only
--      while its programme is published. The foreign key check ignores row level security, so a member could
--      enrol in a draft programme by its id, or set an old enrolment back to active, and then read its
--      unpublished days.
--
-- Additive and safe to run again: create or replace, guarded blocks, idempotent revoke and grant. It
-- deletes no row and changes no column. The app and Admin work the same before and after it.

-- Wait at most 5 seconds for a table lock (the triggers below), then stop; nothing stays and it can be run
-- again.
do $do$ begin perform pg_catalog.set_config('lock_timeout', '5s', true); end $do$;

-- 1. Experience 2.0's leftovers (production only; a new project has none of them) ------------------------

do $do$
declare
  v_table text;
begin
  -- Only the server key may reach these four tables now. Their rows (none on 2026-11-17) stay.
  foreach v_table in array array['food_favorites', 'outdoor_activities', 'activity_shares', 'user_release_reads'] loop
    if pg_catalog.to_regclass('public.' || v_table) is not null then
      execute pg_catalog.format('revoke all on table public.%I from public, anon, authenticated', v_table);
    end if;
  end loop;
  -- The share function returned a stored route to anyone holding its token; FITX keeps no share links.
  if pg_catalog.to_regprocedure('public.get_activity_share(text)') is not null then
    revoke all on function public.get_activity_share(text) from public, anon, authenticated;
  end if;
end $do$;

-- 2. Realtime: no private table is broadcast ---------------------------------------------------------------

do $do$
begin
  if exists (select 1 from pg_catalog.pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workout_sessions') then
    alter publication supabase_realtime drop table public.workout_sessions;
  end if;
end $do$;

-- 3. Members' photo folder: a storage limit -----------------------------------------------------------------

-- Whether the signed-in member may upload one more file to fitx-user-media: fewer than 1,000 files and
-- 250 MB in their folder, and fewer than 100 of those files added in the last hour. It counts the files
-- that are there now: a file the member deleted no longer counts. The app keeps one profile photo and one
-- photo per own food there, each replacing the last. Runs as its owner so it counts the whole folder.
create or replace function public.fitx_user_media_upload_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  with folder as (
    select o.created_at, o.metadata
    from storage.objects o
    where o.bucket_id = 'fitx-user-media'
      and (select auth.uid()) is not null
      and o.name like (select auth.uid())::text || '/%'
  )
  select (select auth.uid()) is not null
    and (select pg_catalog.count(*) from folder) < 1000
    and (select coalesce(pg_catalog.sum(case when (f.metadata ->> 'size') ~ '^[0-9]{1,15}$' then (f.metadata ->> 'size')::bigint end), 0)
         from folder f) < 250 * 1024 * 1024
    and (select pg_catalog.count(*) from folder f where f.created_at > pg_catalog.now() - interval '1 hour') < 100;
$function$;

revoke all on function public.fitx_user_media_upload_allowed() from public, anon, authenticated;
-- Policies run their functions as the member, so the member needs the right to call it (it only answers
-- yes or no about their own folder).
grant execute on function public.fitx_user_media_upload_allowed() to authenticated, service_role;

-- A restrictive policy: it narrows fitx_media_insert_own (20260924170604) and every other insert policy;
-- other buckets are unaffected, and the server key bypasses it.
drop policy if exists fitx_media_insert_quota on storage.objects;
create policy fitx_media_insert_quota on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'fitx-user-media' or (select public.fitx_user_media_upload_allowed()));

-- 4. Members' direct writes: an hourly and daily budget -----------------------------------------------------

-- Rows and bytes each member wrote, per hour. Read and written only by fitx_member_write_budget(); hours
-- over two days old are deleted by the trigger (below), for every member. Row level security on and no
-- policy: members cannot read or reset their own budget.
create table if not exists public.fitx_member_write_budget (
  user_id uuid not null references auth.users (id) on delete cascade,
  window_start timestamptz not null,
  rows_written bigint not null default 0 check (rows_written >= 0),
  bytes_written bigint not null default 0 check (bytes_written >= 0),
  primary key (user_id, window_start)
);

-- For the clean-up of old hours across every member.
create index if not exists fitx_member_write_budget_window_idx on public.fitx_member_write_budget (window_start);

alter table public.fitx_member_write_budget enable row level security;
revoke all on table public.fitx_member_write_budget from public, anon, authenticated, service_role;
grant select on table public.fitx_member_write_budget to service_role;

comment on table public.fitx_member_write_budget is
  'Rows and bytes each member wrote per hour to the tables members write with their own key; hours over two days old are deleted (20261121100040).';

-- After each insert or update statement by a signed-in member: adds the statement's rows and their size to
-- this hour, and stops the statement (nothing of it stays) past 10,000 rows or 50 MB in the hour, or 50,000
-- rows or 150 MB in the last 24 hours. Statements without a member (the server key, Admin, sign-up) pass.
-- A member's first write of each hour also deletes up to 1,000 hours over two days old, any member's,
-- skipping rows another write holds, so the totals of members who stopped writing go too.
create or replace function public.fitx_member_write_budget()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_window timestamptz := pg_catalog.date_trunc('hour', pg_catalog.now());
  v_rows bigint;
  v_bytes bigint;
  v_hour_rows bigint;
  v_hour_bytes bigint;
  v_day_rows bigint;
  v_day_bytes bigint;
begin
  if v_uid is null then
    return null;
  end if;
  select pg_catalog.count(*), coalesce(pg_catalog.sum(pg_catalog.octet_length(r::text)), 0)
    into v_rows, v_bytes
  from new_rows r;
  if v_rows = 0 then
    return null;
  end if;

  insert into public.fitx_member_write_budget as b (user_id, window_start, rows_written, bytes_written)
  values (v_uid, v_window, v_rows, v_bytes)
  on conflict (user_id, window_start) do update
    set rows_written = b.rows_written + excluded.rows_written, bytes_written = b.bytes_written + excluded.bytes_written
  returning b.rows_written, b.bytes_written into v_hour_rows, v_hour_bytes;

  select coalesce(pg_catalog.sum(b.rows_written), 0), coalesce(pg_catalog.sum(b.bytes_written), 0)
    into v_day_rows, v_day_bytes
  from public.fitx_member_write_budget b
  where b.user_id = v_uid and b.window_start > v_window - interval '1 day';

  if v_hour_rows = v_rows then
    delete from public.fitx_member_write_budget b
    where (b.user_id, b.window_start) in (
      select o.user_id, o.window_start from public.fitx_member_write_budget o
      where o.window_start < v_window - interval '2 days'
      order by o.window_start
      limit 1000
      for update skip locked);
  end if;

  if v_hour_rows > 10000 or v_hour_bytes > 50 * 1024 * 1024 then
    raise exception using errcode = '54000', message = 'write limit reached: at most 10000 rows and 50 MB an hour',
      hint = 'Try again in an hour.';
  end if;
  if v_day_rows > 50000 or v_day_bytes > 150 * 1024 * 1024 then
    raise exception using errcode = '54000', message = 'write limit reached: at most 50000 rows and 150 MB a day',
      hint = 'Try again tomorrow.';
  end if;
  return null;
end $function$;

revoke all on function public.fitx_member_write_budget() from public, anon, authenticated;

-- The tables members write with their own key (an owner policy for insert or update). Support requests and
-- messages are left out (members write them only through fitx_submit_support_request and
-- fitx_reply_support_request, which have their own limits), and so are member_notifications (a dismissal
-- time only) and experience 2.0's four tables (no member rights after step 1).
do $do$
declare
  v_table text;
begin
  foreach v_table in array array[
    'activities', 'activity_track_chunks', 'ai_coach_actions', 'ai_coach_consents', 'ai_coach_messages',
    'ai_coach_safety_notes', 'ai_coach_threads', 'announcement_dismissals', 'body_metrics', 'custom_foods',
    'exercise_favorites', 'exercise_notes', 'goal_progress_entries', 'goals', 'habits', 'meal_template_items',
    'meal_templates', 'meals', 'nutrition_targets', 'personal_records', 'planner_events', 'profiles',
    'programme_enrolments', 'tasks', 'user_equipment_profiles', 'user_preferences', 'water_logs',
    'workout_plan_exercises', 'workout_plans', 'workout_session_exercises', 'workout_sessions', 'workout_sets',
    'workouts'
  ] loop
    if pg_catalog.to_regclass('public.' || v_table) is not null then
      execute pg_catalog.format(
        'create or replace trigger fitx_write_budget_insert after insert on public.%I '
        'referencing new table as new_rows for each statement execute function public.fitx_member_write_budget()', v_table);
      execute pg_catalog.format(
        'create or replace trigger fitx_write_budget_update after update on public.%I '
        'referencing new table as new_rows for each statement execute function public.fitx_member_write_budget()', v_table);
    end if;
  end loop;
end $do$;

-- 5. Programme enrolments: published programmes only --------------------------------------------------------

-- A member's new enrolment, one moved to another programme, and a left or completed one set back to active or
-- paused must name a published programme. Runs as the member, who sees published programmes only. A paused
-- enrolment can still be resumed after its programme goes back to draft, as before; the server key and Admin
-- are not checked.
create or replace function public.fitx_programme_enrolment_published()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if (select auth.uid()) is not null
     and (tg_op = 'INSERT' or new.programme_id is distinct from old.programme_id
          or (old.status in ('left', 'completed') and new.status in ('active', 'paused')))
     and not exists (select 1 from public.training_programmes p where p.id = new.programme_id and p.status = 'published') then
    raise exception using errcode = '23514', message = 'programme_not_published';
  end if;
  return new;
end $function$;

revoke all on function public.fitx_programme_enrolment_published() from public, anon, authenticated;

create or replace trigger programme_enrolments_published before insert or update of programme_id, status on public.programme_enrolments
  for each row execute function public.fitx_programme_enrolment_published();
