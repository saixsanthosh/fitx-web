import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
// The cleaned catalogue exactly as migration 20261118130010 writes it (scripts/catalog).
import { loadCatalog as deriveCatalog } from "../../scripts/catalog/catalog.mjs";
import { PROGRAMMES } from "@/data/programmes";
import { BODY_REGIONS, exerciseRegions, REGIONS } from "@/lib/training/anatomy";
import { toCatalogExercise, type CatalogRow } from "@/lib/training/catalog";
import { expandOwnedEquipment } from "@/lib/training/equipment";
import { MUSCLE_NOTES } from "@/lib/training/muscle-notes";
import { exercisesForRegion, focusAreaForRegion, lastTrainedText, regionFromParam, shortDate } from "@/app/(dashboard)/exercises/muscles/_lib/muscle-exercises";
import { loadSavedPlans, plansTraining, programmesTraining, SAVED_PLAN_LIMIT, slotRole, type SavedPlan, type SavedPlanExercise } from "@/app/(dashboard)/exercises/muscles/_lib/muscle-workouts";
import { CATALOGUE_BATCH, loadLightCatalogue } from "@/app/(dashboard)/exercises/_lib/catalogue";

const rows = deriveCatalog() as Array<CatalogRow & { is_active: boolean }>;
const catalog = rows.filter((row) => row.is_active).map(toCatalogExercise);
const byId = new Map(catalog.map((exercise) => [exercise.id, exercise]));

describe("what each muscle does", () => {
  test("one plain sentence and an anatomical name for each of the 17 regions", () => {
    assert.deepEqual(Object.keys(MUSCLE_NOTES).sort(), [...BODY_REGIONS].sort());
    for (const region of BODY_REGIONS) {
      const note = MUSCLE_NOTES[region];
      assert.ok(note.anatomy.length > 3, `${region}: anatomical name`);
      assert.match(note.role, /^[A-Z]/, `${region}: starts a sentence`);
      assert.match(note.role, /\.$/, `${region}: ends a sentence`);
      assert.equal(note.role.split(/[.!?](\s|$)/).filter((part) => part.trim()).length, 1, `${region}: one sentence`);
      assert.ok(note.role.length <= 160, `${region}: short`);
      assert.doesNotMatch(note.role, /\b(should|must|try|aim|best|avoid|safe|injury|injuries)\b|%|\d/i, `${region}: anatomy, not coaching or numbers`);
      assert.doesNotMatch(note.role, /—/, `${region}: no dashes`);
    }
  });
});

describe("choosing a muscle", () => {
  test("a URL value: a region key or a word for exactly one region", () => {
    assert.equal(regionFromParam("lats"), "lats");
    assert.equal(regionFromParam("Middle-back"), "middle_back");
    assert.equal(regionFromParam("upper_back"), "middle_back");
    assert.equal(regionFromParam("abs"), "abdominals");
    assert.equal(regionFromParam("back"), null, "a group of four is not one muscle");
    assert.equal(regionFromParam("constructor"), null);
    assert.equal(regionFromParam(null), null);
  });

  test("each region's focus area, for 'Build a … workout'", () => {
    assert.equal(focusAreaForRegion("lats"), "back");
    assert.equal(focusAreaForRegion("traps"), "back");
    assert.equal(focusAreaForRegion("abdominals"), "abs");
    assert.equal(focusAreaForRegion("neck"), null);
  });
});

describe("exercises for a muscle", () => {
  test("main muscle first, then assisting; nothing listed twice; every region has exercises", () => {
    for (const region of BODY_REGIONS) {
      const { primary, assisting } = exercisesForRegion(catalog, region, { owned: null });
      assert.ok(primary.length > 0, `${region} has main-muscle exercises`);
      assert.ok(primary.every((item) => exerciseRegions(item.exercise.primary_muscle, item.exercise.secondary_muscles).primary.includes(region)));
      assert.ok(assisting.every((item) => {
        const regions = exerciseRegions(item.exercise.primary_muscle, item.exercise.secondary_muscles);
        return !regions.primary.includes(region) && regions.secondary.includes(region);
      }));
    }
    assert.equal(exercisesForRegion(catalog, "glutes", { owned: null }).assisting.length > 100, true, "glutes assist in many lifts");
  });

  test("with an equipment list, what the member can do comes first; at home, only home-friendly or doable ones", () => {
    const owned = expandOwnedEquipment([]);
    const lats = exercisesForRegion(catalog, "lats", { owned });
    const training = lats.primary.filter((item) => item.exercise.category !== "stretching");
    assert.deepEqual(lats.primary.slice(0, training.length), training, "training exercises before stretches");
    const doable = training.map((item) => item.doable);
    assert.deepEqual(doable, [...doable].sort((a, b) => Number(b) - Number(a)));
    const gym = exercisesForRegion(catalog, "lats", { owned: null });
    assert.equal(gym.primary[0].exercise.id, "pull_up", "FITX staples lead");
    const home = exercisesForRegion(catalog, "chest", { owned, environment: "home" });
    assert.ok(home.primary.every((item) => item.exercise.locations.includes("home") || item.doable));
  });
});

describe("workouts that train a muscle", () => {
  test("programme slots: aimed at the region, or at its group without saying which part", () => {
    assert.equal(slotRole({ muscle: "back", primary: ["lats"] }, "lats"), "direct");
    assert.equal(slotRole({ muscle: "back", primary: ["lats"] }, "middle_back"), null);
    assert.equal(slotRole({ muscle: "back" }, "lats"), "group");
    assert.equal(slotRole({ muscle: "chest" }, "chest"), "direct");
    assert.equal(slotRole({ muscle: "core" }, "abdominals"), "direct");
    assert.equal(slotRole({ muscle: ["quadriceps", "glutes"] }, "glutes"), "direct");
    assert.equal(slotRole({ muscle: "shoulders" }, "traps"), null);
  });

  test("authored programmes: the days with a slot for the muscle, by slot label", () => {
    const lats = programmesTraining(PROGRAMMES, "lats");
    const ppl = lats.find((match) => match.programme.id === "ppl-3");
    assert.ok(ppl, "Push, Pull, Legs trains the lats");
    assert.deepEqual(ppl.days.map((day) => [day.title, day.direct, day.slots]), [["Pull", true, ["Vertical pull"]]]);
    const chest = programmesTraining(PROGRAMMES, "chest");
    assert.ok(chest.length >= 3 && chest.every((match) => match.days.every((day) => day.direct)));
    assert.deepEqual(programmesTraining(PROGRAMMES, "neck"), []);
    for (const region of BODY_REGIONS) for (const match of programmesTraining(PROGRAMMES, region)) assert.ok(match.days.length > 0 && match.days.every((day) => day.slots.length > 0));
  });

  const PLANS: SavedPlan[] = [
    { id: "p-past", title: "Old push day", status: "scheduled", planned_for: "2026-11-02" },
    { id: "p-soon", title: "Upper body", status: "scheduled", planned_for: "2026-11-20" },
    { id: "p-undated", title: "Back and biceps", status: "draft", planned_for: null },
    { id: "p-legs", title: "Legs", status: "draft", planned_for: "2026-11-19" },
  ];
  const ITEMS: SavedPlanExercise[] = [
    { plan_id: "p-past", exercise_id: "bench_press", exercise_name: "Barbell Bench Press" },
    { plan_id: "p-soon", exercise_id: "lat_pulldown", exercise_name: "Lat Pulldown" },
    { plan_id: "p-soon", exercise_id: "push_up", exercise_name: "Push-Up" },
    { plan_id: "p-undated", exercise_id: "free-exercise-db-Pullups", exercise_name: "Pullups" },
    { plan_id: "p-undated", exercise_id: null, exercise_name: "My own chest move" },
    { plan_id: "p-legs", exercise_id: "barbell_back_squat", exercise_name: "Barbell Back Squat" },
  ];

  test("the member's plans: from the catalogue's muscles, merged ids read as their survivor, upcoming first", () => {
    const chest = plansTraining(PLANS, ITEMS, byId, "chest", "2026-11-18");
    assert.deepEqual(chest.map((match) => [match.plan.id, match.primary]), [["p-soon", ["Push-Up"]], ["p-past", ["Barbell Bench Press"]]]);
    const lats = plansTraining(PLANS, ITEMS, byId, "lats", "2026-11-18");
    assert.deepEqual(lats.map((match) => match.plan.id), ["p-soon", "p-undated"], "Pullups is the merged twin of pull_up");
    const biceps = plansTraining(PLANS, ITEMS, byId, "biceps", "2026-11-18");
    assert.ok(biceps.every((match) => match.primary.length === 0 && match.assisting.length > 0), "rows and pulldowns only assist the biceps");
    assert.deepEqual(plansTraining(PLANS, ITEMS, byId, "neck", "2026-11-18"), []);
  });

  test("loading saved plans: own plans where the database records it, else every listed plan", async () => {
    const calls: Array<{ table: string; filters: string[] }> = [];
    let enrolmentColumn = false;
    const client = {
      from(table: string) {
        const filters: string[] = [];
        const builder = {
          select: () => builder,
          eq: (column: string, value: unknown) => { filters.push(`${column}=eq.${String(value)}`); return builder; },
          in: (column: string, values: unknown[]) => { filters.push(`${column}=in.${values.length}`); return builder; },
          is: (column: string) => { filters.push(`${column}=is.null`); return builder; },
          order: () => builder,
          limit: () => builder,
          then: (resolve: (value: unknown) => unknown) => {
            calls.push({ table, filters });
            if (table === "workout_plans" && filters.some((filter) => filter.startsWith("programme_enrolment_id")) && !enrolmentColumn) {
              return Promise.resolve({ data: null, error: { code: "42703", message: "column workout_plans.programme_enrolment_id does not exist" } }).then(resolve);
            }
            if (table === "workout_plans") return Promise.resolve({ data: PLANS, error: null }).then(resolve);
            return Promise.resolve({ data: ITEMS, error: null }).then(resolve);
          },
        };
        return builder;
      },
    } as unknown as Pick<SupabaseClient, "from">;
    const loaded = await loadSavedPlans(client, "user-1");
    assert.equal(loaded.error, null);
    assert.equal(loaded.plans.length, 4);
    assert.deepEqual(calls.map((call) => call.table), ["workout_plans", "workout_plans", "workout_plan_exercises"], "retried without the column");
    enrolmentColumn = true;
    calls.length = 0;
    await loadSavedPlans(client, "user-1");
    assert.ok(calls[0].filters.includes("programme_enrolment_id=is.null"));
    assert.ok(calls[0].filters.includes("status=in.2"));
    assert.equal(SAVED_PLAN_LIMIT, 100);
  });
});

describe("dates and the light catalogue", () => {
  test("last trained and plan dates read on the local calendar", () => {
    assert.equal(lastTrainedText("2026-11-18", "2026-11-18"), "Today");
    assert.equal(lastTrainedText("2026-11-17", "2026-11-18"), "Yesterday");
    assert.equal(lastTrainedText("2026-11-14", "2026-11-18"), "4 days ago");
    assert.equal(lastTrainedText("2026-10-30", "2026-11-18"), "30 Oct 2026");
    assert.equal(shortDate("2026-11-20"), "Fri 20 Nov");
    assert.equal(shortDate("not a date"), "not a date");
  });

  test("the whole catalogue is read in pages, with the clean-up's columns when the database has them", async () => {
    const all = rows.filter((row) => row.is_active);
    const selects: string[] = [];
    const ranges: Array<[number, number]> = [];
    let v2 = false;
    const client = {
      from() {
        let select = "";
        let range: [number, number] = [0, 0];
        const builder = {
          select: (columns: string) => { select = columns; return builder; },
          eq: () => builder,
          order: () => builder,
          range: (from: number, to: number) => { range = [from, to]; return builder; },
          then: (resolve: (value: unknown) => unknown) => {
            selects.push(select);
            ranges.push(range);
            if (select.includes("catalog_version") && !v2) return Promise.resolve({ data: null, error: { code: "42703", message: "column exercise_library.category does not exist" } }).then(resolve);
            // Twice the catalogue, so a second page is needed; only the selected columns come back.
            const doubled = [...all, ...all.map((row) => ({ ...row, id: `${row.id}-copy` }))];
            const columns = select.split(",");
            const page = doubled.slice(range[0], range[1] + 1).map((row) => Object.fromEntries(columns.map((column) => [column, (row as Record<string, unknown>)[column] ?? null])));
            return Promise.resolve({ data: page, error: null }).then(resolve);
          },
        };
        return builder;
      },
    } as unknown as Pick<SupabaseClient, "from">;
    const legacy = await loadLightCatalogue(client);
    assert.equal(legacy.error, null);
    assert.equal(legacy.exercises.length, all.length * 2);
    assert.equal(legacy.curated, false);
    assert.deepEqual(ranges.filter((_, index) => !selects[index].includes("catalog_version")), [[0, CATALOGUE_BATCH - 1], [CATALOGUE_BATCH, 2 * CATALOGUE_BATCH - 1]]);
    assert.equal(selects.filter((select) => select.includes("catalog_version")).length, 1, "the missing columns are asked for once");
    v2 = true;
    const curated = await loadLightCatalogue(client);
    assert.equal(curated.curated, true);
    assert.ok(curated.exercises.every((exercise) => REGIONS[exercise.muscle_group as never] || exercise.muscle_group));
  });
});
