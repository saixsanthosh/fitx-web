import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMealValues, entryMissing, entryPer100g, entryUpdate, foodFromEntry, frequentFromEntries, isEstimateSnapshot, rowsFromItems, sameMeal, type MealEntry, type MealTemplateItem } from "@/lib/food/client-data";
import { fromOpenFoodFacts } from "@/lib/food/open-food-facts";
import type { FoodResult } from "@/lib/food/types";
import { unsourcedFor } from "@/lib/food/unsourced";

const paneer = fromOpenFoodFacts({
  code: "8901063011366", product_name_en: "Paneer", nutriments: { "energy-kcal_100g": 288, proteins_100g: 18.3, carbohydrates_100g: 1.2, fiber_100g: 0, sodium_100g: 0.05 },
  serving_size: "100 g", serving_quantity: 100,
}) as FoodResult;

test("logging a food with an unknown macro stores NULL for it and lists it in the snapshot", () => {
  const values = buildMealValues(paneer, 200);
  assert.deepEqual([values.calories, values.protein, values.carbs, values.fat], [576, 36.6, 2.4, null]);
  assert.deepEqual(values.snapshot.missing, ["fat"]);
  assert.equal(values.snapshot.per_100g?.fat, null);
  assert.equal(values.snapshot.per_100g?.fiber, 0, "a fibre value of 0 on the label is known");
  assert.equal(values.snapshot.per_100g?.sugar, null);
  assert.equal(values.snapshot.per_100g?.sodium_mg, 50);
});

test("a food with every value logs plain numbers and no missing list", () => {
  const full = { ...paneer, missing: [] };
  const values = buildMealValues(full, 100);
  assert.deepEqual([values.protein, values.carbs, values.fat], [18.3, 1.2, 0]);
  assert.equal("missing" in values.snapshot, false);
});

const logged: MealEntry = {
  id: "m9", date: "2026-11-18", meal: "Lunch", food_name: "Paneer", brand: null, barcode: "8901063011366", servings: 2, calories: 576, protein: 36.6, carbs: 2.4, fat: null,
  quantity_grams: 200, source: "Open Food Facts", provider_id: "8901063011366", serving_size: "200 g",
  nutrition_snapshot: { ...buildMealValues(paneer, 200).snapshot, value_basis: "label" },
};

test("an entry knows which values it lacks, from NULL columns or the snapshot", () => {
  assert.deepEqual(entryMissing(logged), ["fat"]);
  assert.deepEqual(entryMissing({ ...logged, fat: 3, nutrition_snapshot: { missing: ["carbs"] } }), ["carbs"]);
  assert.deepEqual(entryMissing({ ...logged, protein: null, carbs: null, fat: null, nutrition_snapshot: null }), ["protein", "carbs", "fat"]);
  const per100 = entryPer100g(logged);
  assert.deepEqual(per100?.missing, ["fat"]);
  assert.equal(per100?.fat, 0, "held as 0 only so arithmetic works");
});

test("editing an entry keeps an unknown value NULL instead of writing 0", () => {
  const update = entryUpdate(logged, { grams: 100, servingSize: "100 g", portion: null, meal: "Dinner", date: "2026-11-18" });
  assert.deepEqual([update.calories, update.protein, update.carbs, update.fat], [288, 18.3, 1.2, null]);
  assert.deepEqual(update.nutrition_snapshot.missing, ["fat"]);
  const older = entryUpdate({ ...logged, nutrition_snapshot: null }, { grams: 100, servingSize: "100 g", portion: null, meal: "Dinner", date: "2026-11-18" });
  assert.equal(older.fat, null, "an older entry with a NULL column stays unknown");
  assert.deepEqual(older.nutrition_snapshot.missing, ["fat"]);
});

test("copying an entry or a saved meal keeps unknown values NULL and a custom meal section", () => {
  const [copy] = rowsFromItems("u1", "2026-11-19", [{ ...logged, meal: "Pre-workout" }], null);
  assert.deepEqual([copy.protein, copy.fat, copy.meal], [36.6, null, "Pre-workout"]);
  const item: MealTemplateItem = {
    meal_slot: "Lunch", food_name: "Paneer", brand: null, source: "Open Food Facts", provider_id: "1", serving_size: "200 g", quantity_grams: 200,
    calories: 576, protein: 36.6, carbs: 2.4, fat: 0, nutrition_snapshot: logged.nutrition_snapshot,
  };
  const [fromTemplate] = rowsFromItems("u1", "2026-11-19", [item], "Dinner");
  assert.equal(fromTemplate.fat, null, "the template stores 0 (its column is NOT NULL); the snapshot's list puts NULL back");
  assert.equal(fromTemplate.meal, "Dinner");
});

test("a logged entry comes back as a food with its unknowns and other nutrients", () => {
  const food = foodFromEntry(logged);
  assert.deepEqual(food?.missing, ["fat"]);
  assert.equal(food?.sodiumMg, 50);
  assert.equal(food?.fiber, 0);
  assert.equal(food?.sugar, null);
});

test("estimates are told from measured entries", () => {
  assert.equal(isEstimateSnapshot(logged), false);
  assert.equal(isEstimateSnapshot({ ...logged, nutrition_snapshot: { value_basis: "recipe_calculated" } }), true);
  assert.equal(isEstimateSnapshot({ ...logged, nutrition_snapshot: { value_basis: "label", portion: { estimate: true } } }), true);
  assert.equal(sameMeal("Lunch ", "lunch"), true);
  assert.equal(sameMeal("Lunch", "Dinner"), false);
});

const entry = (id: string, food: string, grams: number, extra: Partial<MealEntry> = {}): MealEntry => ({
  ...logged, id, food_name: food, provider_id: food.toLowerCase(), source: "USDA FoodData Central", quantity_grams: grams, serving_size: `${grams} g`, fat: 1, calories: grams, ...extra,
});

test("frequent foods are those logged twice or more, most often first, each with the usual amount", () => {
  const entries = [
    entry("1", "Rice", 150), entry("2", "Dal", 200), entry("3", "Rice", 150), entry("4", "Rice", 120), entry("5", "Dal", 200), entry("6", "Egg", 50), entry("7", "Rice", 150),
  ];
  const frequent = frequentFromEntries(entries);
  assert.deepEqual(frequent.map((item) => [item.name, item.count, item.amountText]), [["Rice", 4, "150 g"], ["Dal", 2, "200 g"]]);
  assert.equal(frequent[0].entry.id, "1", "the newest entry with the usual grams");
  assert.deepEqual(frequentFromEntries(entries, 3).map((item) => item.name), ["Rice"]);
  assert.deepEqual(frequentFromEntries(entries, 2, 1).map((item) => item.name), ["Rice"]);
  assert.deepEqual(frequentFromEntries([]), []);
  assert.deepEqual(frequentFromEntries([entry("1", "Rice", 0), entry("2", "Rice", 0)]), [], "entries without grams cannot give a usual amount");
});

test("a named piece amount is shown as it was logged", () => {
  const withPortion = (id: string) => entry(id, "Idli", 114, { serving_size: "3 × 1 item (114 g)", nutrition_snapshot: { portion: { count: 3, label: "1 item", unit: "piece", grams_each: 38, estimate: true } } });
  assert.equal(frequentFromEntries([withPortion("1"), withPortion("2")])[0].amountText, "3 × 1 item (114 g)");
});

test("an unsourced food is named, unless the member's own food already covers it", () => {
  assert.equal(unsourcedFor("200 g paneer", [{ name: "Palak Paneer", kind: "catalog" }])?.label, "Plain paneer");
  assert.equal(unsourcedFor("bhindi", [])?.label, "Bhindi (okra)");
  assert.equal(unsourcedFor("okra", [])?.label, "Bhindi (okra)");
  assert.equal(unsourcedFor("paneer", [{ name: "Paneer", kind: "custom" }]), null);
  assert.equal(unsourcedFor("paneer", [{ name: "Amul Paneer", kind: "packaged" }]), null);
  assert.equal(unsourcedFor("rice", []), null);
  assert.equal(unsourcedFor("", []), null);
});

test("a USDA record of the food itself covers an unsourced food; a dish or a mention does not", () => {
  const usda = (name: string) => ({ name, kind: "catalog", source: "USDA FoodData Central" });
  assert.equal(unsourcedFor("okra", [usda("Okra, raw"), usda("Okra, cooked")]), null);
  assert.equal(unsourcedFor("bhindi", [usda("Okra, frozen")]), null, "any of the entry's words counts");
  assert.equal(unsourcedFor("paneer", [usda("PANEER")]), null, "a USDA Branded label is a real value");
  assert.equal(unsourcedFor("okra", [usda("Soup, chicken gumbo, with okra")])?.label, "Bhindi (okra)", "a dish that mentions it is not the food");
  assert.equal(unsourcedFor("paneer", [usda("Palak paneer")])?.label, "Plain paneer");
  assert.equal(unsourcedFor("paneer", [{ name: "Paneer", kind: "catalog", source: "FITX recipe estimate" }])?.label, "Plain paneer", "only USDA records count this way");
});
