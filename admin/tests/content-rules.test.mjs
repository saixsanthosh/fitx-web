// The Admin content forms, media rules and vocabulary: pure modules, checked against the FITX app's
// taxonomy and the content migration so the three never drift apart.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const vocabulary = await importTypeScriptModule("src/lib/content/vocabulary.ts");
const taxonomy = await importTypeScriptModule("../src/lib/training/taxonomy.ts");
const exercise = await importTypeScriptModule("src/lib/content/exercise-input.ts");
const food = await importTypeScriptModule("src/lib/content/food-input.ts");
const plan = await importTypeScriptModule("src/lib/content/plan-input.ts");
const media = await importTypeScriptModule("src/lib/content/media-rules.ts");
const errors = await importTypeScriptModule("src/lib/content/errors.ts");
const migration = await readFile(new URL("../../supabase/migrations/20261121100036_fitx_admin_content.sql", import.meta.url), "utf8");
const foodSchema = await readFile(new URL("../../supabase/migrations/20261118140000_fitx_food_catalog.sql", import.meta.url), "utf8");

function form(entries) {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

test("Admin's training vocabulary is the app's taxonomy, key for key", () => {
  assert.deepEqual([...vocabulary.MUSCLE_GROUPS], [...taxonomy.MUSCLE_GROUPS]);
  assert.deepEqual(vocabulary.MUSCLE_GROUP_LABELS, taxonomy.MUSCLE_GROUP_LABELS);
  assert.deepEqual({ ...vocabulary.MUSCLE_TO_GROUP }, { ...taxonomy.MUSCLE_TO_GROUP });
  assert.deepEqual([...vocabulary.EXERCISE_CATEGORIES], [...taxonomy.EXERCISE_CATEGORIES]);
  assert.deepEqual(vocabulary.CATEGORY_LABELS, taxonomy.CATEGORY_LABELS);
  assert.deepEqual([...vocabulary.LEVELS], [...taxonomy.LEVELS]);
  assert.deepEqual(
    vocabulary.EQUIPMENT.map(({ key, label, kind, homeFriendly }) => ({ key, label, kind, homeFriendly })),
    taxonomy.EQUIPMENT.map(({ key, label, kind, homeFriendly }) => ({ key, label, kind, homeFriendly })),
  );
});

test("the migration accepts the same muscle groups, categories, units and value bases as Admin's forms", () => {
  const groups = /v_group not in \(([^)]+)\)/.exec(migration)[1].match(/'([a-z_]+)'/g).map((word) => word.slice(1, -1));
  assert.deepEqual(groups, [...vocabulary.MUSCLE_GROUPS]);
  const categories = /v_category not in \(([^)]+)\)/.exec(migration)[1].match(/'([a-z_]+)'/g).map((word) => word.slice(1, -1));
  assert.deepEqual(categories, [...vocabulary.EXERCISE_CATEGORIES]);
  const units = /'unit', ''\) not in \(([^)]+)\)/.exec(migration)[1].match(/'([a-z]+)'/g).map((word) => word.slice(1, -1));
  assert.deepEqual(units, [...vocabulary.PORTION_UNITS]);
  const schemaUnits = /unit in \(([^)]+)\)/.exec(foodSchema)[1].match(/'([a-z]+)'/g).map((word) => word.slice(1, -1));
  assert.deepEqual(schemaUnits, [...vocabulary.PORTION_UNITS]);
  const bases = /v_basis not in \(([^)]+)\)/.exec(migration)[1].match(/'([a-z_]+)'/g).map((word) => word.slice(1, -1));
  assert.deepEqual(bases, [...vocabulary.VALUE_BASES]);
});

const exerciseFields = [
  ["name", "  Tempo Goblet Squat "],
  ["description", "A slow squat holding one dumbbell."],
  ["category", "strength"],
  ["mechanic", "compound"],
  ["movement_pattern", "squat"],
  ["difficulty", "beginner"],
  ["primary_muscle", "quadriceps"],
  ["secondary_muscles", "glutes"],
  ["secondary_muscles", "quadriceps"],
  ["required_equipment", "dumbbell"],
  ["prescription_type", "reps"],
  ["recommended_sets", "3"],
  ["reps_min", "8"],
  ["reps_max", "12"],
  ["rest_seconds", "90"],
  ["default_duration_seconds", ""],
  ["instructions", "Hold the bell at the chest.\r\n\r\n  Sit down between the heels.  \nStand up."],
  ["attribution", ""],
];

test("an exercise form becomes the database payload: group from the muscle, locations from the equipment", () => {
  const parsed = exercise.parseExerciseForm(form([...exerciseFields, ["is_active", "on"]]), { creating: true });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value, {
    name: "Tempo Goblet Squat",
    description: "A slow squat holding one dumbbell.",
    primary_muscle: "quadriceps",
    muscle_group: "quadriceps",
    secondary_muscles: ["glutes"],
    category: "strength",
    mechanic: "compound",
    difficulty: "beginner",
    movement_pattern: "squat",
    required_equipment: ["dumbbell"],
    equipment: ["dumbbell"],
    locations: ["gym", "home"],
    instructions: ["Hold the bell at the chest.", "Sit down between the heels.", "Stand up."],
    recommended_sets: 3,
    reps_min: 8,
    reps_max: 12,
    rest_seconds: 90,
    prescription_type: "reps",
    default_duration_seconds: null,
    attribution: "FITX",
    is_active: true,
  });
  const edit = exercise.parseExerciseForm(form(exerciseFields), { creating: false });
  assert.equal("is_active" in edit.value, false, "editing never changes visibility");
  assert.deepEqual(exercise.deriveLocations(["barbell", "bench"], false), ["gym"]);
  assert.deepEqual(exercise.deriveLocations([], true), ["gym", "home", "outdoor"]);
  const bodyweight = exercise.parseExerciseForm(form(exerciseFields.filter(([key]) => key !== "required_equipment")), { creating: false });
  assert.deepEqual(bodyweight.value.equipment, ["bodyweight"]);
});

test("exercise rules: names, reps in order, timed work needs a duration, only known equipment", () => {
  const replace = (key, value) => form(exerciseFields.map(([k, v]) => [k, k === key ? value : v]));
  assert.equal(exercise.parseExerciseForm(replace("name", "A"), { creating: true }).errors.name, "Use 2 to 120 characters.");
  assert.equal(exercise.parseExerciseForm(replace("reps_max", "4"), { creating: true }).errors.reps_max, "At least the lowest.");
  assert.ok(exercise.parseExerciseForm(replace("prescription_type", "time"), { creating: true }).errors.default_duration_seconds);
  assert.ok(exercise.parseExerciseForm(replace("required_equipment", "laser_cannon"), { creating: true }).errors.required_equipment);
  assert.ok(exercise.parseExerciseForm(replace("primary_muscle", "spleen"), { creating: true }).errors.primary_muscle);
  assert.ok(exercise.parseExerciseForm(replace("recommended_sets", "3.5"), { creating: true }).errors.recommended_sets);
  assert.ok(exercise.parseExerciseForm(replace("rest_seconds", "5"), { creating: true }).errors.rest_seconds);
  assert.ok(exercise.EXERCISE_ID.test("free-exercise-db-Barbell_Bench_Press_-_Medium_Grip"));
  assert.equal(exercise.EXERCISE_ID.test("../etc"), false);
});

const foodFields = [
  ["name", "Ragi dosa"],
  ["aliases", "Ragi Dosa, nachni dosa\nragi dosa"],
  ["keywords", ""],
  ["category", "Breakfast"],
  ["cuisine", "Indian"],
  ["diet_type", "veg"],
  ["state", "cooked"],
  ["kcal", "180"],
  ["protein_g", "4,5"],
  ["carbs_g", "30"],
  ["fat_g", "4.25"],
  ["fiber_g", ""],
  ["sugar_g", ""],
  ["sodium_mg", ""],
  ["value_basis", "label"],
  ["attribution", ""],
];

test("a food form: per 100 g, unknown nutrients stay null (never 0), names lower-cased once", () => {
  const parsed = food.parseFoodForm(form(foodFields), { creating: true });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value.aliases, ["ragi dosa", "nachni dosa"]);
  assert.equal(parsed.value.protein_g, 4.5);
  assert.equal(parsed.value.fiber_g, null);
  assert.equal(parsed.value.sodium_mg, null);
  assert.equal(parsed.value.cuisine, "indian");
  assert.equal(parsed.value.is_active, false);
  const replace = (key, value) => form(foodFields.map(([k, v]) => [k, k === key ? value : v]));
  assert.ok(food.parseFoodForm(replace("kcal", "1200"), { creating: true }).errors.kcal);
  assert.ok(food.parseFoodForm(replace("kcal", ""), { creating: true }).errors.kcal);
  assert.ok(food.parseFoodForm(replace("fat_g", "80"), { creating: true }).errors.fat_g, "macros over 100 g");
  assert.ok(food.parseFoodForm(replace("value_basis", "guess"), { creating: true }).errors.value_basis);
  assert.equal(food.energyFromMacros(10, 20, 5), 165);
  assert.equal(food.caloriesLookOff(165, 10, 20, 5), false);
  assert.equal(food.caloriesLookOff(400, 10, 20, 5), true);
});

test("portion rows: blanks skipped, one default by index, labels unique, units and grams checked", () => {
  const rows = (extra = []) => form([
    ["portion_label", "1 dosa"], ["portion_unit", "piece"], ["portion_grams", "85"], ["portion_measured", "true"],
    ["portion_label", ""], ["portion_unit", "piece"], ["portion_grams", ""], ["portion_measured", "false"],
    ["portion_label", "1 katori batter"], ["portion_unit", "katori"], ["portion_grams", "150.5"], ["portion_measured", "false"],
    ["portion_default", "2"],
    ...extra,
  ]);
  const parsed = food.parsePortionsForm(rows());
  assert.deepEqual(parsed, {
    ok: true,
    value: [
      { label: "1 dosa", unit: "piece", grams: 85, is_default: false, is_estimate: false },
      { label: "1 katori batter", unit: "katori", grams: 150.5, is_default: true, is_estimate: true },
    ],
  });
  const duplicate = food.parsePortionsForm(form([["portion_label", "1 cup"], ["portion_unit", "cup"], ["portion_grams", "200"], ["portion_label", "1 Cup"], ["portion_unit", "cup"], ["portion_grams", "210"]]));
  assert.equal(duplicate.ok, false);
  assert.equal(food.parsePortionsForm(form([["portion_label", "x"], ["portion_unit", "bucket"], ["portion_grams", "1"]])).ok, false);
  assert.equal(food.parsePortionsForm(form([["portion_label", "x"], ["portion_unit", "cup"], ["portion_grams", "0"]])).ok, false);
  assert.deepEqual(food.parsePortionsForm(form([])), { ok: true, value: [] });
});

test("plans: the price is read only when a plan is made, in paise; set Razorpay plan ids stay as they are", () => {
  assert.equal(plan.rupeesToPaise("199"), 19900);
  assert.equal(plan.rupeesToPaise("₹1,499.5"), 149950);
  assert.equal(plan.rupeesToPaise("1.999"), null);
  const fields = [["code", "Premium-Monthly"], ["name", "Premium"], ["features", "AI coach\n\nProgrammes"], ["price", "199"], ["billing_period", "monthly"], ["billing_interval", "1"], ["razorpay_plan_id_test", "plan_Test123"], ["is_active", "on"]];
  const created = plan.parsePlanForm(form(fields), { creating: true });
  assert.equal(created.ok, true);
  assert.equal(created.code, "premium-monthly");
  assert.deepEqual(created.value, { name: "Premium", description: null, features: ["AI coach", "Programmes"], is_active: true, sort_order: 0, razorpay_plan_id_test: "plan_Test123", razorpay_plan_id_live: null, amount_paise: 19900, billing_period: "monthly", billing_interval: 1 });
  const edited = plan.parsePlanForm(form([...fields, ["razorpay_plan_id_live", "plan_Live9"]]), { creating: false, existing: { test: "plan_Kept", live: null } });
  assert.equal(edited.value.razorpay_plan_id_test, "plan_Kept");
  assert.equal(edited.value.razorpay_plan_id_live, "plan_Live9");
  assert.equal("amount_paise" in edited.value, false);
  const yearly = plan.parsePlanForm(form([...fields.filter(([key]) => key !== "billing_period" && key !== "billing_interval"), ["billing_period", "yearly"], ["billing_interval", "2"]]), { creating: true });
  assert.ok(yearly.errors.billing_interval);
  assert.ok(plan.parsePlanForm(form([...fields.filter(([key]) => key !== "price"), ["price", "0.5"]]), { creating: true }).errors.price);
});

test("uploads: types and sizes per kind, paths inside one folder per item, matching the migration's rule", () => {
  assert.equal(media.checkDeclaredFile("still", "image/webp", 1024), null);
  assert.match(media.checkDeclaredFile("still", "image/svg+xml", 1024), /JPEG/);
  assert.match(media.checkDeclaredFile("still", "image/jpeg", 6 * 1024 * 1024), /5 MB/);
  assert.equal(media.checkDeclaredFile("video_loop", "video/mp4", 40 * 1024 * 1024), null);
  assert.match(media.checkDeclaredFile("video_loop", "video/quicktime", 1024), /MP4/);
  assert.match(media.checkDeclaredFile("food_photo", "image/png", 0), /empty/);
  const path = media.mediaPath("bench_press", "video_loop", "video/mp4", "AbCdEf123456");
  assert.equal(path, "admin/bench_press/video-AbCdEf123456.mp4");
  assert.equal(media.isMediaPathFor(path, "bench_press", "video_loop"), true);
  assert.equal(media.isMediaPathFor(path, "bench_press", "still"), false);
  assert.equal(media.isMediaPathFor("admin/bench_press/../x/video-AbCdEf123456.mp4", "bench_press", "video_loop"), false);
  assert.equal(media.isMediaPathFor(path, "other", "video_loop"), false);
  assert.equal(media.mediaPath("../up", "still", "image/jpeg", "AbCdEf123456"), null);
  assert.equal(media.mediaPath("x", "still", "video/mp4", "AbCdEf123456"), null);
  const sqlRule = new RegExp(/p_storage_path !~ '([^']+)'/.exec(migration)[1]);
  assert.match(path, sqlRule);
  assert.match(media.mediaPath("fitx-tempo-squat", "still", "image/avif", "Zz_-0123456789"), sqlRule);
  const foodRule = new RegExp(/p_image_url !~ '([^']+)'/.exec(migration)[1]);
  const photo = media.publicObjectUrl("https://abc.supabase.co/", "food-media", media.mediaPath("2706538", "food_photo", "image/jpeg", "AbCdEf123456"));
  assert.match(photo, foodRule);
  assert.equal(media.objectPathFromUrl(photo, "https://abc.supabase.co", "food-media"), "admin/2706538/photo-AbCdEf123456.jpg");
  assert.equal(media.objectPathFromUrl("https://images.openfoodfacts.org/x.jpg", "https://abc.supabase.co", "food-media"), null);
});

test("an upload's first bytes decide its real type", () => {
  const bytes = (...values) => new Uint8Array([...values, ...new Array(16).fill(0)]);
  const ascii = (text) => [...text].map((char) => char.charCodeAt(0));
  assert.equal(media.sniffMediaType(bytes(0xff, 0xd8, 0xff, 0xe0)), "image/jpeg");
  assert.equal(media.sniffMediaType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), "image/png");
  assert.equal(media.sniffMediaType(bytes(...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WEBP"))), "image/webp");
  assert.equal(media.sniffMediaType(bytes(0, 0, 0, 24, ...ascii("ftypavif"))), "image/avif");
  assert.equal(media.sniffMediaType(bytes(0, 0, 0, 24, ...ascii("ftypisom"))), "video/mp4");
  assert.equal(media.sniffMediaType(bytes(0x1a, 0x45, 0xdf, 0xa3)), "video/webm");
  assert.equal(media.sniffMediaType(bytes(...ascii("<!doctype html>"))), null);
  assert.equal(media.sniffMediaType(new Uint8Array(4)), null);
});

test("database errors become plain words without leaking anything unexpected", () => {
  assert.equal(errors.contentErrorMessage({ code: "42501", message: "Content permission required" }), "Your role cannot make this change.");
  assert.equal(errors.contentErrorMessage({ code: "FXC01", message: "This exercise is in use; hide it instead" }), "This exercise is in use; hide it instead.");
  assert.equal(errors.contentErrorMessage({ code: "XX000", message: "internal detail at line 4" }), "The change could not be saved. Nothing was changed.");
  assert.match(errors.contentErrorMessage({ code: "PGRST202", message: "x" }), /20261121100036_fitx_admin_content/);
});
