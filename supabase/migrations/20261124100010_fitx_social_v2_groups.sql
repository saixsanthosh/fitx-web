-- FITX Explore, part 2 groups (wave 2, migration M2; runbook #53). Builds on 20261124100000_fitx_social_v2_core.sql, which
-- created every table this file reads and writes (conversations, their sides and messages, communities and members,
-- challenges with templates, entries and badges, the moderation record). This file creates no table.
--
-- What it adds (24 functions, one index, one pg_cron job):
--   * Direct messages: fitx_social_send_message, _conversations, _messages, _answer_conversation,
--     _mark_conversation_read, _unsend_message, _set_dm_policy and _unread_counts. Messages need an adult on both sides
--     (O1 a: no date of birth counts as under 18 until one is added); a block either way stops them. Who may start a
--     conversation follows the recipient's dm_policy (everyone, followers, mutuals or off). A conversation starts as a
--     request (one message, no read receipts, a notice that names nobody) unless the recipient follows the sender and
--     has not restricted them. Replying to a request accepts it. Unsending blanks the body. A member who sends the same
--     longer text into three other conversations within an hour is stopped (spam). Shared posts are checked again for
--     the reader every time they are read, and story replies need a live story the sender sees.
--   * Communities (created by FITX in Admin, O3 a): fitx_social_communities, _community, _community_posts,
--     _join_community (private ones wait for a moderator), _answer_community_request and _leave_community. Adults only.
--   * Group posts: fitx_social_create_group_post (a community post or discussion, or a challenge progress share; the
--     value shown beside a progress share is always the member's computed entry, never a typed number) and
--     fitx_social_moderator_remove_post (a community's moderators hide posts in their own community only; recorded in
--     social_moderation_actions as actor_kind 'member'; the author is told it was the community's moderators).
--   * Challenges: fitx_social_challenges, _challenge, _join_challenge, _leave_challenge, _set_leaderboard and
--     _challenge_board (adults who opted in only). Values come only from the member's own completed workouts and
--     activities from when they joined (or the start, if later) to the end: workouts, distance (km, filtered by sport),
--     active minutes (the union of activity and workout time, so nothing is counted twice) and active days (in
--     Asia/Kolkata, O6 a). fitx_social_challenge_sync (internal) works one entry out; fitx_social_challenge_tick
--     (internal, the hourly job fitx-challenge-hourly) syncs every member of every open challenge, closes challenges
--     2 hours after they end (after a final sync), awards "Completed" (target reached) and "Top 3" (only with 10 or more
--     members on the board), and opens this week's and this month's challenge from every active template. Admin's
--     close calls fitx_social_challenge_tick(<challenge id>), which syncs, closes and awards that one challenge now.
--   * An index for the challenge sums: workout_sessions_user_completed_idx.
--
-- No new table policies: other members' messages, memberships, entries and badges are read only through these security
-- definer functions, which apply blocks, age bands, moderation and suspensions (the helpers they need are not granted
-- to members, so a policy could not call them). The own-row policies of 20261124100000 stay as they are.
--
-- Additive and safe to run again: create or replace, create index if not exists, and a guarded pg_cron block
-- (scheduling the same job name again replaces it). It changes no row.
--
-- Undo (drops this file's functions, its index and its job; the tables and their rows stay, they belong to
-- 20261124100000; posts a community moderator hid stay hidden):
--   begin;
--   do $u$ begin if pg_catalog.to_regnamespace('cron') is not null then
--     execute $e$select cron.unschedule(jobid) from cron.job where jobname = 'fitx-challenge-hourly'$e$; end if; end $u$;
--   drop function if exists public.fitx_social_send_message(uuid, text, uuid, uuid), public.fitx_social_conversations(timestamptz, text),
--     public.fitx_social_messages(uuid, timestamptz, uuid), public.fitx_social_answer_conversation(uuid, boolean),
--     public.fitx_social_mark_conversation_read(uuid), public.fitx_social_unsend_message(uuid), public.fitx_social_set_dm_policy(text),
--     public.fitx_social_unread_counts(), public.fitx_social_communities(text), public.fitx_social_community(text),
--     public.fitx_social_community_posts(uuid, timestamptz, uuid), public.fitx_social_join_community(uuid),
--     public.fitx_social_answer_community_request(uuid, uuid, boolean), public.fitx_social_leave_community(uuid),
--     public.fitx_social_create_group_post(uuid, text, jsonb, jsonb, uuid, uuid), public.fitx_social_moderator_remove_post(uuid, text),
--     public.fitx_social_challenges(text), public.fitx_social_challenge(uuid), public.fitx_social_join_challenge(uuid),
--     public.fitx_social_leave_challenge(uuid), public.fitx_social_set_leaderboard(uuid, boolean), public.fitx_social_challenge_board(uuid),
--     public.fitx_social_challenge_sync(uuid, uuid), public.fitx_social_challenge_tick(uuid);
--   drop index if exists public.workout_sessions_user_completed_idx;
--   commit;

do $do$ begin perform pg_catalog.set_config('lock_timeout', '5s', true); end $do$;

-- 1. The index the challenge sums need (activities already has (user_id, started_at)) -------------------------------

create index if not exists workout_sessions_user_completed_idx on public.workout_sessions (user_id, completed_at)
  where status = 'completed';

-- 2. Direct messages ---------------------------------------------------------------------------------------------------

-- Sends one message to p_to: text (1 to 2,000 characters), a shared post (the text may then be empty) or a reply to
-- p_to's live story. Starts the conversation when there is none: accepted when p_to follows the sender and has not
-- restricted them, otherwise a request (one message until p_to accepts or replies). Returns
-- {conversation_id, status, message}.
create or replace function public.fitx_social_send_message(p_to uuid, p_body text, p_shared_post_id uuid default null,
  p_story_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_body text := pg_catalog.btrim(coalesce(p_body, ''));
  v_band text;
  v_policy text;
  v_conversation public.social_conversations;
  v_status text;
  v_story_owner uuid;
  v_story_live boolean;
  v_message public.social_messages;
  v_follows_me boolean;
  v_i_follow boolean;
  v_new_account boolean;
  v_muted boolean;
begin
  if exists (select 1 from public.social_member_sanctions s
             where s.user_id = v_uid and s.kind = 'dm' and s.lifted_at is null and (s.until is null or s.until > pg_catalog.now())) then
    raise exception using errcode = 'P0001', message = 'social_suspended', hint = 'dm';
  end if;
  v_band := public.fitx_social_age_band(v_uid);
  if v_band <> 'adult' then
    raise exception using errcode = 'P0001', message = 'social_age_restricted', hint = v_band;
  end if;
  if p_to is null or p_to = v_uid or char_length(v_body) > 2000
     or (v_body = '' and p_shared_post_id is null)
     or (p_story_id is not null and (p_shared_post_id is not null or v_body = '')) then
    raise exception using errcode = '23514', message = 'social_invalid';
  end if;
  select p.dm_policy into v_policy from public.social_profiles p where p.user_id = p_to;
  if not found or exists (select 1 from public.social_member_sanctions s
                          where s.user_id = p_to and s.kind = 'explore' and s.lifted_at is null
                            and (s.until is null or s.until > pg_catalog.now())) then
    raise exception using errcode = 'P0001', message = 'social_not_found';
  end if;
  if public.fitx_social_blocked(v_uid, p_to) then
    raise exception using errcode = 'P0001', message = 'social_dm_not_allowed', hint = 'blocked';
  end if;
  if public.fitx_social_age_band(p_to) <> 'adult' then
    raise exception using errcode = 'P0001', message = 'social_dm_not_allowed', hint = 'age';
  end if;
  if p_shared_post_id is not null and not public.fitx_social_sees_post(v_uid, p_shared_post_id) then
    raise exception using errcode = 'P0001', message = 'social_not_found';
  end if;
  if p_story_id is not null then
    select s.user_id, s.expires_at > pg_catalog.now() into v_story_owner, v_story_live from public.social_stories s where s.id = p_story_id;
    if v_story_owner is distinct from p_to then
      raise exception using errcode = 'P0001', message = 'social_not_found';
    end if;
    if not public.fitx_social_sees_story(v_uid, p_story_id) then
      raise exception using errcode = 'P0001', message = case when v_story_live then 'social_not_found' else 'social_story_expired' end;
    end if;
  end if;

  select * into v_conversation from public.social_conversations c
  where c.user_low = least(v_uid, p_to) and c.user_high = greatest(v_uid, p_to)
  for update;
  if found then
    v_status := v_conversation.status;
    if v_status = 'request' then
      if v_conversation.requested_by = v_uid then
        raise exception using errcode = 'P0001', message = 'social_dm_not_allowed', hint = 'pending';
      end if;
      -- Replying to a request accepts it.
      update public.social_conversations c set status = 'accepted' where c.id = v_conversation.id;
      v_status := 'accepted';
      update public.social_notifications n set read_at = pg_catalog.now()
      where n.user_id = v_uid and n.conversation_id = v_conversation.id and n.type = 'message_request' and n.read_at is null;
    end if;
  else
    v_follows_me := exists (select 1 from public.social_follows f where f.user_id = p_to and f.following_id = v_uid and f.status = 'accepted');
    v_i_follow := exists (select 1 from public.social_follows f where f.user_id = v_uid and f.following_id = p_to and f.status = 'accepted');
    if v_policy = 'off' or (v_policy = 'followers' and not v_i_follow) or (v_policy = 'mutuals' and not (v_i_follow and v_follows_me)) then
      raise exception using errcode = 'P0001', message = 'social_dm_not_allowed', hint = 'policy';
    end if;
    v_status := case when v_follows_me and not exists (select 1 from public.social_restricts r where r.user_id = p_to and r.restricted_id = v_uid)
                     then 'accepted' else 'request' end;
    if v_status = 'request' then
      v_new_account := coalesce((select p.created_at > pg_catalog.now() - interval '7 days' from public.social_profiles p where p.user_id = v_uid), true);
      perform public.fitx_social_take(v_uid, 'dm_request', 5, case when v_new_account then 2 else 15 end);
    end if;
    insert into public.social_conversations (user_low, user_high, status, requested_by)
    values (least(v_uid, p_to), greatest(v_uid, p_to), v_status, v_uid)
    returning * into v_conversation;
    insert into public.social_conversation_sides (conversation_id, user_id)
    values (v_conversation.id, v_uid), (v_conversation.id, p_to)
    on conflict do nothing;
  end if;

  -- The same longer text into three other conversations within an hour reads as spam.
  if char_length(v_body) >= 12 and (
      select pg_catalog.count(distinct m.conversation_id) from public.social_messages m
      where m.user_id = v_uid and m.created_at > pg_catalog.now() - interval '1 hour' and m.deleted_at is null
        and m.conversation_id <> v_conversation.id and pg_catalog.lower(m.body) = pg_catalog.lower(v_body)) >= 3 then
    raise exception using errcode = 'PT429', message = 'social_rate_limited', hint = 'hour';
  end if;
  perform public.fitx_social_take(v_uid, 'message', 60, 500);

  insert into public.social_messages (conversation_id, user_id, body, shared_post_id, story_id, shared_post, story_reply)
  values (v_conversation.id, v_uid, v_body, p_shared_post_id, p_story_id, p_shared_post_id is not null, p_story_id is not null)
  returning * into v_message;
  update public.social_conversations c set last_message_at = v_message.created_at where c.id = v_conversation.id;
  update public.social_conversation_sides s set last_read_at = v_message.created_at, hidden_at = null
  where s.conversation_id = v_conversation.id and s.user_id = v_uid;
  update public.social_conversation_sides s set hidden_at = null
  where s.conversation_id = v_conversation.id and s.user_id = p_to and s.hidden_at is not null and v_status = 'accepted'
  returning s.muted into v_muted;
  if v_muted is null then
    select s.muted into v_muted from public.social_conversation_sides s where s.conversation_id = v_conversation.id and s.user_id = p_to;
  end if;

  if v_status = 'request' then
    perform public.fitx_social_notify(p_to, null, 'message_request', 'conversation', v_conversation.id);
  elsif p_story_id is not null then
    perform public.fitx_social_notify(p_to, v_uid, 'story_reply', 'story', p_story_id);
  elsif not coalesce(v_muted, false) then
    perform public.fitx_social_notify(p_to, v_uid, 'message', 'message', v_message.id);
  end if;
  perform public.fitx_social_ping(p_to, 'message', v_conversation.id);

  return pg_catalog.jsonb_build_object(
    'conversation_id', v_conversation.id,
    'status', v_status,
    'message', pg_catalog.jsonb_build_object(
      'id', v_message.id, 'mine', true, 'body', v_message.body, 'unsent', false, 'created_at', v_message.created_at,
      'post', (select public.fitx_social_post_json(v_uid, p) from public.social_posts p where p.id = v_message.shared_post_id),
      'post_unavailable', false,
      'story', case when v_message.story_id is null then null else pg_catalog.jsonb_build_object('id', v_message.story_id, 'available', true) end));
end $function$;

-- The member's conversations, newest first (30 a page, before p_before): 'inbox' (accepted ones and the member's own
-- waiting requests) or 'requests' (requests waiting for the member's answer). Conversations with a block either way,
-- with a suspended member, or that the member deleted (until a new message) are left out.
create or replace function public.fitx_social_conversations(p_before timestamptz default null, p_box text default 'inbox')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_band text := public.fitx_social_age_band(v_uid);
begin
  if v_band <> 'adult' then
    raise exception using errcode = 'P0001', message = 'social_age_restricted', hint = v_band;
  end if;
  if p_box is null or p_box not in ('inbox', 'requests') then
    raise exception using errcode = '23514', message = 'social_invalid';
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', x.id,
        'status', x.status,
        'requested_by_me', x.requested_by = v_uid,
        'other', public.fitx_social_author_json(x.other),
        'last_message_at', x.last_message_at,
        'last', (select pg_catalog.jsonb_build_object(
                   'mine', m.user_id = v_uid,
                   'kind', case when m.deleted_at is not null then 'unsent' when m.story_reply then 'story'
                                when m.shared_post and m.body = '' then 'post' else 'text' end,
                   'body', case when m.deleted_at is null then pg_catalog.left(m.body, 140) else '' end,
                   'created_at', m.created_at)
                 from public.social_messages m
                 where m.conversation_id = x.id and (m.user_id = v_uid or m.moderation_state = 'visible')
                 order by m.created_at desc, m.id desc limit 1),
        'unread', (select pg_catalog.count(*) from public.social_messages m
                   where m.conversation_id = x.id and m.user_id <> v_uid and m.moderation_state = 'visible' and m.deleted_at is null
                     and m.created_at > coalesce(x.last_read_at, '-infinity'::timestamptz)))
      order by x.last_message_at desc, x.id desc)
    from (
      select c.id, c.status, c.requested_by, c.last_message_at, s.last_read_at,
             case when c.user_low = v_uid then c.user_high else c.user_low end as other
      from public.social_conversations c
      join public.social_conversation_sides s on s.conversation_id = c.id and s.user_id = v_uid
      where v_uid in (c.user_low, c.user_high)
        and c.last_message_at is not null
        and (s.hidden_at is null or c.last_message_at > s.hidden_at)
        and case p_box when 'requests' then c.status = 'request' and c.requested_by <> v_uid
                       else c.status = 'accepted' or c.requested_by = v_uid end
        and (p_before is null or c.last_message_at < p_before)
        and not public.fitx_social_blocked(v_uid, case when c.user_low = v_uid then c.user_high else c.user_low end)
        and exists (select 1 from public.social_profiles p where p.user_id = case when c.user_low = v_uid then c.user_high else c.user_low end)
        and not exists (select 1 from public.social_member_sanctions z
                        where z.user_id = case when c.user_low = v_uid then c.user_high else c.user_low end
                          and z.kind = 'explore' and z.lifted_at is null and (z.until is null or z.until > pg_catalog.now()))
      order by c.last_message_at desc, c.id desc
      limit 30
    ) x), '[]'::jsonb);
end $function$;

-- One conversation the member is a side of: who it is with, whether the member can send now, and 40 messages a page,
-- newest first (before p_before_at / p_before_id). Hidden messages reach only their sender; unsent ones have no text;
-- a shared post is shown only while the reader can see it.
create or replace function public.fitx_social_messages(p_conversation uuid, p_before_at timestamptz default null, p_before_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_band text := public.fitx_social_age_band(v_uid);
  v_conversation public.social_conversations;
  v_other uuid;
  v_dm_paused boolean;
begin
  if v_band <> 'adult' then
    raise exception using errcode = 'P0001', message = 'social_age_restricted', hint = v_band;
  end if;
  select * into v_conversation from public.social_conversations c where c.id = p_conversation and v_uid in (c.user_low, c.user_high);
  if not found then
    raise exception using errcode = 'P0001', message = 'social_not_found';
  end if;
  v_other := case when v_conversation.user_low = v_uid then v_conversation.user_high else v_conversation.user_low end;
  if public.fitx_social_blocked(v_uid, v_other)
     or not exists (select 1 from public.social_profiles p where p.user_id = v_other)
     or exists (select 1 from public.social_member_sanctions z where z.user_id = v_other and z.kind = 'explore' and z.lifted_at is null
                  and (z.until is null or z.until > pg_catalog.now())) then
    raise exception using errcode = 'P0001', message = 'social_not_found';
  end if;
  v_dm_paused := exists (select 1 from public.social_member_sanctions z where z.user_id = v_uid and z.kind = 'dm' and z.lifted_at is null
                           and (z.until is null or z.until > pg_catalog.now()));
  return pg_catalog.jsonb_build_object(
    'conversation', pg_catalog.jsonb_build_object(
      'id', v_conversation.id,
      'status', v_conversation.status,
      'requested_by_me', v_conversation.requested_by = v_uid,
      'other', public.fitx_social_author_json(v_other),
      'dm_paused', v_dm_paused,
      'can_send', not v_dm_paused and public.fitx_social_age_band(v_other) = 'adult'
                  and (v_conversation.status = 'accepted' or v_conversation.requested_by <> v_uid)),
    'messages', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id', m.id,
          'mine', m.user_id = v_uid,
          'body', case when m.deleted_at is null then m.body else '' end,
          'unsent', m.deleted_at is not null,
          'created_at', m.created_at,
          'post', case when m.shared_post_id is not null and public.fitx_social_sees_post(v_uid, m.shared_post_id)
                       then (select public.fitx_social_post_json(v_uid, p) from public.social_posts p where p.id = m.shared_post_id) end,
          -- A post deleted since it was shared (its link is then null) reads as unavailable like one the reader cannot see.
          'post_unavailable', m.deleted_at is null and m.shared_post
                              and (m.shared_post_id is null or not public.fitx_social_sees_post(v_uid, m.shared_post_id)),
          -- A story reply keeps its tag after the hourly clean-up deletes the story (id null, never available).
          'story', case when m.deleted_at is not null or not m.story_reply then null
                        when m.story_id is null then pg_catalog.jsonb_build_object('id', null, 'available', false)
                        else pg_catalog.jsonb_build_object('id', m.story_id, 'available', public.fitx_social_sees_story(v_uid, m.story_id)) end)
        order by m.created_at desc, m.id desc)
      from (
        select * from public.social_messages m
        where m.conversation_id = v_conversation.id
          and (m.user_id = v_uid or m.moderation_state = 'visible')
          and (p_before_at is null or (m.created_at, m.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
        order by m.created_at desc, m.id desc
        limit 40
      ) m), '[]'::jsonb));
end $function$;

-- Accepts a request waiting for the member (it moves to the inbox) or deletes it (it leaves the member's lists; the
-- sender still cannot send more). Returns {status, box}.
create or replace function public.fitx_social_answer_conversation(p_conversation uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_band text := public.fitx_social_age_band(v_uid);
  v_conversation public.social_conversations;
begin
  if v_band <> 'adult' then
    raise exception using errcode = 'P0001', message = 'social_age_restricted', hint = v_band;
  end if;
  select * into v_conversation from public.social_conversations c
  where c.id = p_conversation and v_uid in (c.user_low, c.user_high) and c.status = 'request' and c.requested_by <> v_uid
  for update;
  if not found or p_accept is null then
    raise exception using errcode = 'P0001', message = 'social_not_found';
  end if;
  update public.social_notifications n set read_at = pg_catalog.now()
  where n.user_id = v_uid and n.conversation_id = v_conversation.id and n.read_at is null;
  if p_accept then
    update public.social_conversations c set status = 'accepted' where c.id = v_conversation.id;
    update public.social_conversation_sides s set hidden_at = null, last_read_at = pg_catalog.now()
    where s.conversation_id = v_conversation.id and s.user_id = v_uid;
    perform public.fitx_social_ping(v_conversation.requested_by, 'conversation', v_conversation.id);
    return pg_catalog.jsonb_build_object('status', 'accepted', 'box', 'inbox');
  end if;
  update public.social_conversation_sides s set hidden_at = pg_catalog.now()
  where s.conversation_id = v_conversation.id and s.user_id = v_uid;
  return pg_catalog.jsonb_build_object('status', 'request', 'box', null);
end $function$;

-- Marks the conversation read for the member, and its message notices with it.
create or replace function public.fitx_social_mark_conversation_read(p_conversation uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
begin
  update public.social_conversation_sides s set last_read_at = pg_catalog.now()
  where s.conversation_id = p_conversation and s.user_id = v_uid;
  if not found then
    raise exception using errcode = 'P0001', message = 'social_not_found';
  end if;
  update public.social_notifications n set read_at = pg_catalog.now()
  where n.user_id = v_uid and n.conversation_id = p_conversation and n.read_at is null;
  return true;
end $function$;

-- Unsends one of the member's own messages: the text, shared post and story link are removed; "Unsent" stays in place.
-- Open while suspended or while Explore is switched off.
create or replace function public.fitx_social_unsend_message(p_message uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member_any();
  v_conversation public.social_conversations;
begin
  select c.* into v_conversation from public.social_messages m join public.social_conversations c on c.id = m.conversation_id
  where m.id = p_message and m.user_id = v_uid;
  if not found then
    raise exception using errcode = 'P0001', message = 'social_not_found';
  end if;
  update public.social_messages m set body = '', shared_post_id = null, story_id = null, deleted_at = pg_catalog.now()
  where m.id = p_message and m.deleted_at is null;
  perform public.fitx_social_ping(case when v_conversation.user_low = v_uid then v_conversation.user_high else v_conversation.user_low end,
    'message', v_conversation.id);
  return true;
end $function$;

-- Who may start a conversation with the member: everyone, followers (the default), mutuals or nobody (off).
-- Conversations already accepted carry on.
create or replace function public.fitx_social_set_dm_policy(p_policy text)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
begin
  if p_policy is null or p_policy not in ('everyone', 'followers', 'mutuals', 'off') then
    raise exception using errcode = '23514', message = 'social_invalid';
  end if;
  perform public.fitx_social_take(v_uid, 'profile', 30, 100);
  update public.social_profiles p set dm_policy = p_policy, updated_at = pg_catalog.now() where p.user_id = v_uid;
  return p_policy;
end $function$;

-- The member's unread counts: messages in inbox conversations, requests waiting for an answer, and notifications. They
-- leave out what the lists leave out (a block either way, no Explore profile, an Explore suspension), so a badge never
-- counts what the member cannot open. A count the member has no access to (no Explore profile; Explore paused or
-- suspended; messages under 18) is null, never 0.
create or replace function public.fitx_social_unread_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_open boolean;
  v_adult boolean;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'social_signed_out';
  end if;
  v_open := exists (select 1 from public.social_profiles p where p.user_id = v_uid)
    and coalesce((select ps.features ->> 'explore' from public.platform_settings ps where ps.id = 1), 'true') <> 'false'
    and not exists (select 1 from public.social_member_sanctions z where z.user_id = v_uid and z.kind = 'explore' and z.lifted_at is null
                      and (z.until is null or z.until > pg_catalog.now()));
  if not v_open then
    return pg_catalog.jsonb_build_object('messages', null, 'requests', null, 'notifications', null);
  end if;
  v_adult := public.fitx_social_age_band(v_uid) = 'adult';
  return pg_catalog.jsonb_build_object(
    'messages', case when v_adult then (
      select pg_catalog.count(*) from public.social_conversations c
      join public.social_conversation_sides s on s.conversation_id = c.id and s.user_id = v_uid
      join public.social_messages m on m.conversation_id = c.id
      where v_uid in (c.user_low, c.user_high) and c.status = 'accepted'
        and (s.hidden_at is null or c.last_message_at > s.hidden_at)
        and m.user_id <> v_uid and m.moderation_state = 'visible' and m.deleted_at is null
        and m.created_at > coalesce(s.last_read_at, '-infinity'::timestamptz)
        and not public.fitx_social_blocked(v_uid, m.user_id)
        and exists (select 1 from public.social_profiles p where p.user_id = m.user_id)
        and not exists (select 1 from public.social_member_sanctions z where z.user_id = m.user_id and z.kind = 'explore'
                          and z.lifted_at is null and (z.until is null or z.until > pg_catalog.now()))) end,
    'requests', case when v_adult then (
      select pg_catalog.count(*) from public.social_conversations c
      join public.social_conversation_sides s on s.conversation_id = c.id and s.user_id = v_uid
      where v_uid in (c.user_low, c.user_high) and c.status = 'request' and c.requested_by <> v_uid and s.hidden_at is null
        and not public.fitx_social_blocked(v_uid, c.requested_by)
        and exists (select 1 from public.social_profiles p where p.user_id = c.requested_by)
        and not exists (select 1 from public.social_member_sanctions z where z.user_id = c.requested_by and z.kind = 'explore'
                          and z.lifted_at is null and (z.until is null or z.until > pg_catalog.now()))) end,
    'notifications', (select pg_catalog.count(*) from public.social_notifications n
                      where n.user_id = v_uid and n.read_at is null and n.type <> 'follow_request'
                        and public.fitx_social_notification_visible(v_uid, n)));
end $function$;

-- 3. Communities -------------------------------------------------------------------------------------------------------

-- The community directory (adults only): every visible community, public or private (a private one shows its name and
-- description so members can ask to join; its posts and cover stay with its members), plus limited ones the member
-- belongs to. The member's own first, then the largest. p_query matches the name, description or address.
create or replace function public.fitx_social_communities(p_query text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_band text := public.fitx_social_age_band(v_uid);
  v_query text := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_query, ''))), '');
begin
  if v_band <> 'adult' then
    raise exception using errcode = 'P0001', message = 'social_age_restricted', hint = v_band;
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(x.item order by x.mine desc, x.members desc, x.name)
    from (
      select c.name, coalesce(m.status = 'accepted', false) as mine, n.members,
        pg_catalog.jsonb_build_object(
          'id', c.id, 'slug', c.slug, 'name', c.name, 'description', c.description, 'visibility', c.visibility,
          'cover_path', case when public.fitx_social_sees_community(v_uid, c.id) then c.cover_path end,
          'member_count', n.members, 'my_status', coalesce(m.status, 'none'), 'my_role', m.role) as item
      from public.social_communities c
      left join public.social_community_members m on m.community_id = c.id and m.user_id = v_uid
      cross join lateral (select pg_catalog.count(*) as members from public.social_community_members a
                          where a.community_id = c.id and a.status = 'accepted') n
      where c.moderation_state <> 'hidden' and (c.moderation_state = 'visible' or m.status = 'accepted')
        and (v_query is null or pg_catalog.strpos(pg_catalog.lower(c.name), v_query) > 0
             or pg_catalog.strpos(pg_catalog.lower(c.description), v_query) > 0 or pg_catalog.strpos(c.slug, v_query) > 0)
      order by coalesce(m.status = 'accepted', false) desc, n.members desc, c.name
      limit 60
    ) x), '[]'::jsonb);
end $function$;

-- One community by its address (adults only), or null: its details, the member's place in it, its moderators, the
-- requests waiting (moderators only) and its open challenges (when the member sees its content).
create or replace function public.fitx_social_community(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_band text := public.fitx_social_age_band(v_uid);
  v_community public.social_communities;
  v_member public.social_community_members;
  v_sees boolean;
  v_moderator boolean;
begin
  if v_band <> 'adult' then
    raise exception using errcode = 'P0001', message = 'social_age_restricted', hint = v_band;
  end if;
  select * into v_community from public.social_communities c where c.slug = pg_catalog.lower(coalesce(p_slug, ''));
  if not found or v_community.moderation_state = 'hidden' then
    return null;
  end if;
  select * into v_member from public.social_community_members m where m.community_id = v_community.id and m.user_id = v_uid;
  if v_community.moderation_state = 'limited' and v_member.status is distinct from 'accepted' then
    return null;
  end if;
  v_sees := public.fitx_social_sees_community(v_uid, v_community.id);
  v_moderator := v_member.status = 'accepted' and v_member.role in ('owner', 'moderator');
  return pg_catalog.jsonb_build_object(
    'community', pg_catalog.jsonb_build_object(
      'id', v_community.id, 'slug', v_community.slug, 'name', v_community.name, 'description', v_community.description,
      'visibility', v_community.visibility, 'cover_path', case when v_sees then v_community.cover_path end,
      'member_count', (select pg_catalog.count(*) from public.social_community_members a where a.community_id = v_community.id and a.status = 'accepted'),
      'my_status', coalesce(v_member.status, 'none'), 'my_role', v_member.role,
      'created_at', v_community.created_at),
    'can_see_posts', v_sees,
    'can_post', v_sees and v_member.status = 'accepted',
    'is_moderator', coalesce(v_moderator, false),
    'moderators', coalesce((
      select pg_catalog.jsonb_agg(public.fitx_social_author_json(m.user_id) order by m.role, m.joined_at)
      from public.social_community_members m
      where m.community_id = v_community.id and m.status = 'accepted' and m.role in ('owner', 'moderator')
        and exists (select 1 from public.social_profiles p where p.user_id = m.user_id)
        and not public.fitx_social_blocked(v_uid, m.user_id)), '[]'::jsonb),
    'requests', case when coalesce(v_moderator, false) then coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('user', public.fitx_social_author_json(m.user_id), 'requested_at', m.joined_at)
                                  order by m.joined_at)
      from public.social_community_members m
      where m.community_id = v_community.id and m.status = 'pending'
        and exists (select 1 from public.social_profiles p where p.user_id = m.user_id)
        and not public.fitx_social_blocked(v_uid, m.user_id)), '[]'::jsonb) else '[]'::jsonb end,
    'challenges', case when v_sees then coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id', c.id, 'kind', c.kind, 'title', c.title, 'metric', c.metric, 'sport', c.sport, 'target', c.target,
          'starts_at', c.starts_at, 'ends_at', c.ends_at,
          'joined', exists (select 1 from public.social_challenge_entries e where e.challenge_id = c.id and e.user_id = v_uid))
        order by c.ends_at)
      from public.social_challenges c
      where c.community_id = v_community.id and c.closed_at is null
        and (c.ends_at > pg_catalog.now()
             or exists (select 1 from public.social_challenge_entries e where e.challenge_id = c.id and e.user_id = v_uid))), '[]'::jsonb)
      else '[]'::jsonb end);
end $function$;

-- A community's posts and discussions, newest first, 12 a page, for members who see its content.
create or replace function public.fitx_social_community_posts(p_community uuid, p_before_at timestamptz default null, p_before_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_band text := public.fitx_social_age_band(v_uid);
begin
  if v_band <> 'adult' then
    raise exception using errcode = 'P0001', message = 'social_age_restricted', hint = v_band;
  end if;
  if not public.fitx_social_sees_community(v_uid, p_community) then
    raise exception using errcode = 'P0001',
      message = case when exists (select 1 from public.social_communities c where c.id = p_community and c.moderation_state = 'visible')
                     then 'social_not_member' else 'social_not_found' end;
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(public.fitx_social_post_json(v_uid, x.post) order by (x.post).created_at desc, (x.post).id desc)
    from (
      select p as post from public.social_posts p
      where p.community_id = p_community
        and public.fitx_social_sees_post(v_uid, p.id)
        and (p_before_at is null or (p.created_at, p.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
      order by p.created_at desc, p.id desc
      limit 12
    ) x), '[]'::jsonb);
end $function$;

-- Joins a community (adults only): a public one at once, a private one as a request its moderators answer (they are
-- told). Returns {status, role}.
create or replace function public.fitx_social_join_community(p_community uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_band text := public.fitx_social_age_band(v_uid);
  v_community public.social_communities;
  v_member public.social_community_members;
  v_moderator uuid;
begin
  if v_band <> 'adult' then
    raise exception using errcode = 'P0001', message = 'social_age_restricted', hint = v_band;
  end if;
  select * into v_community from public.social_communities c where c.id = p_community;
  select * into v_member from public.social_community_members m where m.community_id = p_community and m.user_id = v_uid;
  if v_member.status is not null then
    return pg_catalog.jsonb_build_object('status', v_member.status, 'role', v_member.role);
  end if;
  if v_community.id is null or v_community.moderation_state <> 'visible' then
    raise exception using errcode = 'P0001', message = 'social_not_found';
  end if;
  perform public.fitx_social_take(v_uid, 'group_join', 30, 100);
  insert into public.social_community_members (community_id, user_id, role, status)
  values (p_community, v_uid, 'member', case when v_community.visibility = 'public' then 'accepted' else 'pending' end)
  on conflict do nothing
  returning * into v_member;
  if v_member.status = 'pending' then
    for v_moderator in
      select m.user_id from public.social_community_members m
      where m.community_id = p_community and m.status = 'accepted' and m.role in ('owner', 'moderator')
    loop
      perform public.fitx_social_notify(v_moderator, v_uid, 'community_request', 'community', p_community);
    end loop;
  end if;
  select * into v_member from public.social_community_members m where m.community_id = p_community and m.user_id = v_uid;
  return pg_catalog.jsonb_build_object('status', v_member.status, 'role', v_member.role);
end $function$;

-- A community's owner or moderators accept or decline a request to join; an accepted member is told.
create or replace function public.fitx_social_answer_community_request(p_community uuid, p_user uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
begin
  if not exists (select 1 from public.social_community_members m
                 where m.community_id = p_community and m.user_id = v_uid and m.status = 'accepted' and m.role in ('owner', 'moderator'))
     or not public.fitx_social_sees_community(v_uid, p_community) then
    raise exception using errcode = 'P0001', message = 'social_not_found';
  end if;
  if p_accept is null or not exists (select 1 from public.social_community_members m
                                     where m.community_id = p_community and m.user_id = p_user and m.status = 'pending') then
    raise exception using errcode = 'P0001', message = 'social_not_found';
  end if;
  update public.social_notifications n set read_at = pg_catalog.now()
  where n.user_id = v_uid and n.type = 'community_request' and n.actor_id = p_user and n.community_id = p_community and n.read_at is null;
  if p_accept then
    update public.social_community_members m set status = 'accepted', joined_at = pg_catalog.now()
    where m.community_id = p_community and m.user_id = p_user;
    perform public.fitx_social_notify(p_user, null, 'community_accepted', 'community', p_community);
    return pg_catalog.jsonb_build_object('status', 'accepted');
  end if;
  delete from public.social_community_members m where m.community_id = p_community and m.user_id = p_user and m.status = 'pending';
  return pg_catalog.jsonb_build_object('status', 'none');
end $function$;

-- Leaves a community (or withdraws a request). Open while suspended or while Explore is switched off.
create or replace function public.fitx_social_leave_community(p_community uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member_any();
begin
  delete from public.social_community_members m where m.community_id = p_community and m.user_id = v_uid;
  return true;
end $function$;

-- 4. Group posts ---------------------------------------------------------------------------------------------------------

-- A post in a community (photos, a video while videos are on, or a text discussion) for its accepted members, or a
-- progress share in a challenge the member joined. Exactly one of p_community_id and p_challenge_id. A progress share
-- carries the member's computed entry ({value, rank}), worked out again first; members never type a value.
create or replace function public.fitx_social_create_group_post(p_post_id uuid, p_caption text, p_topics jsonb, p_media jsonb,
  p_community_id uuid default null, p_challenge_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_band text := public.fitx_social_age_band(v_uid);
  v_challenge public.social_challenges;
  v_post public.social_posts;
  v_value numeric;
begin
  if (p_community_id is null) = (p_challenge_id is null) then
    raise exception using errcode = '23514', message = 'social_invalid';
  end if;
  if p_community_id is not null then
    if v_band <> 'adult' then
      raise exception using errcode = 'P0001', message = 'social_age_restricted', hint = v_band;
    end if;
    if not public.fitx_social_sees_community(v_uid, p_community_id)
       and not exists (select 1 from public.social_communities c where c.id = p_community_id and c.moderation_state = 'visible') then
      raise exception using errcode = 'P0001', message = 'social_not_found';
    end if;
    if not exists (select 1 from public.social_community_members m
                   where m.community_id = p_community_id and m.user_id = v_uid and m.status = 'accepted')
       or not public.fitx_social_sees_community(v_uid, p_community_id) then
      raise exception using errcode = 'P0001', message = 'social_not_member';
    end if;
  else
    select * into v_challenge from public.social_challenges c where c.id = p_challenge_id;
    if not found or (v_challenge.community_id is not null and not public.fitx_social_sees_community(v_uid, v_challenge.community_id)) then
      raise exception using errcode = 'P0001', message = 'social_not_found';
    end if;
    if not exists (select 1 from public.social_challenge_entries e where e.challenge_id = p_challenge_id and e.user_id = v_uid) then
      raise exception using errcode = 'P0001', message = 'social_not_member';
    end if;
    if v_challenge.closed_at is not null or v_challenge.ends_at <= pg_catalog.now() then
      raise exception using errcode = 'P0001', message = 'social_challenge_closed';
    end if;
    v_value := public.fitx_social_challenge_sync(p_challenge_id, v_uid);
  end if;
  perform public.fitx_social_take(v_uid, 'community_post', 10, 30);
  v_post := public.fitx_social_insert_post(v_uid, p_post_id, p_caption, null, p_topics, null, p_media, p_community_id, p_challenge_id);
  return public.fitx_social_post_json(v_uid, v_post)
    || case when p_challenge_id is null then '{}'::jsonb
            else pg_catalog.jsonb_build_object('entry', pg_catalog.jsonb_build_object('value', v_value)) end;
end $function$;

-- A community's owner or moderators hide a post in their own community: it is recorded (actor_kind 'member') and its
-- author is told the community's moderators removed it (never which moderator).
create or replace function public.fitx_social_moderator_remove_post(p_post uuid, p_reason_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_post public.social_posts;
begin
  select * into v_post from public.social_posts p where p.id = p_post;
  if not found or v_post.community_id is null or not public.fitx_social_sees_post(v_uid, p_post)
     or not exists (select 1 from public.social_community_members m
                    where m.community_id = v_post.community_id and m.user_id = v_uid and m.status = 'accepted'
                      and m.role in ('owner', 'moderator')) then
    raise exception using errcode = 'P0001', message = 'social_not_found';
  end if;
  if p_reason_code is null or p_reason_code !~ '^[a-z_]{1,40}$' then
    raise exception using errcode = '23514', message = 'social_invalid';
  end if;
  update public.social_posts p set moderation_state = 'hidden', moderated_at = pg_catalog.now() where p.id = p_post;
  insert into public.social_moderation_actions (actor_kind, community_id, action, target_type, target_id, target_user_id, reason_code)
  values ('member', v_post.community_id, 'hide', 'post', p_post, v_post.user_id, p_reason_code);
  if v_post.user_id <> v_uid then
    perform public.fitx_social_notify(v_post.user_id, null, 'report_reviewed', 'community', v_post.community_id);
  end if;
  return true;
end $function$;

-- 5. Challenges -----------------------------------------------------------------------------------------------------------

-- Internal: works out one member's value in one challenge from their own rows only, counted from the later of the
-- challenge's start and the time they joined until its end, and stores it. Returns the value (null when there is no
-- such entry). With a sport, only that sport's activities count (and workouts not at all, except for the workouts
-- metric).
create or replace function public.fitx_social_challenge_sync(p_challenge uuid, p_user uuid)
returns numeric
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_challenge public.social_challenges;
  v_entry public.social_challenge_entries;
  v_from timestamptz;
  v_value numeric;
begin
  select * into v_challenge from public.social_challenges c where c.id = p_challenge;
  select * into v_entry from public.social_challenge_entries e where e.challenge_id = p_challenge and e.user_id = p_user;
  if v_challenge.id is null or v_entry.challenge_id is null then
    return null;
  end if;
  v_from := greatest(v_challenge.starts_at, v_entry.joined_at);
  if v_from >= v_challenge.ends_at then
    v_value := 0;
  elsif v_challenge.metric = 'workouts' then
    select pg_catalog.count(*) into v_value from public.workout_sessions w
    where w.user_id = p_user and w.status = 'completed' and w.completed_at >= v_from and w.completed_at < v_challenge.ends_at;
  elsif v_challenge.metric = 'distance_km' then
    select coalesce(pg_catalog.round(pg_catalog.sum(a.distance_m) / 1000.0, 2), 0) into v_value from public.activities a
    where a.user_id = p_user and a.started_at >= v_from and a.started_at < v_challenge.ends_at
      and (v_challenge.sport is null or a.sport = v_challenge.sport);
  elsif v_challenge.metric = 'active_minutes' then
    -- The union of the time ranges, so a run saved both as an activity and as a workout counts once.
    select coalesce(pg_catalog.floor(extract(epoch from pg_catalog.sum(pg_catalog.upper(u.r) - pg_catalog.lower(u.r))) / 60.0), 0) into v_value
    from (
      select pg_catalog.unnest(pg_catalog.range_agg(x.r)) as r
      from (
        select pg_catalog.tstzrange(a.started_at, a.started_at + pg_catalog.make_interval(secs => a.moving_seconds)) as r
        from public.activities a
        where a.user_id = p_user and a.started_at >= v_from and a.started_at < v_challenge.ends_at
          and (v_challenge.sport is null or a.sport = v_challenge.sport)
        union all
        select pg_catalog.tstzrange(w.completed_at - pg_catalog.make_interval(secs => w.duration_seconds), w.completed_at)
        from public.workout_sessions w
        where v_challenge.sport is null and w.user_id = p_user and w.status = 'completed'
          and w.completed_at >= v_from and w.completed_at < v_challenge.ends_at
      ) x
    ) u;
  else
    select pg_catalog.count(distinct d.day) into v_value
    from (
      select (a.started_at at time zone 'Asia/Kolkata')::date as day from public.activities a
      where a.user_id = p_user and a.started_at >= v_from and a.started_at < v_challenge.ends_at
        and (v_challenge.sport is null or a.sport = v_challenge.sport)
      union
      select (w.completed_at at time zone 'Asia/Kolkata')::date from public.workout_sessions w
      where v_challenge.sport is null and w.user_id = p_user and w.status = 'completed'
        and w.completed_at >= v_from and w.completed_at < v_challenge.ends_at
    ) d;
  end if;
  v_value := coalesce(v_value, 0);
  update public.social_challenge_entries e set value = v_value, synced_at = pg_catalog.now()
  where e.challenge_id = p_challenge and e.user_id = p_user;
  return v_value;
end $function$;

-- Internal (the hourly job fitx-challenge-hourly, and Admin's close). With p_close null: syncs every joined member of
-- every open challenge that has started; closes each challenge whose end is more than 2 hours past (after that final
-- sync, so late imports count); awards "Completed" (value at or above the target) and "Top 3" (ranks 1 to 3, only with
-- 10 or more members on the board) and tells each member; then opens this week's and this month's challenge (Monday
-- 00:00 and the 1st, in Asia/Kolkata) from every active template that has none yet. With p_close set: the same sync,
-- close and awards for that one challenge, now. Returns what it did.
create or replace function public.fitx_social_challenge_tick(p_close uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.now();
  v_row record;
  v_challenge public.social_challenges;
  v_template public.social_challenge_templates;
  v_user uuid;
  v_board bigint;
  v_local timestamp;
  v_start timestamptz;
  v_end timestamptz;
  v_synced integer := 0;
  v_closed integer := 0;
  v_badges integer := 0;
  v_opened integer := 0;
begin
  for v_row in
    select e.challenge_id, e.user_id from public.social_challenge_entries e
    join public.social_challenges c on c.id = e.challenge_id
    where c.closed_at is null and c.starts_at <= v_now and (p_close is null or c.id = p_close)
  loop
    perform public.fitx_social_challenge_sync(v_row.challenge_id, v_row.user_id);
    v_synced := v_synced + 1;
  end loop;
  update public.social_challenges c set last_synced_at = v_now
  where c.closed_at is null and c.starts_at <= v_now and (p_close is null or c.id = p_close);

  for v_challenge in
    select * from public.social_challenges c
    where c.closed_at is null and (c.id = p_close or (p_close is null and c.ends_at + interval '2 hours' <= v_now))
    for update
  loop
    update public.social_challenges c set closed_at = v_now where c.id = v_challenge.id;
    v_closed := v_closed + 1;
    if v_challenge.target is not null then
      for v_user in
        insert into public.social_challenge_badges (challenge_id, user_id, kind)
        select e.challenge_id, e.user_id, 'completed' from public.social_challenge_entries e
        where e.challenge_id = v_challenge.id and e.value >= v_challenge.target
        on conflict do nothing
        returning user_id
      loop
        perform public.fitx_social_notify(v_user, null, 'challenge_badge', 'challenge', v_challenge.id);
        v_badges := v_badges + 1;
      end loop;
    end if;
    select pg_catalog.count(*) into v_board from public.social_challenge_entries e
    where e.challenge_id = v_challenge.id and e.on_leaderboard and e.value > 0
      and public.fitx_social_age_band(e.user_id) = 'adult'
      and exists (select 1 from public.social_profiles p where p.user_id = e.user_id)
      and not exists (select 1 from public.social_member_sanctions z where z.user_id = e.user_id and z.kind = 'explore' and z.lifted_at is null
                        and (z.until is null or z.until > v_now));
    if v_board >= 10 then
      for v_user in
        insert into public.social_challenge_badges (challenge_id, user_id, kind)
        select b.challenge_id, b.user_id, 'top3' from (
          select e.challenge_id, e.user_id, pg_catalog.rank() over (order by e.value desc) as place
          from public.social_challenge_entries e
          where e.challenge_id = v_challenge.id and e.on_leaderboard and e.value > 0
            and public.fitx_social_age_band(e.user_id) = 'adult'
            and exists (select 1 from public.social_profiles p where p.user_id = e.user_id)
            and not exists (select 1 from public.social_member_sanctions z where z.user_id = e.user_id and z.kind = 'explore'
                              and z.lifted_at is null and (z.until is null or z.until > v_now))
        ) b
        where b.place <= 3
        on conflict do nothing
        returning user_id
      loop
        perform public.fitx_social_notify(v_user, null, 'challenge_badge', 'challenge', v_challenge.id);
        v_badges := v_badges + 1;
      end loop;
    end if;
  end loop;

  if p_close is null then
    for v_template in select * from public.social_challenge_templates t where t.active loop
      v_local := pg_catalog.date_trunc(case v_template.kind when 'weekly' then 'week' else 'month' end, v_now at time zone 'Asia/Kolkata');
      v_start := v_local at time zone 'Asia/Kolkata';
      v_end := (v_local + case v_template.kind when 'weekly' then interval '7 days' else interval '1 month' end) at time zone 'Asia/Kolkata';
      if not exists (select 1 from public.social_challenges c where c.template_id = v_template.id and c.starts_at = v_start) then
        insert into public.social_challenges (kind, title, metric, sport, target, starts_at, ends_at, template_id)
        values (v_template.kind, v_template.title, v_template.metric, v_template.sport, v_template.target, v_start, v_end, v_template.id);
        v_opened := v_opened + 1;
      end if;
    end loop;
  end if;

  return pg_catalog.jsonb_build_object('synced', v_synced, 'closed', v_closed, 'badges', v_badges, 'opened', v_opened, 'ran_at', v_now);
end $function$;

-- Challenges the member can see (FITX's, and those of communities they see): 'open' (running or about to start, the
-- member's own first, and the member's own ended ones until they close) or 'closed' (ones the member took part in). Each with the number taking part, the member's
-- entry (value, and rank while on the board) and badges.
create or replace function public.fitx_social_challenges(p_box text default 'open')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_adult boolean := public.fitx_social_age_band(v_uid) = 'adult';
  v_now timestamptz := pg_catalog.now();
begin
  if p_box is null or p_box not in ('open', 'closed') then
    raise exception using errcode = '23514', message = 'social_invalid';
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(x.item order by x.joined desc, x.sort_at, x.id)
    from (
      select c.id, e.user_id is not null as joined,
        case when p_box = 'open' then c.ends_at else v_now + (v_now - c.closed_at) end as sort_at,
        pg_catalog.jsonb_build_object(
          'id', c.id, 'kind', c.kind, 'title', c.title, 'metric', c.metric, 'sport', c.sport, 'target', c.target,
          'starts_at', c.starts_at, 'ends_at', c.ends_at, 'closed_at', c.closed_at,
          'community', (select pg_catalog.jsonb_build_object('slug', k.slug, 'name', k.name) from public.social_communities k where k.id = c.community_id),
          'participants', (select pg_catalog.count(*) from public.social_challenge_entries a where a.challenge_id = c.id),
          'joined', e.user_id is not null,
          'entry', case when e.user_id is null then null else pg_catalog.jsonb_build_object(
            'value', e.value, 'on_leaderboard', e.on_leaderboard, 'joined_at', e.joined_at, 'synced_at', e.synced_at,
            'rank', case when v_adult and e.on_leaderboard and e.value > 0 then (
              select pg_catalog.count(*) + 1 from public.social_challenge_entries b
              where b.challenge_id = c.id and b.on_leaderboard and b.value > e.value
                and public.fitx_social_age_band(b.user_id) = 'adult'
                and exists (select 1 from public.social_profiles p where p.user_id = b.user_id)
                and not exists (select 1 from public.social_member_sanctions z where z.user_id = b.user_id and z.kind = 'explore'
                                  and z.lifted_at is null and (z.until is null or z.until > v_now))) end) end,
          'badges', coalesce((select pg_catalog.jsonb_agg(g.kind order by g.kind) from public.social_challenge_badges g
                              where g.challenge_id = c.id and g.user_id = v_uid), '[]'::jsonb)) as item
      from public.social_challenges c
      left join public.social_challenge_entries e on e.challenge_id = c.id and e.user_id = v_uid
      where (c.community_id is null or public.fitx_social_sees_community(v_uid, c.community_id))
        -- Between its end and its close (the 2-hour grace and the next hourly tick) a challenge stays under Open for
        -- the members who joined it ("Final count soon"), until it moves to Finished.
        and case when p_box = 'open' then c.closed_at is null and (c.ends_at > v_now or e.user_id is not null)
                 else c.closed_at is not null and e.user_id is not null end
      order by e.user_id is not null desc, case when p_box = 'open' then c.ends_at end, c.closed_at desc nulls last
      limit 60
    ) x), '[]'::jsonb);
end $function$;

-- One challenge, or null: as in the list, plus whether the member may use the board (adults), its size, and the 12
-- newest progress shares the member can see, each with its author's computed entry. Works the member's own value out
-- again when it is more than 10 minutes old.
create or replace function public.fitx_social_challenge(p_challenge uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_adult boolean := public.fitx_social_age_band(v_uid) = 'adult';
  v_now timestamptz := pg_catalog.now();
  v_challenge public.social_challenges;
  v_entry public.social_challenge_entries;
begin
  select * into v_challenge from public.social_challenges c where c.id = p_challenge;
  if not found or (v_challenge.community_id is not null and not public.fitx_social_sees_community(v_uid, v_challenge.community_id)) then
    return null;
  end if;
  select * into v_entry from public.social_challenge_entries e where e.challenge_id = p_challenge and e.user_id = v_uid;
  if v_entry.user_id is not null and v_challenge.closed_at is null
     and (v_entry.synced_at is null or v_entry.synced_at < v_now - interval '10 minutes') then
    perform public.fitx_social_challenge_sync(p_challenge, v_uid);
    select * into v_entry from public.social_challenge_entries e where e.challenge_id = p_challenge and e.user_id = v_uid;
  end if;
  return (
    with board as (
      select e.user_id, e.value, pg_catalog.rank() over (order by e.value desc) as place
      from public.social_challenge_entries e
      where e.challenge_id = p_challenge and e.on_leaderboard and e.value > 0
        and public.fitx_social_age_band(e.user_id) = 'adult'
        and exists (select 1 from public.social_profiles p where p.user_id = e.user_id)
        and not exists (select 1 from public.social_member_sanctions z where z.user_id = e.user_id and z.kind = 'explore'
                          and z.lifted_at is null and (z.until is null or z.until > v_now))
    )
    select pg_catalog.jsonb_build_object(
      'id', v_challenge.id, 'kind', v_challenge.kind, 'title', v_challenge.title, 'metric', v_challenge.metric,
      'sport', v_challenge.sport, 'target', v_challenge.target, 'starts_at', v_challenge.starts_at, 'ends_at', v_challenge.ends_at,
      'closed_at', v_challenge.closed_at, 'last_synced_at', v_challenge.last_synced_at,
      'community', (select pg_catalog.jsonb_build_object('slug', k.slug, 'name', k.name) from public.social_communities k where k.id = v_challenge.community_id),
      'participants', (select pg_catalog.count(*) from public.social_challenge_entries a where a.challenge_id = p_challenge),
      'joined', v_entry.user_id is not null,
      'entry', case when v_entry.user_id is null then null else pg_catalog.jsonb_build_object(
        'value', v_entry.value, 'on_leaderboard', v_entry.on_leaderboard, 'joined_at', v_entry.joined_at, 'synced_at', v_entry.synced_at,
        'rank', case when v_adult then (select b.place from board b where b.user_id = v_uid) end) end,
      'badges', coalesce((select pg_catalog.jsonb_agg(g.kind order by g.kind) from public.social_challenge_badges g
                          where g.challenge_id = p_challenge and g.user_id = v_uid), '[]'::jsonb),
      'board_allowed', v_adult,
      'board_size', case when v_adult then (select pg_catalog.count(*) from board) end,
      'posts', coalesce((
        select pg_catalog.jsonb_agg(public.fitx_social_post_json(v_uid, x.post) || pg_catalog.jsonb_build_object('entry', (
            select pg_catalog.jsonb_build_object('value', e.value, 'rank', case when v_adult then (select b.place from board b where b.user_id = e.user_id) end)
            from public.social_challenge_entries e where e.challenge_id = p_challenge and e.user_id = (x.post).user_id))
          order by (x.post).created_at desc, (x.post).id desc)
        from (
          select p as post from public.social_posts p
          where p.challenge_id = p_challenge and public.fitx_social_sees_post(v_uid, p.id)
          order by p.created_at desc, p.id desc
          limit 12
        ) x), '[]'::jsonb)));
end $function$;

-- Joins a challenge while it is open (a community's challenge needs accepted membership). The member's value counts
-- from now (or from the start, if later). Returns the challenge.
create or replace function public.fitx_social_join_challenge(p_challenge uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_challenge public.social_challenges;
begin
  select * into v_challenge from public.social_challenges c where c.id = p_challenge;
  if not found or (v_challenge.community_id is not null and not public.fitx_social_sees_community(v_uid, v_challenge.community_id)) then
    raise exception using errcode = 'P0001', message = 'social_not_found';
  end if;
  if v_challenge.closed_at is not null or v_challenge.ends_at <= pg_catalog.now() then
    raise exception using errcode = 'P0001', message = 'social_challenge_closed';
  end if;
  if v_challenge.community_id is not null and not exists (
      select 1 from public.social_community_members m where m.community_id = v_challenge.community_id and m.user_id = v_uid and m.status = 'accepted') then
    raise exception using errcode = 'P0001', message = 'social_not_member';
  end if;
  if not exists (select 1 from public.social_challenge_entries e where e.challenge_id = p_challenge and e.user_id = v_uid) then
    perform public.fitx_social_take(v_uid, 'group_join', 30, 100);
    insert into public.social_challenge_entries (challenge_id, user_id) values (p_challenge, v_uid) on conflict do nothing;
    perform public.fitx_social_challenge_sync(p_challenge, v_uid);
  end if;
  return public.fitx_social_challenge(p_challenge);
end $function$;

-- Leaves a challenge while it is still open (its badges, if any, stay). Open while suspended or while Explore is
-- switched off.
create or replace function public.fitx_social_leave_challenge(p_challenge uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member_any();
begin
  if exists (select 1 from public.social_challenges c where c.id = p_challenge and c.closed_at is not null)
     and exists (select 1 from public.social_challenge_entries e where e.challenge_id = p_challenge and e.user_id = v_uid) then
    raise exception using errcode = 'P0001', message = 'social_challenge_closed';
  end if;
  delete from public.social_challenge_entries e where e.challenge_id = p_challenge and e.user_id = v_uid;
  return true;
end $function$;

-- Shows or takes the member off the challenge's board (off by default). Showing needs an adult (O1 a). Returns the
-- challenge.
create or replace function public.fitx_social_set_leaderboard(p_challenge uuid, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_band text := public.fitx_social_age_band(v_uid);
begin
  if p_on is null then
    raise exception using errcode = '23514', message = 'social_invalid';
  end if;
  if p_on and v_band <> 'adult' then
    raise exception using errcode = 'P0001', message = 'social_age_restricted', hint = v_band;
  end if;
  update public.social_challenge_entries e set on_leaderboard = p_on where e.challenge_id = p_challenge and e.user_id = v_uid;
  if not found then
    raise exception using errcode = 'P0001', message = 'social_not_member';
  end if;
  return public.fitx_social_challenge(p_challenge);
end $function$;

-- The challenge's board (adults only): adult members who chose to be on it and have counted something, ranked by
-- value (ties share a place). Members with a block either way are left out of the rows, never out of the ranking.
-- {size, rows (the first 50), me}.
create or replace function public.fitx_social_challenge_board(p_challenge uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.fitx_social_member();
  v_band text := public.fitx_social_age_band(v_uid);
  v_now timestamptz := pg_catalog.now();
  v_challenge public.social_challenges;
begin
  select * into v_challenge from public.social_challenges c where c.id = p_challenge;
  if not found or (v_challenge.community_id is not null and not public.fitx_social_sees_community(v_uid, v_challenge.community_id)) then
    raise exception using errcode = 'P0001', message = 'social_not_found';
  end if;
  if v_band <> 'adult' then
    raise exception using errcode = 'P0001', message = 'social_age_restricted', hint = v_band;
  end if;
  return (
    with board as (
      select e.user_id, e.value, e.joined_at, pg_catalog.rank() over (order by e.value desc) as place
      from public.social_challenge_entries e
      where e.challenge_id = p_challenge and e.on_leaderboard and e.value > 0
        and public.fitx_social_age_band(e.user_id) = 'adult'
        and exists (select 1 from public.social_profiles p where p.user_id = e.user_id)
        and not exists (select 1 from public.social_member_sanctions z where z.user_id = e.user_id and z.kind = 'explore'
                          and z.lifted_at is null and (z.until is null or z.until > v_now))
    )
    select pg_catalog.jsonb_build_object(
      'size', (select pg_catalog.count(*) from board),
      'rows', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('rank', r.place, 'value', r.value, 'mine', r.user_id = v_uid,
                                    'user', public.fitx_social_author_json(r.user_id)) order by r.place, r.joined_at, r.user_id)
        from (select * from board b where b.user_id = v_uid or not public.fitx_social_blocked(v_uid, b.user_id)
              order by b.place, b.joined_at, b.user_id limit 50) r), '[]'::jsonb),
      'me', (select pg_catalog.jsonb_build_object('rank', b.place, 'value', b.value) from board b where b.user_id = v_uid)));
end $function$;

-- 6. Grants ---------------------------------------------------------------------------------------------------------------

do $do$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'fitx_social_send_message(uuid, text, uuid, uuid)', 'fitx_social_conversations(timestamptz, text)',
    'fitx_social_messages(uuid, timestamptz, uuid)', 'fitx_social_answer_conversation(uuid, boolean)',
    'fitx_social_mark_conversation_read(uuid)', 'fitx_social_unsend_message(uuid)', 'fitx_social_set_dm_policy(text)',
    'fitx_social_unread_counts()', 'fitx_social_communities(text)', 'fitx_social_community(text)',
    'fitx_social_community_posts(uuid, timestamptz, uuid)', 'fitx_social_join_community(uuid)',
    'fitx_social_answer_community_request(uuid, uuid, boolean)', 'fitx_social_leave_community(uuid)',
    'fitx_social_create_group_post(uuid, text, jsonb, jsonb, uuid, uuid)', 'fitx_social_moderator_remove_post(uuid, text)',
    'fitx_social_challenges(text)', 'fitx_social_challenge(uuid)', 'fitx_social_join_challenge(uuid)',
    'fitx_social_leave_challenge(uuid)', 'fitx_social_set_leaderboard(uuid, boolean)', 'fitx_social_challenge_board(uuid)'
  ] loop
    execute pg_catalog.format('revoke all on function public.%s from public, anon', v_fn);
    execute pg_catalog.format('grant execute on function public.%s to authenticated, service_role', v_fn);
  end loop;
  foreach v_fn in array array['fitx_social_challenge_sync(uuid, uuid)', 'fitx_social_challenge_tick(uuid)'] loop
    execute pg_catalog.format('revoke all on function public.%s from public, anon, authenticated', v_fn);
    execute pg_catalog.format('grant execute on function public.%s to service_role', v_fn);
  end loop;
end $do$;

-- 7. The hourly challenge job (only where pg_cron is on, as in production; scheduling the same name again replaces it) -

do $do$
begin
  if pg_catalog.to_regnamespace('cron') is not null then
    execute $s$select cron.schedule('fitx-challenge-hourly', '23 * * * *', 'select public.fitx_social_challenge_tick()')$s$;
  end if;
end $do$;

notify pgrst, 'reload schema';
