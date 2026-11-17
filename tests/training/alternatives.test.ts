import { test } from "node:test";
import assert from "node:assert/strict";
import { groupAlternatives } from "@/lib/training/alternatives";
import type { CatalogExercise } from "@/lib/training/catalog";
import type { Substitute } from "@/lib/training/substitutions";

function exercise(id: string, over: Partial<CatalogExercise> = {}): CatalogExercise {
  return {
    id, name: id, primary_muscle: "chest", secondary_muscles: [], muscle_group: "chest", category: "strength", mechanic: "compound",
    required_equipment: [], locations: ["home", "gym"], difficulty: "intermediate", movement_pattern: "push", prescription_type: "reps",
    recommended_sets: 3, reps_min: 8, reps_max: 12, rest_seconds: 90, default_duration_seconds: null, alternatives: [], source_ref: null, curated: true,
    ...over,
  };
}
const sub = (e: CatalogExercise, missing: string[] = [], reasons: string[] = ["Same muscles"]): Substitute => ({ exercise: e, score: 1, reasons, missing });

const target = exercise("bench", { required_equipment: ["barbell"], locations: ["gym"] });

test("groups appear in a fixed order, once each, and empty groups are hidden", () => {
  const groups = groupAlternatives(target, [
    sub(exercise("dumbbell-press", { required_equipment: ["dumbbells"] })),
    sub(exercise("push-up")),
    sub(exercise("incline-push-up", { difficulty: "beginner" })),
    sub(exercise("cable-fly", { required_equipment: ["cable_machine"], locations: ["gym"] }), ["cable_machine"]),
  ]);
  assert.deepEqual(groups.map((group) => group.key), ["equipment", "same_muscle", "level", "home"]);
  assert.deepEqual(groups.map((group) => group.items.map((item) => item.exercise.id)), [["dumbbell-press"], ["cable-fly"], ["incline-push-up"], ["push-up"]]);
  assert.equal(groups[2].items[0].levelNote, "easier");
  assert.equal(groups[2].items[0].reasons[0], "Easier");
});

test("a group with nothing in it is left out", () => {
  const groups = groupAlternatives(target, [sub(exercise("dumbbell-press", { required_equipment: ["dumbbells"] }))]);
  assert.deepEqual(groups.map((group) => group.key), ["equipment"]);
  assert.deepEqual(groupAlternatives(target, []), []);
});

test("the target itself and duplicates are dropped; perGroup caps each list", () => {
  const items = ["a", "b", "c", "d", "e"].map((id) => sub(exercise(id, { required_equipment: ["dumbbells"] })));
  const groups = groupAlternatives(target, [sub(target), ...items, items[0]], 3);
  assert.deepEqual(groups[0].items.map((item) => item.exercise.id), ["a", "b", "c"]);
});

test("harder exercises are flagged", () => {
  const groups = groupAlternatives(target, [sub(exercise("weighted-dip", { difficulty: "advanced" }))]);
  assert.equal(groups[0].items[0].levelNote, "harder");
});
