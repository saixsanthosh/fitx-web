// Re-check of release 3 (bug 17's re-plan): with Dumbbells off the gym list, a re-planned Push day ended with Triceps
// Pushdown and then "Triceps Pushdown - Rope Attachment", two variants of one movement back to back. The re-plan used
// the planner's own rules (the same inputs give the same day as a fresh plan); the planner itself did it too, for most
// seeds, because it only refused the same exercise id twice. The re-checker's fresh plan picked Lying Triceps Press
// only because a new enrolment is a new seed. Now neither picks a variant of a movement the day already has while
// another exercise at the member's level fits the slot.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { loadCatalog as deriveCatalog } from "../../scripts/catalog/catalog.mjs";
import { PROGRAMMES, programmeById } from "@/data/programmes";
import { toCatalogExercise, type CatalogExercise, type CatalogRow } from "@/lib/training/catalog";
import { toPlanExercises } from "@/lib/training/enrolment";
import { expandOwnedEquipment } from "@/lib/training/equipment";
import { generateDay, movementOf, pickForSlot, type SlotSpec } from "@/lib/training/generator";
import type { PlanExerciseRow } from "@/lib/training/plans";
import { replanDayRows } from "@/lib/training/programme-replan";
import { DEFAULT_GYM_EQUIPMENT, type Level } from "@/lib/training/taxonomy";

const catalog = (deriveCatalog() as Array<CatalogRow & { is_active: boolean }>).filter((row) => row.is_active).map(toCatalogExercise);
const ppl = programmeById("ppl-3")!;
const push = ppl.days[0];
const withDumbbells = expandOwnedEquipment(DEFAULT_GYM_EQUIPMENT);
const withoutDumbbells = expandOwnedEquipment(DEFAULT_GYM_EQUIPMENT.filter((key) => key !== "dumbbell"));
const LEVELS: Level[] = ["beginner", "intermediate", "advanced"];
const SEEDS = ["enrolment-1:2026-11-27", "enrolment-2:2026-11-27", "enrolment-3:2026-11-30", "enrolment-4:2026-12-02", "enrolment-5:2026-12-04", "enrolment-6:2026-12-07"];
const asRows = (inputs: ReturnType<typeof toPlanExercises>): PlanExerciseRow[] => inputs.map((row, index) => ({ ...row, id: `row-${index}`, sort_order: index }));
const movements = (names: readonly string[]) => names.map(movementOf);
const repeats = (names: readonly string[]) => movements(names).length !== new Set(movements(names)).size;

describe("movementOf", () => {
  test("a variant is its movement and ' - ' its attachment, grip or version", () => {
    assert.equal(movementOf("Triceps Pushdown - Rope Attachment"), "triceps pushdown");
    assert.equal(movementOf("Triceps Pushdown"), "triceps pushdown");
    assert.equal(movementOf("Dips - Chest Version"), movementOf("Dips - Triceps Version"));
    assert.equal(movementOf("  Crunch -  Hands Overhead"), "crunch");
    assert.notEqual(movementOf("Push-Up"), movementOf("Push-Up Wide"), "a hyphen inside a name is not a variant mark");
    assert.notEqual(movementOf("Lying Triceps Press"), movementOf("Triceps Pushdown"));
  });
});

describe("the Push day without dumbbells (the re-check's case)", () => {
  test("planned fresh: Triceps Pushdown, then another movement, at every level and seed", () => {
    for (const level of LEVELS) for (const seed of SEEDS) {
      const day = generateDay(push.slots, { catalog, owned: withoutDumbbells, level, seed, context: "gym", sessionMinutes: ppl.sessionMinutes });
      const names = day.items.map((item) => item.exercise.name);
      assert.ok(!repeats(names), `${level} ${seed}: ${names.join(", ")}`);
      assert.ok(!names.includes("Triceps Pushdown - Rope Attachment") || !names.includes("Triceps Pushdown"), names.join(", "));
    }
  });

  test("re-planned from a day planned with dumbbells: the same day as a fresh plan for that list and seed", () => {
    for (const level of LEVELS) for (const seed of SEEDS) {
      const before = generateDay(push.slots, { catalog, owned: withDumbbells, level, seed, context: "gym", sessionMinutes: ppl.sessionMinutes });
      const fresh = generateDay(push.slots, { catalog, owned: withoutDumbbells, level, seed, context: "gym", sessionMinutes: ppl.sessionMinutes });
      for (const keepAddedByHand of [false, true]) {
        const after = replanDayRows({ rows: asRows(toPlanExercises(before.items)), slots: push.slots, catalog, owned: withoutDumbbells, level, seed, context: "gym", keepAddedByHand });
        assert.deepEqual(after.rows.map((row) => row.exercise_name), fresh.items.map((item) => item.exercise.name), `${level} ${seed}`);
        assert.ok(!repeats(after.rows.map((row) => row.exercise_name)));
      }
    }
  });
});

test("Re-plan this day swaps an exercise the member added for one that is not a variant of the day's movements", () => {
  // A row that fills none of the day's slots is replaced as Swap would choose; Swap's first choice for a dumbbell
  // kickback, once Dumbbells are off the list, is the rope pushdown, a variant of the day's Triceps Pushdown.
  const kickback = catalog.find((exercise) => exercise.name === "Tricep Dumbbell Kickback")!;
  assert.ok(kickback && kickback.required_equipment.includes("dumbbell"));
  for (const level of LEVELS) for (const seed of SEEDS) {
    const before = asRows([...toPlanExercises(generateDay(push.slots, { catalog, owned: withDumbbells, level, seed, context: "gym", sessionMinutes: ppl.sessionMinutes }).items),
      { exercise_id: kickback.id, exercise_name: kickback.name, target_sets: 3, reps_min: 10, reps_max: 12, rest_seconds: 60, target_weight_kg: null, target_duration_seconds: null }]);
    const after = replanDayRows({ rows: before, slots: push.slots, catalog, owned: withoutDumbbells, level, seed, context: "gym" });
    const names = after.rows.map((row) => row.exercise_name);
    assert.equal(names.length, before.length, names.join(", "));
    assert.notEqual(names[names.length - 1], kickback.name);
    assert.ok(!repeats(names), `${level} ${seed}: ${names.join(", ")}`);
  }
});

test("no programme day does one movement twice, with any of these lists, at any level", () => {
  const lists = { gym: withDumbbells, "gym without dumbbells": withoutDumbbells, "home, nothing": expandOwnedEquipment([]), "home, dumbbells and a bench": expandOwnedEquipment(["dumbbell", "bench"]) };
  for (const programme of PROGRAMMES) for (const day of programme.days) for (const [list, owned] of Object.entries(lists)) for (const level of LEVELS) for (const seed of SEEDS.slice(0, 3)) {
    const names = generateDay(day.slots, { catalog, owned, level, seed, context: programme.context, sessionMinutes: programme.sessionMinutes }).items.map((item) => item.exercise.name);
    assert.ok(!repeats(names), `${programme.id}/${day.key}, ${list}, ${level}: ${names.join(", ")}`);
  }
});

describe("a variant is still picked when nothing else fits", () => {
  let id = 0;
  const exercise = (overrides: Partial<CatalogExercise> & Pick<CatalogExercise, "name">): CatalogExercise => ({
    id: `ex-${++id}`, muscle_group: "triceps", primary_muscle: "triceps", secondary_muscles: [], category: "strength", mechanic: "isolation",
    required_equipment: ["cable_machine"], locations: ["gym"], difficulty: "beginner", movement_pattern: "push", prescription_type: "reps",
    recommended_sets: 3, reps_min: 10, reps_max: 12, rest_seconds: 60, default_duration_seconds: null, alternatives: [], source_ref: null, curated: true,
    ...overrides,
  });
  const pushdown = exercise({ name: "Triceps Pushdown" });
  const rope = exercise({ name: "Triceps Pushdown - Rope Attachment" });
  const harder = exercise({ name: "Standing Low-Pulley One-Arm Triceps Extension", difficulty: "intermediate" });
  const triceps: SlotSpec = { muscle: "triceps", mechanic: "isolation", sets: 3, reps: [10, 12], rest: 60 };
  const owned = expandOwnedEquipment(["cable_machine"]);

  test("rather than leave the slot empty", () => {
    const day = generateDay([triceps, triceps], { catalog: [pushdown, rope], owned, level: "beginner", seed: "s", context: "gym" });
    assert.deepEqual(day.items.map((item) => item.exercise.name), ["Triceps Pushdown", "Triceps Pushdown - Rope Attachment"]);
    assert.deepEqual(day.unfilled, []);
  });

  test("the member's level still comes first: a variant at their level before a harder movement", () => {
    assert.equal(pickForSlot(triceps, { catalog: [pushdown, rope, harder], owned, level: "beginner", seed: "s", context: "gym" }, new Set([pushdown.id]))?.name, "Triceps Pushdown - Rope Attachment");
    assert.equal(pickForSlot(triceps, { catalog: [pushdown, rope, harder], owned, level: "intermediate", seed: "s", context: "gym" }, new Set([pushdown.id]))?.name, "Standing Low-Pulley One-Arm Triceps Extension");
  });
});
