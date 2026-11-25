// Bug 17 (workouts-1): after Dumbbells were removed from the gym list, the programme's planned Push and Pull days
// kept their dumbbell exercises, and the card said nothing. A day's exercises the list rules out are replaced with the
// planner's own rules, keeping what the member can still do; on an automatic check an exercise the member added by
// hand stays and is named (review round: the check used to swap a member's own addition straight after saving it).
// Which days a check touches is tested with a stand-in database in programme-replan-days.test.ts.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { loadCatalog as deriveCatalog } from "../../scripts/catalog/catalog.mjs";
import { programmeById } from "@/data/programmes";
import { toCatalogExercise, type CatalogExercise, type CatalogRow } from "@/lib/training/catalog";
import { toPlanExercises } from "@/lib/training/enrolment";
import { expandOwnedEquipment, isDoableWith } from "@/lib/training/equipment";
import { generateDay, type SlotSpec } from "@/lib/training/generator";
import type { PlanExerciseRow } from "@/lib/training/plans";
import { replanDayRows, replanMessage, slotTakes } from "@/lib/training/programme-replan";
import { DEFAULT_GYM_EQUIPMENT } from "@/lib/training/taxonomy";

const catalog = (deriveCatalog() as Array<CatalogRow & { is_active: boolean }>).filter((row) => row.is_active).map(toCatalogExercise);
const byId = new Map(catalog.map((exercise) => [exercise.id, exercise]));
const ppl = programmeById("ppl-3")!;
const withDumbbells = expandOwnedEquipment(DEFAULT_GYM_EQUIPMENT);
const withoutDumbbells = expandOwnedEquipment(DEFAULT_GYM_EQUIPMENT.filter((key) => key !== "dumbbell"));
const asRows = (inputs: ReturnType<typeof toPlanExercises>): PlanExerciseRow[] => inputs.map((row, index) => ({ ...row, id: `row-${index}`, sort_order: index }));
const needsDumbbells = (row: { exercise_id: string | null }) => Boolean(row.exercise_id && byId.get(row.exercise_id)?.required_equipment.includes("dumbbell"));

/** A Push day as the planner made it while the list still had dumbbells, preferring dumbbell work so the test bites. */
function plannedPushDay() {
  const prefersDumbbells = catalog.filter((exercise) => exercise.required_equipment.length === 0 || exercise.required_equipment.includes("dumbbell") || !exercise.required_equipment.includes("barbell"));
  const day = generateDay(ppl.days[0].slots, { catalog: prefersDumbbells, owned: withDumbbells, level: "intermediate", seed: "enrolment-1:2026-11-30", context: "gym" });
  return asRows(toPlanExercises(day.items));
}

describe("a programme day re-planned for a list without dumbbells", () => {
  const before = plannedPushDay();
  const after = replanDayRows({ rows: before, slots: ppl.days[0].slots, catalog, owned: withoutDumbbells, level: "intermediate", seed: "enrolment-1:2026-11-30", context: "gym" });

  test("the day had dumbbell exercises, and none is left", () => {
    assert.ok(before.some(needsDumbbells), "the planned day used dumbbells");
    assert.equal(after.changed, true);
    for (const row of after.rows) {
      const exercise = row.exercise_id ? byId.get(row.exercise_id) : undefined;
      assert.ok(exercise && isDoableWith(exercise.required_equipment, withoutDumbbells), `${row.exercise_name} fits the new list`);
    }
    assert.equal(after.replaced.length, before.filter(needsDumbbells).length - after.dropped.length);
  });

  test("what the member can still do stays where it was, with its sets and rest", () => {
    before.forEach((row, index) => {
      if (needsDumbbells(row)) return;
      assert.deepEqual(after.rows[index], { exercise_id: row.exercise_id, exercise_name: row.exercise_name, target_sets: row.target_sets, reps_min: row.reps_min, reps_max: row.reps_max, rest_seconds: row.rest_seconds, target_weight_kg: null, target_duration_seconds: row.target_duration_seconds });
    });
  });

  test("a replacement keeps the replaced row's sets and rest, trains the same slot, and is never a duplicate", () => {
    const ids = after.rows.map((row) => row.exercise_id);
    assert.equal(new Set(ids).size, ids.length);
    before.forEach((row, index) => {
      if (!needsDumbbells(row)) return;
      const next = after.rows[index];
      assert.equal(next.target_sets, row.target_sets);
      assert.equal(next.rest_seconds, row.rest_seconds);
      assert.equal(next.target_weight_kg, null, "a target weight belonged to the old movement");
      assert.equal(byId.get(next.exercise_id!)!.muscle_group, byId.get(row.exercise_id!)!.muscle_group);
    });
  });

  test("an automatic check re-plans the planner's own rows the same way: each fills a slot, none counts as added by hand", () => {
    const automatic = replanDayRows({ rows: before, slots: ppl.days[0].slots, catalog, owned: withoutDumbbells, level: "intermediate", seed: "enrolment-1:2026-11-30", context: "gym", keepAddedByHand: true });
    assert.deepEqual(automatic, after);
    assert.deepEqual(automatic.kept, []);
  });

  test("checking again changes nothing", () => {
    const again = replanDayRows({ rows: asRows(after.rows), slots: ppl.days[0].slots, catalog, owned: withoutDumbbells, level: "intermediate", seed: "enrolment-1:2026-11-30", context: "gym" });
    assert.equal(again.changed, false);
  });

  test("a day the list still allows is left alone", () => {
    const same = replanDayRows({ rows: before, slots: ppl.days[0].slots, catalog, owned: withDumbbells, level: "intermediate", seed: "x", context: "gym" });
    assert.deepEqual([same.changed, same.replaced, same.dropped], [false, [], []]);
  });
});

describe("rows outside the day's slots, and what nothing replaces", () => {
  const exercise = (id: string, extra: Partial<CatalogExercise>): CatalogExercise => ({
    id, name: id, primary_muscle: "chest", secondary_muscles: [], muscle_group: "chest", category: "strength", mechanic: "compound", required_equipment: [],
    locations: ["gym", "home"], difficulty: "beginner", movement_pattern: "push", prescription_type: "reps", recommended_sets: 3, reps_min: 8, reps_max: 12,
    rest_seconds: 90, default_duration_seconds: null, alternatives: [], source_ref: null, curated: true, ...extra,
  });
  const small = [
    exercise("db_press", { required_equipment: ["dumbbell"] }),
    exercise("push_up", {}),
    exercise("db_curl", { muscle_group: "biceps", primary_muscle: "biceps", required_equipment: ["dumbbell"] }),
    exercise("band_curl", { muscle_group: "biceps", primary_muscle: "biceps", required_equipment: ["resistance_band"] }),
    exercise("plank", { muscle_group: "core", primary_muscle: "abdominals", prescription_type: "time", default_duration_seconds: 45 }),
    exercise("old_move", { required_equipment: ["dumbbell"], muscle_group: "calves", primary_muscle: "calves" }),
  ];
  const slots: SlotSpec[] = [{ muscle: "chest", sets: 3, reps: [8, 12], rest: 90 }];
  const row = (id: string, index: number, extra: Partial<PlanExerciseRow> = {}): PlanExerciseRow => ({ id: `r${index}`, exercise_id: id, exercise_name: id, sort_order: index, target_sets: 4, reps_min: 6, reps_max: 8, rest_seconds: 120, target_weight_kg: 20, target_duration_seconds: null, ...extra });
  const none = expandOwnedEquipment([]);

  test("a slot's exercise gets the planner's pick for that slot", () => {
    const result = replanDayRows({ rows: [row("db_press", 0)], slots, catalog: small, owned: none, level: "beginner", seed: "s", context: "gym" });
    assert.deepEqual(result.replaced, [{ from: "db_press", to: "push_up" }]);
    assert.deepEqual(result.rows[0], { exercise_id: "push_up", exercise_name: "push_up", target_sets: 4, reps_min: 6, reps_max: 8, rest_seconds: 120, target_weight_kg: null, target_duration_seconds: null });
  });

  test("asked to re-plan, an exercise added by hand (no slot of its own) is swapped as Swap would, else left out and named", () => {
    const bands = expandOwnedEquipment(["resistance_band"]);
    const swapped = replanDayRows({ rows: [row("push_up", 0), row("db_curl", 1)], slots, catalog: small, owned: bands, level: "beginner", seed: "s", context: "gym" });
    assert.deepEqual(swapped.replaced, [{ from: "db_curl", to: "band_curl" }]);
    const dropped = replanDayRows({ rows: [row("push_up", 0), row("old_move", 1)], slots, catalog: small, owned: none, level: "beginner", seed: "s", context: "gym" });
    assert.deepEqual([dropped.dropped, dropped.rows.map((entry) => entry.exercise_id)], [["old_move"], ["push_up"]]);
  });

  test("an automatic check keeps an exercise added by hand and names it; the planner's own rows are still replaced", () => {
    const bands = expandOwnedEquipment(["resistance_band"]);
    const result = replanDayRows({ rows: [row("db_press", 0), row("db_curl", 1)], slots, catalog: small, owned: bands, level: "beginner", seed: "s", context: "gym", keepAddedByHand: true });
    assert.deepEqual(result.replaced, [{ from: "db_press", to: "push_up" }], "db_press fills the day's chest slot: the planner's pick replaces it");
    assert.deepEqual(result.kept, ["db_curl"], "db_curl fills no slot of this day: the member added it");
    assert.deepEqual(result.rows.map((entry) => entry.exercise_id), ["push_up", "db_curl"]);
    assert.deepEqual(result.rows[1], { exercise_id: "db_curl", exercise_name: "db_curl", target_sets: 4, reps_min: 6, reps_max: 8, rest_seconds: 120, target_weight_kg: 20, target_duration_seconds: null }, "kept as it was, target weight included");
    assert.equal(result.changed, true);
  });

  test("a day whose only problem is an exercise added by hand is unchanged on an automatic check", () => {
    const result = replanDayRows({ rows: [row("push_up", 0), row("db_curl", 1)], slots, catalog: small, owned: none, level: "beginner", seed: "s", context: "gym", keepAddedByHand: true });
    assert.deepEqual([result.changed, result.kept, result.replaced, result.dropped], [false, ["db_curl"], [], []]);
  });

  test("an exercise no longer in the catalogue is kept as it is", () => {
    const result = replanDayRows({ rows: [row("retired_move", 0)], slots, catalog: small, owned: none, level: "beginner", seed: "s", context: "gym" });
    assert.equal(result.changed, false);
  });

  test("a day left with nothing has no rows: the caller keeps it and warns", () => {
    const result = replanDayRows({ rows: [row("old_move", 0)], slots: [], catalog: small, owned: none, level: "beginner", seed: "s", context: "gym" });
    assert.deepEqual([result.changed, result.rows.length, result.dropped], [true, 0, ["old_move"]]);
  });

  test("slotTakes: kind and muscle, never the equipment", () => {
    assert.equal(slotTakes(slots[0], small[0]), true);
    assert.equal(slotTakes(slots[0], small[2]), false);
    assert.equal(slotTakes({ ...slots[0], primary: ["triceps"], primaryOnly: true }, small[0]), false);
  });
});

test("what the member reads", () => {
  assert.equal(replanMessage({ replanned: [], unfixable: [] }, "gym"), "");
  assert.equal(replanMessage({ replanned: [], unfixable: [], kept: [] }, "gym"), "");
  assert.equal(
    replanMessage({ replanned: [{ planId: "a", title: "Push · Push, Pull, Legs", replaced: [{ from: "x", to: "y" }], dropped: [] }, { planId: "b", title: "Pull · Push, Pull, Legs", replaced: [], dropped: ["Shrug"] }], unfixable: [] }, "gym"),
    "Push and Pull were re-planned for your gym list: exercises it doesn’t allow were swapped for ones it does. Nothing on your list replaces Shrug, so it was left out.",
  );
  assert.equal(replanMessage({ replanned: [], unfixable: [{ planId: "c", title: "Legs · Push, Pull, Legs" }] }, "gym"), "Nothing on your list fits Legs. Add equipment, or edit that day.");
  assert.equal(
    replanMessage({ replanned: [], unfixable: [], kept: [{ planId: "d", title: "Pull · Push, Pull, Legs", names: ["Barbell Curl"] }] }, "gym"),
    "Barbell Curl on Pull stays: you added it yourself, though your list doesn’t allow it.",
  );
  assert.equal(
    replanMessage({ replanned: [], unfixable: [], kept: [{ planId: "d", title: "Pull · Push, Pull, Legs", names: ["Barbell Curl"] }, { planId: "e", title: "Push · Push, Pull, Legs", names: ["Cable Fly"] }] }, "gym"),
    "Barbell Curl on Pull and Cable Fly on Push stay: you added them yourself, though your list doesn’t allow them.",
  );
});

test("a programme repeats its days: each day's name is said once", () => {
  const push = (planId: string) => ({ planId, title: "Push · Push, Pull, Legs", replaced: [{ from: "x", to: "y" }], dropped: [] });
  assert.equal(replanMessage({ replanned: [push("a"), push("b")], unfixable: [] }, "gym"), "Push was re-planned for your gym list: exercises it doesn’t allow were swapped for ones it does.");
  const pull = (planId: string) => ({ planId, title: "Pull · Push, Pull, Legs", names: ["Barbell Curl"] });
  assert.equal(replanMessage({ replanned: [], unfixable: [], kept: [pull("c"), pull("d")] }, "gym"), "Barbell Curl on Pull stays: you added it yourself, though your list doesn’t allow it.");
});
