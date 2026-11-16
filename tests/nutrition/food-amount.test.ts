import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { amountAfterUnitChange, amountInGrams, countToKeep } from "@/lib/domain/food-amount";
import type { TypedCount } from "@/lib/domain/food-amount";
import { clearMatch, formatAmount, inferFoodState, matchFoods, parseFoodQuery, resolvePortion } from "@/lib/domain/food-query";
import type { FoodPortion, FoodState } from "@/lib/domain/food-query";
import { scaleMacros } from "@/lib/domain/nutrition";

type CatalogueFood = {
  id: string;
  name: string;
  aliases?: string[];
  state: FoodState | null;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  portions: FoodPortion[];
};

const staples = (JSON.parse(readFileSync(new URL("../../src/data/fitx-staples.json", import.meta.url), "utf8")) as { foods: CatalogueFood[] }).foods;
const stapleIds = new Set(staples.map((food) => food.id));
const snapshot = (JSON.parse(readFileSync(new URL("../../src/data/usda-foundation-foods.json", import.meta.url), "utf8")) as CatalogueFood[])
  .filter((food) => !stapleIds.has(food.id))
  .map((food) => ({ ...food, state: inferFoodState(food.name), portions: [] }));
// As in the search route: the curated staples first, then the USDA Foundation snapshot without the staples it repeats.
const catalogue: CatalogueFood[] = [...staples, ...snapshot];

/** The Add to log panel: the food, the Amount field's text, the Unit (null is grams) and the count FITX asked about. */
type Fields = { food: CatalogueFood; amount: string; unit: FoodPortion | null; typed: TypedCount | null };

/** What the nutrition page fills in for a search that selects a food; a phrase with no amount is a plain tap. */
function select(phrase: string): Fields {
  const query = parseFoodQuery(phrase);
  const food = clearMatch(matchFoods(catalogue, query.words));
  assert.ok(food, `"${phrase}" should select a food`);
  const resolution = resolvePortion(query, food.portions);
  if (resolution.kind === "grams") return { food, amount: formatAmount(resolution.grams), unit: null, typed: null };
  if (resolution.kind === "portion") return { food, amount: formatAmount(resolution.count), unit: resolution.portion, typed: null };
  if (resolution.kind === "ask") return { food, amount: "", unit: null, typed: countToKeep(resolution) };
  const piece = food.portions.find((portion) => portion.countDefault) ?? null;
  return { food, amount: piece ? "1" : "100", unit: piece, typed: null };
}

/** Picks another option under Unit (null is grams) and says what Add to log would then record. */
function pick(fields: Fields, label: string | null) {
  const unit = label === null ? null : fields.food.portions.find((portion) => portion.label === label) ?? null;
  assert.ok(label === null || unit, `${fields.food.name} has no "${label}"`);
  const amount = amountAfterUnitChange(fields.amount, fields.unit, unit, fields.typed);
  const grams = amountInGrams(amount.trim() ? Number(amount) : Number.NaN, unit);
  // The page clears its question once a unit is picked, and the count it kept with it.
  return { food: fields.food, amount, unit, typed: null, grams, kcal: Math.round(scaleMacros(fields.food, grams).calories) };
}

// Regression: a size change under Unit kept the grams, so the count changed instead. "2 samosas" switched to
// the small size logged 8 small samosas (200 g, 620 kcal), and the dropdown is the only way to an extra large egg.
test("switching between two sizes of the same piece keeps the count", () => {
  const cases: Array<[string, string, string, string, number, number]> = [
    // phrase, unit it selects, size picked, amount after, grams, kcal
    ["2 samosas", "1 regular/large", "1 small/individual", "2", 50, 155],
    ["2 rotis", '1 medium chappatti or roti (7")', '1 large chappatti or roti (8")', "2", 104, 311],
    ["1 masala dosa", "1 medium", "1 small", "1", 113, 208],
    ["2 eggs", "1 large", "1 medium", "2", 88, 126],
    ["2 eggs", "1 large", "1 extra large", "2", 112, 160],
    ["naan", '1 Naan (10" dia)', '1 piece (1/4 of 10" dia)', "1", 44, 137],
  ];
  for (const [phrase, selected, size, amount, grams, kcal] of cases) {
    const fields = select(phrase);
    assert.equal(fields.unit?.label, selected, phrase);
    const after = pick(fields, size);
    assert.deepEqual({ amount: after.amount, grams: after.grams, kcal: after.kcal }, { amount, grams, kcal }, `${phrase}, then ${size}`);
  }
  const small = pick(select("2 samosas"), "1 small/individual");
  assert.equal(pick(small, "1 regular/large").grams, 200, "and back to the regular size");
  assert.equal(pick({ ...select("2 samosas"), amount: "1.5" }, "1 small/individual").amount, "1.5", "the count is kept as typed");
});

test("grams and different units still convert by weight", () => {
  const cases: Array<[string, string | null, string, number]> = [
    // phrase, unit picked (null is grams), amount after, grams
    ["2 eggs", null, "100", 100],
    ["114 g idli", "1 item", "3", 114],
    ["200 g rice", "1 cup, cooked", "1.27", 200.7],
    ["2 boiled eggs", "1 cup, chopped", "0.74", 100.6],
    ["2 tomatoes", '1 slice, medium (1/4" thick)', "12.3", 246],
    ["1 tbsp olive oil", "1 tsp", "3", 13.5],
    ["1 tbsp olive oil", null, "13.5", 13.5],
  ];
  for (const [phrase, label, amount, grams] of cases) {
    const after = pick(select(phrase), label);
    assert.deepEqual({ amount: after.amount, grams: after.grams }, { amount, grams }, `${phrase}, then ${label ?? "grams"}`);
  }
});

test("with no amount yet, a measure starts at 1 and grams at 100", () => {
  const blank = { ...select("2 samosas"), amount: "" };
  assert.equal(pick(blank, "1 small/individual").amount, "1");
  assert.equal(pick(blank, null).amount, "100");
  assert.equal(pick({ ...blank, amount: "0" }, "1 small/individual").amount, "1");
  const grams = { ...select("150 g rice"), amount: "" };
  assert.equal(pick(grams, "1 cup, cooked").amount, "1");
});

// Regression: following the "no small size" prompt set the amount to 1, so "2 small boiled eggs" logged one egg.
test("picking a size after FITX asks about it keeps the count that was typed", () => {
  for (const phrase of ["2 small boiled eggs", "2 medium boiled eggs"]) {
    const asked = select(phrase);
    assert.deepEqual({ amount: asked.amount, unit: asked.unit, typed: asked.typed }, { amount: "", unit: null, typed: { amount: 2, unit: "piece" } }, phrase);
    const large = pick(asked, "1 large");
    assert.deepEqual({ amount: large.amount, grams: large.grams, kcal: large.kcal }, { amount: "2", grams: 100, kcal: 155 }, phrase);
    // The 2 counts eggs, not cups of chopped egg, and grams still start at 100.
    assert.equal(pick(asked, "1 cup, chopped").amount, "1", phrase);
    assert.equal(pick(asked, null).amount, "100", phrase);
  }
  const slices = select("2 small slices tomato");
  assert.deepEqual(slices.typed, { amount: 2, unit: "slice" });
  assert.equal(pick(slices, '1 slice, medium (1/4" thick)').grams, 40, "a count of slices applies to slices");
  assert.equal(pick(slices, '1 small whole (2-2/5" dia)').amount, "1", "and not to whole tomatoes");
  // Other questions keep no count: "150 rice" probably means grams, and a katori or cups say nothing about pieces.
  for (const phrase of ["150 rice", "1 katori dal", "2 cups idli"]) assert.equal(select(phrase).typed, null, phrase);
});
