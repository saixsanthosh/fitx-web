// Review finding (fix round 3a, numbers; bug 5 only partly fixed): a food of the member's own whose serving names more
// than one piece answered a bare count as servings. "2 idli" at 76 g made "3 idli" 3 × 76 = 228 g (six idlis), and the
// member's food still beat FITX's Idli, which weighs three idlis at 114 g. A package's "2 biscuits (14 g)", which Open
// Food Facts deliberately never counts, became countable once Save to My foods kept it: "3 marie gold" logged six
// biscuits. Such a serving is not the default count any more: a bare count is asked about, as for the package, or FITX's
// food of that name weighs it, with the note saying so. The food still opens on its serving with nothing typed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { customRowToFood, localFoodsFrom, rankAndPick, type RankableFood } from "@/lib/food/catalog-search";
import { extraPortions, parseFoodQuery, resolvePortion, type FoodPortion } from "@/lib/domain/food-query";
import { openingPortion } from "@/lib/food/log-sheet";
import { fromOpenFoodFacts } from "@/lib/food/open-food-facts";
import { countMode, notByPieceReason } from "@/lib/food/pieces";
import { answersAmount, customServingPortion, passedOverNote, servingToSave } from "@/lib/food/saved-foods";
import { searchOutcome } from "@/lib/food/search-outcome";
import type { FoodResult } from "@/lib/food/types";

const read = (file: string) => JSON.parse(readFileSync(new URL(`../../src/data/${file}`, import.meta.url), "utf8"));
const local = localFoodsFrom(read("fitx-staples.json"), read("usda-foundation-foods.json"));
const IDLI = local.all.find((food) => food.id === "2708346") as RankableFood;

/** What was typed, resolved with the food's own measures and those worked out for it: grams, or the reason it asks. */
function weigh(food: Pick<FoodResult, "portions" | "name">, typed: string) {
  const resolution = resolvePortion(parseFoodQuery(typed), [...food.portions, ...extraPortions(food.portions, food.name)]);
  return resolution.kind === "portion" || resolution.kind === "grams" ? resolution.grams : resolution.kind === "ask" ? resolution.reason : resolution.kind;
}

/** A custom_foods row as the search reads it. */
const own = (fields: Record<string, unknown>) => customRowToFood({ brand: null, calories_per_100g: 128, protein_per_100g: 6, carbs_per_100g: 25, fat_per_100g: 0.4, origin: "user", value_basis: "user_entered", ...fields });

test("a serving that names several pieces, or a weight, is not a count; one that names one thing still is", () => {
  for (const serving of ["2 idli", "6 biscuits", "2 biscuits (14 g)", "half cup", "1/2 cup", "1 oz", "3 pieces"]) {
    assert.equal(customServingPortion(serving, 76).countDefault, undefined, serving);
  }
  for (const serving of ["Small bowl", "1 scoop", "Medium"]) assert.equal(customServingPortion(serving, 76).countDefault, true, serving);
  assert.deepEqual(customServingPortion("1 idli", 38), { label: "1 idli", unit: "piece", grams: 38, countDefault: true, estimate: false }, "one piece is the piece weight, as before");
});

test("\"3 idli\" on your own 2-idli serving is never six idlis: FITX's Idli weighs it, and the sheet says why", () => {
  const twoIdli = own({ id: "c-idli", name: "Idli", serving_size: "2 idli", serving_grams: 76 });
  const typed = parseFoodQuery("3 idli");
  assert.equal(weigh(twoIdli, "3 idli"), "no-count-weight", "on its own it asks for grams, never 228 g");
  assert.equal(answersAmount(twoIdli, typed), false);
  const ranked = rankAndPick(local.all, [twoIdli], typed.words, typed);
  assert.equal(ranked.pick?.id, IDLI.id, "FITX's Idli");
  assert.equal(ranked.passedOver?.id, "c-idli");
  assert.equal(weigh(IDLI, "3 idli"), 114, "three idlis at USDA's 38 g");
  const outcome = searchOutcome(typed, [twoIdli, IDLI], { source: IDLI.source, id: IDLI.id }, { nonVeg: false, egg: false }, false, { source: twoIdli.source, id: twoIdli.id });
  assert.equal(outcome.kind === "pick" && outcome.note, passedOverNote(twoIdli, IDLI, typed));
  assert.equal(passedOverNote(twoIdli, IDLI, typed), "Your own “Idli” has no piece weight, so this is FITX's Idli. To log yours, go back to the results.");
  assert.equal(weigh(twoIdli, "152 g idli"), 152, "grams are still yours to log");
  // With nothing typed it opens on the serving you saved, and says how to make it countable.
  const options: FoodPortion[] = [...twoIdli.portions, ...extraPortions(twoIdli.portions, twoIdli.name)];
  assert.equal(openingPortion(twoIdli, options), 0);
  assert.deepEqual([options[0].label, options[0].grams], ["1 serving (2 idli, 76 g)", 76]);
  assert.deepEqual(countMode(twoIdli, options), { kind: "no-pieces", reason: notByPieceReason(twoIdli) });
});

test("a package's serving of several pieces counts the same before and after Save to My foods", () => {
  for (const [name, serving, grams, typed] of [["Marie Gold", "2 biscuits (14 g)", 14, "3 marie gold"], ["Marie biscuits", "6 biscuits (27 g)", 27, "2 marie biscuits"]] as const) {
    const pack = fromOpenFoodFacts({ code: "8901063010031", product_name: name, nutriments: { "energy-kcal_100g": 440, proteins_100g: 7, carbohydrates_100g: 76, fat_100g: 12 }, serving_size: serving, serving_quantity: grams });
    assert.ok(pack, name);
    assert.equal(weigh(pack, typed), "no-count-weight", `${name}: the package asks ("2 biscuits" is not 2 servings)`);
    const saved = servingToSave(pack, null);
    assert.deepEqual(saved, { label: serving, grams }, `${name}: Save to My foods keeps the label's serving`);
    const copy = own({ id: `c-${grams}`, name, serving_size: saved.label, serving_grams: saved.grams, origin: "barcode", value_basis: "label", calories_per_100g: 440 });
    assert.equal(weigh(copy, typed), "no-count-weight", `${name}: so does the copy, never ${typed.split(" ")[0]} × ${serving}`);
    assert.equal(openingPortion(copy, copy.portions), 0, `${name}: it still opens on that serving`);
  }
});
