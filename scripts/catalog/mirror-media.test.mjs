import test from "node:test";
import assert from "node:assert/strict";
import { connectionFrom, isMirrorable, parseArgs, SOURCE_PREFIX } from "./mirror-media.mjs";

const row = (overrides = {}) => ({ id: "1", exercise_id: "free-exercise-db-Pushups", kind: "still", mirrored_at: null, source_url: `${SOURCE_PREFIX}Pushups/0.jpg`, storage_path: "free-exercise-db/Pushups/0.jpg", ...overrides });

test("only pinned-revision stills with a safe storage path are copied", () => {
  assert.equal(isMirrorable(row()), true);
  assert.equal(isMirrorable(row({ mirrored_at: "2026-11-17T00:00:00Z" })), false, "already copied");
  assert.equal(isMirrorable(row({ kind: "video_loop" })), false);
  assert.equal(isMirrorable(row({ source_url: "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/Pushups/0.jpg" })), false, "unpinned revision");
  assert.equal(isMirrorable(row({ source_url: "https://example.com/Pushups/0.jpg" })), false);
  assert.equal(isMirrorable(row({ source_url: `${SOURCE_PREFIX}../secrets/0.jpg` })), false);
  assert.equal(isMirrorable(row({ storage_path: "../other-bucket/0.jpg" })), false);
  assert.equal(isMirrorable(row({ storage_path: "free-exercise-db/Pushups/0.png" })), false);
  assert.equal(isMirrorable(null), false);
});

test("options are strict", () => {
  assert.deepEqual(parseArgs([]), { dryRun: false, limit: Infinity });
  assert.deepEqual(parseArgs(["--dry-run", "--limit", "25"]), { dryRun: true, limit: 25 });
  assert.throws(() => parseArgs(["--limit", "0"]));
  assert.throws(() => parseArgs(["--force"]));
});

test("the project URL and key are read under the app's names or the script's, the secret key first", () => {
  const url = "https://project.supabase.co";
  assert.deepEqual(connectionFrom({ SUPABASE_URL: url, SUPABASE_SECRET_KEY: "secret" }), { url, key: "secret" });
  assert.deepEqual(connectionFrom({ NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: "legacy" }), { url, key: "legacy" }, "the app's .env names");
  assert.deepEqual(connectionFrom({ SUPABASE_URL: url, SUPABASE_SECRET_KEY: "secret", SUPABASE_SERVICE_ROLE_KEY: "legacy" }).key, "secret");
  assert.deepEqual(connectionFrom({ SUPABASE_URL: url, SUPABASE_SECRET_KEY: "  ", SUPABASE_SERVICE_ROLE_KEY: "legacy" }).key, "legacy", "a blank secret key counts as unset");
  assert.throws(() => connectionFrom({ SUPABASE_URL: url }), /SUPABASE_SECRET_KEY \(or SUPABASE_SERVICE_ROLE_KEY\)/);
  assert.throws(() => connectionFrom({ SUPABASE_SECRET_KEY: "sb_secret_do_not_print" }), (error) => /SUPABASE_URL/.test(error.message) && !error.message.includes("sb_secret_do_not_print"), "names what is missing, never prints the key");
});
