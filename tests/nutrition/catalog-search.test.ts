import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { customRowToFood, FITX_CATALOGUE_SOURCE, localFoodsFrom, publicFood, rankAndPick, searchRowToFood, stemsFor, USDA_SOURCE, type RankableFood } from "@/lib/food/catalog-search";
import { parseFoodQuery } from "@/lib/domain/food-query";

const read = (file: string) => JSON.parse(readFileSync(new URL(`../../src/data/${file}`, import.meta.url), "utf8"));
const local = localFoodsFrom(read("fitx-staples.json"), read("usda-foundation-foods.json"));

test("word stems match every spelling of a word in the database", () => {
  assert.deepEqual(stemsFor(["idlis"]), ["idli"]);
  assert.deepEqual(stemsFor(["berries"]), ["berr"]);
  assert.deepEqual(stemsFor(["eggs", "boiled"]), ["egg", "boiled"]);
  assert.deepEqual(stemsFor(["rice", "rice"]), ["rice"]);
});

test("the built-in list puts the curated staples first and lists each food once", () => {
  // 33 curated staples plus plain yogurt, which the "curd" and "dahi" names point to.
  assert.equal(local.staples.length, 34);
  assert.equal(local.all[0].id, local.staples[0].id);
  const milk = local.all.filter((food) => food.id === "746782");
  assert.equal(milk.length, 1, "whole milk is a staple and in the Foundation snapshot, but listed once");
  assert.deepEqual(milk[0].aliases?.includes("milk"), true);
  assert.equal(local.staples.find((food) => food.id === "2708346")?.valueBasis, "recipe_calculated");
  assert.equal(local.all.find((food) => food.id === "2512381")?.valueBasis, "lab_analysed");
});

test("catalogue rows from search_foods become results with portions and labels", () => {
  const food = searchRowToFood({
    kind: "catalog", id: "2708346", name: "Idli", aliases: ["idly"], keywords: [], kcal: "128", protein_g: 6.36, carbs_g: 24.98, fat_g: 0.35,
    fiber_g: 1.1, sugar_g: null, sodium_mg: 300, value_basis: "recipe_calculated", source_data_type: "Survey (FNDDS)", state: "cooked", diet_type: "vegan",
    portions: [{ label: "1 item", unit: "piece", grams: 38, isDefault: true, estimate: true }, { label: "bad", unit: "g", grams: 1 }], recent_count: 2, fuzzy: false,
  });
  assert.equal(food.calories, 128);
  assert.equal(food.basis, "Typical recipe");
  assert.equal(food.dietType, "vegan");
  assert.equal(food.recentCount, 2);
  assert.deepEqual(food.portions, [{ label: "1 item", unit: "piece", grams: 38, countDefault: true, estimate: true }], "grams are not a portion unit");
  assert.equal(food.sourceUrl, "https://fdc.nal.usda.gov/food-details/2708346/nutrients");
  assert.equal("aliases" in publicFood(food), false, "ranking-only fields stay on the server");
});

test("a catalogue row without a USDA data type is a FITX catalogue food, with no FoodData Central link", () => {
  const row = {
    kind: "catalog", id: "2708346", name: "Idli", aliases: [], keywords: [], kcal: 140, protein_g: 6, carbs_g: 25, fat_g: 0.4,
    fiber_g: null, sugar_g: null, sodium_mg: null, value_basis: "estimated", state: "cooked", diet_type: "vegan", portions: [], recent_count: 0, fuzzy: false,
  };
  // What fitx_admin_op_save_food (20261121100036) leaves when Admin changes a USDA food's values: no data type.
  const edited = searchRowToFood({ ...row, source_data_type: null });
  assert.equal(edited.source, FITX_CATALOGUE_SOURCE);
  assert.equal(edited.sourceUrl, null, "no FoodData Central record holds these values");
  assert.equal(edited.dataType, null);
  assert.equal(edited.calories, 140);
  assert.equal(edited.valueBasis, "estimated");
  assert.equal(searchRowToFood({ ...row, source_data_type: "  " }).source, FITX_CATALOGUE_SOURCE, "a blank data type is none");
  const usda = searchRowToFood({ ...row, source_data_type: "Survey (FNDDS)" });
  assert.equal(usda.source, USDA_SOURCE);
  assert.equal(usda.sourceUrl, "https://fdc.nal.usda.gov/food-details/2708346/nutrients");
});

test("every food the seed parts add has a USDA data type, so only Admin's own foods read as FITX catalogue foods", () => {
  const dir = new URL("../../supabase/migrations/", import.meta.url);
  const parts = readdirSync(dir).filter((name) => /_fitx_food_catalog_seed_part_\d+\.sql$/.test(name)).sort();
  assert.equal(parts.length, 5);
  let foods = 0;
  for (const part of parts) {
    const json = readFileSync(new URL(part, dir), "utf8").match(/\$fitx\$(\[[^]*?\])\$fitx\$/)?.[1];
    assert.ok(json, `${part} has its food list`);
    const rows = JSON.parse(json) as Array<{ id: string; dt?: unknown }>;
    const without = rows.filter((food) => !["Foundation", "SR Legacy", "Survey (FNDDS)"].includes(String(food.dt))).map((food) => food.id);
    assert.deepEqual(without, [], `${part}: foods without a USDA data type`);
    foods += rows.length;
  }
  assert.equal(foods, 2302, "the 595, 417, 425, 435 and 430 foods of the five parts");
});

test("custom foods keep their saved serving, origin and value basis", () => {
  const food = customRowToFood({ id: "c1", name: "Poha (home)", brand: null, serving_size: "1 bowl", serving_grams: 180, calories_per_100g: 130, protein_per_100g: 2.5, carbs_per_100g: 24, fat_per_100g: 3, origin: "ai_coach", value_basis: "recipe_calculated" }, 3);
  assert.deepEqual(food.portions, [{ label: "1 bowl", unit: "bowl", grams: 180, countDefault: true, estimate: false }], "the measure the serving names (bug 5)");
  assert.equal(food.origin, "ai_coach");
  assert.equal(food.basis, "AI suggestion · saved");
  assert.equal(food.recentCount, 3);
  const plain = customRowToFood({ id: "c2", name: "Shake", serving_size: "100 g", serving_grams: null, calories_per_100g: 60, protein_per_100g: 8, carbs_per_100g: 5, fat_per_100g: 1 });
  assert.equal(plain.portions[0].label, "1 serving (100 g)");
  assert.equal(plain.portions[0].countDefault, undefined, "a weight is not a piece: \"3 shake\" is never 3 × 100 g");
  assert.equal(plain.valueBasis, "user_entered");
});

function catalogFood(id: string, name: string, extra: Partial<RankableFood> = {}): RankableFood {
  return { ...local.all[0], id, name, aliases: [], keywords: [], recentCount: 0, suggestion: false, kind: "catalog", ...extra };
}

test("your own food named exactly what you typed is picked; any other match of yours leaves the choice to you", () => {
  const catalog = [catalogFood("1", "Idli", { aliases: ["idly"] }), catalogFood("2", "Rava idli")];
  const words = parseFoodQuery("3 idli").words;
  const yours = customRowToFood({ id: "c1", name: "Idli", serving_grams: 45, calories_per_100g: 140, protein_per_100g: 5, carbs_per_100g: 28, fat_per_100g: 1 });
  assert.equal(rankAndPick(catalog, [yours], words).pick?.id, "c1");
  const looser = customRowToFood({ id: "c2", name: "Idli with podi", serving_grams: 45, calories_per_100g: 160, protein_per_100g: 5, carbs_per_100g: 28, fat_per_100g: 4 });
  assert.equal(rankAndPick(catalog, [looser], words).pick, null);
  assert.equal(rankAndPick(catalog, [], words).pick?.id, "1");
  const { foods } = rankAndPick(catalog, [looser], words);
  assert.equal(foods[0].id, "1", "the exact name still lists first");
});

test("recent foods rise among equal matches but never above an exact name", () => {
  const catalog = [catalogFood("a", "Rice, brown, cooked"), catalogFood("b", "Rice, red, cooked", { recentCount: 5 }), catalogFood("c", "Rice, white, cooked", { aliases: ["rice"] })];
  const { foods, pick } = rankAndPick(catalog, [], ["rice"]);
  assert.deepEqual(foods.map((food) => food.id), ["c", "b", "a"]);
  assert.equal(pick?.id, "c");
});

test("close spellings are listed after matches and never picked", () => {
  const catalog = [catalogFood("s", "Idli", { suggestion: true })];
  const { foods, pick } = rankAndPick(catalog, [], ["idlly"]);
  assert.deepEqual(foods.map((food) => food.id), ["s"]);
  assert.equal(pick, null);
});

test("the AI coach's food plan copies values from the catalogue, never from the AI", async () => {
  const { customFoodFromCatalog } = await import("@/lib/food/food-plan");
  const row = customFoodFromCatalog({ id: "2708346", name: "Idli", kcal: 128, protein_g: 6.36, carbs_g: 24.98, fat_g: 0.35, value_basis: "recipe_calculated" }, { label: "1 item", grams: 38 });
  assert.deepEqual(row, {
    name: "Idli", brand: null, serving_size: "1 item", serving_grams: 38, calories_per_100g: 128, protein_per_100g: 6.36, carbs_per_100g: 24.98,
    fat_per_100g: 0.35, origin: "ai_coach", value_basis: "recipe_calculated", source_ref: "2708346",
  });
  const fromResult = customFoodFromCatalog(local.staples[0]);
  assert.equal(fromResult.serving_grams, 100);
  assert.equal(fromResult.source_ref, local.staples[0].id);
  assert.throws(() => customFoodFromCatalog({ id: "x", name: "Bad", kcal: Number.NaN, protein_g: 1, carbs_g: 1, fat_g: 1, value_basis: "label" }));
});

test("short plurals keep enough letters to stay specific", () => {
  assert.deepEqual(stemsFor(["fries"]), ["frie"], "not \"fr\", which matches fresh, frozen and french");
  assert.deepEqual(stemsFor(["flies"]), ["flie"]);
  assert.deepEqual(stemsFor(["pies", "teas"]), ["pie", "tea"]);
  assert.deepEqual(stemsFor(["cherries"]), ["cherr"], "longer -ies words still find the singular");
});

/** Rows the way search_foods sends them: shortest names first among equal matches. */
const seedShaped = (names: Array<[string, Partial<RankableFood>?]>) => names.map(([name, extra], index) => catalogFood(String(index), name, extra ?? {}));

test("the plain food comes before dishes that start with its name", () => {
  const first = (phrase: string, rows: RankableFood[]) => rankAndPick(rows, [], parseFoodQuery(phrase).words).foods[0]?.name;
  assert.match(first("1 banana", seedShaped([["Banana split", { portions: [{ label: "1 banana split", unit: "piece", grams: 490, countDefault: true }] }], ["Banana pudding"], ["Bananas, overripe, raw"]])) ?? "", /^Bananas,/);
  assert.match(first("almonds", seedShaped([["Almond chicken"], ["Nuts, almonds, whole, raw"], ["Almond butter, creamy"]])) ?? "", /^Nuts, almonds/);
  assert.match(first("salmon", seedShaped([["Salmon salad"], ["Lomi salmon"], ["Fish, salmon, raw"]])) ?? "", /^Fish, salmon/);
  assert.match(first("chicken", seedShaped([["Chicken fillet sandwich, grilled, on wheat bun", { state: "cooked" }], ["Chicken skin"], ["Chicken, ground"]])) ?? "", /^Chicken, ground/,
    "a sandwich on a wheat bun is not ranked as a grain");
  assert.match(first("rice", seedShaped([["Rice, white, raw", { state: "raw" }], ["Rice, white, cooked", { state: "cooked" }]])) ?? "", /cooked/, "grains still put cooked first");
});

test("a brand that shares a word with the food typed doesn't stop the catalogue's exact match being selected", () => {
  const milk = catalogFood("746782", "Milk, whole, 3.25% milkfat", { aliases: ["milk"] });
  const paneer = customRowToFood({ id: "c9", name: "Paneer", brand: "Milky Mist", serving_grams: 100, calories_per_100g: 290, protein_per_100g: 18, carbs_per_100g: 3, fat_per_100g: 23 });
  const ranked = rankAndPick([milk], [paneer], parseFoodQuery("2 milk").words);
  assert.equal(ranked.pick?.id, "746782");
  assert.deepEqual(ranked.foods.map((food) => food.id), ["746782", "c9"], "the brand match is still listed");
});
