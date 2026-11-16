import { test } from "node:test";
import assert from "node:assert/strict";
import {
  customFoodResult, customFoodRowValues, customFoodWarning, entryBasis, entryPer100g, entryUpdate, isMissingSchema, rowsFromItems, targetProblem,
  type MealEntry, type MealTemplateItem,
} from "@/lib/food/client-data";

const idliEntry: MealEntry = {
  id: "m1", date: "2026-11-17", meal: "Breakfast", food_name: "Idli", brand: null, barcode: null, servings: 1.14,
  calories: 145.9, protein: 7.3, carbs: 28.5, fat: 0.4, quantity_grams: 114, source: "USDA FoodData Central", provider_id: "2708346",
  serving_size: "3 × 1 item (114 g)",
  nutrition_snapshot: { per_100g: { calories: 128, protein: 6.36, carbs: 24.98, fat: 0.35 }, data_type: "Survey (FNDDS)", portion: { count: 3, label: "1 item", unit: "piece", grams_each: 38, estimate: true } },
};

test("per-100 g values come from the snapshot, or from older entries' totals and grams", () => {
  assert.deepEqual(entryPer100g(idliEntry), { calories: 128, protein: 6.36, carbs: 24.98, fat: 0.35 });
  const older = { ...idliEntry, nutrition_snapshot: {}, quantity_grams: 200, calories: 300, protein: 10, carbs: 40, fat: 8 };
  assert.deepEqual(entryPer100g(older), { calories: 150, protein: 5, carbs: 20, fat: 4 });
  assert.equal(entryPer100g({ ...older, quantity_grams: null }), null);
  assert.equal(entryBasis(idliEntry), "recipe_calculated");
  assert.equal(entryBasis({ ...idliEntry, source: "Open Food Facts", nutrition_snapshot: {} }), "label");
  assert.equal(entryBasis({ ...idliEntry, nutrition_snapshot: { value_basis: "ai_suggested" } }), "ai_suggested");
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
  assert.equal(rowsFromItems("u1", "2026-11-18", [{ ...idliEntry, meal: "Brunch" }], null)[0].meal, "Snack", "unknown slots land in Snack");
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
