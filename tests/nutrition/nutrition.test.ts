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

test("scales per-100 g values to the logged grams", () => {
  assert.deepEqual(scaleMacros({ calories: 128, protein: 6.36, carbs: 24.98, fat: 0.35 }, 114), { calories: 145.9, protein: 7.3, carbs: 28.5, fat: 0.4 });
});
