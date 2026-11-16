import test from "node:test";
import assert from "node:assert/strict";
import { isMirrorable, parseArgs, SOURCE_PREFIX } from "./mirror-media.mjs";

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
