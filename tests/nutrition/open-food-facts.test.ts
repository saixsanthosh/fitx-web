import { test } from "node:test";
import assert from "node:assert/strict";
import { fromOpenFoodFacts, openFoodFactsUserAgent } from "@/lib/food/open-food-facts";

const biscuit = {
  code: "8901063011366",
  product_name_en: "Marie biscuits",
  brands: "Britannia",
  image_front_small_url: "https://images.openfoodfacts.org/images/products/890/106/301/1366/front_en.4.200.jpg",
  nutriments: { "energy-kcal_100g": 442, proteins_100g: 7.4, carbohydrates_100g: 75.6, fat_100g: 12.5 },
  serving_size: "6 biscuits (27 g)",
  serving_quantity: 27,
  product_quantity: 250,
  product_quantity_unit: "g",
  quantity: "250 g",
};

test("an Open Food Facts product becomes a package-label result with serving and pack portions", () => {
  const food = fromOpenFoodFacts(biscuit);
  assert.ok(food);
  assert.equal(food.kind, "packaged");
  assert.equal(food.valueBasis, "label");
  assert.equal(food.basis, "Package label (Open Food Facts)");
  assert.deepEqual([food.calories, food.protein, food.carbs, food.fat], [442, 7.4, 75.6, 12.5]);
  assert.deepEqual(food.portions, [
    { label: "1 serving (6 biscuits (27 g))", unit: "serving", grams: 27, estimate: false },
    { label: "1 pack (250 g)", unit: "piece", grams: 250, estimate: false },
  ]);
  assert.equal(food.barcode, "8901063011366");
  assert.equal(food.sourceUrl, "https://world.openfoodfacts.org/product/8901063011366");
  assert.match(food.imageCredit ?? "", /Open Food Facts contributors, CC BY-SA/);
});

test("only Open Food Facts image hosts are shown, and bad labels are left out", () => {
  assert.equal(fromOpenFoodFacts({ ...biscuit, image_front_small_url: "https://example.com/x.jpg" })?.image, null);
  assert.equal(fromOpenFoodFacts({ ...biscuit, nutriments: { "energy-kcal_100g": 1849, proteins_100g: 7.4, carbohydrates_100g: 75.6, fat_100g: 12.5 } })?.calories, 442, "kJ in the kcal field is read as kJ");
  assert.equal(fromOpenFoodFacts({ ...biscuit, nutriments: { proteins_100g: 7 } }), null, "no energy, no result");
  assert.equal(fromOpenFoodFacts({ ...biscuit, product_name_en: "", product_name: "" }), null);
  const drink = fromOpenFoodFacts({ ...biscuit, serving_size: "250 ml", serving_quantity: 250, product_quantity: 1, product_quantity_unit: "l" });
  assert.deepEqual(drink?.portions, [], "a serving or pack in millilitres is not treated as grams");
});

test("the User-Agent always names a contact", () => {
  const before = process.env.OPEN_FOOD_FACTS_USER_AGENT;
  try {
    delete process.env.OPEN_FOOD_FACTS_USER_AGENT;
    assert.equal(openFoodFactsUserAgent(), "FITX/1.0 (https://fitnessx.vercel.app)");
    process.env.OPEN_FOOD_FACTS_USER_AGENT = "FITX/1.0";
    assert.equal(openFoodFactsUserAgent(), "FITX/1.0 (https://fitnessx.vercel.app)");
    process.env.OPEN_FOOD_FACTS_USER_AGENT = "FITX/1.0 (support@example.test)";
    assert.equal(openFoodFactsUserAgent(), "FITX/1.0 (support@example.test)");
  } finally {
    if (before === undefined) delete process.env.OPEN_FOOD_FACTS_USER_AGENT;
    else process.env.OPEN_FOOD_FACTS_USER_AGENT = before;
  }
});
