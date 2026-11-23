-- FITX Explore, part 2 core (wave 2, migration M1; runbook #52). Builds on 20261123100060_fitx_social_v1.sql.
--
-- What it adds:
--   * Every wave-2 Explore table, column, check and foreign key, so the groups file (M2, 20261124100010) and the Admin
--     file (M3, 20261124100020) add only functions, policies, triggers and cron jobs: stories with their views and likes,
--     member sanctions, the storage trash, conversations, their sides and messages, communities and their members,
--     challenges with templates, entries and badges, and the moderation record. Each new table has row level security on;
--     the group tables have only own-row read policies (a member's own messages, sides, memberships, entries and
--     badges) until M2 adds the policies for other members' rows.
--   * Moderation states on posts, comments, stories, messages and communities ('visible', 'limited' or 'hidden').
--     Limited: only the owner, the owner's accepted followers and, for a community post, its accepted members see it, and
--     it is left out of every discovery surface. Hidden: only the owner sees it (shown as "Hidden by FITX").
--   * Item-level visibility helpers (fitx_social_sees_post, _sees_comment_row, _sees_story, _sees_community and
--     _post_listed) beside the account-level ones, and every read that serves another member's posts, comments or stories
--     switched to them. A post in a private community needs accepted membership; communities need an adult viewer.
--   * Sanctions: an active 'explore' sanction stops the member's own Explore use (social_suspended) and hides their
--     posts, comments and stories from everyone else; 'upload' stops uploads. Deleting, blocking, unblocking, reporting,
--     unfollowing, the notification and privacy reads and "Your Explore content" stay open (fitx_social_member_any), and
--     so does all of it while Explore is switched off in Admin (platform_settings.features.explore = false).
--   * Age bands from profiles.date_of_birth, else profiles.age: adult (18+), teen (13 to 17), child (under 13, no Explore
--     profile) or unknown (teen rules). Members with no date of birth can add one once (fitx_social_set_birth_date);
--     a saved date of birth is then changed or cleared only by FITX support (trigger profiles_birth_date_locked), and one
--     a member adds from Profile after making an Explore profile is stamped for Admin too (profiles_birth_date_added).
--   * Safety fixes: a report accepts content addressed to the reporter even across a block, and an account report no
--     longer needs the reported member to be unblocked; restricting is rate limited. Reports snapshot their evidence.
--   * Stories (24 hours, photo or video), video posts (one video of at most 30 s with a poster), the video switch
--     (features.explore_video, off unless saved as true) enforced here, project caps (fitx_social_caps), the daily play
--     budget for signed video links (fitx_social_video_link_allowed: each video counted once a member a day, and a
--     member's share of the project's plays capped), the notification preferences for stories,
--     challenges, communities and messages, Realtime pings, and the hourly clean-up job (fitx-social-hourly).
--   * The social-media bucket now also takes video/mp4 (still 3 MB a file). Another member's .mp4 is never signed by
--     the member's own key: video links come only from the server route, which checks the budget first.
--
-- Wave-1 clients keep working between the apply and the deploy: every function they call keeps its name and arguments
-- (fitx_social_save_notification_prefs gains four parameters with defaults, so its five-argument call still resolves);
-- tests/social/compat-sql.test.mjs calls each of them. Functions are recreated with `create or replace` under the same
-- signatures (4.2 of the wave-2 brief lists the one defining file of each).
--
-- Additive and safe to run again: create table/index if not exists, add column if not exists, named checks dropped and
-- added again, create or replace, drop policy if exists before each policy, guarded blocks for pg_cron and Realtime.
-- It deletes no row. One relaxation: social_notifications.actor_id may now be null (notices that name no member).
--
-- Undo (deletes every story, message, community, challenge, sanction and moderation record, every video, text,
-- community and challenge post, and every limited or hidden post and comment, since part 1's reads would show them
-- to everyone; then re-run 20261123100060_fitx_social_v1.sql to restore the part-1 function bodies, policies and the
-- bucket's two MIME types):
--   begin;
--   do $u$ begin if pg_catalog.to_regnamespace('cron') is not null then
--     execute $e$select cron.unschedule(jobid) from cron.job where jobname = 'fitx-social-hourly'$e$; end if; end $u$;
--   do $u$ begin if pg_catalog.to_regclass('realtime.messages') is not null then drop policy if exists social_inbox_read on realtime.messages; end if; end $u$;
--   drop trigger if exists profiles_birth_date_locked on public.profiles;
--   drop trigger if exists profiles_birth_date_added on public.profiles;
--   drop function if exists public.fitx_profiles_birth_date_locked(), public.fitx_profiles_birth_date_added();
--   drop index if exists public.social_rate_counters_video_day_idx;
--   alter table public.social_rate_counters drop column if exists paths;
--   drop function if exists public.fitx_social_save_notification_prefs(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean);
--   drop function if exists public.fitx_social_sees_post(uuid, uuid), public.fitx_social_sees_comment_row(uuid, uuid),
--     public.fitx_social_sees_story(uuid, uuid), public.fitx_social_sees_community(uuid, uuid), public.fitx_social_post_listed(uuid),
--     public.fitx_social_viewer_sees_comment_row(uuid), public.fitx_social_viewer_sees_story(uuid), public.fitx_social_viewer_sees_community(uuid),
--     public.fitx_social_member_any(), public.fitx_social_age_band(uuid), public.fitx_social_set_birth_date(date),
--     public.fitx_social_insert_post(uuid, uuid, text, text, jsonb, text, jsonb, uuid, uuid), public.fitx_social_caps(),
--     public.fitx_social_video_link_allowed(text[]), public.fitx_social_ping(uuid, text, uuid),
--     public.fitx_social_create_story(uuid, text, text, text, integer, integer, integer, text), public.fitx_social_delete_story(uuid),
--     public.fitx_social_story_tray(), public.fitx_social_stories(uuid), public.fitx_social_view_story(uuid),
--     public.fitx_social_story_viewers(uuid), public.fitx_social_set_story_like(uuid, boolean),
--     public.fitx_social_my_content(timestamptz, integer), public.fitx_social_delete_all_content(), public.fitx_social_hourly() cascade;
--   delete from public.social_notifications where actor_id is null or type not in ('follow', 'follow_request', 'follow_accepted', 'like', 'comment', 'reply', 'mention');
--   delete from public.social_reports where target_type not in ('post', 'comment', 'account');
--   delete from public.social_posts where kind <> 'photo' or community_id is not null or challenge_id is not null
--     or moderation_state <> 'visible';
--   delete from public.social_comments where moderation_state <> 'visible';
--   drop table if exists public.social_moderation_actions, public.social_challenge_badges, public.social_challenge_entries,
--     public.social_challenge_templates, public.social_messages, public.social_conversation_sides, public.social_conversations,
--     public.social_community_members, public.social_story_likes, public.social_story_views, public.social_member_sanctions,
--     public.social_storage_trash cascade;
--   alter table public.social_posts drop constraint if exists social_posts_community_id_fkey, drop constraint if exists social_posts_challenge_id_fkey;
--   drop table if exists public.social_challenges, public.social_communities, public.social_stories cascade;
--   alter table public.social_posts drop column if exists moderation_state, drop column if exists moderated_at;
--   alter table public.social_comments drop column if exists moderation_state, drop column if exists moderated_at;
--   alter table public.social_post_media drop column if exists poster_path;
--   alter table public.social_notifications drop column if exists story_id, drop column if exists conversation_id,
--     drop column if exists community_id, drop column if exists challenge_id;
--   alter table public.social_notifications alter column actor_id set not null;
--   alter table public.social_reports drop column if exists evidence, drop column if exists evidence_purge_at;
--   alter table public.social_profiles drop column if exists dm_policy, drop column if exists birth_date_added_at;
--   alter table public.social_notification_prefs drop column if exists stories, drop column if exists challenges,
--     drop column if exists communities, drop column if exists messages;
--   alter table public.social_posts drop constraint if exists social_posts_kind_check, add constraint social_posts_kind_check check (kind in ('photo'));
--   alter table public.social_post_media drop constraint if exists social_post_media_kind_check, add constraint social_post_media_kind_check check (kind in ('image'));
--   alter table public.social_notifications drop constraint if exists social_notifications_type_check, add constraint social_notifications_type_check
--     check (type in ('follow', 'follow_request', 'follow_accepted', 'like', 'comment', 'reply', 'mention'));
--   alter table public.social_notifications drop constraint if exists social_notifications_entity_type_check,
--     add constraint social_notifications_entity_type_check check (entity_type in ('profile', 'post', 'comment'));
--   alter table public.social_reports drop constraint if exists social_reports_target_type_check,
--     add constraint social_reports_target_type_check check (target_type in ('post', 'comment', 'account'));
--   commit;
--   -- then: \i 20261123100060_fitx_social_v1.sql (or paste it), and remove any .mp4 files from the bucket in the dashboard.

do $do$ begin perform pg_catalog.set_config('lock_timeout', '5s', true); end $do$;

-- 1. New tables -------------------------------------------------------------------------------------------------------

-- Stories: one photo or video, live for 24 hours. Files at <uid>/<story id>/0.(webp|jpg|mp4) and the video poster at
-- <uid>/<story id>/0p.webp.
create table if not exists public.social_stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  storage_path text not null,
  poster_path text,
  width integer not null,
  height integer not null,
  duration_ms integer,
  bytes bigint not null default 1,
  caption text not null default '',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  moderation_state text not null default 'visible',
  moderated_at timestamptz,
  unique (storage_path),
  constraint social_stories_kind_check check (kind in ('image', 'video')),
  constraint social_stories_size_check check (width between 1 and 4096 and height between 1 and 4096 and bytes between 1 and 52428800),
  constraint social_stories_duration_check check (
    (kind = 'image' and duration_ms is null) or (kind = 'video' and duration_ms between 1 and 15000)),
  constraint social_stories_caption_check check (char_length(caption) <= 200),
  constraint social_stories_expiry_check check (expires_at <= created_at + interval '24 hours'),
  constraint social_stories_moderation_state_check check (moderation_state in ('visible', 'limited', 'hidden'))
);
create index if not exists social_stories_user_idx on public.social_stories (user_id, created_at desc);
create index if not exists social_stories_expires_idx on public.social_stories (expires_at);

-- Who viewed a story (the owner reads them through fitx_social_story_viewers only).
create table if not exists public.social_story_views (
  story_id uuid not null references public.social_stories (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (story_id, user_id)
);
create index if not exists social_story_views_user_idx on public.social_story_views (user_id);

create table if not exists public.social_story_likes (
  story_id uuid not null references public.social_stories (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (story_id, user_id)
);
create index if not exists social_story_likes_user_idx on public.social_story_likes (user_id);

-- Sanctions FITX moderators set in Admin. 'explore' suspends the member's Explore use and hides their content; 'dm'
-- stops direct messages; 'upload' stops uploads. until null means indefinite; lifted_at ends it early.
create table if not exists public.social_member_sanctions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  until timestamptz,
  reason_code text not null,
  created_by_operator uuid references public.admin_operators (id) on delete set null,
  created_at timestamptz not null default now(),
  lifted_at timestamptz,
  constraint social_member_sanctions_kind_check check (kind in ('explore', 'dm', 'upload')),
  constraint social_member_sanctions_reason_check check (reason_code ~ '^[a-z_]{1,40}$'),
  constraint social_member_sanctions_until_check check (until is null or until > created_at)
);
create index if not exists social_member_sanctions_user_idx on public.social_member_sanctions (user_id, kind) where lifted_at is null;
create index if not exists social_member_sanctions_operator_idx on public.social_member_sanctions (created_by_operator);

-- Files waiting to be removed through the Storage API by /api/social/sweep (a SQL delete would orphan the object).
create table if not exists public.social_storage_trash (
  path text primary key,
  queued_at timestamptz not null default now(),
  reason text not null,
  constraint social_storage_trash_reason_check check (reason in ('story_expired', 'orphan', 'removed', 'deleted'))
);

-- Direct messages (M2 adds the functions and policies). One conversation per pair, user_low < user_high.
create table if not exists public.social_conversations (
  id uuid primary key default gen_random_uuid(),
  user_low uuid not null references auth.users (id) on delete cascade,
  user_high uuid not null references auth.users (id) on delete cascade,
  status text not null default 'request',
  requested_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  unique (user_low, user_high),
  constraint social_conversations_order_check check (user_low < user_high),
  constraint social_conversations_status_check check (status in ('request', 'accepted')),
  constraint social_conversations_requested_by_check check (requested_by in (user_low, user_high))
);
create index if not exists social_conversations_high_idx on public.social_conversations (user_high);
create index if not exists social_conversations_requested_idx on public.social_conversations (requested_by);

create table if not exists public.social_conversation_sides (
  conversation_id uuid not null references public.social_conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_read_at timestamptz,
  hidden_at timestamptz,
  muted boolean not null default false,
  read_receipts boolean not null default false,
  primary key (conversation_id, user_id)
);
create index if not exists social_conversation_sides_user_idx on public.social_conversation_sides (user_id);

-- Communities, created by FITX in Admin (O3 a). Covers at communities/<id>/cover.webp, written with the service key.
create table if not exists public.social_communities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null default '',
  visibility text not null default 'public',
  cover_path text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  moderation_state text not null default 'visible',
  moderated_at timestamptz,
  constraint social_communities_slug_check check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  constraint social_communities_name_check check (char_length(btrim(name)) between 1 and 60),
  constraint social_communities_description_check check (char_length(description) <= 500),
  constraint social_communities_visibility_check check (visibility in ('public', 'private')),
  constraint social_communities_cover_check check (cover_path is null or cover_path = 'communities/' || id::text || '/cover.webp'),
  constraint social_communities_moderation_state_check check (moderation_state in ('visible', 'limited', 'hidden'))
);
create index if not exists social_communities_created_by_idx on public.social_communities (created_by);

create table if not exists public.social_community_members (
  community_id uuid not null references public.social_communities (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member',
  status text not null default 'pending',
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id),
  constraint social_community_members_role_check check (role in ('owner', 'moderator', 'member')),
  constraint social_community_members_status_check check (status in ('pending', 'accepted'))
);
create index if not exists social_community_members_user_idx on public.social_community_members (user_id, status);

-- Challenges (FITX-written templates and challenges; members join, values are computed from their own rows in M2).
create table if not exists public.social_challenge_templates (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  title text not null,
  metric text not null,
  sport text,
  target numeric,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint social_challenge_templates_kind_check check (kind in ('weekly', 'monthly')),
  constraint social_challenge_templates_title_check check (char_length(btrim(title)) between 1 and 80),
  constraint social_challenge_templates_metric_check check (metric in ('workouts', 'active_minutes', 'distance_km', 'active_days')),
  constraint social_challenge_templates_sport_check check (sport is null or sport ~ '^[a-z_]{1,30}$'),
  constraint social_challenge_templates_target_check check (target is null or target > 0)
);

create table if not exists public.social_challenges (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  title text not null,
  metric text not null,
  sport text,
  target numeric,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  community_id uuid references public.social_communities (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  template_id uuid references public.social_challenge_templates (id) on delete set null,
  closed_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  constraint social_challenges_kind_check check (kind in ('weekly', 'monthly')),
  constraint social_challenges_title_check check (char_length(btrim(title)) between 1 and 80),
  constraint social_challenges_metric_check check (metric in ('workouts', 'active_minutes', 'distance_km', 'active_days')),
  constraint social_challenges_sport_check check (sport is null or sport ~ '^[a-z_]{1,30}$'),
  constraint social_challenges_target_check check (target is null or target > 0),
  constraint social_challenges_window_check check (ends_at > starts_at)
);
create index if not exists social_challenges_open_idx on public.social_challenges (ends_at) where closed_at is null;
create index if not exists social_challenges_community_idx on public.social_challenges (community_id);
create index if not exists social_challenges_template_idx on public.social_challenges (template_id);
create index if not exists social_challenges_created_by_idx on public.social_challenges (created_by);

create table if not exists public.social_challenge_entries (
  challenge_id uuid not null references public.social_challenges (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  value numeric not null default 0,
  on_leaderboard boolean not null default false,
  synced_at timestamptz,
  primary key (challenge_id, user_id),
  constraint social_challenge_entries_value_check check (value >= 0)
);
create index if not exists social_challenge_entries_user_idx on public.social_challenge_entries (user_id);

create table if not exists public.social_challenge_badges (
  challenge_id uuid not null references public.social_challenges (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  awarded_at timestamptz not null default now(),
  primary key (challenge_id, user_id, kind),
  constraint social_challenge_badges_kind_check check (kind in ('completed', 'top3'))
);
create index if not exists social_challenge_badges_user_idx on public.social_challenge_badges (user_id);

-- Messages: bodies are blanked on unsend (deleted_at set).
create table if not exists public.social_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.social_conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null default '',
  shared_post_id uuid references public.social_posts (id) on delete set null,
  story_id uuid references public.social_stories (id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  moderation_state text not null default 'visible',
  moderated_at timestamptz,
  constraint social_messages_body_check check (char_length(body) <= 2000),
  constraint social_messages_moderation_state_check check (moderation_state in ('visible', 'limited', 'hidden'))
);
create index if not exists social_messages_conversation_idx on public.social_messages (conversation_id, created_at desc, id desc);
create index if not exists social_messages_user_idx on public.social_messages (user_id, created_at desc);
create index if not exists social_messages_post_idx on public.social_messages (shared_post_id) where shared_post_id is not null;
create index if not exists social_messages_story_idx on public.social_messages (story_id) where story_id is not null;

-- What moderators did (operators in Admin, or community moderators). Service role only.
create table if not exists public.social_moderation_actions (
  id uuid primary key default gen_random_uuid(),
  actor_kind text not null,
  operator_id uuid references public.admin_operators (id) on delete set null,
  community_id uuid references public.social_communities (id) on delete set null,
  action text not null,
  target_type text not null,
  target_id uuid,
  target_user_id uuid references auth.users (id) on delete set null,
  reason_code text,
  note text,
  report_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  reversed_at timestamptz,
  constraint social_moderation_actions_actor_kind_check check (actor_kind in ('operator', 'member')),
  constraint social_moderation_actions_action_check check (action ~ '^[a-z_]{1,40}$'),
  constraint social_moderation_actions_target_type_check check (target_type ~ '^[a-z_]{1,40}$'),
  constraint social_moderation_actions_note_check check (note is null or char_length(note) <= 1000)
);
create index if not exists social_moderation_actions_target_idx on public.social_moderation_actions (target_type, target_id);
create index if not exists social_moderation_actions_user_idx on public.social_moderation_actions (target_user_id);
create index if not exists social_moderation_actions_operator_idx on public.social_moderation_actions (operator_id);
create index if not exists social_moderation_actions_community_idx on public.social_moderation_actions (community_id);

-- 2. New columns and widened checks on part-1 tables ---------------------------------------------------------------

alter table public.social_posts add column if not exists moderation_state text not null default 'visible';
alter table public.social_posts add column if not exists moderated_at timestamptz;
alter table public.social_comments add column if not exists moderation_state text not null default 'visible';
alter table public.social_comments add column if not exists moderated_at timestamptz;
alter table public.social_post_media add column if not exists poster_path text;
alter table public.social_profiles add column if not exists dm_policy text not null default 'followers';
alter table public.social_profiles add column if not exists birth_date_added_at timestamptz;
alter table public.social_notification_prefs add column if not exists stories boolean not null default true;
alter table public.social_notification_prefs add column if not exists challenges boolean not null default true;
alter table public.social_notification_prefs add column if not exists communities boolean not null default true;
alter table public.social_notification_prefs add column if not exists messages boolean not null default true;
alter table public.social_reports add column if not exists evidence jsonb;
alter table public.social_reports add column if not exists evidence_purge_at timestamptz;
-- On a member's 'video_bytes:day' row only: the videos their signed links were counted for that day, so a new link to
-- a video already counted today costs nothing (fitx_social_video_link_allowed). Members still only read their own rows.
alter table public.social_rate_counters add column if not exists paths text[];
-- The project's played video bytes today are a sum over every member's 'video_bytes:day' row (the play budget and
-- Admin's meter); the primary key starts with user_id, so that sum needs its own index.
create index if not exists social_rate_counters_video_day_idx on public.social_rate_counters (window_start)
  where action = 'video_bytes:day';
alter table public.social_notifications add column if not exists story_id uuid references public.social_stories (id) on delete cascade;
alter table public.social_notifications add column if not exists conversation_id uuid references public.social_conversations (id) on delete cascade;
alter table public.social_notifications add column if not exists community_id uuid references public.social_communities (id) on delete cascade;
alter table public.social_notifications add column if not exists challenge_id uuid references public.social_challenges (id) on delete cascade;
-- Notices from FITX (a reviewed report, a badge, a message request) name no member.
alter table public.social_notifications alter column actor_id drop not null;

create index if not exists social_notifications_story_idx on public.social_notifications (story_id) where story_id is not null;
create index if not exists social_notifications_conversation_idx on public.social_notifications (conversation_id) where conversation_id is not null;
create index if not exists social_notifications_community_idx on public.social_notifications (community_id) where community_id is not null;
create index if not exists social_notifications_challenge_idx on public.social_notifications (challenge_id) where challenge_id is not null;
create index if not exists social_notifications_created_idx on public.social_notifications (created_at);
create index if not exists social_posts_community_idx on public.social_posts (community_id, created_at desc, id desc) where community_id is not null;
create index if not exists social_posts_challenge_idx on public.social_posts (challenge_id) where challenge_id is not null;
create index if not exists social_reports_target_idx on public.social_reports (target_type, target_id, status);

do $do$
declare
  v_table text;
  v_checks text[][] := array[
    ['social_posts', 'social_posts_kind_check', $c$kind in ('photo', 'video', 'text')$c$],
    ['social_post_media', 'social_post_media_kind_check', $c$kind in ('image', 'video')$c$],
    ['social_post_media', 'social_post_media_poster_check',
      $c$poster_path is null or poster_path ~ ('^' || user_id::text || '/' || post_id::text || '/[0-9]p[.]webp$')$c$],
    ['social_profiles', 'social_profiles_dm_policy_check', $c$dm_policy in ('everyone', 'followers', 'mutuals', 'off')$c$],
    ['social_notifications', 'social_notifications_type_check',
      $c$type in ('follow', 'follow_request', 'follow_accepted', 'like', 'comment', 'reply', 'mention', 'story_like', 'story_reply',
        'challenge_invite', 'challenge_badge', 'community_request', 'community_invite', 'community_accepted', 'message_request',
        'message', 'report_reviewed')$c$],
    ['social_notifications', 'social_notifications_entity_type_check',
      $c$entity_type in ('profile', 'post', 'comment', 'story', 'challenge', 'community', 'conversation', 'message')$c$],
    ['social_reports', 'social_reports_target_type_check',
      $c$target_type in ('post', 'comment', 'account', 'story', 'message', 'community', 'challenge')$c$],
    ['social_reports', 'social_reports_evidence_check',
      $c$evidence is null or (pg_catalog.jsonb_typeof(evidence) = 'object' and pg_catalog.octet_length(evidence::text) <= 8192)$c$]
  ];
  v_row integer;
begin
  for v_row in 1 .. pg_catalog.array_length(v_checks, 1) loop
    execute pg_catalog.format('alter table public.%I drop constraint if exists %I', v_checks[v_row][1], v_checks[v_row][2]);
    execute pg_catalog.format('alter table public.%I add constraint %I check (%s)', v_checks[v_row][1], v_checks[v_row][2], v_checks[v_row][3]);
  end loop;
  foreach v_table in array array['social_posts', 'social_comments'] loop
    execute pg_catalog.format('alter table public.%I drop constraint if exists %I', v_table, v_table || '_moderation_state_check');
    execute pg_catalog.format($f$alter table public.%I add constraint %I check (moderation_state in ('visible', 'limited', 'hidden'))$f$,
      v_table, v_table || '_moderation_state_check');
  end loop;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.social_posts'::regclass and conname = 'social_posts_community_id_fkey') then
    alter table public.social_posts add constraint social_posts_community_id_fkey
      foreign key (community_id) references public.social_communities (id) on delete cascade;
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.social_posts'::regclass and conname = 'social_posts_challenge_id_fkey') then
    alter table public.social_posts add constraint social_posts_challenge_id_fkey
      foreign key (challenge_id) references public.social_challenges (id) on delete set null;
  end if;
end $do$;

-- 3. Row level security on the new tables ---------------------------------------------------------------------------

do $do$
declare
  v_table text;
begin
  foreach v_table in array array[
    'social_stories', 'social_story_views', 'social_story_likes', 'social_member_sanctions', 'social_storage_trash',
    'social_conversations', 'social_conversation_sides', 'social_messages', 'social_communities', 'social_community_members',
    'social_challenge_templates', 'social_challenges', 'social_challenge_entries', 'social_challenge_badges',
    'social_moderation_actions'
  ] loop
    execute pg_catalog.format('alter table public.%I enable row level security', v_table);
    execute pg_catalog.format('revoke all on table public.%I from public, anon, authenticated', v_table);
    execute pg_catalog.format('grant all on table public.%I to service_role', v_table);
  end loop;
end $do$;

-- Members read these through the policies below; the groups file (M2) adds the policies that let a member read other
-- members' rows (a conversation's messages, a community's members, a challenge's board). The trash, the moderation
-- record and the challenge templates stay service-role only; members read only some columns of their own sanctions
-- (not who set them).
revoke all on table public.social_storage_trash from public, anon, authenticated;
revoke all on table public.social_moderation_actions from public, anon, authenticated;
revoke all on table public.social_challenge_templates from public, anon, authenticated;
revoke all on table public.social_member_sanctions from public, anon, authenticated;
grant select (id, user_id, kind, until, reason_code, created_at, lifted_at) on table public.social_member_sanctions to authenticated;
grant select on public.social_stories, public.social_story_views, public.social_story_likes, public.social_conversations,
  public.social_conversation_sides, public.social_messages, public.social_communities, public.social_community_members,
  public.social_challenges, public.social_challenge_entries, public.social_challenge_badges
  to authenticated;

-- 4. Visibility helpers -----------------------------------------------------------------------------------------------

-- Account level (same signatures as part 1): an owner under an active 'explore' sanction is seen by nobody else.
create or replace function public.fitx_social_sees_posts(p_viewer uuid, p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_viewer is not null and (
    p_viewer = p_owner
    or (not exists (select 1 from public.social_member_sanctions s
                    where s.user_id = p_owner and s.kind = 'explore' and s.lifted_at is null
                      and (s.until is null or s.until > pg_catalog.now()))
        and not public.fitx_social_blocked(p_viewer, p_owner)
        and (exists (select 1 from public.social_profiles p where p.user_id = p_owner and not p.is_private)
             or exists (select 1 from public.social_follows f
                        where f.user_id = p_viewer and f.following_id = p_owner and f.status = 'accepted'))));
$function$;

create or replace function public.fitx_social_sees_comment(p_viewer uuid, p_author uuid, p_post_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select public.fitx_social_sees_posts(p_viewer, p_post_owner)
    and (p_viewer = p_author or (not public.fitx_social_blocked(p_viewer, p_author)
         and not exists (select 1 from public.social_member_sanctions s
                         where s.user_id = p_author and s.kind = 'explore' and s.lifted_at is null
                           and (s.until is null or s.until > pg_catalog.now()))))
    and (p_viewer in (p_author, p_post_owner)
         or not exists (select 1 from public.social_restricts r where r.user_id = p_post_owner and r.restricted_id = p_author));
$function$;

-- The member's age band: adult (18+), teen (13 to 17), child (under 13) or unknown, from the date of birth, else the age.
create or replace function public.fitx_social_age_band(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce((
    select case
      when p.date_of_birth is not null then
        case when p.date_of_birth <= (current_date - interval '18 years')::date then 'adult'
             when p.date_of_birth <= (current_date - interval '13 years')::date then 'teen'
             else 'child' end
      when p.age is not null then
        case when p.age >= 18 then 'adult' when p.age >= 13 then 'teen' else 'child' end
      end
    from public.profiles p where p.id = p_user), 'unknown');
$function$;

-- Whether p_viewer sees a community: its creator always; otherwise an adult viewer, and the community is not hidden,
-- and it is public and visible, or the viewer is an accepted member (a limited community drops out for everyone else).
create or replace function public.fitx_social_sees_community(p_viewer uuid, p_community uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_viewer is not null and exists (
    select 1 from public.social_communities c
    where c.id = p_community and (
      c.created_by = p_viewer
      or (c.moderation_state <> 'hidden'
          and public.fitx_social_age_band(p_viewer) = 'adult'
          and ((c.visibility = 'public' and c.moderation_state = 'visible')
               or exists (select 1 from public.social_community_members m
                          where m.community_id = c.id and m.user_id = p_viewer and m.status = 'accepted')))));
$function$;

-- Whether p_viewer sees one post. The owner always (hidden ones too). Anyone else: not hidden, the owner not suspended
-- and no block; outside a community the owner's privacy decides, inside one the community does; a limited post needs an
-- accepted follow of the owner (or, in a community, accepted membership).
create or replace function public.fitx_social_sees_post(p_viewer uuid, p_post uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_viewer is not null and exists (
    select 1 from public.social_posts p
    where p.id = p_post and (
      p.user_id = p_viewer
      or (p.moderation_state <> 'hidden'
          and not public.fitx_social_blocked(p_viewer, p.user_id)
          and not exists (select 1 from public.social_member_sanctions s
                          where s.user_id = p.user_id and s.kind = 'explore' and s.lifted_at is null
                            and (s.until is null or s.until > pg_catalog.now()))
          and case when p.community_id is null then
                 public.fitx_social_sees_posts(p_viewer, p.user_id)
                 and (p.moderation_state = 'visible'
                      or exists (select 1 from public.social_follows f
                                 where f.user_id = p_viewer and f.following_id = p.user_id and f.status = 'accepted'))
               else
                 exists (select 1 from public.social_profiles a where a.user_id = p.user_id)
                 and public.fitx_social_sees_community(p_viewer, p.community_id)
                 and (p.moderation_state = 'visible'
                      or exists (select 1 from public.social_follows f
                                 where f.user_id = p_viewer and f.following_id = p.user_id and f.status = 'accepted')
                      or exists (select 1 from public.social_community_members m
                                 where m.community_id = p.community_id and m.user_id = p_viewer and m.status = 'accepted'))
               end)));
$function$;

-- Whether p_viewer sees one comment: its author always; anyone else needs the post, a comment that is not hidden (a
-- limited one reaches only the post's owner), no block with the author, the author not suspended, and, for a restricted
-- author, to be the post's owner.
create or replace function public.fitx_social_sees_comment_row(p_viewer uuid, p_comment uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_viewer is not null and exists (
    select 1 from public.social_comments c join public.social_posts p on p.id = c.post_id
    where c.id = p_comment and (
      c.user_id = p_viewer
      or (public.fitx_social_sees_post(p_viewer, c.post_id)
          and c.moderation_state <> 'hidden'
          and (c.moderation_state = 'visible' or p_viewer = p.user_id)
          and not public.fitx_social_blocked(p_viewer, c.user_id)
          and not exists (select 1 from public.social_member_sanctions s
                          where s.user_id = c.user_id and s.kind = 'explore' and s.lifted_at is null
                            and (s.until is null or s.until > pg_catalog.now()))
          and (p_viewer = p.user_id
               or not exists (select 1 from public.social_restricts r where r.user_id = p.user_id and r.restricted_id = c.user_id)))));
$function$;

-- Whether p_viewer sees one story: live only (expires_at in the future), the owner always, anyone else as the owner's
-- posts, not hidden, and a limited one only with an accepted follow.
create or replace function public.fitx_social_sees_story(p_viewer uuid, p_story uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_viewer is not null and exists (
    select 1 from public.social_stories s
    where s.id = p_story and s.expires_at > pg_catalog.now() and (
      s.user_id = p_viewer
      or (s.moderation_state <> 'hidden'
          and public.fitx_social_sees_posts(p_viewer, s.user_id)
          and (s.moderation_state = 'visible'
               or exists (select 1 from public.social_follows f
                          where f.user_id = p_viewer and f.following_id = s.user_id and f.status = 'accepted')))));
$function$;

-- Whether a post may appear on discovery surfaces (Discover, trending, hashtags, topics, search, suggestions): visible,
-- and not in a private, limited or hidden community. Always used with fitx_social_sees_post.
create or replace function public.fitx_social_post_listed(p_post uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from public.social_posts p
    where p.id = p_post and p.moderation_state = 'visible'
      and (p.community_id is null
           or exists (select 1 from public.social_communities c
                      where c.id = p.community_id and c.visibility = 'public' and c.moderation_state = 'visible')));
$function$;

-- For policies: the signed-in member's view only.
create or replace function public.fitx_social_viewer_sees_post(p_post uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select public.fitx_social_sees_post((select auth.uid()), p_post);
$function$;

-- Part 1's comment wrapper, kept for its signature: the post must be one the member sees.
create or replace function public.fitx_social_viewer_sees_comment(p_author uuid, p_post uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (select 1 from public.social_posts p
                 where p.id = p_post and public.fitx_social_sees_post((select auth.uid()), p.id)
                   and public.fitx_social_sees_comment((select auth.uid()), p_author, p.user_id));
$function$;

create or replace function public.fitx_social_viewer_sees_comment_row(p_comment uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select public.fitx_social_sees_comment_row((select auth.uid()), p_comment);
$function$;

create or replace function public.fitx_social_viewer_sees_story(p_story uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select public.fitx_social_sees_story((select auth.uid()), p_story);
$function$;

create or replace function public.fitx_social_viewer_sees_community(p_community uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select public.fitx_social_sees_community((select auth.uid()), p_community);
$function$;

-- The owner-tunable Free-plan caps (O9 a). To change one, run this function again with new numbers (no app change).
create or replace function public.fitx_social_caps()
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'social_media_bytes', 471859200,        -- 450 MB: every Explore file
    'video_bytes', 262144000,               -- 250 MB of it: videos and their posters
    'story_bytes', 62914560,                -- 60 MB of it: live stories
    'video_play_bytes_per_day', 78643200,   -- 75 MB a day of signed video links, about 25 plays
    'video_play_bytes_per_member_day', 15728640);  -- 15 MB of it per member (a fifth, about 5 plays)
$function$;

-- Storage: whether the signed-in member may read (and so sign a link to) a file in social-media. Owners read their own
-- files. Others: a profile picture of a profile they see, a photo or video poster of a post they see, a live story's
-- photo or poster they see, a community cover of a community they see. Never another member's .mp4: video links are
-- signed by the server route after the play budget (fitx_social_video_link_allowed).
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
  if v_uid is null or pg_catalog.cardinality(v_parts) <> 3 then
    return false;
  end if;
  if v_parts[1] = 'communities' then
    return v_parts[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and v_parts[3] = 'cover.webp'
      and exists (select 1 from public.social_communities c where c.id = v_parts[2]::uuid and c.cover_path = p_name)
      and public.fitx_social_sees_community(v_uid, v_parts[2]::uuid);
  end if;
  if v_parts[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
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
  if p_name ~ '[.]mp4$' then
    return false;
  end if;
  return exists (select 1 from public.social_post_media m
                 where (m.storage_path = p_name or m.poster_path = p_name) and m.user_id = v_owner
                   and public.fitx_social_sees_post(v_uid, m.post_id))
    or exists (select 1 from public.social_stories s
               where (s.storage_path = p_name or s.poster_path = p_name) and s.user_id = v_owner
                 and public.fitx_social_sees_story(v_uid, s.id));
end $function$;

-- Storage: whether the signed-in member may upload one more file to social-media at p_name: their own folder and an
-- expected name (<uid>/<id>/<n>.webp|jpg|mp4, a poster <uid>/<id>/<n>p.webp, or <uid>/profile/<name>.webp|jpg); Explore
-- switched on; no 'explore' or 'upload' sanction; a video only while explore_video is on, at most 3 a day and 20 kept;
-- fewer than 60 uploads in 24 hours; under 600 files and 150 MB per member; the project under its caps. Uploads are
-- counted when they are let in (deleting a file gives none back).
create or replace function public.fitx_social_upload_allowed(p_bucket text, p_name text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_hour timestamptz := pg_catalog.date_trunc('hour', pg_catalog.now());
  v_caps jsonb := public.fitx_social_caps();
  v_features jsonb;
  v_mp4 boolean := p_name ~ '[.]mp4$';
  v_video boolean := p_name ~ '/[0-9]([.]mp4|p[.]webp)$';
  v_files bigint;
  v_bytes bigint;
  v_recent bigint;
begin
  if v_uid is null or p_bucket is distinct from 'social-media'
     or p_name !~ ('^' || v_uid::text
                   || '/(profile/[a-z0-9-]{1,40}[.](webp|jpg)|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/([0-9][.](webp|jpg|mp4)|[0-9]p[.]webp))$') then
    return false;
  end if;
  select ps.features into v_features from public.platform_settings ps where ps.id = 1;
  if coalesce(v_features ->> 'explore', 'true') = 'false' or (v_mp4 and coalesce(v_features ->> 'explore_video', 'false') <> 'true') then
    return false;
  end if;
  if exists (select 1 from public.social_member_sanctions s
             where s.user_id = v_uid and s.kind in ('explore', 'upload') and s.lifted_at is null
               and (s.until is null or s.until > pg_catalog.now())) then
    return false;
  end if;
  select pg_catalog.count(*),
         coalesce(pg_catalog.sum(case when (o.metadata ->> 'size') ~ '^[0-9]{1,15}$' then (o.metadata ->> 'size')::bigint end), 0)
    into v_files, v_bytes
  from storage.objects o
  where o.bucket_id = 'social-media' and o.name like v_uid::text || '/%';
  if v_files >= 600 or v_bytes >= 150 * 1024 * 1024 then
    return false;
  end if;
  select coalesce(pg_catalog.sum(case when (o.metadata ->> 'size') ~ '^[0-9]{1,15}$' then (o.metadata ->> 'size')::bigint end), 0)
    into v_bytes
  from storage.objects o where o.bucket_id = 'social-media';
  if v_bytes >= (v_caps ->> 'social_media_bytes')::bigint then
    return false;
  end if;
  if v_video then
    select coalesce(pg_catalog.sum(case when (o.metadata ->> 'size') ~ '^[0-9]{1,15}$' then (o.metadata ->> 'size')::bigint end), 0)
      into v_bytes
    from storage.objects o where o.bucket_id = 'social-media' and o.name ~ '/[0-9]([.]mp4|p[.]webp)$';
    if v_bytes >= (v_caps ->> 'video_bytes')::bigint then
      return false;
    end if;
  end if;
  if v_mp4 then
    if (select pg_catalog.count(*) from storage.objects o
        where o.bucket_id = 'social-media' and o.name like v_uid::text || '/%' and o.name ~ '[.]mp4$') >= 20 then
      return false;
    end if;
    select coalesce(pg_catalog.sum(c.hits), 0) into v_recent
    from public.social_rate_counters c
    where c.user_id = v_uid and c.action = 'upload_video:hour' and c.window_start > pg_catalog.now() - interval '24 hours';
    if v_recent >= 3 then
      return false;
    end if;
  end if;
  select coalesce(pg_catalog.sum(c.hits), 0) into v_recent
  from public.social_rate_counters c
  where c.user_id = v_uid and c.action = 'upload:hour' and c.window_start > pg_catalog.now() - interval '24 hours';
  if v_recent >= 60 then
    return false;
  end if;
  insert into public.social_rate_counters as c (user_id, action, window_start, hits)
  values (v_uid, 'upload:hour', v_hour, 1)
  on conflict (user_id, action, window_start) do update set hits = c.hits + 1;
  if v_mp4 then
    insert into public.social_rate_counters as c (user_id, action, window_start, hits)
    values (v_uid, 'upload_video:hour', v_hour, 1)
    on conflict (user_id, action, window_start) do update set hits = c.hits + 1;
  end if;
  delete from public.social_rate_counters c
  where c.user_id = v_uid and c.action in ('upload:hour', 'upload_video:hour') and c.window_start < pg_catalog.now() - interval '2 days';
  return true;
end $function$;

revoke all on function public.fitx_social_sees_posts(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fitx_social_sees_comment(uuid, uuid, uuid) from public, anon, authenticated;
do $do$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'fitx_social_age_band(uuid)', 'fitx_social_sees_community(uuid, uuid)', 'fitx_social_sees_post(uuid, uuid)',
    'fitx_social_sees_comment_row(uuid, uuid)', 'fitx_social_sees_story(uuid, uuid)', 'fitx_social_post_listed(uuid)'
  ] loop
    execute pg_catalog.format('revoke all on function public.%s from public, anon, authenticated', v_fn);
    execute pg_catalog.format('grant execute on function public.%s to service_role', v_fn);
  end loop;
  foreach v_fn in array array[
    'fitx_social_viewer_sees_post(uuid)', 'fitx_social_viewer_sees_comment(uuid, uuid)', 'fitx_social_viewer_sees_comment_row(uuid)',
    'fitx_social_viewer_sees_story(uuid)', 'fitx_social_viewer_sees_community(uuid)', 'fitx_social_can_read_object(text)',
    'fitx_social_upload_allowed(text, text)', 'fitx_social_caps()'
  ] loop
    execute pg_catalog.format('revoke all on function public.%s from public, anon', v_fn);
    execute pg_catalog.format('grant execute on function public.%s to authenticated, service_role', v_fn);
  end loop;
end $do$;

-- 5. Policies -----------------------------------------------------------------------------------------------------------

drop policy if exists social_posts_read on public.social_posts;
create policy social_posts_read on public.social_posts for select to authenticated
  using ((select public.fitx_social_viewer_sees_post(id)));

drop policy if exists social_post_media_read on public.social_post_media;
create policy social_post_media_read on public.social_post_media for select to authenticated
  using ((select public.fitx_social_viewer_sees_post(post_id)));

drop policy if exists social_post_hashtags_read on public.social_post_hashtags;
create policy social_post_hashtags_read on public.social_post_hashtags for select to authenticated
  using ((select public.fitx_social_viewer_sees_post(post_id)));

drop policy if exists social_comments_read on public.social_comments;
create policy social_comments_read on public.social_comments for select to authenticated
  using ((select public.fitx_social_viewer_sees_comment_row(id)));

drop policy if exists social_stories_read on public.social_stories;
create policy social_stories_read on public.social_stories for select to authenticated
  using ((select public.fitx_social_viewer_sees_story(id)));

drop policy if exists social_communities_read on public.social_communities;
create policy social_communities_read on public.social_communities for select to authenticated
  using ((select public.fitx_social_viewer_sees_community(id)));

-- Open challenges FITX set up (outside a community, or in one the member sees). M2 may replace this policy.
drop policy if exists social_challenges_read on public.social_challenges;
create policy social_challenges_read on public.social_challenges for select to authenticated
  using (community_id is null or (select public.fitx_social_viewer_sees_community(community_id)));

-- A member's own rows only, so "Download my data" and the member's own screens work from this file on. M2 adds the
-- policies for other members' rows beside these (and may drop and recreate them under its own names).
drop policy if exists social_conversations_own_read on public.social_conversations;
create policy social_conversations_own_read on public.social_conversations for select to authenticated
  using ((select auth.uid()) in (user_low, user_high));
do $do$
declare
  v_table text;
begin
  foreach v_table in array array['social_conversation_sides', 'social_messages', 'social_community_members',
                                 'social_challenge_entries', 'social_challenge_badges'] loop
    execute pg_catalog.format('drop policy if exists %I on public.%I', v_table || '_own_read', v_table);
    execute pg_catalog.format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))',
      v_table || '_own_read', v_table);
  end loop;
end $do$;

do $do$
declare
  v_table text;
begin
  foreach v_table in array array['social_story_views', 'social_story_likes', 'social_member_sanctions'] loop
    execute pg_catalog.format('drop policy if exists %I on public.%I', v_table || '_read', v_table);
    execute pg_catalog.format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))',
      v_table || '_read', v_table);
  end loop;
end $do$;

-- Realtime: members receive only their own inbox pings (private broadcast; there is no insert policy).
do $do$
begin
  if pg_catalog.to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists social_inbox_read on realtime.messages';
    execute $p$create policy social_inbox_read on realtime.messages for select to authenticated
      using (realtime.topic() = 'social:inbox:' || (select auth.uid())::text and extension = 'broadcast')$p$;
  end if;
end $do$;

-- 6. The bucket (replaced: it also takes video/mp4) ----------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('social-media', 'social-media', false, 3145728, array['image/webp', 'image/jpeg', 'video/mp4']::text[])
on conflict (id) do update set public = false, file_size_limit = 3145728,
  allowed_mime_types = array['image/webp', 'image/jpeg', 'video/mp4']::text[];

-- 7. Internal building blocks ------------------------------------------------------------------------------------------

-- The signed-in member, who must have an Explore profile, with Explore switched on and no active 'explore' sanction.
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
  if coalesce((select ps.features ->> 'explore' from public.platform_settings ps where ps.id = 1), 'true') = 'false' then
    raise exception using errcode = 'P0001', message = 'social_unavailable';
  end if;
  if not exists (select 1 from public.social_profiles p where p.user_id = v_uid) then
    raise exception using errcode = 'P0001', message = 'social_no_profile';
  end if;
  if exists (select 1 from public.social_member_sanctions s
             where s.user_id = v_uid and s.kind = 'explore' and s.lifted_at is null
               and (s.until is null or s.until > pg_catalog.now())) then
    raise exception using errcode = 'P0001', message = 'social_suspended';
  end if;
  return v_uid;
end $function$;

-- The signed-in member with an Explore profile, without the switch and sanction checks: for deleting, leaving, blocking,
-- reporting and reading one's own settings and content, which stay open while suspended or switched off.
create or replace function public.fitx_social_member_any()
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

-- Sends ids only (never content) to the member's private Realtime topic. A ping can never fail the write that sent it.
create or replace function public.fitx_social_ping(p_user uuid, p_kind text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_user is null or pg_catalog.to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then
    return;
  end if;
  begin
    execute 'select realtime.send($1, $2, $3, true)'
      using pg_catalog.jsonb_build_object('kind', p_kind, 'id', p_id), 'ping', 'social:inbox:' || p_user::text;
  exception when others then
    null;
  end;
end $function$;

-- Whether p_viewer may comment on p_post now.
create or replace function public.fitx_social_can_comment(p_viewer uuid, p_post public.social_posts)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_viewer is not null
    and public.fitx_social_sees_post(p_viewer, p_post.id)
    and case p_post.comment_policy
      when 'everyone' then true
      when 'followers' then p_viewer = p_post.user_id or exists (
        select 1 from public.social_follows f where f.user_id = p_viewer and f.following_id = p_post.user_id and f.status = 'accepted')
      else false end;
$function$;

-- A post as p_viewer sees it. `moderation` is set only for the owner of a limited or hidden post.
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
    'community_id', p_post.community_id,
    'challenge_id', p_post.challenge_id,
    'moderation', case when p_post.user_id = p_viewer and p_post.moderation_state <> 'visible' then p_post.moderation_state end,
    'author', public.fitx_social_author_json(p_post.user_id),
    'media', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('path', m.storage_path, 'width', m.width,
                         'height', m.height, 'kind', m.kind, 'alt', m.alt_text, 'poster_path', m.poster_path,
                         'duration_ms', m.duration_ms) order by m.position)
                       from public.social_post_media m where m.post_id = p_post.id), '[]'::jsonb),
    'like_count', (select pg_catalog.count(*) from public.social_likes l
                   where l.post_id = p_post.id and not public.fitx_social_blocked(p_viewer, l.user_id)),
    'comment_count', (select pg_catalog.count(*) from public.social_comments c
                      where c.post_id = p_post.id and public.fitx_social_sees_comment_row(p_viewer, c.id)),
    'liked', exists (select 1 from public.social_likes l where l.post_id = p_post.id and l.user_id = p_viewer),
    'saved', exists (select 1 from public.social_saves s where s.post_id = p_post.id and s.user_id = p_viewer),
    'mine', p_post.user_id = p_viewer,
    'can_comment', public.fitx_social_can_comment(p_viewer, p_post));
$function$;

-- Sends one notification, unless the recipient turned that kind off (the type-to-preference map below), blocks or
-- restricts the actor (restricted: likes, comments, replies, mentions and story interactions), or already has the same
-- one (likes, follows, story likes, community and challenge invites notify once). A message or message request
-- updates the conversation's one unread notice instead of adding another. Notices from FITX name no actor.
create or replace function public.fitx_social_notify(p_recipient uuid, p_actor uuid, p_type text, p_entity_type text,
  p_entity_id uuid, p_post uuid default null, p_comment uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_pref text;
  v_wanted boolean;
  v_story uuid;
  v_conversation uuid;
  v_community uuid;
  v_challenge uuid;
  v_id uuid;
begin
  if p_recipient is null or p_recipient = p_actor then
    return;
  end if;
  if p_actor is null and p_type not in ('report_reviewed', 'challenge_badge', 'message_request', 'community_accepted') then
    return;
  end if;
  if p_actor is not null and public.fitx_social_blocked(p_recipient, p_actor) then
    return;
  end if;
  if p_type in ('like', 'comment', 'reply', 'mention', 'story_like', 'story_reply')
     and exists (select 1 from public.social_restricts r where r.user_id = p_recipient and r.restricted_id = p_actor) then
    return;
  end if;
  v_pref := case p_type
    when 'follow' then 'follows' when 'follow_accepted' then 'follows' when 'follow_request' then 'follow_requests'
    when 'like' then 'likes' when 'comment' then 'comments' when 'reply' then 'comments' when 'mention' then 'mentions'
    when 'story_like' then 'stories' when 'story_reply' then 'stories'
    when 'challenge_invite' then 'challenges' when 'challenge_badge' then 'challenges'
    when 'community_request' then 'communities' when 'community_invite' then 'communities' when 'community_accepted' then 'communities'
    when 'message_request' then 'messages' when 'message' then 'messages'
    end;
  if v_pref is not null then
    select (pg_catalog.to_jsonb(np) ->> v_pref)::boolean into v_wanted
    from public.social_notification_prefs np where np.user_id = p_recipient;
    if v_wanted is false then
      return;
    end if;
  end if;
  v_story := case when p_entity_type = 'story' then p_entity_id end;
  v_community := case when p_entity_type = 'community' then p_entity_id end;
  v_challenge := case when p_entity_type = 'challenge' then p_entity_id end;
  v_conversation := case p_entity_type
    when 'conversation' then p_entity_id
    when 'message' then (select m.conversation_id from public.social_messages m where m.id = p_entity_id) end;
  if p_type in ('like', 'follow', 'follow_request', 'follow_accepted', 'story_like', 'community_invite', 'challenge_invite', 'community_request')
     and exists (select 1 from public.social_notifications n
                 where n.user_id = p_recipient and n.actor_id is not distinct from p_actor and n.type = p_type and n.entity_id = p_entity_id) then
    return;
  end if;
  if p_type in ('message', 'message_request') and v_conversation is not null then
    update public.social_notifications n set created_at = pg_catalog.now(), actor_id = p_actor, entity_type = p_entity_type,
      entity_id = p_entity_id
    where n.user_id = p_recipient and n.type = p_type and n.conversation_id = v_conversation and n.read_at is null
    returning n.id into v_id;
    if v_id is not null then
      perform public.fitx_social_ping(p_recipient, 'notification', v_id);
      return;
    end if;
  end if;
  insert into public.social_notifications (user_id, actor_id, type, entity_type, entity_id, post_id, comment_id, story_id,
    conversation_id, community_id, challenge_id)
  values (p_recipient, p_actor, p_type, p_entity_type, p_entity_id, p_post, p_comment, v_story, v_conversation, v_community, v_challenge)
  returning id into v_id;
  perform public.fitx_social_ping(p_recipient, 'notification', v_id);
end $function$;

-- Notifies the members a text mentions who can see the post (and, for a comment, the comment itself), once per text;
-- on an edit, only newly mentioned ones. A limited post or comment so reaches no one outside its audience.
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
      and public.fitx_social_sees_post(p.user_id, p_post.id)
      and (p_comment is null or public.fitx_social_sees_comment_row(p.user_id, p_comment))
  loop
    perform public.fitx_social_notify(v_target, p_actor, 'mention', case when p_comment is null then 'post' else 'comment' end,
      coalesce(p_comment, p_post.id), p_post.id, p_comment);
  end loop;
end $function$;

-- Whether p_viewer's notification p_n is shown: nothing from an account with a block either way or without an Explore
-- profile; a like, story like or follow only while it still stands, a follow request only while it waits; nothing
-- about a post, comment, story or community the viewer cannot see now, nor a conversation they are not a side of.
create or replace function public.fitx_social_notification_visible(p_viewer uuid, p_n public.social_notifications)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_n.user_id = p_viewer
    and (p_n.actor_id is null
         or (not public.fitx_social_blocked(p_viewer, p_n.actor_id)
             and exists (select 1 from public.social_profiles a where a.user_id = p_n.actor_id)))
    and (p_n.type <> 'like' or exists (select 1 from public.social_likes l where l.user_id = p_n.actor_id and l.post_id = p_n.post_id))
    and (p_n.type <> 'story_like' or exists (select 1 from public.social_story_likes l
                                             where l.user_id = p_n.actor_id and l.story_id = p_n.story_id))
    and (p_n.type <> 'follow' or exists (select 1 from public.social_follows f
                                         where f.user_id = p_n.actor_id and f.following_id = p_viewer and f.status = 'accepted'))
    and (p_n.type <> 'follow_request' or exists (select 1 from public.social_follows f
                                                 where f.user_id = p_n.actor_id and f.following_id = p_viewer and f.status = 'pending'))
    and (p_n.post_id is null or public.fitx_social_sees_post(p_viewer, p_n.post_id))
    and (p_n.comment_id is null or public.fitx_social_sees_comment_row(p_viewer, p_n.comment_id))
    and (p_n.story_id is null or public.fitx_social_sees_story(p_viewer, p_n.story_id))
    and (p_n.community_id is null or public.fitx_social_sees_community(p_viewer, p_n.community_id))
    and (p_n.conversation_id is null or exists (select 1 from public.social_conversation_sides s
                                                where s.conversation_id = p_n.conversation_id and s.user_id = p_viewer));
$function$;

-- Inserts a post for p_uid (who the caller already checked) whose files are already uploaded to <uid>/<p_post_id>/.
-- p_media: [{path, width, height, alt, kind?: 'image'|'video', poster_path?, duration_ms?}] in order. Photos: 1 to 10
-- items at <n>.webp|jpg. A video: exactly one item at 0.mp4 with its poster at 0p.webp and at most 30 s, only while
-- explore_video is on, within the video caps. A text post (no media) is allowed only in a community or a challenge
-- (M2's fitx_social_create_group_post), which also takes its own rate action; other posts take 'post'.
create or replace function public.fitx_social_insert_post(p_uid uuid, p_post_id uuid, p_caption text, p_location text, p_topics jsonb,
  p_comment_policy text, p_media jsonb, p_community_id uuid default null, p_challenge_id uuid default null)
returns public.social_posts
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_post public.social_posts;
  v_group boolean := p_community_id is not null or p_challenge_id is not null;
  v_count integer;
  v_video boolean;
  v_caps jsonb := public.fitx_social_caps();
  v_item jsonb;
  v_index integer := 0;
  v_kind text;
  v_path text;
  v_poster text;
  v_size bigint;
  v_poster_size bigint;
  v_duration integer;
  v_topics text[];
begin
  if p_uid is null or p_post_id is null or exists (select 1 from public.social_posts p where p.id = p_post_id) then
    raise exception using errcode = '23514', message = 'social_invalid';
  end if;
  if p_media is null and v_group then
    v_count := 0;
  elsif pg_catalog.jsonb_typeof(p_media) is distinct from 'array' then
    raise exception using errcode = '23514', message = 'social_media_count';
  else
    v_count := pg_catalog.jsonb_array_length(p_media);
  end if;
  if v_count > 10 or (v_count = 0 and not v_group) then
    raise exception using errcode = '23514', message = 'social_media_count';
  end if;
  if char_length(coalesce(p_caption, '')) > 2200 then
    raise exception using errcode = '23514', message = 'social_caption_too_long';
  end if;
  if v_count = 0 and char_length(btrim(coalesce(p_caption, ''))) = 0 then
    raise exception using errcode = '23514', message = 'social_invalid';
  end if;
  v_video := v_count > 0 and exists (select 1 from pg_catalog.jsonb_array_elements(p_media) e where e ->> 'kind' = 'video');
  if v_video then
    if v_count <> 1 then
      raise exception using errcode = '23514', message = 'social_media_count';
    end if;
    if coalesce((select ps.features ->> 'explore_video' from public.platform_settings ps where ps.id = 1), 'false') <> 'true' then
      raise exception using errcode = 'P0001', message = 'social_unavailable';
    end if;
    if (select pg_catalog.count(*) from public.social_post_media m where m.user_id = p_uid and m.kind = 'video') >= 20 then
      raise exception using errcode = 'P0001', message = 'social_video_cap';
    end if;
    if (select coalesce(pg_catalog.sum(case when (o.metadata ->> 'size') ~ '^[0-9]{1,15}$' then (o.metadata ->> 'size')::bigint end), 0)
        from storage.objects o where o.bucket_id = 'social-media' and o.name ~ '/[0-9]([.]mp4|p[.]webp)$')
       > (v_caps ->> 'video_bytes')::bigint then
      raise exception using errcode = 'P0001', message = 'social_video_cap';
    end if;
    perform public.fitx_social_take(p_uid, 'video', 2, 3);
  end if;
  if (select coalesce(pg_catalog.sum(case when (o.metadata ->> 'size') ~ '^[0-9]{1,15}$' then (o.metadata ->> 'size')::bigint end), 0)
      from storage.objects o where o.bucket_id = 'social-media') > (v_caps ->> 'social_media_bytes')::bigint then
    raise exception using errcode = 'P0001', message = 'social_storage_full';
  end if;
  select coalesce(pg_catalog.array_agg(distinct t), '{}') into v_topics
  from pg_catalog.jsonb_array_elements_text(coalesce(p_topics, '[]'::jsonb)) t;
  if not v_group then
    perform public.fitx_social_take(p_uid, 'post', 10, 25);
  end if;

  insert into public.social_posts (id, user_id, kind, caption, location_label, topics, comment_policy, community_id, challenge_id)
  values (p_post_id, p_uid, case when v_video then 'video' when v_count = 0 then 'text' else 'photo' end,
          btrim(coalesce(p_caption, '')), nullif(btrim(coalesce(p_location, '')), ''), v_topics,
          coalesce(p_comment_policy, (select p.default_comment_policy from public.social_profiles p where p.user_id = p_uid), 'everyone'),
          p_community_id, p_challenge_id)
  returning * into v_post;

  if v_count > 0 then
    for v_item in select e from pg_catalog.jsonb_array_elements(p_media) e loop
      v_kind := coalesce(v_item ->> 'kind', 'image');
      v_path := v_item ->> 'path';
      v_poster := null;
      v_duration := null;
      if v_kind not in ('image', 'video') then
        raise exception using errcode = '23514', message = 'social_invalid';
      end if;
      if v_path is null or v_path !~ ('^' || p_uid::text || '/' || p_post_id::text || '/' || v_index::text
                                      || case when v_kind = 'video' then '[.]mp4$' else '[.](webp|jpg)$' end) then
        raise exception using errcode = '23514', message = 'social_media_missing';
      end if;
      select case when (o.metadata ->> 'size') ~ '^[0-9]{1,15}$' then (o.metadata ->> 'size')::bigint end into v_size
      from storage.objects o where o.bucket_id = 'social-media' and o.name = v_path;
      if not found then
        raise exception using errcode = '23514', message = 'social_media_missing';
      end if;
      if v_kind = 'video' then
        v_poster := v_item ->> 'poster_path';
        if v_poster is null or v_poster <> (p_uid::text || '/' || p_post_id::text || '/' || v_index::text || 'p.webp') then
          raise exception using errcode = '23514', message = 'social_media_missing';
        end if;
        select case when (o.metadata ->> 'size') ~ '^[0-9]{1,15}$' then (o.metadata ->> 'size')::bigint end into v_poster_size
        from storage.objects o where o.bucket_id = 'social-media' and o.name = v_poster;
        if not found then
          raise exception using errcode = '23514', message = 'social_media_missing';
        end if;
        v_duration := case when (v_item ->> 'duration_ms') ~ '^[0-9]{1,6}$' then (v_item ->> 'duration_ms')::integer end;
        if v_duration is null or v_duration not between 1 and 30000 then
          raise exception using errcode = '23514', message = 'social_invalid';
        end if;
      end if;
      insert into public.social_post_media (post_id, user_id, position, kind, storage_path, poster_path, width, height, duration_ms,
        bytes, alt_text)
      values (p_post_id, p_uid, v_index, v_kind, v_path, v_poster, (v_item ->> 'width')::integer, (v_item ->> 'height')::integer,
              v_duration, least(coalesce(v_size, 1) + coalesce(v_poster_size, 0), 52428800)::integer,
              nullif(btrim(coalesce(v_item ->> 'alt', '')), ''));
      v_index := v_index + 1;
    end loop;
  end if;

  perform public.fitx_social_tag_post(p_post_id, v_post.caption);
  perform public.fitx_social_notify_mentions(p_uid, v_post.caption, null, v_post, null);
  return v_post;
end $function$;

do $do$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'fitx_social_member()', 'fitx_social_member_any()', 'fitx_social_ping(uuid, text, uuid)',
    'fitx_social_can_comment(uuid, public.social_posts)', 'fitx_social_post_json(uuid, public.social_posts)',
    'fitx_social_notify(uuid, uuid, text, text, uuid, uuid, uuid)',
    'fitx_social_notify_mentions(uuid, text, text, public.social_posts, uuid)',
    'fitx_social_notification_visible(uuid, public.social_notifications)',
    'fitx_social_insert_post(uuid, uuid, text, text, jsonb, text, jsonb, uuid, uuid)'
  ] loop
    execute pg_catalog.format('revoke all on function public.%s from public, anon, authenticated', v_fn);
  end loop;
end $do$;

-- 8. Member functions: profile, settings, age -------------------------------------------------------------------------

-- The signed-in member's Explore state: their profile (null before they make one), unread notifications, waiting follow
-- requests, whether Explore is switched on, an active suspension (and other active sanctions), and their age band.
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
  v_state jsonb;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'social_signed_out';
  end if;
  v_state := pg_catalog.jsonb_build_object(
    'explore', coalesce((select ps.features ->> 'explore' from public.platform_settings ps where ps.id = 1), 'true') <> 'false',
    'videos', coalesce((select ps.features ->> 'explore_video' from public.platform_settings ps where ps.id = 1), 'false') = 'true',
    'age_band', public.fitx_social_age_band(v_uid),
    'suspension', (select pg_catalog.jsonb_build_object('until', s.until, 'since', s.created_at)
                   from public.social_member_sanctions s
                   where s.user_id = v_uid and s.kind = 'explore' and s.lifted_at is null and (s.until is null or s.until > pg_catalog.now())
                   order by s.until desc nulls first limit 1),
    'sanctions', coalesce((select pg_catalog.jsonb_agg(distinct s.kind) from public.social_member_sanctions s
                           where s.user_id = v_uid and s.lifted_at is null and (s.until is null or s.until > pg_catalog.now())), '[]'::jsonb));
  select * into v_profile from public.social_profiles p where p.user_id = v_uid;
  if not found then
    return pg_catalog.jsonb_build_object('profile', null, 'unread', 0, 'requests', 0) || v_state;
  end if;
  return pg_catalog.jsonb_build_object(
    'profile', pg_catalog.jsonb_build_object('id', v_profile.user_id, 'username', v_profile.username,
      'display_name', v_profile.display_name, 'bio', v_profile.bio, 'avatar_path', v_profile.avatar_path,
      'is_private', v_profile.is_private, 'default_comment_policy', v_profile.default_comment_policy,
      'dm_policy', v_profile.dm_policy, 'birth_date_added_at', v_profile.birth_date_added_at),
    'unread', (select pg_catalog.count(*) from public.social_notifications n
               where n.user_id = v_uid and n.read_at is null and n.type <> 'follow_request'
                 and public.fitx_social_notification_visible(v_uid, n)),
    'requests', (select pg_catalog.count(*) from public.social_follows f
                 where f.following_id = v_uid and f.status = 'pending' and not public.fitx_social_blocked(v_uid, f.user_id))) || v_state;
end $function$;

-- Creates or updates the signed-in member's Explore profile (part 1's rules), now refused for under-13s
-- (social_age_restricted), while Explore is switched off (social_unavailable) and while suspended (social_suspended).
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
  if coalesce((select ps.features ->> 'explore' from public.platform_settings ps where ps.id = 1), 'true') = 'false' then
    raise exception using errcode = 'P0001', message = 'social_unavailable';
  end if;
  if public.fitx_social_age_band(v_uid) = 'child' then
    raise exception using errcode = 'P0001', message = 'social_age_restricted';
  end if;
  if exists (select 1 from public.social_member_sanctions s
             where s.user_id = v_uid and s.kind = 'explore' and s.lifted_at is null
               and (s.until is null or s.until > pg_catalog.now())) then
    raise exception using errcode = 'P0001', message = 'social_suspended';
  end if;
  perform public.fitx_social_take(v_uid, 'profile', 30, 100);
  if v_username !~ '^[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$' or v_username ~ '[.]{2}' then
    raise exception using errcode = '23514', message = 'social_username_invalid';
  end if;
  if v_username = any (array['fitx', 'admin', 'support', 'help', 'explore', 'settings', 'official', 'moderator', 'staff']) then
    raise exception using errcode = '23514', message = 'social_username_reserved';
  end if;
  -- "new" is kept too (wave 2), so /explore/stories/new is always the story composer; a member who already had it
  -- before this file keeps it.
  if v_username = 'new' and not exists (select 1 from public.social_profiles p where p.user_id = v_uid and p.username = 'new') then
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

-- Adds the member's date of birth when FITX has none (ages 13 to 120), once; changing a saved one stays a support
-- request. Stamps social_profiles.birth_date_added_at for Admin's account record. Returns the new age band.
create or replace function public.fitx_social_set_birth_date(p_date date)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_years integer;
  v_changed integer;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'social_signed_out';
  end if;
  if p_date is null or p_date > current_date then
    raise exception using errcode = '23514', message = 'social_invalid';
  end if;
  v_years := extract(year from pg_catalog.age(current_date, p_date))::integer;
  if v_years > 120 then
    raise exception using errcode = '23514', message = 'social_invalid';
  end if;
  if v_years < 13 then
    raise exception using errcode = 'P0001', message = 'social_age_restricted';
  end if;
  if exists (select 1 from public.profiles p where p.id = v_uid and p.date_of_birth is not null) then
    raise exception using errcode = 'P0001', message = 'social_birth_date_set';
  end if;
  perform public.fitx_social_take(v_uid, 'profile', 30, 100);
  update public.profiles p set date_of_birth = p_date where p.id = v_uid and p.date_of_birth is null;
  get diagnostics v_changed = row_count;
  if v_changed = 0 then
    raise exception using errcode = 'P0001', message = 'social_not_found';
  end if;
  update public.social_profiles sp set birth_date_added_at = pg_catalog.now() where sp.user_id = v_uid;
  return public.fitx_social_age_band(v_uid);
end $function$;

-- A saved date of birth changes only through FITX support. Members hold update on profiles.date_of_birth (#41) so setup,
-- Profile and Explore settings can add one when FITX has none, but changing or clearing a saved one is refused
-- (birth_date_locked), so a teen cannot become an adult in one edit (O1 a). Security invoker: on a member's own update
-- current_user is their API role; service_role (support, through Admin's server) and the SQL editor's postgres may
-- change it. fitx_social_set_birth_date runs as its owner and only ever fills an empty date.
create or replace function public.fitx_profiles_birth_date_locked()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if old.date_of_birth is not null and new.date_of_birth is distinct from old.date_of_birth
     and current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception using errcode = 'P0001', message = 'birth_date_locked',
      hint = 'A saved date of birth is changed by FITX support.';
  end if;
  return new;
end $function$;

-- A date of birth a member adds to their own row once they have an Explore profile (from Profile as well as from
-- Explore settings) is stamped for Admin's account record, as fitx_social_set_birth_date stamps its own. Dates FITX
-- support adds (no member session) are not stamped.
create or replace function public.fitx_profiles_birth_date_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.date_of_birth is null and new.date_of_birth is not null and (select auth.uid()) = new.id then
    update public.social_profiles sp set birth_date_added_at = pg_catalog.now() where sp.user_id = new.id;
  end if;
  return null;
end $function$;

revoke all on function public.fitx_profiles_birth_date_locked() from public, anon, authenticated;
revoke all on function public.fitx_profiles_birth_date_added() from public, anon, authenticated;

drop trigger if exists profiles_birth_date_locked on public.profiles;
create trigger profiles_birth_date_locked
  before update of date_of_birth on public.profiles
  for each row execute function public.fitx_profiles_birth_date_locked();

drop trigger if exists profiles_birth_date_added on public.profiles;
create trigger profiles_birth_date_added
  after update of date_of_birth on public.profiles
  for each row execute function public.fitx_profiles_birth_date_added();

-- Unfollows, or withdraws a request (open while suspended or switched off).
create or replace function public.fitx_social_unfollow(p_target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member_any();
begin
  delete from public.social_follows f where f.user_id = v_uid and f.following_id = p_target;
  delete from public.social_notifications n where n.user_id = p_target and n.actor_id = v_uid and n.type = 'follow_request';
end $function$;

-- Blocks (true) or unblocks (false) an account; a block ends follows and requests both ways (open while suspended).
create or replace function public.fitx_social_set_block(p_target uuid, p_block boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member_any();
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

-- Restricts (true) or lifts a restriction (false), at most 30 an hour and 100 a day.
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
  perform public.fitx_social_take(v_uid, 'restrict', 30, 100);
  if p_restrict then
    if not exists (select 1 from public.social_profiles p where p.user_id = p_target) then
      raise exception using errcode = 'P0001', message = 'social_not_found';
    end if;
    insert into public.social_restricts (user_id, restricted_id) values (v_uid, p_target) on conflict do nothing;
  else
    delete from public.social_restricts r where r.user_id = v_uid and r.restricted_id = p_target;
  end if;
end $function$;

-- Reports a post, comment, story, account, message, community or challenge, with a snapshot of the item (O4 a: the
-- item only; for a message that one message). The member may report what they can see, and content addressed to them
-- even across a block either way: a post or comment they were notified about, a comment on their own post or replying
-- to their comment, a story they viewed, any Explore account, and any message in a conversation they are a side of.
-- A second report of the same thing updates the first. Open while suspended or switched off.
create or replace function public.fitx_social_report(p_target_type text, p_target_id uuid, p_reason text, p_details text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member_any();
  v_found boolean := false;
  v_owner uuid;
  v_evidence jsonb;
  v_id uuid;
begin
  if p_target_type = 'post' then
    select true, p.user_id, pg_catalog.jsonb_build_object('kind', p.kind, 'caption', pg_catalog.left(p.caption, 1500),
             'location', p.location_label, 'topics', pg_catalog.to_jsonb(p.topics), 'created_at', p.created_at,
             'community_id', p.community_id, 'author', (select a.username from public.social_profiles a where a.user_id = p.user_id),
             'media', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('path', m.storage_path, 'poster_path', m.poster_path,
                       'kind', m.kind) order by m.position) from public.social_post_media m where m.post_id = p.id), '[]'::jsonb))
      into v_found, v_owner, v_evidence
    from public.social_posts p
    where p.id = p_target_id and p.user_id <> v_uid
      and (public.fitx_social_sees_post(v_uid, p.id)
           or exists (select 1 from public.social_notifications n where n.user_id = v_uid and n.post_id = p.id));
  elsif p_target_type = 'comment' then
    select true, c.user_id, pg_catalog.jsonb_build_object('body', pg_catalog.left(c.body, 1500), 'created_at', c.created_at,
             'post_id', c.post_id, 'parent_id', c.parent_id,
             'author', (select a.username from public.social_profiles a where a.user_id = c.user_id))
      into v_found, v_owner, v_evidence
    from public.social_comments c join public.social_posts p on p.id = c.post_id
    where c.id = p_target_id and c.user_id <> v_uid
      and (public.fitx_social_sees_comment_row(v_uid, c.id)
           or p.user_id = v_uid
           or exists (select 1 from public.social_comments parent where parent.id = c.parent_id and parent.user_id = v_uid)
           or exists (select 1 from public.social_notifications n where n.user_id = v_uid and n.comment_id = c.id));
  elsif p_target_type = 'story' then
    select true, s.user_id, pg_catalog.jsonb_build_object('kind', s.kind, 'path', s.storage_path, 'poster_path', s.poster_path,
             'caption', s.caption, 'created_at', s.created_at, 'expires_at', s.expires_at,
             'author', (select a.username from public.social_profiles a where a.user_id = s.user_id))
      into v_found, v_owner, v_evidence
    from public.social_stories s
    where s.id = p_target_id and s.user_id <> v_uid
      and (public.fitx_social_sees_story(v_uid, s.id)
           or exists (select 1 from public.social_story_views w where w.story_id = s.id and w.user_id = v_uid)
           or exists (select 1 from public.social_notifications n where n.user_id = v_uid and n.story_id = s.id));
  elsif p_target_type = 'account' then
    select true, p.user_id, pg_catalog.jsonb_build_object('username', p.username, 'display_name', p.display_name, 'bio', p.bio,
             'avatar_path', p.avatar_path)
      into v_found, v_owner, v_evidence
    from public.social_profiles p where p.user_id = p_target_id and p.user_id <> v_uid;
  elsif p_target_type = 'message' then
    select true, m.user_id, pg_catalog.jsonb_build_object('body', pg_catalog.left(m.body, 1500), 'created_at', m.created_at,
             'sender', (select a.username from public.social_profiles a where a.user_id = m.user_id))
      into v_found, v_owner, v_evidence
    from public.social_messages m join public.social_conversations c on c.id = m.conversation_id
    where m.id = p_target_id and m.user_id <> v_uid and m.deleted_at is null and v_uid in (c.user_low, c.user_high);
  elsif p_target_type = 'community' then
    select true, c.created_by, pg_catalog.jsonb_build_object('name', c.name, 'slug', c.slug, 'description', c.description,
             'visibility', c.visibility)
      into v_found, v_owner, v_evidence
    from public.social_communities c
    where c.id = p_target_id and c.created_by is distinct from v_uid
      and (public.fitx_social_sees_community(v_uid, c.id)
           or exists (select 1 from public.social_community_members m where m.community_id = c.id and m.user_id = v_uid));
  elsif p_target_type = 'challenge' then
    select true, null::uuid, pg_catalog.jsonb_build_object('title', c.title, 'kind', c.kind, 'metric', c.metric,
             'starts_at', c.starts_at, 'ends_at', c.ends_at)
      into v_found, v_owner, v_evidence
    from public.social_challenges c where c.id = p_target_id;
  else
    raise exception using errcode = '23514', message = 'social_invalid';
  end if;
  if not coalesce(v_found, false) then
    raise exception using errcode = 'P0001', message = 'social_not_found';
  end if;
  if char_length(coalesce(p_details, '')) > 500 then
    raise exception using errcode = '23514', message = 'social_invalid';
  end if;
  perform public.fitx_social_take(v_uid, 'report', 10, 30);
  insert into public.social_reports as r (user_id, target_type, target_id, target_user_id, reason, details, evidence)
  values (v_uid, p_target_type, p_target_id, v_owner, p_reason, nullif(btrim(coalesce(p_details, '')), ''), v_evidence)
  on conflict (user_id, target_type, target_id) do update set reason = excluded.reason, details = excluded.details,
    evidence = excluded.evidence, status = 'open', created_at = pg_catalog.now(), reviewed_at = null, evidence_purge_at = null
  returning r.id into v_id;
  return v_id;
end $function$;

-- 9. Member functions: posts, likes, saves, comments -----------------------------------------------------------------

-- Publishes a post whose files the member already uploaded to <uid>/<p_post_id>/ (photos, or one video with its
-- poster; see fitx_social_insert_post). Returns the post as feeds show it.
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
begin
  v_post := public.fitx_social_insert_post(v_uid, p_post_id, p_caption, p_location, p_topics, p_comment_policy, p_media);
  return public.fitx_social_post_json(v_uid, v_post);
end $function$;

-- Edits the signed-in member's own post (not its files). A video post can be edited only while videos are on.
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
  if v_before.kind = 'video'
     and coalesce((select ps.features ->> 'explore_video' from public.platform_settings ps where ps.id = 1), 'false') <> 'true' then
    raise exception using errcode = 'P0001', message = 'social_unavailable';
  end if;
  if char_length(coalesce(p_caption, '')) > 2200 then
    raise exception using errcode = '23514', message = 'social_caption_too_long';
  end if;
  if v_before.kind = 'text' and char_length(btrim(coalesce(p_caption, ''))) = 0 then
    raise exception using errcode = '23514', message = 'social_invalid';
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

-- Deletes the member's own post with its likes, comments and notifications. Returns its file paths (photos, video and
-- poster), which the app then deletes from the bucket. Open while suspended or switched off.
create or replace function public.fitx_social_delete_post(p_post uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member_any();
  v_paths text[];
begin
  if not exists (select 1 from public.social_posts p where p.id = p_post and p.user_id = v_uid) then
    raise exception using errcode = 'P0001', message = 'social_not_found';
  end if;
  select coalesce(pg_catalog.array_agg(x.path order by x.position, x.poster), '{}') into v_paths
  from (select m.storage_path as path, m.position, 0 as poster from public.social_post_media m where m.post_id = p_post
        union all
        select m.poster_path, m.position, 1 from public.social_post_media m where m.post_id = p_post and m.poster_path is not null) x;
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
  select * into v_post from public.social_posts p where p.id = p_post and public.fitx_social_sees_post(v_uid, p.id);
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
    if not exists (select 1 from public.social_posts p where p.id = p_post and public.fitx_social_sees_post(v_uid, p.id)) then
      raise exception using errcode = 'P0001', message = 'social_not_found';
    end if;
    perform public.fitx_social_take(v_uid, 'save', 300, 1500);
    insert into public.social_saves (user_id, post_id) values (v_uid, p_post) on conflict do nothing;
  else
    delete from public.social_saves s where s.user_id = v_uid and s.post_id = p_post;
  end if;
  return coalesce(p_save, false);
end $function$;

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
  select * into v_post from public.social_posts p where p.id = p_post and public.fitx_social_sees_post(v_uid, p.id);
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
    where c.id = p_parent and c.post_id = p_post and public.fitx_social_sees_comment_row(v_uid, c.id);
    if not found then
      raise exception using errcode = 'P0001', message = 'social_not_found';
    end if;
  end if;
  perform public.fitx_social_take(v_uid, 'comment', 60, 300);
  insert into public.social_comments (post_id, user_id, parent_id, body)
  values (p_post, v_uid, coalesce(v_parent.parent_id, v_parent.id), btrim(p_body))
  returning * into v_comment;

  perform public.fitx_social_notify(v_post.user_id, v_uid, 'comment', 'comment', v_comment.id, p_post, v_comment.id);
  -- A reply tells the comment's author only when they may see it (a restricted member's reply reaches only the
  -- post's owner).
  if v_parent.id is not null and v_parent.user_id <> v_post.user_id
     and public.fitx_social_sees_comment_row(v_parent.user_id, v_comment.id) then
    perform public.fitx_social_notify(v_parent.user_id, v_uid, 'reply', 'comment', v_comment.id, p_post, v_comment.id);
  end if;
  perform public.fitx_social_notify_mentions(v_uid, v_comment.body, null, v_post, v_comment.id);
  return public.fitx_social_comment_json(v_uid, v_comment, v_post.user_id);
end $function$;

-- Deletes a comment (and its replies): the member's own, or any on the member's own post. Open while suspended.
create or replace function public.fitx_social_delete_comment(p_comment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member_any();
begin
  if not exists (select 1 from public.social_comments c join public.social_posts p on p.id = c.post_id
                 where c.id = p_comment and v_uid in (c.user_id, p.user_id)) then
    raise exception using errcode = 'P0001', message = 'social_not_found';
  end if;
  delete from public.social_comments c where c.id = p_comment;
end $function$;

-- 10. Member functions: reading -----------------------------------------------------------------------------------------

-- The feed: the member's own posts and those of accounts they follow (accepted), as each post's own visibility allows.
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
        and public.fitx_social_sees_post(v_uid, p.id)
        and (p_before_at is null or (p.created_at, p.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
      order by p.created_at desc, p.id desc
      limit least(greatest(coalesce(p_limit, 12), 1), 30)
    ) x), '[]'::jsonb);
end $function$;

-- Posts the member can see, newest first: one account's (p_user), one hashtag's, one topic's, or every public account's
-- (Discover's latest). Outside the member's own posts and the accounts they follow, only listed posts appear.
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
  v_follows boolean := p_user is not null and exists (
    select 1 from public.social_follows f where f.user_id = v_uid and f.following_id = p_user and f.status = 'accepted');
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
        and public.fitx_social_sees_post(v_uid, p.id)
        and (p.user_id = v_uid or v_follows or public.fitx_social_post_listed(p.id))
        and (p_before_at is null or (p.created_at, p.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
      order by p.created_at desc, p.id desc
      limit least(greatest(coalesce(p_limit, 18), 1), 30)
    ) x), '[]'::jsonb);
end $function$;

-- Trending: public accounts' listed posts from the last p_days days (1 to 30), ranked by the likes, comments and saves
-- other members gave them (a comment counts 2, a save 3). Posts nobody else engaged with are not trending.
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
        and public.fitx_social_post_listed(p.id)
        and public.fitx_social_sees_post(v_uid, p.id)
        and (p_topic is null or p.topics @> array[p_topic])
      order by score desc, p.created_at desc, p.id desc
      offset greatest(coalesce(p_offset, 0), 0)
      limit least(greatest(coalesce(p_limit, 12), 1), 30)
    ) s where s.score > 0), '[]'::jsonb);
end $function$;

-- Accounts to follow, with the real reason (part 1's rules), leaving out suspended accounts and counting only listed
-- posts for the topic reason.
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
            and public.fitx_social_post_listed(p.id)
          group by t order by pg_catalog.count(*) desc, t limit 1) end as topic,
        case when a.is_private then 0 else (
          select pg_catalog.count(*) from public.social_likes l join public.social_posts p on p.id = l.post_id
          where p.user_id = a.user_id and l.user_id <> a.user_id and l.created_at > pg_catalog.now() - interval '30 days') end as liked,
        (select pg_catalog.count(*) from public.social_posts p where p.user_id = a.user_id and public.fitx_social_post_listed(p.id)) as posts
      from public.social_profiles a
      where a.user_id <> v_uid
        and not public.fitx_social_blocked(v_uid, a.user_id)
        and not exists (select 1 from public.social_member_sanctions s
                        where s.user_id = a.user_id and s.kind = 'explore' and s.lifted_at is null
                          and (s.until is null or s.until > pg_catalog.now()))
        and not exists (select 1 from public.social_follows f where f.user_id = v_uid and f.following_id = a.user_id)
    ) c
    where c.mutual > 0 or c.topic is not null or c.liked > 0 or c.posts > 0
    order by c.mutual desc, (c.topic is not null) desc, c.liked desc, c.posts desc, c.created_at desc
    limit least(greatest(coalesce(p_limit, 8), 1), 30)
    ) c), '[]'::jsonb);
end $function$;

-- Search: accounts by username or name (suspended accounts left out), and hashtags with how many posts the member can
-- see there (their own, or listed ones).
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
          and (p.user_id = v_uid or (not public.fitx_social_blocked(v_uid, p.user_id)
               and not exists (select 1 from public.social_member_sanctions s
                               where s.user_id = p.user_id and s.kind = 'explore' and s.lifted_at is null
                                 and (s.until is null or s.until > pg_catalog.now()))))
        order by rank, followers desc, p.username
        limit v_limit
      ) a), '[]'::jsonb),
    'hashtags', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('tag', h.tag, 'posts', h.posts) order by h.posts desc, h.tag)
      from (
      select * from (
        select t.tag, (select pg_catalog.count(*) from public.social_post_hashtags ph join public.social_posts p on p.id = ph.post_id
                       where ph.hashtag_id = t.id and public.fitx_social_sees_post(v_uid, p.id)
                         and (p.user_id = v_uid or public.fitx_social_post_listed(p.id))) as posts
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
  select * into v_post from public.social_posts p where p.id = p_post and public.fitx_social_sees_post(v_uid, p.id);
  if not found then
    return null;
  end if;
  return public.fitx_social_post_json(v_uid, v_post);
end $function$;

-- The posts the member saved and can still see, newest save first (p_before_at is the last item's saved_at).
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
      where s.user_id = v_uid and public.fitx_social_sees_post(v_uid, p.id)
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
  select * into v_post from public.social_posts p where p.id = p_post and public.fitx_social_sees_post(v_uid, p.id);
  if not found then
    raise exception using errcode = 'P0001', message = 'social_not_found';
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(public.fitx_social_comment_json(v_uid, x.c, v_post.user_id) || pg_catalog.jsonb_build_object(
      'replies', coalesce((
        select pg_catalog.jsonb_agg(public.fitx_social_comment_json(v_uid, y.r, v_post.user_id) order by (y.r).created_at, (y.r).id)
        from (select r from public.social_comments r
              where r.parent_id = (x.c).id and public.fitx_social_sees_comment_row(v_uid, r.id)
              order by r.created_at, r.id limit 100) y), '[]'::jsonb))
      order by (x.c).created_at, (x.c).id)
    from (
      select c from public.social_comments c
      where c.post_id = p_post and c.parent_id is null
        and public.fitx_social_sees_comment_row(v_uid, c.id)
        and (p_after_at is null or (c.created_at, c.id) > (p_after_at, coalesce(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid)))
      order by c.created_at, c.id
      limit least(greatest(coalesce(p_limit, 30), 1), 50)
    ) x), '[]'::jsonb);
end $function$;

-- The member's notifications, newest first, as fitx_social_notification_visible allows. Each says what it is about
-- (post, comment, story, community, challenge or conversation) by id only.
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
      'comment_id', n.comment_id, 'story_id', n.story_id, 'community_id', n.community_id, 'challenge_id', n.challenge_id,
      'conversation_id', n.conversation_id, 'entity_type', n.entity_type, 'entity_id', n.entity_id,
      'thumb', coalesce(
        (select coalesce(m.poster_path, m.storage_path) from public.social_post_media m where m.post_id = n.post_id order by m.position limit 1),
        (select coalesce(s.poster_path, s.storage_path) from public.social_stories s where s.id = n.story_id)),
      'snippet', (select pg_catalog.left(c.body, 120) from public.social_comments c where c.id = n.comment_id),
      'community', (select pg_catalog.jsonb_build_object('slug', c.slug, 'name', c.name) from public.social_communities c where c.id = n.community_id),
      'challenge', (select pg_catalog.jsonb_build_object('title', c.title) from public.social_challenges c where c.id = n.challenge_id),
      'following', case when n.actor_id is null then 'none' else
        coalesce((select f.status from public.social_follows f where f.user_id = v_uid and f.following_id = n.actor_id), 'none') end)
      order by n.created_at desc, n.id desc)
    from (
      select * from public.social_notifications n
      where n.user_id = v_uid
        and public.fitx_social_notification_visible(v_uid, n)
        and (p_before_at is null or (n.created_at, n.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
      order by n.created_at desc, n.id desc
      limit least(greatest(coalesce(p_limit, 30), 1), 50)
    ) n), '[]'::jsonb);
end $function$;

create or replace function public.fitx_social_notification_prefs()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member_any();
  v_prefs public.social_notification_prefs;
begin
  select * into v_prefs from public.social_notification_prefs np where np.user_id = v_uid;
  return pg_catalog.jsonb_build_object('follows', coalesce(v_prefs.follows, true), 'follow_requests', coalesce(v_prefs.follow_requests, true),
    'likes', coalesce(v_prefs.likes, true), 'comments', coalesce(v_prefs.comments, true), 'mentions', coalesce(v_prefs.mentions, true),
    'stories', coalesce(v_prefs.stories, true), 'challenges', coalesce(v_prefs.challenges, true),
    'communities', coalesce(v_prefs.communities, true), 'messages', coalesce(v_prefs.messages, true));
end $function$;

-- Five parameters in part 1; the four new ones default to null, which keeps the stored value, so a wave-1 client's
-- five-argument call still resolves and changes nothing it does not know about.
drop function if exists public.fitx_social_save_notification_prefs(boolean, boolean, boolean, boolean, boolean);
create or replace function public.fitx_social_save_notification_prefs(p_follows boolean, p_follow_requests boolean, p_likes boolean,
  p_comments boolean, p_mentions boolean, p_stories boolean default null, p_challenges boolean default null,
  p_communities boolean default null, p_messages boolean default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
begin
  perform public.fitx_social_take(v_uid, 'profile', 30, 100);
  insert into public.social_notification_prefs as np (user_id, follows, follow_requests, likes, comments, mentions, stories, challenges,
    communities, messages)
  values (v_uid, coalesce(p_follows, true), coalesce(p_follow_requests, true), coalesce(p_likes, true), coalesce(p_comments, true),
          coalesce(p_mentions, true), coalesce(p_stories, true), coalesce(p_challenges, true), coalesce(p_communities, true),
          coalesce(p_messages, true))
  on conflict (user_id) do update set follows = excluded.follows, follow_requests = excluded.follow_requests, likes = excluded.likes,
    comments = excluded.comments, mentions = excluded.mentions, stories = coalesce(p_stories, np.stories),
    challenges = coalesce(p_challenges, np.challenges), communities = coalesce(p_communities, np.communities),
    messages = coalesce(p_messages, np.messages), updated_at = pg_catalog.now();
  return public.fitx_social_notification_prefs();
end $function$;

-- The accounts the member blocked and restricted (open while suspended).
create or replace function public.fitx_social_safety_lists()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member_any();
begin
  return pg_catalog.jsonb_build_object(
    'blocked', coalesce((select pg_catalog.jsonb_agg(public.fitx_social_author_json(b.blocked_id) order by b.created_at desc)
                         from public.social_blocks b join public.social_profiles p on p.user_id = b.blocked_id
                         where b.user_id = v_uid), '[]'::jsonb),
    'restricted', coalesce((select pg_catalog.jsonb_agg(public.fitx_social_author_json(r.restricted_id) order by r.created_at desc)
                            from public.social_restricts r join public.social_profiles p on p.user_id = r.restricted_id
                            where r.user_id = v_uid), '[]'::jsonb));
end $function$;

-- 11. Stories ------------------------------------------------------------------------------------------------------------

-- Publishes a story whose file the member already uploaded: a photo at <uid>/<p_story_id>/0.webp|jpg, or (while videos
-- are on) a video of at most 15 s at 0.mp4 with its poster at 0p.webp. At most 10 an hour, 20 a calendar day and 10 in
-- any 24 hours; live stories stay under the story cap. Live for 24 hours.
create or replace function public.fitx_social_create_story(p_story_id uuid, p_kind text, p_path text, p_poster_path text,
  p_width integer, p_height integer, p_duration_ms integer, p_caption text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_caps jsonb := public.fitx_social_caps();
  v_size bigint;
  v_poster_size bigint := 0;
  v_story public.social_stories;
begin
  if p_story_id is null or exists (select 1 from public.social_stories s where s.id = p_story_id) or p_kind not in ('image', 'video') then
    raise exception using errcode = '23514', message = 'social_invalid';
  end if;
  if p_kind = 'video'
     and coalesce((select ps.features ->> 'explore_video' from public.platform_settings ps where ps.id = 1), 'false') <> 'true' then
    raise exception using errcode = 'P0001', message = 'social_unavailable';
  end if;
  if char_length(coalesce(p_caption, '')) > 200
     or coalesce(p_width, 0) not between 1 and 4096 or coalesce(p_height, 0) not between 1 and 4096
     or (p_kind = 'image' and (p_duration_ms is not null or p_poster_path is not null))
     or (p_kind = 'video' and coalesce(p_duration_ms, 0) not between 1 and 15000) then
    raise exception using errcode = '23514', message = 'social_invalid';
  end if;
  if p_path is null or p_path !~ ('^' || v_uid::text || '/' || p_story_id::text
                                  || case when p_kind = 'video' then '/0[.]mp4$' else '/0[.](webp|jpg)$' end) then
    raise exception using errcode = '23514', message = 'social_media_missing';
  end if;
  select case when (o.metadata ->> 'size') ~ '^[0-9]{1,15}$' then (o.metadata ->> 'size')::bigint end into v_size
  from storage.objects o where o.bucket_id = 'social-media' and o.name = p_path;
  if not found then
    raise exception using errcode = '23514', message = 'social_media_missing';
  end if;
  if p_kind = 'video' then
    if p_poster_path is distinct from (v_uid::text || '/' || p_story_id::text || '/0p.webp') then
      raise exception using errcode = '23514', message = 'social_media_missing';
    end if;
    select coalesce(case when (o.metadata ->> 'size') ~ '^[0-9]{1,15}$' then (o.metadata ->> 'size')::bigint end, 0) into v_poster_size
    from storage.objects o where o.bucket_id = 'social-media' and o.name = p_poster_path;
    if not found then
      raise exception using errcode = '23514', message = 'social_media_missing';
    end if;
  end if;
  perform public.fitx_social_take(v_uid, 'story', 10, 20);
  if (select pg_catalog.count(*) from public.social_stories s where s.user_id = v_uid and s.created_at > pg_catalog.now() - interval '24 hours') >= 10 then
    raise exception using errcode = 'PT429', message = 'social_rate_limited', hint = 'day';
  end if;
  if p_kind = 'video' then
    perform public.fitx_social_take(v_uid, 'video', 2, 3);
  end if;
  if (select coalesce(pg_catalog.sum(s.bytes), 0) from public.social_stories s where s.expires_at > pg_catalog.now())
     + coalesce(v_size, 1) + v_poster_size > (v_caps ->> 'story_bytes')::bigint
     or (select coalesce(pg_catalog.sum(case when (o.metadata ->> 'size') ~ '^[0-9]{1,15}$' then (o.metadata ->> 'size')::bigint end), 0)
         from storage.objects o where o.bucket_id = 'social-media') > (v_caps ->> 'social_media_bytes')::bigint then
    raise exception using errcode = 'P0001', message = 'social_storage_full';
  end if;
  insert into public.social_stories (id, user_id, kind, storage_path, poster_path, width, height, duration_ms, bytes, caption)
  values (p_story_id, v_uid, p_kind, p_path, p_poster_path, p_width, p_height, p_duration_ms,
          least(coalesce(v_size, 1) + v_poster_size, 52428800), btrim(coalesce(p_caption, '')))
  returning * into v_story;
  return pg_catalog.jsonb_build_object('id', v_story.id, 'user_id', v_story.user_id, 'kind', v_story.kind, 'path', v_story.storage_path,
    'poster_path', v_story.poster_path, 'width', v_story.width, 'height', v_story.height, 'duration_ms', v_story.duration_ms,
    'caption', v_story.caption, 'created_at', v_story.created_at, 'expires_at', v_story.expires_at, 'mine', true, 'seen', true,
    'liked', false, 'view_count', 0, 'like_count', 0, 'moderation', null);
end $function$;

-- Deletes the member's own story (live or expired). Returns its file paths for the app to delete. Open while suspended.
create or replace function public.fitx_social_delete_story(p_story uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member_any();
  v_story public.social_stories;
begin
  delete from public.social_stories s where s.id = p_story and s.user_id = v_uid returning * into v_story;
  if not found then
    raise exception using errcode = 'P0001', message = 'social_not_found';
  end if;
  return pg_catalog.array_remove(array[v_story.storage_path, v_story.poster_path], null);
end $function$;

-- The story tray: the member first, then accounts they follow (accepted) with a live story the member may see; unseen
-- first, newest first.
create or replace function public.fitx_social_story_tray()
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
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('user', public.fitx_social_author_json(t.user_id), 'count', t.n,
      'latest_at', t.latest, 'unseen', t.unseen, 'mine', t.user_id = v_uid)
      order by (t.user_id = v_uid) desc, t.unseen desc, t.latest desc)
    from (
      select s.user_id, pg_catalog.count(*) as n, pg_catalog.max(s.created_at) as latest,
        bool_or(s.user_id <> v_uid and not exists (select 1 from public.social_story_views w where w.story_id = s.id and w.user_id = v_uid)) as unseen
      from public.social_stories s
      where s.expires_at > pg_catalog.now()
        and (s.user_id = v_uid or exists (select 1 from public.social_follows f
                                          where f.user_id = v_uid and f.following_id = s.user_id and f.status = 'accepted'))
        and public.fitx_social_sees_story(v_uid, s.id)
      group by s.user_id
    ) t), '[]'::jsonb);
end $function$;

-- One account's live stories the member may see, oldest first. Counts and the moderation state are the owner's only.
create or replace function public.fitx_social_stories(p_user uuid)
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
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', s.id, 'user_id', s.user_id, 'kind', s.kind, 'path', s.storage_path,
      'poster_path', s.poster_path, 'width', s.width, 'height', s.height, 'duration_ms', s.duration_ms, 'caption', s.caption,
      'created_at', s.created_at, 'expires_at', s.expires_at, 'mine', s.user_id = v_uid,
      'seen', s.user_id = v_uid or exists (select 1 from public.social_story_views w where w.story_id = s.id and w.user_id = v_uid),
      'liked', exists (select 1 from public.social_story_likes l where l.story_id = s.id and l.user_id = v_uid),
      'view_count', case when s.user_id = v_uid then (select pg_catalog.count(*) from public.social_story_views w
                                                     where w.story_id = s.id and not public.fitx_social_blocked(v_uid, w.user_id)) end,
      'like_count', case when s.user_id = v_uid then (select pg_catalog.count(*) from public.social_story_likes l
                                                     where l.story_id = s.id and not public.fitx_social_blocked(v_uid, l.user_id)) end,
      'moderation', case when s.user_id = v_uid and s.moderation_state <> 'visible' then s.moderation_state end)
      order by s.created_at, s.id)
    from public.social_stories s
    where s.user_id = p_user and public.fitx_social_sees_story(v_uid, s.id)), '[]'::jsonb);
end $function$;

-- Records that the member viewed a story (once; not rate counted). Expired: social_story_expired.
create or replace function public.fitx_social_view_story(p_story uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_owner uuid;
begin
  if not public.fitx_social_sees_story(v_uid, p_story) then
    if exists (select 1 from public.social_stories s where s.id = p_story and s.expires_at <= pg_catalog.now()) then
      raise exception using errcode = 'P0001', message = 'social_story_expired';
    end if;
    raise exception using errcode = 'P0001', message = 'social_not_found';
  end if;
  select s.user_id into v_owner from public.social_stories s where s.id = p_story;
  if v_owner <> v_uid then
    insert into public.social_story_views (story_id, user_id) values (p_story, v_uid) on conflict do nothing;
  end if;
  return true;
end $function$;

-- Who viewed the member's own live story, newest first (accounts with a block either way left out).
create or replace function public.fitx_social_story_viewers(p_story uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
begin
  if not exists (select 1 from public.social_stories s where s.id = p_story and s.user_id = v_uid and s.expires_at > pg_catalog.now()) then
    raise exception using errcode = 'P0001', message = 'social_not_found';
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('user', public.fitx_social_author_json(w.user_id), 'viewed_at', w.viewed_at,
      'liked', exists (select 1 from public.social_story_likes l where l.story_id = w.story_id and l.user_id = w.user_id))
      order by w.viewed_at desc)
    from public.social_story_views w join public.social_profiles p on p.user_id = w.user_id
    where w.story_id = p_story and not public.fitx_social_blocked(v_uid, w.user_id)), '[]'::jsonb);
end $function$;

-- Likes (true) or unlikes (false) a live story the member may see; the owner is told once.
create or replace function public.fitx_social_set_story_like(p_story uuid, p_like boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_owner uuid;
  v_added integer;
begin
  if not public.fitx_social_sees_story(v_uid, p_story) then
    if exists (select 1 from public.social_stories s where s.id = p_story and s.expires_at <= pg_catalog.now()) then
      raise exception using errcode = 'P0001', message = 'social_story_expired';
    end if;
    raise exception using errcode = 'P0001', message = 'social_not_found';
  end if;
  select s.user_id into v_owner from public.social_stories s where s.id = p_story;
  if p_like then
    insert into public.social_story_likes (story_id, user_id) values (p_story, v_uid) on conflict do nothing;
    get diagnostics v_added = row_count;
    if v_added > 0 then
      perform public.fitx_social_take(v_uid, 'like', 300, 1500);
      perform public.fitx_social_notify(v_owner, v_uid, 'story_like', 'story', p_story);
    end if;
  else
    delete from public.social_story_likes l where l.story_id = p_story and l.user_id = v_uid;
  end if;
  return pg_catalog.jsonb_build_object('liked', coalesce(p_like, false));
end $function$;

-- 12. Videos: signed links within the play budget --------------------------------------------------------------------

-- For /api/social/video-links (called with the member's own session): of p_paths (at most 10 .mp4 files), the ones the
-- member may play. A video is counted once a member a day (its path joins the member's 'video_bytes:day' row), so a
-- new link to one already counted today is free: a signed link can be fetched again during its life anyway. Each
-- counted video takes one of the member's 40 plays a day, and its bytes count against the member's share
-- (video_play_bytes_per_member_day) and the project's daily play bytes (video_play_bytes_per_day, fitx_social_caps),
-- so no one account can spend everyone's plays. Raises social_unavailable while videos are off and social_link_budget
-- (hint 'member' or 'project') when a budget is spent.
create or replace function public.fitx_social_video_link_allowed(p_paths text[])
returns text[]
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_day timestamptz := pg_catalog.date_trunc('day', pg_catalog.now());
  v_caps jsonb := public.fitx_social_caps();
  v_cap bigint := (v_caps ->> 'video_play_bytes_per_day')::bigint;
  v_share bigint := coalesce((v_caps ->> 'video_play_bytes_per_member_day')::bigint, (v_caps ->> 'video_play_bytes_per_day')::bigint / 5);
  v_path text;
  v_bytes bigint;
  v_used bigint;
  v_mine bigint;
  v_counted text[];
  v_allowed text[] := '{}';
begin
  if coalesce((select ps.features ->> 'explore_video' from public.platform_settings ps where ps.id = 1), 'false') <> 'true' then
    raise exception using errcode = 'P0001', message = 'social_unavailable';
  end if;
  if p_paths is null or pg_catalog.cardinality(p_paths) not between 1 and 10 then
    raise exception using errcode = '23514', message = 'social_invalid';
  end if;
  -- The member's row for today, locked, so two calls at once cannot both count one video or both pass the share.
  insert into public.social_rate_counters as c (user_id, action, window_start, hits, paths)
  values (v_uid, 'video_bytes:day', v_day, 0, '{}')
  on conflict (user_id, action, window_start) do nothing;
  select c.hits, coalesce(c.paths, '{}') into v_mine, v_counted from public.social_rate_counters c
  where c.user_id = v_uid and c.action = 'video_bytes:day' and c.window_start = v_day
  for update;
  foreach v_path in array p_paths loop
    if v_path is null or v_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9][.]mp4$'
       or v_path = any (v_allowed)
       or not (exists (select 1 from public.social_post_media m
                       where m.storage_path = v_path and m.kind = 'video' and public.fitx_social_sees_post(v_uid, m.post_id))
               or exists (select 1 from public.social_stories s
                          where s.storage_path = v_path and s.kind = 'video' and public.fitx_social_sees_story(v_uid, s.id))) then
      continue;
    end if;
    select coalesce(case when (o.metadata ->> 'size') ~ '^[0-9]{1,15}$' then (o.metadata ->> 'size')::bigint end, 3145728) into v_bytes
    from storage.objects o where o.bucket_id = 'social-media' and o.name = v_path;
    if not found then
      continue;
    end if;
    if v_path = any (v_counted) then
      v_allowed := v_allowed || v_path;
      continue;
    end if;
    if (select coalesce(pg_catalog.sum(c.hits), 0) from public.social_rate_counters c
        where c.user_id = v_uid and c.action = 'video_view:day' and c.window_start = v_day) >= 40
       or v_mine + v_bytes > v_share then
      raise exception using errcode = 'PT429', message = 'social_link_budget', hint = 'member';
    end if;
    select coalesce(pg_catalog.sum(c.hits), 0) into v_used from public.social_rate_counters c
    where c.action = 'video_bytes:day' and c.window_start = v_day;
    if v_used + v_bytes > v_cap then
      raise exception using errcode = 'PT429', message = 'social_link_budget', hint = 'project';
    end if;
    perform public.fitx_social_take(v_uid, 'video_view', 40, 40);
    v_mine := least(v_mine + v_bytes, 2147483647);
    v_counted := v_counted || v_path;
    update public.social_rate_counters c set hits = v_mine::integer, paths = v_counted
    where c.user_id = v_uid and c.action = 'video_bytes:day' and c.window_start = v_day;
    v_allowed := v_allowed || v_path;
  end loop;
  return v_allowed;
end $function$;

-- 13. "Your Explore content" ------------------------------------------------------------------------------------------

-- The member's own posts (newest first, paged by p_before_at), stories (live or waiting for clean-up) and how many
-- comments they wrote. Open while suspended or switched off.
create or replace function public.fitx_social_my_content(p_before_at timestamptz default null, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member_any();
begin
  return pg_catalog.jsonb_build_object(
    'posts', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', x.id, 'kind', x.kind, 'caption', pg_catalog.left(x.caption, 140),
        'created_at', x.created_at, 'community_id', x.community_id,
        'moderation', case when x.moderation_state <> 'visible' then x.moderation_state end,
        'thumb', (select coalesce(m.poster_path, m.storage_path) from public.social_post_media m where m.post_id = x.id order by m.position limit 1),
        'media_count', (select pg_catalog.count(*) from public.social_post_media m where m.post_id = x.id))
        order by x.created_at desc, x.id desc)
      from (select * from public.social_posts p
            where p.user_id = v_uid and (p_before_at is null or p.created_at < p_before_at)
            order by p.created_at desc, p.id desc
            limit least(greatest(coalesce(p_limit, 30), 1), 60)) x), '[]'::jsonb),
    'stories', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', s.id, 'kind', s.kind, 'path', s.storage_path,
        'poster_path', s.poster_path, 'caption', s.caption, 'created_at', s.created_at, 'expires_at', s.expires_at,
        'live', s.expires_at > pg_catalog.now(), 'moderation', case when s.moderation_state <> 'visible' then s.moderation_state end)
        order by s.created_at desc)
      from public.social_stories s where s.user_id = v_uid), '[]'::jsonb),
    'counts', pg_catalog.jsonb_build_object(
      'posts', (select pg_catalog.count(*) from public.social_posts p where p.user_id = v_uid),
      'videos', (select pg_catalog.count(*) from public.social_posts p where p.user_id = v_uid and p.kind = 'video'),
      'stories', (select pg_catalog.count(*) from public.social_stories s where s.user_id = v_uid),
      'comments', (select pg_catalog.count(*) from public.social_comments c where c.user_id = v_uid)));
end $function$;

-- Deletes every post, video, story and comment of the member (their profile, follows and settings stay). Returns the
-- file paths for the app to delete. Open while suspended or switched off.
create or replace function public.fitx_social_delete_all_content()
returns text[]
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member_any();
  v_paths text[];
begin
  perform public.fitx_social_take(v_uid, 'delete_all', 5, 10);
  select coalesce(pg_catalog.array_agg(x.path), '{}') into v_paths
  from (select m.storage_path as path from public.social_post_media m where m.user_id = v_uid
        union all select m.poster_path from public.social_post_media m where m.user_id = v_uid and m.poster_path is not null
        union all select s.storage_path from public.social_stories s where s.user_id = v_uid
        union all select s.poster_path from public.social_stories s where s.user_id = v_uid and s.poster_path is not null) x;
  delete from public.social_comments c where c.user_id = v_uid;
  delete from public.social_posts p where p.user_id = v_uid;
  delete from public.social_stories s where s.user_id = v_uid;
  return v_paths;
end $function$;

-- 14. The hourly clean-up (pg_cron job fitx-social-hourly) ---------------------------------------------------------------

-- 1. deletes expired stories that have no open report and queues their files; 2. queues files older than 6 hours that
-- nothing refers to; 3. forgets trash rows whose file is already gone; 4. removes report evidence 90 days after review
-- (O8 a); 5. deletes notifications older than 90 days. Files leave the bucket only through /api/social/sweep (Storage
-- API). Returns what it did.
create or replace function public.fitx_social_hourly()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_stories bigint;
  v_queued bigint;
  v_orphans bigint;
  v_gone bigint;
  v_evidence bigint;
  v_notifications bigint;
begin
  with gone as (
    delete from public.social_stories s
    where s.expires_at <= pg_catalog.now()
      and not exists (select 1 from public.social_reports r
                      where r.target_type = 'story' and r.target_id = s.id and r.status in ('open', 'reviewing'))
    returning s.storage_path, s.poster_path
  ), queued as (
    insert into public.social_storage_trash (path, reason)
    select x.path, 'story_expired' from gone g, pg_catalog.unnest(array[g.storage_path, g.poster_path]) as x(path)
    where x.path is not null
    on conflict (path) do nothing
    returning 1
  )
  select (select pg_catalog.count(*) from gone), (select pg_catalog.count(*) from queued) into v_stories, v_queued;

  insert into public.social_storage_trash (path, reason)
  select o.name, 'orphan' from storage.objects o
  where o.bucket_id = 'social-media' and o.created_at < pg_catalog.now() - interval '6 hours'
    and not exists (select 1 from public.social_profiles p where p.avatar_path = o.name)
    and not exists (select 1 from public.social_post_media m where m.storage_path = o.name)
    and not exists (select 1 from public.social_post_media m where m.poster_path = o.name)
    and not exists (select 1 from public.social_stories s where s.storage_path = o.name)
    and not exists (select 1 from public.social_stories s where s.poster_path = o.name)
    and not exists (select 1 from public.social_communities c where c.cover_path = o.name)
  on conflict (path) do nothing;
  get diagnostics v_orphans = row_count;

  delete from public.social_storage_trash t
  where not exists (select 1 from storage.objects o where o.bucket_id = 'social-media' and o.name = t.path);
  get diagnostics v_gone = row_count;

  update public.social_reports r set evidence = null
  where r.evidence is not null
    and (r.evidence_purge_at <= pg_catalog.now()
         or (r.evidence_purge_at is null and r.reviewed_at is not null and r.reviewed_at <= pg_catalog.now() - interval '90 days'));
  get diagnostics v_evidence = row_count;

  delete from public.social_notifications n where n.created_at < pg_catalog.now() - interval '90 days';
  get diagnostics v_notifications = row_count;

  return pg_catalog.jsonb_build_object('stories_deleted', v_stories, 'files_queued', v_queued + v_orphans, 'trash_forgotten', v_gone,
    'evidence_purged', v_evidence, 'notifications_pruned', v_notifications, 'ran_at', pg_catalog.now());
end $function$;

-- 15. Grants -------------------------------------------------------------------------------------------------------------

do $do$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'fitx_social_me()', 'fitx_social_save_profile(text, text, text, boolean, text)', 'fitx_social_set_birth_date(date)',
    'fitx_social_unfollow(uuid)', 'fitx_social_set_block(uuid, boolean)', 'fitx_social_set_restrict(uuid, boolean)',
    'fitx_social_report(text, uuid, text, text)', 'fitx_social_create_post(uuid, text, text, jsonb, text, jsonb)',
    'fitx_social_update_post(uuid, text, text, jsonb, text)', 'fitx_social_delete_post(uuid)', 'fitx_social_set_like(uuid, boolean)',
    'fitx_social_set_save(uuid, boolean)', 'fitx_social_add_comment(uuid, uuid, text)', 'fitx_social_delete_comment(uuid)',
    'fitx_social_feed(timestamptz, uuid, integer)', 'fitx_social_browse(uuid, text, text, timestamptz, uuid, integer)',
    'fitx_social_trending(text, integer, integer, integer)', 'fitx_social_suggestions(integer)', 'fitx_social_search(text, integer)',
    'fitx_social_post(uuid)', 'fitx_social_saved(timestamptz, integer)', 'fitx_social_comments(uuid, timestamptz, uuid, integer)',
    'fitx_social_notifications(timestamptz, uuid, integer)', 'fitx_social_notification_prefs()',
    'fitx_social_save_notification_prefs(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean)',
    'fitx_social_safety_lists()',
    'fitx_social_create_story(uuid, text, text, text, integer, integer, integer, text)', 'fitx_social_delete_story(uuid)',
    'fitx_social_story_tray()', 'fitx_social_stories(uuid)', 'fitx_social_view_story(uuid)', 'fitx_social_story_viewers(uuid)',
    'fitx_social_set_story_like(uuid, boolean)', 'fitx_social_video_link_allowed(text[])',
    'fitx_social_my_content(timestamptz, integer)', 'fitx_social_delete_all_content()'
  ] loop
    execute pg_catalog.format('revoke all on function public.%s from public, anon', v_fn);
    execute pg_catalog.format('grant execute on function public.%s to authenticated, service_role', v_fn);
  end loop;
  execute 'revoke all on function public.fitx_social_hourly() from public, anon, authenticated';
  execute 'grant execute on function public.fitx_social_hourly() to service_role';
end $do$;

-- 16. Write budget: the new tables members' Explore actions write -------------------------------------------------------

do $do$
declare
  v_table text;
begin
  if pg_catalog.to_regprocedure('public.fitx_member_write_budget()') is null then
    return;
  end if;
  foreach v_table in array array[
    'social_stories', 'social_story_views', 'social_story_likes', 'social_conversations', 'social_conversation_sides',
    'social_messages', 'social_community_members', 'social_challenge_entries'
  ] loop
    execute pg_catalog.format(
      'create or replace trigger fitx_write_budget_insert after insert on public.%I '
      'referencing new table as new_rows for each statement execute function public.fitx_member_write_budget()', v_table);
    execute pg_catalog.format(
      'create or replace trigger fitx_write_budget_update after update on public.%I '
      'referencing new table as new_rows for each statement execute function public.fitx_member_write_budget()', v_table);
  end loop;
end $do$;

-- 17. The hourly job (only where pg_cron is on, as in production; scheduling the same name again replaces it) ----------

do $do$
begin
  if pg_catalog.to_regnamespace('cron') is not null then
    execute $s$select cron.schedule('fitx-social-hourly', '7 * * * *', 'select public.fitx_social_hourly()')$s$;
  end if;
end $do$;

notify pgrst, 'reload schema';
