// A meal plan never plans with, adds up or saves a blank label value as 0 g (release 3, round 3c, open item
// open-3a-coach-food-lookup-zero: the coach's part of bug 4's rule). The coach's live lookups held a blank Open Food
// Facts protein, carbs or fat, and a USDA record's missing nutrient, as 0: a plan could show 0 g for such a food, add
// it into the day's totals and checks, and "Add to My Food Plan" saved 0 instead of unknown. Now the lookups name the
// blanks in `missing` (as Nutrition's own lookups do) and grounding passes such a label over: a food with every value
// answers instead, FITX's own food data first, then USDA, then the coach's own estimate, labelled so.
import "./support/hooks.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { buildCatalogue } = await import("@/lib/ai/food-catalogue");
const { customFoodFor, groundFood, isConflict } = await import("@/lib/ai/grounding");
const { createLiveLookups, fromOpenFoodFacts, fromUsda } = await import("@/lib/ai/food-lookup");
const { parseFood } = await import("@/lib/ai/plans");

const staples = JSON.parse(readFileSync(new URL("../../src/data/fitx-staples.json", import.meta.url), "utf8"));
const foundation = JSON.parse(readFileSync(new URL("../../src/data/usda-foundation-foods.json", import.meta.url), "utf8"));
const catalogue = buildCatalogue(staples, foundation);
const open = { catalogue, diet: [], allergies: { rules: [], other: [] } };

const food = (overrides: Record<string, unknown>) => {
  const parsed = parseFood({ name: "Food", search: "food", quantity: 1, unit: "serving", grams: 100, calories: 100, protein: 5, carbs: 10, fat: 3, cost: "low", ...overrides });
  assert.ok(parsed);
  return parsed;
};

/** Grounds a food FITX keeps (no conflict with the member's diet or allergies). */
async function grounded(...args: Parameters<typeof groundFood>) {
  const result = await groundFood(...args);
  assert.ok(!isConflict(result), "the food is kept");
  return result;
}

// A packaged curd whose label gives energy, protein and carbs but leaves fat blank.
const CURD_LABEL = { "energy-kcal_100g": 66, proteins_100g: 3.1, carbohydrates_100g: 4.4, fat_100g: 3.6 };
const curdProduct = (nutriments: Record<string, unknown>) => ({
  code: "8900000000017",
  product_name: "Set curd",
  brands: "Village Dairy",
  image_front_small_url: "https://images.openfoodfacts.org/images/products/890/000/000/0017/front_en.3.200.jpg",
  nutriments,
});
const withoutField = (field: string) => Object.fromEntries(Object.entries(CURD_LABEL).filter(([key]) => key !== field));
const CURD = food({ name: "Curd", search: "curd", brand: "Village Dairy", quantity: 150, unit: "g", grams: 150, calories: 100, protein: 5, carbs: 7, fat: 6 });

// FITX's own curd (fitx-staples.json, FNDDS 2705418), per 100 g: 78 kcal, 3.82 g protein, 5.57 g carbs, 4.48 g fat.
const OWN_CURD = { name: "Yogurt, whole milk, plain", id: "2705418", calories: 78, protein: 3.82, carbs: 5.57, fat: 4.48 };

describe("Open Food Facts: a label with a blank protein, carbs or fat is never planned with", () => {
  test("the coach's parser names the blank, as Nutrition's does, instead of holding it as an unmarked 0", () => {
    assert.deepEqual(fromOpenFoodFacts(curdProduct(withoutField("fat_100g")))?.missing, ["fat"]);
    assert.deepEqual(fromOpenFoodFacts(curdProduct({ ...CURD_LABEL, fat_100g: "" }))?.missing, ["fat"], "an empty field is blank too");
    assert.deepEqual(fromOpenFoodFacts(curdProduct({ "energy-kcal_100g": 66 }))?.missing, ["protein", "carbs", "fat"]);
    assert.deepEqual(fromOpenFoodFacts(curdProduct(CURD_LABEL))?.missing, [], "a full label has nothing missing");
  });

  test("a blank fat: FITX's own curd answers, so the plan shows and saves its real fat, not 0 g", async () => {
    const product = fromOpenFoodFacts(curdProduct(withoutField("fat_100g")));
    assert.ok(product);
    const result = await grounded(CURD, { ...open, live: { openFoodFacts: async () => [product] } });
    assert.equal(result.item.basis, "database");
    assert.equal(result.item.matchedName, OWN_CURD.name);
    assert.equal(result.item.source, "USDA FoodData Central");
    assert.equal(result.item.basisLabel, "USDA typical recipe");
    assert.equal(result.item.image, null, "the label's photo is not shown for another food");
    assert.equal(result.item.portion, "150 g");
    assert.equal(result.item.fat, 6.7, "4.48 g per 100 g of FITX's curd, for 150 g");
    assert.equal(result.item.protein, 5.7);
    assert.equal(result.item.calories, 117);
    // "Add to My Food Plan" saves FITX's own values for this curd, every one of them known.
    const row = customFoodFor(result);
    assert.deepEqual(
      { calories: row.calories_per_100g, protein: row.protein_per_100g, carbs: row.carbs_per_100g, fat: row.fat_per_100g },
      { calories: OWN_CURD.calories, protein: OWN_CURD.protein, carbs: OWN_CURD.carbs, fat: OWN_CURD.fat },
    );
    assert.equal(row.value_basis, "recipe_calculated");
    assert.equal(row.source_ref, OWN_CURD.id);
    assert.equal(row.brand, "FITX Coach · USDA typical recipe");
    assert.equal(row.image_url, null);
  });

  test("the same for a blank protein or carbs: the label's other values are not used either", async () => {
    for (const field of ["proteins_100g", "carbohydrates_100g"]) {
      const product = fromOpenFoodFacts(curdProduct(withoutField(field)));
      assert.ok(product);
      const result = await grounded(CURD, { ...open, live: { openFoodFacts: async () => [product] } });
      assert.equal(result.item.matchedName, OWN_CURD.name, field);
      assert.equal(customFoodFor(result).value_basis, "recipe_calculated", field);
      assert.equal(customFoodFor(result).protein_per_100g, OWN_CURD.protein, field);
      assert.equal(customFoodFor(result).carbs_per_100g, OWN_CURD.carbs, field);
    }
  });

  test("a label with every value still answers with its own values and photo", async () => {
    const product = fromOpenFoodFacts(curdProduct(CURD_LABEL));
    assert.ok(product);
    const result = await grounded(CURD, { ...open, live: { openFoodFacts: async () => [product] } });
    assert.equal(result.item.basis, "label");
    assert.equal(result.item.matchedName, "Set curd (Village Dairy)");
    assert.equal(result.item.fat, 5.4, "3.6 g per 100 g on the label, for 150 g");
    const row = customFoodFor(result);
    assert.equal(row.fat_per_100g, 3.6);
    assert.equal(row.value_basis, "label");
    assert.equal(row.source_ref, "8900000000017");
    assert.match(row.image_url ?? "", /^https:\/\/images\.openfoodfacts\.org\//);
  });

  test("a blank label FITX's data shows breaks the diet still leaves the dish out: safety comes before the values", async () => {
    const nuggets = fromOpenFoodFacts({ code: "8900000000024", product_name: "Chicken nuggets", brands: "Village Foods", nutriments: { "energy-kcal_100g": 250, proteins_100g: 14, carbohydrates_100g: 18 } });
    assert.ok(nuggets);
    assert.deepEqual(nuggets.missing, ["fat"]);
    const result = await groundFood(
      food({ name: "Nuggets", search: "nuggets", brand: "Village Foods", quantity: 100, unit: "g", grams: 100, calories: 250, protein: 14, carbs: 18, fat: 13 }),
      { ...open, diet: ["vegetarian"], live: { openFoodFacts: async () => [nuggets] } },
    );
    assert.ok(isConflict(result), "left out, not grounded from another food");
    assert.equal(result.conflict, "it is not vegetarian");
  });

  test("the live lookup itself carries the blank through from Open Food Facts' answer", async () => {
    const requests: string[] = [];
    const lookups = createLiveLookups({
      fetch: async (input) => {
        requests.push(input);
        return new Response(JSON.stringify({ products: [curdProduct(withoutField("fat_100g"))] }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    });
    assert.ok(lookups.openFoodFacts);
    const [product] = await lookups.openFoodFacts("Village Dairy curd");
    assert.equal(requests.length, 1);
    assert.match(requests[0], /^https:\/\/world\.openfoodfacts\.org\//);
    assert.deepEqual(product.missing, ["fat"]);
    const result = await grounded(CURD, { ...open, live: lookups });
    assert.equal(result.item.matchedName, OWN_CURD.name);
  });
});

describe("USDA FoodData Central: a record without protein, carbs or fat is never planned with", () => {
  // A dish FITX's own food data does not have, so USDA is the only database left before the coach's estimate.
  const RAGI = food({ name: "Ragi mudde", search: "ragi mudde", quantity: 2, unit: "piece", grams: 200, calories: 230, protein: 6, carbs: 48, fat: 1 });
  const record = (nutrients: Record<string, number>) => ({
    fdcId: 2_799_001,
    description: "Ragi mudde",
    dataType: "Survey (FNDDS)",
    foodNutrients: Object.entries(nutrients).map(([nutrientNumber, value]) => ({ nutrientNumber, value })),
    foodMeasures: [],
  });
  // 208 kcal, 203 protein, 205 carbs, 204 fat.
  const FULL = { "208": 115, "203": 3, "205": 24, "204": 0.5 };
  const without = (number: string) => Object.fromEntries(Object.entries(FULL).filter(([key]) => key !== number));

  test("the coach's parser names a missing nutrient instead of `?? 0`", () => {
    assert.deepEqual(fromUsda(record(without("204")))?.missing, ["fat"]);
    assert.deepEqual(fromUsda(record(without("203")))?.missing, ["protein"]);
    assert.deepEqual(fromUsda(record({ "208": 115 }))?.missing, ["protein", "carbs", "fat"]);
    assert.deepEqual(fromUsda(record(FULL))?.missing, []);
  });

  test("a record with every value is used, as before", async () => {
    const usdaFood = fromUsda(record(FULL));
    assert.ok(usdaFood);
    const result = await grounded(RAGI, { ...open, live: { usda: async () => [usdaFood] } });
    assert.equal(result.item.basis, "database");
    assert.equal(result.item.basisLabel, "USDA typical recipe");
    assert.equal(result.item.fat, 1, "0.5 g per 100 g, for 200 g");
    assert.equal(customFoodFor(result).source_ref, "2799001");
  });

  test("a record without fat (or protein, or carbs) is passed over: the coach's labelled estimate answers, never 0 g", async () => {
    for (const number of ["204", "203", "205"]) {
      const usdaFood = fromUsda(record(without(number)));
      assert.ok(usdaFood);
      const result = await grounded(RAGI, { ...open, live: { usda: async () => [usdaFood] } });
      assert.equal(result.item.basis, "ai_estimate", number);
      assert.equal(result.item.basisLabel, "AI estimate", number);
      assert.equal(result.item.source, null, number);
      assert.deepEqual({ protein: result.item.protein, carbs: result.item.carbs, fat: result.item.fat }, { protein: 6, carbs: 48, fat: 1 }, `${number}: the coach's own numbers`);
      const row = customFoodFor(result);
      assert.equal(row.value_basis, "ai_suggested", number);
      assert.equal(row.brand, "FITX Coach · AI estimate", number);
      assert.deepEqual({ protein: row.protein_per_100g, carbs: row.carbs_per_100g, fat: row.fat_per_100g }, { protein: 3, carbs: 24, fat: 0.5 }, number);
      assert.equal(row.source_ref, null, number);
    }
  });

  test("FITX's own food data is asked before USDA: a curd it has never reaches the incomplete USDA record", async () => {
    let asked = 0;
    const usdaFood = fromUsda({ ...record(without("204")), description: "Curd" });
    const result = await grounded(food({ name: "Curd", search: "curd", quantity: 150, unit: "g", grams: 150, calories: 100, protein: 5, carbs: 7, fat: 6 }), {
      ...open,
      live: { usda: async () => { asked += 1; return usdaFood ? [usdaFood] : []; } },
    });
    assert.equal(asked, 0);
    assert.equal(result.item.matchedName, OWN_CURD.name);
  });
});
