// Tests for the exercise catalogue clean-up (scripts/catalog) and its generated migration.
// Run with: node --import ./tests/setup/hooks.mjs --test scripts/catalog/catalog.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { MERGED_EXERCISE_IDS, survivingExerciseIds } from "../../src/lib/training/exercise-merges.ts";
import { EQUIPMENT, EQUIPMENT_COVERS, EXERCISE_CATEGORIES, MECHANICS, MUSCLE_TO_GROUP, PRESCRIPTION_TYPES } from "../../src/lib/training/taxonomy.ts";
import { loadCatalog, readUpstreamExercises, readUpstreamSnapshot, summarizeCatalog, validateCatalog, writeUpstreamSnapshot } from "./catalog.mjs";
import * as curation from "./curation.mjs";
import { MIGRATION_PATH, generateMigration } from "./migration.mjs";
import { ruleEquipment } from "./rules.mjs";
import { IMPORT_DEFAULTS, REPO_ROOT, loadSources, parseSqlTuples } from "./source.mjs";

const rows = loadCatalog();
const byId = new Map(rows.map((row) => [row.id, row]));
const byName = new Map(rows.map((row) => [row.name, row]));
const named = (name) => {
  const row = byName.get(name);
  assert.ok(row, `no catalogue row named "${name}"`);
  return row;
};
const homeFriendly = new Set(EQUIPMENT.filter((item) => item.homeFriendly).map((item) => item.key));
const equipmentKeys = new Set(EQUIPMENT.map((item) => item.key));

test("reads 30 starter rows and 876 imported rows, 8 of which never reached the database", () => {
  const sources = loadSources();
  assert.equal(sources.starter.length, 30);
  assert.equal(sources.imported.length, 876);
  assert.deepEqual(sources.skippedImports.map((row) => row.name).sort(), [
    "Bodyweight Squat", "Dead Bug", "Dumbbell Bench Press", "Dumbbell Shoulder Press", "Goblet Squat",
    "Incline Dumbbell Press", "One-Arm Dumbbell Row", "Romanian Deadlift",
  ]);
  assert.equal(rows.length, 898);
  assert.equal(new Set(rows.map((row) => row.id)).size, 898);
  assert.equal(rows.filter((row) => row.origin === "starter").length, 30);
});

test("the starter-row parser handles doubled quotes, arrays and numbers", () => {
  assert.deepEqual(parseSqlTuples("('a''b', array['x','y'], 3), ('c', array[]::text[], -1)"), [["a'b", ["x", "y"], 3], ["c", [], -1]]);
});

test("the catalogue passes every check the migration and the app rely on", () => {
  assert.deepEqual(validateCatalog(rows), []);
});

test("every row uses the shared vocabulary", () => {
  for (const row of rows) {
    assert.ok(EXERCISE_CATEGORIES.includes(row.category), `${row.id} category ${row.category}`);
    assert.equal(row.muscle_group, MUSCLE_TO_GROUP[row.primary_muscle], `${row.id} muscle_group`);
    assert.ok(PRESCRIPTION_TYPES.includes(row.prescription_type), `${row.id} prescription_type`);
    if (row.category === "stretching" || row.category === "cardio") {
      assert.equal(row.mechanic, null, `${row.id} mechanic`);
      assert.equal(row.prescription_type, "time", `${row.id} is timed`);
    } else {
      assert.ok(MECHANICS.includes(row.mechanic), `${row.id} mechanic ${row.mechanic}`);
    }
    for (const key of row.required_equipment) assert.ok(equipmentKeys.has(key), `${row.id} equipment ${key}`);
    if (row.prescription_type === "time") assert.ok(row.default_duration_seconds >= 5, `${row.id} duration`);
    else assert.equal(row.default_duration_seconds, null, `${row.id} duration`);
    assert.equal(row.catalog_version, 1);
  }
});

test("locations are always the gym, and home when every item is home-friendly", () => {
  for (const row of rows) {
    const home = row.required_equipment.every((key) => homeFriendly.has(key));
    assert.deepEqual(row.locations, home ? ["gym", "home"] : ["gym"], row.id);
  }
});

test("required equipment never lists an item another listed item covers", () => {
  for (const row of rows) {
    const covered = new Set(row.required_equipment.flatMap((key) => EQUIPMENT_COVERS[key] ?? []));
    assert.deepEqual(row.required_equipment.filter((key) => covered.has(key)), [], row.id);
  }
});

test("every alternative is an existing, active id other than the row itself", () => {
  for (const row of rows) {
    for (const alternative of row.alternatives) {
      assert.ok(byId.get(alternative)?.is_active, `${row.id} -> ${alternative}`);
      assert.notEqual(alternative, row.id);
    }
    if (row.origin !== "starter") assert.deepEqual(row.alternatives, [], `${row.id} keeps no alternatives`);
  }
  assert.deepEqual(byId.get("push_up").alternatives, ["dumbbell_bench_press", "free-exercise-db-Incline_Push-Up"]);
  assert.deepEqual(byId.get("one_arm_dumbbell_row").alternatives, ["seated_cable_row", "barbell_row"]);
  assert.deepEqual(byId.get("plank").alternatives, ["dead_bug", "free-exercise-db-Side_Bridge"]);
  assert.deepEqual(byId.get("dead_bug").alternatives, ["plank"]);
});

test("pull-up rows need a pull-up bar, which is what makes them home-capable", () => {
  for (const name of ["Pullups", "Chin-Up", "V-Bar Pullup", "Hanging Leg Raise"]) {
    assert.deepEqual(named(name).required_equipment, ["pull_up_bar"], name);
    assert.deepEqual(named(name).locations, ["gym", "home"], name);
  }
  assert.deepEqual(byId.get("pull_up").required_equipment, ["pull_up_bar"]);
});

test("bodyweight rows that need apparatus say so", () => {
  assert.deepEqual(named("Dips - Triceps Version").required_equipment, ["dip_station"]);
  assert.deepEqual(named("Dips - Triceps Version").locations, ["gym"]);
  assert.deepEqual(named("Bench Dips").required_equipment, ["bench"]);
  assert.deepEqual(named("Front Box Jump").required_equipment, ["box"]);
  assert.deepEqual(named("Dumbbell Step Ups").required_equipment, ["dumbbell", "box"]);
  assert.deepEqual(named("Incline Push-Up").required_equipment, ["box"]);
  assert.deepEqual(named("Decline Push-Up").required_equipment, ["box"]);
  assert.deepEqual(named("Ring Dips").required_equipment, ["suspension_trainer"]);
  assert.deepEqual(named("Pushups").required_equipment, []);
  assert.deepEqual(named("Rope Jumping").required_equipment, ["jump_rope"]);
});

test("strongman implements, sleds and specialist kit keep a row out of home workouts", () => {
  for (const name of ["Atlas Stones", "Yoke Walk", "Log Lift", "Tire Flip", "Keg Load"]) {
    assert.equal(named(name).category, "strongman", name);
    assert.deepEqual(named(name).locations, ["gym"], name);
  }
  assert.deepEqual(named("Atlas Stones").required_equipment, ["strongman_implements"]);
  assert.deepEqual(named("Sled Push").required_equipment, ["sled"]);
  assert.ok(named("Landmine 180's").required_equipment.includes("barbell"));
});

test("the review's category examples come out right", () => {
  for (const name of ["Adductor/Groin", "All Fours Quad Stretch", "90/90 Hamstring", "Elbow Circles", "Adductor", "Calves-SMR", "Iliotibial Tract-SMR"]) {
    assert.equal(named(name).category, "stretching", name);
  }
  for (const name of ["Bicycling, Stationary", "Elliptical Trainer", "Rowing, Stationary", "Jogging, Treadmill", "Stairmaster"]) {
    assert.equal(named(name).category, "cardio", name);
    assert.deepEqual(named(name).required_equipment, ["cardio_machine"], name);
    assert.equal(named(name).default_duration_seconds, 600, name);
  }
  for (const name of ["Alternating Hang Clean", "Clean and Jerk", "Power Snatch", "Split Jerk", "Hang Clean"]) {
    assert.equal(named(name).category, "olympic", name);
  }
  for (const name of ["Box Squat with Bands", "Box Squat with Chains", "Bench Press - Powerlifting", "Reverse Band Deadlift"]) {
    assert.equal(named(name).category, "strength", name);
  }
});

test("the plank is timed, and timed rows log one effort per set", () => {
  const plank = byId.get("plank");
  assert.equal(plank.prescription_type, "time");
  assert.equal(plank.default_duration_seconds, 30);
  assert.deepEqual([plank.recommended_sets, plank.reps_min, plank.reps_max, plank.rest_seconds], [3, 1, 1, 60]);
  assert.equal(named("Side Bridge").prescription_type, "time");
  assert.equal(named("Farmer's Walk").prescription_type, "time");
  assert.equal(byId.get("jumping_jack").category, "cardio");
  assert.equal(byId.get("jumping_jack").default_duration_seconds, 30);
});

test("starter rows resolve alternatives in their equipment tags to one realistic requirement", () => {
  const expected = {
    goblet_squat: ["dumbbell"], lat_pulldown: ["cable_machine"], seated_cable_row: ["cable_machine"],
    bench_press: ["barbell", "bench"], barbell_back_squat: ["barbell", "squat_rack"],
    one_arm_dumbbell_row: ["dumbbell", "bench"], step_up: ["bench"], push_up: [], band_row: ["resistance_band"],
  };
  for (const [id, equipment] of Object.entries(expected)) assert.deepEqual(byId.get(id).required_equipment, equipment, id);
});

test("starter rows keep their curated sets, reps and rest unless timed", () => {
  const { starter } = loadSources();
  for (const source of starter) {
    const row = byId.get(source.id);
    assert.equal(row.recommended_sets, source.recommended_sets, source.id);
    assert.equal(row.rest_seconds, source.rest_seconds, source.id);
    if (row.prescription_type === "reps") assert.deepEqual([row.reps_min, row.reps_max], [source.reps_min, source.reps_max], source.id);
  }
});

test("imported rows get defaults by category instead of the blanket 3 x 8-12 / 90 s", () => {
  const blanket = rows.filter((row) => row.origin !== "starter" && row.recommended_sets === IMPORT_DEFAULTS.recommended_sets
    && row.reps_min === IMPORT_DEFAULTS.reps_min && row.reps_max === IMPORT_DEFAULTS.reps_max && row.rest_seconds === IMPORT_DEFAULTS.rest_seconds);
  assert.deepEqual(blanket.map((row) => row.id), []);
  assert.deepEqual([named("Barbell Deadlift").reps_min, named("Barbell Deadlift").reps_max, named("Barbell Deadlift").rest_seconds], [6, 10, 120]);
  assert.deepEqual([named("Hammer Curls").reps_min, named("Hammer Curls").reps_max, named("Hammer Curls").rest_seconds], [10, 15, 60]);
  assert.deepEqual([named("Power Clean").recommended_sets, named("Power Clean").reps_min, named("Power Clean").reps_max], [4, 3, 5]);
});

test("the app's list of merged exercises matches the clean-up, so saved and recent ids read as their survivor", () => {
  const merges = Object.fromEntries(rows.filter((row) => row.merged_into).map((row) => [row.id, row.merged_into]));
  assert.deepEqual(MERGED_EXERCISE_IDS, merges, "update src/lib/training/exercise-merges.ts to the clean-up's merges");
  assert.deepEqual(survivingExerciseIds(["free-exercise-db-Pushups", "push_up", "squat_unknown", "free-exercise-db-Plank"]), ["push_up", "squat_unknown", "plank"]);
});

test("merged duplicates are hidden and point at an active starter survivor that takes their photos", () => {
  const merged = rows.filter((row) => row.merged_into);
  assert.equal(merged.length, curation.DUPLICATES.length);
  for (const row of merged) {
    const survivor = byId.get(row.merged_into);
    assert.equal(row.is_active, false, row.id);
    assert.equal(survivor.is_active, true, row.id);
    assert.equal(survivor.origin, "starter", row.id);
    assert.equal(survivor.merged_into, null, row.id);
  }
  for (const [duplicate, survivor] of [["Pushups", "push_up"], ["Pullups", "pull_up"], ["Plank", "plank"], ["Seated Cable Rows", "seated_cable_row"]]) {
    assert.equal(named(duplicate).merged_into, survivor, duplicate);
    assert.equal(byId.get(survivor).source_ref, named(duplicate).source_ref, survivor);
  }
  assert.equal(rows.filter((row) => !row.is_active).length, merged.length);
});

test("source_ref is the upstream id: imported rows, exact-name twins and merged duplicates", () => {
  for (const row of rows.filter((item) => item.origin !== "starter")) assert.equal(`free-exercise-db-${row.source_ref}`, row.id);
  assert.equal(byId.get("goblet_squat").source_ref, "Goblet_Squat");
  assert.equal(byId.get("dead_bug").source_ref, "Dead_Bug");
  assert.equal(byId.get("romanian_deadlift").source_ref, "Romanian_Deadlift");
  assert.equal(byId.get("cable_fly").source_ref, null);
});

test("the equipment rules read apparatus from the name and the instructions", () => {
  const row = (name, equipment, instructions) => ({ id: name, name, description: "", instructions, equipment, movement_pattern: "pull" });
  assert.deepEqual(ruleEquipment(row("Test Pull", ["bodyweight"], ["Grab the pull-up bar."])).keys, ["pull_up_bar"]);
  assert.deepEqual(ruleEquipment(row("Test Hop", ["other"], ["Set up a row of cones."])).keys, []);
  assert.deepEqual(ruleEquipment(row("Mystery Move", ["other"], ["Do the thing."])).keys, ["specialty"]);
  assert.deepEqual(ruleEquipment(row("Test Press", ["barbell"], ["Lie on a flat bench and lift the bar from the rack."])).keys.sort(), ["barbell", "bench"]);
  assert.deepEqual(ruleEquipment(row("Test Squat", ["barbell"], ["Set the bar on a rack just below shoulder level."])).keys.sort(), ["barbell", "squat_rack"]);
});

test("--upstream: upstream category and mechanic beat the rules but not the curated corrections", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "fitx-catalog-"));
  try {
    const exercises = path.join(dir, "exercises.json");
    writeFileSync(exercises, JSON.stringify([
      { id: "Crunches", category: "powerlifting", mechanic: "compound" },
      { id: "Barbell_Curl", category: "strength", mechanic: "compound" },
      { id: "90_90_Hamstring", category: "strength", mechanic: "isolation" },
      { id: "Not_In_The_Catalogue", category: "cardio", mechanic: null },
    ]));
    const snapshot = path.join(dir, "snapshot.json");
    assert.equal(writeUpstreamSnapshot(readUpstreamExercises(exercises), { file: snapshot }), 3);
    const upstream = readUpstreamSnapshot(REPO_ROOT, snapshot);
    const withUpstream = new Map(loadCatalog({ upstream }).map((row) => [row.name, row]));
    assert.equal(withUpstream.get("Crunches").category, "strength");
    assert.equal(withUpstream.get("Crunches").mechanic, "compound");
    assert.equal(withUpstream.get("Barbell Curl").mechanic, "compound");
    assert.equal(withUpstream.get("90/90 Hamstring").category, "stretching");
    assert.equal(withUpstream.get("90/90 Hamstring").mechanic, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("curated tables only name real rows and always give a reason", () => {
  for (const table of [curation.CATEGORY, curation.MECHANIC, curation.PRESCRIPTION, curation.DURATION, curation.EQUIPMENT]) {
    for (const [name, [, reason]] of Object.entries(table)) {
      assert.ok(byName.has(name), name);
      assert.ok(reason, name);
    }
  }
});

test("the committed migration is exactly what the generator produces", () => {
  const committed = readFileSync(path.join(REPO_ROOT, MIGRATION_PATH), "utf8");
  const { text } = generateMigration();
  assert.ok(committed === text, `${MIGRATION_PATH} is out of date: run node scripts/catalog/build-catalog.mjs`);
  const summary = summarizeCatalog(rows);
  assert.ok(committed.includes(`all ${summary.rows} catalogue rows`));
  assert.equal((committed.match(/^\{"id":/gm) ?? []).length, 898);
});
