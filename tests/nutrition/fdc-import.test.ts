import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogRow, cuisineOf, dietTypeOf, fromFullRecord, keywordsOf, nutrientsOf, usdaPortions, withStaple, type FdcFullRecord, type FdcRecord, type StapleRecord } from "@/lib/food/fdc-import";

const fndds = (overrides: Partial<FdcRecord> = {}): FdcRecord => ({
  fdcId: 2708346,
  description: "Idli",
  dataType: "Survey (FNDDS)",
  publishedDate: "2024-10-31",
  foodCategory: "Rice mixed dishes",
  additionalDescriptions: "NS as to type;idly",
  foodNutrients: [
    { nutrientNumber: "208", value: 128 }, { nutrientNumber: "203", value: 6.36 }, { nutrientNumber: "205", value: 24.98 },
    { nutrientNumber: "204", value: 0.35 }, { nutrientNumber: "291", value: 1.4 }, { nutrientNumber: "307", value: 308 },
  ],
  foodMeasures: [{ disseminationText: "1 item", gramWeight: 38 }, { disseminationText: "Quantity not specified", gramWeight: 76 }],
  finalFoodInputFoods: [{ foodDescription: "Rice, white, glutinous, unenriched, cooked" }, { foodDescription: "Peas, split, mature seeds, cooked" }],
  ...overrides,
});

test("reads per-100 g values from search results and from full records", () => {
  assert.deepEqual(nutrientsOf(fndds()), { kcal: 128, protein: 6.36, carbs: 24.98, fat: 0.35, fiber: 1.4, sugar: null, sodiumMg: 308 });
  const full: FdcRecord = { fdcId: 2346396, description: "Oats", dataType: "Foundation", foodNutrients: [
    { nutrient: { number: "957" }, amount: 381.6 }, { nutrient: { number: "958" }, amount: 378.9 }, { nutrient: { number: "203" }, amount: 13.5 },
  ] };
  assert.equal(nutrientsOf(full).kcal, 378.9, "Atwater specific factors when there is no kcal (208)");
});

test("keeps USDA's household measures, plain ones first, and never a carton or a cube as a bare count", () => {
  const portions = usdaPortions([
    { label: "1 cup, melted", grams: 244 }, { label: "1 cup", grams: 132 }, { label: "1 cubic inch", grams: 17 }, { label: "1 oz, cooked", grams: 28.35 },
    { label: "Guideline amount per fl oz of beverage", grams: 30 }, { label: "1 individual school container", grams: 244 }, { label: "Quantity not specified", grams: 50 },
  ]);
  assert.deepEqual(portions.map((portion) => portion.label), ["1 cubic inch", "1 individual school container", "1 cup", "1 cup, melted"]);
  assert.equal(portions.some((portion) => portion.isDefault), false, "neither a cube nor a carton answers \"2 cheese\"");
  const pieces = usdaPortions([{ label: "1 large", grams: 150 }, { label: "1 small", grams: 70 }, { label: "1 medium", grams: 110 }]);
  assert.deepEqual(pieces.map((portion) => `${portion.label}${portion.isDefault ? "*" : ""}`), ["1 small", "1 medium*", "1 large"]);
});

test("search keywords leave out USDA survey notes", () => {
  assert.deepEqual(keywordsOf("NS as to skin eaten;any source;blood pudding;blutwurst"), ["blood pudding", "blutwurst"]);
  assert.deepEqual(keywordsOf(undefined), []);
});

test("marks meat, fish and egg from names and ingredient lists, and claims nothing else", () => {
  assert.equal(dietTypeOf("Rice soup", ["Soup, chicken broth, ready-to-serve"], null), "non_veg");
  assert.equal(dietTypeOf("Caribou", [], "Lamb, goat, game"), "non_veg");
  assert.equal(dietTypeOf("Coleslaw", ["Salad dressing, mayonnaise, regular"], null), "egg");
  assert.equal(dietTypeOf("Rajma curry", ["Beans, kidney, red, mature seeds, cooked"], null), null, "kidney beans are not meat");
  assert.equal(dietTypeOf("Coconut chutney", ["Nuts, coconut meat, raw"], null), null, "coconut meat is not meat");
  assert.equal(dietTypeOf("Eggplant, cooked", [], null), null, "eggplant is not egg");
  assert.equal(dietTypeOf("Pudding, chocolate", ["Puddings, chocolate, ready-to-eat"], null), null, "no veg claim from an ingredient that hides its contents");
});

test("tags common Indian dishes", () => {
  assert.equal(cuisineOf("Dosa, with filling"), "indian");
  assert.equal(cuisineOf("Biryani with chicken"), "indian");
  assert.equal(cuisineOf("Pasta, cooked"), null);
});

test("builds catalogue rows and leaves out what FITX should not offer", () => {
  const row = catalogRow(fndds());
  assert.ok(!("skip" in row));
  if ("skip" in row) return;
  assert.equal(row.valueBasis, "recipe_calculated");
  assert.equal(row.cuisine, "indian");
  assert.deepEqual(row.keywords, ["idly"]);
  assert.deepEqual(row.portions, [{ label: "1 item", unit: "piece", grams: 38, isDefault: true }]);
  assert.deepEqual(catalogRow(fndds({ fdcId: 2705740, description: "Cheese, paneer" })), { skip: "excluded on review" });
  assert.deepEqual(catalogRow(fndds({ foodCategory: "Formula, ready-to-feed" })), { skip: "category Formula, ready-to-feed" });
  assert.deepEqual(catalogRow(fndds({ foodNutrients: [{ nutrientNumber: "203", value: 1 }] })), { skip: "missing energy or macros" });
  assert.deepEqual(catalogRow(fndds({ foodNutrients: [{ nutrientNumber: "208", value: 3000 }, { nutrientNumber: "203", value: 1 }, { nutrientNumber: "205", value: 1 }, { nutrientNumber: "204", value: 1 }] })), { skip: "values out of range" });
  const baked = catalogRow(fndds({ description: "Chicken breast, baked, from raw" }));
  assert.equal("skip" in baked ? null : baked.state, "cooked", "\"from raw\" means cooked from raw");
});

test("curated staples keep their aliases, portions and checked diet labels", () => {
  const row = catalogRow(fndds());
  if ("skip" in row) throw new Error("idli skipped");
  const staple: StapleRecord = { id: "2708346", fdcId: 2708346, name: "Idli", dataType: "Survey (FNDDS)", published: "2024-10-31", state: "cooked", aliases: ["idly", "Idlis"], calories: 128, protein: 6.36, carbs: 24.98, fat: 0.35, portions: [{ label: "1 item", unit: "piece", grams: 38, countDefault: true }] };
  const merged = withStaple(row, staple);
  assert.deepEqual(merged.aliases, ["idly", "idlis"]);
  assert.equal(merged.dietType, "vegan");
  assert.equal(merged.kcal, 128);
  const egg = withStaple(null, { ...staple, id: "171287", fdcId: 171287, name: "Egg, whole, raw, fresh", dataType: "SR Legacy", state: "raw", aliases: ["egg"], calories: 143 });
  assert.equal(egg.valueBasis, "compiled");
  assert.equal(egg.dietType, "egg");
});

test("a bulk-download record gives the same catalogue row as the search result for that food", () => {
  // The same FNDDS food as fndds() above, in the full-record shape of GET /v1/food/{id} and the bulk JSON downloads.
  const full: FdcFullRecord = {
    fdcId: 2708346,
    description: "Idli",
    dataType: "Survey (FNDDS)",
    publicationDate: "10/31/2024",
    wweiaFoodCategory: { wweiaFoodCategoryDescription: "Rice mixed dishes" },
    foodAttributes: [
      { value: "NS as to type", foodAttributeType: { name: "Additional Description" } },
      { value: "idly", foodAttributeType: { name: "Additional Description" } },
      { value: "Moisture adjustment", foodAttributeType: { name: "Adjustments" } },
    ],
    foodNutrients: [
      { nutrient: { number: "208" }, amount: 128 }, { nutrient: { number: "203" }, amount: 6.36 }, { nutrient: { number: "205" }, amount: 24.98 },
      { nutrient: { number: "204" }, amount: 0.35 }, { nutrient: { number: "291" }, amount: 1.4 }, { nutrient: { number: "307" }, amount: 308 },
    ],
    foodPortions: [
      { portionDescription: "1 item", gramWeight: 38, modifier: "10205", measureUnit: { name: "undetermined" } },
      { portionDescription: "Quantity not specified", gramWeight: 76, measureUnit: { name: "undetermined" } },
    ],
    inputFoods: [
      { ingredientDescription: "Rice, white, glutinous, unenriched, cooked" },
      { ingredientDescription: "Peas, split, mature seeds, cooked" },
    ],
  };
  assert.deepEqual(catalogRow(fromFullRecord(full)), catalogRow(fndds()));
  const chicken = fromFullRecord({ ...full, description: "Kati roll", inputFoods: [{ ingredientDescription: "Chicken, broilers or fryers, breast, cooked" }] });
  assert.equal((catalogRow(chicken) as { dietType: string }).dietType, "non_veg", "ingredients from the bulk record still mark meat");
});

test("full SR Legacy and Foundation portions read as household measures, without the labelling reference amount", () => {
  const record = (foodPortions: FdcFullRecord["foodPortions"]): FdcFullRecord => ({
    fdcId: 748967, description: "Eggs, Grade A, Large, egg whole", dataType: "Foundation", publicationDate: "12/16/2019",
    foodCategory: { description: "Dairy and Egg Products" },
    foodNutrients: [{ nutrient: { number: "958" }, amount: 148 }, { nutrient: { number: "203" }, amount: 12.4 }, { nutrient: { number: "205" }, amount: 0.96 }, { nutrient: { number: "204" }, amount: 9.96 }],
    foodPortions,
  });
  const egg = catalogRow(fromFullRecord(record([
    { amount: 1, modifier: "whole without shell", gramWeight: 50.3, measureUnit: { name: "egg" } },
    { amount: 1, gramWeight: 50, measureUnit: { name: "RACC" } },
    { amount: 1, modifier: "cup, chopped", gramWeight: 136, measureUnit: { name: "undetermined" } },
    { amount: 0.33, modifier: "cup", gramWeight: 27, measureUnit: { name: "undetermined" } },
    { amount: 1, modifier: "", gramWeight: 249, measureUnit: { name: "cup" } },
  ])));
  assert.ok(!("skip" in egg));
  assert.equal(egg.category, "Dairy and Egg Products");
  assert.equal(egg.version, "2019-12-16");
  assert.deepEqual(egg.portions.map((portion) => [portion.label, portion.unit, portion.grams, portion.isDefault]), [
    ["1 egg (whole without shell)", "piece", 50.3, true],
    ["1 cup", "cup", 249, false],
    ["1 cup, chopped", "cup", 136, false],
  ]);
});
