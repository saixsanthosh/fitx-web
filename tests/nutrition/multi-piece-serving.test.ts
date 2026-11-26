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
import { customFoodResult, type CustomFoodRow } from "@/lib/food/client-data";
import { countsSeveral, extraPortions, parseFoodQuery, resolvePortion, type FoodPortion } from "@/lib/domain/food-query";
import { openingPortion } from "@/lib/food/log-sheet";
import { fromOpenFoodFacts } from "@/lib/food/open-food-facts";
import { countMode, notByPieceReason } from "@/lib/food/pieces";
import { answersAmount, customServingPortion, passedOverNote, servingToSave } from "@/lib/food/saved-foods";
import { searchOutcome } from "@/lib/food/search-outcome";
import type { FoodResult } from "@/lib/food/types";

const read = (file: string) => JSON.parse(readFileSync(new URL(`../../src/data/${file}`, import.meta.url), "utf8"));
const local = localFoodsFrom(read("fitx-staples.json"), read("usda-foundation-foods.json"));
const IDLI = local.all.find((food) => food.id === "2708346") as RankableFood;
const VADA = local.all.find((food) => food.id === "2709130") as RankableFood;

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

// Review finding (fix round 3f, numbers-own-serving-leading-one-holds-several-pieces): the round 3a rule read only a
// serving's first number, so a serving written the way menus write it, "1 serving (2 idli)" or "1 plate (2 idli)" (76 g),
// was still the default count: "3 idli" was 3 × 76 = 228 g (six idlis), and the member's food silently beat FITX's
// Idli, which weighs three at 114 g. A serving whose "1" holds several is not a count now; its own measure still is.
const SEVERAL = ["1 serving (2 idli)", "1 plate (2 idli)", "1 portion (2 idlis)", "1 plate - 2 idli", "1 plate (2 pcs)", "1 plate of 2 idli", "1 plate (two idlis)", "1 plate (2-3 idli)", "1 serving (2 x 38 g)", "1 (2 idli)", "1 idli plate (2 idli)"];

test("a serving whose \"1\" holds several pieces is never the default count; sizes in it don't count", () => {
  for (const serving of [...SEVERAL, "1 bowl (2 vada)", "1 thali (3 roti, rice, dal)"]) {
    assert.equal(countsSeveral(serving), true, serving);
    assert.equal(customServingPortion(serving, 76).countDefault, undefined, serving);
  }
  // Weights, volumes, vessels, lengths, prices and a part of one are sizes: these still name one of something.
  for (const serving of ["1 bowl (250 g)", "1 serving (25 g)", "1 scoop (30 g)", "1 cup (240 ml)", "1 bowl (1-1/2 cups)", "1 glass (8 fl oz)", "1 thali (2 katori dal)",
    "1 Naan (10\" dia)", "1 medium (2-1/2\" dia)", "1 piece (1/4 of 10\" dia)", "1 slice, medium (1/4\" thick)", "1 medium chappatti or roti (7\")", "1 roll (6 inch)", "1 dosa (30 cm)",
    "1 bar (Rs 10)", "1 plate (1 idli)", "1 bowl (half)", "Small bowl", "1 idli (40 g)", "1 item"]) {
    assert.equal(countsSeveral(serving), false, serving);
    assert.equal(customServingPortion(serving, 76).countDefault, true, serving);
  }
  // Every measure FITX's own food list gives is one of something, so a copy saved with it counts as before.
  const labels = new Set(read("fitx-staples.json").foods.flatMap((food: { portions: Array<{ label: string }> }) => food.portions.map((portion) => portion.label)));
  for (const label of labels) assert.equal(countsSeveral(label as string), false, label as string);
});

test("its measure still counts as itself, and a \"piece\" that holds several is a serving of them", () => {
  const plate = customServingPortion("1 plate (2 idli)", 76);
  assert.deepEqual(plate, { label: "1 plate (2 idli)", unit: "plate", grams: 76, estimate: false });
  const food = own({ id: "c-plate", name: "Idli", serving_size: "1 plate (2 idli)", serving_grams: 76 });
  assert.equal(weigh(food, "2 plates idli"), 152, "2 of the member's plate");
  assert.equal(weigh(food, "3 idli"), "no-count-weight", "never 3 plates");
  for (const serving of ["1 (2 idli)", "1 idli plate (2 idli)"]) {
    assert.deepEqual(customServingPortion(serving, 76), { label: `1 serving (${serving}, 76 g)`, unit: "serving", grams: 76, estimate: false }, `${serving}: not a piece, so no bare count takes it`);
  }
  assert.equal(customServingPortion("1 pack (6 biscuits)", 27).unit, "piece", "a pack stays a pack: no bare count takes one");
  assert.equal(weigh(own({ id: "c-pack", name: "Marie biscuits", serving_size: "1 pack (6 biscuits)", serving_grams: 27 }), "3 marie biscuits"), "no-count-weight");
});

test("\"3 idli\" on your own \"1 plate (2 idli)\" (and the like) is FITX's Idli at 114 g with the note, never 228 g", () => {
  const typed = parseFoodQuery("3 idli");
  for (const serving of SEVERAL) {
    const food = own({ id: "c-idli", name: "Idli", serving_size: serving, serving_grams: 76 });
    assert.equal(answersAmount(food, typed), false, serving);
    const ranked = rankAndPick(local.all, [food], typed.words, typed);
    assert.equal(ranked.pick?.id, IDLI.id, serving);
    assert.equal(ranked.passedOver?.id, "c-idli", serving);
    assert.equal(weigh(ranked.pick as RankableFood, "3 idli"), 114, serving);
    const outcome = searchOutcome(typed, [food, IDLI], { source: IDLI.source, id: IDLI.id }, { nonVeg: false, egg: false }, false, { source: food.source, id: food.id });
    assert.equal(outcome.kind === "pick" && outcome.note, "Your own “Idli” has no piece weight, so this is FITX's Idli. To log yours, go back to the results.", serving);
    // With nothing typed it opens on the serving you saved (76 g), not 100 g, and says how to count it by the piece.
    const options: FoodPortion[] = [...food.portions, ...extraPortions(food.portions, food.name)];
    assert.equal(openingPortion(food, options), 0, serving);
    assert.equal(options[0].grams, 76, serving);
    assert.deepEqual(countMode(food, options), { kind: "no-pieces", reason: notByPieceReason(food) }, serving);
  }
  const vada = own({ id: "c-vada", name: "Vada", serving_size: "1 bowl (2 vada)", serving_grams: 60 });
  const three = parseFoodQuery("3 vada");
  const ranked = rankAndPick(local.all, [vada], three.words, three);
  assert.equal(ranked.pick?.id, VADA.id, "FITX's Vada");
  assert.equal(weigh(VADA, "3 vada"), 90, "three vadas at USDA's 30 g, not 3 bowls (180 g)");
  assert.equal(rankAndPick(local.all, [vada], parseFoodQuery("vada").words, parseFoodQuery("vada")).pick?.id, "c-vada", "with no amount your own food is still picked first");
});

test("a copy of FITX's Idli whose serving was renamed to \"1 plate (2 idli)\" counts \"3 idli\" by Idli's piece again", () => {
  // Values unchanged (a catalogue basis), so it keeps Idli's measures; only its serving's name was changed.
  const row: CustomFoodRow = { id: "c-copy", name: "Idli", brand: null, serving_size: "1 plate (2 idli)", serving_grams: 76, calories_per_100g: 128, protein_per_100g: 6.36, carbs_per_100g: 24.98,
    fat_per_100g: 0.35, origin: "user", value_basis: "recipe_calculated", source_ref: IDLI.id };
  const copy = customFoodResult(row, null, IDLI);
  assert.equal(weigh(copy, "3 idli"), 114, "3 × 38 g, never 3 plates");
  assert.equal(weigh(copy, "1 plate idli"), 76, "the member's plate still counts as itself");
  assert.equal(copy.portions.filter((portion) => portion.countDefault).length, 1);
  const options: FoodPortion[] = [...copy.portions, ...extraPortions(copy.portions, copy.name)];
  assert.equal(options[openingPortion(copy, options)].label, "1 item", "it opens on Idli's piece, like any copy whose serving isn't a count");
});
