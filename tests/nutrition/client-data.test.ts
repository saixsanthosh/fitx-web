import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  customFoodResult, customFoodRowValues, customFoodWarning, detectCapabilities, entryBasis, entryPer100g, entryUpdate, isMissingSchema, loadRecentFoods,
  foodFromEntry, removeCustomFood, removeCustomFoodPhoto, rowsFromItems, savedFoodSource, targetProblem, usualAmount, withCurrentCustomFoods, type CustomFoodRow, type MealEntry,
  type MealTemplateItem,
} from "@/lib/food/client-data";

const idliEntry: MealEntry = {
  id: "m1", date: "2026-11-17", meal: "Breakfast", food_name: "Idli", brand: null, barcode: null, servings: 1.14,
  calories: 145.9, protein: 7.3, carbs: 28.5, fat: 0.4, quantity_grams: 114, source: "USDA FoodData Central", provider_id: "2708346",
  serving_size: "3 × 1 item (114 g)",
  nutrition_snapshot: { per_100g: { calories: 128, protein: 6.36, carbs: 24.98, fat: 0.35 }, data_type: "Survey (FNDDS)", portion: { count: 3, label: "1 item", unit: "piece", grams_each: 38, estimate: true } },
};

test("per-100 g values come from the snapshot, or from older entries' totals and grams", () => {
  assert.deepEqual(entryPer100g(idliEntry), { calories: 128, protein: 6.36, carbs: 24.98, fat: 0.35, missing: [] });
  const older = { ...idliEntry, nutrition_snapshot: {}, quantity_grams: 200, calories: 300, protein: 10, carbs: 40, fat: 8 };
  assert.deepEqual(entryPer100g(older), { calories: 150, protein: 5, carbs: 20, fat: 4, missing: [] });
  assert.equal(entryPer100g({ ...older, quantity_grams: null }), null);
  assert.equal(entryBasis(idliEntry), "recipe_calculated");
  assert.equal(entryBasis({ ...idliEntry, source: "Open Food Facts", nutrition_snapshot: {} }), "label");
  assert.equal(entryBasis({ ...idliEntry, nutrition_snapshot: { value_basis: "ai_suggested" } }), "ai_suggested");
});

test("a frequent food is chosen again at the amount it was logged as, not a typed one", () => {
  assert.deepEqual(usualAmount(idliEntry), { amount: 3, unitKey: "portion:0" });
  assert.equal(foodFromEntry(idliEntry)?.portions[0]?.label, "1 item", "portion:0 is the entry's own portion");
  assert.deepEqual(usualAmount({ ...idliEntry, nutrition_snapshot: {}, quantity_grams: 150 }), { amount: 150, unitKey: "g" });
  assert.deepEqual(usualAmount({ ...idliEntry, nutrition_snapshot: { portion: { count: 0, label: "1 item", unit: "piece", grams_each: 38 } } }), { amount: 114, unitKey: "g" });
  assert.equal(usualAmount({ ...idliEntry, nutrition_snapshot: {}, quantity_grams: null }), null);
});

test("editing an entry recomputes its totals and keeps or drops its portion", () => {
  const four = entryUpdate(idliEntry, { grams: 152, servingSize: "4 × 1 item (152 g)", portion: { ...idliEntry.nutrition_snapshot!.portion, count: 4 }, meal: "Dinner", date: "2026-11-16" });
  assert.equal(four.calories, 194.6);
  assert.equal(four.quantity_grams, 152);
  assert.equal(four.meal, "Dinner");
  assert.equal(four.date, "2026-11-16");
  assert.equal(four.nutrition_snapshot.portion?.count, 4);
  const grams = entryUpdate(idliEntry, { grams: 100, servingSize: "100 g", portion: null, meal: "Breakfast", date: "2026-11-17" });
  assert.equal(grams.calories, 128);
  assert.equal("portion" in grams.nutrition_snapshot, false);
});

test("saved items become new entries for the chosen day and meal", () => {
  const item: MealTemplateItem = { meal_slot: "Breakfast", food_name: "Idli", brand: null, source: "USDA FoodData Central", provider_id: "2708346", serving_size: "3 × 1 item (114 g)", quantity_grams: 114, calories: 145.9, protein: 7.3, carbs: 28.5, fat: 0.4, nutrition_snapshot: idliEntry.nutrition_snapshot };
  const [row] = rowsFromItems("u1", "2026-11-18", [item], null);
  assert.deepEqual({ user: row.user_id, date: row.date, meal: row.meal, grams: row.quantity_grams, servings: row.servings, kcal: row.calories }, { user: "u1", date: "2026-11-18", meal: "Breakfast", grams: 114, servings: 1.14, kcal: 145.9 });
  assert.equal(rowsFromItems("u1", "2026-11-18", [item], "Dinner")[0].meal, "Dinner");
  assert.equal(rowsFromItems("u1", "2026-11-18", [{ ...item, meal_slot: "Snack" }], null)[0].meal, "Snack");
  assert.equal(rowsFromItems("u1", "2026-11-18", [{ ...idliEntry, meal: "Pre-workout" }], null)[0].meal, "Pre-workout", "a logged entry keeps its own meal section");
});

test("target checks: a range, and a warning when macros don't add up", () => {
  assert.deepEqual(targetProblem({ calories: 2200, protein: 140, carbs: 250, fat: 70 }), { error: null, warning: null });
  assert.match(targetProblem({ calories: 700, protein: 50, carbs: 50, fat: 20 }).error ?? "", /between 800 and 8,000/);
  assert.match(targetProblem({ calories: 2200, protein: 100, carbs: 100, fat: 50 }).warning ?? "", /add up to about 1,250 kcal/);
  assert.match(targetProblem({ calories: 1000, protein: 75, carbs: 100, fat: 33 }).warning ?? "", /very low/);
  assert.match(targetProblem({ calories: Number.NaN, protein: 1, carbs: 1, fat: 1 }).error ?? "", /number/);
});

test("custom foods are stored per 100 g from per-serving values, with v2 fields only once they exist", () => {
  const input = { name: " Poha ", brand: "", servingLabel: "1 bowl", servingGrams: 200, calories: 260, protein: 5, carbs: 48, fat: 6, barcode: null, valueBasis: "user_entered" as const, origin: "user" as const };
  const v1 = customFoodRowValues(input, false);
  assert.deepEqual(v1, { name: "Poha", brand: null, serving_size: "1 bowl", serving_grams: 200, calories_per_100g: 130, protein_per_100g: 2.5, carbs_per_100g: 24, fat_per_100g: 3 });
  const v2 = customFoodRowValues({ ...input, barcode: "8901063011366", valueBasis: "label", origin: "barcode" }, true);
  assert.ok("barcode" in v2, "v2 rows carry the v2 fields");
  assert.deepEqual([v2.barcode, v2.origin, v2.value_basis], ["8901063011366", "barcode", "label"]);
  assert.equal(customFoodWarning(260, 5, 48, 6), null);
  assert.match(customFoodWarning(600, 5, 48, 6) ?? "", /add up to about 266 kcal/);
});

test("a custom food row becomes a result with its saved serving", () => {
  const food = customFoodResult({ id: "c1", name: "Poha", brand: null, serving_size: "1 bowl", serving_grams: 200, calories_per_100g: 130, protein_per_100g: 2.5, carbs_per_100g: 24, fat_per_100g: 3, origin: "user", value_basis: "user_entered" });
  assert.deepEqual(food.portions, [{ label: "1 serving (1 bowl, 200 g)", unit: "serving", grams: 200, countDefault: true, estimate: false }]);
  assert.equal(food.basis, "Your food · Your entry");
});

test("recognises the errors for tables and columns that do not exist yet", () => {
  for (const code of ["PGRST205", "42P01", "PGRST204", "42703"]) assert.equal(isMissingSchema({ code }), true, code);
  assert.equal(isMissingSchema({ code: "42501" }), false);
  assert.equal(isMissingSchema(null), false);
});

/** A Supabase client that records every table write and storage removal, answering each table with a fixed result. */
function recordingSupabase(results: Record<string, { data?: unknown; error: { code: string } | null }> = {}) {
  const log: string[] = [];
  const query = (table: string) => {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "order", "limit", "update", "delete"]) {
      builder[method] = (...args: unknown[]) => {
        if (method === "update" || method === "delete") log.push(`${table}.${method}${method === "update" ? ` ${JSON.stringify(args[0])}` : ""}`);
        return builder;
      };
    }
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(results[table] ?? { data: [], error: null }).then(resolve);
    return builder;
  };
  const client = {
    from: (table: string) => query(table),
    storage: { from: (bucket: string) => ({ remove: async (paths: string[]) => { log.push(`storage ${bucket} remove ${paths.join(",")}`); return { data: [], error: null }; } }) },
  };
  return { client: client as unknown as SupabaseClient, log };
}

const USER = "aaaaaaaa-0000-4000-8000-000000000001";
const shake: CustomFoodRow = { id: "c1", name: "Protein shake", brand: null, serving_size: "1 glass", serving_grams: 300, calories_per_100g: 40, protein_per_100g: 8, carbs_per_100g: 2, fat_per_100g: 0.5, image_path: `${USER}/foods/c1-1.webp` };

test("Recent shows your own foods as saved now: edits apply and deleted foods drop out", () => {
  const recentShake = { ...customFoodResult({ ...shake, calories_per_100g: 400 }), recentCount: 0 };
  const recentGone = { ...customFoodResult({ ...shake, id: "c2", name: "Old bar" }) };
  const idli = { ...customFoodResult({ ...shake, id: "2708346", name: "Idli" }), kind: "catalog" as const, source: "USDA FoodData Central" };
  const shown = withCurrentCustomFoods([recentShake, recentGone, idli], [shake], (row) => `https://signed.example/${row.id}`);
  assert.deepEqual(shown.map((food) => [food.name, food.calories]), [["Protein shake", 40], ["Idli", 40]], "the shake at 40 kcal, not the 400 logged before the fix");
  assert.equal(shown[0].portions[0].label, "1 serving (1 glass, 300 g)");
  assert.equal(shown[0].image, "https://signed.example/c1");
  assert.equal(shown[1], idli, "catalogue foods pass through unchanged");
});

test("Recent keeps a food's diet label from when it was logged", async () => {
  const entry = { ...idliEntry, id: "m2", provider_id: "2706538", food_name: "Biryani with chicken", nutrition_snapshot: { ...idliEntry.nutrition_snapshot, diet_type: "non_veg" as const } };
  const { client } = recordingSupabase({ meals: { data: [entry, idliEntry], error: null } });
  const recent = await loadRecentFoods(client, USER);
  assert.deepEqual(recent.map((food) => [food.name, food.dietType]), [["Biryani with chicken", "non_veg"], ["Idli", null]]);
});

test("a missing table turns a feature off; a failed request does not", async () => {
  const missing = recordingSupabase({ custom_foods: { error: { code: "42703" } }, meal_templates: { error: { code: "PGRST205" } }, nutrition_targets: { error: null } });
  assert.deepEqual(await detectCapabilities(missing.client), { customFoodsV2: false, templates: false, targets: true, customExtra: false });
  const flaky = recordingSupabase({ custom_foods: { error: { code: "PGRST000" } }, meal_templates: { error: { code: "57014" } }, nutrition_targets: { error: { code: "503" } } });
  assert.deepEqual(await detectCapabilities(flaky.client), { customFoodsV2: true, templates: true, targets: true, customExtra: false });
});

test("deleting a food deletes the row and then its photo; removing a photo clears it first", async () => {
  const deleted = recordingSupabase();
  await removeCustomFood(deleted.client, USER, shake);
  assert.deepEqual(deleted.log, ["custom_foods.delete", `storage fitx-user-media remove ${USER}/foods/c1-1.webp`]);
  const failed = recordingSupabase({ custom_foods: { error: { code: "42501" } } });
  await removeCustomFood(failed.client, USER, shake);
  assert.deepEqual(failed.log, ["custom_foods.delete"], "the photo stays when the food could not be deleted");
  const photo = recordingSupabase();
  await removeCustomFoodPhoto(photo.client, USER, shake);
  assert.deepEqual(photo.log, [`custom_foods.update {"image_path":null,"image_url":null,"image_attribution":null}`, `storage fitx-user-media remove ${USER}/foods/c1-1.webp`]);
  const elsewhere = recordingSupabase();
  await removeCustomFood(elsewhere.client, USER, { id: "c3", image_path: "someone-else/foods/x.webp" });
  assert.deepEqual(elsewhere.log, ["custom_foods.delete"], "only files in the user's own folder are removed");
});

test("an edit keeps where unchanged values came from; changed values become the user's", () => {
  const coachRecipe = { origin: "ai_coach" as const, value_basis: "recipe_calculated" as const };
  assert.deepEqual(savedFoodSource(coachRecipe, false, false, "user"), { origin: "ai_coach", valueBasis: "recipe_calculated" }, "a rename keeps the typical recipe");
  assert.deepEqual(savedFoodSource(coachRecipe, true, false, "user"), { origin: "user", valueBasis: "user_entered" }, "corrected numbers are the user's, not the coach's");
  assert.deepEqual(savedFoodSource(coachRecipe, true, true, "user"), { origin: "user", valueBasis: "label" });
  assert.deepEqual(savedFoodSource({ origin: "barcode", value_basis: "label" }, true, false, "user"), { origin: "barcode", valueBasis: "user_entered" }, "a scanned food stays a scanned food");
  assert.deepEqual(savedFoodSource({ origin: null, value_basis: null }, false, false, "user"), { origin: "user", valueBasis: "user_entered" }, "a food saved before the v2 columns");
  assert.deepEqual(savedFoodSource(null, true, true, "barcode"), { origin: "barcode", valueBasis: "label" }, "a new food from a scanned pack");
});
