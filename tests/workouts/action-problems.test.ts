// Bug 11 (workouts-2): the live workout's messages show beside the control that was used. "Finish workout" with no
// ticked set, and a refused set, used to add one alert under the page heading, 400 to 1,400 px out of view.
// The page and SetList are JSX, which `node --test` cannot render, so where they put each message is read from the
// source; the ids that tie a set's message to its boxes are pure and tested directly.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setInputId, setProblemId } from "@/app/(dashboard)/workouts/active/_lib/set-entry";

const page = readFileSync("src/app/(dashboard)/workouts/active/page.tsx", "utf8");
const setList = readFileSync("src/components/session/SetList.tsx", "utf8");

describe("a refused set", () => {
  test("each box has its own id, and the message one the boxes point to", () => {
    const ids = ["draftWeight", "draftReps", "draftDuration"].map((field) => setInputId("s1", field as "draftWeight"));
    assert.deepEqual(ids, ["set-s1-weight", "set-s1-reps", "set-s1-seconds"]);
    assert.notEqual(setInputId("s1", "draftReps"), setInputId("s2", "draftReps"));
    assert.equal(setProblemId("s1"), "set-s1-problem");
  });

  test("the message is in the set's own row, right before its Complete button, and marks the box at fault", () => {
    assert.match(setList, /id=\{setInputId\(set\.id, field\)\}/);
    assert.match(setList, /aria-invalid=\{invalid \|\| undefined\}\s+aria-describedby=\{invalid \? problemId : undefined\}/);
    assert.match(setList, /\{message\}\s+\{toggle\(true\)\}/, "the current set: message, then Complete set");
    assert.match(setList, /\{toggle\(false\)\}\s+\{message\}/, "another set: its check button, then the message");
    assert.match(setList, /<p key="problem" id=\{problemId\} role="alert"/);
  });

  test("the page sends a set's problem to that set and moves focus to the box at fault", () => {
    assert.match(page, /setProblem\(\{ at: "set", setId: set\.id, field: entryProblem\.field, message: entryProblem\.message \}\)/);
    assert.match(page, /setFocusBox\(\(current\) => \(\{ id: setInputId\(set\.id, entryProblem\.field\)/);
    assert.match(page, /problem=\{problem\?\.at === "set" \? problem : null\}/);
  });
});

describe("every other message sits beside its control", () => {
  test("nothing is announced under the page heading any more; only opening the session uses the page-wide message", () => {
    assert.doesNotMatch(page, /\{error && <p role="alert"/);
    const pageErrors = [...page.matchAll(/setError\("([^"]+)"\)/g)].map((match) => match[1]);
    assert.ok(pageErrors.length >= 5 && pageErrors.every((text) => /loaded|found|connected|Sign in/.test(text)), pageErrors.join(" | "));
  });

  test("Finish and Abandon: right above the buttons", () => {
    const finish = page.slice(page.indexOf("Finish and Abandon say why"), page.indexOf("Finish workout\"}"));
    assert.match(finish, /problem\?\.at === "finish" && <p role="alert"/);
    assert.ok(finish.indexOf('problem?.at === "finish"') < finish.indexOf("abandonWorkout()"), "the message comes before the buttons");
    assert.match(page, /if \(!validSets\.length\) \{ setProblem\(\{ at: "finish", message: "Complete at least one set before finishing your workout\." \}\)/);
  });

  test("Pause and Resume in the clock, Resume workout under the paused banner, Swap and Add set under their rows", () => {
    assert.match(page, /\{problem\?\.at === "clock" && <p role="alert"[^\n]*\n\s+<\/section>/, "inside the clock section");
    assert.match(page, /\{paused && problem\?\.at === "banner" && <p role="alert"/);
    assert.match(page, /togglePause\("banner"\)/);
    assert.match(page, /\{problem\?\.at === "swap" && <p role="alert"/);
    assert.match(page, /\{problem\?\.at === "add-set" && <p role="alert"/);
  });
});
