import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  amountAfterUnitChange,
  askForGramsMessage,
  clearMatch,
  describePortion,
  describeTypedAmount,
  foodMatchScore,
  gramsInLabel,
  inferFoodState,
  matchFoods,
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
const stapleIds = new Set(staples.map((food) => food.id));
const snapshot = (JSON.parse(readFileSync(new URL("../../src/data/usda-foundation-foods.json", import.meta.url), "utf8")) as CatalogueFood[])
  .filter((food) => !stapleIds.has(food.id))
  .map((food) => ({ ...food, state: inferFoodState(food.name), portions: [] }));
// As in the search route: the curated staples first, then the USDA Foundation snapshot without the staples it repeats.
const catalogue: CatalogueFood[] = [...staples, ...snapshot];

/** What the search route answers: every local match, best first, and the food it would select. */
function search(phrase: string) {
  const query = parseFoodQuery(phrase);
  const matches = matchFoods(catalogue, query.words);
  return { query, matches, foods: matches.map((match) => match.food), pick: clearMatch(matches) };
}

/** A phrase that should select a food by itself, with the amount worked out for that food. */
function lookup(phrase: string) {
  const { query, pick } = search(phrase);
  assert.ok(pick, `"${phrase}" should select a food`);
  return { query, food: pick, resolution: resolvePortion(query, pick.portions) };
}

function gramsOf(resolution: ReturnType<typeof resolvePortion>) {
  return resolution.kind === "grams" || resolution.kind === "portion" ? resolution.grams : null;
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

// Regression: a search with an amount used to select whatever ranked first, so "200 g paneer" logged
// Palak Paneer and "100 g oats" logged oat milk. Each phrase below either selects the plain food USDA
// measures, with its value, or selects nothing and leaves the choice to the user.
test("an amount search selects only a food that clearly matches", () => {
  const selects: Array<[string, string, number, number]> = [
    // phrase, fdcId, grams, kcal for that amount
    ["100 g oats", "173904", 100, 379],
    ["100 g onion", "170000", 100, 40],
    ["100 g tomato", "170457", 100, 18],
    ["100 g egg", "171287", 100, 143],
    ["2 eggs", "171287", 100, 143],
    ["100 g pasta", "2708357", 100, 157],
    ["100 g chana", "173757", 100, 164],
    ["100 g butter", "173410", 100, 717],
    ["1 tbsp olive oil", "171413", 13.5, 119],
    ["1 tbsp honey", "169640", 21, 64],
    ["200 ml milk", "746782", 210.5, 126],
    ["150 g rice", "2708408", 150, 194],
    ["3 idli", "2708346", 114, 146],
  ];
  for (const [phrase, id, grams, kcal] of selects) {
    const { food, resolution } = lookup(phrase);
    assert.equal(food.id, id, `${phrase}: got ${food.name}`);
    assert.equal(gramsOf(resolution), grams, phrase);
    assert.equal(Math.round(scaleMacros(food, grams).calories), kcal, phrase);
  }

  for (const phrase of ["200 g paneer", "100 g almonds", "100 g biryani", "100 g watermelon"]) {
    const { pick, foods } = search(phrase);
    assert.equal(pick, null, `${phrase} should wait for the user, not select ${pick?.name}`);
    assert.ok(foods.length > 0, `${phrase} still lists foods to choose from`);
  }
});

test("plain foods rank above forms the search did not name", () => {
  const names = (phrase: string) => search(phrase).foods.map((food) => food.name);
  const before = (list: string[], first: string, second: string) => {
    assert.ok(list.includes(first) && list.includes(second), `${first} / ${second} missing`);
    assert.ok(list.indexOf(first) < list.indexOf(second), `${first} should rank above ${second}`);
  };

  const oats = names("100 g oats");
  before(oats, "Oats, whole grain, rolled, old fashioned", "Oat milk, unsweetened, plain, refrigerated");
  before(oats, "Oats, whole grain, steel cut", "Flour, oat, whole grain");
  const onions = names("100 g onion");
  for (const raw of ["Onions, red, raw", "Onions, white, raw", "Onions, yellow, raw"]) before(onions, raw, "Onion rings, breaded, par fried, frozen, prepared, heated in oven");
  const tomatoes = names("100 g tomato");
  for (const form of ["Tomato, paste, canned, without salt added", "Tomato, sauce, canned, with salt added", "Tomato, puree, canned", "Tomato juice, with added ingredients, from concentrate, shelf stable"]) {
    before(tomatoes, "Tomato, roma", form);
  }
  const eggs = names("100 g egg");
  before(eggs, "Eggs, Grade A, Large, egg whole", "Egg, whole, dried");
  const almonds = names("100 g almonds");
  assert.match(almonds[0], /^Nuts, almonds/, `plain almonds first, got ${almonds[0]}`);
  before(almonds, "Nuts, almonds, whole, raw", "Almond butter, creamy");
  before(almonds, "Nuts, almonds, whole, raw", "Almond milk, unsweetened, plain, refrigerated");
  const pasta = names("100 g pasta");
  before(pasta, "Pasta, cooked", "Pasta, dry, enriched");
  before(pasta, "Pasta, dry, enriched", "Sauce, pasta, spaghetti/marinara, ready-to-serve");
  before(names("100 g chana"), "Chickpeas (garbanzo beans, bengal gram), mature seeds, cooked, boiled, without salt", "Channa Saag");
  before(names("100 g butter"), "Butter, salted", "Ghee, clarified butter");
  before(names("olive"), "Olives, green, Manzanilla, stuffed with pimiento", "Anchovies, canned in olive oil, with salt, drained");

  // Naming the form ranks it normally, and a later "whole milk" only describes the food.
  assert.equal(search("peanut butter").foods[0].name, "Peanut butter, creamy");
  assert.equal(search("oat milk").foods[0].name, "Oat milk, unsweetened, plain, refrigerated");
  const yogurt = search("yogurt").matches;
  const score = (name: string) => yogurt.find((match) => match.food.name === name)?.score;
  assert.equal(score("Yogurt, plain, whole milk"), score("Yogurt, plain, nonfat"));
});

test("cooked comes before raw only for grains and pulses", () => {
  // inferFoodState reads "par fried" onion rings as cooked; that must not lift them above raw onions.
  assert.equal(inferFoodState("Onion rings, breaded, par fried, frozen, prepared, heated in oven"), "cooked");
  const onions = search("onion").foods;
  assert.notEqual(onions[0].state, "cooked");
  const chana = search("chickpeas").foods.map((food) => food.state);
  assert.deepEqual(chana.slice(0, 3), ["cooked", null, "raw"], "cooked, then canned, then dry chickpeas");
});

test("selects nothing when two foods answer to the same name", () => {
  const twins = matchFoods([{ name: "Idli" }, { name: "Idly", aliases: ["idli"] }], ["idli"]);
  assert.equal(clearMatch(twins), null);
  assert.equal(clearMatch(matchFoods([{ name: "Idli" }, { name: "Idli with chutney" }], ["idli"]))?.name, "Idli");
  assert.equal(search("chicken biryani").pick?.id, "2706538");
  assert.deepEqual(search("biryani").foods.slice(0, 3).map((food) => food.id).sort(), ["2706490", "2706538", "2708985"]);
});

test("egg sizes use USDA's weight for that size, and ask when USDA has none", () => {
  assert.equal(gramsOf(lookup("2 medium eggs").resolution), 88);
  assert.equal(gramsOf(lookup("2 large eggs").resolution), 100);
  assert.equal(gramsOf(lookup("1 small egg").resolution), 38);
  const boiled = lookup("2 boiled eggs");
  assert.equal(boiled.food.id, "173424");
  assert.equal(gramsOf(boiled.resolution), 100);
  const smallBoiled = lookup("2 small boiled eggs").resolution;
  assert.deepEqual(smallBoiled, { kind: "ask", amount: 2, unit: null, reason: "no-size-weight", size: "small" });
  assert.match(askForGramsMessage("Egg, whole, cooked, hard-boiled", smallBoiled as Extract<typeof smallBoiled, { kind: "ask" }>), /no small size/);
  // Idli has one USDA weight for any size, so a size word changes nothing.
  assert.equal(gramsOf(lookup("2 large idlis").resolution), 76);
});

test("describes the amount that was typed", () => {
  assert.equal(describeTypedAmount(parseFoodQuery("200 g paneer")), "200 g");
  assert.equal(describeTypedAmount(parseFoodQuery("1 tbsp honey")), "1 tablespoon");
  assert.equal(describeTypedAmount(parseFoodQuery("1.5 cups rice")), "1.5 cups");
  assert.equal(describeTypedAmount(parseFoodQuery("2 large rotis")), "2 large");
  assert.equal(describeTypedAmount(parseFoodQuery("chicken")), "");
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

test("parser v2: household words ask, a scoop uses the package serving, a spoon offers both spoons", () => {
  const ghee = staples.find((food) => food.id === "2710168");
  assert.ok(ghee);
  const spoon = parseFoodQuery("1 spoon ghee");
  assert.deepEqual([spoon.amount, spoon.unit, spoon.text], [1, "spoon", "ghee"]);
  const asked = resolvePortion(spoon, ghee.portions);
  assert.deepEqual(asked, { kind: "ask", amount: 1, unit: "spoon", reason: "household-unit" });
  assert.match(askForGramsMessage("Ghee", asked as Extract<typeof asked, { kind: "ask" }>), /teaspoon \(5 ml\) or a tablespoon \(15 ml\)/);
  assert.equal(gramsOf(resolvePortion({ amount: 1, unit: "tsp", size: null }, ghee.portions)), 4.7, "the teaspoon the app then offers");
  assert.deepEqual(resolvePortion(parseFoodQuery("2 ladles dal"), []), { kind: "ask", amount: 2, unit: "ladle", reason: "household-unit" });
  assert.equal(parseFoodQuery("1 vati dal").unit, "katori");
  const whey: FoodPortion = { label: "1 serving (1 scoop (30 g))", unit: "serving", grams: 30, estimate: false };
  assert.deepEqual(resolvePortion(parseFoodQuery("2 scoops whey"), [whey]), { kind: "portion", grams: 60, count: 2, portion: whey, estimate: false });
});

test("USDA measures need a leading 1, and bowls, plates and glasses keep their unit", () => {
  assert.equal(portionFromLabel("Guideline amount per fl oz of beverage as purchased", 30), null);
  assert.equal(portionFromLabel("Quantity not specified", 140), null);
  assert.deepEqual(portionFromLabel("1 bowl", 250), { label: "1 bowl", unit: "bowl", grams: 250 });
  assert.deepEqual(portionFromLabel("1 glass", 240), { label: "1 glass", unit: "glass", grams: 240 });
  assert.equal(gramsOf(resolvePortion(parseFoodQuery("2 bowls soup"), [{ label: "1 bowl", unit: "bowl", grams: 250 }])), 500);
});

test("keywords help find a food but count less than its name and never select it", () => {
  const sauce = { name: "Seafood sauce", keywords: ["lobster", "white clam"] };
  const lobster = { name: "Lobster, tail only, frozen, wild caught" };
  const matches = matchFoods([sauce, lobster], ["lobster"]);
  assert.deepEqual(matches.map((match) => match.food.name), ["Lobster, tail only, frozen, wild caught", "Seafood sauce"]);
  assert.equal(matches.find((match) => match.food === sauce)?.exact, false);
  assert.equal(clearMatch(matchFoods([sauce], ["lobster"])), null);
  assert.equal(foodMatchScore(sauce, ["lobster"]), 2, "one less than the same word in a name");
});

test("a boost lifts recent foods among equal matches but never above an exact name", () => {
  const foods = [{ name: "Rice, brown, cooked" }, { name: "Rice, red, cooked", recent: 3 }, { name: "Rice, white, cooked", aliases: ["rice"] }];
  const ranked = matchFoods(foods, ["rice"], { boost: (food) => ("recent" in food ? Number(food.recent) : 0) }).map((match) => match.food.name);
  assert.deepEqual(ranked, ["Rice, white, cooked", "Rice, red, cooked", "Rice, brown, cooked"]);
});

test("changing between sizes of the same piece keeps the count; other unit changes keep the weight", () => {
  const portionsOf = (id: string) => (staples.find((food) => food.id === id)?.portions ?? []) as FoodPortion[];
  const [smallSamosa, regularSamosa] = portionsOf("2708730");
  // "2 samosas" picks 2 × regular/large (200 g); the user had small ones: 2 × 25 g, not 8 small (200 g).
  assert.equal(amountAfterUnitChange(2, regularSamosa, smallSamosa), 2);
  const [, mediumRoti, largeRoti] = portionsOf("2707713");
  assert.equal(amountAfterUnitChange(2, mediumRoti, largeRoti), 2, "2 rotis stay 2 rotis, now 104 g");
  const [quarterNaan, wholeNaan] = portionsOf("2707613");
  assert.equal(amountAfterUnitChange(1, wholeNaan, quarterNaan), 1, "one naan becomes one quarter piece (44 g), not 4.02");
  const eggs = portionsOf("171287");
  assert.equal(amountAfterUnitChange(2, eggs[2], eggs[3]), 2, "2 large eggs become 2 extra large (112 g)");
  const cup: FoodPortion = { label: "1 cup", unit: "cup", grams: 158 };
  const chopped: FoodPortion = { label: "1 cup, chopped", unit: "cup", grams: 160 };
  const tbsp: FoodPortion = { label: "1 tbsp", unit: "tbsp", grams: 10 };
  assert.equal(amountAfterUnitChange(1, cup, chopped), 1, "another version of the same measure keeps the count");
  assert.equal(amountAfterUnitChange(1, cup, tbsp), 15.8, "a different measure keeps the weight");
  assert.equal(amountAfterUnitChange(200, null, cup), 1.27, "200 g becomes cups by weight");
  assert.equal(amountAfterUnitChange(2, eggs[2], null), 100, "2 eggs become 100 g");
  const idli: FoodPortion = { label: "1 item", unit: "piece", grams: 38 };
  assert.equal(amountAfterUnitChange(114, null, idli), 3);
  assert.equal(amountAfterUnitChange(3, idli, null), 114);
  assert.equal(amountAfterUnitChange(Number.NaN, null, idli), 1, "no amount yet: one piece");
  assert.equal(amountAfterUnitChange(Number.NaN, idli, null), 100, "no amount yet: 100 g");
});

test("after 'no small size', picking one of the food's sizes keeps the typed count", () => {
  const boiled = (staples.find((food) => food.id === "173424")?.portions ?? []) as FoodPortion[];
  const query = parseFoodQuery("2 small boiled eggs");
  const resolution = resolvePortion(query, boiled);
  assert.equal(resolution.kind, "ask");
  if (resolution.kind !== "ask") return;
  assert.equal(resolution.reason, "no-size-weight");
  const typed = { amount: resolution.amount, unit: resolution.unit };
  const large = boiled.find((portion) => portion.label === "1 large") as FoodPortion;
  const chopped = boiled.find((portion) => portion.label === "1 cup, chopped") as FoodPortion;
  // The page clears the amount while it asks, then the user picks "1 large" under Unit: 2 large eggs, not 1.
  assert.equal(amountAfterUnitChange(Number.NaN, null, large, typed), 2);
  assert.equal(amountAfterUnitChange(Number.NaN, null, chopped, typed), 1, "the typed eggs are not cups");
});
