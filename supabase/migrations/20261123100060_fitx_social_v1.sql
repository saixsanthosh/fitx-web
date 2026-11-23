-- FITX Explore, part 1 (phase 14): the social schema. Profiles, follows and follow requests, photo posts (up to 10
-- photos each), captions, hashtags, mentions, optional location text, topics, likes, comments with replies, saves,
-- notifications with preferences, reports, blocks and restrictions, comment controls, anti-spam limits and the
-- private `social-media` Storage bucket.
--
-- How it is protected:
--   * Every table has row level security on. Members read rows only through select policies that call the
--     visibility helpers below (a block either way hides everything; a private account's posts reach only its
--     accepted followers; a restricted member's comments reach only them and the post's owner).
--   * Members write nothing directly: no insert, update or delete grant on any table. Every change goes through a
--     `security definer` function with a pinned search_path that takes the member from the session (auth.uid()),
--     never from its arguments, and checks blocks, privacy, comment controls, sizes and rate limits first.
--   * Every table a member's action writes joins the fitx_member_write_budget triggers (20261121100040).
--   * Photos live in the private `social-media` bucket at <user id>/<post id>/<n>.webp|jpg (and
--     <user id>/profile/<name>.webp|jpg for profile pictures), at most 3 MB each, WebP or JPEG only. A file can be
--     read (and so signed) only by its owner and by members who may see its post or profile. Uploads stop at 60 files
--     a day and 150 MB in all per member.
--   * Nothing from Workouts, Nutrition, Progress or Activity is read or shared here: a post holds only what the
--     member typed and the photos they chose.
--
-- Wave 2 adds stories, short videos, challenges, communities and messages. The check constraints that wave 2 widens
-- are named (social_posts_kind_check, social_post_media_kind_check, social_notifications_type_check,
-- social_notifications_entity_type_check, social_reports_target_type_check), and social_posts carries community_id
-- and challenge_id (no foreign key yet).
--
-- Additive and safe to run again: create table/index if not exists, create or replace, guarded blocks, drop policy if
-- exists before each policy, idempotent grants. It changes no existing table, row or policy.

do $do$ begin perform pg_catalog.set_config('lock_timeout', '5s', true); end $do$;

-- 1. Tables ---------------------------------------------------------------------------------------------------------

-- A member's Explore identity. Only members who make one appear anywhere in Explore; it is separate from the FITX
-- profile (no name, photo or body data is copied from it).
create table if not exists public.social_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  display_name text not null,
  bio text not null default '',
  avatar_path text,
  is_private boolean not null default false,
  default_comment_policy text not null default 'everyone',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_profiles_username_check check (username ~ '^[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$' and username !~ '[.]{2}'),
  constraint social_profiles_display_name_check check (char_length(btrim(display_name)) between 1 and 50),
  constraint social_profiles_bio_check check (char_length(bio) <= 300),
  constraint social_profiles_avatar_path_check check (
    avatar_path is null or avatar_path ~ ('^' || user_id::text || '/profile/[a-z0-9-]{1,40}[.](webp|jpg)$')),
  constraint social_profiles_comment_policy_check check (default_comment_policy in ('everyone', 'followers', 'off'))
);
create unique index if not exists social_profiles_username_key on public.social_profiles (username);

-- user_id follows following_id. A follow of a private account waits as 'pending' until its owner accepts it.
create table if not exists public.social_follows (
  user_id uuid not null references auth.users (id) on delete cascade,
  following_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'accepted',
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (user_id, following_id),
  constraint social_follows_status_check check (status in ('pending', 'accepted')),
  constraint social_follows_self_check check (user_id <> following_id)
);
create index if not exists social_follows_following_idx on public.social_follows (following_id, status);

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null default 'photo',
  caption text not null default '',
  location_label text,
  topics text[] not null default '{}',
  comment_policy text not null default 'everyone',
  community_id uuid,
  challenge_id uuid,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  constraint social_posts_kind_check check (kind in ('photo')),
  constraint social_posts_caption_check check (char_length(caption) <= 2200),
  constraint social_posts_location_check check (location_label is null or char_length(btrim(location_label)) between 1 and 80),
  constraint social_posts_topics_check check (
    cardinality(topics) <= 3
    and topics <@ array['bodybuilding', 'weight_loss', 'muscle_gain', 'home_workouts', 'gym_workouts', 'nutrition', 'motivation']::text[]),
  constraint social_posts_comment_policy_check check (comment_policy in ('everyone', 'followers', 'off'))
);
create index if not exists social_posts_user_created_idx on public.social_posts (user_id, created_at desc, id desc);
create index if not exists social_posts_created_idx on public.social_posts (created_at desc, id desc);
create index if not exists social_posts_topics_idx on public.social_posts using gin (topics);

-- The photos of a post, in order. user_id repeats the post's owner so policies need no join.
create table if not exists public.social_post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  position smallint not null,
  kind text not null default 'image',
  storage_path text not null,
  width integer not null,
  height integer not null,
  duration_ms integer,
  bytes integer not null,
  alt_text text,
  created_at timestamptz not null default now(),
  unique (post_id, position),
  unique (storage_path),
  constraint social_post_media_kind_check check (kind in ('image')),
  constraint social_post_media_position_check check (position between 0 and 9),
  constraint social_post_media_size_check check (width between 1 and 4096 and height between 1 and 4096 and bytes between 1 and 52428800),
  constraint social_post_media_duration_check check (duration_ms is null or duration_ms between 1 and 30000),
  constraint social_post_media_alt_check check (alt_text is null or char_length(alt_text) <= 300)
);
create index if not exists social_post_media_user_idx on public.social_post_media (user_id);

create table if not exists public.social_hashtags (
  id bigint generated always as identity primary key,
  tag text not null unique,
  created_at timestamptz not null default now(),
  constraint social_hashtags_tag_check check (tag ~ '^[a-z0-9_]{1,50}$')
);

create table if not exists public.social_post_hashtags (
  post_id uuid not null references public.social_posts (id) on delete cascade,
  hashtag_id bigint not null references public.social_hashtags (id) on delete cascade,
  primary key (post_id, hashtag_id)
);
create index if not exists social_post_hashtags_tag_idx on public.social_post_hashtags (hashtag_id, post_id);

create table if not exists public.social_likes (
  user_id uuid not null references auth.users (id) on delete cascade,
  post_id uuid not null references public.social_posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index if not exists social_likes_post_idx on public.social_likes (post_id, created_at);

create table if not exists public.social_saves (
  user_id uuid not null references auth.users (id) on delete cascade,
  post_id uuid not null references public.social_posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index if not exists social_saves_post_idx on public.social_saves (post_id);

-- Comments; parent_id is the top-level comment a reply answers (one level of replies).
create table if not exists public.social_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  parent_id uuid references public.social_comments (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  constraint social_comments_body_check check (char_length(btrim(body)) between 1 and 1000)
);
create index if not exists social_comments_post_idx on public.social_comments (post_id, created_at, id);
create index if not exists social_comments_parent_idx on public.social_comments (parent_id);
create index if not exists social_comments_user_idx on public.social_comments (user_id);

-- user_id blocked blocked_id: neither sees the other anywhere in Explore.
create table if not exists public.social_blocks (
  user_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, blocked_id),
  constraint social_blocks_self_check check (user_id <> blocked_id)
);
create index if not exists social_blocks_blocked_idx on public.social_blocks (blocked_id);

-- user_id restricted restricted_id: their comments on user_id's posts reach only them and user_id, and their likes,
-- comments and mentions send user_id no notification.
create table if not exists public.social_restricts (
  user_id uuid not null references auth.users (id) on delete cascade,
  restricted_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, restricted_id),
  constraint social_restricts_self_check check (user_id <> restricted_id)
);

-- Reports for moderation (FITX Admin reads them in wave 2 with the server key). One open report per member and target.
create table if not exists public.social_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  target_type text not null,
  target_id uuid not null,
  target_user_id uuid references auth.users (id) on delete set null,
  reason text not null,
  details text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (user_id, target_type, target_id),
  constraint social_reports_target_type_check check (target_type in ('post', 'comment', 'account')),
  constraint social_reports_reason_check check (reason in ('spam', 'harassment', 'hate', 'nudity', 'violence', 'self_harm', 'false_information', 'scam', 'other')),
  constraint social_reports_details_check check (details is null or char_length(details) <= 500),
  constraint social_reports_status_check check (status in ('open', 'reviewing', 'actioned', 'dismissed'))
);
create index if not exists social_reports_status_idx on public.social_reports (status, created_at);

-- user_id is the recipient, actor_id who did it. post_id and comment_id go with what they point at.
create table if not exists public.social_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  actor_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  entity_type text not null,
  entity_id uuid not null,
  post_id uuid references public.social_posts (id) on delete cascade,
  comment_id uuid references public.social_comments (id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint social_notifications_type_check check (type in ('follow', 'follow_request', 'follow_accepted', 'like', 'comment', 'reply', 'mention')),
  constraint social_notifications_entity_type_check check (entity_type in ('profile', 'post', 'comment')),
  constraint social_notifications_self_check check (user_id <> actor_id)
);
create index if not exists social_notifications_user_idx on public.social_notifications (user_id, created_at desc, id desc);
create index if not exists social_notifications_dedupe_idx on public.social_notifications (user_id, actor_id, type, entity_id);

create table if not exists public.social_notification_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  follows boolean not null default true,
  follow_requests boolean not null default true,
  likes boolean not null default true,
  comments boolean not null default true,
  mentions boolean not null default true,
  updated_at timestamptz not null default now()
);

-- How many of each Explore action a member took this hour and today, for the anti-spam limits. Rows over two days
-- old are deleted by the member's next action.
create table if not exists public.social_rate_counters (
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (user_id, action, window_start),
  constraint social_rate_counters_action_check check (action ~ '^[a-z_]{1,30}:(hour|day)$'),
  constraint social_rate_counters_hits_check check (hits >= 0)
);

-- 2. Row level security: read policies only ---------------------------------------------------------------------

do $do$
declare
  v_table text;
begin
  foreach v_table in array array[
    'social_profiles', 'social_follows', 'social_posts', 'social_post_media', 'social_hashtags', 'social_post_hashtags',
    'social_likes', 'social_saves', 'social_comments', 'social_blocks', 'social_restricts', 'social_reports',
    'social_notifications', 'social_notification_prefs', 'social_rate_counters'
  ] loop
    execute pg_catalog.format('alter table public.%I enable row level security', v_table);
    execute pg_catalog.format('revoke all on table public.%I from public, anon, authenticated', v_table);
    execute pg_catalog.format('grant select on table public.%I to authenticated', v_table);
    execute pg_catalog.format('grant all on table public.%I to service_role', v_table);
  end loop;
end $do$;

-- The same read grant, spelled out (tests/account/export-schema.test.ts reads grants statement by statement).
grant select on public.social_profiles, public.social_follows, public.social_posts, public.social_post_media, public.social_hashtags,
  public.social_post_hashtags, public.social_likes, public.social_saves, public.social_comments, public.social_blocks,
  public.social_restricts, public.social_reports, public.social_notifications, public.social_notification_prefs,
  public.social_rate_counters to authenticated;

-- 3. Visibility helpers -----------------------------------------------------------------------------------------

-- Internal (no grant): a block between a and b, either way.
create or replace function public.fitx_social_blocked(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from public.social_blocks b
    where (b.user_id = p_a and b.blocked_id = p_b) or (b.user_id = p_b and b.blocked_id = p_a));
$function$;

-- Internal: whether p_viewer sees p_owner's Explore profile (it exists, and no block either way).
create or replace function public.fitx_social_sees_profile(p_viewer uuid, p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_viewer is not null
    and exists (select 1 from public.social_profiles p where p.user_id = p_owner)
    and (p_viewer = p_owner or not public.fitx_social_blocked(p_viewer, p_owner));
$function$;

-- Internal: whether p_viewer sees p_owner's posts: their own, or no block and (a public account or an accepted follow).
create or replace function public.fitx_social_sees_posts(p_viewer uuid, p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_viewer is not null and (
    p_viewer = p_owner
    or (exists (select 1 from public.social_profiles p where p.user_id = p_owner and not p.is_private)
        and not public.fitx_social_blocked(p_viewer, p_owner))
    or (exists (select 1 from public.social_follows f
                where f.user_id = p_viewer and f.following_id = p_owner and f.status = 'accepted')
        and not public.fitx_social_blocked(p_viewer, p_owner)));
$function$;

-- Internal: whether p_viewer sees a comment by p_author on a post of p_post_owner.
create or replace function public.fitx_social_sees_comment(p_viewer uuid, p_author uuid, p_post_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select public.fitx_social_sees_posts(p_viewer, p_post_owner)
    and (p_viewer = p_author or not public.fitx_social_blocked(p_viewer, p_author))
    and (p_viewer in (p_author, p_post_owner)
         or not exists (select 1 from public.social_restricts r where r.user_id = p_post_owner and r.restricted_id = p_author));
$function$;

-- For policies: the same questions for the signed-in member only (they answer nothing about anyone else's view).
create or replace function public.fitx_social_viewer_sees_profile(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select public.fitx_social_sees_profile((select auth.uid()), p_owner);
$function$;

create or replace function public.fitx_social_viewer_sees_posts(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select public.fitx_social_sees_posts((select auth.uid()), p_owner);
$function$;

create or replace function public.fitx_social_viewer_sees_post(p_post uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (select 1 from public.social_posts p where p.id = p_post and public.fitx_social_sees_posts((select auth.uid()), p.user_id));
$function$;

create or replace function public.fitx_social_viewer_sees_comment(p_author uuid, p_post uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (select 1 from public.social_posts p
                 where p.id = p_post and public.fitx_social_sees_comment((select auth.uid()), p_author, p.user_id));
$function$;

-- Storage: whether the signed-in member may read (and so sign a link to) a file in social-media. Owners read their own
-- files; others read a profile picture of a profile they see, and a photo of a post they see.
create or replace function public.fitx_social_can_read_object(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_parts text[] := pg_catalog.string_to_array(p_name, '/');
  v_owner uuid;
begin
  if v_uid is null or pg_catalog.cardinality(v_parts) <> 3
     or v_parts[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_owner := v_parts[1]::uuid;
  if v_owner = v_uid then
    return true;
  end if;
  if v_parts[2] = 'profile' then
    return exists (select 1 from public.social_profiles p where p.user_id = v_owner and p.avatar_path = p_name)
      and public.fitx_social_sees_profile(v_uid, v_owner);
  end if;
  return exists (select 1 from public.social_post_media m where m.storage_path = p_name and m.user_id = v_owner)
    and public.fitx_social_sees_posts(v_uid, v_owner);
end $function$;

-- Storage: whether the signed-in member may upload one more file to social-media at p_name: their own folder, a post
-- photo (<uid>/<post id>/<0-9>.webp|jpg) or a profile picture (<uid>/profile/<name>.webp|jpg), fewer than 60 files
-- added in the last 24 hours, and under 600 files and 150 MB in all.
create or replace function public.fitx_social_upload_allowed(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  with me as (select (select auth.uid()) as uid),
  folder as (
    select o.created_at, o.metadata
    from storage.objects o, me
    where o.bucket_id = 'social-media' and me.uid is not null and o.name like me.uid::text || '/%'
  )
  select (select me.uid from me) is not null
    and p_name ~ ('^' || (select me.uid from me)::text
                  || '/(profile/[a-z0-9-]{1,40}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9])[.](webp|jpg)$')
    and (select pg_catalog.count(*) from folder f where f.created_at > pg_catalog.now() - interval '24 hours') < 60
    and (select pg_catalog.count(*) from folder) < 600
    and (select coalesce(pg_catalog.sum(case when (f.metadata ->> 'size') ~ '^[0-9]{1,15}$' then (f.metadata ->> 'size')::bigint end), 0)
         from folder f) < 150 * 1024 * 1024;
$function$;

revoke all on function public.fitx_social_blocked(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fitx_social_sees_profile(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fitx_social_sees_posts(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fitx_social_sees_comment(uuid, uuid, uuid) from public, anon, authenticated;
do $do$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'fitx_social_viewer_sees_profile(uuid)', 'fitx_social_viewer_sees_posts(uuid)', 'fitx_social_viewer_sees_post(uuid)',
    'fitx_social_viewer_sees_comment(uuid, uuid)', 'fitx_social_can_read_object(text)', 'fitx_social_upload_allowed(text)'
  ] loop
    execute pg_catalog.format('revoke all on function public.%s from public, anon', v_fn);
    execute pg_catalog.format('grant execute on function public.%s to authenticated, service_role', v_fn);
  end loop;
end $do$;

drop policy if exists social_profiles_read on public.social_profiles;
create policy social_profiles_read on public.social_profiles for select to authenticated
  using ((select public.fitx_social_viewer_sees_profile(user_id)));

-- Members read their own follows, both ways (who they follow, and who follows or asked to follow them). Lists of other
-- accounts' followers come from fitx_social_follow_list, which checks the account's privacy.
drop policy if exists social_follows_read on public.social_follows;
create policy social_follows_read on public.social_follows for select to authenticated
  using ((select auth.uid()) in (user_id, following_id));

drop policy if exists social_posts_read on public.social_posts;
create policy social_posts_read on public.social_posts for select to authenticated
  using (user_id = (select auth.uid()) or (select public.fitx_social_viewer_sees_posts(user_id)));

drop policy if exists social_post_media_read on public.social_post_media;
create policy social_post_media_read on public.social_post_media for select to authenticated
  using (user_id = (select auth.uid()) or (select public.fitx_social_viewer_sees_posts(user_id)));

drop policy if exists social_hashtags_read on public.social_hashtags;
create policy social_hashtags_read on public.social_hashtags for select to authenticated using (true);

drop policy if exists social_post_hashtags_read on public.social_post_hashtags;
create policy social_post_hashtags_read on public.social_post_hashtags for select to authenticated
  using ((select public.fitx_social_viewer_sees_post(post_id)));

-- Who liked or saved what: members read only their own (counts come from the functions below).
drop policy if exists social_likes_read on public.social_likes;
create policy social_likes_read on public.social_likes for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists social_saves_read on public.social_saves;
create policy social_saves_read on public.social_saves for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists social_comments_read on public.social_comments;
create policy social_comments_read on public.social_comments for select to authenticated
  using (user_id = (select auth.uid()) or (select public.fitx_social_viewer_sees_comment(user_id, post_id)));

do $do$
declare
  v_table text;
begin
  foreach v_table in array array['social_blocks', 'social_restricts', 'social_reports', 'social_notifications',
                                 'social_notification_prefs', 'social_rate_counters'] loop
    execute pg_catalog.format('drop policy if exists %I on public.%I', v_table || '_read', v_table);
    execute pg_catalog.format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))',
      v_table || '_read', v_table);
  end loop;
end $do$;

-- 4. Storage bucket and its policies -------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('social-media', 'social-media', false, 3145728, array['image/webp', 'image/jpeg']::text[])
on conflict (id) do update set public = false, file_size_limit = 3145728, allowed_mime_types = array['image/webp', 'image/jpeg']::text[];

drop policy if exists social_media_read on storage.objects;
create policy social_media_read on storage.objects for select to authenticated
  using (bucket_id = 'social-media' and (select public.fitx_social_can_read_object(name)));
drop policy if exists social_media_insert on storage.objects;
create policy social_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'social-media' and (storage.foldername(name))[1] = (select auth.uid())::text
              and (select public.fitx_social_upload_allowed(name)));
drop policy if exists social_media_delete on storage.objects;
create policy social_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'social-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- 5. Internal building blocks (no grant) -------------------------------------------------------------------------

-- The signed-in member, who must have an Explore profile.
create or replace function public.fitx_social_member()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'social_signed_out';
  end if;
  if not exists (select 1 from public.social_profiles p where p.user_id = v_uid) then
    raise exception using errcode = 'P0001', message = 'social_no_profile';
  end if;
  return v_uid;
end $function$;

-- Counts one action against its hourly and daily limit; past either, stops the statement (nothing of it stays).
create or replace function public.fitx_social_take(p_uid uuid, p_action text, p_hour_max integer, p_day_max integer)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_hour timestamptz := pg_catalog.date_trunc('hour', pg_catalog.now());
  v_day timestamptz := pg_catalog.date_trunc('day', pg_catalog.now());
  v_hits integer;
begin
  insert into public.social_rate_counters as c (user_id, action, window_start, hits)
  values (p_uid, p_action || ':hour', v_hour, 1)
  on conflict (user_id, action, window_start) do update set hits = c.hits + 1
  returning c.hits into v_hits;
  if v_hits > p_hour_max then
    raise exception using errcode = 'PT429', message = 'social_rate_limited', hint = 'hour';
  end if;
  insert into public.social_rate_counters as c (user_id, action, window_start, hits)
  values (p_uid, p_action || ':day', v_day, 1)
  on conflict (user_id, action, window_start) do update set hits = c.hits + 1
  returning c.hits into v_hits;
  if v_hits > p_day_max then
    raise exception using errcode = 'PT429', message = 'social_rate_limited', hint = 'day';
  end if;
  delete from public.social_rate_counters c where c.user_id = p_uid and c.window_start < pg_catalog.now() - interval '2 days';
end $function$;

-- A member as other members see them.
create or replace function public.fitx_social_author_json(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object('id', p.user_id, 'username', p.username, 'display_name', p.display_name,
    'avatar_path', p.avatar_path, 'is_private', p.is_private)
  from public.social_profiles p where p.user_id = p_user;
$function$;

-- Whether p_viewer may comment on p_post now.
create or replace function public.fitx_social_can_comment(p_viewer uuid, p_post public.social_posts)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_viewer is not null
    and public.fitx_social_sees_posts(p_viewer, p_post.user_id)
    and case p_post.comment_policy
      when 'everyone' then true
      when 'followers' then p_viewer = p_post.user_id or exists (
        select 1 from public.social_follows f where f.user_id = p_viewer and f.following_id = p_post.user_id and f.status = 'accepted')
      else false end;
$function$;

-- A post as p_viewer sees it.
create or replace function public.fitx_social_post_json(p_viewer uuid, p_post public.social_posts)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'id', p_post.id,
    'kind', p_post.kind,
    'caption', p_post.caption,
    'location', p_post.location_label,
    'topics', pg_catalog.to_jsonb(p_post.topics),
    'comment_policy', p_post.comment_policy,
    'created_at', p_post.created_at,
    'edited_at', p_post.edited_at,
    'author', public.fitx_social_author_json(p_post.user_id),
    'media', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('path', m.storage_path, 'width', m.width,
                         'height', m.height, 'kind', m.kind, 'alt', m.alt_text) order by m.position)
                       from public.social_post_media m where m.post_id = p_post.id), '[]'::jsonb),
    'like_count', (select pg_catalog.count(*) from public.social_likes l
                   where l.post_id = p_post.id and not public.fitx_social_blocked(p_viewer, l.user_id)),
    'comment_count', (select pg_catalog.count(*) from public.social_comments c
                      where c.post_id = p_post.id and public.fitx_social_sees_comment(p_viewer, c.user_id, p_post.user_id)),
    'liked', exists (select 1 from public.social_likes l where l.post_id = p_post.id and l.user_id = p_viewer),
    'saved', exists (select 1 from public.social_saves s where s.post_id = p_post.id and s.user_id = p_viewer),
    'mine', p_post.user_id = p_viewer,
    'can_comment', public.fitx_social_can_comment(p_viewer, p_post));
$function$;

-- Sends one notification, unless the recipient turned that kind off, blocks or restricts the actor (restricted: likes,
-- comments, replies and mentions), or already has the same one (likes and follows notify once).
create or replace function public.fitx_social_notify(p_recipient uuid, p_actor uuid, p_type text, p_entity_type text,
  p_entity_id uuid, p_post uuid default null, p_comment uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_prefs public.social_notification_prefs;
  v_wanted boolean;
begin
  if p_recipient is null or p_actor is null or p_recipient = p_actor or public.fitx_social_blocked(p_recipient, p_actor) then
    return;
  end if;
  if p_type in ('like', 'comment', 'reply', 'mention')
     and exists (select 1 from public.social_restricts r where r.user_id = p_recipient and r.restricted_id = p_actor) then
    return;
  end if;
  select * into v_prefs from public.social_notification_prefs np where np.user_id = p_recipient;
  if found then
    v_wanted := case p_type
      when 'follow' then v_prefs.follows
      when 'follow_accepted' then v_prefs.follows
      when 'follow_request' then v_prefs.follow_requests
      when 'like' then v_prefs.likes
      when 'comment' then v_prefs.comments
      when 'reply' then v_prefs.comments
      when 'mention' then v_prefs.mentions
      else true end;
    if not v_wanted then
      return;
    end if;
  end if;
  if p_type in ('like', 'follow', 'follow_request', 'follow_accepted') and exists (
      select 1 from public.social_notifications n
      where n.user_id = p_recipient and n.actor_id = p_actor and n.type = p_type and n.entity_id = p_entity_id) then
    return;
  end if;
  insert into public.social_notifications (user_id, actor_id, type, entity_type, entity_id, post_id, comment_id)
  values (p_recipient, p_actor, p_type, p_entity_type, p_entity_id, p_post, p_comment);
end $function$;

-- The hashtags in a text: #word of letters, digits and underscores, lower-cased, at most 30, in order of appearance.
create or replace function public.fitx_social_hashtags_in(p_text text)
returns text[]
language sql
immutable
set search_path = ''
as $function$
  select coalesce(pg_catalog.array_agg(t.tag order by t.first), '{}')
  from (
    select pg_catalog.lower(m[1]) as tag, pg_catalog.min(o) as first
    from pg_catalog.regexp_matches(coalesce(p_text, ''), '(?:^|[^a-zA-Z0-9_&])#([a-zA-Z0-9_]{1,50})', 'g') with ordinality as r(m, o)
    group by 1 order by 2 limit 30
  ) t;
$function$;

-- The usernames mentioned in a text: @name, lower-cased, at most 20.
create or replace function public.fitx_social_mentions_in(p_text text)
returns text[]
language sql
immutable
set search_path = ''
as $function$
  select coalesce(pg_catalog.array_agg(t.name order by t.first), '{}')
  from (
    select pg_catalog.lower(pg_catalog.rtrim(m[1], '.')) as name, pg_catalog.min(o) as first
    from pg_catalog.regexp_matches(coalesce(p_text, ''), '(?:^|[^a-zA-Z0-9_.])@([a-zA-Z0-9._]{3,30})', 'g') with ordinality as r(m, o)
    group by 1 order by 2 limit 20
  ) t;
$function$;

-- Replaces a post's hashtags with the ones in its caption.
create or replace function public.fitx_social_tag_post(p_post uuid, p_caption text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tags text[] := public.fitx_social_hashtags_in(p_caption);
begin
  delete from public.social_post_hashtags h where h.post_id = p_post;
  if pg_catalog.cardinality(v_tags) = 0 then
    return;
  end if;
  insert into public.social_hashtags (tag) select pg_catalog.unnest(v_tags) on conflict (tag) do nothing;
  insert into public.social_post_hashtags (post_id, hashtag_id)
  select p_post, h.id from public.social_hashtags h where h.tag = any (v_tags)
  on conflict do nothing;
end $function$;

-- Notifies the members a text mentions who can see the post (once per text; on an edit, only newly mentioned ones).
create or replace function public.fitx_social_notify_mentions(p_actor uuid, p_text text, p_previous text, p_post public.social_posts,
  p_comment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_target uuid;
begin
  for v_target in
    select p.user_id from public.social_profiles p
    where p.username = any (public.fitx_social_mentions_in(p_text))
      and not (p.username = any (public.fitx_social_mentions_in(p_previous)))
      and p.user_id <> p_actor
      and public.fitx_social_sees_posts(p.user_id, p_post.user_id)
  loop
    perform public.fitx_social_notify(v_target, p_actor, 'mention', case when p_comment is null then 'post' else 'comment' end,
      coalesce(p_comment, p_post.id), p_post.id, p_comment);
  end loop;
end $function$;

do $do$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'fitx_social_member()', 'fitx_social_take(uuid, text, integer, integer)', 'fitx_social_author_json(uuid)',
    'fitx_social_can_comment(uuid, public.social_posts)', 'fitx_social_post_json(uuid, public.social_posts)',
    'fitx_social_notify(uuid, uuid, text, text, uuid, uuid, uuid)', 'fitx_social_hashtags_in(text)', 'fitx_social_mentions_in(text)',
    'fitx_social_tag_post(uuid, text)', 'fitx_social_notify_mentions(uuid, text, text, public.social_posts, uuid)'
  ] loop
    execute pg_catalog.format('revoke all on function public.%s from public, anon, authenticated', v_fn);
  end loop;
end $do$;

-- 6. Member functions: profile ---------------------------------------------------------------------------------------

-- The signed-in member's Explore state: their profile (null before they make one), unread notifications and requests.
create or replace function public.fitx_social_me()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.social_profiles;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'social_signed_out';
  end if;
  select * into v_profile from public.social_profiles p where p.user_id = v_uid;
  if not found then
    return pg_catalog.jsonb_build_object('profile', null, 'unread', 0, 'requests', 0);
  end if;
  return pg_catalog.jsonb_build_object(
    'profile', pg_catalog.jsonb_build_object('id', v_profile.user_id, 'username', v_profile.username,
      'display_name', v_profile.display_name, 'bio', v_profile.bio, 'avatar_path', v_profile.avatar_path,
      'is_private', v_profile.is_private, 'default_comment_policy', v_profile.default_comment_policy),
    'unread', (select pg_catalog.count(*) from public.social_notifications n
               where n.user_id = v_uid and n.read_at is null and not public.fitx_social_blocked(v_uid, n.actor_id)),
    'requests', (select pg_catalog.count(*) from public.social_follows f
                 where f.following_id = v_uid and f.status = 'pending' and not public.fitx_social_blocked(v_uid, f.user_id)));
end $function$;

create or replace function public.fitx_social_username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null
    and pg_catalog.lower(btrim(p_username)) ~ '^[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$'
    and pg_catalog.lower(btrim(p_username)) !~ '[.]{2}'
    and pg_catalog.lower(btrim(p_username)) <> all (array['fitx', 'admin', 'support', 'help', 'explore', 'settings', 'official', 'moderator', 'staff'])
    and not exists (select 1 from public.social_profiles p
                    where p.username = pg_catalog.lower(btrim(p_username)) and p.user_id <> (select auth.uid()));
$function$;

-- Creates or updates the signed-in member's Explore profile. Turning a private account public accepts its waiting
-- follow requests.
create or replace function public.fitx_social_save_profile(p_username text, p_display_name text, p_bio text, p_is_private boolean,
  p_default_comment_policy text default 'everyone')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_username text := pg_catalog.lower(btrim(coalesce(p_username, '')));
  v_was_private boolean;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'social_signed_out';
  end if;
  perform public.fitx_social_take(v_uid, 'profile', 30, 100);
  if v_username !~ '^[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$' or v_username ~ '[.]{2}' then
    raise exception using errcode = '23514', message = 'social_username_invalid';
  end if;
  if v_username = any (array['fitx', 'admin', 'support', 'help', 'explore', 'settings', 'official', 'moderator', 'staff']) then
    raise exception using errcode = '23514', message = 'social_username_reserved';
  end if;
  if exists (select 1 from public.social_profiles p where p.username = v_username and p.user_id <> v_uid) then
    raise exception using errcode = '23505', message = 'social_username_taken';
  end if;
  if char_length(btrim(coalesce(p_display_name, ''))) not between 1 and 50 then
    raise exception using errcode = '23514', message = 'social_name_invalid';
  end if;
  if char_length(coalesce(p_bio, '')) > 300 then
    raise exception using errcode = '23514', message = 'social_bio_too_long';
  end if;
  if coalesce(p_default_comment_policy, 'everyone') not in ('everyone', 'followers', 'off') then
    raise exception using errcode = '23514', message = 'social_invalid';
  end if;

  select p.is_private into v_was_private from public.social_profiles p where p.user_id = v_uid;
  insert into public.social_profiles as p (user_id, username, display_name, bio, is_private, default_comment_policy)
  values (v_uid, v_username, btrim(p_display_name), btrim(coalesce(p_bio, '')), coalesce(p_is_private, false),
          coalesce(p_default_comment_policy, 'everyone'))
  on conflict (user_id) do update set username = excluded.username, display_name = excluded.display_name, bio = excluded.bio,
    is_private = excluded.is_private, default_comment_policy = excluded.default_comment_policy, updated_at = pg_catalog.now();

  if v_was_private and not coalesce(p_is_private, false) then
    update public.social_follows f set status = 'accepted', accepted_at = pg_catalog.now()
    where f.following_id = v_uid and f.status = 'pending';
  end if;
  return (public.fitx_social_me()) -> 'profile';
end $function$;

-- Sets (or with null removes) the profile picture; the file must already be in the member's profile folder. Returns
-- the previous picture's path, which the app then deletes.
create or replace function public.fitx_social_set_avatar(p_path text)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_old text;
begin
  perform public.fitx_social_take(v_uid, 'profile', 30, 100);
  if p_path is not null and (
       p_path !~ ('^' || v_uid::text || '/profile/[a-z0-9-]{1,40}[.](webp|jpg)$')
       or not exists (select 1 from storage.objects o where o.bucket_id = 'social-media' and o.name = p_path)) then
    raise exception using errcode = '23514', message = 'social_media_missing';
  end if;
  select p.avatar_path into v_old from public.social_profiles p where p.user_id = v_uid;
  update public.social_profiles p set avatar_path = p_path, updated_at = pg_catalog.now() where p.user_id = v_uid;
  return case when v_old is distinct from p_path then v_old end;
end $function$;

-- An account's page: profile, counts, how the signed-in member relates to it, and whether they see its posts. Null when
-- there is no such account or it blocked the member.
create or replace function public.fitx_social_profile(p_username text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_profile public.social_profiles;
  v_follow text;
begin
  select * into v_profile from public.social_profiles p where p.username = pg_catalog.lower(btrim(coalesce(p_username, '')));
  if not found or exists (select 1 from public.social_blocks b where b.user_id = v_profile.user_id and b.blocked_id = v_uid) then
    return null;
  end if;
  select f.status into v_follow from public.social_follows f where f.user_id = v_uid and f.following_id = v_profile.user_id;
  return pg_catalog.jsonb_build_object(
    'profile', public.fitx_social_author_json(v_profile.user_id) || pg_catalog.jsonb_build_object('bio', v_profile.bio),
    'counts', pg_catalog.jsonb_build_object(
      'posts', (select pg_catalog.count(*) from public.social_posts p where p.user_id = v_profile.user_id),
      'followers', (select pg_catalog.count(*) from public.social_follows f
                    where f.following_id = v_profile.user_id and f.status = 'accepted' and not public.fitx_social_blocked(v_uid, f.user_id)),
      'following', (select pg_catalog.count(*) from public.social_follows f
                    where f.user_id = v_profile.user_id and f.status = 'accepted' and not public.fitx_social_blocked(v_uid, f.following_id))),
    'relation', pg_catalog.jsonb_build_object(
      'is_self', v_profile.user_id = v_uid,
      'following', coalesce(v_follow, 'none'),
      'follows_you', exists (select 1 from public.social_follows f
                             where f.user_id = v_profile.user_id and f.following_id = v_uid and f.status = 'accepted'),
      'blocked', exists (select 1 from public.social_blocks b where b.user_id = v_uid and b.blocked_id = v_profile.user_id),
      'restricted', exists (select 1 from public.social_restricts r where r.user_id = v_uid and r.restricted_id = v_profile.user_id)),
    'can_see_posts', public.fitx_social_sees_posts(v_uid, v_profile.user_id));
end $function$;

-- 7. Member functions: follows, blocks, restrictions, reports -----------------------------------------------------

-- Follows an account: at once for a public one, as a request for a private one. Returns 'accepted' or 'pending'.
create or replace function public.fitx_social_follow(p_target uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_private boolean;
  v_status text;
begin
  select p.is_private into v_private from public.social_profiles p where p.user_id = p_target;
  if not found or p_target = v_uid or public.fitx_social_blocked(v_uid, p_target) then
    raise exception using errcode = 'P0001', message = 'social_not_found';
  end if;
  select f.status into v_status from public.social_follows f where f.user_id = v_uid and f.following_id = p_target;
  if found then
    return v_status;
  end if;
  perform public.fitx_social_take(v_uid, 'follow', 60, 200);
  v_status := case when v_private then 'pending' else 'accepted' end;
  insert into public.social_follows (user_id, following_id, status, accepted_at)
  values (v_uid, p_target, v_status, case when v_status = 'accepted' then pg_catalog.now() end);
  perform public.fitx_social_notify(p_target, v_uid, case when v_private then 'follow_request' else 'follow' end, 'profile', v_uid);
  return v_status;
end $function$;

-- Unfollows, or withdraws a request.
create or replace function public.fitx_social_unfollow(p_target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
begin
  delete from public.social_follows f where f.user_id = v_uid and f.following_id = p_target;
  delete from public.social_notifications n where n.user_id = p_target and n.actor_id = v_uid and n.type = 'follow_request';
end $function$;

-- Accepts or declines a follow request to the signed-in member's account.
create or replace function public.fitx_social_answer_request(p_follower uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
begin
  if not exists (select 1 from public.social_follows f where f.user_id = p_follower and f.following_id = v_uid and f.status = 'pending') then
    raise exception using errcode = 'P0001', message = 'social_not_found';
  end if;
  if p_accept then
    update public.social_follows f set status = 'accepted', accepted_at = pg_catalog.now()
    where f.user_id = p_follower and f.following_id = v_uid;
    perform public.fitx_social_notify(p_follower, v_uid, 'follow_accepted', 'profile', v_uid);
  else
    delete from public.social_follows f where f.user_id = p_follower and f.following_id = v_uid;
  end if;
  update public.social_notifications n set read_at = coalesce(n.read_at, pg_catalog.now())
  where n.user_id = v_uid and n.actor_id = p_follower and n.type = 'follow_request';
end $function$;

-- Removes one of the signed-in member's followers.
create or replace function public.fitx_social_remove_follower(p_follower uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
begin
  delete from public.social_follows f where f.user_id = p_follower and f.following_id = v_uid;
end $function$;

-- Blocks (true) or unblocks (false) an account. A block ends follows and requests both ways.
create or replace function public.fitx_social_set_block(p_target uuid, p_block boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
begin
  if p_target is null or p_target = v_uid then
    raise exception using errcode = 'P0001', message = 'social_not_found';
  end if;
  if p_block then
    if not exists (select 1 from public.social_profiles p where p.user_id = p_target) then
      raise exception using errcode = 'P0001', message = 'social_not_found';
    end if;
    perform public.fitx_social_take(v_uid, 'block', 30, 100);
    insert into public.social_blocks (user_id, blocked_id) values (v_uid, p_target) on conflict do nothing;
    delete from public.social_follows f
    where (f.user_id = v_uid and f.following_id = p_target) or (f.user_id = p_target and f.following_id = v_uid);
  else
    delete from public.social_blocks b where b.user_id = v_uid and b.blocked_id = p_target;
  end if;
end $function$;

create or replace function public.fitx_social_set_restrict(p_target uuid, p_restrict boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
begin
  if p_target is null or p_target = v_uid then
    raise exception using errcode = 'P0001', message = 'social_not_found';
  end if;
  if p_restrict then
    if not exists (select 1 from public.social_profiles p where p.user_id = p_target) then
      raise exception using errcode = 'P0001', message = 'social_not_found';
    end if;
    insert into public.social_restricts (user_id, restricted_id) values (v_uid, p_target) on conflict do nothing;
  else
    delete from public.social_restricts r where r.user_id = v_uid and r.restricted_id = p_target;
  end if;
end $function$;

-- Reports a post, a comment or an account the member can see. A second report of the same thing updates the first.
create or replace function public.fitx_social_report(p_target_type text, p_target_id uuid, p_reason text, p_details text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_owner uuid;
  v_id uuid;
begin
  if p_target_type = 'post' then
    select p.user_id into v_owner from public.social_posts p where p.id = p_target_id and public.fitx_social_sees_posts(v_uid, p.user_id);
  elsif p_target_type = 'comment' then
    select c.user_id into v_owner from public.social_comments c join public.social_posts p on p.id = c.post_id
    where c.id = p_target_id and public.fitx_social_sees_comment(v_uid, c.user_id, p.user_id);
  elsif p_target_type = 'account' then
    select p.user_id into v_owner from public.social_profiles p
    where p.user_id = p_target_id and not exists (select 1 from public.social_blocks b where b.user_id = p.user_id and b.blocked_id = v_uid);
  else
    raise exception using errcode = '23514', message = 'social_invalid';
  end if;
  if v_owner is null or v_owner = v_uid then
    raise exception using errcode = 'P0001', message = 'social_not_found';
  end if;
  if char_length(coalesce(p_details, '')) > 500 then
    raise exception using errcode = '23514', message = 'social_invalid';
  end if;
  perform public.fitx_social_take(v_uid, 'report', 10, 30);
  insert into public.social_reports as r (user_id, target_type, target_id, target_user_id, reason, details)
  values (v_uid, p_target_type, p_target_id, v_owner, p_reason, nullif(btrim(coalesce(p_details, '')), ''))
  on conflict (user_id, target_type, target_id) do update set reason = excluded.reason, details = excluded.details,
    status = 'open', created_at = pg_catalog.now(), reviewed_at = null
  returning r.id into v_id;
  return v_id;
end $function$;

-- 8. Member functions: posts, likes, saves, comments -----------------------------------------------------------------

-- Publishes a post whose photos the member already uploaded to <uid>/<p_post_id>/. p_media: [{position, path, width,
-- height, alt}] in order, 1 to 10; each file must be in the bucket. Returns the post as feeds show it.
create or replace function public.fitx_social_create_post(p_post_id uuid, p_caption text, p_location text, p_topics jsonb,
  p_comment_policy text, p_media jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_post public.social_posts;
  v_item jsonb;
  v_index integer := 0;
  v_path text;
  v_size bigint;
  v_topics text[];
begin
  if p_post_id is null or exists (select 1 from public.social_posts p where p.id = p_post_id) then
    raise exception using errcode = '23514', message = 'social_invalid';
  end if;
  if pg_catalog.jsonb_typeof(p_media) <> 'array' or pg_catalog.jsonb_array_length(p_media) not between 1 and 10 then
    raise exception using errcode = '23514', message = 'social_media_count';
  end if;
  if char_length(coalesce(p_caption, '')) > 2200 then
    raise exception using errcode = '23514', message = 'social_caption_too_long';
  end if;
  select coalesce(pg_catalog.array_agg(distinct t), '{}') into v_topics
  from pg_catalog.jsonb_array_elements_text(coalesce(p_topics, '[]'::jsonb)) t;
  perform public.fitx_social_take(v_uid, 'post', 10, 25);

  insert into public.social_posts (id, user_id, caption, location_label, topics, comment_policy)
  values (p_post_id, v_uid, btrim(coalesce(p_caption, '')), nullif(btrim(coalesce(p_location, '')), ''), v_topics,
          coalesce(p_comment_policy, (select p.default_comment_policy from public.social_profiles p where p.user_id = v_uid)))
  returning * into v_post;

  for v_item in select e from pg_catalog.jsonb_array_elements(p_media) e loop
    v_path := v_item ->> 'path';
    if v_path is null or v_path !~ ('^' || v_uid::text || '/' || p_post_id::text || '/' || v_index::text || '[.](webp|jpg)$') then
      raise exception using errcode = '23514', message = 'social_media_missing';
    end if;
    select case when (o.metadata ->> 'size') ~ '^[0-9]{1,15}$' then (o.metadata ->> 'size')::bigint end into v_size
    from storage.objects o where o.bucket_id = 'social-media' and o.name = v_path;
    if not found then
      raise exception using errcode = '23514', message = 'social_media_missing';
    end if;
    insert into public.social_post_media (post_id, user_id, position, kind, storage_path, width, height, bytes, alt_text)
    values (p_post_id, v_uid, v_index, 'image', v_path, (v_item ->> 'width')::integer, (v_item ->> 'height')::integer,
            coalesce(v_size, 1)::integer, nullif(btrim(coalesce(v_item ->> 'alt', '')), ''));
    v_index := v_index + 1;
  end loop;

  perform public.fitx_social_tag_post(p_post_id, v_post.caption);
  perform public.fitx_social_notify_mentions(v_uid, v_post.caption, null, v_post, null);
  return public.fitx_social_post_json(v_uid, v_post);
end $function$;

-- Edits the signed-in member's own post (not its photos).
create or replace function public.fitx_social_update_post(p_post uuid, p_caption text, p_location text, p_topics jsonb,
  p_comment_policy text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_before public.social_posts;
  v_post public.social_posts;
  v_topics text[];
begin
  select * into v_before from public.social_posts p where p.id = p_post and p.user_id = v_uid;
  if not found then
    raise exception using errcode = 'P0001', message = 'social_not_found';
  end if;
  if char_length(coalesce(p_caption, '')) > 2200 then
    raise exception using errcode = '23514', message = 'social_caption_too_long';
  end if;
  select coalesce(pg_catalog.array_agg(distinct t), '{}') into v_topics
  from pg_catalog.jsonb_array_elements_text(coalesce(p_topics, '[]'::jsonb)) t;
  perform public.fitx_social_take(v_uid, 'edit', 60, 300);
  update public.social_posts p set caption = btrim(coalesce(p_caption, '')), location_label = nullif(btrim(coalesce(p_location, '')), ''),
    topics = v_topics, comment_policy = coalesce(p_comment_policy, p.comment_policy), edited_at = pg_catalog.now()
  where p.id = p_post
  returning * into v_post;
  perform public.fitx_social_tag_post(p_post, v_post.caption);
  perform public.fitx_social_notify_mentions(v_uid, v_post.caption, v_before.caption, v_post, null);
  return public.fitx_social_post_json(v_uid, v_post);
end $function$;

-- Deletes the signed-in member's own post with its likes, comments and notifications. Returns the photo paths, which
-- the app then deletes from the bucket.
create or replace function public.fitx_social_delete_post(p_post uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_paths text[];
begin
  if not exists (select 1 from public.social_posts p where p.id = p_post and p.user_id = v_uid) then
    raise exception using errcode = 'P0001', message = 'social_not_found';
  end if;
  select coalesce(pg_catalog.array_agg(m.storage_path order by m.position), '{}') into v_paths
  from public.social_post_media m where m.post_id = p_post;
  delete from public.social_posts p where p.id = p_post;
  return v_paths;
end $function$;

-- Likes (true) or unlikes (false) a post the member can see. Returns {liked, like_count}.
create or replace function public.fitx_social_set_like(p_post uuid, p_like boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_post public.social_posts;
  v_added integer;
begin
  select * into v_post from public.social_posts p where p.id = p_post and public.fitx_social_sees_posts(v_uid, p.user_id);
  if not found then
    raise exception using errcode = 'P0001', message = 'social_not_found';
  end if;
  if p_like then
    insert into public.social_likes (user_id, post_id) values (v_uid, p_post) on conflict do nothing;
    get diagnostics v_added = row_count;
    if v_added > 0 then
      perform public.fitx_social_take(v_uid, 'like', 300, 1500);
      perform public.fitx_social_notify(v_post.user_id, v_uid, 'like', 'post', p_post, p_post);
    end if;
  else
    delete from public.social_likes l where l.user_id = v_uid and l.post_id = p_post;
  end if;
  return pg_catalog.jsonb_build_object('liked', coalesce(p_like, false),
    'like_count', (select pg_catalog.count(*) from public.social_likes l
                   where l.post_id = p_post and not public.fitx_social_blocked(v_uid, l.user_id)));
end $function$;

create or replace function public.fitx_social_set_save(p_post uuid, p_save boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
begin
  if p_save then
    if not exists (select 1 from public.social_posts p where p.id = p_post and public.fitx_social_sees_posts(v_uid, p.user_id)) then
      raise exception using errcode = 'P0001', message = 'social_not_found';
    end if;
    perform public.fitx_social_take(v_uid, 'save', 300, 1500);
    insert into public.social_saves (user_id, post_id) values (v_uid, p_post) on conflict do nothing;
  else
    delete from public.social_saves s where s.user_id = v_uid and s.post_id = p_post;
  end if;
  return coalesce(p_save, false);
end $function$;

-- A comment as p_viewer sees it.
create or replace function public.fitx_social_comment_json(p_viewer uuid, p_comment public.social_comments, p_post_owner uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object('id', p_comment.id, 'post_id', p_comment.post_id, 'parent_id', p_comment.parent_id,
    'body', p_comment.body, 'created_at', p_comment.created_at, 'edited_at', p_comment.edited_at,
    'author', public.fitx_social_author_json(p_comment.user_id),
    'mine', p_comment.user_id = p_viewer,
    'can_delete', p_viewer in (p_comment.user_id, p_post_owner),
    'restricted', p_viewer = p_post_owner and exists (
      select 1 from public.social_restricts r where r.user_id = p_post_owner and r.restricted_id = p_comment.user_id));
$function$;
do $do$
declare
  v_fn text := 'public.fitx_social_comment_json(uuid, public.social_comments, uuid)';
begin
  execute pg_catalog.format('revoke all on function %s from public, anon, authenticated', v_fn);
end $do$;

-- Comments on a post the member can see, if its comment setting lets them. p_parent answers a comment (a reply to a
-- reply answers its top-level comment).
create or replace function public.fitx_social_add_comment(p_post uuid, p_parent uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_post public.social_posts;
  v_parent public.social_comments;
  v_comment public.social_comments;
begin
  select * into v_post from public.social_posts p where p.id = p_post and public.fitx_social_sees_posts(v_uid, p.user_id);
  if not found then
    raise exception using errcode = 'P0001', message = 'social_not_found';
  end if;
  if not public.fitx_social_can_comment(v_uid, v_post) then
    raise exception using errcode = '42501', message = 'social_comments_closed';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 1000 then
    raise exception using errcode = '23514', message = 'social_comment_invalid';
  end if;
  if p_parent is not null then
    select * into v_parent from public.social_comments c
    where c.id = p_parent and c.post_id = p_post and public.fitx_social_sees_comment(v_uid, c.user_id, v_post.user_id);
    if not found then
      raise exception using errcode = 'P0001', message = 'social_not_found';
    end if;
  end if;
  perform public.fitx_social_take(v_uid, 'comment', 60, 300);
  insert into public.social_comments (post_id, user_id, parent_id, body)
  values (p_post, v_uid, coalesce(v_parent.parent_id, v_parent.id), btrim(p_body))
  returning * into v_comment;

  perform public.fitx_social_notify(v_post.user_id, v_uid, 'comment', 'comment', v_comment.id, p_post, v_comment.id);
  if v_parent.id is not null and v_parent.user_id <> v_post.user_id then
    perform public.fitx_social_notify(v_parent.user_id, v_uid, 'reply', 'comment', v_comment.id, p_post, v_comment.id);
  end if;
  perform public.fitx_social_notify_mentions(v_uid, v_comment.body, null, v_post, v_comment.id);
  return public.fitx_social_comment_json(v_uid, v_comment, v_post.user_id);
end $function$;

create or replace function public.fitx_social_edit_comment(p_comment uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_before public.social_comments;
  v_comment public.social_comments;
  v_post public.social_posts;
begin
  select * into v_before from public.social_comments c where c.id = p_comment and c.user_id = v_uid;
  if not found then
    raise exception using errcode = 'P0001', message = 'social_not_found';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 1000 then
    raise exception using errcode = '23514', message = 'social_comment_invalid';
  end if;
  perform public.fitx_social_take(v_uid, 'edit', 60, 300);
  update public.social_comments c set body = btrim(p_body), edited_at = pg_catalog.now() where c.id = p_comment
  returning * into v_comment;
  select * into v_post from public.social_posts p where p.id = v_comment.post_id;
  perform public.fitx_social_notify_mentions(v_uid, v_comment.body, v_before.body, v_post, v_comment.id);
  return public.fitx_social_comment_json(v_uid, v_comment, v_post.user_id);
end $function$;

-- Deletes a comment (and its replies): the member's own, or any on the member's own post.
create or replace function public.fitx_social_delete_comment(p_comment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
begin
  if not exists (select 1 from public.social_comments c join public.social_posts p on p.id = c.post_id
                 where c.id = p_comment and v_uid in (c.user_id, p.user_id)) then
    raise exception using errcode = 'P0001', message = 'social_not_found';
  end if;
  delete from public.social_comments c where c.id = p_comment;
end $function$;

-- 9. Member functions: reading ----------------------------------------------------------------------------------------

-- Cursor pages: pass the last item's created_at and id to get the next page (newest first).

-- The feed: the member's own posts and those of accounts they follow (accepted).
create or replace function public.fitx_social_feed(p_before_at timestamptz default null, p_before_id uuid default null, p_limit integer default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
begin
  return coalesce((
    select pg_catalog.jsonb_agg(public.fitx_social_post_json(v_uid, x.post) order by (x.post).created_at desc, (x.post).id desc)
    from (
      select p as post from public.social_posts p
      where (p.user_id = v_uid or exists (select 1 from public.social_follows f
                                          where f.user_id = v_uid and f.following_id = p.user_id and f.status = 'accepted'))
        and (p.user_id = v_uid or not public.fitx_social_blocked(v_uid, p.user_id))
        and (p_before_at is null or (p.created_at, p.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
      order by p.created_at desc, p.id desc
      limit least(greatest(coalesce(p_limit, 12), 1), 30)
    ) x), '[]'::jsonb);
end $function$;

-- Posts the member can see, newest first: one account's (p_user), one hashtag's (p_tag), one topic's (p_topic), or with
-- none of them every public account's (Discover's latest). Other members' private accounts appear only when followed.
create or replace function public.fitx_social_browse(p_user uuid default null, p_tag text default null, p_topic text default null,
  p_before_at timestamptz default null, p_before_id uuid default null, p_limit integer default 18)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_tag bigint;
begin
  if p_tag is not null then
    select h.id into v_tag from public.social_hashtags h where h.tag = pg_catalog.lower(pg_catalog.ltrim(btrim(p_tag), '#'));
    if not found then
      return '[]'::jsonb;
    end if;
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(public.fitx_social_post_json(v_uid, x.post) order by (x.post).created_at desc, (x.post).id desc)
    from (
      select p as post from public.social_posts p
      where (p_user is null or p.user_id = p_user)
        and (v_tag is null or exists (select 1 from public.social_post_hashtags h where h.post_id = p.id and h.hashtag_id = v_tag))
        and (p_topic is null or p.topics @> array[p_topic])
        and (p_user is not null or v_tag is not null or p_topic is not null or p.user_id <> v_uid)
        and public.fitx_social_sees_posts(v_uid, p.user_id)
        and (p_before_at is null or (p.created_at, p.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
      order by p.created_at desc, p.id desc
      limit least(greatest(coalesce(p_limit, 18), 1), 30)
    ) x), '[]'::jsonb);
end $function$;

-- Trending: public accounts' posts from the last p_days days (1 to 30), ranked by the likes, comments and saves other
-- members gave them (a comment counts 2, a save 3). Posts nobody else engaged with are not trending.
create or replace function public.fitx_social_trending(p_topic text default null, p_days integer default 7, p_limit integer default 12,
  p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_since timestamptz := pg_catalog.now() - pg_catalog.make_interval(days => least(greatest(coalesce(p_days, 7), 1), 30));
begin
  return coalesce((
    select pg_catalog.jsonb_agg(public.fitx_social_post_json(v_uid, s.post) || pg_catalog.jsonb_build_object('score', s.score)
                                order by s.score desc, (s.post).created_at desc, (s.post).id desc)
    from (
      select p as post,
        (select pg_catalog.count(*) from public.social_likes l where l.post_id = p.id and l.user_id <> p.user_id)
        + 2 * (select pg_catalog.count(distinct c.user_id) from public.social_comments c where c.post_id = p.id and c.user_id <> p.user_id)
        + 3 * (select pg_catalog.count(*) from public.social_saves sv where sv.post_id = p.id and sv.user_id <> p.user_id) as score
      from public.social_posts p
      join public.social_profiles a on a.user_id = p.user_id and not a.is_private
      where p.created_at > v_since
        and p.user_id <> v_uid
        and not public.fitx_social_blocked(v_uid, p.user_id)
        and (p_topic is null or p.topics @> array[p_topic])
      order by score desc, p.created_at desc, p.id desc
      offset greatest(coalesce(p_offset, 0), 0)
      limit least(greatest(coalesce(p_limit, 12), 1), 30)
    ) s where s.score > 0), '[]'::jsonb);
end $function$;

-- Accounts to follow, with the real reason: followed by accounts the member follows, posting about the topics of posts
-- the member liked or saved in the last 60 days, or other members' likes on their posts in the last 30 days. Accounts
-- the member follows, asked to follow or has a block with are left out, and so are accounts with none of these reasons
-- and no post.
create or replace function public.fitx_social_suggestions(p_limit integer default 8)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_topics text[];
begin
  select coalesce(pg_catalog.array_agg(distinct t), '{}') into v_topics
  from (
    select pg_catalog.unnest(p.topics) t from public.social_likes l join public.social_posts p on p.id = l.post_id
    where l.user_id = v_uid and l.created_at > pg_catalog.now() - interval '60 days'
    union all
    select pg_catalog.unnest(p.topics) from public.social_saves s join public.social_posts p on p.id = s.post_id
    where s.user_id = v_uid and s.created_at > pg_catalog.now() - interval '60 days'
  ) x;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('user', public.fitx_social_author_json(c.user_id),
      'reason', case when c.mutual > 0 then 'followed_by' when c.topic is not null then 'topic'
                     when c.liked > 0 then 'popular' else 'new' end,
      'mutual_count', c.mutual, 'mutual_username', c.mutual_name, 'topic', c.topic, 'posts', c.posts)
      order by c.mutual desc, (c.topic is not null) desc, c.liked desc, c.posts desc, c.created_at desc)
    from (
    select * from (
      select a.user_id, a.created_at,
        (select pg_catalog.count(*) from public.social_follows mine join public.social_follows theirs
           on theirs.user_id = mine.following_id and theirs.following_id = a.user_id and theirs.status = 'accepted'
         where mine.user_id = v_uid and mine.status = 'accepted') as mutual,
        (select m.username from public.social_follows mine join public.social_follows theirs
           on theirs.user_id = mine.following_id and theirs.following_id = a.user_id and theirs.status = 'accepted'
         join public.social_profiles m on m.user_id = mine.following_id
         where mine.user_id = v_uid and mine.status = 'accepted' order by m.username limit 1) as mutual_name,
        case when a.is_private then null else (
          select t from public.social_posts p, pg_catalog.unnest(p.topics) t
          where p.user_id = a.user_id and t = any (v_topics) and p.created_at > pg_catalog.now() - interval '60 days'
          group by t order by pg_catalog.count(*) desc, t limit 1) end as topic,
        case when a.is_private then 0 else (
          select pg_catalog.count(*) from public.social_likes l join public.social_posts p on p.id = l.post_id
          where p.user_id = a.user_id and l.user_id <> a.user_id and l.created_at > pg_catalog.now() - interval '30 days') end as liked,
        (select pg_catalog.count(*) from public.social_posts p where p.user_id = a.user_id) as posts
      from public.social_profiles a
      where a.user_id <> v_uid
        and not public.fitx_social_blocked(v_uid, a.user_id)
        and not exists (select 1 from public.social_follows f where f.user_id = v_uid and f.following_id = a.user_id)
    ) c
    where c.mutual > 0 or c.topic is not null or c.liked > 0 or c.posts > 0
    order by c.mutual desc, (c.topic is not null) desc, c.liked desc, c.posts desc, c.created_at desc
    limit least(greatest(coalesce(p_limit, 8), 1), 30)
    ) c), '[]'::jsonb);
end $function$;

-- Search: accounts by username or name, and hashtags with how many posts the member can see.
create or replace function public.fitx_social_search(p_query text, p_limit integer default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_q text := pg_catalog.lower(pg_catalog.ltrim(btrim(coalesce(p_query, '')), '@#'));
  v_like text;
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 25);
begin
  if char_length(v_q) = 0 or char_length(v_q) > 50 then
    return pg_catalog.jsonb_build_object('accounts', '[]'::jsonb, 'hashtags', '[]'::jsonb);
  end if;
  v_like := pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');
  return pg_catalog.jsonb_build_object(
    'accounts', coalesce((
      select pg_catalog.jsonb_agg(public.fitx_social_author_json(a.user_id) order by a.rank, a.followers desc, a.username)
      from (
        select p.user_id, p.username,
          case when p.username = v_q then 0 when p.username like v_like || '%' then 1 else 2 end as rank,
          (select pg_catalog.count(*) from public.social_follows f where f.following_id = p.user_id and f.status = 'accepted') as followers
        from public.social_profiles p
        where (p.username like '%' || v_like || '%' or pg_catalog.lower(p.display_name) like '%' || v_like || '%')
          and (p.user_id = v_uid or not public.fitx_social_blocked(v_uid, p.user_id))
        order by rank, followers desc, p.username
        limit v_limit
      ) a), '[]'::jsonb),
    'hashtags', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('tag', h.tag, 'posts', h.posts) order by h.posts desc, h.tag)
      from (
      select * from (
        select t.tag, (select pg_catalog.count(*) from public.social_post_hashtags ph join public.social_posts p on p.id = ph.post_id
                       where ph.hashtag_id = t.id and public.fitx_social_sees_posts(v_uid, p.user_id)) as posts
        from public.social_hashtags t
        where t.tag like v_like || '%'
        order by t.tag
        limit 50
      ) h0 where h0.posts > 0 order by h0.posts desc, h0.tag limit v_limit
      ) h), '[]'::jsonb));
end $function$;

-- One post, or null when the member cannot see it.
create or replace function public.fitx_social_post(p_post uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_post public.social_posts;
begin
  select * into v_post from public.social_posts p where p.id = p_post and public.fitx_social_sees_posts(v_uid, p.user_id);
  if not found then
    return null;
  end if;
  return public.fitx_social_post_json(v_uid, v_post);
end $function$;

-- The posts the member saved, newest save first (p_before_at is the last item's saved_at).
create or replace function public.fitx_social_saved(p_before_at timestamptz default null, p_limit integer default 18)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
begin
  return coalesce((
    select pg_catalog.jsonb_agg(public.fitx_social_post_json(v_uid, x.post) || pg_catalog.jsonb_build_object('saved_at', x.saved_at)
                                order by x.saved_at desc)
    from (
      select p as post, s.created_at as saved_at
      from public.social_saves s join public.social_posts p on p.id = s.post_id
      where s.user_id = v_uid and public.fitx_social_sees_posts(v_uid, p.user_id)
        and (p_before_at is null or s.created_at < p_before_at)
      order by s.created_at desc
      limit least(greatest(coalesce(p_limit, 18), 1), 30)
    ) x), '[]'::jsonb);
end $function$;

-- A post's comments the member can see: top-level ones oldest first (after the cursor), each with its replies.
create or replace function public.fitx_social_comments(p_post uuid, p_after_at timestamptz default null, p_after_id uuid default null,
  p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_post public.social_posts;
begin
  select * into v_post from public.social_posts p where p.id = p_post and public.fitx_social_sees_posts(v_uid, p.user_id);
  if not found then
    raise exception using errcode = 'P0001', message = 'social_not_found';
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(public.fitx_social_comment_json(v_uid, x.c, v_post.user_id) || pg_catalog.jsonb_build_object(
      'replies', coalesce((
        select pg_catalog.jsonb_agg(public.fitx_social_comment_json(v_uid, y.r, v_post.user_id) order by (y.r).created_at, (y.r).id)
        from (select r from public.social_comments r
              where r.parent_id = (x.c).id and public.fitx_social_sees_comment(v_uid, r.user_id, v_post.user_id)
              order by r.created_at, r.id limit 100) y), '[]'::jsonb))
      order by (x.c).created_at, (x.c).id)
    from (
      select c from public.social_comments c
      where c.post_id = p_post and c.parent_id is null
        and public.fitx_social_sees_comment(v_uid, c.user_id, v_post.user_id)
        and (p_after_at is null or (c.created_at, c.id) > (p_after_at, coalesce(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid)))
      order by c.created_at, c.id
      limit least(greatest(coalesce(p_limit, 30), 1), 50)
    ) x), '[]'::jsonb);
end $function$;

-- An account's followers or the accounts it follows (p_kind 'followers' or 'following'), when the member sees its posts.
create or replace function public.fitx_social_follow_list(p_user uuid, p_kind text, p_offset integer default 0, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
begin
  if not public.fitx_social_sees_posts(v_uid, p_user) or p_kind not in ('followers', 'following') then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('user', public.fitx_social_author_json(x.other),
      'following', coalesce((select f.status from public.social_follows f where f.user_id = v_uid and f.following_id = x.other), 'none'))
      order by x.at desc, x.other)
    from (
      select case when p_kind = 'followers' then f.user_id else f.following_id end as other, f.created_at as at
      from public.social_follows f
      where f.status = 'accepted'
        and ((p_kind = 'followers' and f.following_id = p_user) or (p_kind = 'following' and f.user_id = p_user))
        and not public.fitx_social_blocked(v_uid, case when p_kind = 'followers' then f.user_id else f.following_id end)
      order by f.created_at desc
      offset greatest(coalesce(p_offset, 0), 0)
      limit least(greatest(coalesce(p_limit, 30), 1), 50)
    ) x), '[]'::jsonb);
end $function$;

-- Follow requests waiting for the member's answer.
create or replace function public.fitx_social_requests()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
begin
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('user', public.fitx_social_author_json(f.user_id), 'created_at', f.created_at)
                                order by f.created_at desc)
    from public.social_follows f
    where f.following_id = v_uid and f.status = 'pending' and not public.fitx_social_blocked(v_uid, f.user_id)), '[]'::jsonb);
end $function$;

-- The member's notifications, newest first. A like or follow shows only while it still stands; nothing from an account
-- with a block either way.
create or replace function public.fitx_social_notifications(p_before_at timestamptz default null, p_before_id uuid default null,
  p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
begin
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', n.id, 'type', n.type, 'created_at', n.created_at,
      'read', n.read_at is not null, 'actor', public.fitx_social_author_json(n.actor_id), 'post_id', n.post_id,
      'comment_id', n.comment_id,
      'thumb', (select m.storage_path from public.social_post_media m where m.post_id = n.post_id order by m.position limit 1),
      'snippet', (select pg_catalog.left(c.body, 120) from public.social_comments c where c.id = n.comment_id),
      'following', coalesce((select f.status from public.social_follows f where f.user_id = v_uid and f.following_id = n.actor_id), 'none'))
      order by n.created_at desc, n.id desc)
    from (
      select * from public.social_notifications n
      where n.user_id = v_uid
        and not public.fitx_social_blocked(v_uid, n.actor_id)
        and exists (select 1 from public.social_profiles a where a.user_id = n.actor_id)
        and (n.type <> 'like' or exists (select 1 from public.social_likes l where l.user_id = n.actor_id and l.post_id = n.post_id))
        and (n.type <> 'follow' or exists (select 1 from public.social_follows f
                                           where f.user_id = n.actor_id and f.following_id = v_uid and f.status = 'accepted'))
        and (n.type <> 'follow_request' or exists (select 1 from public.social_follows f
                                                   where f.user_id = n.actor_id and f.following_id = v_uid and f.status = 'pending'))
        and (n.post_id is null or public.fitx_social_sees_posts(v_uid, (select p.user_id from public.social_posts p where p.id = n.post_id)))
        and (p_before_at is null or (n.created_at, n.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
      order by n.created_at desc, n.id desc
      limit least(greatest(coalesce(p_limit, 30), 1), 50)
    ) n), '[]'::jsonb);
end $function$;

-- Marks every notification read; returns how many were unread.
create or replace function public.fitx_social_mark_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_count integer;
begin
  update public.social_notifications n set read_at = pg_catalog.now() where n.user_id = v_uid and n.read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end $function$;

create or replace function public.fitx_social_notification_prefs()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_prefs public.social_notification_prefs;
begin
  select * into v_prefs from public.social_notification_prefs np where np.user_id = v_uid;
  return pg_catalog.jsonb_build_object('follows', coalesce(v_prefs.follows, true), 'follow_requests', coalesce(v_prefs.follow_requests, true),
    'likes', coalesce(v_prefs.likes, true), 'comments', coalesce(v_prefs.comments, true), 'mentions', coalesce(v_prefs.mentions, true));
end $function$;

create or replace function public.fitx_social_save_notification_prefs(p_follows boolean, p_follow_requests boolean, p_likes boolean,
  p_comments boolean, p_mentions boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
begin
  perform public.fitx_social_take(v_uid, 'profile', 30, 100);
  insert into public.social_notification_prefs as np (user_id, follows, follow_requests, likes, comments, mentions)
  values (v_uid, coalesce(p_follows, true), coalesce(p_follow_requests, true), coalesce(p_likes, true), coalesce(p_comments, true),
          coalesce(p_mentions, true))
  on conflict (user_id) do update set follows = excluded.follows, follow_requests = excluded.follow_requests, likes = excluded.likes,
    comments = excluded.comments, mentions = excluded.mentions, updated_at = pg_catalog.now();
  return public.fitx_social_notification_prefs();
end $function$;

-- The accounts the member blocked and restricted (blocked accounts are hidden everywhere else).
create or replace function public.fitx_social_safety_lists()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
begin
  return pg_catalog.jsonb_build_object(
    'blocked', coalesce((select pg_catalog.jsonb_agg(public.fitx_social_author_json(b.blocked_id) order by b.created_at desc)
                         from public.social_blocks b join public.social_profiles p on p.user_id = b.blocked_id
                         where b.user_id = v_uid), '[]'::jsonb),
    'restricted', coalesce((select pg_catalog.jsonb_agg(public.fitx_social_author_json(r.restricted_id) order by r.created_at desc)
                            from public.social_restricts r join public.social_profiles p on p.user_id = r.restricted_id
                            where r.user_id = v_uid), '[]'::jsonb));
end $function$;

do $do$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'fitx_social_me()', 'fitx_social_username_available(text)', 'fitx_social_save_profile(text, text, text, boolean, text)',
    'fitx_social_set_avatar(text)', 'fitx_social_profile(text)', 'fitx_social_follow(uuid)', 'fitx_social_unfollow(uuid)',
    'fitx_social_answer_request(uuid, boolean)', 'fitx_social_remove_follower(uuid)', 'fitx_social_set_block(uuid, boolean)',
    'fitx_social_set_restrict(uuid, boolean)', 'fitx_social_report(text, uuid, text, text)',
    'fitx_social_create_post(uuid, text, text, jsonb, text, jsonb)', 'fitx_social_update_post(uuid, text, text, jsonb, text)',
    'fitx_social_delete_post(uuid)', 'fitx_social_set_like(uuid, boolean)', 'fitx_social_set_save(uuid, boolean)',
    'fitx_social_add_comment(uuid, uuid, text)', 'fitx_social_edit_comment(uuid, text)', 'fitx_social_delete_comment(uuid)',
    'fitx_social_feed(timestamptz, uuid, integer)', 'fitx_social_browse(uuid, text, text, timestamptz, uuid, integer)',
    'fitx_social_trending(text, integer, integer, integer)', 'fitx_social_suggestions(integer)', 'fitx_social_search(text, integer)',
    'fitx_social_post(uuid)', 'fitx_social_saved(timestamptz, integer)', 'fitx_social_comments(uuid, timestamptz, uuid, integer)',
    'fitx_social_follow_list(uuid, text, integer, integer)', 'fitx_social_requests()',
    'fitx_social_notifications(timestamptz, uuid, integer)', 'fitx_social_mark_read()', 'fitx_social_notification_prefs()',
    'fitx_social_save_notification_prefs(boolean, boolean, boolean, boolean, boolean)', 'fitx_social_safety_lists()'
  ] loop
    execute pg_catalog.format('revoke all on function public.%s from public, anon', v_fn);
    execute pg_catalog.format('grant execute on function public.%s to authenticated, service_role', v_fn);
  end loop;
end $do$;

-- 10. Write budget: the tables members' Explore actions write --------------------------------------------------------

do $do$
declare
  v_table text;
begin
  if pg_catalog.to_regprocedure('public.fitx_member_write_budget()') is null then
    return;
  end if;
  foreach v_table in array array[
    'social_profiles', 'social_follows', 'social_posts', 'social_post_media', 'social_hashtags', 'social_post_hashtags', 'social_likes',
    'social_saves', 'social_comments', 'social_blocks', 'social_restricts', 'social_reports', 'social_notifications',
    'social_notification_prefs'
  ] loop
    execute pg_catalog.format(
      'create or replace trigger fitx_write_budget_insert after insert on public.%I '
      'referencing new table as new_rows for each statement execute function public.fitx_member_write_budget()', v_table);
    execute pg_catalog.format(
      'create or replace trigger fitx_write_budget_update after update on public.%I '
      'referencing new table as new_rows for each statement execute function public.fitx_member_write_budget()', v_table);
  end loop;
end $do$;
