import { test } from "node:test";
import assert from "node:assert/strict";
import { goalPercent, goalProgress, per100gFromOpenFoodFacts, scaleMacros } from "@/lib/domain/nutrition";

test("reports how far a day went over its target", () => {
  assert.deepEqual(goalProgress(2300, 2000), { percent: 100, over: 300, isOver: true });
  assert.deepEqual(goalProgress(1500, 2000), { percent: 75, over: 0, isOver: false });
  assert.deepEqual(goalProgress(2000.4, 2000), { percent: 100, over: 0, isOver: false });
  assert.deepEqual(goalProgress(50, 0), { percent: 0, over: 0, isOver: false });
  assert.equal(goalPercent(2300, 2000), 100, "goalPercent keeps its 0-100 range for the home dashboard");
});

test("converts kJ-only Open Food Facts labels to kcal", () => {
  assert.deepEqual(per100gFromOpenFoodFacts({ "energy-kj_100g": 418.4, proteins_100g: 3.2, carbohydrates_100g: 4.8, fat_100g: 1 }), { calories: 100, protein: 3.2, carbs: 4.8, fat: 1 });
  assert.equal(per100gFromOpenFoodFacts({ energy_100g: 1046 })?.calories, 250, "energy_100g is stored in kJ");
  assert.equal(per100gFromOpenFoodFacts({ "energy-kcal_100g": "52.5", "energy-kj_100g": 999 })?.calories, 53, "kcal wins over kJ");
});

test("keeps genuine zero-calorie products", () => {
  assert.deepEqual(per100gFromOpenFoodFacts({ "energy-kcal_100g": 0, proteins_100g: 0, carbohydrates_100g: 0, fat_100g: 0 }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
  assert.equal(per100gFromOpenFoodFacts({ "energy-kj_100g": 0 })?.calories, 0);
});

test("skips labels without a per-100 g energy value", () => {
  assert.equal(per100gFromOpenFoodFacts({}), null);
  assert.equal(per100gFromOpenFoodFacts(null), null);
  assert.equal(per100gFromOpenFoodFacts({ "energy-kcal": 180, "energy-kcal_serving": 180 }), null, "per-serving energy is not per 100 g");
  assert.equal(per100gFromOpenFoodFacts({ "energy-kcal_100g": "" }), null);
  assert.equal(per100gFromOpenFoodFacts({ "energy-kcal_100g": -5 }), null);
  assert.equal(per100gFromOpenFoodFacts({ "energy-kcal_100g": 40, proteins_100g: "n/a" })?.protein, 0);
});

test("reads kJ typed into the kcal field as kJ when that fits the label's nutrients", () => {
  // Yogurt: 3.5 g protein, 10 g carbs, 2.5 g fat is about 76 kcal; 314 in the kcal field is its kJ figure.
  assert.equal(per100gFromOpenFoodFacts({ "energy-kcal_100g": 314, proteins_100g: 3.5, carbohydrates_100g: 10, fat_100g: 2.5 })?.calories, 75);
  // A biscuit's 2042 kJ in the kcal field: no food has 2042 kcal per 100 g.
  assert.equal(per100gFromOpenFoodFacts({ "energy-kcal_100g": 2042, proteins_100g: 7, carbohydrates_100g: 70, fat_100g: 20 })?.calories, 488);
  assert.equal(per100gFromOpenFoodFacts({ "energy-kcal_100g": 3700, fat_100g: 100 })?.calories, 884, "olive oil in kJ");
  // The same number in both fields can only be the kJ value.
  assert.equal(per100gFromOpenFoodFacts({ "energy-kcal_100g": 1046, "energy-kj_100g": 1046 })?.calories, 250);
});

test("drops labels whose energy or nutrients can't be right", () => {
  assert.equal(per100gFromOpenFoodFacts({ "energy-kcal_100g": 1500 }), null, "over 900 kcal with no nutrients to check it against");
  assert.equal(per100gFromOpenFoodFacts({ "energy-kcal_100g": 700, proteins_100g: 1, carbohydrates_100g: 10, fat_100g: 1 }), null, "neither kcal nor kJ fits 53 kcal of nutrients");
  assert.equal(per100gFromOpenFoodFacts({ "energy-kcal_100g": 400, proteins_100g: 60, carbohydrates_100g: 50, fat_100g: 10 }), null, "120 g of nutrients in 100 g");
  assert.equal(per100gFromOpenFoodFacts({ "energy_100g": 5000 }), null, "kJ that comes to over 900 kcal");
});

test("keeps ordinary labels, including drinks with alcohol", () => {
  assert.equal(per100gFromOpenFoodFacts({ "energy-kcal_100g": 488, "energy-kj_100g": 2042, proteins_100g: 7, carbohydrates_100g: 70, fat_100g: 20 })?.calories, 488);
  assert.equal(per100gFromOpenFoodFacts({ "energy-kcal_100g": 884, fat_100g: 100 })?.calories, 884);
  assert.equal(per100gFromOpenFoodFacts({ "energy-kcal_100g": 83, carbohydrates_100g: 2.6, alcohol_100g: 12.5 })?.calories, 83, "wine: alcohol counts");
  assert.equal(per100gFromOpenFoodFacts({ "energy-kcal_100g": 43, proteins_100g: 0.5, carbohydrates_100g: 3.6 })?.calories, 43, "beer without its alcohol listed");
  assert.equal(per100gFromOpenFoodFacts({ "energy-kcal_100g": 345, proteins_100g: 14, carbohydrates_100g: 47, fat_100g: 4.5, fiber_100g: 27 })?.calories, 345, "bran cereal: fibre counts");
  assert.deepEqual(per100gFromOpenFoodFacts({ "energy-kcal_100g": 900, fat_100g: 100, proteins_100g: 0.5, carbohydrates_100g: 0.4 }), { calories: 900, protein: 0.5, carbs: 0.4, fat: 100 }, "label rounding past 100 g");
});

test("scales per-100 g values to the logged grams", () => {
  assert.deepEqual(scaleMacros({ calories: 128, protein: 6.36, carbs: 24.98, fat: 0.35 }, 114), { calories: 145.9, protein: 7.3, carbs: 28.5, fat: 0.4 });
});
