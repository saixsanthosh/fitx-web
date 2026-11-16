import { test } from "node:test";
import assert from "node:assert/strict";
import { draftRepsFor, isLiftSet, isTimedPrescription, liftedVolume, setTargetReps, swappedPrescription } from "@/lib/training/sets";

const bench = { reps_min: 8, reps_max: 12, target_duration_seconds: null };
const plank = { reps_min: 1, reps_max: 1, target_duration_seconds: 40 };

test("a movement with a target in seconds is timed; one without is not", () => {
  assert.equal(isTimedPrescription(plank), true);
  assert.equal(isTimedPrescription(bench), false);
  assert.equal(isTimedPrescription({ target_duration_seconds: undefined }), false, "a database without the target columns has no timed movements");
});

test("new sets aim for the middle of the rep range; a timed movement's sets have no rep target", () => {
  assert.equal(setTargetReps(bench), 10);
  assert.equal(setTargetReps({ reps_min: 8, reps_max: 9, target_duration_seconds: null }), 9, "a half rounds up, as in the database (round(8.5) = 9)");
  assert.equal(setTargetReps(plank), null);
});

test("the reps field starts with the rep target, empty for a timed movement, and shows what was logged", () => {
  assert.equal(draftRepsFor({ reps: null, target_reps: 10 }, false), "10");
  assert.equal(draftRepsFor({ reps: null, target_reps: null }, false), "");
  assert.equal(draftRepsFor({ reps: null, target_reps: 1 }, true), "", "a session started before this fix still has target 1 on its holds");
  assert.equal(draftRepsFor({ reps: 7, target_reps: 10 }, false), "7");
  assert.equal(draftRepsFor({ reps: 3, target_reps: null }, true), "3", "reps typed for a timed set are kept");
});

test("only rep sets of a rep movement count as lifts", () => {
  assert.equal(isLiftSet({ reps: 8, duration_seconds: null }), true);
  assert.equal(isLiftSet({ reps: 8 }), true, "a database without set durations");
  assert.equal(isLiftSet({ reps: 0, duration_seconds: null }), false);
  assert.equal(isLiftSet({ reps: null, duration_seconds: 40 }), false);
  assert.equal(isLiftSet({ reps: 1, duration_seconds: 40 }), false, "a plank logged as 1 rep and 40 s is a hold, not a lift");
  assert.equal(isLiftSet({ reps: 12, duration_seconds: null }, true), false, "reps typed into a timed movement");
});

test("volume adds weight × reps over the lifts only", () => {
  const sets = [
    { reps: 8, weight_kg: 60, duration_seconds: null },
    { reps: 6, weight_kg: 70, duration_seconds: null },
    { reps: 1, weight_kg: 20, duration_seconds: 40 },
    { reps: null, weight_kg: 0, duration_seconds: 30 },
  ];
  assert.equal(liftedVolume(sets), 8 * 60 + 6 * 70);
  assert.equal(liftedVolume(sets, true), 0, "a timed movement adds no kilograms");
  assert.equal(liftedVolume([]), 0);
});

test("a swap keeps reps and time for the same type of movement, and takes the new movement's for the other type", () => {
  const pushUp = { prescription_type: "reps", reps_min: 10, reps_max: 15, default_duration_seconds: null };
  const sidePlank = { prescription_type: "time", reps_min: 1, reps_max: 1, default_duration_seconds: 30 };
  const hold = { prescription_type: "time", reps_min: 8, reps_max: 12, default_duration_seconds: null };
  assert.deepEqual(swappedPrescription(bench, pushUp), { reps_min: 8, reps_max: 12, target_duration_seconds: null }, "rep for rep: the user's range stays");
  assert.deepEqual(swappedPrescription(plank, sidePlank), { reps_min: 1, reps_max: 1, target_duration_seconds: 40 }, "hold for hold: the seconds stay");
  assert.deepEqual(swappedPrescription(plank, pushUp), { reps_min: 10, reps_max: 15, target_duration_seconds: null }, "a hold for push-ups: no 1-rep target");
  assert.deepEqual(swappedPrescription(bench, sidePlank), { reps_min: 1, reps_max: 1, target_duration_seconds: 30 }, "bench for a hold: its seconds, no rep target");
  assert.equal(swappedPrescription(bench, hold).target_duration_seconds, 30, "30 s when the catalogue has no default");
  assert.equal(setTargetReps(swappedPrescription(plank, pushUp)), 13);
  assert.equal(setTargetReps(swappedPrescription(bench, sidePlank)), null);
});
