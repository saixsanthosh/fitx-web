// Fix round 3c, the browser re-check's side note on bug 4 (nutrition-a): for the member's own food with protein,
// carbs and fat left blank, Log food's panel said "This source doesn't list carbs, protein and fat", beside "Fibre: not
// listed by this source", as if the values came from somewhere else. Your own food now says what you did ("You left
// carbs, protein and fat blank for this food…", and how to add them), the ring's legend and other nutrients read
// "unknown", and the rest of bug 4 stays: left out of totals, never 0 g. Labels and sources keep their words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { customFoodResult, type CustomFoodRow } from "@/lib/food/client-data";
import { missingMacroWord, missingSentence, otherNutrientMissing } from "@/lib/food/missing-values";
import { fromOpenFoodFacts } from "@/lib/food/open-food-facts";
import type { FoodResult } from "@/lib/food/types";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

/** The re-check's food: "Masala chai (home)", 1 cup = 150 g, 90 kcal, protein, carbs and fat left blank. */
const chai: CustomFoodRow = {
  id: "c-chai", name: "Masala chai (home)", brand: null, serving_size: "1 cup", serving_grams: 150,
  calories_per_100g: 60, protein_per_100g: null, carbs_per_100g: null, fat_per_100g: null, origin: "user", value_basis: "user_entered",
};

test("your own food says you left them blank, and how to add them, never that a source doesn't list them", () => {
  const food = customFoodResult(chai);
  assert.deepEqual(food.missing, ["protein", "carbs", "fat"]);
  const said = missingSentence(food);
  assert.equal(said, "You left carbs, protein and fat blank for this food, so FITX can't count them. They are left out of your totals, not logged as 0 g. To add them, edit the food in My foods.");
  assert.doesNotMatch(said, /source|label|doesn't list/);
  assert.equal(missingSentence(customFoodResult({ ...chai, protein_per_100g: 2, carbs_per_100g: 8 })), "You left fat blank for this food, so FITX can't count it. It is left out of your totals, not logged as 0 g. To add it, edit the food in My foods.");
  assert.equal(missingSentence(customFoodResult({ ...chai, origin: "barcode", value_basis: "label" })).startsWith("You left carbs, protein and fat blank"), true, "a package you saved yourself: you left them blank in the form");
  assert.equal(missingSentence(customFoodResult({ ...chai, origin: "ai_coach", value_basis: "ai_suggested" })).startsWith("This food was saved without carbs, protein and fat, so FITX can't count them."), true, "one the AI Coach saved: you didn't type anything");
  assert.equal(missingSentence(customFoodResult({ ...chai, protein_per_100g: 2, carbs_per_100g: 8, fat_per_100g: 0 })), "", "a real 0 is a value");
  assert.equal(missingMacroWord(food), "unknown");
  assert.equal(otherNutrientMissing(food), "unknown", "your own food has no place for fibre or sugars yet");
});

test("a package label and a source keep their words", () => {
  const paneer = fromOpenFoodFacts({ code: "8901063011366", product_name_en: "Paneer", nutriments: { "energy-kcal_100g": 288, proteins_100g: 18.3, carbohydrates_100g: 1.2 } });
  assert.ok(paneer);
  assert.equal(missingSentence(paneer), "This label doesn't list fat, so FITX can't count it. It is left out of your totals, not logged as 0 g.");
  assert.equal(missingMacroWord(paneer), "not listed");
  assert.equal(otherNutrientMissing(paneer), "not listed by this label");
  const usda = { kind: "catalog", source: "USDA FoodData Central", origin: null, missing: ["carbs", "fat"] } as Pick<FoodResult, "kind" | "source" | "origin" | "missing">;
  assert.equal(missingSentence(usda), "This source doesn't list carbs and fat, so FITX can't count them. They are left out of your totals, not logged as 0 g.");
  assert.equal(otherNutrientMissing(usda), "not listed by this source");
});

test("the panel, its ring and the other nutrients take their words from these", () => {
  const detail = read("src/components/nutrition/FoodDetail.tsx");
  assert.match(detail, /const problem = missingSentence\(food\);/);
  assert.match(detail, /<NutrientList food=\{food\} grams=\{grams\} missing=\{otherNutrientMissing\(food\)\}\/>/);
  const summary = read("src/components/nutrition/ProductSummary.tsx");
  assert.doesNotMatch(summary, /valid \? "not listed"|\] not listed`/, "the word comes from missingMacroWord");
  assert.match(summary, /const none = missingMacroWord\(food\);/);
  assert.match(summary, /\$\{MACRO_LABEL\[key\]\} \$\{none\}/, "the ring's screen-reader name too");
  const list = read("src/components/nutrition/NutrientList.tsx");
  assert.match(list, /<span className=\{styles\.unknown\}>\{missing\}<\/span>/);
});
