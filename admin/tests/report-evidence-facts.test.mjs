// "What was reported" on an Explore report (BUGS.md 67, admin-6): every fact in Admin's own words. A message's
// "Sent" is an IST time like every other time in Admin, never the raw database value; stored codes (a community's
// visibility, a challenge's kind and what it counts) read as their labels.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const { evidenceFacts } = await importTypeScriptModule("src/lib/explore-evidence-facts.ts");

test("a message report: the sender and the IST send time", () => {
  assert.deepEqual(evidenceFacts("message", { body: "Buy followers", sender: "asha.rao", created_at: "2026-11-25T15:12:06.677982+00:00" }), [
    { label: "Sender", value: "@asha.rao" },
    { label: "Sent", value: "25 Nov 2026, 8:42 pm IST" },
  ]);
  assert.deepEqual(evidenceFacts("message", { sender: "asha.rao", created_at: "not a time" }), [{ label: "Sender", value: "@asha.rao" }], "a time that cannot be read is left out, never shown raw");
});

test("stored codes read as words; an unknown code is still shown; nothing for no value", () => {
  assert.deepEqual(evidenceFacts("community", { name: "Morning runners", slug: "morning-runners", visibility: "private" }), [
    { label: "Name", value: "Morning runners" },
    { label: "Address", value: "/explore/c/morning-runners" },
    { label: "Visibility", value: "Private" },
  ]);
  assert.deepEqual(evidenceFacts("challenge", { title: "Run 50 km", kind: "monthly", metric: "distance_km" }), [
    { label: "Title", value: "Run 50 km" },
    { label: "Kind", value: "Monthly" },
    { label: "Counts", value: "Distance" },
  ]);
  assert.deepEqual(evidenceFacts("challenge", { title: "Steps", kind: "daily", metric: "steps" }).slice(1), [{ label: "Kind", value: "daily" }, { label: "Counts", value: "steps" }]);
  assert.deepEqual(evidenceFacts("challenge", { title: "  ", kind: null }), []);
});

test("posts, comments, stories and accounts keep their facts", () => {
  assert.deepEqual(evidenceFacts("post", { author: "ben", location: "Cubbon Park", kind: "video" }), [
    { label: "Author", value: "@ben" }, { label: "Place", value: "Cubbon Park" }, { label: "Kind", value: "Video post" },
  ]);
  assert.deepEqual(evidenceFacts("comment", { author: "ben", body: "x" }), [{ label: "Author", value: "@ben" }]);
  assert.deepEqual(evidenceFacts("story", { author: null }), []);
  assert.deepEqual(evidenceFacts("account", { username: "ben", display_name: "Ben K" }), [{ label: "Username", value: "@ben" }, { label: "Name", value: "Ben K" }]);
});

test("the report page draws its facts from evidenceFacts only", async () => {
  const evidence = await readFile(new URL("../src/lib/data/explore-evidence.ts", import.meta.url), "utf8");
  assert.match(evidence, /const facts = evidenceFacts\(targetType, snapshot\);/);
  assert.doesNotMatch(evidence, /push\("Sent"/);
});
