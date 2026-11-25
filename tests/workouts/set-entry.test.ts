// Bug 48 (workouts-5): a set's boxes are checked one by one, and the message names the box at fault. 2,500 kg with
// 12 reps used to be refused with "Enter a positive rep count or duration…".
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { SET_LIMITS, plausibleWeight, readSetEntry, setEntryProblem } from "@/app/(dashboard)/workouts/active/_lib/set-entry";
import { describeNextStep, stepAfterRest } from "@/app/(dashboard)/workouts/active/_lib/session-progress";

const draft = (draftWeight: string, draftReps: string, draftDuration = "") => ({ draftWeight, draftReps, draftDuration });
const check = (weight: string, reps: string, options: { complete?: boolean; timed?: boolean; duration?: string; timedSupported?: boolean } = {}) =>
  setEntryProblem(readSetEntry(draft(weight, reps, options.duration ?? ""), options.timedSupported ?? true), { complete: options.complete ?? true, timed: options.timed ?? false });

describe("a set's weight", () => {
  test("over 2,000 kg is refused with a message about the weight, though reps are filled in", () => {
    for (const weight of ["2500", "2000.5"]) {
      const problem = check(weight, "12");
      assert.equal(problem?.field, "draftWeight", weight);
      assert.equal(problem?.message, "The weight must be 2,000 kg or less.");
      assert.ok(!/rep/i.test(problem?.message ?? ""), "nothing about reps");
    }
  });

  test("the limit itself, a decimal and an empty box (no weight) are fine", () => {
    for (const weight of ["2000", "42.5", "", "0"]) assert.equal(check(weight, "8"), null, weight);
    assert.equal(SET_LIMITS.weightKg, 2000);
  });

  test("below 0 is refused for the weight", () => {
    assert.deepEqual(check("-5", "8"), { field: "draftWeight", message: "The weight can’t be below 0 kg." });
  });
});

describe("reps and seconds", () => {
  test("reps outside 0 to 500, or not whole, name the reps", () => {
    assert.deepEqual(check("40", "501"), { field: "draftReps", message: "Reps must be 500 or fewer." });
    assert.deepEqual(check("40", "8.5"), { field: "draftReps", message: "Enter reps as a whole number, such as 8." });
    assert.deepEqual(check("40", "-1"), { field: "draftReps", message: "Reps can’t be below 0." });
  });

  test("seconds over a day, or not whole, name the seconds", () => {
    assert.equal(check("", "", { timed: true, duration: "86401" })?.field, "draftDuration");
    assert.match(check("", "", { timed: true, duration: "86401" })?.message ?? "", /86,400 seconds/);
    assert.equal(check("", "", { timed: true, duration: "30.5" })?.message, "Enter the time as whole seconds, such as 45.");
    assert.equal(check("", "", { timed: true, duration: "86400" }), null);
  });

  test("the weight is checked first, then reps, then seconds", () => {
    assert.equal(check("2500", "501")?.field, "draftWeight");
    assert.equal(check("40", "501", { duration: "90000" })?.field, "draftReps");
  });
});

describe("ticking a set with nothing done", () => {
  test("a reps movement asks for the reps; a timed one for the seconds", () => {
    assert.deepEqual(check("40", "0"), { field: "draftReps", message: "Enter your reps before completing this set." });
    assert.deepEqual(check("", "", { timed: true }), { field: "draftDuration", message: "Enter the seconds you did before logging this set." });
    assert.equal(check("", "", { timed: true, duration: "45" }), null);
  });

  test("saving without ticking (marking a set incomplete) needs no work in it", () => {
    assert.equal(check("40", "0", { complete: false }), null);
  });

  test("without the seconds column, typed seconds are not counted", () => {
    assert.equal(readSetEntry(draft("40", "8", "45"), false).duration, 0);
    assert.equal(check("40", "0", { duration: "45", timedSupported: false })?.field, "draftReps");
  });
});

describe("Up next repeats only a weight the set could be saved with", () => {
  test("plausibleWeight", () => {
    assert.equal(plausibleWeight("60"), 60);
    for (const typed of ["2500", "0", "", "-2", undefined]) assert.equal(plausibleWeight(typed), null, String(typed));
  });

  test("after 2,500 kg is refused, the rest card's Up next leaves the weight out", () => {
    const set = (n: number, done: boolean, draftWeight: string) => ({ id: `s${n}`, set_number: n, completed_at: done ? "2026-11-25T10:00:00Z" : null, target_reps: 8, draftWeight });
    const exercises = [{ id: "e1", name: "Push-Up Wide", exercise_id: "push_up_wide", reps_min: 8, reps_max: 8, rest_seconds: 90, target_weight_kg: null, target_duration_seconds: null, sets: [set(1, true, "0"), set(2, false, "2500"), set(3, false, "")] }];
    assert.deepEqual(describeNextStep(stepAfterRest(exercises, 0), exercises), { title: "Set 2 of 3", detail: "8 reps" });
    exercises[0].sets[1].draftWeight = "25";
    assert.deepEqual(describeNextStep(stepAfterRest(exercises, 0), exercises), { title: "Set 2 of 3", detail: "8 reps · 25 kg" });
  });
});
