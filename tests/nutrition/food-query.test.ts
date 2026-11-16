import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  askForGramsMessage,
  describePortion,
  foodMatchScore,
  gramsInLabel,
  inferFoodState,
  parseFoodQuery,
  portionFromLabel,
  rankFoods,
  resolvePortion,
  singular,
  withCountDefault,
} from "@/lib/domain/food-query";
import type { FoodPortion, FoodState, FoodUnit, PortionSize } from "@/lib/domain/food-query";
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
const snapshot = (JSON.parse(readFileSync(new URL("../../src/data/usda-foundation-foods.json", import.meta.url), "utf8")) as CatalogueFood[])
  .map((food) => ({ ...food, state: inferFoodState(food.name), portions: [] }));
// The search route lists the curated staples before the USDA Foundation snapshot, as here.
const catalogue: CatalogueFood[] = [...staples, ...snapshot];

function lookup(phrase: string) {
  const query = parseFoodQuery(phrase);
  const [food] = rankFoods(catalogue, query.words);
  assert.ok(food, `nothing matched "${phrase}"`);
  return { query, food, resolution: resolvePortion(query, food.portions) };
}

test("parses amounts, units and sizes out of a food phrase", () => {
  const cases: Array<[string, string, number | null, FoodUnit | null, PortionSize | null]> = [
    ["3 idlis", "idlis", 3, null, null],
    ["3 idli", "idli", 3, null, null],
    ["2 rotis", "rotis", 2, null, null],
    ["150 g rice", "rice", 150, "g", null],
    ["150g rice", "rice", 150, "g", null],
    ["rice 150g", "rice", 150, "g", null],
    ["Rice 150 grams", "rice", 150, "g", null],
    ["1.5 cups", "", 1.5, "cup", null],
    ["1.5cups rice", "rice", 1.5, "cup", null],
    ["1 1/2 cups rice", "rice", 1.5, "cup", null],
    ["½ cup dal", "dal", 0.5, "cup", null],
    ["1½ cups dal", "dal", 1.5, "cup", null],
    ["half cup dal", "dal", 0.5, "cup", null],
    [".5 cup oats", "oats", 0.5, "cup", null],
    ["2,5 cups milk", "milk", 2.5, "cup", null],
    ["1,000 g rice", "rice", 1000, "g", null],
    ["200g paneer", "paneer", 200, "g", null],
    ["200 GM Paneer", "paneer", 200, "g", null],
    ["2 large rotis", "rotis", 2, null, "large"],
    ["1 medium dosa", "dosa", 1, null, "medium"],
    ["a cup of rice", "rice", 1, "cup", null],
    ["cup of tea", "tea", 1, "cup", null],
    ["idli x 3", "idli", 3, null, null],
    ["3x idli", "idli", 3, null, null],
    ["3 nos idli", "idli", 3, "piece", null],
    ["2 pcs samosa", "samosa", 2, "piece", null],
    ["330 ml coke", "coke", 330, "ml", null],
    ["8 fl oz milk", "milk", 8, "floz", null],
    ["1 kg chicken", "chicken", 1, "kg", null],
    ["2 tbsp ghee", "ghee", 2, "tbsp", null],
    ["1 katori dal", "dal", 1, "katori", null],
    ["one roti", "roti", 1, null, null],
    ["a dozen eggs", "eggs", 12, null, null],
    ["about 150 g cooked rice", "cooked rice", 150, "g", null],
    ["rice, 150g", "rice", 150, "g", null],
    ["chicken biryani", "chicken biryani", null, null, null],
    ["7up", "7up", null, null, null],
    ["", "", null, null, null],
  ];
  for (const [input, text, amount, unit, size] of cases) {
    const parsed = parseFoodQuery(input);
    assert.deepEqual({ text: parsed.text, amount: parsed.amount, unit: parsed.unit, size: parsed.size }, { text, amount, unit, size }, input);
  }
});

test("matches plural food words to singular names", () => {
  assert.equal(singular("idlis"), "idli");
  assert.equal(singular("rotis"), "roti");
  assert.equal(singular("tomatoes"), "tomato");
  assert.equal(singular("berries"), "berry");
  assert.equal(singular("glasses"), "glass");
  assert.equal(singular("hummus"), "hummus");
  assert.equal(singular("dal"), "dal");
  assert.ok(foodMatchScore({ name: "Oreo cookie" }, ["cookies"]) > 0);
  assert.equal(foodMatchScore({ name: "Idli" }, ["dosa"]), 0);
});

test("150 g rice resolves to cooked white rice, about 195 kcal", () => {
  const { food, resolution } = lookup("150 g rice");
  assert.equal(food.id, "2708408");
  assert.equal(food.state, "cooked");
  assert.deepEqual(resolution, { kind: "grams", grams: 150 });
  const calories = scaleMacros(food, 150).calories;
  assert.ok(Math.abs(calories - 195) <= 3, `got ${calories} kcal`);
});

test("3 idli is about 114 g and 146 kcal, flagged as a portion estimate", () => {
  for (const phrase of ["3 idli", "3 idlis", "idli x 3", "three idlis"]) {
    const { food, resolution } = lookup(phrase);
    assert.equal(food.id, "2708346", phrase);
    assert.equal(resolution.kind, "portion", phrase);
    if (resolution.kind !== "portion") continue;
    assert.equal(resolution.grams, 114, phrase);
    assert.equal(resolution.count, 3, phrase);
    assert.equal(resolution.estimate, true, phrase);
    assert.equal(resolution.portion.label, "1 item", phrase);
    assert.equal(Math.round(scaleMacros(food, resolution.grams).calories), 146, phrase);
    assert.equal(describePortion(resolution.count, resolution.portion, resolution.grams), "3 × 1 item (114 g)");
  }
});

test("piece counts use USDA piece weights, with sizes when typed", () => {
  const twoRotis = lookup("2 rotis");
  assert.equal(twoRotis.food.id, "2707713");
  assert.equal(twoRotis.resolution.kind === "portion" && twoRotis.resolution.grams, 80);
  const largeRotis = lookup("2 large rotis");
  assert.equal(largeRotis.resolution.kind === "portion" && largeRotis.resolution.grams, 104);
  const dosa = lookup("1 dosa");
  assert.equal(dosa.food.id, "2708347");
  assert.equal(dosa.resolution.kind === "portion" && dosa.resolution.grams, 80);
  const masala = lookup("1 masala dosa");
  assert.equal(masala.food.id, "2709129");
  assert.equal(masala.resolution.kind === "portion" && masala.resolution.grams, 267);
  const samosa = lookup("2 small samosas");
  assert.equal(samosa.resolution.kind === "portion" && samosa.resolution.grams, 50);
});

test("cups and spoons use USDA volume weights, converting between US measures", () => {
  const rice = lookup("1.5 cups rice");
  assert.equal(rice.resolution.kind === "portion" && rice.resolution.grams, 237);
  const dal = lookup("200 ml dal");
  assert.equal(dal.resolution.kind, "portion");
  if (dal.resolution.kind === "portion") {
    assert.equal(dal.resolution.grams, 202.9);
    assert.equal(dal.resolution.derivedFrom?.label, "1 cup");
    assert.equal(dal.resolution.estimate, true);
  }
  const ghee = lookup("2 tsp ghee");
  assert.equal(ghee.resolution.kind === "portion" && ghee.resolution.grams, 9.3);
  assert.equal(ghee.resolution.kind === "portion" && ghee.resolution.derivedFrom?.label, "1 tablespoon");
});

test("asks for grams instead of guessing when a unit has no known weight", () => {
  const katori = lookup("1 katori dal");
  assert.deepEqual(katori.resolution, { kind: "ask", amount: 1, unit: "katori", reason: "household-unit" });
  const bareNumber = lookup("150 rice");
  assert.deepEqual(bareNumber.resolution, { kind: "ask", amount: 150, unit: null, reason: "no-count-weight" });
  const cupsOfIdli = lookup("2 cups idli");
  assert.deepEqual(cupsOfIdli.resolution, { kind: "ask", amount: 2, unit: "cup", reason: "no-unit-weight" });
  assert.match(askForGramsMessage("Dal", katori.resolution as Extract<typeof katori.resolution, { kind: "ask" }>), /katori has no standard weight.*Dal/);
  assert.match(askForGramsMessage("Rice", bareNumber.resolution as Extract<typeof bareNumber.resolution, { kind: "ask" }>), /Enter the amount in grams/);
});

test("weights are exact conversions, not estimates", () => {
  assert.deepEqual(resolvePortion(parseFoodQuery("1 kg chicken")), { kind: "grams", grams: 1000 });
  assert.deepEqual(resolvePortion(parseFoodQuery("4 oz chicken")), { kind: "grams", grams: 113.4 });
  assert.deepEqual(resolvePortion(parseFoodQuery("chicken")), { kind: "none" });
});

test("a saved serving answers bare counts and is not an estimate", () => {
  const serving: FoodPortion = { label: "1 serving (80 g)", unit: "serving", grams: 80, countDefault: true, estimate: false };
  const two = resolvePortion(parseFoodQuery("2 mom's paratha"), [serving]);
  assert.equal(two.kind === "portion" && two.grams, 160);
  assert.equal(two.kind === "portion" && two.estimate, false);
  assert.equal(resolvePortion(parseFoodQuery("2 servings"), [serving]).kind, "portion");
});

test("ranks cooked staples before raw grains and exact words before prefixes", () => {
  const rice = rankFoods(catalogue, ["rice"]);
  assert.deepEqual(rice.slice(0, 3).map((food) => food.id), ["2708408", "2708414", "169759"], "cooked white, brown and parboiled rice first");
  assert.ok(rice.slice(3, 7).every((food) => food.state === "raw"), "then the raw grains, labelled raw");

  const eggs = rankFoods(catalogue, ["egg"]).map((food) => food.name);
  assert.ok(eggs.indexOf("Eggs, Grade A, Large, egg whole") < eggs.indexOf("Eggplant, raw"));
  assert.ok(eggs.indexOf("Eggs, Grade A, Large, egg whole") < eggs.indexOf("Egg, whole, dried"), "fresh egg before egg powder");
  assert.equal(rankFoods(catalogue, ["dried", "egg"])[0].name.includes("dried"), true, "asking for dried keeps dried first");
  assert.equal(rankFoods(catalogue, ["oats"]).some((food) => food.name.startsWith("Biryani")), false, "'oats' must not match 'goat biryani'");

  assert.equal(rankFoods(catalogue, ["dosa"])[0].id, "2708347");
  assert.equal(rankFoods(catalogue, ["masala", "dosa"])[0].id, "2709129");
  assert.equal(rankFoods(catalogue, ["chapati"])[0].id, "2707713");
  assert.equal(rankFoods(catalogue, ["sambhar"])[0].id, "2707430");
});

test("reads raw and cooked from USDA descriptions", () => {
  assert.equal(inferFoodState("Lentils, dry"), "raw");
  assert.equal(inferFoodState("Chicken, broilers or fryers, drumstick, meat only, cooked, braised"), "cooked");
  assert.equal(inferFoodState("Cheese, dry white, queso seco"), null);
  assert.equal(inferFoodState("Egg, whole, dried"), null);
  assert.equal(inferFoodState("Bananas, ripe and slightly ripe, raw"), "raw");
  assert.equal(inferFoodState("Oats, whole grain, rolled, old fashioned"), null);
});

test("builds portions from USDA measure wording", () => {
  assert.deepEqual(portionFromLabel("1 item", 38), { label: "1 item", unit: "piece", grams: 38 });
  assert.deepEqual(portionFromLabel("1 cup, cooked", 158), { label: "1 cup, cooked", unit: "cup", grams: 158 });
  assert.deepEqual(portionFromLabel('1 medium chappatti or roti (7")', 40), { label: '1 medium chappatti or roti (7")', unit: "piece", grams: 40 });
  assert.deepEqual(portionFromLabel("1 tablespoon", 14), { label: "1 tablespoon", unit: "tbsp", grams: 14 });
  assert.equal(portionFromLabel("Quantity not specified", 76), null);
  assert.equal(portionFromLabel("1 surface inch", 9.8), null);
  assert.equal(portionFromLabel("2 tablespoons", 28), null);
  assert.equal(portionFromLabel("1 oz", 28.35), null);

  const sized = withCountDefault([
    { label: "1 small", unit: "piece", grams: 35 },
    { label: "1 medium", unit: "piece", grams: 80 },
    { label: "1 cup", unit: "cup", grams: 200 },
  ]);
  assert.deepEqual(sized.filter((portion) => portion.countDefault).map((portion) => portion.label), ["1 medium"]);
});

test("finds the gram weight in a package serving label", () => {
  assert.equal(gramsInLabel("30 g"), 30);
  assert.equal(gramsInLabel("2 biscuits (12.5g)"), 12.5);
  assert.equal(gramsInLabel("250 ml"), null);
  assert.equal(gramsInLabel(undefined), null);
});
