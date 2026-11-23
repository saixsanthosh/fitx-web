// Explore part 2 core (20261124100000) on a throwaway local Postgres: reports across a block and of a message, the
// restrict limit, the video switch, quotas and caps, the .mp4 rule, stories, the play budget, the clean-up job (trash
// and orphans), a failing Realtime ping, the date-of-birth step and the under-13 rule, Explore switched off, "Your
// Explore content", and the header's undo. Skipped when the Postgres binaries are not on PATH.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { LocalPostgres, MIGRATIONS_DIR, available } from "../support/local-postgres.mjs";

const skip = available() ? false : "Postgres binaries (initdb, pg_ctl, psql) are not installed";
const FILE = path.join(MIGRATIONS_DIR, "20261124100000_fitx_social_v2_core.sql");
const V1 = path.join(MIGRATIONS_DIR, "20261123100060_fitx_social_v1.sql");
const A = "aaaaaaaa-2222-4000-8000-0000000000a1";
const B = "bbbbbbbb-2222-4000-8000-0000000000b2";
const C = "cccccccc-2222-4000-8000-0000000000c3";
const K = "dddddddd-2222-4000-8000-0000000000d4"; // a child
const U = "eeeeeeee-2222-4000-8000-0000000000e5"; // no date of birth
const as = (sub) => ({ role: "authenticated", sub });
const q = (text) => (text === null ? "null" : `'${String(text).replace(/'/g, "''")}'`);
let seq = 0;
const id = () => `0000dddd-2222-4000-8000-${String(++seq).padStart(12, "0")}`;

describe("Explore part 2 core", { skip }, () => {
  /** @type {LocalPostgres} */
  let pg;
  const call = (who, sql) => pg.json(`select to_jsonb(${sql});`, as(who));
  const fails = (who, sql, pattern) => {
    const r = pg.run(`select ${sql};`, as(who));
    assert.ok(!r.ok && pattern.test(r.stderr), `${sql}: ${r.stderr || "no error"}`);
  };
  const upload = (who, name, size = 2048) => pg.run(`insert into storage.objects (bucket_id, name, metadata) values ('social-media', ${q(name)}, '{"size": ${size}}');`, as(who));
  const features = (json) => pg.exec(`update public.platform_settings set features = ${q(JSON.stringify(json))}::jsonb where id = 1;`);
  const photoPost = (who, caption = "Post") => {
    const post = id();
    assert.ok(upload(who, `${who}/${post}/0.webp`).ok);
    return call(who, `public.fitx_social_create_post('${post}', ${q(caption)}, null, '[]', 'everyone', '[{"path": "${who}/${post}/0.webp", "width": 10, "height": 10}]')`);
  };

  before(() => {
    pg = new LocalPostgres().start();
    pg.applyMigrations();
    pg.exec(`insert into auth.users (id, email) values ('${A}', 'a@example.test'), ('${B}', 'b@example.test'), ('${C}', 'c@example.test'),
      ('${K}', 'k@example.test'), ('${U}', 'u@example.test');
      update public.profiles set date_of_birth = date '1990-01-01' where id in ('${A}', '${B}', '${C}');
      update public.profiles set date_of_birth = (current_date - interval '10 years')::date where id = '${K}';
      update public.profiles set date_of_birth = null, age = null where id = '${U}';`);
    for (const [who, name] of [[A, "asha.core"], [B, "ben.core"], [C, "chen.core"]]) {
      pg.exec(`select public.fitx_social_save_profile('${name}', 'X', '', false, 'everyone');`, as(who));
    }
  });
  after(() => pg?.stop());

  test("under-13s cannot make an Explore profile; members with no date of birth add one once", () => {
    fails(K, "public.fitx_social_save_profile('kid.core', 'K', '', false, 'everyone')", /social_age_restricted/);
    pg.exec(`select public.fitx_social_save_profile('una.core', 'U', '', false, 'everyone');`, as(U));
    assert.equal(call(U, "public.fitx_social_me()").age_band, "unknown");
    fails(U, "public.fitx_social_set_birth_date((current_date - interval '12 years')::date)", /social_age_restricted/);
    fails(U, "public.fitx_social_set_birth_date(date '1890-01-01')", /social_invalid/);
    assert.equal(call(U, "public.fitx_social_set_birth_date((current_date - interval '16 years')::date)"), "teen");
    assert.ok(pg.json(`select to_jsonb(birth_date_added_at) from public.social_profiles where user_id = '${U}';`), "stamped for Admin");
    assert.equal(pg.json(`select age from public.profiles where id = '${U}';`), 16, "the age follows the date");
    fails(U, "public.fitx_social_set_birth_date(date '1990-01-01')", /social_birth_date_set/);
    fails(A, "public.fitx_social_set_birth_date(date '1991-01-01')", /social_birth_date_set/);
  });

  test("a report reaches content addressed to the reporter across a block, and accounts despite one", () => {
    const post = photoPost(A, "Mention @ben.core");
    const comment = call(B, `public.fitx_social_add_comment('${post.id}', null, 'Rude comment')`);
    call(A, `public.fitx_social_set_block('${B}', true)`);
    // A blocked B: A still reports B's comment on A's own post and B's account; B reports A's post that mentioned B.
    assert.ok(call(A, `public.fitx_social_report('comment', '${comment.id}', 'harassment', null)`));
    assert.ok(call(A, `public.fitx_social_report('account', '${B}', 'harassment', null)`));
    assert.ok(call(B, `public.fitx_social_report('post', '${post.id}', 'spam', null)`));
    assert.ok(call(B, `public.fitx_social_report('account', '${A}', 'spam', null)`), "the blocked member can still report the blocker");
    const evidence = pg.json(`select evidence from public.social_reports where user_id = '${A}' and target_type = 'comment';`);
    assert.equal(evidence.body, "Rude comment");
    assert.equal(evidence.author, "ben.core");
    // C, who has nothing to do with it and cannot see a hidden post, cannot report it.
    pg.exec(`update public.social_posts set moderation_state = 'hidden' where id = '${post.id}';`);
    fails(C, `public.fitx_social_report('post', '${post.id}', 'spam', null)`, /social_not_found/);
    pg.exec(`update public.social_posts set moderation_state = 'visible' where id = '${post.id}';`);
    call(A, `public.fitx_social_set_block('${B}', false)`);
  });

  test("a message can be reported only by a side of its conversation, with that message as evidence", () => {
    const conversation = id();
    const message = id();
    pg.exec(`insert into public.social_conversations (id, user_low, user_high, status, requested_by) values ('${conversation}', '${A}', '${B}', 'accepted', '${B}');
      insert into public.social_messages (id, conversation_id, user_id, body) values ('${message}', '${conversation}', '${B}', 'Buy followers here');`);
    call(A, `public.fitx_social_report('message', '${message}', 'spam', null)`);
    const evidence = pg.json(`select evidence from public.social_reports where user_id = '${A}' and target_type = 'message';`);
    assert.deepEqual(Object.keys(evidence).sort(), ["body", "created_at", "sender"]);
    assert.equal(evidence.body, "Buy followers here");
    fails(C, `public.fitx_social_report('message', '${message}', 'spam', null)`, /social_not_found/);
    fails(B, `public.fitx_social_report('message', '${message}', 'spam', null)`, /social_not_found/);
    assert.equal(pg.json(`select count(*) from public.social_messages;`, as(A)), 0, "another member's messages read as empty until the groups migration");
    assert.equal(pg.json(`select count(*) from public.social_messages;`, as(B)), 1, "a member reads their own (for Download my data)");
    assert.equal(pg.json(`select count(*) from public.social_conversations;`, as(C)), 0);
    assert.equal(pg.run(`select count(*) from public.social_challenge_templates;`, as(A)).ok, false, "templates are FITX's only");
  });

  test("restricting is limited to 30 an hour", () => {
    for (let n = 0; n < 15; n += 1) {
      call(C, `public.fitx_social_set_restrict('${A}', true)`);
      call(C, `public.fitx_social_set_restrict('${A}', false)`);
    }
    fails(C, `public.fitx_social_set_restrict('${A}', true)`, /social_rate_limited/);
  });

  test("videos: off unless switched on; one item with a poster; another member's .mp4 is never signed by their key", () => {
    const post = id();
    const mp4 = `${A}/${post}/0.mp4`;
    const poster = `${A}/${post}/0p.webp`;
    assert.equal(upload(A, mp4).ok, false, "no .mp4 while explore_video is off");
    features({ explore_video: true });
    assert.ok(upload(A, mp4).ok);
    assert.ok(upload(A, poster).ok);
    const media = (extra) => `'${JSON.stringify([{ kind: "video", path: mp4, poster_path: poster, width: 720, height: 1280, duration_ms: 12000 }, ...extra])}'`;
    fails(A, `public.fitx_social_create_post('${post}', 'x', null, '[]', 'everyone', ${media([{ path: `${A}/${post}/1.webp`, width: 1, height: 1 }])})`, /social_media_count/);
    fails(A, `public.fitx_social_create_post('${post}', 'x', null, '[]', 'everyone', '[{"kind": "video", "path": "${mp4}", "width": 720, "height": 1280, "duration_ms": 12000}]')`, /social_media_missing/);
    fails(A, `public.fitx_social_create_post('${post}', 'x', null, '[]', 'everyone', '[{"kind": "video", "path": "${mp4}", "poster_path": "${poster}", "width": 720, "height": 1280, "duration_ms": 31000}]')`, /social_invalid/);
    const made = call(A, `public.fitx_social_create_post('${post}', 'Sprint drill', null, '[]', 'everyone', ${media([])})`);
    assert.equal(made.kind, "video");
    assert.equal(made.media[0].poster_path, poster);
    const readable = (who, name) => pg.json(`select count(*) from storage.objects where bucket_id = 'social-media' and name = ${q(name)};`, as(who));
    assert.equal(readable(B, poster), 1, "the poster follows the post");
    assert.equal(readable(B, mp4), 0, "the video itself is signed only by the server route");
    assert.equal(readable(A, mp4), 1);

    // Signed links: visible videos only, 40 a day per member, and the project's daily bytes.
    assert.deepEqual(call(B, `public.fitx_social_video_link_allowed(array['${mp4}', '${A}/${id()}/0.mp4'])`), [mp4]);
    pg.exec(`insert into public.social_rate_counters (user_id, action, window_start, hits) values ('${B}', 'video_view:day', date_trunc('day', now()), 40)
      on conflict (user_id, action, window_start) do update set hits = 40;`);
    fails(B, `public.fitx_social_video_link_allowed(array['${mp4}'])`, /social_link_budget/);
    pg.exec(`insert into public.social_rate_counters (user_id, action, window_start, hits) values ('${A}', 'video_bytes:day', date_trunc('day', now()), 78643000)
      on conflict (user_id, action, window_start) do update set hits = 78643000;`);
    fails(C, `public.fitx_social_video_link_allowed(array['${mp4}'])`, /social_link_budget/);
    features({ explore_video: false });
    fails(C, `public.fitx_social_video_link_allowed(array['${mp4}'])`, /social_unavailable/);
    fails(A, `public.fitx_social_update_post('${post}', 'new', null, '[]', null)`, /social_unavailable/);
    features({});
  });

  test("uploads: at most 3 videos a day, and nothing once Explore files reach the cap", () => {
    features({ explore_video: true });
    for (let n = 0; n < 2; n += 1) assert.ok(upload(C, `${C}/${id()}/0.mp4`).ok);
    assert.ok(upload(C, `${C}/${id()}/0.mp4`).ok);
    assert.equal(upload(C, `${C}/${id()}/0.mp4`).ok, false, "the fourth video upload of the day is refused");
    assert.equal(upload(C, `${C}/notes/0.mp4`).ok, false, "unexpected names are refused");
    features({});
    pg.exec(`insert into storage.objects (bucket_id, name, metadata) values ('social-media', 'filler/big.bin', '{"size": 471859200}');`);
    assert.equal(upload(C, `${C}/${id()}/0.webp`).ok, false, "the project cap stops uploads");
    pg.exec(`delete from storage.objects where name = 'filler/big.bin';`);
    assert.ok(upload(C, `${C}/${id()}/0.webp`).ok);
  });

  test("stories: live for 24 hours, seen and liked, the tray, viewers for the owner only", () => {
    pg.exec(`delete from public.social_follows where user_id = '${C}' and following_id = '${A}';`);
    call(C, `public.fitx_social_follow('${A}')`);
    const story = id();
    assert.ok(upload(A, `${A}/${story}/0.webp`).ok);
    fails(A, `public.fitx_social_create_story('${story}', 'video', '${A}/${story}/0.mp4', null, 1080, 1920, 5000, '')`, /social_unavailable/);
    const made = call(A, `public.fitx_social_create_story('${story}', 'image', '${A}/${story}/0.webp', null, 1080, 1920, null, 'Morning run')`);
    assert.equal(made.kind, "image");
    const tray = call(C, "public.fitx_social_story_tray()");
    assert.equal(tray[0].user.username, "asha.core");
    assert.equal(tray[0].unseen, true);
    assert.equal(call(C, `public.fitx_social_view_story('${story}')`), true);
    assert.equal(call(C, "public.fitx_social_story_tray()")[0].unseen, false);
    call(C, `public.fitx_social_set_story_like('${story}', true)`);
    assert.equal(call(A, "public.fitx_social_notifications()").filter((n) => n.type === "story_like" && n.story_id === story).length, 1);
    assert.equal(call(A, `public.fitx_social_stories('${A}')`)[0].view_count, 1);
    assert.equal(call(C, `public.fitx_social_stories('${A}')`)[0].view_count, null, "counts are the owner's only");
    assert.equal(call(A, `public.fitx_social_story_viewers('${story}')`)[0].user.username, "chen.core");
    fails(C, `public.fitx_social_story_viewers('${story}')`, /social_not_found/);
    pg.exec(`update public.social_stories set created_at = now() - interval '25 hours', expires_at = now() - interval '1 hour' where id = '${story}';`);
    fails(C, `public.fitx_social_view_story('${story}')`, /social_story_expired/);
    assert.deepEqual(call(C, "public.fitx_social_story_tray()"), []);
    assert.equal(call(A, "public.fitx_social_notifications()").some((n) => n.story_id === story), false, "an expired story's notices go with it");
    assert.deepEqual(call(A, `public.fitx_social_delete_story('${story}')`), [`${A}/${story}/0.webp`]);
  });

  test("the clean-up queues orphans, forgets trash that is gone, purges old evidence and prunes old notices", () => {
    const orphan = `${B}/${id()}/0.webp`;
    pg.exec(`insert into storage.objects (bucket_id, name, metadata, created_at) values ('social-media', ${q(orphan)}, '{"size": 10}', now() - interval '7 hours');
      insert into public.social_storage_trash (path, reason) values ('${B}/gone/0.webp', 'removed');
      update public.social_reports set status = 'dismissed', reviewed_at = now() - interval '91 days' where user_id = '${A}' and target_type = 'comment';
      update public.social_notifications set created_at = now() - interval '91 days' where user_id = '${A}';`);
    const result = pg.json(`select public.fitx_social_hourly();`);
    assert.ok(result.files_queued >= 1 && result.trash_forgotten >= 1 && result.evidence_purged >= 1, JSON.stringify(result));
    assert.equal(pg.json(`select count(*) from public.social_storage_trash where path = ${q(orphan)} and reason = 'orphan';`), 1);
    assert.equal(pg.json(`select count(*) from public.social_storage_trash where path = '${B}/gone/0.webp';`), 0);
    assert.equal(pg.json(`select count(*) from public.social_reports where user_id = '${A}' and target_type = 'comment' and evidence is not null;`), 0);
    assert.equal(pg.json(`select count(*) from public.social_notifications where user_id = '${A}';`), 0);
    const member = pg.run(`select public.fitx_social_hourly();`, as(A));
    assert.ok(!member.ok && /permission denied/.test(member.stderr), "members cannot run the job");
    assert.equal(pg.run(`select count(*) from public.social_storage_trash;`, as(A)).ok, false, "nor read the trash");
  });

  test("a Realtime ping that fails never fails the write", () => {
    pg.exec(`create schema if not exists realtime;
      create or replace function realtime.send(payload jsonb, event text, topic text, private boolean) returns void language plpgsql as $f$ begin raise exception 'realtime down'; end $f$;`);
    const post = photoPost(B, "Ping test");
    assert.equal(call(C, `public.fitx_social_set_like('${post.id}', true)`).liked, true);
    assert.ok(call(B, "public.fitx_social_notifications()").some((n) => n.type === "like" && n.post_id === post.id));
    pg.exec(`drop schema realtime cascade;`);
  });

  test("with Explore switched off, members can still delete their content, block and report, and nothing else", () => {
    const post = photoPost(C, "Before the switch");
    features({ explore: false });
    fails(C, "public.fitx_social_feed()", /social_unavailable/);
    fails(C, `public.fitx_social_set_like('${post.id}', true)`, /social_unavailable/);
    fails(U, "public.fitx_social_save_profile('una.core', 'U', 'new bio', false, 'everyone')", /social_unavailable/);
    assert.equal(call(C, "public.fitx_social_me()").explore, false);
    assert.ok(call(C, "public.fitx_social_my_content()").posts.some((p) => p.id === post.id));
    call(C, `public.fitx_social_set_block('${B}', true)`);
    call(C, `public.fitx_social_set_block('${B}', false)`);
    assert.ok(call(C, "public.fitx_social_notification_prefs()").stories);
    const paths = call(C, "public.fitx_social_delete_all_content()");
    assert.ok(paths.includes(`${C}/${post.id}/0.webp`));
    assert.equal(pg.json(`select count(*) from public.social_posts where user_id = '${C}';`), 0);
    features({});
  });

  test("a suspension stops the member's own Explore use and hides their content; deleting stays open", () => {
    const post = photoPost(B, "Suspended soon");
    pg.exec(`insert into public.social_member_sanctions (user_id, kind, until, reason_code) values ('${B}', 'explore', now() + interval '7 days', 'spam');`);
    fails(B, "public.fitx_social_feed()", /social_suspended/);
    assert.equal(call(A, `public.fitx_social_post('${post.id}')`), null);
    assert.equal(call(A, "public.fitx_social_search('ben')").accounts.length, 0, "left out of search");
    assert.ok(call(B, "public.fitx_social_me()").suspension.until);
    assert.deepEqual(pg.json(`select jsonb_agg(kind) from public.social_member_sanctions;`, as(B)), ["explore"], "they read their own sanction");
    const operator = pg.run(`select created_by_operator from public.social_member_sanctions;`, as(B));
    assert.ok(!operator.ok && /permission denied/.test(operator.stderr), "but not who set it");
    assert.ok(call(B, `public.fitx_social_delete_post('${post.id}')`).length === 1);
    pg.exec(`update public.social_member_sanctions set lifted_at = now() where user_id = '${B}';`);
    assert.ok(Array.isArray(call(B, "public.fitx_social_feed()")));
  });

  test("the notification preferences add stories, challenges, communities and messages", () => {
    const saved = call(A, "public.fitx_social_save_notification_prefs(true, true, true, true, true, p_stories => false)");
    assert.equal(saved.stories, false);
    const five = call(A, "public.fitx_social_save_notification_prefs(p_follows => true, p_follow_requests => true, p_likes => true, p_comments => true, p_mentions => true)");
    assert.equal(five.stories, false, "a five-argument save keeps the newer settings");
  });

  test("the header's undo removes part 2 and the file applies again", () => {
    const header = readFileSync(FILE, "utf8").split("\n");
    const start = header.findIndex((line) => line.startsWith("-- Undo"));
    const undo = header.slice(start + 1).filter((line) => line.startsWith("--   ")).map((line) => line.slice(5))
      .filter((line) => !line.startsWith("-- then")).join("\n");
    const ran = pg.run(undo);
    assert.ok(ran.ok, ran.stderr);
    pg.applyFile(V1);
    assert.equal(pg.json(`select count(*) from pg_tables where schemaname = 'public' and tablename = 'social_stories';`), 0);
    assert.deepEqual(pg.json(`select to_jsonb(allowed_mime_types) from storage.buckets where id = 'social-media';`), ["image/webp", "image/jpeg"]);
    pg.applyFile(FILE);
    pg.applyFile(FILE);
    assert.equal(pg.json(`select count(*) from pg_proc where proname = 'fitx_social_save_notification_prefs';`), 1);
    assert.ok(Array.isArray(call(A, "public.fitx_social_feed()")));
  });
});
