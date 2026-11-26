// Review finding (fix round 3a, numbers; bug 5 only partly fixed): a food of the member's own whose serving names more
// than one piece answered a bare count as servings. "2 idli" at 76 g made "3 idli" 3 × 76 = 228 g (six idlis), and the
// member's food still beat FITX's Idli, which weighs three idlis at 114 g. A package's "2 biscuits (14 g)", which Open
// Food Facts deliberately never counts, became countable once Save to My foods kept it: "3 marie gold" logged six
// biscuits. Such a serving is not the default count any more: a bare count is asked about, as for the package, or FITX's
// food of that name weighs it, with the note saying so. The food still opens on its serving with nothing typed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
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

test("ranges and \"per\" are read as USDA writes them: a weight range or how many fill a pack is not a count", () => {
  for (const label of ["1 large drumstick (from tom, approx 19 to 21 lb bird) (yield after cooking, bone removed)", "1 medium neck (from 14 to 18 lb turkey)", "1 slice (15 per 8 oz package)",
    "1 slice (4-1/8\" dia x 1/8\" thick) (10 per 8 oz package)", "1 medium (approx 3 per lb)", "1 serving (10 slices per pack)", "1 bowl (1-1/2 cups)"]) {
    assert.equal(countsSeveral(label), false, label);
  }
  for (const label of ["1 plate (2 or 3 idli)", "1 plate (1 to 2 idli)", "1 plate (1-1/2 dosa)", "1 serving (2 idli per plate)", "1 serving (2 or more idli)"]) {
    assert.equal(countsSeveral(label), true, label);
  }
  // The whole seeded catalogue: only the measures that really hold several are read so.
  const seeds = readdirSync(new URL("../../supabase/migrations/", import.meta.url)).filter((file) => /_fitx_food_catalog_seed_part_\d+\.sql$/.test(file));
  assert.ok(seeds.length > 0);
  const measures = new Set<string>();
  for (const file of seeds) {
    const sql = readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8");
    for (const match of sql.matchAll(/\$fitx\$(\[[\s\S]*?\])\$fitx\$/g)) {
      for (const food of JSON.parse(match[1]) as Array<{ po?: Array<[string, string, number, boolean?]> }>) for (const [label] of food.po ?? []) measures.add(label);
    }
  }
  assert.ok(measures.size > 300, `${measures.size} measures read`);
  assert.deepEqual([...measures].filter((label) => countsSeveral(label)).sort(), [
    "1 frozen family size package (6 steaks)",
    "1 serving (2 pig's feet, 3\" x 2\", two slices Spanish sausage, 1\" x 1/4\", 1/2 cup sauce) (yield after bone removed)",
  ]);
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

// Review finding (fix round 3f, numbers-package-copy-counts-label-servings-and-packs): a packaged product saved with
// "Save to My foods" still counted a bare amount the package itself asks about. A label serving "1 serving (25 g)" or "1
// portion (25 g)" made "3 marie gold" 3 servings (75 g), and a product with no label serving (common for Indian products)
// was saved with its pack, "1 pack (200 g)", so "3 marie gold" logged 3 packs: 600 g, about 2,640 kcal. The copy was
// picked without a word. A container is never a count now, for any food of yours, and a food holding a package's values
// counts as the package does: only one piece of it ("1 biscuit (7 g)") answers a bare count.
const MARIE = { code: "8901063010031", product_name: "Marie Gold", nutriments: { "energy-kcal_100g": 440, proteins_100g: 7, carbohydrates_100g: 76, fat_100g: 12 } };
const PACK = { product_quantity: 200, product_quantity_unit: "g", quantity: "200 g" };

/** The package found by its barcode, then saved with Save to My foods as the form fills it in (origin barcode, label values). */
function savedCopy(product: Record<string, unknown>, inUse: "pack" | null = null) {
  const pack = fromOpenFoodFacts({ ...MARIE, ...product });
  assert.ok(pack);
  const saved = servingToSave(pack, inUse === "pack" ? pack.portions.find((portion) => portion.label.startsWith("1 pack")) ?? null : null);
  const row = { id: "c-marie", name: pack.name, serving_size: saved.label, serving_grams: saved.grams, origin: "barcode" as const, value_basis: "label" as const, calories_per_100g: 440, protein_per_100g: 7, carbs_per_100g: 76, fat_per_100g: 12 };
  // As the search reads it (search results, a scan of its barcode), and as My foods, Recent and the "Log it" toast do.
  return { pack, saved, copies: [own(row), customFoodResult({ brand: null, ...row })] };
}

test("a package's \"1 serving (25 g)\", \"1 portion (25 g)\" or pack counts \"3 marie gold\" as the package does once saved: it asks", () => {
  const typed = parseFoodQuery("3 marie gold");
  for (const [product, label, grams] of [
    [{ serving_size: "1 serving (25 g)", serving_quantity: 25 }, "1 serving (25 g)", 25],
    [{ serving_size: "1 portion (25 g)", serving_quantity: 25 }, "1 portion (25 g)", 25],
    [{ serving_size: "1 serving (25 g)", serving_quantity: 25, ...PACK }, "1 serving (25 g)", 25],
    [PACK, "1 pack (200 g)", 200],
  ] as const) {
    const { pack, saved, copies } = savedCopy(product);
    assert.equal(weigh(pack, "3 marie gold"), "no-count-weight", `${label}: the package asks`);
    assert.deepEqual(saved, { label, grams }, `${label}: what Save to My foods fills in`);
    for (const copy of copies) {
      assert.equal(copy.portions[0].countDefault, undefined, label);
      assert.equal(weigh(copy, "3 marie gold"), "no-count-weight", `${label}: so does the copy, never ${3 * grams} g`);
      assert.equal(answersAmount(copy, typed), false, label);
      assert.equal(openingPortion(copy, copy.portions), 0, `${label}: it still opens on the serving it was saved with`);
      assert.equal(weigh(copy, `${grams * 3} g marie gold`), grams * 3, "grams are always yours to log");
    }
    // The member's own food of that name is still the one picked (no catalogue food is called Marie Gold): the sheet asks for grams.
    assert.equal(rankAndPick(local.all, [copies[0]], typed.words, typed).pick?.id, "c-marie", label);
  }
  // A pack chosen under Unit before Save to My foods is saved too, and it is still no count.
  const chosen = savedCopy({ serving_size: "1 serving (25 g)", serving_quantity: 25, ...PACK }, "pack");
  assert.deepEqual(chosen.saved, { label: "1 pack (200 g)", grams: 200 });
  for (const copy of chosen.copies) assert.equal(weigh(copy, "3 marie gold"), "no-count-weight");
});

test("a package's label serving of one piece is that piece's weight, and a scoop still counts as scoops", () => {
  const { pack, copies } = savedCopy({ serving_size: "1 biscuit (7 g)", serving_quantity: 7 });
  assert.equal(weigh(pack, "3 marie gold"), "no-count-weight", "the package itself never counts");
  for (const copy of copies) assert.equal(weigh(copy, "3 marie gold"), 21, "3 biscuits of 7 g: one piece is a count");
  const whey = savedCopy({ product_name: "Whey protein", serving_size: "1 scoop (30 g)", serving_quantity: 30 });
  for (const copy of whey.copies) {
    assert.equal(weigh(copy, "2 whey protein"), "no-count-weight", "a bare count of a package's scoop is asked about, as on the package");
    assert.equal(weigh(copy, "2 scoops whey protein"), 60, "2 scoops are 2 of its scoop");
  }
  assert.equal(weigh(whey.pack, "2 scoops whey protein"), 60, "as on the package");
});

test("a container is never a count for any food of yours; your own serving of one thing still is", () => {
  for (const serving of ["1 pack (200 g)", "1 can (330 ml)", "1 bottle (500 ml)", "Small packet", "1 box (12 pieces)"]) {
    assert.equal(customServingPortion(serving, 200).countDefault, undefined, serving);
  }
  const coke = own({ id: "c-coke", name: "Coke", serving_size: "1 can (330 ml)", serving_grams: 330 });
  assert.equal(weigh(coke, "2 coke"), "no-count-weight", "never 2 × a can by guess");
  assert.equal(openingPortion(coke, coke.portions), 0, "it opens on its can");
  // Your own food, not a package's values: a serving of one thing is still the default count.
  for (const serving of ["1 serving (40 g)", "1 portion", "1 scoop (30 g)", "1 cup (240 ml)", "1 bowl", "Small bowl"]) {
    assert.equal(customServingPortion(serving, 40, { origin: "user", valueBasis: "user_entered" }).countDefault, true, serving);
    assert.equal(customServingPortion(serving, 40, { origin: "barcode", valueBasis: "label" }).countDefault, undefined, `${serving}, a package's: not a count`);
  }
  assert.equal(customServingPortion("1 biscuit (7 g)", 7, { origin: "barcode", valueBasis: "label" }).countDefault, true, "one piece of a package is");
  assert.equal(customServingPortion("1 slice (25 g)", 25, { origin: "user", valueBasis: "label" }).countDefault, true, "so is one slice");
  assert.equal(customServingPortion("1 serving (40 g)", 40, { origin: "user", valueBasis: "label" }).countDefault, undefined, "values copied from a label are a package's");
});
