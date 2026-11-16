-- FITX AI Coach: consent, conversations, proposed actions and a per-account limit over any 24 hours.
--
-- Additive: new tables and functions only. No existing table, column, policy or row changes.
-- Every new table has row-level security on. Members reach only their own rows, through policies
-- that use (select auth.uid()); nothing is granted to anon. The two usage tables are reachable only
-- through the security definer functions below, so nobody can raise their own limit.
-- Safe to re-run.

begin;

-- ─────────────────────────────── consent ───────────────────────────────
-- One row per account, written when the member agrees on the coach page. Deleting it withdraws consent.
create table if not exists public.ai_coach_consents (
  user_id uuid primary key references auth.users (id) on delete cascade,
  consent_version smallint not null default 1 check (consent_version between 1 and 100),
  -- false: the coach answers the question only and never reads the member's FITX data. Off unless the
  -- member chooses it (the app always sends the member's explicit choice).
  share_personal_data boolean not null default false,
  consented_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- updated_at is when "Use my FITX data" was last switched: with it off, the coach sends no message from
-- before that moment. Set by the database, like the messages' created_at, so the two clocks always agree.
drop trigger if exists ai_coach_consents_touch_updated_at on public.ai_coach_consents;
create trigger ai_coach_consents_touch_updated_at before insert or update on public.ai_coach_consents
  for each row execute function public.touch_updated_at();

-- ──────────────────────────── conversations ────────────────────────────
create table if not exists public.ai_coach_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index if not exists ai_coach_threads_user_updated_idx on public.ai_coach_threads (user_id, updated_at desc);

create table if not exists public.ai_coach_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  thread_id uuid not null,
  -- 'safety' rows are FITX's own safety notes, never model output.
  role text not null check (role in ('user', 'assistant', 'safety')),
  task text not null default 'chat' check (task in ('chat', 'meal_plan', 'workout_plan')),
  content text not null check (char_length(content) between 1 and 12000),
  -- A checked meal or workout plan, as the app renders it.
  data jsonb check (data is null or (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 65536)),
  provider text check (provider is null or char_length(provider) <= 40),
  model text check (model is null or char_length(model) <= 120),
  created_at timestamptz not null default now(),
  foreign key (thread_id, user_id) references public.ai_coach_threads (id, user_id) on delete cascade,
  unique (id, user_id)
);
create index if not exists ai_coach_messages_thread_owner_idx on public.ai_coach_messages (thread_id, user_id, created_at);

-- ───────────────────────────── proposals ─────────────────────────────
-- What the coach proposed, after FITX checked it. Nothing here changes the member's data until they
-- press the button, which calls ai_coach_apply_action().
create table if not exists public.ai_coach_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  thread_id uuid not null,
  message_id uuid not null,
  kind text not null check (kind in ('food', 'meal', 'workout_plan')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 32768),
  status text not null default 'proposed' check (status in ('proposed', 'applied', 'dismissed')),
  -- The custom_foods or workout_plans row an applied action created.
  applied_ref uuid,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (thread_id, user_id) references public.ai_coach_threads (id, user_id) on delete cascade,
  foreign key (message_id, user_id) references public.ai_coach_messages (id, user_id) on delete cascade
);
create index if not exists ai_coach_actions_message_owner_idx on public.ai_coach_actions (message_id, user_id);
create index if not exists ai_coach_actions_thread_owner_idx on public.ai_coach_actions (thread_id, user_id);

-- ─────────────────────────── daily limits ───────────────────────────
-- Requests a member may make in any 24 hours (a rolling window, so changing time zone cannot reset it).
-- The owner edits these rows in the SQL editor.
create table if not exists public.ai_coach_limits (
  kind text primary key check (kind in ('chat', 'plan')),
  daily_limit integer not null check (daily_limit between 0 and 10000),
  updated_at timestamptz not null default now()
);
insert into public.ai_coach_limits (kind, daily_limit) values ('chat', 30), ('plan', 6)
on conflict (kind) do nothing;

-- One row per request taken against the limit. Counts and times only, no content. Rows older than
-- 7 days are removed by ai_coach_take_quota().
create table if not exists public.ai_coach_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('chat', 'plan')),
  -- true when no AI service answered, so the request did not count.
  released boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists ai_coach_usage_events_user_time_idx on public.ai_coach_usage_events (user_id, kind, created_at);

-- ───────────────────────── row-level security ─────────────────────────
alter table public.ai_coach_consents enable row level security;
alter table public.ai_coach_threads enable row level security;
alter table public.ai_coach_messages enable row level security;
alter table public.ai_coach_actions enable row level security;
alter table public.ai_coach_limits enable row level security;
alter table public.ai_coach_usage_events enable row level security;

drop policy if exists ai_coach_consents_owner on public.ai_coach_consents;
create policy ai_coach_consents_owner on public.ai_coach_consents for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists ai_coach_threads_owner on public.ai_coach_threads;
create policy ai_coach_threads_owner on public.ai_coach_threads for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists ai_coach_messages_owner on public.ai_coach_messages;
create policy ai_coach_messages_owner on public.ai_coach_messages for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists ai_coach_actions_owner on public.ai_coach_actions;
create policy ai_coach_actions_owner on public.ai_coach_actions for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ai_coach_limits and ai_coach_usage_events have no policies: only the functions below use them.

revoke all on table public.ai_coach_consents, public.ai_coach_threads, public.ai_coach_messages,
  public.ai_coach_actions, public.ai_coach_limits, public.ai_coach_usage_events from public, anon, authenticated;
grant select, insert, update, delete on table public.ai_coach_consents, public.ai_coach_threads to authenticated;
-- Messages are never edited.
grant select, insert, delete on table public.ai_coach_messages to authenticated;
-- A proposal's content is fixed once written; only its status changes.
grant select, insert, delete on table public.ai_coach_actions to authenticated;
grant update (status, applied_ref, applied_at) on table public.ai_coach_actions to authenticated;

-- ───────────────────────────── functions ─────────────────────────────

-- Takes one request from the member's limit for p_kind ('chat' or 'plan'), counted over the last 24
-- hours. Returns allowed = false, and takes nothing, when the limit is used up; resets_at is when the
-- oldest counted request leaves the window. event_id lets the server hand the request back with
-- ai_coach_release_quota() when no AI service answered.
create or replace function public.ai_coach_take_quota(p_kind text)
returns table (allowed boolean, event_id uuid, used integer, daily_limit integer, resets_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  cap integer;
  taken integer;
  oldest timestamptz;
  new_id uuid;
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_kind is null or p_kind not in ('chat', 'plan') then
    raise exception using errcode = '22023', message = 'unknown coach quota kind';
  end if;
  -- One request at a time per member and kind, so parallel requests cannot pass the limit together.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text || ':ai_coach:' || p_kind, 0));

  select l.daily_limit into cap from public.ai_coach_limits l where l.kind = p_kind;
  cap := coalesce(cap, case p_kind when 'chat' then 30 else 6 end);

  select pg_catalog.count(*)::integer, pg_catalog.min(e.created_at) into taken, oldest
  from public.ai_coach_usage_events e
  where e.user_id = uid and e.kind = p_kind and not e.released and e.created_at > pg_catalog.now() - interval '24 hours';

  delete from public.ai_coach_usage_events e where e.user_id = uid and e.created_at < pg_catalog.now() - interval '7 days';

  if taken >= cap then
    return query select false, null::uuid, taken, cap, oldest + interval '24 hours';
    return;
  end if;

  insert into public.ai_coach_usage_events (user_id, kind) values (uid, p_kind)
  returning id into new_id;
  return query select true, new_id, taken + 1, cap, coalesce(oldest, pg_catalog.now()) + interval '24 hours';
end $$;
revoke all on function public.ai_coach_take_quota(text) from public, anon;
grant execute on function public.ai_coach_take_quota(text) to authenticated;

-- Hands back a request taken in the last 15 minutes when no AI service could answer it.
create or replace function public.ai_coach_release_quota(p_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  changed integer;
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  update public.ai_coach_usage_events e set released = true
  where e.id = p_event_id and e.user_id = uid and not e.released
    and e.created_at > pg_catalog.now() - interval '15 minutes';
  get diagnostics changed = row_count;
  return changed > 0;
end $$;
revoke all on function public.ai_coach_release_quota(uuid) from public, anon;
grant execute on function public.ai_coach_release_quota(uuid) to authenticated;

-- What is left of the limits over the last 24 hours, for the coach page. resets_at is when the oldest
-- counted request leaves the window (null when nothing is counted).
create or replace function public.ai_coach_quota_status()
returns table (quota_kind text, used integer, daily_limit integer, resets_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  return query
    select k.kind,
      (select pg_catalog.count(*)::integer from public.ai_coach_usage_events e
        where e.user_id = uid and e.kind = k.kind and not e.released and e.created_at > pg_catalog.now() - interval '24 hours'),
      coalesce((select l.daily_limit from public.ai_coach_limits l where l.kind = k.kind), case k.kind when 'chat' then 30 else 6 end),
      (select pg_catalog.min(e.created_at) + interval '24 hours' from public.ai_coach_usage_events e
        where e.user_id = uid and e.kind = k.kind and not e.released and e.created_at > pg_catalog.now() - interval '24 hours')
    from (values ('chat'), ('plan')) as k(kind);
end $$;
revoke all on function public.ai_coach_quota_status() from public, anon;
grant execute on function public.ai_coach_quota_status() to authenticated;

-- Applies one proposal the member pressed: a food or meal becomes one custom_foods row (it is never
-- logged as eaten); a workout becomes a draft workout plan. Runs with the member's own rights, so
-- row-level security applies to every row it reads or writes. Pressing twice returns the first row,
-- unless the member has since deleted or archived it. Where Nutrition v2 (20261118140001) is in, the
-- row also gets origin 'ai_coach', its value_basis, a licensed product photo and its source.
create or replace function public.ai_coach_apply_action(p_action_id uuid)
returns table (action_kind text, ref_id uuid, already_applied boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  act record;
  food jsonb;
  plan jsonb;
  new_id uuid;
  food_columns text[];
  still_there boolean;
  cols text;
  vals text;
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  select a.id, a.kind, a.payload, a.status, a.applied_ref into act
  from public.ai_coach_actions a
  where a.id = p_action_id and a.user_id = uid
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'coach action not found';
  end if;
  if act.status = 'dismissed' then
    raise exception using errcode = '22023', message = 'coach action was dismissed';
  end if;

  if act.kind in ('food', 'meal') then
    -- Which optional custom_foods columns exist (Nutrition v2 adds them).
    select pg_catalog.array_agg(a.attname::text) into food_columns
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.custom_foods'::regclass and a.attnum > 0 and not a.attisdropped;
    if act.status = 'applied' and act.applied_ref is not null then
      -- Already added, unless the member has since deleted or archived that food.
      if 'archived_at' = any(food_columns) then
        execute 'select exists (select 1 from public.custom_foods f where f.id = $1 and f.user_id = $2 and f.archived_at is null)'
          into still_there using act.applied_ref, uid;
      else
        select exists (select 1 from public.custom_foods f where f.id = act.applied_ref and f.user_id = uid) into still_there;
      end if;
      if still_there then
        return query select act.kind::text, act.applied_ref, true;
        return;
      end if;
    end if;
    food := act.payload -> 'custom_food';
    if food is null or jsonb_typeof(food) <> 'object' then
      raise exception using errcode = '22023', message = 'coach action has no food';
    end if;
    cols := 'user_id, name, brand, serving_size, serving_grams, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g';
    vals := '$1, $2, $3, $4, $5, $6, $7, $8, $9';
    if 'origin' = any(food_columns) then
      cols := cols || ', origin';
      vals := vals || ', ''ai_coach''';
    end if;
    if 'value_basis' = any(food_columns) and coalesce(food ->> 'value_basis', '') in ('lab_analysed', 'compiled', 'recipe_calculated', 'label', 'ai_suggested', 'estimated') then
      cols := cols || ', value_basis';
      vals := vals || ', $10';
    end if;
    if 'image_url' = any(food_columns) and 'image_attribution' = any(food_columns) and coalesce(food ->> 'image_url', '') like 'https://%' then
      cols := cols || ', image_url, image_attribution';
      vals := vals || ', $11, $12';
    end if;
    if 'source_ref' = any(food_columns) and coalesce(food ->> 'source_ref', '') <> '' then
      cols := cols || ', source_ref';
      vals := vals || ', $13';
    end if;
    execute pg_catalog.format('insert into public.custom_foods (%s) values (%s) returning id', cols, vals)
      into new_id
      using uid, left(food ->> 'name', 160), nullif(left(coalesce(food ->> 'brand', ''), 160), ''),
        left(coalesce(food ->> 'serving_size', '100 g'), 80), (food ->> 'serving_grams')::numeric,
        (food ->> 'calories_per_100g')::numeric, (food ->> 'protein_per_100g')::numeric,
        (food ->> 'carbs_per_100g')::numeric, (food ->> 'fat_per_100g')::numeric,
        food ->> 'value_basis', left(food ->> 'image_url', 2048), left(food ->> 'image_attribution', 300), left(food ->> 'source_ref', 64);
  elsif act.kind = 'workout_plan' then
    if act.status = 'applied' and act.applied_ref is not null
       and exists (select 1 from public.workout_plans w where w.id = act.applied_ref and w.user_id = uid) then
      return query select act.kind::text, act.applied_ref, true;
      return;
    end if;
    plan := act.payload -> 'workout';
    if plan is null or jsonb_typeof(plan -> 'exercises') <> 'array' or jsonb_array_length(plan -> 'exercises') = 0 then
      raise exception using errcode = '22023', message = 'coach action has no exercises';
    end if;
    insert into public.workout_plans (user_id, title, split, workout_location, status, notes)
    values (uid, left(coalesce(nullif(plan ->> 'title', ''), 'Coach workout'), 120), 'custom',
      coalesce(nullif(plan ->> 'location', ''), 'gym'), 'draft', 'Suggested by FITX Coach')
    returning id into new_id;
    insert into public.workout_plan_exercises (user_id, plan_id, exercise_id, exercise_name, sort_order,
      target_sets, reps_min, reps_max, rest_seconds)
    select uid, new_id, e ->> 'exercise_id', left(coalesce(e ->> 'exercise_name', e ->> 'exercise_id'), 120), (t.ord - 1)::smallint,
      coalesce((e ->> 'sets')::smallint, 3), coalesce((e ->> 'reps_min')::smallint, 8),
      coalesce((e ->> 'reps_max')::smallint, 12), coalesce((e ->> 'rest_seconds')::smallint, 90)
    from jsonb_array_elements(plan -> 'exercises') with ordinality as t(e, ord)
    where t.ord <= 20;
    -- Holds (a plank, a wall sit) keep their seconds once the workouts migration 20261115110000 is in.
    if exists (select 1 from pg_catalog.pg_attribute
               where attrelid = 'public.workout_plan_exercises'::regclass and attname = 'target_duration_seconds' and not attisdropped) then
      execute 'update public.workout_plan_exercises x set target_duration_seconds = h.seconds'
        || ' from (select (t.ord - 1)::smallint as sort_order, (e ->> ''hold_seconds'')::integer as seconds'
        || ' from jsonb_array_elements($3) with ordinality as t(e, ord)) h'
        || ' where x.plan_id = $2 and x.user_id = $1 and x.sort_order = h.sort_order and h.seconds between 1 and 7200'
        using uid, new_id, plan -> 'exercises';
    end if;
  else
    raise exception using errcode = '22023', message = 'unknown coach action';
  end if;

  update public.ai_coach_actions a set status = 'applied', applied_ref = new_id, applied_at = pg_catalog.now()
  where a.id = act.id;
  return query select act.kind::text, new_id, false;
end $$;
revoke all on function public.ai_coach_apply_action(uuid) from public, anon;
grant execute on function public.ai_coach_apply_action(uuid) to authenticated;

-- "Delete my coach data": every conversation (with its messages and proposals) and the consent.
-- Foods and workouts the member already added stay; they are the member's own data now. Usage rows
-- (times and counts only) stay until they expire after 7 days, so the 24-hour limit still holds.
create or replace function public.ai_coach_delete_my_data()
returns table (threads_deleted integer, consent_withdrawn boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  thread_count integer;
  consent_count integer;
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  delete from public.ai_coach_threads t where t.user_id = uid;
  get diagnostics thread_count = row_count;
  delete from public.ai_coach_consents c where c.user_id = uid;
  get diagnostics consent_count = row_count;
  return query select thread_count, consent_count > 0;
end $$;
revoke all on function public.ai_coach_delete_my_data() from public, anon;
grant execute on function public.ai_coach_delete_my_data() to authenticated;

comment on table public.ai_coach_consents is 'FITX AI Coach: per-account consent and whether the coach may read the member''s FITX data.';
comment on table public.ai_coach_threads is 'FITX AI Coach conversations (owner-only).';
comment on table public.ai_coach_messages is 'FITX AI Coach messages; role safety marks FITX''s own safety notes.';
comment on table public.ai_coach_actions is 'Checked coach proposals; applied only by ai_coach_apply_action() after the member presses its button.';
comment on table public.ai_coach_limits is 'Owner-set coach limits per account over any 24 hours (chat, plan).';
comment on table public.ai_coach_usage_events is 'Coach requests counted against the 24-hour limit; counts and times only.';

commit;

notify pgrst, 'reload schema';
