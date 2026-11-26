// The same mistake as Finish workout and Abandon (release 3 re-check, D5), on the live workout itself: ticking an
// exercise's last open set moves the page on to the next exercise with sets to do, and the set list that held focus
// (its Complete set button) is replaced by that exercise's, so keyboard focus fell to the page body. The next
// exercise's name now takes focus, without scrolling a touch or mouse user's page. The page is JSX, which
// `node --test` cannot render, so its wiring is read from the source.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { exerciseAfterTick, tickMovesOn, type ProgressSet } from "@/app/(dashboard)/workouts/active/_lib/session-progress";

const DONE = "2026-11-26T09:00:00.000Z";
const set = (n: number, done = false): ProgressSet => ({ id: `s${n}`, set_number: n, completed_at: done ? DONE : null, target_reps: 10 });
const page = readFileSync("src/app/(dashboard)/workouts/active/page.tsx", "utf8");

describe("tickMovesOn: whether a tick moves the page on to another exercise", () => {
  test("only when the ticked exercise has nothing left to do and another exercise has", () => {
    const firstDone = [{ sets: [set(1, true), set(2, true)] }, { sets: [set(1)] }];
    assert.equal(tickMovesOn(firstDone, 0, 0), true);
    assert.equal(exerciseAfterTick(firstDone, 0), 1, "the same rule as the move itself");
    assert.equal(tickMovesOn([{ sets: [set(1, true), set(2)] }, { sets: [set(1)] }], 0, 0), false, "a set left here: the page stays");
    assert.equal(tickMovesOn([{ sets: [set(1, true)] }, { sets: [set(1, true)] }], 0, 0), false, "the workout's last set: the page stays");
    assert.equal(tickMovesOn([{ sets: [set(1)] }, { sets: [set(1, true)] }], 1, 1), true, "back to an earlier exercise with sets to do");
  });

  test("not when the member had moved to another exercise while the set saved (the page then stays there)", () => {
    const firstDone = [{ sets: [set(1, true)] }, { sets: [set(1)] }, { sets: [set(1)] }];
    assert.equal(tickMovesOn(firstDone, 0, 2), false);
    // The page shows the last exercise for an index past the end, and so does this rule.
    assert.equal(tickMovesOn([{ sets: [set(1)] }, { sets: [set(1, true)] }], 1, 9), true);
  });

  test("an exercise no longer in the workout (-1), or no exercises", () => {
    assert.equal(tickMovesOn([{ sets: [set(1, true)] }, { sets: [set(1)] }], -1, 0), false);
    assert.equal(tickMovesOn([], 0, 0), false);
  });
});

describe("the live workout hands focus to the next exercise's name", () => {
  test("a tick that moves the page on asks for it, with the exercises as saved and the exercise last shown", () => {
    const save = page.slice(page.indexOf("  async function saveSet("), page.indexOf("  async function addSet("));
    assert.match(save, /const index = nextExercises\.findIndex\(\(item\) => item\.id === exerciseId\);\n\s+if \(tickMovesOn\(nextExercises, index, exerciseIndexRef\.current\)\) setMovedOn\(\(value\) => value \+ 1\);\n\s+setExerciseIndex\(\(current\) => \(index >= 0 && Math\.max\(0, Math\.min\(current, nextExercises\.length - 1\)\) === index \? exerciseAfterTick\(nextExercises, index\) : current\)\);/);
    // Only for a set ticked as done, after the save worked.
    assert.ok(save.indexOf("if (updated.result.error || !updated.result.data)") < save.indexOf("tickMovesOn("));
    assert.ok(save.indexOf("if (complete) {") < save.indexOf("tickMovesOn(") && save.indexOf("tickMovesOn(") < save.indexOf("} else { setRestEndsAt(null);"));
    assert.match(page, /const exerciseIndexRef = useRef\(exerciseIndex\);\n\s+useEffect\(\(\) => \{ exerciseIndexRef\.current = exerciseIndex; \}, \[exerciseIndex\]\);/);
  });

  test("the name (the exercise section's h2, kept across exercises) takes focus without scrolling a touch user's page", () => {
    assert.match(page, /const \[movedOn, setMovedOn\] = useState\(0\);\n\s+useEffect\(\(\) => \{ if \(movedOn\) focusHeading\(document, "current-exercise-title", \{ keepScroll: true \}\); \}, \[movedOn\]\);/);
    assert.match(page, /<h2 id="current-exercise-title" className="[^"]*">\{currentExercise\.name\}<\/h2>/);
    // The set list is the one that goes: its rows are keyed by the set, so the next exercise's rows are new elements.
    assert.match(readFileSync("src/components/session/SetList.tsx", "utf8"), /<li key=\{set\.id\} aria-current="step"/);
  });
});
