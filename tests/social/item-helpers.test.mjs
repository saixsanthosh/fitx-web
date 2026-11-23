// Static check (wave-2 brief 3.6): every Explore function, as last defined across the migrations, that reads
// social_posts, social_comments or social_stories must decide what another member sees with an item-level helper
// (fitx_social_sees_post, _sees_comment_row, _sees_story, _post_listed, or a viewer wrapper of them). The functions
// that read only the caller's own rows, or are the helpers themselves, are listed below with the reason.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const DIR = path.resolve(process.cwd(), "supabase/migrations");
const ITEM_HELPERS = /fitx_social_(notification_visible|sees_post|sees_comment_row|sees_story|post_listed|viewer_sees_post|viewer_sees_comment_row|viewer_sees_story)\s*\(/;
const READS = /\b(from|join)\s+public\.social_(posts|comments|stories)\b/;

/** Functions that may read those tables without an item helper, and why. */
const OWNER_ONLY = {
  fitx_social_sees_post: "the helper itself",
  fitx_social_sees_comment_row: "the helper itself",
  fitx_social_sees_story: "the helper itself",
  fitx_social_post_listed: "the helper itself",
  fitx_social_profile: "counts only (the account helper decides; wave-2 brief keeps it account-level)",
  fitx_social_insert_post: "checks the new post id is unused and counts the caller's own videos",
  fitx_social_update_post: "the caller's own post only (p.user_id = the member)",
  fitx_social_delete_post: "the caller's own post only",
  fitx_social_edit_comment: "the caller's own comment only; mentions go through fitx_social_notify_mentions",
  fitx_social_delete_comment: "the caller's own comment, or any on the caller's own post",
  fitx_social_create_story: "the caller's own stories only (the 24-hour count)",
  fitx_social_delete_story: "the caller's own story only",
  fitx_social_view_story: "reads the owner of a story the helper already allowed",
  fitx_social_set_story_like: "reads the owner of a story the helper already allowed",
  fitx_social_story_viewers: "the caller's own story only",
  fitx_social_my_content: "the caller's own posts, stories and comments only",
  fitx_social_delete_all_content: "the caller's own posts, stories and comments only",
  fitx_social_hourly: "the clean-up job (service role, no viewer)",
  fitx_social_suggestions: "reads the caller's own likes and saves; other accounts' topics go through fitx_social_post_listed",
};

/** The last definition of every public fitx_social_* function, in migration order. */
function lastDefinitions() {
  const defs = new Map();
  for (const name of readdirSync(DIR).filter((n) => n.endsWith(".sql") && !/_free_exercise_db_part_|_seed_part_/.test(n)).sort()) {
    const sql = readFileSync(path.join(DIR, name), "utf8");
    for (const match of sql.matchAll(/create\s+or\s+replace\s+function\s+public\.(fitx_social_\w+)\s*\(([\s\S]*?)\$function\$([\s\S]*?)\$function\$/gi)) {
      defs.set(match[1], { file: name, body: match[3] });
    }
  }
  return defs;
}

test("every Explore read of posts, comments or stories for another member uses an item helper", () => {
  const defs = lastDefinitions();
  assert.ok(defs.size > 80, `found ${defs.size} functions`);
  const missing = [];
  for (const [name, { file, body }] of defs) {
    if (!READS.test(body) || name in OWNER_ONLY) continue;
    if (!ITEM_HELPERS.test(body)) missing.push(`${name} (${file})`);
  }
  assert.deepEqual(missing, [], "switch these to an item helper, or list them in OWNER_ONLY with the reason");
});

test("the exempt list names only functions that exist and read those tables", () => {
  const defs = lastDefinitions();
  for (const name of Object.keys(OWNER_ONLY)) {
    assert.ok(defs.has(name), `${name} is not defined`);
    assert.ok(READS.test(defs.get(name).body), `${name} no longer reads posts, comments or stories; remove it from the list`);
  }
});

test("the part-1 read sites the brief names now use the item helpers (their last definition is in wave 2)", () => {
  const defs = lastDefinitions();
  for (const name of ["fitx_social_can_read_object", "fitx_social_can_comment", "fitx_social_post_json", "fitx_social_notify_mentions",
    "fitx_social_report", "fitx_social_set_like", "fitx_social_set_save", "fitx_social_add_comment", "fitx_social_browse", "fitx_social_feed",
    "fitx_social_trending", "fitx_social_search", "fitx_social_post", "fitx_social_saved", "fitx_social_comments", "fitx_social_notifications",
    "fitx_social_notification_visible", "fitx_social_viewer_sees_post", "fitx_social_viewer_sees_comment"]) {
    const def = defs.get(name);
    assert.ok(def, name);
    assert.ok(def.file >= "20261124100000", `${name} is last defined in ${def.file}`);
    assert.ok(ITEM_HELPERS.test(def.body) || /fitx_social_notification_visible\s*\(/.test(def.body), `${name} calls no item helper`);
  }
});

test("security definer Explore functions pin an empty search_path", () => {
  for (const name of readdirSync(DIR).filter((n) => n >= "20261124100000" && n.endsWith(".sql"))) {
    const sql = readFileSync(path.join(DIR, name), "utf8");
    for (const match of sql.matchAll(/create\s+or\s+replace\s+function\s+public\.(\w+)\s*\(([\s\S]*?)as \$function\$/gi)) {
      if (/security definer/i.test(match[2])) assert.match(match[2], /set search_path = ''/, `${name}: ${match[1]}`);
    }
  }
});
