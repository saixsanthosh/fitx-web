// Bug 4 (nutrition-2): protein, carbs and fat left blank on your own food stay unknown. They are saved as NULL
// (migration 20261126100000), shown as unknown, logged as NULL and left out of totals, never counted as 0 g.
import { test } from "node:test";
import assert from "node:assert/strict";
import { customRowToFood } from "@/lib/food/catalog-search";
import { buildMealValues, customFoodResult, customFoodRowValues, customFoodWarning, customMacros, type CustomFoodInput, type CustomFoodRow } from "@/lib/food/client-data";
import { customFoodProblem, numbersChanged, readCustomFoodNumbers, unknownMacros, unknownMacrosNote } from "@/lib/food/custom-food-form";
import { sumKnown } from "@/lib/domain/nutrition";

const chai = { grams: "150", calories: "90", protein: "", carbs: "", fat: "" };

test("blank protein, carbs and fat are read as unknown, not as 0", () => {
  const values = readCustomFoodNumbers(chai);
  assert.deepEqual(values, { grams: 150, calories: 90, protein: null, carbs: null, fat: null });
  assert.deepEqual(unknownMacros(values), ["protein", "carbs", "fat"]);
  assert.deepEqual(readCustomFoodNumbers({ ...chai, protein: "0", carbs: " 12 ", fat: "1,5" }), { grams: 150, calories: 90, protein: 0, carbs: 12, fat: 1.5 }, "0 is a real answer");
  assert.ok(Number.isNaN(readCustomFoodNumbers({ ...chai, calories: "" }).calories), "calories are never assumed");
});

test("a food with unknown macros can be saved; calories and the serving are still needed", () => {
  assert.equal(customFoodProblem("Masala chai (home)", readCustomFoodNumbers(chai)), null);
  assert.equal(customFoodProblem("Masala chai (home)", readCustomFoodNumbers({ ...chai, calories: "" })), "Enter the calories in one serving.");
  assert.equal(customFoodProblem("", readCustomFoodNumbers(chai)), "Give the food a name.");
  assert.match(customFoodProblem("Chai", readCustomFoodNumbers({ ...chai, protein: "-1" })) ?? "", /0 or more, or leave one blank/);
  assert.match(customFoodProblem("Chai", readCustomFoodNumbers({ ...chai, grams: "0" })) ?? "", /between 1 and 5,000 grams/);
  assert.match(customFoodProblem("Chai", readCustomFoodNumbers({ ...chai, carbs: "200" })) ?? "", /can't weigh more than the serving/, "known values are still checked against the serving");
  assert.equal(customFoodProblem("Chai", readCustomFoodNumbers({ ...chai, carbs: "140" })), null, "with fat and protein unknown, only the known carbs count towards the weight");
});

test("the form says blank values stay unknown, and makes no energy comparison it can't make", () => {
  assert.equal(unknownMacrosNote(readCustomFoodNumbers(chai)), "Protein, carbs and fat stay unknown: shown as unknown and left out of your totals, not counted as 0 g.");
  assert.equal(unknownMacrosNote(readCustomFoodNumbers({ ...chai, protein: "3", carbs: "12" })), "Fat stays unknown: shown as unknown and left out of your totals, not counted as 0 g.");
  assert.equal(unknownMacrosNote(readCustomFoodNumbers({ ...chai, protein: "3", carbs: "12", fat: "3" })), null);
  assert.equal(customFoodWarning(90, null, null, null), null, "no \"macros add up to 0 kcal\" warning for values that were not entered");
  assert.equal(customFoodWarning(90, 3, null, 3), null);
  assert.match(customFoodWarning(600, 5, 48, 6) ?? "", /add up to about 266 kcal/, "known values are still compared");
});

test("filling in or clearing an unknown value is a change, so an edited food becomes the member's entry", () => {
  const blank = readCustomFoodNumbers(chai);
  assert.equal(numbersChanged(blank, readCustomFoodNumbers(chai)), false);
  assert.equal(numbersChanged(blank, readCustomFoodNumbers({ ...chai, fat: "0" })), true, "blank and 0 are different answers");
  assert.equal(numbersChanged(readCustomFoodNumbers({ ...chai, fat: "2" }), readCustomFoodNumbers({ ...chai, fat: "2.0" })), false);
});

const input: CustomFoodInput = {
  name: "Masala chai (home)", brand: "", servingLabel: "1 cup", servingGrams: 150, calories: 90, protein: null, carbs: 12, fat: null,
  barcode: null, valueBasis: "user_entered", origin: "user",
};

test("unknown values are stored as NULL per 100 g", () => {
  const row = customFoodRowValues(input, true);
  assert.equal(row.calories_per_100g, 60);
  assert.equal(row.protein_per_100g, null);
  assert.equal(row.carbs_per_100g, 8);
  assert.equal(row.fat_per_100g, null);
});

const stored: CustomFoodRow = {
  id: "c-chai", name: "Masala chai (home)", brand: null, serving_size: "1 cup", serving_grams: 150,
  calories_per_100g: 60, protein_per_100g: null, carbs_per_100g: 8, fat_per_100g: null, origin: "user", value_basis: "user_entered",
};

test("a saved food with NULL values lists them as unknown, in the app and in search", () => {
  assert.deepEqual(customMacros(stored), { protein: 0, carbs: 8, fat: 0, missing: ["protein", "fat"] });
  const food = customFoodResult(stored);
  assert.deepEqual(food.missing, ["protein", "fat"]);
  assert.equal(food.carbs, 8);
  const searched = customRowToFood({ ...stored, calories_per_100g: "60", protein_per_100g: null, carbs_per_100g: "8", fat_per_100g: null });
  assert.deepEqual(searched.missing, ["protein", "fat"], "search_foods returns the NULLs as they are");
  assert.deepEqual(customRowToFood({ ...stored, protein_per_100g: 0, fat_per_100g: 0 }).missing, [], "foods saved with 0 keep 0");
});

test("logging that food stores NULL for the unknown values, and totals leave them out", () => {
  const logged = buildMealValues(customFoodResult(stored), 150);
  assert.equal(logged.calories, 90);
  assert.equal(logged.protein, null);
  assert.equal(logged.carbs, 12);
  assert.equal(logged.fat, null);
  assert.deepEqual(logged.snapshot.missing, ["protein", "fat"]);
  assert.equal(logged.snapshot.per_100g?.protein, null);
  const totals = sumKnown([{ calories: 400, protein: 20, carbs: 50, fat: 10 }, logged]);
  assert.equal(totals.protein, 20, "the chai's unknown protein is not a 0 g in the day's protein");
  assert.deepEqual(totals.unknown, { protein: 1, carbs: 0, fat: 1 });
});
