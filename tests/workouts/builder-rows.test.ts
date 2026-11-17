import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_PLAN_EXERCISES, moveRow, plannedFrom, removeRow, selectedIds, swapRow, toggleRow, type PlannedExercise } from "@/app/(dashboard)/workouts/_lib/builder-rows";
import type { CatalogExercise } from "@/lib/training/catalog";

function exercise(id: string, overrides: Partial<CatalogExercise> = {}): CatalogExercise {
  return {
    id, name: id, primary_muscle: "chest", secondary_muscles: [], muscle_group: "chest", category: "strength", mechanic: "compound",
    required_equipment: [], locations: ["gym", "home"], difficulty: "beginner", movement_pattern: "push", prescription_type: "reps",
    recommended_sets: 3, reps_min: 8, reps_max: 12, rest_seconds: 90, default_duration_seconds: null, alternatives: [], source_ref: null, curated: true,
    ...overrides,
  };
}

const bench = exercise("bench");
const row = exercise("row", { reps_min: 10, reps_max: 15 });
const squat = exercise("squat", { reps_min: 5, reps_max: 5, rest_seconds: 180 });
const fly = exercise("fly");
const curl = exercise("curl");
const plank = exercise("plank", { prescription_type: "time", default_duration_seconds: 45, rest_seconds: 45 });

/** Rows built by ticking, in that order. */
function ticked(...exercises: CatalogExercise[]): PlannedExercise[] {
  return exercises.reduce<PlannedExercise[]>((rows, item) => toggleRow(rows, item)!, []);
}
const order = (rows: readonly PlannedExercise[]) => rows.map((item) => `${item.sort_order}:${item.exercise.id}`);

test("a swap after a reorder replaces the row that was swapped, and later ticks keep the plan intact", () => {
  // The reviewed case: move the last row up, swap it, then tick another exercise.
  let rows = ticked(bench, row, squat);
  rows = moveRow(rows, 2, -1);
  assert.deepEqual(order(rows), ["0:bench", "1:squat", "2:row"]);
  rows = swapRow(rows, 1, fly);
  assert.deepEqual(order(rows), ["0:bench", "1:fly", "2:row"]);
  assert.deepEqual(selectedIds(rows), ["bench", "fly", "row"], "the ticked list follows the rows");
  rows = toggleRow(rows, curl)!;
  assert.deepEqual(order(rows), ["0:bench", "1:fly", "2:row", "3:curl"], "nothing dropped, the swapped-out squat does not come back");
  rows = toggleRow(rows, fly)!;
  assert.deepEqual(order(rows), ["0:bench", "1:row", "2:curl"], "unticking removes only that row");
});

test("ticking keeps the user's edits and order; a new exercise starts with its own prescription", () => {
  let rows = ticked(bench, row);
  rows = rows.map((item) => (item.exercise.id === "row" ? { ...item, target_sets: 5, reps_min: 6, reps_max: 6 } : item));
  rows = moveRow(rows, 1, -1);
  rows = toggleRow(rows, squat)!;
  assert.deepEqual(order(rows), ["0:row", "1:bench", "2:squat"]);
  assert.deepEqual([rows[0].target_sets, rows[0].reps_min, rows[0].reps_max], [5, 6, 6]);
  assert.deepEqual([rows[2].target_sets, rows[2].reps_min, rows[2].reps_max, rows[2].rest_seconds], [3, 5, 5, 180]);
});

test("a plan holds at most twenty exercises", () => {
  const many = Array.from({ length: MAX_PLAN_EXERCISES }, (_, index) => exercise(`ex-${index}`));
  const full = ticked(...many);
  assert.equal(full.length, MAX_PLAN_EXERCISES);
  assert.equal(toggleRow(full, curl), null);
  assert.equal(toggleRow(full, many[3])!.length, MAX_PLAN_EXERCISES - 1, "removing still works when full");
});

test("moving past either end changes nothing; removing renumbers the rest", () => {
  const rows = ticked(bench, row, squat);
  assert.deepEqual(order(moveRow(rows, 0, -1)), order(rows));
  assert.deepEqual(order(moveRow(rows, 2, 1)), order(rows));
  assert.deepEqual(order(removeRow(rows, "bench")), ["0:row", "1:squat"]);
});

test("a swap keeps sets and rest; reps or time follow the new movement only when its type differs", () => {
  const edited = ticked(bench).map((item) => ({ ...item, target_sets: 4, rest_seconds: 120, reps_min: 5, reps_max: 6 }));
  const sameType = swapRow(edited, 0, row)[0];
  assert.deepEqual([sameType.exercise.id, sameType.target_sets, sameType.rest_seconds, sameType.reps_min, sameType.reps_max, sameType.target_duration_seconds], ["row", 4, 120, 5, 6, null]);
  const toHold = swapRow(edited, 0, plank)[0];
  assert.deepEqual([toHold.exercise.id, toHold.target_sets, toHold.rest_seconds, toHold.reps_min, toHold.reps_max, toHold.target_duration_seconds], ["plank", 4, 120, 1, 1, 45]);
  const backToReps = swapRow([toHold], 0, row)[0];
  assert.deepEqual([backToReps.reps_min, backToReps.reps_max, backToReps.target_duration_seconds], [10, 15, null]);
});

test("a timed exercise is added with its default seconds, or 30 when the catalogue has none", () => {
  assert.equal(plannedFrom(plank, 0).target_duration_seconds, 45);
  assert.equal(plannedFrom(exercise("hold", { prescription_type: "time" }), 0).target_duration_seconds, 30);
  assert.equal(plannedFrom(bench, 0).target_duration_seconds, null);
});
