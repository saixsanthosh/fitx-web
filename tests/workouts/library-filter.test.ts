import { test } from "node:test";
import assert from "node:assert/strict";
import { filterLibrary, LIBRARY_PAGE_SIZE, matchesQuery, nextVisibleCount } from "@/app/(dashboard)/workouts/_lib/library-filter";
import type { CatalogExercise } from "@/lib/training/catalog";

function exercise(id: string, overrides: Partial<CatalogExercise> = {}): CatalogExercise {
  return {
    id, name: id, primary_muscle: "chest", secondary_muscles: [], muscle_group: "chest", category: "strength", mechanic: "compound",
    required_equipment: [], locations: ["gym", "home"], difficulty: "beginner", movement_pattern: "push", prescription_type: "reps",
    recommended_sets: 3, reps_min: 8, reps_max: 12, rest_seconds: 90, default_duration_seconds: null, alternatives: [], source_ref: null, curated: true,
    ...overrides,
  };
}

const bench = exercise("bench_press", { name: "Bench Press", required_equipment: ["barbell", "bench"] });
const pushUp = exercise("push_up", { name: "Push-Up" });
const crunch = exercise("crunch", { name: "Crunch", primary_muscle: "abdominals", muscle_group: "core", mechanic: "isolation" });
const plank = exercise("plank", { name: "Plank", primary_muscle: "abdominals", muscle_group: "core", mechanic: "isolation", prescription_type: "time" });
const squat = exercise("squat", { name: "Barbell Squat", primary_muscle: "quadriceps", muscle_group: "quadriceps", required_equipment: ["barbell", "squat_rack"], secondary_muscles: ["glutes", "hamstrings"] });
const curl = exercise("curl", { name: "Dumbbell Curl", primary_muscle: "biceps", muscle_group: "biceps", mechanic: "isolation", required_equipment: ["dumbbell"] });
const lats = exercise("pulldown", { name: "Lat Pulldown", primary_muscle: "lats", muscle_group: "back", required_equipment: ["cable_machine"] });
const CATALOG = [bench, curl, crunch, lats, plank, pushUp, squat];
const ids = (list: readonly CatalogExercise[]) => list.map((item) => item.id);

test("search matches every word in the name or main muscle, and body-area words find what trains the area", () => {
  assert.equal(matchesQuery(bench, "bench"), true);
  assert.equal(matchesQuery(bench, "press bench"), true, "words in any order");
  assert.equal(matchesQuery(lats, "lats"), true, "the main muscle");
  assert.equal(matchesQuery(squat, "quadriceps"), true);
  assert.equal(matchesQuery(crunch, "abs"), true, "'abs' finds abdominal exercises");
  assert.equal(matchesQuery(plank, "belly"), true);
  assert.equal(matchesQuery(squat, "legs"), true, "'legs' finds a quadriceps exercise");
  assert.equal(matchesQuery(curl, "arms"), true);
  assert.equal(matchesQuery(lats, "back"), true, "'back' finds lats, not only the word 'back'");
  assert.equal(matchesQuery(bench, "arms"), false);
  assert.equal(matchesQuery(bench, ""), true);
});

test("an area filter keeps the exercises that train it as their main muscle", () => {
  assert.deepEqual(ids(filterLibrary(CATALOG, { query: "", area: "abs", doableOnly: false })).sort(), ["crunch", "plank"]);
  assert.deepEqual(ids(filterLibrary(CATALOG, { query: "", area: "legs", doableOnly: false })), ["squat"], "glutes and hamstrings only assist the squat");
  assert.deepEqual(ids(filterLibrary(CATALOG, { query: "plank", area: "abs", doableOnly: false })), ["plank"]);
});

test("only what I can do: exercises whose equipment the member has; otherwise doable ones come first", () => {
  const owned = new Set(["dumbbell"]);
  assert.deepEqual(ids(filterLibrary(CATALOG, { query: "", area: null, doableOnly: true }, owned)), ["curl", "crunch", "plank", "push_up"]);
  assert.deepEqual(ids(filterLibrary(CATALOG, { query: "", area: null, doableOnly: false }, owned)), ["curl", "crunch", "plank", "push_up", "bench_press", "pulldown", "squat"]);
  assert.deepEqual(ids(filterLibrary(CATALOG, { query: "", area: "chest", doableOnly: true }, owned)), ["push_up"]);
  assert.equal(filterLibrary(CATALOG, { query: "", area: null, doableOnly: false }).length, CATALOG.length, "without a list nothing is left out");
});

test("results are never cut off: every match is returned and shown a page at a time", () => {
  const many = Array.from({ length: 95 }, (_, index) => exercise(`row-${String(index).padStart(3, "0")}`, { name: `Row ${index}` }));
  assert.equal(filterLibrary(many, { query: "row", area: null, doableOnly: false }).length, 95);
  assert.equal(nextVisibleCount(LIBRARY_PAGE_SIZE, 95), 60);
  assert.equal(nextVisibleCount(90, 95), 95);
  assert.equal(nextVisibleCount(0, 95), LIBRARY_PAGE_SIZE);
  assert.equal(nextVisibleCount(30, 12), 12);
});
