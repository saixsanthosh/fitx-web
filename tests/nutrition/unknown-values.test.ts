import { test } from "node:test";
import assert from "node:assert/strict";
import { calorieBalance, extrasFromOpenFoodFacts, macroEnergySplit, per100gFromOpenFoodFacts, scaleNutrient, sumKnown } from "@/lib/domain/nutrition";
import { fromOpenFoodFacts } from "@/lib/food/open-food-facts";
import { extraNutrientsJson, extraPer100g, parseExtraNutrients } from "@/lib/food/custom-nutrients";
import { fromUsda } from "@/lib/food/usda-live";

const label = { "energy-kcal_100g": 442, proteins_100g: 7.4, carbohydrates_100g: 75.6, fat_100g: 12.5 };

test("a blank macro is listed as missing, and a present one (even 0) is not", () => {
  assert.deepEqual(per100gFromOpenFoodFacts(label)?.missing, []);
  assert.deepEqual(per100gFromOpenFoodFacts({ "energy-kcal_100g": 288, proteins_100g: 18.3, carbohydrates_100g: 1.2 })?.missing, ["fat"]);
  assert.deepEqual(per100gFromOpenFoodFacts({ "energy-kcal_100g": 0, proteins_100g: 0, carbohydrates_100g: 0, fat_100g: 0 })?.missing, [], "a declared 0 is known");
  assert.deepEqual(per100gFromOpenFoodFacts({ "energy-kcal_100g": 380, proteins_100g: 10 })?.missing, ["carbs", "fat"]);
});

test("fibre, sugars, saturated fat and sodium are read from the label, and blank ones stay unknown", () => {
  const extras = extrasFromOpenFoodFacts({ ...label, fiber_100g: 3.1, sugars_100g: 22, "saturated-fat_100g": 5.5, sodium_100g: 0.4 });
  assert.deepEqual(extras, { fiber: 3.1, sugar: 22, saturatedFat: 5.5, sodiumMg: 400, sodiumFromSalt: false });
  const bare = extrasFromOpenFoodFacts(label);
  assert.deepEqual(bare, { fiber: null, sugar: null, saturatedFat: null, sodiumMg: null, sodiumFromSalt: false }, "never filled with 0");
  assert.deepEqual(extrasFromOpenFoodFacts({ salt_100g: 1.25 }).sodiumMg, 500, "sodium from salt is salt / 2.5");
  assert.equal(extrasFromOpenFoodFacts({ salt_100g: 1.25 }).sodiumFromSalt, true);
  assert.equal(extrasFromOpenFoodFacts({ sodium_100g: 0.2, salt_100g: 9 }).sodiumMg, 200, "a stated sodium wins over salt");
  assert.equal(extrasFromOpenFoodFacts({ fiber_100g: -1, sugars_100g: "x" }).fiber, null);
});

test("an Open Food Facts product keeps every nutrient and says what the label lacks", () => {
  const food = fromOpenFoodFacts({
    code: "8901063011366", product_name_en: "Marie biscuits", nutriments: { ...label, fiber_100g: 2.3, sugars_100g: 20, "saturated-fat_100g": 5.5, salt_100g: 0.8 },
    serving_size: "6 biscuits (27 g)", serving_quantity: 27,
  });
  assert.ok(food);
  assert.deepEqual([food.fiber, food.sugar, food.saturatedFat, food.sodiumMg, food.sodiumFromSalt], [2.3, 20, 5.5, 320, true]);
  assert.deepEqual(food.missing, []);
  assert.equal(food.servingLabel, "6 biscuits (27 g)");
  const noFat = fromOpenFoodFacts({ code: "8901063011366", product_name_en: "Paneer", nutriments: { "energy-kcal_100g": 288, proteins_100g: 18.3, carbohydrates_100g: 1.2 } });
  assert.deepEqual(noFat?.missing, ["fat"]);
  assert.equal(noFat?.saturatedFat, null);
});

test("a serving in millilitres is shown, never turned into grams", () => {
  const drink = fromOpenFoodFacts({ code: "8901063011366", product_name_en: "Cola", nutriments: { "energy-kcal_100g": 42, proteins_100g: 0, carbohydrates_100g: 10.6, fat_100g: 0 }, serving_size: "250 ml", serving_quantity: 250 });
  assert.deepEqual(drink?.portions, []);
  assert.equal(drink?.servingLabel, "250 ml");
  assert.match(drink?.servingNote ?? "", /no weight, so log it in grams/);
});

test("totals leave unknown values out and count the entries that lack them", () => {
  const totals = sumKnown([
    { calories: 200, protein: 10, carbs: 20, fat: null },
    { calories: 100, protein: null, carbs: 5, fat: 2 },
    { calories: 50, protein: 1, carbs: 0, fat: 0 },
  ]);
  assert.deepEqual([totals.calories, totals.protein, totals.carbs, totals.fat], [350, 11, 25, 2]);
  assert.deepEqual(totals.unknown, { protein: 1, carbs: 0, fat: 1 });
  assert.equal(sumKnown([]).unknown.fat, 0);
});

test("scaling a nutrient keeps unknown as unknown", () => {
  assert.equal(scaleNutrient(3.1, 50), 1.6);
  assert.equal(scaleNutrient(0, 50), 0, "a known 0 stays 0");
  assert.equal(scaleNutrient(null, 50), null);
  assert.equal(scaleNutrient(undefined, 50), null);
});

test("remaining calories are the target minus food, and only with a valid target", () => {
  assert.deepEqual(calorieBalance(1200, 2000), { remaining: 800, over: false });
  assert.deepEqual(calorieBalance(2300, 2000), { remaining: 300, over: true });
  assert.deepEqual(calorieBalance(2000, 2000), { remaining: 0, over: false });
  assert.equal(calorieBalance(500, null), null);
  assert.equal(calorieBalance(500, 0), null);
  assert.equal(calorieBalance(500, Number.NaN), null);
  assert.equal(calorieBalance(500, -2000), null);
});

test("the energy split adds up to 100 and leaves out a macro the source lacks", () => {
  // 112 kcal food: 14 g carbs, 4 g fat, 10 g protein is 56 + 36 + 40 = 132 kcal from macros.
  const split = macroEnergySplit({ protein: 10, carbs: 14, fat: 4 });
  assert.ok(split);
  const shares = [split.share.protein, split.share.carbs, split.share.fat] as number[];
  assert.equal(shares.reduce((a, b) => a + b, 0), 100);
  assert.deepEqual(shares, [30, 43, 27], "the spare point goes to the largest remainder");
  assert.deepEqual(split.kcal, { protein: 40, carbs: 56, fat: 36 });
  const noFat = macroEnergySplit({ protein: 10, carbs: 10, fat: null });
  assert.deepEqual(noFat?.share, { protein: 50, carbs: 50, fat: null });
  assert.equal(noFat?.kcal.fat, null);
  assert.equal(macroEnergySplit({ protein: 0, carbs: 0, fat: 0 }), null);
  assert.equal(macroEnergySplit({ protein: null, carbs: null, fat: null }), null);
  const odd = macroEnergySplit({ protein: 1, carbs: 1, fat: 1 });
  assert.equal(Object.values(odd?.share ?? {}).reduce((a, b) => (a as number) + (b as number), 0), 100, "thirds still add to 100");
});

test("live USDA search lists a nutrient it does not give instead of counting 0 g", () => {
  const food = fromUsda({ fdcId: 1, description: "Test paneer", dataType: "Branded", foodNutrients: [{ nutrientNumber: "208", value: 288 }, { nutrientNumber: "203", value: 18.3 }, { nutrientNumber: "205", value: 1.2 }] });
  assert.deepEqual(food?.missing, ["fat"]);
  assert.equal(food?.saturatedFat, null);
});

test("extra nutrients for your own food: per serving in, per 100 g stored, blank stays unknown", () => {
  const { extra, problem } = extraPer100g({ fiber: "3", sugar: "", saturatedFat: "1.5", sodiumMg: "300" }, 150);
  assert.equal(problem, null);
  assert.deepEqual(extra, { fiber: 2, sugar: null, saturatedFat: 1, sodiumMg: 200 });
  assert.deepEqual(extraNutrientsJson(extra), { fiber_g: 2, saturated_fat_g: 1, sodium_mg: 200 });
  assert.deepEqual(parseExtraNutrients(extraNutrientsJson(extra)), extra);
  assert.deepEqual(parseExtraNutrients({ fiber_g: -3, sugar_g: "abc", sodium_mg: 999999 }), { fiber: null, sugar: null, saturatedFat: null, sodiumMg: null });
  assert.deepEqual(parseExtraNutrients("nope"), { fiber: null, sugar: null, saturatedFat: null, sodiumMg: null });
  assert.match(extraPer100g({ fiber: "400", sugar: "", saturatedFat: "", sodiumMg: "" }, 100).problem ?? "", /can't weigh more/);
  assert.match(extraPer100g({ fiber: "x", sugar: "", saturatedFat: "", sodiumMg: "" }, 100).problem ?? "", /numbers/);
});
