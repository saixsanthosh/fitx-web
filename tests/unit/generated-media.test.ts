// Every photo a generated manifest (src/data/*-media.ts, written by scripts/media/generate-images.mjs) names
// exists under public/, so no page can ask for a missing file. The superman photo was deleted for showing the
// wrong form; its manifest entry has to go with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const DATA = new URL("../../src/data/", import.meta.url);
const PUBLIC = new URL("../../public/", import.meta.url);
const manifests = readdirSync(DATA).filter((file) => file.endsWith("-media.ts"));

test("every generated media manifest names only files that exist", () => {
  assert.ok(manifests.length >= 3, `found ${manifests.join(", ")}`);
  for (const file of manifests) {
    const sources = [...readFileSync(new URL(file, DATA), "utf8").matchAll(/\bsrc: "\/([^"]+)"/g)].map((match) => match[1]);
    assert.ok(sources.length > 0, `${file} names no photos`);
    const missing = sources.filter((source) => !existsSync(new URL(source, PUBLIC)));
    assert.deepEqual(missing, [], `${file} names missing files`);
  }
});

test("superman has no photo until a correct one exists", () => {
  assert.doesNotMatch(readFileSync(new URL("home-workout-2-media.ts", DATA), "utf8"), /superman/);
  assert.equal(existsSync(new URL("media/home-workout-2/superman.webp", PUBLIC)), false);
});
