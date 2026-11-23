-- FITX Admin: Explore moderation, communities and challenges (wave 2, migration M3; runbook #54). Builds on
-- 20261124100000_fitx_social_v2_core.sql (#52), which creates every table this file works on, and uses
-- 20261124100010_fitx_social_v2_groups.sql (#53) when it is there (the challenge close calls its tick).
--
-- What it adds (it creates no table; one index):
--   * Two Admin permissions, explore.view and explore.moderate: super-admins and admins get both, support agents
--     explore.view only (O5 a), content editors and viewers neither. fitx_admin_role_permissions is recreated with the
--     23-permission table (admin/src/lib/roles.ts keeps the same table; admin/tests/roles.test.mjs compares them).
--   * Two feature switches, explore (on unless saved off) and explore_video (off unless saved on): the settings save
--     fitx_admin_op_save_platform_settings is recreated with its key list extended, and a switch the caller leaves out
--     now keeps its saved value (Admin leaves out the two Explore switches while it cannot read Explore's state).
--   * fitx_admin_op_moderate: the Admin queue's actions on a report (dismiss, claim, limit, hide, unhide, remove,
--     clear_avatar, clear_bio, warn, suspend, lift), and the account record's actions without a report. In one
--     transaction it checks explore.moderate, changes the content or the account, closes every open report on the
--     target, tells each reporter FITX reviewed it (report_reviewed), keeps the evidence 90 days after review, records
--     the moderation row and writes the audit row (codes, ids and counts only, never text).
--   * Communities and challenges written by FITX in Admin (O3 a): fitx_admin_op_save_community,
--     fitx_admin_op_set_community_role, fitx_admin_op_save_challenge, fitx_admin_op_close_challenge (the groups file's
--     fitx_social_challenge_tick(id) when it is applied: a final sync, the close and the badges) and
--     fitx_admin_op_save_challenge_template.
--   * fitx_admin_explore_meter(): storage per bucket and per kind of Explore file, the database size, signed video
--     bytes today against the cap, the clean-up queue, the hourly job's last run and the open reports.
--   Every function is security definer with an empty search_path, executable by service_role only.
--
-- Additive and safe to run again: create or replace with the signatures unchanged, create index if not exists. It
-- deletes no row and changes no table.
--
-- Undo (Admin then reads Explore as "needs a database update"; the saved explore and explore_video switches stay in
-- platform_settings, where the app still reads them, but only until the next settings save: #43's save, run again
-- after this, replaces the whole object with its five switches, and a missing explore reads as on. If Explore was
-- switched off, set it off again after each settings save until this file is back:
-- update public.platform_settings set features = features || '{"explore": false}' where id = 1;):
--   begin;
--   drop function if exists public.fitx_admin_op_moderate(uuid, uuid, text, text, text, timestamptz, text, uuid),
--     public.fitx_admin_op_save_community(uuid, uuid, text, text, text, text, text),
--     public.fitx_admin_op_set_community_role(uuid, uuid, uuid, text),
--     public.fitx_admin_op_save_challenge(uuid, uuid, text, text, text, text, numeric, timestamptz, timestamptz, uuid),
--     public.fitx_admin_op_close_challenge(uuid, uuid),
--     public.fitx_admin_op_save_challenge_template(uuid, uuid, text, text, text, text, numeric, boolean),
--     public.fitx_admin_explore_meter(), public.fitx_admin_explore_reason_words(text);
--   drop index if exists public.social_reports_target_user_idx;
--   create or replace function public.fitx_admin_role_permissions(p_role text) returns text[] language sql immutable
--     set search_path = '' as $f$ select case p_role
--     when 'super_admin' then array['overview.view', 'reports.view', 'people.view', 'people.support', 'people.suspend', 'people.delete', 'support.view', 'support.reply', 'content.manage', 'announcements.manage', 'audit.view', 'audit.export', 'access.view', 'access.manage', 'settings.view', 'billing.view', 'nutrition.manage', 'billing.manage', 'notifications.send', 'settings.manage', 'security.view']
--     when 'admin' then array['overview.view', 'reports.view', 'people.view', 'people.support', 'people.suspend', 'support.view', 'support.reply', 'content.manage', 'announcements.manage', 'audit.view', 'access.view', 'settings.view', 'billing.view', 'nutrition.manage', 'notifications.send', 'security.view']
--     when 'support_agent' then array['overview.view', 'people.view', 'people.support', 'support.view', 'support.reply']
--     when 'content_editor' then array['overview.view', 'content.manage', 'announcements.manage', 'nutrition.manage', 'notifications.send']
--     when 'viewer' then array['overview.view', 'reports.view'] else array[]::text[] end $f$;
--   commit;
--   -- then re-run 20261121100033_fitx_admin_ops.sql (safe to run again): it puts back the five-switch settings save.

do $do$ begin perform pg_catalog.set_config('lock_timeout', '5s', true); end $do$;

-- 1. Permissions ------------------------------------------------------------------------------------------------------

create or replace function public.fitx_admin_role_permissions(p_role text)
returns text[]
language sql
immutable
set search_path = ''
as $function$
  select case p_role
    when 'super_admin' then array['overview.view', 'reports.view', 'people.view', 'people.support', 'people.suspend', 'people.delete', 'support.view', 'support.reply', 'content.manage', 'announcements.manage', 'audit.view', 'audit.export', 'access.view', 'access.manage', 'settings.view', 'billing.view', 'nutrition.manage', 'billing.manage', 'notifications.send', 'settings.manage', 'security.view', 'explore.view', 'explore.moderate']::text[]
    when 'admin' then array['overview.view', 'reports.view', 'people.view', 'people.support', 'people.suspend', 'support.view', 'support.reply', 'content.manage', 'announcements.manage', 'audit.view', 'access.view', 'settings.view', 'billing.view', 'nutrition.manage', 'notifications.send', 'security.view', 'explore.view', 'explore.moderate']::text[]
    when 'support_agent' then array['overview.view', 'people.view', 'people.support', 'support.view', 'support.reply', 'explore.view']::text[]
    when 'content_editor' then array['overview.view', 'content.manage', 'announcements.manage', 'nutrition.manage', 'notifications.send']::text[]
    when 'viewer' then array['overview.view', 'reports.view']::text[]
    else array[]::text[]
  end;
$function$;

-- 2. Feature switches: the settings save, with explore and explore_video added to its key list -----------------------

create or replace function public.fitx_admin_op_save_platform_settings(
  p_operator_id uuid,
  p_features jsonb,
  p_maintenance jsonb,
  p_site jsonb,
  p_expected_updated_at timestamptz default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $function$
declare
  feature_keys constant text[] := array['ai_coach', 'home_workout', 'activity', 'subscriptions', 'support', 'explore', 'explore_video'];
  previous public.platform_settings%rowtype;
  saved_at timestamptz;
  starts timestamptz;
  ends timestamptz;
  v_title text;
  v_body text;
  v_email text;
  v_instagram text;
  maintenance_summary jsonb;
  previous_summary jsonb;
  v_features jsonb;
begin
  if not public.fitx_admin_op_can(p_operator_id, 'settings.manage') then
    raise exception using errcode = '42501', message = 'Settings permission required';
  end if;

  if p_features is null or pg_catalog.jsonb_typeof(p_features) <> 'object'
     or exists (select 1 from pg_catalog.jsonb_each(p_features) e
                where e.key <> all (feature_keys) or pg_catalog.jsonb_typeof(e.value) <> 'boolean') then
    raise exception using errcode = '22023', message = 'Invalid feature switches';
  end if;

  if p_maintenance is not null and pg_catalog.jsonb_typeof(p_maintenance) = 'null' then
    p_maintenance := null;
  end if;
  if p_maintenance is not null then
    if pg_catalog.jsonb_typeof(p_maintenance) <> 'object'
       or exists (select 1 from pg_catalog.jsonb_object_keys(p_maintenance) k where k <> all (array['title', 'body', 'startsAt', 'endsAt'])) then
      raise exception using errcode = '22023', message = 'Invalid maintenance notice';
    end if;
    v_title := pg_catalog.btrim(coalesce(p_maintenance ->> 'title', ''));
    v_body := pg_catalog.btrim(coalesce(p_maintenance ->> 'body', ''));
    if pg_catalog.char_length(v_title) not between 3 and 120 or pg_catalog.char_length(v_body) not between 1 and 600 then
      raise exception using errcode = '22023', message = 'Invalid maintenance notice';
    end if;
    begin
      starts := nullif(p_maintenance ->> 'startsAt', '')::timestamptz;
      ends := nullif(p_maintenance ->> 'endsAt', '')::timestamptz;
    exception when others then
      raise exception using errcode = '22023', message = 'Invalid maintenance times';
    end;
    if starts is not null and ends is not null and ends <= starts then
      raise exception using errcode = '22023', message = 'Invalid maintenance times';
    end if;
    p_maintenance := pg_catalog.jsonb_build_object('title', v_title, 'body', v_body, 'startsAt', starts, 'endsAt', ends);
  end if;

  if p_site is null or pg_catalog.jsonb_typeof(p_site) <> 'object'
     or exists (select 1 from pg_catalog.jsonb_object_keys(p_site) k where k <> all (array['supportEmail', 'instagramUrl'])) then
    raise exception using errcode = '22023', message = 'Invalid website information';
  end if;
  v_email := nullif(pg_catalog.btrim(coalesce(p_site ->> 'supportEmail', '')), '');
  v_instagram := nullif(pg_catalog.btrim(coalesce(p_site ->> 'instagramUrl', '')), '');
  if v_email is not null and (pg_catalog.char_length(v_email) > 254 or v_email !~ '^[^@\s<>"]+@[^@\s<>"]+\.[A-Za-z]{2,}$') then
    raise exception using errcode = '22023', message = 'Invalid support email';
  end if;
  if v_instagram is not null and (pg_catalog.char_length(v_instagram) > 200
     or v_instagram !~ '^https://(www\.)?instagram\.com/[A-Za-z0-9._]{1,30}/?$') then
    raise exception using errcode = '22023', message = 'Invalid Instagram address';
  end if;
  p_site := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('supportEmail', v_email, 'instagramUrl', v_instagram));

  insert into public.platform_settings (id) values (1) on conflict (id) do nothing;
  select * into previous from public.platform_settings where id = 1 for update;
  if p_expected_updated_at is not null and previous.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'platform_settings_changed';
  end if;

  -- A switch the caller did not send keeps its saved value: Admin leaves out explore and explore_video while it cannot
  -- read Explore's state, and a missing explore reads as on, so replacing the whole object would switch Explore on.
  v_features := coalesce((select pg_catalog.jsonb_object_agg(e.key, e.value)
                          from pg_catalog.jsonb_each(case when pg_catalog.jsonb_typeof(previous.features) = 'object'
                                                          then previous.features else '{}'::jsonb end) e
                          where e.key = any (feature_keys) and pg_catalog.jsonb_typeof(e.value) = 'boolean'), '{}'::jsonb)
                || p_features;

  update public.platform_settings
  set features = v_features, maintenance = p_maintenance, site = p_site,
      updated_at = pg_catalog.clock_timestamp(), updated_by_operator_id = p_operator_id
  where id = 1
  returning updated_at into saved_at;

  maintenance_summary := case when p_maintenance is null then pg_catalog.jsonb_build_object('on', false)
    else pg_catalog.jsonb_build_object('on', true, 'title_characters', pg_catalog.char_length(v_title),
      'body_fingerprint', pg_catalog.left(pg_catalog.md5(v_body), 12), 'starts_at', starts, 'ends_at', ends) end;
  previous_summary := case when previous.maintenance is null then pg_catalog.jsonb_build_object('on', false)
    else pg_catalog.jsonb_build_object('on', true,
      'title_characters', pg_catalog.char_length(coalesce(previous.maintenance ->> 'title', '')),
      'body_fingerprint', pg_catalog.left(pg_catalog.md5(coalesce(previous.maintenance ->> 'body', '')), 12),
      'starts_at', previous.maintenance -> 'startsAt', 'ends_at', previous.maintenance -> 'endsAt') end;
  perform public.fitx_admin_op_log_event(p_operator_id, 'platform_settings_updated', 'platform_settings', '1',
    pg_catalog.jsonb_build_object(
      'before', pg_catalog.jsonb_build_object('features', previous.features, 'maintenance', previous_summary, 'site', previous.site),
      'after', pg_catalog.jsonb_build_object('features', v_features, 'maintenance', maintenance_summary, 'site', p_site)));
  return saved_at;
end;
$function$;

-- 3. Moderation ---------------------------------------------------------------------------------------------------------

-- The plain words of a report reason, for the fixed warning text (internal: no grant).
create or replace function public.fitx_admin_explore_reason_words(p_reason text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select case p_reason
    when 'spam' then 'spam'
    when 'harassment' then 'bullying or harassment'
    when 'hate' then 'hate speech'
    when 'nudity' then 'nudity or sexual content'
    when 'violence' then 'violence'
    when 'self_harm' then 'self-harm'
    when 'false_information' then 'false information'
    when 'scam' then 'a scam'
    else 'the Explore rules'
  end;
$function$;

-- Reads accounts reported in Admin's account record.
create index if not exists social_reports_target_user_idx on public.social_reports (target_user_id) where target_user_id is not null;

-- One moderation action by an operator. With p_report_id, the target is the report's (a post, comment, story, message,
-- community, challenge or account) and member actions act on the member the report names; without it, only the member
-- actions on p_user (the account record). p_sanction ('explore', 'dm' or 'upload') and p_until (null: indefinite) are for
-- suspend and lift. Returns {action, status, target_type, target_id, target_user_id, report_ids, paths}: paths are the
-- Storage files to remove (also queued in social_storage_trash, so the sweep removes them if Admin's own removal fails).
-- Errors: 42501 without explore.moderate; 22023 for an action, reason, time or target that does not fit (the message
-- says which); P0002 when the report, the content or the account is gone, or there is no suspension to lift.
create or replace function public.fitx_admin_op_moderate(
  p_operator_id uuid,
  p_report_id uuid,
  p_action text,
  p_reason_code text default null,
  p_note text default null,
  p_until timestamptz default null,
  p_sanction text default 'explore',
  p_user uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  reasons constant text[] := array['spam', 'harassment', 'hate', 'nudity', 'violence', 'self_harm', 'false_information', 'scam', 'other'];
  content_actions constant text[] := array['limit', 'hide', 'unhide', 'remove'];
  member_actions constant text[] := array['clear_avatar', 'clear_bio', 'warn', 'suspend', 'lift'];
  v_report public.social_reports%rowtype;
  v_target_type text;
  v_target_id uuid;
  v_user uuid;
  v_community uuid;
  v_state text;
  v_status text;
  v_paths text[] := '{}';
  v_closed uuid[] := '{}';
  v_reporters uuid[] := '{}';
  v_reporter uuid;
  v_note text := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
  v_rows integer;
  v_resource text;
  v_resource_id text;
  v_audit text;
  v_record_target text;
begin
  if not public.fitx_admin_op_can(p_operator_id, 'explore.moderate') then
    raise exception using errcode = '42501', message = 'Explore moderation permission required';
  end if;
  if p_action is null or p_action <> all (array['dismiss', 'claim'] || content_actions || member_actions) then
    raise exception using errcode = '22023', message = 'explore_invalid_action';
  end if;
  if p_reason_code is not null and p_reason_code <> all (reasons) then
    raise exception using errcode = '22023', message = 'explore_invalid_reason';
  end if;
  if p_reason_code is null and p_action in ('limit', 'hide', 'remove', 'clear_avatar', 'clear_bio', 'warn', 'suspend') then
    raise exception using errcode = '22023', message = 'explore_reason_required';
  end if;
  if v_note is not null and pg_catalog.char_length(v_note) > 1000 then
    raise exception using errcode = '22023', message = 'explore_invalid_note';
  end if;
  if p_action in ('suspend', 'lift') and (p_sanction is null or p_sanction not in ('explore', 'dm', 'upload')) then
    raise exception using errcode = '22023', message = 'explore_invalid_sanction';
  end if;
  if p_action = 'suspend' and p_until is not null
     and (p_until < pg_catalog.now() + interval '1 hour' or p_until > pg_catalog.now() + interval '400 days') then
    raise exception using errcode = '22023', message = 'explore_invalid_until';
  end if;

  if p_report_id is not null then
    select * into v_report from public.social_reports r where r.id = p_report_id for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'explore_report_not_found';
    end if;
    v_target_type := v_report.target_type;
    v_target_id := v_report.target_id;
    v_user := v_report.target_user_id;
  else
    if p_user is null or p_action <> all (member_actions) then
      raise exception using errcode = '22023', message = 'explore_report_required';
    end if;
    v_target_type := 'account';
    v_target_id := p_user;
    v_user := p_user;
  end if;

  -- Claim: the report is being looked at (status reviewing); nothing else changes.
  if p_action = 'claim' then
    if v_report.status not in ('open', 'reviewing') then
      raise exception using errcode = '22023', message = 'explore_report_closed';
    end if;
    update public.social_reports r set status = 'reviewing' where r.id = p_report_id;
    v_closed := array[p_report_id];
  end if;

  -- Content: limit, hide, unhide or remove the reported item.
  if p_action = any (content_actions) then
    if v_target_type not in ('post', 'comment', 'story', 'message', 'community')
       or (p_action = 'remove' and v_target_type = 'community')
       or (p_action = 'limit' and v_target_type = 'message') then
      raise exception using errcode = '22023', message = 'explore_action_not_for_target';
    end if;
    v_state := case p_action when 'limit' then 'limited' when 'hide' then 'hidden' when 'unhide' then 'visible' end;
    if v_target_type = 'post' then
      select p.community_id into v_community from public.social_posts p where p.id = v_target_id;
      if p_action = 'remove' then
        select coalesce(pg_catalog.array_agg(x.path order by x.path), '{}') into v_paths
        from (select m.storage_path as path from public.social_post_media m where m.post_id = v_target_id
              union all
              select m.poster_path from public.social_post_media m where m.post_id = v_target_id and m.poster_path is not null) x;
        delete from public.social_posts p where p.id = v_target_id;
      else
        update public.social_posts p set moderation_state = v_state, moderated_at = pg_catalog.now() where p.id = v_target_id;
      end if;
      get diagnostics v_rows = row_count;
    elsif v_target_type = 'comment' then
      if p_action = 'remove' then
        delete from public.social_comments c where c.id = v_target_id;
      else
        update public.social_comments c set moderation_state = v_state, moderated_at = pg_catalog.now() where c.id = v_target_id;
      end if;
      get diagnostics v_rows = row_count;
    elsif v_target_type = 'story' then
      if p_action = 'remove' then
        delete from public.social_stories s where s.id = v_target_id
        returning pg_catalog.array_remove(array[s.storage_path, s.poster_path], null) into v_paths;
        get diagnostics v_rows = row_count;
        v_paths := coalesce(v_paths, '{}');
      else
        update public.social_stories s set moderation_state = v_state, moderated_at = pg_catalog.now() where s.id = v_target_id;
        get diagnostics v_rows = row_count;
      end if;
    elsif v_target_type = 'message' then
      -- Removing a message blanks it for both sides, as unsending does.
      update public.social_messages m
      set moderation_state = case when p_action = 'remove' then 'hidden' else v_state end, moderated_at = pg_catalog.now(),
          body = case when p_action = 'remove' then '' else m.body end,
          deleted_at = case when p_action = 'remove' then coalesce(m.deleted_at, pg_catalog.now()) else m.deleted_at end
      where m.id = v_target_id;
      get diagnostics v_rows = row_count;
    else
      v_community := v_target_id;
      update public.social_communities c set moderation_state = v_state, moderated_at = pg_catalog.now() where c.id = v_target_id;
      get diagnostics v_rows = row_count;
    end if;
    if v_rows = 0 then
      raise exception using errcode = 'P0002', message = 'explore_content_gone';
    end if;
  end if;

  -- The member the report names (or the account record's member).
  if p_action = any (member_actions) then
    if v_user is null then
      raise exception using errcode = '22023', message = 'explore_no_member';
    end if;
    if not exists (select 1 from auth.users u where u.id = v_user) then
      raise exception using errcode = 'P0002', message = 'explore_member_not_found';
    end if;
    if p_action = 'clear_avatar' then
      select coalesce(pg_catalog.array_agg(p.avatar_path), '{}') into v_paths
      from public.social_profiles p where p.user_id = v_user and p.avatar_path is not null;
      update public.social_profiles p set avatar_path = null, updated_at = pg_catalog.now() where p.user_id = v_user;
      get diagnostics v_rows = row_count;
    elsif p_action = 'clear_bio' then
      update public.social_profiles p set bio = '', updated_at = pg_catalog.now() where p.user_id = v_user;
      get diagnostics v_rows = row_count;
    elsif p_action = 'warn' then
      insert into public.member_notifications (batch_id, user_id, title, body, tone, created_by_operator_id)
      values (gen_random_uuid(), v_user, 'A warning from FITX about Explore',
        'Something you shared in Explore was reported and broke the Explore rules (' || public.fitx_admin_explore_reason_words(p_reason_code)
          || '). Please keep to them: another breach can pause your Explore account.',
        'warning', p_operator_id);
      get diagnostics v_rows = row_count;
    elsif p_action = 'suspend' then
      update public.social_member_sanctions s set lifted_at = pg_catalog.now()
      where s.user_id = v_user and s.kind = p_sanction and s.lifted_at is null;
      insert into public.social_member_sanctions (user_id, kind, until, reason_code, created_by_operator)
      values (v_user, p_sanction, p_until, p_reason_code, p_operator_id);
      get diagnostics v_rows = row_count;
    else
      update public.social_member_sanctions s set lifted_at = pg_catalog.now()
      where s.user_id = v_user and s.kind = p_sanction and s.lifted_at is null and (s.until is null or s.until > pg_catalog.now());
      get diagnostics v_rows = row_count;
      if v_rows = 0 then
        raise exception using errcode = 'P0002', message = 'explore_no_sanction';
      end if;
      update public.social_moderation_actions a set reversed_at = pg_catalog.now()
      where a.target_user_id = v_user and a.action = 'suspend' and a.reversed_at is null;
    end if;
    if v_rows = 0 then
      raise exception using errcode = 'P0002', message = 'explore_member_not_found';
    end if;
  end if;

  -- Files go through the Storage API: queued for the sweep as well as returned.
  if pg_catalog.cardinality(v_paths) > 0 then
    insert into public.social_storage_trash (path, reason)
    select x.path, 'removed' from pg_catalog.unnest(v_paths) as x(path)
    on conflict (path) do nothing;
  end if;

  -- Every open report on the target closes (an account action without a report closes the account's reports), and
  -- each reporter hears FITX reviewed it. Claim, unhide and lift close nothing.
  if p_action not in ('claim', 'unhide', 'lift') then
    v_status := case when p_action = 'dismiss' then 'dismissed' else 'actioned' end;
    with closed as (
      update public.social_reports r
      set status = v_status, reviewed_at = pg_catalog.now(), evidence_purge_at = pg_catalog.now() + interval '90 days'
      where r.target_type = v_target_type and r.target_id = v_target_id and r.status in ('open', 'reviewing')
      returning r.id, r.user_id
    )
    select coalesce(pg_catalog.array_agg(c.id order by c.id), '{}'), coalesce(pg_catalog.array_agg(distinct c.user_id), '{}')
      into v_closed, v_reporters
    from closed c;
    foreach v_reporter in array v_reporters loop
      perform public.fitx_social_notify(v_reporter, null, 'report_reviewed', 'profile', v_reporter, null, null);
    end loop;
  end if;

  if p_action = 'unhide' then
    update public.social_moderation_actions a set reversed_at = pg_catalog.now()
    where a.target_type = v_target_type and a.target_id = v_target_id and a.action in ('limit', 'hide') and a.reversed_at is null;
  end if;

  v_record_target := case when p_action = any (member_actions) then 'account' else v_target_type end;
  insert into public.social_moderation_actions (actor_kind, operator_id, community_id, action, target_type, target_id, target_user_id,
    reason_code, note, report_ids)
  values ('operator', p_operator_id, v_community, p_action, v_record_target,
    case when v_record_target = 'account' then v_user else v_target_id end, v_user, p_reason_code, v_note, v_closed);

  v_audit := case p_action
    when 'dismiss' then 'explore_report_dismissed'
    when 'claim' then 'explore_report_claimed'
    when 'limit' then 'explore_content_limited'
    when 'hide' then 'explore_content_hidden'
    when 'unhide' then 'explore_content_unhidden'
    when 'remove' then 'explore_content_removed'
    when 'clear_avatar' then 'explore_profile_cleared'
    when 'clear_bio' then 'explore_profile_cleared'
    when 'warn' then 'explore_member_warned'
    when 'suspend' then 'explore_member_suspended'
    when 'lift' then 'explore_member_unsuspended'
  end;
  if p_action in ('dismiss', 'claim') or (p_action = any (content_actions) and v_target_type = 'message') then
    v_resource := 'social_report';
    v_resource_id := p_report_id::text;
  elsif p_action = any (member_actions) then
    v_resource := 'social_profile';
    v_resource_id := v_user::text;
  else
    v_resource := case v_target_type when 'post' then 'social_post' when 'comment' then 'social_comment' when 'story' then 'social_story'
      else 'social_community' end;
    v_resource_id := v_target_id::text;
  end if;
  perform public.fitx_admin_op_log_event(p_operator_id, v_audit, v_resource, v_resource_id,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'action', p_action, 'report_id', p_report_id, 'target_type', v_target_type, 'reason', p_reason_code,
      'reports_closed', case when p_action = 'claim' then null else pg_catalog.cardinality(v_closed) end,
      'reporters_notified', case when p_action in ('claim', 'unhide', 'lift') then null else pg_catalog.cardinality(v_reporters) end,
      'sanction', case when p_action in ('suspend', 'lift') then p_sanction end,
      'until', case when p_action = 'suspend' then coalesce(p_until::text, 'indefinite') end,
      'files', case when pg_catalog.cardinality(v_paths) > 0 then pg_catalog.cardinality(v_paths) end,
      'note', v_note is not null)));

  return pg_catalog.jsonb_build_object('action', p_action, 'status', coalesce(v_status, case when p_action = 'claim' then 'reviewing' end),
    'target_type', v_target_type, 'target_id', v_target_id, 'target_user_id', v_user,
    'report_ids', pg_catalog.to_jsonb(v_closed), 'paths', pg_catalog.to_jsonb(v_paths));
end;
$function$;

-- 4. Communities (created by FITX in Admin, O3 a) ------------------------------------------------------------------------

-- Adds (p_id null, or an id not used yet) or edits a community. p_cover_path: null keeps the cover, '' removes it, or
-- communities/<id>/cover.webp once Admin has uploaded it with the service key. A slug in use raises 23505. Returns the id.
create or replace function public.fitx_admin_op_save_community(
  p_operator_id uuid,
  p_id uuid,
  p_slug text,
  p_name text,
  p_description text,
  p_visibility text,
  p_cover_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_slug text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_slug, '')));
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
  v_description text := pg_catalog.btrim(coalesce(p_description, ''));
  v_previous public.social_communities%rowtype;
  v_cover text;
  v_created boolean;
begin
  if not public.fitx_admin_op_can(p_operator_id, 'explore.moderate') then
    raise exception using errcode = '42501', message = 'Explore moderation permission required';
  end if;
  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' then
    raise exception using errcode = '22023', message = 'explore_invalid_slug';
  end if;
  if pg_catalog.char_length(v_name) not between 1 and 60 then
    raise exception using errcode = '22023', message = 'explore_invalid_name';
  end if;
  if pg_catalog.char_length(v_description) > 500 then
    raise exception using errcode = '22023', message = 'explore_invalid_description';
  end if;
  if p_visibility is null or p_visibility not in ('public', 'private') then
    raise exception using errcode = '22023', message = 'explore_invalid_visibility';
  end if;
  if p_cover_path is not null and p_cover_path <> '' and p_cover_path <> 'communities/' || v_id::text || '/cover.webp' then
    raise exception using errcode = '22023', message = 'explore_invalid_cover';
  end if;

  select * into v_previous from public.social_communities c where c.id = v_id for update;
  v_created := not found;
  v_cover := case when p_cover_path is null then v_previous.cover_path when p_cover_path = '' then null else p_cover_path end;
  if v_created then
    insert into public.social_communities (id, slug, name, description, visibility, cover_path, created_by)
    values (v_id, v_slug, v_name, v_description, p_visibility, v_cover, null);
  else
    update public.social_communities c
    set slug = v_slug, name = v_name, description = v_description, visibility = p_visibility, cover_path = v_cover
    where c.id = v_id;
  end if;

  perform public.fitx_admin_op_log_event(p_operator_id, 'explore_community_saved', 'social_community', v_id::text,
    pg_catalog.jsonb_build_object('created', v_created, 'visibility', p_visibility, 'cover', v_cover is not null,
      'slug_changed', not v_created and v_previous.slug is distinct from v_slug,
      'visibility_changed', not v_created and v_previous.visibility is distinct from p_visibility));
  return v_id;
end;
$function$;

-- Appoints an accepted adult member as a moderator of a community, or makes a moderator an ordinary member again.
create or replace function public.fitx_admin_op_set_community_role(p_operator_id uuid, p_community uuid, p_user uuid, p_role text)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_previous text;
begin
  if not public.fitx_admin_op_can(p_operator_id, 'explore.moderate') then
    raise exception using errcode = '42501', message = 'Explore moderation permission required';
  end if;
  if p_role is null or p_role not in ('moderator', 'member') then
    raise exception using errcode = '22023', message = 'explore_invalid_role';
  end if;
  if not exists (select 1 from public.social_communities c where c.id = p_community) then
    raise exception using errcode = 'P0002', message = 'explore_community_not_found';
  end if;
  select m.role into v_previous from public.social_community_members m
  where m.community_id = p_community and m.user_id = p_user and m.status = 'accepted' for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'explore_not_member';
  end if;
  if p_role = 'moderator' and public.fitx_social_age_band(p_user) <> 'adult' then
    raise exception using errcode = '22023', message = 'explore_not_adult';
  end if;
  update public.social_community_members m set role = p_role where m.community_id = p_community and m.user_id = p_user;
  perform public.fitx_admin_op_log_event(p_operator_id, 'explore_community_role_set', 'social_community', p_community::text,
    pg_catalog.jsonb_build_object('user_id', p_user, 'before', pg_catalog.jsonb_build_object('role', v_previous),
      'after', pg_catalog.jsonb_build_object('role', p_role)));
  return p_role;
end;
$function$;

-- 5. Challenges and templates (values are always computed from members' own rows, never typed) ------------------------

-- Adds (p_id null or unused) or edits an open challenge. Sports apply to distance and active minutes only. A weekly
-- challenge lasts 1 to 7 days and a monthly one 1 to 31; a new one must end in the future. Returns the id.
create or replace function public.fitx_admin_op_save_challenge(
  p_operator_id uuid,
  p_id uuid,
  p_kind text,
  p_title text,
  p_metric text,
  p_sport text,
  p_target numeric,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_community_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_title text := pg_catalog.btrim(coalesce(p_title, ''));
  v_sport text := nullif(pg_catalog.btrim(coalesce(p_sport, '')), '');
  v_previous public.social_challenges%rowtype;
  v_created boolean;
begin
  if not public.fitx_admin_op_can(p_operator_id, 'explore.moderate') then
    raise exception using errcode = '42501', message = 'Explore moderation permission required';
  end if;
  if p_kind is null or p_kind not in ('weekly', 'monthly') then
    raise exception using errcode = '22023', message = 'explore_invalid_kind';
  end if;
  if pg_catalog.char_length(v_title) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'explore_invalid_title';
  end if;
  if p_metric is null or p_metric not in ('workouts', 'active_minutes', 'distance_km', 'active_days') then
    raise exception using errcode = '22023', message = 'explore_invalid_metric';
  end if;
  if v_sport is not null and (p_metric not in ('distance_km', 'active_minutes')
     or v_sport not in ('walk', 'run', 'ride', 'hike', 'trail_run', 'mtb', 'ebike', 'wheelchair', 'skate', 'paddle')) then
    raise exception using errcode = '22023', message = 'explore_invalid_sport';
  end if;
  if p_target is not null and (p_target <= 0 or p_target > 100000) then
    raise exception using errcode = '22023', message = 'explore_invalid_target';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at
     or p_ends_at - p_starts_at < interval '1 day'
     or p_ends_at - p_starts_at > (case p_kind when 'weekly' then interval '7 days' else interval '31 days' end) then
    raise exception using errcode = '22023', message = 'explore_invalid_window';
  end if;
  if p_community_id is not null and not exists (select 1 from public.social_communities c where c.id = p_community_id) then
    raise exception using errcode = 'P0002', message = 'explore_community_not_found';
  end if;

  select * into v_previous from public.social_challenges c where c.id = v_id for update;
  v_created := not found;
  if v_created then
    if p_ends_at <= pg_catalog.now() then
      raise exception using errcode = '22023', message = 'explore_invalid_window';
    end if;
    insert into public.social_challenges (id, kind, title, metric, sport, target, starts_at, ends_at, community_id, created_by)
    values (v_id, p_kind, v_title, p_metric, v_sport, p_target, p_starts_at, p_ends_at, p_community_id, null);
  else
    if v_previous.closed_at is not null then
      raise exception using errcode = '22023', message = 'explore_challenge_closed';
    end if;
    update public.social_challenges c
    set kind = p_kind, title = v_title, metric = p_metric, sport = v_sport, target = p_target, starts_at = p_starts_at,
        ends_at = p_ends_at, community_id = p_community_id
    where c.id = v_id;
  end if;

  perform public.fitx_admin_op_log_event(p_operator_id, 'explore_challenge_saved', 'social_challenge', v_id::text,
    pg_catalog.jsonb_build_object('created', v_created, 'kind', p_kind, 'metric', p_metric, 'sport', v_sport,
      'has_target', p_target is not null, 'community', p_community_id is not null,
      'window_changed', not v_created and (v_previous.starts_at, v_previous.ends_at) is distinct from (p_starts_at, p_ends_at)));
  return v_id;
end;
$function$;

-- Closes a challenge now: the groups file's fitx_social_challenge_tick(id) when it is applied (a final sync of every
-- member, then the close, the ranks, the badges and their notices, for this challenge only); then closed_at, which the
-- tick has already set (or, without the groups file, this sets it). Returns closed_at.
create or replace function public.fitx_admin_op_close_challenge(p_operator_id uuid, p_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_challenge public.social_challenges%rowtype;
  v_closed timestamptz;
  v_participants integer;
  v_route text := 'none';
begin
  if not public.fitx_admin_op_can(p_operator_id, 'explore.moderate') then
    raise exception using errcode = '42501', message = 'Explore moderation permission required';
  end if;
  select * into v_challenge from public.social_challenges c where c.id = p_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'explore_challenge_not_found';
  end if;
  if v_challenge.closed_at is not null then
    raise exception using errcode = '22023', message = 'explore_challenge_closed';
  end if;
  if pg_catalog.to_regprocedure('public.fitx_social_challenge_tick(uuid)') is not null then
    v_route := 'tick';
    perform public.fitx_social_challenge_tick(p_id);
  end if;
  update public.social_challenges c set closed_at = coalesce(c.closed_at, pg_catalog.now()) where c.id = p_id returning c.closed_at into v_closed;
  select pg_catalog.count(*)::integer into v_participants from public.social_challenge_entries e where e.challenge_id = p_id;
  perform public.fitx_admin_op_log_event(p_operator_id, 'explore_challenge_closed', 'social_challenge', p_id::text,
    pg_catalog.jsonb_build_object('participants', v_participants, 'early', v_challenge.ends_at > pg_catalog.now(), 'final_sync', v_route));
  return v_closed;
end;
$function$;

-- Adds or edits a template the groups file's hourly tick opens weekly or monthly challenges from (when active).
create or replace function public.fitx_admin_op_save_challenge_template(
  p_operator_id uuid,
  p_id uuid,
  p_kind text,
  p_title text,
  p_metric text,
  p_sport text,
  p_target numeric,
  p_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_title text := pg_catalog.btrim(coalesce(p_title, ''));
  v_sport text := nullif(pg_catalog.btrim(coalesce(p_sport, '')), '');
  v_previous public.social_challenge_templates%rowtype;
  v_created boolean;
begin
  if not public.fitx_admin_op_can(p_operator_id, 'explore.moderate') then
    raise exception using errcode = '42501', message = 'Explore moderation permission required';
  end if;
  if p_kind is null or p_kind not in ('weekly', 'monthly') then
    raise exception using errcode = '22023', message = 'explore_invalid_kind';
  end if;
  if pg_catalog.char_length(v_title) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'explore_invalid_title';
  end if;
  if p_metric is null or p_metric not in ('workouts', 'active_minutes', 'distance_km', 'active_days') then
    raise exception using errcode = '22023', message = 'explore_invalid_metric';
  end if;
  if v_sport is not null and (p_metric not in ('distance_km', 'active_minutes')
     or v_sport not in ('walk', 'run', 'ride', 'hike', 'trail_run', 'mtb', 'ebike', 'wheelchair', 'skate', 'paddle')) then
    raise exception using errcode = '22023', message = 'explore_invalid_sport';
  end if;
  if p_target is not null and (p_target <= 0 or p_target > 100000) then
    raise exception using errcode = '22023', message = 'explore_invalid_target';
  end if;
  if p_active is null then
    raise exception using errcode = '22023', message = 'explore_invalid_active';
  end if;
  select * into v_previous from public.social_challenge_templates t where t.id = v_id for update;
  v_created := not found;
  if v_created then
    insert into public.social_challenge_templates (id, kind, title, metric, sport, target, active)
    values (v_id, p_kind, v_title, p_metric, v_sport, p_target, p_active);
  else
    update public.social_challenge_templates t
    set kind = p_kind, title = v_title, metric = p_metric, sport = v_sport, target = p_target, active = p_active
    where t.id = v_id;
  end if;
  perform public.fitx_admin_op_log_event(p_operator_id, 'explore_template_saved', 'social_challenge', v_id::text,
    pg_catalog.jsonb_build_object('template', true, 'created', v_created, 'kind', p_kind, 'metric', p_metric, 'sport', v_sport,
      'has_target', p_target is not null, 'before', case when v_created then null else pg_catalog.jsonb_build_object('active', v_previous.active) end,
      'after', pg_catalog.jsonb_build_object('active', p_active)));
  return v_id;
end;
$function$;

-- 6. The Free-plan meter ---------------------------------------------------------------------------------------------------

-- What Explore and the rest of the project use of the Supabase Free plan, measured now. A file whose size Storage did not
-- record is counted in "unsized", never as 0 bytes. The hourly job's last run is null without pg_cron.
create or replace function public.fitx_admin_explore_meter()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job jsonb;
  uuid_re constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
begin
  if pg_catalog.to_regclass('cron.job_run_details') is not null and pg_catalog.to_regclass('cron.job') is not null then
    begin
      execute $q$
        select pg_catalog.jsonb_build_object('status', d.status, 'started_at', d.start_time, 'ended_at', d.end_time)
        from cron.job_run_details d join cron.job j on j.jobid = d.jobid
        where j.jobname = 'fitx-social-hourly'
        order by d.start_time desc nulls last limit 1
      $q$ into v_job;
    exception when others then
      v_job := null;
    end;
  end if;
  return pg_catalog.jsonb_build_object(
    'measured_at', pg_catalog.now(),
    'database_bytes', pg_catalog.pg_database_size(pg_catalog.current_database()),
    'buckets', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('bucket', b.id, 'public', b.public, 'files', coalesce(x.files, 0),
               'bytes', coalesce(x.bytes, 0), 'unsized', coalesce(x.unsized, 0)) order by b.id)
      from storage.buckets b
      left join (
        select s.bucket_id, pg_catalog.count(*) as files, pg_catalog.sum(s.size) as bytes, pg_catalog.count(*) filter (where s.size is null) as unsized
        from (select o.bucket_id, case when (o.metadata ->> 'size') ~ '^[0-9]{1,15}$' then (o.metadata ->> 'size')::bigint end as size
              from storage.objects o) s
        group by s.bucket_id
      ) x on x.bucket_id = b.id), '[]'::jsonb),
    'explore', coalesce((
      select pg_catalog.jsonb_object_agg(k.kind, pg_catalog.jsonb_build_object('files', k.files, 'bytes', k.bytes, 'unsized', k.unsized))
      from (
        select f.kind, pg_catalog.count(*) as files, coalesce(pg_catalog.sum(f.size), 0) as bytes, pg_catalog.count(*) filter (where f.size is null) as unsized
        from (
          select case
                   when o.name like 'communities/%' then 'covers'
                   when o.name ~ ('^' || uuid_re || '/profile/') then 'avatars'
                   when exists (select 1 from public.social_stories st where st.storage_path = o.name or st.poster_path = o.name) then 'stories'
                   when o.name ~ '[.]mp4$' then 'videos'
                   when o.name ~ '/[0-9]p[.]webp$' then 'posters'
                   else 'photos'
                 end as kind,
                 case when (o.metadata ->> 'size') ~ '^[0-9]{1,15}$' then (o.metadata ->> 'size')::bigint end as size
          from storage.objects o where o.bucket_id = 'social-media'
        ) f
        group by f.kind
      ) k), '{}'::jsonb),
    'video_play_bytes_today', (select coalesce(pg_catalog.sum(c.hits), 0) from public.social_rate_counters c
                               where c.action = 'video_bytes:day' and c.window_start = pg_catalog.date_trunc('day', pg_catalog.now())),
    'caps', public.fitx_social_caps(),
    'trash', (select pg_catalog.jsonb_build_object('files', pg_catalog.count(*), 'oldest', pg_catalog.min(t.queued_at)) from public.social_storage_trash t),
    'hourly_job', v_job,
    'reports_open', (select pg_catalog.count(*) from public.social_reports r where r.status in ('open', 'reviewing')));
end;
$function$;

-- 7. Grants: service_role only ---------------------------------------------------------------------------------------------

revoke all on function public.fitx_admin_role_permissions(text) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_save_platform_settings(uuid, jsonb, jsonb, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.fitx_admin_explore_reason_words(text) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_moderate(uuid, uuid, text, text, text, timestamptz, text, uuid) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_save_community(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_set_community_role(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_save_challenge(uuid, uuid, text, text, text, text, numeric, timestamptz, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_close_challenge(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fitx_admin_op_save_challenge_template(uuid, uuid, text, text, text, text, numeric, boolean) from public, anon, authenticated;
revoke all on function public.fitx_admin_explore_meter() from public, anon, authenticated;

grant execute on function public.fitx_admin_role_permissions(text) to service_role;
grant execute on function public.fitx_admin_op_save_platform_settings(uuid, jsonb, jsonb, jsonb, timestamptz) to service_role;
grant execute on function public.fitx_admin_explore_reason_words(text) to service_role;
grant execute on function public.fitx_admin_op_moderate(uuid, uuid, text, text, text, timestamptz, text, uuid) to service_role;
grant execute on function public.fitx_admin_op_save_community(uuid, uuid, text, text, text, text, text) to service_role;
grant execute on function public.fitx_admin_op_set_community_role(uuid, uuid, uuid, text) to service_role;
grant execute on function public.fitx_admin_op_save_challenge(uuid, uuid, text, text, text, text, numeric, timestamptz, timestamptz, uuid) to service_role;
grant execute on function public.fitx_admin_op_close_challenge(uuid, uuid) to service_role;
grant execute on function public.fitx_admin_op_save_challenge_template(uuid, uuid, text, text, text, text, numeric, boolean) to service_role;
grant execute on function public.fitx_admin_explore_meter() to service_role;

notify pgrst, 'reload schema';
