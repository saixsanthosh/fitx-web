import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ProgrammeBrowser draws nothing without a published programme, so the page must not leave its heading behind.
test("the Programme heading shows only with a programme to follow or one already followed", () => {
  const page = readFileSync(new URL("../../src/app/(dashboard)/workouts/page.tsx", import.meta.url), "utf8");
  const browser = readFileSync(new URL("../../src/components/workouts/ProgrammeBrowser.tsx", import.meta.url), "utf8");
  assert.match(browser, /if \(!programmes\.length\) return null;/);
  const guarded = page.match(/\{\(enrolment \|\| gymProgrammes\.length > 0\) && \(\s*<Reveal[^>]*>\s*<Section title="Programme" id="programme">/);
  assert.ok(guarded, "the Programme section is wrapped in the same condition");
  assert.equal(page.match(/<Section title="Programme"/g)?.length, 1);
});
