import "./support/hooks.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { buildCatalogue } = await import("@/lib/ai/food-catalogue");
const grounding = await import("@/lib/ai/grounding");
const { customFoodFor, customMealFor, resize, isConflict } = grounding;
const { fromOpenFoodFacts } = await import("@/lib/ai/food-lookup");
const { parseFood, parseMealPlan, parseWorkout, parseSwap } = await import("@/lib/ai/plans");

const staples = JSON.parse(readFileSync(new URL("../../src/data/fitx-staples.json", import.meta.url), "utf8"));
const foundation = JSON.parse(readFileSync(new URL("../../src/data/usda-foundation-foods.json", import.meta.url), "utf8"));
const catalogue = buildCatalogue(staples, foundation);
const open = { catalogue, diet: [], allergies: { rules: [], other: [] } };

/** groundFood for a food FITX keeps (no conflict with the member's diet or allergies). */
async function groundFood(...args: Parameters<typeof grounding.groundFood>) {
  const result = await grounding.groundFood(...args);
  assert.ok(!isConflict(result), "the food is kept");
  return result;
}

const food = (overrides: Record<string, unknown>) => {
  const parsed = parseFood({ name: "Food", search: "food", quantity: 1, unit: "serving", grams: 100, calories: 100, protein: 5, carbs: 10, fat: 3, cost: "low", ...overrides });
  assert.ok(parsed);
  return parsed;
};

describe("grounding suggested foods in FITX's food data", () => {
  test("'3 idli' uses USDA's per-piece weight and values, like Nutrition search", async () => {
    const result = await groundFood(food({ name: "Idli", search: "idli", quantity: 3, unit: "piece", grams: 120, calories: 160 }), open);
    assert.equal(result.item.basis, "database");
    assert.equal(result.item.basisLabel, "USDA typical recipe");
    assert.equal(result.item.source, "USDA FoodData Central");
    assert.equal(result.item.grams, 114);
    assert.equal(result.item.portion, "3 pieces (114 g)");
    assert.equal(result.item.calories, 146);
    assert.equal(result.item.portionEstimated, true, "USDA piece weights are averages");
    assert.equal(result.item.image, null, "no stand-in photo");
  });

  test("grams of cooked rice match the cooked staple, not raw grain", async () => {
    const result = await groundFood(food({ name: "Steamed rice", search: "cooked white rice", quantity: 150, unit: "g", grams: 150, calories: 195, protein: 4, carbs: 42, fat: 0.4 }), open);
    assert.equal(result.item.matchedName, "Rice, white, cooked, no added fat");
    assert.equal(result.item.calories, 194);
    assert.equal(result.item.portion, "150 g");
    assert.equal(result.item.portionEstimated, false);
    assert.equal(result.scalable, true);
  });

  test("a household unit with no standard weight keeps the coach's weight, marked as an estimate", async () => {
    const result = await groundFood(food({ name: "Dal", search: "dal", quantity: 1, unit: "katori", grams: 150, calories: 220 }), open);
    assert.equal(result.item.basis, "database");
    assert.equal(result.item.grams, 150);
    assert.equal(result.item.portion, "1 katori (about 150 g)");
    assert.equal(result.item.portionEstimated, true);
    assert.equal(result.item.calories, Math.round(1.45 * 150));
  });

  test("foods FITX does not have are labelled 'AI estimate' with the coach's own numbers", async () => {
    const result = await groundFood(food({ name: "Ragi mudde", search: "ragi mudde", quantity: 2, unit: "piece", grams: 200, calories: 230, protein: 6, carbs: 48, fat: 1 }), open);
    assert.equal(result.item.basis, "ai_estimate");
    assert.equal(result.item.basisLabel, "AI estimate");
    assert.equal(result.item.source, null);
    assert.equal(result.item.calories, 230);
    assert.equal(result.item.portion, "2 pieces (about 200 g)");
  });

  test("an implausible match (raw grain for a cooked dish) is rejected", async () => {
    const result = await groundFood(food({ name: "Cooked rice", search: "cooked rice", quantity: 150, unit: "g", grams: 150, calories: 540 }), open);
    assert.equal(result.item.basis, "ai_estimate");
  });

  test("a food whose FITX match breaks the member's allergies is left out, not kept as an AI estimate", async () => {
    const result = await grounding.groundFood(food({ name: "Clarified butter", search: "ghee", quantity: 1, unit: "tbsp", grams: 14, calories: 123, protein: 0, carbs: 0, fat: 14 }), { ...open, allergies: { rules: ["dairy"], other: [] } });
    assert.ok(isConflict(result), "FITX's data says what the name hides");
    assert.equal(result.name, "Clarified butter");
    assert.match(result.conflict, /dairy/);
  });

  test("a packaged product takes its label values and photo from Open Food Facts", async () => {
    const product = fromOpenFoodFacts({
      code: "8901262010016",
      product_name: "Masti Spiced Buttermilk",
      brands: "Amul",
      image_front_small_url: "https://images.openfoodfacts.org/images/products/890/126/201/0016/front_en.3.200.jpg",
      nutriments: { "energy-kcal_100g": 15, proteins_100g: 0.8, carbohydrates_100g: 1.6, fat_100g: 0.6 },
      serving_size: "200 ml (200 g)",
    });
    assert.ok(product);
    const live = { openFoodFacts: async () => [product] };
    const result = await groundFood(food({ name: "Spiced buttermilk", search: "buttermilk", brand: "Amul", quantity: 200, unit: "ml", grams: 200, calories: 30 }), { ...open, live });
    assert.equal(result.item.basis, "label");
    assert.equal(result.item.basisLabel, "Package label (Open Food Facts)");
    assert.equal(result.item.image, "https://images.openfoodfacts.org/images/products/890/126/201/0016/front_en.3.200.jpg");
    assert.equal(fromOpenFoodFacts({ product_name: "x", image_front_small_url: "https://evil.example/x.jpg", nutriments: { "energy-kcal_100g": 1 } })?.image, null);
  });

  test("the custom food row: per-100 g values, the suggested serving, a visible origin and Nutrition v2's value basis", async () => {
    const idli = await groundFood(food({ name: "Idli", search: "idli", quantity: 3, unit: "piece", grams: 120, calories: 160 }), open);
    const row = customFoodFor(idli);
    assert.deepEqual(row, {
      name: "Idli",
      brand: "FITX Coach · USDA typical recipe",
      serving_size: "3 pieces (114 g)",
      serving_grams: 114,
      calories_per_100g: 128,
      protein_per_100g: 6.36,
      carbs_per_100g: 24.98,
      fat_per_100g: 0.35,
      // USDA FNDDS values are a typical recipe; source_ref is the FDC id, as Nutrition's catalogue stores it.
      value_basis: "recipe_calculated",
      image_url: null,
      image_attribution: null,
      source_ref: "2708346",
    });
    const estimate = await groundFood(food({ name: "Ragi mudde", search: "ragi mudde", grams: 200, calories: 230 }), open);
    const estimateRow = customFoodFor(estimate);
    assert.equal(estimateRow.brand, "FITX Coach · AI estimate");
    assert.equal(estimateRow.value_basis, "ai_suggested");
    assert.equal(estimateRow.source_ref, null);
    const meal = customMealFor("Breakfast", [idli, estimate]);
    assert.ok(meal);
    assert.equal(meal.serving_grams, 314);
    assert.equal(meal.brand, "FITX Coach · includes AI estimates");
    assert.equal(meal.value_basis, "ai_suggested", "a meal with an AI estimate in it is an AI suggestion");
    assert.equal(Math.round((meal.calories_per_100g * 314) / 100), idli.item.calories + estimate.item.calories);
    assert.equal(customMealFor("Breakfast", [idli])?.value_basis, "recipe_calculated", "FITX adds up the database values");
    const rice = await groundFood(food({ name: "Steamed rice", search: "cooked white rice", quantity: 150, unit: "g", grams: 150, calories: 195, protein: 4, carbs: 42, fat: 0.4 }), open);
    assert.equal(customFoodFor(rice).value_basis, "recipe_calculated");
  });

  test("a packaged product's row says its values come from the label, with the product photo and barcode", async () => {
    const product = fromOpenFoodFacts({
      code: "8901262010016",
      product_name: "Masti Spiced Buttermilk",
      brands: "Amul",
      image_front_small_url: "https://images.openfoodfacts.org/images/products/890/126/201/0016/front_en.3.200.jpg",
      nutriments: { "energy-kcal_100g": 15, proteins_100g: 0.8, carbohydrates_100g: 1.6, fat_100g: 0.6 },
    });
    assert.ok(product);
    const result = await groundFood(food({ name: "Spiced buttermilk", search: "buttermilk", brand: "Amul", quantity: 200, unit: "ml", grams: 200, calories: 30 }), { ...open, live: { openFoodFacts: async () => [product] } });
    const row = customFoodFor(result);
    assert.equal(row.value_basis, "label");
    assert.equal(row.source_ref, "8901262010016");
    assert.equal(row.image_url, "https://images.openfoodfacts.org/images/products/890/126/201/0016/front_en.3.200.jpg");
    assert.match(row.image_attribution ?? "", /Open Food Facts/);
  });

  test("a model weight far from the food's own is not taken as the database portion (no impossible per-100 g values)", async () => {
    // The model says 1 piece of idli weighs 5 g but gives 160 kcal: the item is dropped as implausible before grounding.
    assert.equal(parseFood({ name: "Idli", search: "idli", quantity: 1, unit: "piece", grams: 5, calories: 160, protein: 5, carbs: 30, fat: 1 }), null);
    assert.equal(parseFood({ name: "Dal", search: "dal", quantity: 1, unit: "katori", grams: 20, calories: 50, protein: 9, carbs: 20, fat: 2 }), null, "31 g of macros in 20 g of food");
    assert.ok(parseFood({ name: "Ghee", search: "ghee", quantity: 1, unit: "tbsp", grams: 14, calories: 123, protein: 0, carbs: 0, fat: 14 }), "fat at 900 kcal per 100 g is fine");
  });

  test("resizing changes gram portions only", async () => {
    const rice = await groundFood(food({ name: "Rice", search: "cooked white rice", quantity: 100, unit: "g", grams: 100, calories: 130 }), open);
    assert.equal(resize(rice, 1.5).item.grams, 150);
    const idli = await groundFood(food({ name: "Idli", search: "idli", quantity: 2, unit: "piece", grams: 80, calories: 100 }), open);
    assert.equal(resize(idli, 1.5).item.grams, idli.item.grams);
  });
});

describe("model output parsers", () => {
  test("meal plans: clean, clamp and drop broken items", () => {
    const plan = parseMealPlan({
      title: "  Budget veg day  ",
      summary: "Fits your target.",
      meals: [
        { name: "Breakfast", items: [{ name: "Idli", search: "idli", quantity: 3, unit: "piece", grams: 114, calories: 146, protein: 7, carbs: 28, fat: 0.4, cost: "low" }, { name: "", quantity: 1 }] },
        { name: "Lunch", items: [{ name: "Rice", search: "cooked rice", quantity: 999, unit: "spoonful", grams: 99999, calories: -5, protein: 3, carbs: 40, fat: 1, cost: "cheap" }] },
        { name: "Empty", items: [] },
      ],
      tips: ["Drink water", 7, "Sleep well", "Walk", "Too many"],
    });
    assert.ok(plan);
    assert.equal(plan.title, "Budget veg day");
    assert.equal(plan.meals.length, 2);
    assert.equal(plan.meals[0].items.length, 1);
    const rice = plan.meals[1].items[0];
    assert.equal(rice.quantity, 50, "a count is capped at 50");
    assert.equal(rice.grams, 2000);
    assert.equal(rice.unit, "serving");
    assert.equal(rice.calories, 0);
    assert.equal(rice.cost, null);
    assert.deepEqual(plan.tips, ["Drink water", "Sleep well", "Walk"]);
    assert.equal(parseMealPlan({ meals: [] }), null);
    assert.equal(parseMealPlan("not a plan"), null);
  });

  test("workouts: only listed exercise ids, no repeats, sane ranges", () => {
    const allowed = new Set(["push_up", "goblet_squat", "plank"]);
    const workout = parseWorkout({
      title: "Home strength",
      summary: "",
      exercises: [
        { id: "push_up", sets: 30, reps_min: 12, reps_max: 8, rest_seconds: 5 },
        { id: "made_up_move", sets: 3, reps_min: 8, reps_max: 12, rest_seconds: 60 },
        { id: "push_up", sets: 3, reps_min: 8, reps_max: 12, rest_seconds: 60 },
        { id: "goblet_squat", sets: 3, reps_min: 8, reps_max: 12, rest_seconds: 90 },
      ],
      tips: [],
    }, allowed);
    assert.ok(workout);
    assert.deepEqual(workout.exercises.map((exercise) => exercise.id), ["push_up", "goblet_squat"]);
    assert.deepEqual(workout.exercises[0], { id: "push_up", sets: 10, repsMin: 12, repsMax: 12, restSeconds: 15, holdSeconds: null, note: null });
    const hold = parseWorkout({ exercises: [{ id: "plank", sets: 3, reps_min: 1, reps_max: 1, rest_seconds: 45, hold_seconds: 30 }, { id: "push_up", sets: 3, reps_min: 8, reps_max: 12, rest_seconds: 60, hold_seconds: 0 }] }, allowed);
    assert.equal(hold?.exercises[0].holdSeconds, 30);
    assert.equal(hold?.exercises[0].repsMax, 1);
    assert.equal(hold?.exercises[1].holdSeconds, null);
    assert.equal(parseWorkout({ exercises: [{ id: "made_up_move" }] }, allowed), null);
  });

  test("swaps", () => {
    const swap = parseSwap({ options: [{ name: "Chana", search: "boiled chickpeas", quantity: 100, unit: "g", grams: 100, calories: 160, protein: 9, carbs: 27, fat: 2.6, cost: "low", why: "Cheaper protein." }] });
    assert.equal(swap?.options[0].why, "Cheaper protein.");
    assert.equal(parseSwap({ options: [] }), null);
  });
});
