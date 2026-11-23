// Runs every repo migration on a throwaway local Postgres (the Supabase stand-in in tests/support, no network, no real
// data) and checks Explore's schema (20261123100060) as signed-in members: profiles, private follow approval, posts and
// their photos, likes, comments, saves, notifications and their preferences, blocks, restrictions, reports, the
// social-media bucket's policies, the anti-spam limits (uploads counted as they happen), and that the file can run again.
// Skipped when the Postgres binaries (initdb, pg_ctl, psql) are not on PATH.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { LocalPostgres, MIGRATIONS_DIR, available } from "../support/local-postgres.mjs";

const A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const B = "bbbbbbbb-0000-4000-8000-0000000000b2";
const C = "cccccccc-0000-4000-8000-0000000000c3";
const D = "dddddddd-0000-4000-8000-0000000000d4";
const as = (sub) => ({ role: "authenticated", sub });
const FILE = path.join(MIGRATIONS_DIR, "20261123100060_fitx_social_v1.sql");
const skip = available() ? false : "Postgres binaries (initdb, pg_ctl, psql) are not installed";

const q = (text) => (text === null ? "null" : `'${String(text).replace(/'/g, "''")}'`);
let postSeq = 0;
const newPostId = () => `0000aaaa-0000-4000-8000-${String(++postSeq).padStart(12, "0")}`;

describe("Explore schema", { skip }, () => {
  /** @type {LocalPostgres} */
  let pg;
  const call = (who, sql) => pg.json(`select to_jsonb(${sql});`, as(who));
  const fails = (who, sql) => pg.run(`select ${sql};`, as(who));
  const profile = (who, username, isPrivate = false) =>
    call(who, `public.fitx_social_save_profile(${q(username)}, ${q(username.toUpperCase())}, '', ${isPrivate}, 'everyone')`);
  /** Uploads (as the member, through the bucket policy) and publishes a post with `count` photos. */
  const post = (who, caption, { count = 1, topics = [], policy = "everyone" } = {}) => {
    const id = newPostId();
    const media = [];
    for (let n = 0; n < count; n += 1) {
      const name = `${who}/${id}/${n}.webp`;
      pg.exec(`insert into storage.objects (bucket_id, name, owner_id, metadata) values ('social-media', ${q(name)}, ${q(who)}, '{"size": 2048, "mimetype": "image/webp"}');`, as(who));
      media.push({ path: name, width: 1200, height: 1500 });
    }
    return call(who, `public.fitx_social_create_post(${q(id)}::uuid, ${q(caption)}, null, ${q(JSON.stringify(topics))}::jsonb, ${q(policy)}, ${q(JSON.stringify(media))}::jsonb)`);
  };
  const feed = (who) => call(who, "public.fitx_social_feed()");
  const notes = (who) => call(who, "public.fitx_social_notifications()");

  before(() => {
    pg = new LocalPostgres().start();
    pg.applyMigrations();
    pg.exec(`insert into auth.users (id, email) values ('${A}', 'a@example.test'), ('${B}', 'b@example.test'), ('${C}', 'c@example.test'), ('${D}', 'd@example.test');`);
  });
  after(() => pg?.stop());

  test("members write nothing directly, and signed-out visitors reach nothing", () => {
    const direct = pg.run(`insert into public.social_profiles (user_id, username, display_name) values ('${A}', 'sneaky', 'Sneaky');`, as(A));
    assert.ok(!direct.ok && /permission denied/i.test(direct.stderr), direct.stderr);
    const anon = pg.run("select count(*) from public.social_posts;", { role: "anon" });
    assert.ok(!anon.ok && /permission denied/i.test(anon.stderr), anon.stderr);
    const rpc = pg.run("select public.fitx_social_me();", { role: "anon" });
    assert.ok(!rpc.ok && /permission denied/i.test(rpc.stderr), rpc.stderr);
    const internal = pg.run(`select public.fitx_social_sees_posts('${A}', '${B}');`, as(A));
    assert.ok(!internal.ok && /permission denied/i.test(internal.stderr), "helpers that take a viewer are not callable");
  });

  test("a profile comes first; usernames are lower case, valid, unreserved and unique", () => {
    const first = call(A, "public.fitx_social_me()");
    assert.deepEqual({ profile: first.profile, unread: first.unread, requests: first.requests }, { profile: null, unread: 0, requests: 0 });
    assert.equal(first.explore, true, "Explore is on when Admin never saved the switch");
    assert.equal(first.suspension, null);
    const noProfile = fails(A, "public.fitx_social_feed()");
    assert.ok(!noProfile.ok && /social_no_profile/.test(noProfile.stderr));
    for (const bad of ["ab", "-bad", "bad.", "a..b", "has space"]) {
      const r = fails(A, `public.fitx_social_save_profile(${q(bad)}, 'A', '', false)`);
      assert.ok(!r.ok && /social_username_invalid/.test(r.stderr), `${bad}: ${r.stderr}`);
    }
    assert.ok(/social_username_reserved/.test(fails(A, "public.fitx_social_save_profile('admin', 'A', '', false)").stderr));
    assert.ok(/social_username_reserved/.test(fails(A, "public.fitx_social_save_profile('new', 'A', '', false)").stderr), "\"new\" is kept for the story composer's address");
    assert.equal(profile(A, "Asha.Lifts").username, "asha.lifts");
    profile(B, "ben_private", true);
    profile(C, "chen.runs");
    const taken = fails(C, "public.fitx_social_save_profile('ASHA.LIFTS', 'C', '', false)");
    assert.ok(!taken.ok && /social_username_taken/.test(taken.stderr));
    assert.equal(call(C, "public.fitx_social_username_available('asha.lifts')"), false);
    assert.equal(call(C, "public.fitx_social_username_available('new.name')"), true);
    // D never makes a profile: nobody sees them anywhere.
    assert.equal(pg.json(`select count(*) from public.social_profiles where user_id = '${D}';`, as(A)), 0);
  });

  test("a private account approves follows; only accepted followers see its posts", () => {
    const secret = post(B, "Leg day #LegDay with @asha.lifts");
    assert.equal(call(A, "public.fitx_social_follow('" + B + "')"), "pending");
    assert.equal(call(A, `public.fitx_social_post('${secret.id}')`), null, "a pending follower does not see the post");
    assert.equal(pg.json(`select count(*) from public.social_posts where id = '${secret.id}';`, as(A)), 0, "nor through the table");
    assert.equal(call(B, "public.fitx_social_me()").requests, 1);
    assert.equal(call(B, "public.fitx_social_requests()")[0].user.username, "asha.lifts");
    assert.equal(notes(B)[0].type, "follow_request");
    // A was mentioned in a post A cannot see: no notification.
    assert.equal(notes(A).length, 0);

    call(B, `public.fitx_social_answer_request('${A}', true)`);
    assert.equal(call(A, `public.fitx_social_post('${secret.id}')`).id, secret.id);
    assert.equal(feed(A).length, 1);
    assert.equal(notes(A)[0].type, "follow_accepted");
    assert.equal(call(C, `public.fitx_social_post('${secret.id}')`), null, "a non-follower still does not see it");
    const profileForC = call(C, "public.fitx_social_profile('ben_private')");
    assert.equal(profileForC.can_see_posts, false);
    assert.equal(profileForC.counts.posts, 1);
    assert.deepEqual(call(C, `public.fitx_social_follow_list('${B}', 'followers')`), [], "a private account's followers stay private");
  });

  test("posts: photos in order, hashtags, mentions, topics, edits and limits", () => {
    const made = post(A, "Morning #Push session #push with @chen.runs.", { count: 3, topics: ["gym_workouts", "muscle_gain"] });
    assert.equal(made.media.length, 3);
    assert.deepEqual(made.media.map((m) => m.path.split("/").pop()), ["0.webp", "1.webp", "2.webp"]);
    assert.deepEqual(made.topics.sort(), ["gym_workouts", "muscle_gain"]);
    assert.deepEqual(pg.json(`select jsonb_agg(h.tag order by h.tag) from public.social_post_hashtags ph join public.social_hashtags h on h.id = ph.hashtag_id where ph.post_id = '${made.id}';`), ["push"]);
    const mention = notes(C).find((n) => n.type === "mention");
    assert.ok(mention && mention.post_id === made.id, "C, who can see the public post, is told about the mention");

    const edited = call(A, `public.fitx_social_update_post('${made.id}', 'Morning push #strength @chen.runs', 'Pune', '["gym_workouts"]'::jsonb, 'followers')`);
    assert.ok(edited.edited_at);
    assert.equal(edited.location, "Pune");
    assert.equal(edited.comment_policy, "followers");
    assert.equal(notes(C).filter((n) => n.type === "mention").length, 1, "an edit does not mention again");
    assert.ok(/social_not_found/.test(fails(C, `public.fitx_social_update_post('${made.id}', 'mine now', null, '[]'::jsonb, null)`).stderr));

    // Photos must be the member's own uploads at the expected paths, 1 to 10 of them.
    const id = newPostId();
    const missing = fails(A, `public.fitx_social_create_post('${id}', 'x', null, '[]', 'everyone', '[{"path": "${A}/${id}/0.webp", "width": 10, "height": 10}]')`);
    assert.ok(/social_media_missing/.test(missing.stderr), missing.stderr);
    const none = fails(A, `public.fitx_social_create_post('${id}', 'x', null, '[]', 'everyone', '[]')`);
    assert.ok(/social_media_count/.test(none.stderr));
    const badTopic = pg.run(`insert into storage.objects (bucket_id, name, metadata) values ('social-media', '${A}/${id}/0.webp', '{"size": 10}');
      select public.fitx_social_create_post('${id}', 'x', null, '["crypto"]', 'everyone', '[{"path": "${A}/${id}/0.webp", "width": 10, "height": 10}]');`, as(A));
    assert.ok(!badTopic.ok && /social_posts_topics_check/.test(badTopic.stderr), badTopic.stderr);
  });

  test("the bucket: own folder and expected names only; reads follow the post's visibility", () => {
    const other = pg.run(`insert into storage.objects (bucket_id, name) values ('social-media', '${B}/${newPostId()}/0.webp');`, as(A));
    assert.ok(!other.ok && /row-level security/i.test(other.stderr), "no uploads into someone else's folder");
    const odd = pg.run(`insert into storage.objects (bucket_id, name) values ('social-media', '${A}/notes/0.webp');`, as(A));
    assert.ok(!odd.ok, "no files outside posts and the profile folder");
    assert.equal(JSON.stringify(pg.json(`select jsonb_build_object('public', public, 'limit', file_size_limit, 'types', allowed_mime_types) from storage.buckets b where id = 'social-media';`)),
      JSON.stringify({ limit: 3145728, types: ["image/webp", "image/jpeg", "video/mp4"], public: false }), "wave 2 (20261124100000) adds video/mp4");

    const bPost = pg.json(`select to_jsonb(storage_path) from public.social_post_media where user_id = '${B}' limit 1;`);
    const visible = (who, name) => pg.json(`select count(*) from storage.objects where bucket_id = 'social-media' and name = ${q(name)};`, as(who));
    assert.equal(visible(A, bPost), 1, "an accepted follower may sign B's photo");
    assert.equal(visible(C, bPost), 0, "others may not");
    const orphan = `${C}/${newPostId()}/0.webp`;
    pg.exec(`insert into storage.objects (bucket_id, name) values ('social-media', ${q(orphan)});`, as(C));
    assert.equal(visible(A, orphan), 0, "an upload not in any post is the owner's only");
    assert.equal(visible(C, orphan), 1);
  });

  test("likes, saves and comments, with comment controls and notifications", () => {
    const pub = post(C, "Hill sprints #cardio", { topics: ["motivation"] });
    const liked = call(A, `public.fitx_social_set_like('${pub.id}', true)`);
    assert.deepEqual(liked, { liked: true, like_count: 1 });
    call(A, `public.fitx_social_set_like('${pub.id}', true)`);
    call(A, `public.fitx_social_set_like('${pub.id}', false)`);
    call(A, `public.fitx_social_set_like('${pub.id}', true)`);
    assert.equal(notes(C).filter((n) => n.type === "like").length, 1, "liking again does not notify again");
    assert.equal(call(A, `public.fitx_social_set_save('${pub.id}', true)`), true);
    assert.equal(call(A, "public.fitx_social_saved()")[0].id, pub.id);
    assert.equal(pg.json(`select count(*) from public.social_saves;`, as(C)), 0, "nobody sees who saved their post");

    const top = call(A, `public.fitx_social_add_comment('${pub.id}', null, 'Great pace @chen.runs')`);
    const reply = call(C, `public.fitx_social_add_comment('${pub.id}', '${top.id}', 'Thanks!')`);
    const replyToReply = call(A, `public.fitx_social_add_comment('${pub.id}', '${reply.id}', 'Again?')`);
    assert.equal(replyToReply.parent_id, top.id, "a reply to a reply answers the top-level comment");
    const thread = call(B, `public.fitx_social_comments('${pub.id}')`);
    assert.equal(thread.length, 1);
    assert.equal(thread[0].replies.length, 2);
    assert.deepEqual(notes(C).map((n) => n.type).filter((t) => t === "comment"), ["comment", "comment"]);
    assert.equal(notes(A).filter((n) => n.type === "reply").length, 1);
    assert.equal(call(C, `public.fitx_social_post('${pub.id}')`).comment_count, 3);

    const edited = call(A, `public.fitx_social_edit_comment('${top.id}', 'Great pace')`);
    assert.ok(edited.edited_at);
    assert.ok(/social_not_found/.test(fails(B, `public.fitx_social_edit_comment('${top.id}', 'hijack')`).stderr));
    // The post's owner may remove any comment on it; others only their own.
    assert.ok(/social_not_found/.test(fails(B, `public.fitx_social_delete_comment('${reply.id}')`).stderr));
    call(C, `public.fitx_social_delete_comment('${replyToReply.id}')`);
    assert.equal(call(C, `public.fitx_social_comments('${pub.id}')`)[0].replies.length, 1);

    const closed = post(C, "Rest day", { policy: "off" });
    assert.ok(/social_comments_closed/.test(fails(A, `public.fitx_social_add_comment('${closed.id}', null, 'hi')`).stderr));
    const followersOnly = post(C, "Followers only", { policy: "followers" });
    assert.ok(/social_comments_closed/.test(fails(A, `public.fitx_social_add_comment('${followersOnly.id}', null, 'hi')`).stderr));
    call(A, `public.fitx_social_follow('${C}')`);
    assert.ok(call(A, `public.fitx_social_add_comment('${followersOnly.id}', null, 'hi')`).id);
  });

  test("notification preferences turn kinds off; reading marks them read", () => {
    assert.ok(call(C, "public.fitx_social_me()").unread > 0);
    assert.ok(call(C, "public.fitx_social_mark_read()") > 0);
    assert.equal(call(C, "public.fitx_social_me()").unread, 0);
    call(C, "public.fitx_social_save_notification_prefs(true, true, false, true, true)");
    const quiet = post(C, "Quiet post");
    call(A, `public.fitx_social_set_like('${quiet.id}', true)`);
    assert.equal(call(C, "public.fitx_social_me()").unread, 0, "likes are off");
    assert.equal(call(C, "public.fitx_social_notification_prefs()").likes, false);
  });

  test("restricting hides a member's comments from everyone but them and the owner, without notifications", () => {
    profile(D, "dee.trains");
    const pub = post(A, "Deadlift form check");
    call(A, `public.fitx_social_set_restrict('${D}', true)`);
    const before = call(A, "public.fitx_social_me()").unread;
    const c = call(D, `public.fitx_social_add_comment('${pub.id}', null, 'Bad form lol')`);
    assert.equal(call(A, "public.fitx_social_me()").unread, before, "no notification from a restricted member");
    assert.equal(call(D, `public.fitx_social_comments('${pub.id}')`).length, 1, "they see their own comment");
    const ownerView = call(A, `public.fitx_social_comments('${pub.id}')`);
    assert.equal(ownerView.length, 1);
    assert.equal(ownerView[0].restricted, true);
    assert.equal(call(C, `public.fitx_social_comments('${pub.id}')`).length, 0, "others do not");
    assert.equal(pg.json(`select count(*) from public.social_comments where id = '${c.id}';`, as(C)), 0);
    call(A, `public.fitx_social_set_restrict('${D}', false)`);
    assert.equal(call(C, `public.fitx_social_comments('${pub.id}')`).length, 1);
  });

  test("a restricted member's replies and mentions reach nobody else, and a later restriction hides earlier ones", () => {
    const me = (who) => call(who, "public.fitx_social_me()");
    const pub = post(A, "Squat day");
    const top = call(C, `public.fitx_social_add_comment('${pub.id}', null, 'Depth looks good')`);
    const early = call(D, `public.fitx_social_add_comment('${pub.id}', '${top.id}', 'Agreed, early reply')`);
    const seen = notes(C).find((n) => n.comment_id === early.id);
    assert.equal(seen?.type, "reply", "before any restriction the reply reaches the comment's author");
    assert.equal(seen.snippet, "Agreed, early reply");
    const unreadBefore = me(C).unread;

    call(A, `public.fitx_social_set_restrict('${D}', true)`);
    assert.equal(notes(C).some((n) => n.comment_id === early.id), false, "a later restriction hides the earlier reply");
    assert.equal(me(C).unread, unreadBefore - 1, "and the badge no longer counts it");
    const unreadB = me(B).unread;
    const hidden = call(D, `public.fitx_social_add_comment('${pub.id}', '${top.id}', 'Secret reply @ben_private')`);
    call(D, `public.fitx_social_edit_comment('${hidden.id}', 'Secret reply @ben_private @chen.runs')`);
    assert.equal(pg.json(`select count(*) from public.social_notifications where comment_id = '${hidden.id}' and user_id <> '${A}';`), 0,
      "no reply or mention notification is written for anyone but the post's owner");
    for (const who of [B, C]) {
      assert.equal(notes(who).some((n) => n.comment_id === hidden.id || /Secret/.test(n.snippet ?? "")), false, `${who} reads nothing of it`);
    }
    assert.equal(me(B).unread, unreadB);
    assert.equal(me(C).unread, unreadBefore - 1);

    call(A, `public.fitx_social_set_restrict('${D}', false)`);
    assert.ok(notes(C).some((n) => n.comment_id === early.id), "lifting the restriction shows the earlier reply again");
  });

  test("the unread count counts only what the list shows", () => {
    const me = (who) => call(who, "public.fitx_social_me()");
    const unreadShown = (who) => notes(who).filter((n) => !n.read && n.type !== "follow_request").length;
    call(B, "public.fitx_social_mark_read()");
    const quiet = post(B, "Rest and stretch");
    call(A, `public.fitx_social_set_like('${quiet.id}', true)`);
    assert.equal(me(B).unread, 1);
    assert.equal(unreadShown(B), 1);
    call(A, `public.fitx_social_set_like('${quiet.id}', false)`);
    assert.equal(unreadShown(B), 0, "a like that no longer stands is not listed");
    assert.equal(me(B).unread, 0, "nor counted");
  });

  test("blocking hides both members from each other and ends their follows", () => {
    call(C, `public.fitx_social_follow('${A}')`);
    assert.ok(pg.json(`select count(*) from public.social_follows where (user_id = '${A}' and following_id = '${C}') or (user_id = '${C}' and following_id = '${A}');`) >= 2);
    call(C, `public.fitx_social_set_block('${A}', true)`);
    assert.equal(pg.json(`select count(*) from public.social_follows where (user_id = '${A}' and following_id = '${C}') or (user_id = '${C}' and following_id = '${A}');`), 0);
    assert.equal(call(A, "public.fitx_social_profile('chen.runs')"), null, "the blocked member cannot open the blocker's profile");
    assert.equal(call(C, "public.fitx_social_profile('asha.lifts')").relation.blocked, true, "the blocker sees whom they blocked");
    assert.equal(call(A, "public.fitx_social_search('chen')").accounts.length, 0);
    assert.equal(call(A, "public.fitx_social_browse(null, null, null)").some((p) => p.author.username === "chen.runs"), false);
    assert.ok(/social_not_found/.test(fails(A, `public.fitx_social_follow('${C}')`).stderr));
    const cPost = pg.json(`select to_jsonb(id) from public.social_posts where user_id = '${C}' limit 1;`);
    assert.ok(/social_not_found/.test(fails(A, `public.fitx_social_set_like('${cPost}', true)`).stderr));
    assert.equal(call(C, "public.fitx_social_safety_lists()").blocked[0].username, "asha.lifts");
    call(C, `public.fitx_social_set_block('${A}', false)`);
    assert.ok(call(A, "public.fitx_social_profile('chen.runs')"));
  });

  test("reports: visible targets only, one per target, readable by the reporter only", () => {
    const target = pg.json(`select to_jsonb(id) from public.social_posts where user_id = '${C}' order by created_at limit 1;`);
    const id = call(A, `public.fitx_social_report('post', '${target}', 'spam', 'Selling pills')`);
    assert.equal(call(A, `public.fitx_social_report('post', '${target}', 'scam', null)`), id, "a second report updates the first");
    assert.equal(pg.json(`select count(*) from public.social_reports;`, as(C)), 0);
    assert.equal(pg.json(`select to_jsonb(reason) from public.social_reports where id = '${id}';`, as(A)), "scam");
    const bPost = pg.json(`select to_jsonb(id) from public.social_posts where user_id = '${B}' limit 1;`);
    assert.ok(/social_not_found/.test(fails(C, `public.fitx_social_report('post', '${bPost}', 'spam', null)`).stderr), "a hidden post cannot be reported");
    assert.ok(call(A, `public.fitx_social_report('account', '${D}', 'harassment', null)`));
  });

  test("discover: trending ranks real engagement from others; search finds accounts and hashtags", () => {
    const trending = call(B, "public.fitx_social_trending()");
    assert.ok(trending.length > 0);
    assert.ok(trending.every((p) => p.score > 0 && !p.author.is_private));
    assert.ok(trending.every((p, i) => i === 0 || trending[i - 1].score >= p.score));
    assert.ok(!trending.some((p) => p.author.username === "ben_private"));
    const motivation = call(B, "public.fitx_social_trending('motivation')");
    assert.ok(motivation.every((p) => p.topics.includes("motivation")));
    const tags = call(B, "public.fitx_social_search('#le')").hashtags;
    assert.deepEqual(tags, [{ tag: "legday", posts: 1 }], "B sees their own private post's hashtag");
    assert.deepEqual(call(C, "public.fitx_social_search('#le')").hashtags, [], "a hidden post's hashtag is not counted");
    assert.equal(call(C, "public.fitx_social_search('@asha')").accounts[0].username, "asha.lifts");
    assert.equal(call(C, "public.fitx_social_search('100%')").accounts.length, 0);
    const suggestions = call(D, "public.fitx_social_suggestions()");
    assert.ok(suggestions.length > 0 && suggestions.every((s) => ["followed_by", "topic", "popular", "new"].includes(s.reason)));
    assert.ok(!suggestions.some((s) => s.user.id === D));
    assert.ok(call(A, "public.fitx_social_browse(null, 'cardio', null)").every((p) => /#cardio/i.test(p.caption)));
  });

  test("feed pages with a cursor, newest first, without repeats", () => {
    const all = feed(A);
    const first = call(A, "public.fitx_social_feed(null, null, 2)");
    const last = first[first.length - 1];
    const next = call(A, `public.fitx_social_feed(${q(last.created_at)}::timestamptz, ${q(last.id)}::uuid, 50)`);
    assert.deepEqual([...first, ...next].map((p) => p.id), all.map((p) => p.id));
  });

  test("posting is limited per hour", () => {
    const user = "eeeeeeee-0000-4000-8000-0000000000e5";
    pg.exec(`insert into auth.users (id, email) values ('${user}', 'e@example.test');`);
    profile(user, "eve.posts");
    for (let n = 0; n < 10; n += 1) post(user, `post ${n}`);
    const id = newPostId();
    const r = pg.run(`insert into storage.objects (bucket_id, name, metadata) values ('social-media', '${user}/${id}/0.webp', '{"size": 10}');
      select public.fitx_social_create_post('${id}', 'one too many', null, '[]', 'everyone', '[{"path": "${user}/${id}/0.webp", "width": 10, "height": 10}]');`, as(user));
    assert.ok(!r.ok && /social_rate_limited/.test(r.stderr), r.stderr);
    assert.equal(pg.json(`select count(*) from public.social_posts where user_id = '${user}';`), 10);
  });

  test("uploads are limited to 60 in 24 hours, and deleting files gives none back", () => {
    const user = "ffffffff-0000-4000-8000-0000000000f6";
    pg.exec(`insert into auth.users (id, email) values ('${user}', 'f@example.test');`);
    profile(user, "fay.uploads");
    const name = (n) => `${user}/profile/churn-${n}.webp`;
    const churn = [];
    for (let n = 0; n < 60; n += 1) {
      churn.push(`insert into storage.objects (bucket_id, name, metadata) values ('social-media', ${q(name(n))}, '{"size": 10}');`);
      churn.push(`delete from storage.objects where bucket_id = 'social-media' and name = ${q(name(n))};`);
    }
    pg.exec(churn.join("\n"), as(user));
    assert.equal(pg.json(`select count(*) from storage.objects where name like '${user}/%';`), 0, "every churned file is gone");
    const again = pg.run(`insert into storage.objects (bucket_id, name, metadata) values ('social-media', ${q(name(60))}, '{"size": 10}');`, as(user));
    assert.ok(!again.ok && /row-level security/i.test(again.stderr), "the 61st upload of the day is refused");
    assert.equal(pg.json(`select coalesce(sum(hits), 0) from public.social_rate_counters where user_id = '${user}' and action = 'upload:hour';`), 60,
      "a refused upload is not counted");
    const elsewhere = pg.run(`select public.fitx_social_upload_allowed('user-media', ${q(name(61))});`, as(user));
    assert.ok(elsewhere.ok && elsewhere.stdout.trim() === "f", "another bucket's files are not this policy's");
  });

  test("deleting a post returns its photo paths and takes its likes, comments and notifications with it", () => {
    const doomed = post(A, "Delete me", { count: 2 });
    call(C, `public.fitx_social_set_like('${doomed.id}', true)`);
    call(C, `public.fitx_social_add_comment('${doomed.id}', null, 'nice')`);
    assert.ok(/social_not_found/.test(fails(C, `public.fitx_social_delete_post('${doomed.id}')`).stderr));
    const paths = call(A, `public.fitx_social_delete_post('${doomed.id}')`);
    assert.deepEqual(paths, [`${A}/${doomed.id}/0.webp`, `${A}/${doomed.id}/1.webp`]);
    assert.equal(pg.json(`select count(*) from public.social_likes where post_id = '${doomed.id}';`), 0);
    assert.equal(pg.json(`select count(*) from public.social_notifications where post_id = '${doomed.id}';`), 0);
    pg.exec(`delete from storage.objects where bucket_id = 'social-media' and name = any(array[${paths.map(q).join(",")}]);`, as(A));
    assert.equal(pg.json(`select count(*) from storage.objects where name like '${A}/${doomed.id}/%';`), 0, "the owner may delete their files");
  });

  test("the file runs again without errors, and deleting an account removes its Explore rows", () => {
    const again = pg.runFile(FILE);
    assert.ok(again.ok, again.stderr);
    // Part 2 (20261124100000) builds on this file and restores its own definitions when it runs after it.
    const part2 = pg.runFile(path.join(MIGRATIONS_DIR, "20261124100000_fitx_social_v2_core.sql"));
    assert.ok(part2.ok, part2.stderr);
    pg.exec(`delete from auth.users where id = '${A}';`);
    for (const table of ["social_profiles", "social_posts", "social_likes", "social_comments", "social_follows", "social_notifications", "social_reports"]) {
      assert.equal(pg.json(`select count(*) from public.${table} where user_id = '${A}';`), 0, table);
    }
  });
});
