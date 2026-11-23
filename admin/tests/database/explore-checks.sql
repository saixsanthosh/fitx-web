\set ON_ERROR_STOP 1
\set QUIET 1
-- Functional checks for 20261124100020_fitx_admin_explore on a throwaway database: the Explore permissions, the
-- feature switches, moderation of reports (dismiss, claim, limit, hide, unhide, remove, clear, warn, suspend, lift),
-- communities, challenges and templates, and the Free-plan meter. Each block raises with a label when an expectation
-- fails. Names, ids and texts are made up.

create temporary table explore_ids (name text primary key, id uuid);
grant all on explore_ids to public;

-- Members: an author (adult), a reporter, a second reporter and a teen.
insert into auth.users (id, email, email_confirmed_at, created_at) values
  ('00000000-0000-4000-8000-0000000005a1', 'explore-author@example.com', now(), now() - interval '30 days'),
  ('00000000-0000-4000-8000-0000000005a2', 'explore-reporter@example.com', now(), now() - interval '30 days'),
  ('00000000-0000-4000-8000-0000000005a3', 'explore-reporter-two@example.com', now(), now() - interval '30 days'),
  ('00000000-0000-4000-8000-0000000005a4', 'explore-teen@example.com', now(), now() - interval '30 days');
insert into public.profiles (id) values
  ('00000000-0000-4000-8000-0000000005a1'), ('00000000-0000-4000-8000-0000000005a2'),
  ('00000000-0000-4000-8000-0000000005a3'), ('00000000-0000-4000-8000-0000000005a4')
on conflict (id) do nothing;
update public.profiles set date_of_birth = date '1990-04-01' where id in ('00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-0000000005a2', '00000000-0000-4000-8000-0000000005a3');
update public.profiles set date_of_birth = (current_date - interval '15 years')::date where id = '00000000-0000-4000-8000-0000000005a4';
insert into public.social_profiles (user_id, username, display_name, bio, avatar_path) values
  ('00000000-0000-4000-8000-0000000005a1', 'check_author', 'Check Author', 'A bio to clear', '00000000-0000-4000-8000-0000000005a1/profile/a1.webp'),
  ('00000000-0000-4000-8000-0000000005a2', 'check_reporter', 'Check Reporter', '', null),
  ('00000000-0000-4000-8000-0000000005a3', 'check_reporter_two', 'Check Reporter Two', '', null),
  ('00000000-0000-4000-8000-0000000005a4', 'check_teen', 'Check Teen', '', null);

-- Operators --------------------------------------------------------------------------------------------------------------
do $$
declare
  root_id uuid := public.fitx_admin_op_root_sign_in('test-owner');
  hash text := 'scrypt:32768:8:1:AAAAAAAAAAAAAAAAAAAAAA:' || repeat('E', 86);
begin
  insert into explore_ids values
    ('root', root_id),
    ('admin', public.fitx_admin_op_create_operator(root_id, 'explore-admin-check', 'admin', hash)),
    ('support', public.fitx_admin_op_create_operator(root_id, 'explore-support-check', 'support_agent', hash)),
    ('editor', public.fitx_admin_op_create_operator(root_id, 'explore-editor-check', 'content_editor', hash)),
    ('viewer', public.fitx_admin_op_create_operator(root_id, 'explore-viewer-check', 'viewer', hash)),
    ('author', '00000000-0000-4000-8000-0000000005a1'), ('reporter', '00000000-0000-4000-8000-0000000005a2'),
    ('reporter2', '00000000-0000-4000-8000-0000000005a3'), ('teen', '00000000-0000-4000-8000-0000000005a4');
end $$;

-- Every function of the file runs for service_role only, with a pinned search path -------------------------------------
do $$
declare
  f record;
  n integer := 0;
begin
  for f in
    select p.oid, p.proname, p.prosecdef, p.proconfig from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('fitx_admin_role_permissions', 'fitx_admin_op_save_platform_settings', 'fitx_admin_explore_reason_words',
        'fitx_admin_op_moderate', 'fitx_admin_op_save_community', 'fitx_admin_op_set_community_role', 'fitx_admin_op_save_challenge',
        'fitx_admin_op_close_challenge', 'fitx_admin_op_save_challenge_template', 'fitx_admin_explore_meter')
  loop
    n := n + 1;
    if has_function_privilege('anon', f.oid, 'execute') or has_function_privilege('authenticated', f.oid, 'execute') then
      raise exception '% must not be callable by anon or authenticated', f.proname;
    end if;
    if not has_function_privilege('service_role', f.oid, 'execute') then raise exception '% must be callable by service_role', f.proname; end if;
    if not coalesce(f.proconfig @> array['search_path=""'], false) then raise exception '% must pin search_path', f.proname; end if;
    if (f.proname like 'fitx_admin_op\_%' or f.proname = 'fitx_admin_explore_meter') and not f.prosecdef then
      raise exception '% must be security definer', f.proname;
    end if;
  end loop;
  if n <> 10 then raise exception 'expected 10 functions, found % (a changed signature leaves an old one behind)', n; end if;
end $$;
\echo ok explore functions: service_role only, pinned search path, security definer

-- Permissions: 23 in all; admins moderate, support agents look, editors and viewers neither (O5 a) ----------------------
do $$
begin
  if cardinality(public.fitx_admin_role_permissions('super_admin')) <> 23 then raise exception 'super_admin must hold 23 permissions'; end if;
  if not public.fitx_admin_role_permissions('admin') @> array['explore.view', 'explore.moderate'] then raise exception 'admin must moderate Explore'; end if;
  if not public.fitx_admin_role_permissions('support_agent') @> array['explore.view'] or 'explore.moderate' = any (public.fitx_admin_role_permissions('support_agent')) then
    raise exception 'support agents get explore.view only';
  end if;
  if public.fitx_admin_role_permissions('content_editor') && array['explore.view', 'explore.moderate']
     or public.fitx_admin_role_permissions('viewer') && array['explore.view', 'explore.moderate'] then
    raise exception 'content editors and viewers get no Explore permission';
  end if;
  if not public.fitx_admin_op_can((select id from explore_ids where name = 'support'), 'explore.view')
     or public.fitx_admin_op_can((select id from explore_ids where name = 'support'), 'explore.moderate') then
    raise exception 'fitx_admin_op_can must read the new table';
  end if;
end $$;
\echo ok permissions: explore.view and explore.moderate as the role table says

-- The settings save accepts explore and explore_video, still refuses unknown keys and still needs settings.manage ------
do $$
declare
  root_id uuid := (select id from explore_ids where name = 'root');
  admin_id uuid := (select id from explore_ids where name = 'admin');
  site jsonb := '{"supportEmail": "help@example.test"}';
begin
  perform public.fitx_admin_op_save_platform_settings(root_id,
    '{"ai_coach": true, "home_workout": true, "activity": true, "subscriptions": true, "support": true, "explore": false, "explore_video": true}', null, site, null);
  if (select features from public.platform_settings where id = 1) <> '{"ai_coach": true, "home_workout": true, "activity": true, "subscriptions": true, "support": true, "explore": false, "explore_video": true}'::jsonb then
    raise exception 'the Explore switches were not saved';
  end if;
  begin
    perform public.fitx_admin_op_save_platform_settings(root_id, '{"explore_reels": true}', null, site, null);
    raise exception 'an unknown switch was saved';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.fitx_admin_op_save_platform_settings(root_id, '{"explore": "off"}', null, site, null);
    raise exception 'a switch that is not a boolean was saved';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.fitx_admin_op_save_platform_settings(admin_id, '{"explore": true}', null, site, null);
    raise exception 'an admin saved settings';
  exception when sqlstate '42501' then null; end;
  if not exists (select 1 from public.fitx_admin_audit_logs where action = 'platform_settings_updated' and actor_operator_id = root_id
                 and details -> 'after' -> 'features' ->> 'explore' = 'false') then
    raise exception 'the save must still be audited with the switches';
  end if;
  -- Leave Explore on and videos off for the checks below.
  perform public.fitx_admin_op_save_platform_settings(root_id, '{"explore": true, "explore_video": false}', null, site, null);
end $$;
\echo ok settings save: explore and explore_video accepted, unknown keys refused, settings.manage needed

-- Content and reports for the moderation checks --------------------------------------------------------------------------
do $$
declare
  author uuid := (select id from explore_ids where name = 'author');
  reporter uuid := (select id from explore_ids where name = 'reporter');
  reporter2 uuid := (select id from explore_ids where name = 'reporter2');
  post_hide uuid := gen_random_uuid();
  post_remove uuid := gen_random_uuid();
  comment_id uuid := gen_random_uuid();
  story_id uuid := gen_random_uuid();
  row_name text;
  row_kind text;
  row_target uuid;
  row_who uuid;
  row_n integer;
  new_report uuid;
begin
  insert into public.social_posts (id, user_id, caption) values (post_hide, author, 'A post to hide'), (post_remove, author, 'A post to remove');
  insert into public.social_post_media (post_id, user_id, position, storage_path, width, height, bytes) values
    (post_remove, author, 0, author || '/' || post_remove || '/0.webp', 800, 600, 51200),
    (post_remove, author, 1, author || '/' || post_remove || '/1.webp', 800, 600, 40960);
  insert into public.social_comments (id, post_id, user_id, body) values (comment_id, post_hide, author, 'A comment to limit');
  insert into public.social_stories (id, user_id, kind, storage_path, width, height, bytes) values
    (story_id, author, 'image', author || '/' || story_id || '/0.webp', 1080, 1920, 90000);
  insert into explore_ids values ('post_hide', post_hide), ('post_remove', post_remove), ('comment', comment_id), ('story', story_id);
  for row_name, row_kind, row_target, row_who, row_n in
    select * from (values
      ('post_hide', 'post', post_hide, reporter, 1), ('post_hide', 'post', post_hide, reporter2, 2),
      ('post_remove', 'post', post_remove, reporter, 1), ('comment', 'comment', comment_id, reporter, 1),
      ('story', 'story', story_id, reporter, 1), ('account', 'account', author, reporter, 1), ('account', 'account', author, reporter2, 2)
    ) as x(name, kind, target, who, n)
  loop
    insert into public.social_reports (user_id, target_type, target_id, target_user_id, reason, evidence)
    values (row_who, row_kind, row_target, author, 'spam', jsonb_build_object('caption', 'snapshot')) returning id into new_report;
    insert into explore_ids values ('report_' || row_name || row_n, new_report);
  end loop;
end $$;

-- Only explore.moderate may act; the action, reason, time and target must fit ------------------------------------------
do $$
declare
  report uuid := (select id from explore_ids where name = 'report_post_hide1');
  author uuid := (select id from explore_ids where name = 'author');
  who text;
begin
  foreach who in array array['support', 'editor', 'viewer'] loop
    begin
      perform public.fitx_admin_op_moderate((select id from explore_ids where name = who), report, 'dismiss');
      raise exception '% moderated a report', who;
    exception when sqlstate '42501' then null; end;
    begin
      perform public.fitx_admin_op_save_community((select id from explore_ids where name = who), null, 'not-allowed', 'Not allowed', '', 'public');
      raise exception '% saved a community', who;
    exception when sqlstate '42501' then null; end;
    begin
      perform public.fitx_admin_op_save_challenge((select id from explore_ids where name = who), null, 'weekly', 'Not allowed', 'workouts', null, null, now(), now() + interval '7 days');
      raise exception '% saved a challenge', who;
    exception when sqlstate '42501' then null; end;
  end loop;
  begin perform public.fitx_admin_op_moderate(null, report, 'dismiss'); raise exception 'no operator moderated';
  exception when sqlstate '42501' then null; end;
  begin perform public.fitx_admin_op_moderate((select id from explore_ids where name = 'admin'), report, 'delete_everything'); raise exception 'an unknown action ran';
  exception when sqlstate '22023' then null; end;
  begin perform public.fitx_admin_op_moderate((select id from explore_ids where name = 'admin'), report, 'hide'); raise exception 'a hide without a reason ran';
  exception when sqlstate '22023' then null; end;
  begin perform public.fitx_admin_op_moderate((select id from explore_ids where name = 'admin'), report, 'hide', 'not_a_reason'); raise exception 'an unknown reason ran';
  exception when sqlstate '22023' then null; end;
  begin perform public.fitx_admin_op_moderate((select id from explore_ids where name = 'admin'), report, 'suspend', 'spam', null, now() + interval '2 years'); raise exception 'a two-year suspension ran';
  exception when sqlstate '22023' then null; end;
  begin perform public.fitx_admin_op_moderate((select id from explore_ids where name = 'admin'), report, 'suspend', 'spam', null, null, 'everything'); raise exception 'an unknown sanction ran';
  exception when sqlstate '22023' then null; end;
  begin perform public.fitx_admin_op_moderate((select id from explore_ids where name = 'admin'), null, 'hide', 'spam', null, null, 'explore', author); raise exception 'a content action ran without a report';
  exception when sqlstate '22023' then null; end;
  begin perform public.fitx_admin_op_moderate((select id from explore_ids where name = 'admin'), (select id from explore_ids where name = 'report_account1'), 'hide', 'spam'); raise exception 'an account was hidden as content';
  exception when sqlstate '22023' then null; end;
  begin perform public.fitx_admin_op_moderate((select id from explore_ids where name = 'admin'), gen_random_uuid(), 'dismiss'); raise exception 'a missing report was dismissed';
  exception when sqlstate 'P0002' then null; end;
  if exists (select 1 from public.social_reports where status <> 'open') then raise exception 'a refused action changed a report'; end if;
end $$;
\echo ok moderation refusals: 42501 without explore.moderate, 22023 for what does not fit, P0002 for a missing report

-- Hide: the post is hidden, both reports on it close as actioned, each reporter hears back, the evidence is kept 90 days
-- after review, and the moderation and audit rows are written in the same call ----------------------------------------
do $$
declare
  admin_id uuid := (select id from explore_ids where name = 'admin');
  post_id uuid := (select id from explore_ids where name = 'post_hide');
  report uuid := (select id from explore_ids where name = 'report_post_hide1');
  audits_before bigint := (select count(*) from public.fitx_admin_audit_logs);
  result jsonb;
begin
  perform public.fitx_admin_op_moderate(admin_id, report, 'claim');
  if (select status from public.social_reports where id = report) <> 'reviewing' then raise exception 'claim must mark the report reviewing'; end if;
  if (select status from public.social_reports where id = (select id from explore_ids where name = 'report_post_hide2')) <> 'open' then raise exception 'claim must touch only its report'; end if;
  result := public.fitx_admin_op_moderate(admin_id, report, 'hide', 'spam', 'Spam links in the caption');
  if (select moderation_state from public.social_posts where id = post_id) <> 'hidden' then raise exception 'the post was not hidden'; end if;
  if jsonb_array_length(result -> 'report_ids') <> 2 or result ->> 'status' <> 'actioned' then raise exception 'both reports on the post must close: %', result; end if;
  if exists (select 1 from public.social_reports where target_id = post_id and (status <> 'actioned' or reviewed_at is null
             or evidence_purge_at not between now() + interval '89 days' and now() + interval '91 days')) then
    raise exception 'closed reports need actioned, reviewed_at and the 90-day purge time';
  end if;
  if (select count(*) from public.social_notifications where type = 'report_reviewed' and actor_id is null
      and user_id in ((select id from explore_ids where name = 'reporter'), (select id from explore_ids where name = 'reporter2'))) <> 2 then
    raise exception 'each reporter gets one report_reviewed notice';
  end if;
  if not exists (select 1 from public.social_moderation_actions where action = 'hide' and actor_kind = 'operator' and operator_id = admin_id
                 and target_type = 'post' and target_id = post_id and cardinality(report_ids) = 2 and note = 'Spam links in the caption') then
    raise exception 'the moderation record is missing';
  end if;
  if (select count(*) from public.fitx_admin_audit_logs where id > 0) - audits_before <> 2 then raise exception 'claim and hide write one audit row each'; end if;
  if not exists (select 1 from public.fitx_admin_audit_logs where action = 'explore_content_hidden' and resource_type = 'social_post'
                 and resource_id = post_id::text and actor_operator_id = admin_id and (details ->> 'reports_closed')::int = 2
                 and details ->> 'reason' = 'spam' and (details ->> 'note')::boolean) then
    raise exception 'the hide audit row needs codes and counts';
  end if;
  if exists (select 1 from public.fitx_admin_audit_logs where action like 'explore\_%' and details::text like '%Spam links%') then
    raise exception 'the note text must never reach the audit log';
  end if;
  -- The owner still sees the post; nobody else does.
  if not public.fitx_social_sees_post((select id from explore_ids where name = 'author'), post_id)
     or public.fitx_social_sees_post((select id from explore_ids where name = 'reporter'), post_id) then
    raise exception 'a hidden post is for its owner only';
  end if;
  -- Unhide puts it back without reopening or closing reports.
  perform public.fitx_admin_op_moderate(admin_id, report, 'unhide');
  if (select moderation_state from public.social_posts where id = post_id) <> 'visible' then raise exception 'unhide must make it visible'; end if;
  if not exists (select 1 from public.social_moderation_actions where action = 'hide' and target_id = post_id and reversed_at is not null) then
    raise exception 'unhide must mark the hide reversed';
  end if;
  if (select count(*) from public.social_notifications where type = 'report_reviewed') <> 2 then raise exception 'unhide notifies nobody'; end if;
end $$;
\echo ok hide and unhide: reports closed, reporters told, evidence kept 90 days, moderation and audit rows written

-- A failed call leaves nothing behind: the content change and the audit row go together -------------------------------
do $$
declare
  admin_id uuid := (select id from explore_ids where name = 'admin');
  comment_id uuid := (select id from explore_ids where name = 'comment');
  audits_before bigint := (select count(*) from public.fitx_admin_audit_logs);
begin
  begin
    perform public.fitx_admin_op_moderate(admin_id, (select id from explore_ids where name = 'report_comment1'), 'limit', 'harassment');
    raise exception 'roll back' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null; end;
  if (select moderation_state from public.social_comments where id = comment_id) <> 'visible'
     or (select count(*) from public.fitx_admin_audit_logs) <> audits_before then
    raise exception 'the change and its audit row must be one transaction';
  end if;
  perform public.fitx_admin_op_moderate(admin_id, (select id from explore_ids where name = 'report_comment1'), 'limit', 'harassment');
  if (select moderation_state from public.social_comments where id = comment_id) <> 'limited' then raise exception 'the comment was not limited'; end if;
  if (select count(*) from public.fitx_admin_audit_logs where action = 'explore_content_limited' and resource_type = 'social_comment') <> 1 then
    raise exception 'limit is audited once';
  end if;
end $$;
\echo ok audit in the same transaction: a rolled-back call leaves neither the change nor the audit row

-- Remove: the post goes, its files come back for the Storage API and wait in the trash; a story the same way ----------
do $$
declare
  admin_id uuid := (select id from explore_ids where name = 'admin');
  post_id uuid := (select id from explore_ids where name = 'post_remove');
  story_id uuid := (select id from explore_ids where name = 'story');
  result jsonb;
begin
  result := public.fitx_admin_op_moderate(admin_id, (select id from explore_ids where name = 'report_post_remove1'), 'remove', 'nudity');
  if exists (select 1 from public.social_posts where id = post_id) then raise exception 'remove must delete the post'; end if;
  if jsonb_array_length(result -> 'paths') <> 2 or (select count(*) from public.social_storage_trash where reason = 'removed' and path like '%' || post_id || '%') <> 2 then
    raise exception 'both photo paths must come back and wait in the trash: %', result;
  end if;
  begin
    perform public.fitx_admin_op_moderate(admin_id, (select id from explore_ids where name = 'report_post_remove1'), 'hide', 'nudity');
    raise exception 'a gone post was hidden';
  exception when sqlstate 'P0002' then null; end;
  -- Dismissing is still possible for a report on gone content.
  result := public.fitx_admin_op_moderate(admin_id, (select id from explore_ids where name = 'report_story1'), 'remove', 'violence');
  if exists (select 1 from public.social_stories where id = story_id) or jsonb_array_length(result -> 'paths') <> 1 then raise exception 'the story must go with its file'; end if;
end $$;
\echo ok remove: content deleted, file paths returned and queued for the sweep, a gone item cannot be hidden

-- Member actions: clear the photo and bio, warn with the fixed text, suspend (Explore refuses the member), lift ---------
do $$
declare
  admin_id uuid := (select id from explore_ids where name = 'admin');
  author uuid := (select id from explore_ids where name = 'author');
  report uuid := (select id from explore_ids where name = 'report_account1');
  result jsonb;
  refused boolean := false;
begin
  result := public.fitx_admin_op_moderate(admin_id, report, 'clear_avatar', 'hate');
  if (select avatar_path from public.social_profiles where user_id = author) is not null or result -> 'paths' <> to_jsonb(array[author || '/profile/a1.webp']) then
    raise exception 'clear_avatar must clear the photo and return its path: %', result;
  end if;
  if (select count(*) from public.social_reports where target_type = 'account' and target_id = author and status = 'actioned') <> 2 then
    raise exception 'an account action closes the account reports';
  end if;
  perform public.fitx_admin_op_moderate(admin_id, null, 'clear_bio', 'hate', null, null, 'explore', author);
  if (select bio from public.social_profiles where user_id = author) <> '' then raise exception 'clear_bio must clear the bio'; end if;
  perform public.fitx_admin_op_moderate(admin_id, null, 'warn', 'harassment', null, null, 'explore', author);
  if not exists (select 1 from public.member_notifications where user_id = author and tone = 'warning' and created_by_operator_id = admin_id
                 and title = 'A warning from FITX about Explore' and body like '%(bullying or harassment)%') then
    raise exception 'warn must send the fixed warning notice';
  end if;
  perform public.fitx_admin_op_moderate(admin_id, null, 'suspend', 'spam', null, now() + interval '7 days', 'explore', author);
  if not exists (select 1 from public.social_member_sanctions where user_id = author and kind = 'explore' and lifted_at is null
                 and until between now() + interval '6 days' and now() + interval '8 days' and created_by_operator = admin_id and reason_code = 'spam') then
    raise exception 'suspend must add an explore sanction';
  end if;
  -- A second suspension replaces the first (indefinite now).
  perform public.fitx_admin_op_moderate(admin_id, null, 'suspend', 'spam', null, null, 'explore', author);
  if (select count(*) from public.social_member_sanctions where user_id = author and kind = 'explore' and lifted_at is null) <> 1
     or (select until from public.social_member_sanctions where user_id = author and kind = 'explore' and lifted_at is null) is not null then
    raise exception 'a new suspension replaces the active one';
  end if;
  perform set_config('request.jwt.claim.sub', author::text, true);
  begin
    perform public.fitx_social_member();
  exception when others then
    refused := sqlerrm = 'social_suspended';
  end;
  perform set_config('request.jwt.claim.sub', '', true);
  if not refused then raise exception 'a suspended member must be refused with social_suspended'; end if;
  perform public.fitx_admin_op_moderate(admin_id, null, 'lift', null, null, null, 'explore', author);
  if exists (select 1 from public.social_member_sanctions where user_id = author and kind = 'explore' and lifted_at is null) then raise exception 'lift must end it'; end if;
  begin
    perform public.fitx_admin_op_moderate(admin_id, null, 'lift', null, null, null, 'explore', author);
    raise exception 'a second lift found a suspension';
  exception when sqlstate 'P0002' then null; end;
  if (select count(*) from public.fitx_admin_audit_logs where action in ('explore_profile_cleared', 'explore_member_warned', 'explore_member_suspended', 'explore_member_unsuspended')
      and resource_type = 'social_profile' and resource_id = author::text) <> 6 then
    raise exception 'each member action writes one audit row on the member';
  end if;
end $$;
\echo ok member actions: photo and bio cleared, fixed warning sent, suspension enforced in Explore, then lifted

-- Dismiss closes the reports without changing the content -------------------------------------------------------------
do $$
declare
  admin_id uuid := (select id from explore_ids where name = 'admin');
  author uuid := (select id from explore_ids where name = 'author');
  post_id uuid := gen_random_uuid();
  report uuid;
begin
  insert into public.social_posts (id, user_id, caption) values (post_id, author, 'A fine post');
  insert into public.social_reports (user_id, target_type, target_id, target_user_id, reason) values ((select id from explore_ids where name = 'reporter'), 'post', post_id, author, 'other') returning id into report;
  perform public.fitx_admin_op_moderate(admin_id, report, 'dismiss');
  if (select status from public.social_reports where id = report) <> 'dismissed' or (select moderation_state from public.social_posts where id = post_id) <> 'visible' then
    raise exception 'dismiss closes the report and leaves the post';
  end if;
  begin perform public.fitx_admin_op_moderate(admin_id, report, 'claim'); raise exception 'a closed report was claimed';
  exception when sqlstate '22023' then null; end;
end $$;
\echo ok dismiss: report dismissed, content untouched, a closed report cannot be claimed

-- What operators did stays out of members' reach ------------------------------------------------------------------------
do $$
declare
  n bigint;
begin
  if has_table_privilege('authenticated', 'public.social_moderation_actions', 'select') or has_table_privilege('anon', 'public.social_moderation_actions', 'select') then
    raise exception 'members must not read the moderation record';
  end if;
  if has_column_privilege('authenticated', 'public.social_member_sanctions', 'created_by_operator', 'select') then
    raise exception 'members must not see who suspended them';
  end if;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', (select id::text from explore_ids where name = 'author'), true);
  begin
    select count(*) into n from public.social_moderation_actions;
    raise exception 'authenticated read the moderation record';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;
\echo ok moderation record: unreadable by anon and authenticated

-- Communities: FITX creates and edits them; slugs are unique; moderators are accepted adult members --------------------
do $$
declare
  admin_id uuid := (select id from explore_ids where name = 'admin');
  author uuid := (select id from explore_ids where name = 'author');
  teen uuid := (select id from explore_ids where name = 'teen');
  community uuid;
  again uuid;
begin
  community := public.fitx_admin_op_save_community(admin_id, null, ' Morning-Runners ', ' Morning runners ', 'Runs before work.', 'public');
  if not exists (select 1 from public.social_communities where id = community and slug = 'morning-runners' and name = 'Morning runners'
                 and created_by is null and cover_path is null and visibility = 'public') then
    raise exception 'the community was not stored as FITX''s';
  end if;
  again := public.fitx_admin_op_save_community(admin_id, community, 'morning-runners', 'Morning runners', 'Runs before work.', 'private',
    'communities/' || community || '/cover.webp');
  if again <> community or (select visibility from public.social_communities where id = community) <> 'private'
     or (select cover_path from public.social_communities where id = community) <> 'communities/' || community || '/cover.webp' then
    raise exception 'editing must keep the id and save the cover';
  end if;
  perform public.fitx_admin_op_save_community(admin_id, community, 'morning-runners', 'Morning runners', 'Runs before work.', 'private');
  if (select cover_path from public.social_communities where id = community) is null then raise exception 'a null cover keeps the cover'; end if;
  perform public.fitx_admin_op_save_community(admin_id, community, 'morning-runners', 'Morning runners', 'Runs before work.', 'private', '');
  if (select cover_path from public.social_communities where id = community) is not null then raise exception 'an empty cover removes it'; end if;
  begin perform public.fitx_admin_op_save_community(admin_id, null, 'morning-runners', 'Copy', '', 'public'); raise exception 'a slug was used twice';
  exception when unique_violation then null; end;
  begin perform public.fitx_admin_op_save_community(admin_id, null, 'x', 'Bad slug', '', 'public'); raise exception 'a one-letter slug was saved';
  exception when sqlstate '22023' then null; end;
  begin perform public.fitx_admin_op_save_community(admin_id, null, 'other-cover', 'Other', '', 'public', 'communities/elsewhere/cover.webp'); raise exception 'a foreign cover path was saved';
  exception when sqlstate '22023' then null; end;
  begin perform public.fitx_admin_op_save_community(admin_id, null, 'secret-club', 'Secret', '', 'hidden'); raise exception 'an unknown visibility was saved';
  exception when sqlstate '22023' then null; end;
  insert into public.social_community_members (community_id, user_id, role, status) values (community, author, 'member', 'accepted'), (community, teen, 'member', 'accepted');
  begin perform public.fitx_admin_op_set_community_role(admin_id, community, (select id from explore_ids where name = 'reporter'), 'moderator'); raise exception 'a non-member was appointed';
  exception when sqlstate 'P0002' then null; end;
  begin perform public.fitx_admin_op_set_community_role(admin_id, community, teen, 'moderator'); raise exception 'a teen was appointed';
  exception when sqlstate '22023' then null; end;
  perform public.fitx_admin_op_set_community_role(admin_id, community, author, 'moderator');
  if (select role from public.social_community_members where community_id = community and user_id = author) <> 'moderator' then raise exception 'the moderator was not appointed'; end if;
  perform public.fitx_admin_op_set_community_role(admin_id, community, author, 'member');
  if (select role from public.social_community_members where community_id = community and user_id = author) <> 'member' then raise exception 'the moderator was not removed'; end if;
  if (select count(*) from public.fitx_admin_audit_logs where action = 'explore_community_saved' and resource_id = community::text) <> 4
     or (select count(*) from public.fitx_admin_audit_logs where action = 'explore_community_role_set' and resource_id = community::text) <> 2 then
    raise exception 'community saves and role changes are audited';
  end if;
  insert into explore_ids values ('community', community);
end $$;
\echo ok communities: saved and edited by FITX, unique slugs, covers at their own path, adult moderators only

-- Challenges and templates: checked windows and metrics, closed ones stay closed --------------------------------------
do $$
declare
  admin_id uuid := (select id from explore_ids where name = 'admin');
  monday timestamptz := date_trunc('week', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  challenge uuid;
  template uuid;
  closed timestamptz;
begin
  challenge := public.fitx_admin_op_save_challenge(admin_id, null, 'weekly', ' Five workouts ', 'workouts', null, 5, monday, monday + interval '7 days');
  if not exists (select 1 from public.social_challenges where id = challenge and title = 'Five workouts' and created_by is null and closed_at is null and target = 5) then
    raise exception 'the challenge was not stored';
  end if;
  perform public.fitx_admin_op_save_challenge(admin_id, challenge, 'weekly', 'Five workouts', 'workouts', null, 4, monday, monday + interval '7 days',
    (select id from explore_ids where name = 'community'));
  if (select target from public.social_challenges where id = challenge) <> 4 then raise exception 'the edit was not saved'; end if;
  begin perform public.fitx_admin_op_save_challenge(admin_id, null, 'weekly', 'Too long', 'workouts', null, null, monday, monday + interval '8 days'); raise exception 'an eight-day weekly challenge was saved';
  exception when sqlstate '22023' then null; end;
  begin perform public.fitx_admin_op_save_challenge(admin_id, null, 'monthly', 'Over', 'workouts', null, null, now() - interval '20 days', now() - interval '1 day'); raise exception 'a new challenge that already ended was saved';
  exception when sqlstate '22023' then null; end;
  begin perform public.fitx_admin_op_save_challenge(admin_id, null, 'weekly', 'Sport', 'workouts', 'run', null, monday, monday + interval '7 days'); raise exception 'a sport on a workouts challenge was saved';
  exception when sqlstate '22023' then null; end;
  begin perform public.fitx_admin_op_save_challenge(admin_id, null, 'weekly', 'Sport', 'distance_km', 'swim', null, monday, monday + interval '7 days'); raise exception 'an unknown sport was saved';
  exception when sqlstate '22023' then null; end;
  perform public.fitx_admin_op_save_challenge(admin_id, null, 'monthly', 'Run 50 km', 'distance_km', 'run', 50, date_trunc('month', now()), date_trunc('month', now()) + interval '1 month');
  begin perform public.fitx_admin_op_save_challenge(admin_id, null, 'weekly', 'Elsewhere', 'workouts', null, null, monday, monday + interval '7 days', gen_random_uuid()); raise exception 'a missing community was used';
  exception when sqlstate 'P0002' then null; end;
  closed := public.fitx_admin_op_close_challenge(admin_id, challenge);
  if closed is null or (select closed_at from public.social_challenges where id = challenge) <> closed then raise exception 'close must set closed_at'; end if;
  begin perform public.fitx_admin_op_close_challenge(admin_id, challenge); raise exception 'a closed challenge closed again';
  exception when sqlstate '22023' then null; end;
  begin perform public.fitx_admin_op_save_challenge(admin_id, challenge, 'weekly', 'Reopen', 'workouts', null, null, monday, monday + interval '7 days'); raise exception 'a closed challenge was edited';
  exception when sqlstate '22023' then null; end;
  begin perform public.fitx_admin_op_close_challenge((select id from explore_ids where name = 'support'), challenge); raise exception 'a support agent closed a challenge';
  exception when sqlstate '42501' then null; end;
  template := public.fitx_admin_op_save_challenge_template(admin_id, null, 'weekly', 'Three active days', 'active_days', null, 3, true);
  perform public.fitx_admin_op_save_challenge_template(admin_id, template, 'weekly', 'Three active days', 'active_days', null, 3, false);
  if (select active from public.social_challenge_templates where id = template) then raise exception 'the template edit was not saved'; end if;
  begin perform public.fitx_admin_op_save_challenge_template(admin_id, null, 'daily', 'Daily', 'workouts', null, null, true); raise exception 'a daily template was saved';
  exception when sqlstate '22023' then null; end;
  if (select count(*) from public.fitx_admin_audit_logs where action = 'explore_challenge_saved') <> 3
     or (select count(*) from public.fitx_admin_audit_logs where action = 'explore_challenge_closed' and resource_id = challenge::text) <> 1
     or (select count(*) from public.fitx_admin_audit_logs where action = 'explore_template_saved' and resource_type = 'social_challenge') <> 2 then
    raise exception 'challenge saves, the close and template saves are audited';
  end if;
end $$;
\echo ok challenges and templates: windows, metrics and sports checked, closed challenges stay closed, all audited

-- The meter measures, and an unsized file is counted as unsized, never as 0 bytes --------------------------------------
do $$
declare
  author uuid := (select id from explore_ids where name = 'author');
  meter jsonb;
begin
  insert into storage.objects (bucket_id, name, metadata) values
    ('social-media', author || '/' || gen_random_uuid() || '/0.webp', '{"size": 51200}'),
    ('social-media', author || '/' || gen_random_uuid() || '/0.mp4', '{"size": 2900000}'),
    ('social-media', author || '/' || gen_random_uuid() || '/0p.webp', null),
    ('social-media', 'communities/' || (select id from explore_ids where name = 'community') || '/cover.webp', '{"size": 80000}');
  meter := public.fitx_admin_explore_meter();
  if (meter ->> 'database_bytes')::bigint <= 0 then raise exception 'the database size is missing'; end if;
  if (meter -> 'explore' -> 'photos' ->> 'bytes')::bigint < 51200 or (meter -> 'explore' -> 'videos' ->> 'bytes')::bigint < 2900000
     or (meter -> 'explore' -> 'posters' ->> 'unsized')::int < 1 or (meter -> 'explore' -> 'covers' ->> 'files')::int < 1 then
    raise exception 'the Explore kinds are wrong: %', meter -> 'explore';
  end if;
  if not exists (select 1 from jsonb_array_elements(meter -> 'buckets') b where b ->> 'bucket' = 'social-media' and (b ->> 'unsized')::int >= 1) then
    raise exception 'the bucket list must count unsized files: %', meter -> 'buckets';
  end if;
  if (meter -> 'caps' ->> 'video_play_bytes_per_day')::bigint <> 78643200 or meter ->> 'video_play_bytes_today' is null then
    raise exception 'the video play budget is missing';
  end if;
  if (meter -> 'trash' ->> 'files')::int < 3 then raise exception 'the trash queue is missing: %', meter -> 'trash'; end if;
  if not (meter ? 'hourly_job') or not (meter ? 'reports_open') then raise exception 'the hourly job and open reports keys are missing'; end if;
end $$;
\echo ok meter: buckets, Explore kinds, unsized files, database size, video budget, trash and the hourly job

\echo ALL EXPLORE ADMIN CHECKS PASSED
