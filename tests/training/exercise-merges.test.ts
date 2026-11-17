import { test } from "node:test";
import assert from "node:assert/strict";
import { MERGED_EXERCISE_IDS, storedIdsFor, survivingExerciseId, survivingExerciseIds } from "@/lib/training/exercise-merges";

test("a merged duplicate reads as the exercise it was merged into; other ids stay", () => {
  assert.equal(survivingExerciseId("free-exercise-db-Pushups"), "push_up");
  assert.equal(survivingExerciseId("push_up"), "push_up");
  assert.equal(survivingExerciseId("free-exercise-db-Burpee"), "free-exercise-db-Burpee");
  assert.equal(survivingExerciseId("constructor"), "constructor", "only the map's own keys count");
  assert.equal(Object.keys(MERGED_EXERCISE_IDS).length, 15);
});

test("saved and recent lists show each exercise once, in their order", () => {
  assert.deepEqual(survivingExerciseIds(["free-exercise-db-Plank", "bench_press", "plank", "free-exercise-db-Pullups"]), ["plank", "bench_press", "pull_up"]);
});

test("un-saving an exercise finds every stored id for it, a merged duplicate's included", () => {
  const stored = ["free-exercise-db-Pushups", "bench_press", "push_up"];
  assert.deepEqual(storedIdsFor(stored, "push_up"), ["free-exercise-db-Pushups", "push_up"]);
  assert.deepEqual(storedIdsFor(stored, "bench_press"), ["bench_press"]);
  assert.deepEqual(storedIdsFor(stored, "plank"), [], "not saved: saving adds it");
});
