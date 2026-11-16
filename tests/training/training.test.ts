import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PROGRAMMES } from "@/data/programmes";
import { locationsForEquipment, toCatalogExercise, type CatalogExercise } from "@/lib/training/catalog";
import { equipmentKeyFor, equipmentKeysFromWords, expandOwnedEquipment, isDoableWith, missingEquipment } from "@/lib/training/equipment";
import { generateDay, slotMinutes, type SlotSpec } from "@/lib/training/generator";
import { nextScheduleStart } from "@/lib/training/enrolment";
import { nextDayIndex, scheduleDays, splitProgrammeId } from "@/lib/training/programmes";
import { rankSubstitutes } from "@/lib/training/substitutions";
import { EQUIPMENT, EQUIPMENT_KEYS, EXERCISE_CATEGORIES, MUSCLE_GROUPS } from "@/lib/training/taxonomy";

// ---------------------------------------------------------------- a small catalogue

let nextId = 0;
function exercise(overrides: Partial<CatalogExercise> & Pick<CatalogExercise, "name" | "muscle_group">): CatalogExercise {
  return {
    id: overrides.id ?? `ex-${++nextId}`, primary_muscle: overrides.muscle_group, secondary_muscles: [], category: "strength", mechanic: "compound",
    required_equipment: [], locations: ["gym", "home"], difficulty: "beginner", movement_pattern: "push", prescription_type: "reps",
    recommended_sets: 3, reps_min: 8, reps_max: 12, rest_seconds: 90, default_duration_seconds: null, alternatives: [], source_ref: null, curated: true,
    ...overrides,
  };
}

const catalog: CatalogExercise[] = [
  exercise({ id: "bench_press", name: "Barbell Bench Press", muscle_group: "chest", required_equipment: ["barbell", "bench"] }),
  exercise({ id: "dumbbell_bench_press", name: "Dumbbell Bench Press", muscle_group: "chest", required_equipment: ["bench", "dumbbell"] }),
  exercise({ id: "push_up", name: "Push-Up", muscle_group: "chest" }),
  exercise({ id: "chest-stretch", name: "Chest Stretch", muscle_group: "chest", category: "stretching", mechanic: null, prescription_type: "time", default_duration_seconds: 30 }),
  exercise({ id: "cable_fly", name: "Cable Fly", muscle_group: "chest", mechanic: "isolation", required_equipment: ["cable_machine"] }),
  exercise({ id: "pull_up", name: "Pull-Up", muscle_group: "back", primary_muscle: "lats", movement_pattern: "pull", required_equipment: ["pull_up_bar"] }),
  exercise({ id: "barbell_row", name: "Barbell Row", muscle_group: "back", primary_muscle: "middle_back", movement_pattern: "pull", required_equipment: ["barbell"] }),
  exercise({ id: "superman", name: "Superman", muscle_group: "back", primary_muscle: "lower_back", movement_pattern: "pull", mechanic: "isolation" }),
  exercise({ id: "plank", name: "Front Plank", muscle_group: "core", mechanic: "isolation", prescription_type: "time", default_duration_seconds: 45, movement_pattern: "static" }),
  exercise({ id: "front-squat", name: "Front Barbell Squat", muscle_group: "quadriceps", difficulty: "advanced", required_equipment: ["barbell", "squat_rack"] }),
  exercise({ id: "bodyweight_squat", name: "Bodyweight Squat", muscle_group: "quadriceps" }),
  exercise({ id: "goblet_squat", name: "Goblet Squat", muscle_group: "quadriceps", required_equipment: ["dumbbell"] }),
];
const gym = expandOwnedEquipment(["barbell", "bench", "dumbbell", "cable_machine", "pull_up_bar", "squat_rack"]);
const nothing = expandOwnedEquipment([]);

// ---------------------------------------------------------------- equipment

test("older equipment words map to the shared keys", () => {
  assert.equal(equipmentKeyFor("Dumbbells"), "dumbbell");
  assert.equal(equipmentKeyFor("resistance bands"), "resistance_band");
  assert.equal(equipmentKeyFor("bands"), "resistance_band");
  assert.equal(equipmentKeyFor("cable"), "cable_machine");
  assert.equal(equipmentKeyFor("exercise_ball"), "stability_ball");
  assert.equal(equipmentKeyFor("pull_up_bar"), "pull_up_bar");
  assert.equal(equipmentKeyFor("bodyweight"), "", "bodyweight means no equipment");
  assert.equal(equipmentKeyFor("hover board"), null);
  assert.deepEqual(equipmentKeysFromWords(["bodyweight", "Dumbbells", "dumbbell", "kettlebells", "nonsense"]), ["dumbbell", "kettlebell"]);
});

test("a bench also serves as a box and a chair", () => {
  const owned = expandOwnedEquipment(["bench"]);
  assert.equal(isDoableWith(["box"], owned), true);
  assert.equal(isDoableWith(["chair"], owned), true);
  assert.deepEqual(missingEquipment(["barbell", "bench"], owned), ["barbell"]);
  assert.equal(isDoableWith([], nothing), true, "no requirements is always doable");
});

// ---------------------------------------------------------------- catalogue rows

test("rows from before the clean-up get honest estimates from the older columns", () => {
  const legacy = toCatalogExercise({ id: "free-exercise-db-Pullups", name: "Pullups", primary_muscle: "lats", equipment: ["bodyweight"], locations: ["gym", "home"], difficulty: "beginner", movement_pattern: "pull" });
  assert.equal(legacy.curated, false);
  assert.deepEqual(legacy.required_equipment, []);
  assert.equal(legacy.muscle_group, "back");
  assert.equal(legacy.source_ref, "Pullups");
  const other = toCatalogExercise({ id: "x", name: "Atlas Stones", primary_muscle: "lower_back", equipment: ["other"], difficulty: "advanced", movement_pattern: "pull" });
  assert.deepEqual(other.required_equipment, ["specialty"]);
  assert.equal(other.category, "strongman");
  assert.deepEqual(other.locations, ["gym"], "the constant ['gym','home'] is replaced by locations derived from equipment");
  const stretch = toCatalogExercise({ id: "y", name: "All Fours Quad Stretch", primary_muscle: "quadriceps", equipment: ["bodyweight"], difficulty: "beginner", movement_pattern: "static" });
  assert.equal(stretch.category, "stretching");
  assert.equal(stretch.prescription_type, "time");
});

test("cleaned rows are used as they are", () => {
  const row = toCatalogExercise({ id: "pull_up", name: "Pull-Up", primary_muscle: "lats", equipment: ["pull_up_bar"], locations: ["gym", "home"], difficulty: "intermediate", movement_pattern: "vertical_pull",
    category: "strength", mechanic: "compound", muscle_group: "back", required_equipment: ["pull_up_bar"], prescription_type: "reps", catalog_version: 1 });
  assert.equal(row.curated, true);
  assert.deepEqual(row.required_equipment, ["pull_up_bar"]);
  assert.equal(row.mechanic, "compound");
  assert.deepEqual(locationsForEquipment(["pull_up_bar"]), ["gym", "home"]);
  assert.deepEqual(locationsForEquipment(["barbell"]), ["gym"]);
});

// ---------------------------------------------------------------- generator

const chestMain: SlotSpec = { muscle: "chest", mechanic: "compound", sets: 4, reps: [6, 8], rest: 150, preferred: ["bench_press", "dumbbell_bench_press", "push_up"], label: "Main press" };
const back: SlotSpec = { muscle: "back", mechanic: "compound", primary: ["lats"], sets: 3, reps: [6, 10], rest: 120, label: "Vertical pull" };
const coreSlot: SlotSpec = { muscle: "core", sets: 3, reps: [10, 15], rest: 45, seconds: 40, optional: true, label: "Core" };

test("slots take the preferred lift the user can do, never a stretch or another muscle group", () => {
  const hinge: SlotSpec = { muscle: "hamstrings", mechanic: "compound", sets: 3, reps: [8, 10], rest: 120, label: "Hinge" };
  const atGym = generateDay([chestMain, back, hinge, coreSlot], { catalog, owned: gym, level: "intermediate", seed: "s" });
  assert.deepEqual(atGym.items.map((item) => item.exercise.id), ["bench_press", "pull_up", "plank"]);
  assert.deepEqual(atGym.unfilled.map((slot) => slot.label), ["Hinge"], "no hamstring exercise exists here, so the slot stays empty");
  const atHome = generateDay([chestMain, back, coreSlot], { catalog, owned: nothing, level: "intermediate", seed: "s", context: "home" });
  assert.deepEqual(atHome.items.map((item) => item.exercise.id), ["push_up", "superman", "plank"], "no pull-up bar: the back slot takes the back exercise the user can do");
  for (const item of [...atGym.items, ...atHome.items]) assert.notEqual(item.exercise.category, "stretching");
});

test("holds get a time target and reps movements keep reps", () => {
  const day = generateDay([chestMain, coreSlot], { catalog, owned: gym, level: "intermediate", seed: "s" });
  const plank = day.items.find((item) => item.exercise.id === "plank")!;
  assert.equal(plank.target_duration_seconds, 40);
  assert.deepEqual([plank.reps_min, plank.reps_max], [1, 1]);
  const bench = day.items.find((item) => item.exercise.id === "bench_press")!;
  assert.equal(bench.target_duration_seconds, null);
  assert.deepEqual([bench.reps_min, bench.reps_max, bench.target_sets], [6, 8, 4]);
});

test("beginners get at most three sets and no advanced lifts", () => {
  const squat: SlotSpec = { muscle: "quadriceps", mechanic: "compound", sets: 5, reps: [5, 5], rest: 180, preferred: ["front-squat", "goblet_squat"] };
  const day = generateDay([squat], { catalog, owned: gym, level: "beginner", seed: "s" });
  assert.equal(day.items[0].exercise.id, "goblet_squat");
  assert.equal(day.items[0].target_sets, 3);
});

test("the same seed gives the same day, and recent exercises make way for others", () => {
  const anyChest: SlotSpec = { muscle: "chest", sets: 3, reps: [8, 12], rest: 90 };
  const first = generateDay([anyChest], { catalog, owned: gym, level: "intermediate", seed: "2026-11-16" });
  const again = generateDay([anyChest], { catalog, owned: gym, level: "intermediate", seed: "2026-11-16" });
  assert.equal(first.items[0].exercise.id, again.items[0].exercise.id);
  const recent = new Map([[first.items[0].exercise.id, 1]]);
  const varied = generateDay([anyChest], { catalog, owned: gym, level: "intermediate", seed: "2026-11-16", recentDays: recent });
  assert.notEqual(varied.items[0].exercise.id, first.items[0].exercise.id);
});

test("optional slots are dropped from the end to fit the session length", () => {
  const long = [chestMain, back, { ...coreSlot, optional: true }];
  const total = long.reduce((sum, slot) => sum + slotMinutes(slot), 0);
  const day = generateDay(long, { catalog, owned: gym, level: "intermediate", seed: "s", sessionMinutes: Math.floor(total - 1) });
  assert.deepEqual(day.dropped.map((slot) => slot.label), ["Core"]);
  assert.equal(day.items.length, 2);
});

// ---------------------------------------------------------------- substitutions

test("swaps train the same muscles with equipment the user has, best first", () => {
  const bench = catalog.find((item) => item.id === "bench_press")!;
  const atHome = rankSubstitutes(bench, catalog, { owned: expandOwnedEquipment(["dumbbell", "bench"]), level: "intermediate" });
  assert.deepEqual(atHome.map((item) => item.exercise.id), ["dumbbell_bench_press", "push_up"]);
  assert.ok(atHome.every((item) => item.exercise.muscle_group === "chest" && item.exercise.category === "strength"));
  assert.ok(atHome[0].reasons.includes("Same muscles"));
  const withNothing = rankSubstitutes(bench, catalog, { owned: nothing, level: "intermediate" });
  assert.deepEqual(withNothing.map((item) => item.exercise.id), ["push_up"]);
  assert.ok(withNothing[0].reasons.includes("No equipment"));
});

test("curated alternatives rank first among equals", () => {
  const target = { ...catalog.find((item) => item.id === "bench_press")!, alternatives: ["push_up"] };
  const ranked = rankSubstitutes(target, catalog, { owned: gym, level: "intermediate" });
  assert.equal(ranked[0].exercise.id, "push_up");
  assert.equal(ranked[0].reasons[0], "FITX pick");
});

// ---------------------------------------------------------------- programmes

test("authored programmes use the shared vocabularies", () => {
  const ids = new Set<string>();
  for (const programme of PROGRAMMES) {
    assert.ok(!ids.has(programme.id), `unique id ${programme.id}`); ids.add(programme.id);
    assert.match(programme.id, /^[a-z0-9][a-z0-9-]{1,63}$/);
    assert.ok(programme.days.length >= 1 && programme.days.length <= 14);
    assert.ok(programme.defaultWeekdays.length === programme.daysPerWeek, `${programme.id} suggests ${programme.daysPerWeek} weekdays`);
    assert.equal(programme.isPremium, false);
    for (const key of programme.builtAround) assert.ok(EQUIPMENT_KEYS.includes(key), `${programme.id} equipment ${key}`);
    for (const day of programme.days) {
      assert.ok(day.slots.length >= 1 && day.slots.length <= 12, `${programme.id}/${day.key} slot count`);
      const firstOptional = day.slots.findIndex((slot) => slot.optional);
      for (const [index, slot] of day.slots.entries()) {
        for (const muscle of Array.isArray(slot.muscle) ? slot.muscle : [slot.muscle]) assert.ok((MUSCLE_GROUPS as readonly string[]).includes(muscle), `${day.key} muscle ${muscle}`);
        assert.ok(!slot.category || (EXERCISE_CATEGORIES as readonly string[]).includes(slot.category));
        assert.ok(slot.sets >= 1 && slot.sets <= 10 && slot.reps[0] >= 1 && slot.reps[1] >= slot.reps[0] && slot.reps[1] <= 100 && slot.rest >= 15 && slot.rest <= 600, `${day.key} prescription`);
        assert.ok(slot.label, `${day.key} slot ${index} has a label`);
        if (firstOptional >= 0 && index > firstOptional) assert.ok(slot.optional || slot.label === "Core" || slot.label === "Conditioning", `${day.key}: optional slots come last`);
      }
      const firstIsolation = day.slots.findIndex((slot) => slot.mechanic === "isolation");
      const lastCompound = day.slots.map((slot) => slot.mechanic).lastIndexOf("compound");
      assert.ok(firstIsolation < 0 || lastCompound < firstIsolation, `${programme.id}/${day.key}: compound lifts come first`);
    }
  }
  assert.deepEqual([...ids].sort(), ["bro-split-5", "full-body-3", "home-bodyweight-3", "home-dumbbell-4", "ppl-3", "ppl-6", "upper-lower-4"]);
});

test("scheduling places programme days on the chosen weekdays, in order", () => {
  // 2026-11-16 is a Monday.
  const days = scheduleDays({ from: new Date(2026, 10, 16), weekdays: [1, 3, 5], horizonDays: 7, startDay: 0, dayCount: 3 });
  assert.deepEqual(days, [{ date: "2026-11-16", dayIndex: 0 }, { date: "2026-11-18", dayIndex: 1 }, { date: "2026-11-20", dayIndex: 2 }]);
  const wrapped = scheduleDays({ from: new Date(2026, 10, 16), weekdays: [1, 2, 3, 4, 5, 6], horizonDays: 7, startDay: 4, dayCount: 6 });
  assert.deepEqual(wrapped.map((day) => day.dayIndex), [4, 5, 0, 1, 2, 3]);
  assert.deepEqual(scheduleDays({ from: new Date(2026, 10, 16), weekdays: [], horizonDays: 7, startDay: 0, dayCount: 3 }), []);
  assert.equal(nextDayIndex({ days: PROGRAMMES[0].days }, 2), 0);
});

test("planning ahead continues after the last scheduled day", () => {
  const plans = [
    { id: "a", title: "Push", planned_for: "2026-11-16", programme_day_index: 0, last_done_key: "2026-11-16" },
    { id: "b", title: "Pull", planned_for: "2026-11-18", programme_day_index: 1, last_done_key: null },
  ];
  assert.deepEqual(nextScheduleStart(plans, 1, "2026-11-17", 3), { fromKey: "2026-11-19", startDay: 2 });
  assert.deepEqual(nextScheduleStart(plans, 1, "2026-11-23", 3), { fromKey: "2026-11-23", startDay: 1 }, "nothing ahead: start today at the enrolment's next day");
});

test("one-off auto plans draw on the matching authored days", () => {
  assert.equal(splitProgrammeId("push_pull_legs", "gym", false), "ppl-3");
  assert.equal(splitProgrammeId("upper_lower", "gym", true), "upper-lower-4");
  assert.equal(splitProgrammeId("full_body", "gym", false), "full-body-3");
  assert.equal(splitProgrammeId("push_pull_legs", "home", true), "home-dumbbell-4");
  assert.equal(splitProgrammeId("push_pull_legs", "home", false), "home-bodyweight-3");
});

// ---------------------------------------------------------------- migrations stay in step with the code

const migration = (name: string) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");

test("the equipment seed matches taxonomy.ts", () => {
  const sql = migration("20261118130000_fitx_training_catalog_schema.sql");
  const seeded = [...sql.matchAll(/^\s+\('([a-z_]+)', '([^']+)', '([a-z_]+)', (true|false), array\[(.*?)\]::text\[\], (\d+)\)/gm)];
  assert.deepEqual(seeded.map((row) => row[1]), EQUIPMENT.map((item) => item.key));
  for (const [index, row] of seeded.entries()) {
    const item = EQUIPMENT[index];
    assert.equal(row[2], item.label.replaceAll("'", "''"));
    assert.equal(row[3], item.kind);
    assert.equal(row[4] === "true", item.homeFriendly);
    assert.deepEqual([...row[5].matchAll(/'([^']*)'/g)].map((word) => word[1]), [...item.synonyms]);
  }
  for (const group of MUSCLE_GROUPS) assert.ok(sql.includes(`'${group}'`), `muscle group ${group} allowed by the check`);
  for (const category of EXERCISE_CATEGORIES) assert.ok(sql.includes(`'${category}'`), `category ${category} allowed by the check`);
});

test("the programme seed is exactly what scripts/catalog/build-programmes.mjs generates", async () => {
  const { programmeSeedSql } = await import("../../scripts/catalog/build-programmes.mjs");
  assert.equal(migration("20261118130040_fitx_training_programmes_seed.sql"), programmeSeedSql(PROGRAMMES), "run: node scripts/catalog/build-programmes.mjs");
});

test("the programme seed matches src/data/programmes", () => {
  const sql = migration("20261118130040_fitx_training_programmes_seed.sql");
  const json = sql.slice(sql.indexOf("$programmes$") + "$programmes$".length, sql.lastIndexOf("$programmes$"));
  const seeded = JSON.parse(json) as Array<{ id: string; title: string; days_per_week: number; default_weekdays: number[]; days: Array<{ key: string; slots: unknown[] }> }>;
  assert.deepEqual(seeded.map((row) => row.id), PROGRAMMES.map((programme) => programme.id));
  for (const [index, row] of seeded.entries()) {
    const programme = PROGRAMMES[index];
    assert.equal(row.title, programme.title);
    assert.equal(row.days_per_week, programme.daysPerWeek);
    assert.deepEqual(row.default_weekdays, programme.defaultWeekdays);
    assert.deepEqual(row.days.map((day) => day.key), programme.days.map((day) => day.key));
    assert.deepEqual(row.days.map((day) => day.slots), JSON.parse(JSON.stringify(programme.days.map((day) => day.slots))));
  }
});
