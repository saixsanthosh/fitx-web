// Bug 85 (workouts-7): saving with an empty or spaces-only workout name put "Give this workout a name." at the very
// bottom of the builder, 1,600 px below the field, with the field unmarked and focus left on Save workout.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BUILDER_FIELD_IDS, builderSaveProblem } from "@/app/(dashboard)/workouts/_lib/builder-save";

const base = { title: "Push day", exerciseCount: 4, programmeDay: false, plannedFor: "2026-11-26", originalPlannedFor: null };

describe("what stops a save, and which control it is about", () => {
  test("an empty or spaces-only name is about the name field", () => {
    assert.deepEqual(builderSaveProblem({ ...base, title: "" }), { at: "name", message: "Give this workout a name." });
    assert.deepEqual(builderSaveProblem({ ...base, title: "   " }), { at: "name", message: "Give this workout a name." });
  });

  test("no exercises is said beside the Save buttons; a programme day's moved date under the date field", () => {
    assert.deepEqual(builderSaveProblem({ ...base, exerciseCount: 0 }), { at: "save", message: "Choose at least one exercise for your workout." });
    assert.deepEqual(builderSaveProblem({ ...base, programmeDay: true, originalPlannedFor: "2026-11-27" }), { at: "date", message: "A programme day keeps its date." });
    assert.equal(builderSaveProblem({ ...base, programmeDay: true, originalPlannedFor: "2026-11-26" }), null);
  });

  test("a named workout with exercises can be saved", () => {
    assert.equal(builderSaveProblem(base), null);
  });
});

describe("the builder (JSX, read from the source)", () => {
  const page = readFileSync("src/app/(dashboard)/workouts/page.tsx", "utf8");

  test("the name field is marked invalid, described by the message right under it, and takes focus", () => {
    assert.equal(BUILDER_FIELD_IDS.name.field, "builder-name");
    assert.match(page, /<input id=\{BUILDER_FIELD_IDS\.name\.field\}[\s\S]{0,200}aria-invalid=\{builderProblem\?\.at === "name" \|\| undefined\} aria-describedby=\{builderProblem\?\.at === "name" \? BUILDER_FIELD_IDS\.name\.message : undefined\}/);
    const field = page.slice(page.indexOf("<input id={BUILDER_FIELD_IDS.name.field}"), page.indexOf("<input id={BUILDER_FIELD_IDS.date.field}"));
    assert.match(field, /\{builderProblem\?\.at === "name" && <p id=\{BUILDER_FIELD_IDS\.name\.message\} role="alert"/, "the message follows the field");
    assert.match(page, /if \(problem\.at === "name" \|\| problem\.at === "date"\) setBuilderFieldFocus/);
    assert.match(page, /useEffect\(\(\) => \{ if \(builderFieldFocus\) document\.getElementById\(builderFieldFocus\.id\)\?\.focus\(\); \}, \[builderFieldFocus\]\);/);
  });

  test("a save that fails says so beside the Save buttons, which stay focusable while saving", () => {
    const footer = page.slice(page.indexOf("A save that did not work says so here"), page.indexOf("Save and start\"}"));
    assert.match(footer, /\{builderProblem\?\.at === "save" && <p role="alert"/);
    assert.match(footer, /<button disabled=\{!preview\.length\} aria-disabled=\{saving \|\| undefined\} onClick=\{\(\) => void savePlan\(\)\}/);
    assert.match(page, /async function savePlan\(thenStart = false\) \{\s+\/\/[^\n]*\n\s+if \(saving\) return;/);
    assert.doesNotMatch(page, /\{error && <p role="alert" className="fitx-alert fitx-alert-danger mt-4/, "no message at the bottom of the builder");
  });
});
