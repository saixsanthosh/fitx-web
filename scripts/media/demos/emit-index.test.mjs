// emit-index.mjs: the index the app reads is built only from accepted.json, and the app parses it the same way.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ACCEPTED_FILE, CAPTION_MAX, CREDIT, INDEX_FILE, INDEX_VERSION, MAX_BYTES, buildIndex, checkPublished, serialiseIndex, sha256, validateAccepted } from "./emit-index.mjs";
import { DEMO_ATTRIBUTION, DEMO_CAPTION_MAX, DEMO_INDEX_VERSION, DEMO_LICENSE, parseDemoIndex } from "../../../src/lib/training/media.ts";
import { DEMO_MAX_BYTES } from "../generate-demos.mjs";

const entry = (id, model, frame, extra = {}) => ({ id, model, frame, sha256: "a".repeat(64), bytes: 30000, caption: `${id} ${model} ${frame}`, ...extra });

test("the same constants as the app and the generator", () => {
  assert.equal(INDEX_VERSION, DEMO_INDEX_VERSION);
  assert.deepEqual(CREDIT, { attribution: DEMO_ATTRIBUTION, license: DEMO_LICENSE });
  assert.equal(CAPTION_MAX, DEMO_CAPTION_MAX);
  assert.equal(MAX_BYTES, DEMO_MAX_BYTES);
});

test("a model is listed only with both frames accepted; the app parses the index into the same entries", () => {
  const accepted = { version: 1, items: [entry("push_up", "male", 0), entry("push_up", "male", 1), entry("push_up", "female", 0), entry("plank", "female", 1)] };
  const index = buildIndex(accepted);
  assert.deepEqual(Object.keys(index.items), ["push_up"]);
  assert.deepEqual(index.items.push_up, { male: { frames: ["/media/demos/male/push_up/0.webp", "/media/demos/male/push_up/1.webp"], captions: ["push_up male 0", "push_up male 1"] } });
  const parsed = parseDemoIndex(JSON.parse(serialiseIndex(index)));
  assert.deepEqual(parsed.models.get("push_up"), ["male"]);
  assert.deepEqual(parsed.items.get("push_up").male.captions, ["push_up male 0", "push_up male 1"]);
});

test("accepted.json is checked: ids, models, frames, hashes, the byte target and caption length", () => {
  assert.throws(() => validateAccepted({ version: 1, items: [entry("../x", "male", 0)] }), /bad exercise id/);
  assert.throws(() => validateAccepted({ version: 1, items: [entry("a", "other", 0)] }), /male or female/);
  assert.throws(() => validateAccepted({ version: 1, items: [entry("a", "male", 2)] }), /frame must be 0 or 1/);
  assert.throws(() => validateAccepted({ version: 1, items: [entry("a", "male", 0, { bytes: MAX_BYTES + 1 })] }), /at most/);
  assert.throws(() => validateAccepted({ version: 1, items: [entry("a", "male", 0, { caption: "x".repeat(121) })] }), /caption/);
  assert.throws(() => validateAccepted({ version: 1, items: [entry("a", "male", 0), entry("a", "male", 0)] }), /listed twice/);
});

test("the committed index and files match accepted.json", () => {
  const accepted = JSON.parse(readFileSync(ACCEPTED_FILE, "utf8"));
  assert.deepEqual(checkPublished({ accepted, indexText: readFileSync(INDEX_FILE, "utf8") }), []);
});

test("shipped captions are short FITX lines about the pose on screen, not catalogue sentences", () => {
  // Each caption names the frame's own pose (DemoLoop shows it with that frame), in a few plain words: no instruction
  // sentences copied from the Free Exercise DB, no full stops, short enough to stay on one or two lines at 390 px.
  const accepted = JSON.parse(readFileSync(ACCEPTED_FILE, "utf8"));
  for (const item of accepted.items) {
    const where = `${item.id}/${item.model}/${item.frame}`;
    assert.ok(item.caption.length > 0 && item.caption.length <= 40, `${where}: "${item.caption}" is ${item.caption.length} characters (at most 40)`);
    assert.doesNotMatch(item.caption, /[.!?]$/, `${where}: no closing full stop`);
    assert.doesNotMatch(item.caption, /\b(inhale|exhale|breathe|you|your torso|original position)\b/i, `${where}: describes the pose, not the instructions`);
  }
});

test("the check finds a missing, changed or unlisted file", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "fitx-demo-index-"));
  try {
    const data = Buffer.from("webp bytes");
    const accepted = { version: 1, items: [0, 1].map((frame) => entry("plank", "female", frame, { sha256: sha256(data), bytes: data.length })) };
    const indexText = serialiseIndex(buildIndex(accepted));
    assert.deepEqual(checkPublished({ accepted, dir, indexText }), ["/media/demos/female/plank/0.webp is missing", "/media/demos/female/plank/1.webp is missing"]);
    mkdirSync(path.join(dir, "female/plank"), { recursive: true });
    writeFileSync(path.join(dir, "female/plank/0.webp"), data);
    writeFileSync(path.join(dir, "female/plank/1.webp"), "other");
    mkdirSync(path.join(dir, "male/plank"), { recursive: true });
    writeFileSync(path.join(dir, "male/plank/0.webp"), data);
    assert.deepEqual(checkPublished({ accepted, dir, indexText }), ["/media/demos/female/plank/1.webp differs from accepted.json", "/media/demos/male/plank/0.webp is not in the index (not accepted, or its other frame is missing)"]);
    assert.match(checkPublished({ accepted, dir, indexText: "{}" })[0], /index.json does not match/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
