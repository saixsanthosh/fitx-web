// Wave-1 clients keep working between the migration apply and the wave-2 deploy (wave-2 brief 3.6, "Apply before
// deploy"). After every migration in the repo (M1, and M2 and M3 once they exist), this calls every Explore RPC the
// shipped wave-1 client (src/lib/social/api.ts at 8db1bc9) calls, with exactly the named arguments it sends, the way
// PostgREST resolves them (`fn(p_a => …)`, defaulted parameters left out). A call may be refused for a business reason
// (social_not_found and the like), but it must never fail to resolve (42883, 42725 ambiguous) or change its result
// shape. Skipped when the Postgres binaries are not on PATH.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { LocalPostgres, available } from "../support/local-postgres.mjs";

const skip = available() ? false : "Postgres binaries (initdb, pg_ctl, psql) are not installed";
const A = "aaaaaaaa-1111-4000-8000-0000000000a1";
const B = "bbbbbbbb-1111-4000-8000-0000000000b2";
const POST = "0000cccc-1111-4000-8000-000000000001";
const as = (sub) => ({ role: "authenticated", sub });
const q = (text) => (text === null ? "null" : `'${String(text).replace(/'/g, "''")}'`);

/**
 * Every RPC in the shipped wave-1 api.ts, with its named arguments as the client sends them. Values are SQL literals.
 * `shape` checks the result where wave 1 reads it.
 */
const WAVE_1_CALLS = [
  ["fitx_social_me", {}, (r) => r && "profile" in r && "unread" in r && "requests" in r],
  ["fitx_social_username_available", { p_username: q("someone.new") }, (r) => r === true],
  ["fitx_social_save_profile", { p_username: q("asha.compat"), p_display_name: q("Asha"), p_bio: q(""), p_is_private: "false", p_default_comment_policy: q("everyone") },
    (r) => r.username === "asha.compat"],
  ["fitx_social_set_avatar", { p_path: "null" }, (r) => r === null],
  ["fitx_social_profile", { p_username: q("ben.compat") }, (r) => r.profile.username === "ben.compat" && "can_see_posts" in r],
  ["fitx_social_follow", { p_target: q(B) }, (r) => r === "accepted"],
  ["fitx_social_unfollow", { p_target: q(B) }, () => true],
  ["fitx_social_answer_request", { p_follower: q(B), p_accept: "true" }, null, /social_not_found/],
  ["fitx_social_remove_follower", { p_follower: q(B) }, () => true],
  ["fitx_social_set_block", { p_target: q(B), p_block: "false" }, () => true],
  ["fitx_social_set_restrict", { p_target: q(B), p_restrict: "false" }, () => true],
  ["fitx_social_report", { p_target_type: q("account"), p_target_id: q(B), p_reason: q("spam"), p_details: "null" }, (r) => typeof r === "string"],
  ["fitx_social_create_post", { p_post_id: q(POST), p_caption: q("Compat #wave1"), p_location: q(""), p_topics: "'[]'::jsonb", p_comment_policy: q("everyone"),
    p_media: `'${JSON.stringify([{ path: `${A}/${POST}/0.webp`, width: 1200, height: 1500, alt: "" }])}'::jsonb` },
    (r) => r.id === POST && r.kind === "photo" && r.media.length === 1 && r.media[0].kind === "image"],
  ["fitx_social_update_post", { p_post: q(POST), p_caption: q("Edited"), p_location: q(""), p_topics: "'[]'::jsonb", p_comment_policy: q("everyone") }, (r) => r.caption === "Edited"],
  ["fitx_social_set_like", { p_post: q(POST), p_like: "true" }, (r) => r.liked === true && r.like_count === 1],
  ["fitx_social_set_save", { p_post: q(POST), p_save: "true" }, (r) => r === true],
  ["fitx_social_add_comment", { p_post: q(POST), p_parent: "null", p_body: q("Nice") }, (r) => r.body === "Nice"],
  ["fitx_social_feed", { p_before_at: "null", p_before_id: "null", p_limit: "8" }, (r) => Array.isArray(r) && r[0].id === POST],
  ["fitx_social_browse", { p_user: "null", p_tag: q("wave1"), p_topic: "null", p_before_at: "null", p_before_id: "null", p_limit: "18" }, (r) => Array.isArray(r)],
  ["fitx_social_trending", { p_topic: "null", p_days: "7", p_limit: "12", p_offset: "0" }, (r) => Array.isArray(r)],
  ["fitx_social_suggestions", { p_limit: "8" }, (r) => Array.isArray(r)],
  ["fitx_social_search", { p_query: q("ben"), p_limit: "10" }, (r) => Array.isArray(r.accounts) && Array.isArray(r.hashtags)],
  ["fitx_social_post", { p_post: q(POST) }, (r) => r.id === POST],
  ["fitx_social_saved", { p_before_at: "null", p_limit: "18" }, (r) => r[0].id === POST],
  ["fitx_social_comments", { p_post: q(POST), p_after_at: "null", p_after_id: "null", p_limit: "30" }, (r) => r.length === 1],
  ["fitx_social_follow_list", { p_user: q(B), p_kind: q("followers"), p_offset: "0", p_limit: "30" }, (r) => Array.isArray(r)],
  ["fitx_social_requests", {}, (r) => Array.isArray(r)],
  ["fitx_social_notifications", { p_before_at: "null", p_before_id: "null", p_limit: "30" }, (r) => Array.isArray(r)],
  ["fitx_social_mark_read", {}, (r) => typeof r === "number"],
  ["fitx_social_notification_prefs", {}, (r) => ["follows", "follow_requests", "likes", "comments", "mentions"].every((k) => typeof r[k] === "boolean")],
  // The five-argument save resolves to the nine-parameter function (the four new ones default to null).
  ["fitx_social_save_notification_prefs", { p_follows: "true", p_follow_requests: "true", p_likes: "false", p_comments: "true", p_mentions: "true" },
    (r) => r.likes === false && r.stories === true],
  ["fitx_social_safety_lists", {}, (r) => Array.isArray(r.blocked) && Array.isArray(r.restricted)],
  ["fitx_social_edit_comment", null, null],
  ["fitx_social_delete_comment", null, null],
  ["fitx_social_delete_post", { p_post: q(POST) }, (r) => Array.isArray(r) && r[0] === `${A}/${POST}/0.webp`],
];

describe("wave-1 Explore client after the wave-2 migrations", { skip }, () => {
  /** @type {LocalPostgres} */
  let pg;
  before(() => {
    pg = new LocalPostgres().start();
    pg.applyMigrations();
    pg.exec(`insert into auth.users (id, email) values ('${A}', 'a@example.test'), ('${B}', 'b@example.test');
      update public.profiles set date_of_birth = date '1990-01-01' where id in ('${A}', '${B}');`);
    pg.exec(`select public.fitx_social_save_profile('ben.compat', 'Ben', '', false, 'everyone');`, as(B));
  });
  after(() => pg?.stop());

  test("the list covers every RPC the shipped wave-1 api.ts calls", () => {
    const names = new Set(WAVE_1_CALLS.map(([name]) => name));
    for (const name of ["fitx_social_me", "fitx_social_save_notification_prefs", "fitx_social_create_post", "fitx_social_report"]) assert.ok(names.has(name));
    assert.equal(names.size, 35);
  });

  test("every wave-1 call resolves, and gives what wave 1 reads", () => {
    let commentId = null;
    for (const [name, args, shape, refusal] of WAVE_1_CALLS) {
      if (name === "fitx_social_create_post") {
        pg.exec(`insert into storage.objects (bucket_id, name, metadata) values ('social-media', '${A}/${POST}/0.webp', '{"size": 2048}');`, as(A));
      }
      let callArgs = args;
      if (name === "fitx_social_edit_comment") callArgs = { p_comment: q(commentId), p_body: q("Nicer") };
      if (name === "fitx_social_delete_comment") callArgs = { p_comment: q(commentId) };
      const named = Object.entries(callArgs).map(([key, value]) => `${key} => ${value}`).join(", ");
      const result = pg.run(`select to_jsonb(public.${name}(${named}));`, as(A));
      assert.doesNotMatch(result.stderr, /does not exist|is not unique|42883|42725/, `${name}: ${result.stderr}`);
      if (refusal) {
        assert.ok(!result.ok && refusal.test(result.stderr), `${name}: ${result.stderr}`);
        continue;
      }
      assert.ok(result.ok, `${name}: ${result.stderr}`);
      const last = result.stdout.split("\n").filter(Boolean).pop();
      const value = last === undefined ? null : JSON.parse(last);
      if (name === "fitx_social_add_comment") commentId = value.id;
      if (shape) assert.ok(shape(value), `${name} returned ${JSON.stringify(value)}`);
    }
  });

  test("exactly one save_notification_prefs exists, so the five-argument call can never be ambiguous", () => {
    assert.equal(pg.json(`select count(*) from pg_proc where proname = 'fitx_social_save_notification_prefs' and pronamespace = 'public'::regnamespace;`), 1);
  });
});
