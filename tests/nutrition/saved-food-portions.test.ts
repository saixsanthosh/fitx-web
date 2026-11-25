// Bug 5 (nutrition-1): after "Save to My foods", "3 idli" logged 300 g (3 × a 100 g serving) and "1 cup dal" stopped
// working, because the copy kept only a 100 g serving and the member's own food of that name always won the search.
// Now the copy saves the measure in use, keeps every measure (and the diet label) of the catalogue food it came from
// while its values are unchanged, and a food of the member's own that can't weigh the amount typed gives way to the
// catalogue food that can, with a note saying so.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { customRowToFood, localFoodsFrom, rankAndPick, type RankableFood } from "@/lib/food/catalog-search";
import { customFoodResult, loadSavedFrom, withCurrentCustomFoods, type CustomFoodRow } from "@/lib/food/client-data";
import { extraPortions, parseFoodQuery, resolvePortion, type FoodPortion } from "@/lib/domain/food-query";
import { searchFoods, type FoodSearchServices } from "@/lib/food/search-route";
import { searchOutcome } from "@/lib/food/search-outcome";
import { answersAmount, customServingPortion, passedOverNote, servingToSave, withSourceFood, withSourcePortions } from "@/lib/food/saved-foods";
import type { FoodResult, FoodSearchResponse } from "@/lib/food/types";

const read = (file: string) => JSON.parse(readFileSync(new URL(`../../src/data/${file}`, import.meta.url), "utf8"));
const local = localFoodsFrom(read("fitx-staples.json"), read("usda-foundation-foods.json"));
const IDLI = local.all.find((food) => food.id === "2708346") as RankableFood;
const DAL = local.all.find((food) => food.id === "2707427") as RankableFood;
const ROTI = local.all.find((food) => food.id === "2707713") as RankableFood;
const NO_FILTER = { nonVeg: false, egg: false };

/** Grams for what was typed, with the food's own measures and the ml, cups and katori they give. */
function grams(food: Pick<FoodResult, "portions" | "name">, typed: string): number | null {
  const resolution = resolvePortion(parseFoodQuery(typed), [...food.portions, ...extraPortions(food.portions, food.name)]);
  return resolution.kind === "portion" || resolution.kind === "grams" ? resolution.grams : null;
}

/** A custom_foods row as the app reads it. */
function row(fields: Partial<CustomFoodRow> & Pick<CustomFoodRow, "id" | "name">): CustomFoodRow {
  return { brand: null, serving_size: "100 g", serving_grams: 100, calories_per_100g: 128, protein_per_100g: 6.36, carbs_per_100g: 24.98, fat_per_100g: 0.35,
    origin: "user", value_basis: "recipe_calculated", source_ref: null, ...fields };
}

test("a saved serving that names one measure counts as that measure", () => {
  assert.deepEqual(customServingPortion("1 item", 38), { label: "1 item", unit: "piece", grams: 38, countDefault: true, estimate: false });
  assert.deepEqual(customServingPortion("1 cup", 240), { label: "1 cup", unit: "cup", grams: 240, countDefault: true, estimate: false, ownSize: true }, "the member's own cup (review N6)");
  assert.equal(customServingPortion("1 bowl", 180).unit, "bowl", "the member's own bowl weight answers \"1 bowl poha\"");
  assert.deepEqual(customServingPortion("100 g", 100), { label: "1 serving (100 g)", unit: "serving", grams: 100, estimate: false }, "a weight is not a count");
  const plainIdli = customFoodResult(row({ id: "c-own", name: "Idli", value_basis: "user_entered" }));
  assert.equal(grams(plainIdli, "3 idli"), null, "3 idli is asked about, never 3 × 100 g");
  assert.equal(grams(plainIdli, "150 g idli"), 150);
  assert.deepEqual(customServingPortion("2 biscuits", 25), { label: "1 serving (2 biscuits, 25 g)", unit: "serving", grams: 25, countDefault: true, estimate: false });
  assert.equal(customServingPortion(null, null).grams, 100);
  const dal = customFoodResult(row({ id: "c-dal", name: "Dal", serving_size: "1 cup", serving_grams: 240, value_basis: "user_entered" }));
  assert.equal(grams(dal, "1 cup dal"), 240);
  assert.equal(grams(dal, "2 cups dal"), 480);
  assert.equal(grams(dal, "1 katori dal"), null, "the member's cup is their own size, not a US cup: no katori or ml from it (review N6)");
});

test("Save to My foods keeps the measure in use as the serving, not 100 g", () => {
  const piece = IDLI.portions[0];
  assert.deepEqual(servingToSave(IDLI, piece), { label: "1 item", grams: 38 });
  assert.deepEqual(servingToSave(IDLI, null), { label: "1 item", grams: 38 }, "with grams chosen, the food's usual piece");
  assert.deepEqual(servingToSave(DAL, null), { label: "1 cup", grams: 240 });
  const katori = extraPortions(DAL.portions, DAL.name).find((portion) => portion.unit === "katori") as FoodPortion;
  assert.deepEqual(servingToSave(DAL, katori), { label: "1 cup", grams: 240 }, "a worked-out measure is not saved as the food's own");
  assert.deepEqual(servingToSave({ portions: [{ label: "1 serving (30 g)", unit: "serving", grams: 30, estimate: false }] }, null), { label: "30 g", grams: 30 });
  assert.deepEqual(servingToSave({ portions: [{ label: "1 serving (6 biscuits, 27 g)", unit: "serving", grams: 27, estimate: false }] }, null), { label: "6 biscuits", grams: 27 });
  const curdRice = local.all.find((food) => food.id === "fitx-recipe-curd-rice") as RankableFood;
  assert.equal(servingToSave(curdRice, null).label, "FITX recipe");
  assert.deepEqual(servingToSave({ portions: [] }, null), { label: "", grams: 100 });
});

test("a copy keeps every measure of the food it came from; an old 100 g copy still counts idlis", () => {
  const copy = customFoodResult(row({ id: "c-idli", name: "Idli", source_ref: "2708346" }), null, IDLI);
  assert.equal(grams(copy, "3 idli"), 114, "3 × USDA's 38 g idli, not 3 × 100 g");
  assert.equal(copy.portions.filter((portion) => portion.countDefault).length, 1);
  const dalCopy = customFoodResult(row({ id: "c-dal", name: "Dal", source_ref: "2707427", calories_per_100g: 145 }), null, DAL);
  assert.equal(grams(dalCopy, "1 cup dal"), 240);
  assert.equal(grams(dalCopy, "1 katori dal"), 152.2);
  const rotiCopy = customFoodResult(row({ id: "c-roti", name: "Roti", serving_size: "1 medium chappatti or roti (7\")", serving_grams: 40, source_ref: "2707713" }), null, ROTI);
  assert.equal(grams(rotiCopy, "2 roti"), 80, "the saved medium stays the default");
  assert.equal(grams(rotiCopy, "2 large roti"), 104, "the other sizes come with it");
  const merged = withSourcePortions([customServingPortion("1 item", 45)], IDLI.portions);
  assert.deepEqual(merged.map((portion) => [portion.label, portion.grams]), [["1 item", 45]], "the member's own \"1 item\" wins over the catalogue's");
});

test("the catalogue's measures and diet apply only while the values are the catalogue's", () => {
  const copy = customFoodResult(row({ id: "c-idli", name: "Idli", source_ref: "2708346" }), null, IDLI);
  assert.equal(copy.dietType, IDLI.dietType, "the vegetarian filter knows the copy, as it knows Idli");
  assert.ok(copy.dietType);
  const edited = customFoodResult(row({ id: "c-idli", name: "Idli", value_basis: "user_entered", source_ref: "2708346" }), null, IDLI);
  assert.equal(edited.dietType, null);
  assert.equal(edited.portions.length, 1, "changed values keep only the serving the member saved");
  assert.equal(withSourceFood(IDLI, DAL), IDLI, "only the member's own foods take a source");
});

test("your own food of the name typed gives way to the catalogue's when only that one can weigh the amount", () => {
  const plain = customRowToFood({ id: "c-idli", name: "Idli", serving_size: "100 g", serving_grams: 100, calories_per_100g: 140, protein_per_100g: 5, carbs_per_100g: 28, fat_per_100g: 1 });
  const typed = parseFoodQuery("3 idli");
  assert.equal(answersAmount(plain, typed), false);
  const ranked = rankAndPick([IDLI], [plain], typed.words, typed);
  assert.equal(ranked.pick?.id, "2708346", "Idli with USDA's piece weight");
  assert.equal(ranked.passedOver?.id, "c-idli");
  assert.equal(passedOverNote(plain, IDLI, typed), "Your own “Idli” has no piece weight, so this is FITX's Idli. To log yours, go back to the results.");
  assert.equal(rankAndPick([IDLI], [plain], parseFoodQuery("300 g idli").words, parseFoodQuery("300 g idli")).pick?.id, "c-idli", "grams are always yours to log");
  assert.equal(rankAndPick([IDLI], [plain], parseFoodQuery("idli").words, parseFoodQuery("idli")).pick?.id, "c-idli");
  const counted = customRowToFood({ id: "c-idli2", name: "Idli", serving_size: "1 idli", serving_grams: 45, calories_per_100g: 140, protein_per_100g: 5, carbs_per_100g: 28, fat_per_100g: 1 });
  const yours = rankAndPick([IDLI], [counted], typed.words, typed);
  assert.equal(yours.pick?.id, "c-idli2", "your food that has a piece weight is still picked first");
  assert.equal(yours.passedOver, null);
  const dal = customRowToFood({ id: "c-dal", name: "Dal", serving_size: "100 g", serving_grams: 100, calories_per_100g: 145, protein_per_100g: 9, carbs_per_100g: 20, fat_per_100g: 3 });
  const cup = parseFoodQuery("1 cup dal");
  assert.equal(rankAndPick([DAL], [dal], cup.words, cup).pick?.id, "2707427");
  assert.match(passedOverNote(dal, DAL, cup), /has no cup weight, so this is FITX's Dal/);
  const outcome = searchOutcome(typed, [plain, IDLI], { source: IDLI.source, id: IDLI.id }, NO_FILTER, false, { source: plain.source, id: plain.id });
  assert.equal(outcome.kind === "pick" && outcome.note, passedOverNote(plain, IDLI, typed), "the sheet says why");
});

type Result = { data: unknown; error: { code: string } | null };
const ok = (data: unknown): Result => ({ data, error: null });

/** A Supabase client for the search route and loadSavedFrom: fixed answers per RPC and table (or per `.in` ids). */
function fakeSupabase(answers: { rpc?: Record<string, Result>; tables?: Record<string, Result | ((ids: string[] | null) => Result)> }) {
  const query = (table: string) => {
    let ids: string[] | null = null;
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "order", "limit"]) builder[method] = () => builder;
    builder.in = (_column: string, values: string[]) => { ids = [...values]; return builder; };
    builder.then = (resolve: (value: Result) => unknown) => {
      const answer = answers.tables?.[table];
      return Promise.resolve(typeof answer === "function" ? answer(ids) : answer ?? ok([])).then(resolve);
    };
    return builder;
  };
  return {
    auth: { getUser: async () => ({ data: { user: { id: "aaaaaaaa-0000-4000-8000-000000000001" } } }) },
    rpc: async (name: string) => answers.rpc?.[name] ?? { data: null, error: { code: "PGRST202" } },
    from: (table: string) => query(table),
  } as unknown as SupabaseClient;
}

const services: FoodSearchServices = {
  lookupProduct: async () => ({ status: "no_results", foods: [], productName: null, noLabel: false }),
  searchProducts: async () => ({ status: "no_results", foods: [], productName: null, noLabel: false }),
  searchUsda: async () => ({ status: "no_results", foods: [] }),
  usdaKey: "",
  localFoods: local.all,
  stapleFoods: local.staples,
};

async function search(phrase: string, supabase: SupabaseClient): Promise<FoodSearchResponse> {
  const response = await searchFoods(new Request(`http://localhost/api/foods/search?q=${encodeURIComponent(phrase)}`), supabase, services);
  return (await response.json()) as FoodSearchResponse;
}

const copiedIdli = { id: "c-idli", name: "Idli", brand: null, serving_size: "100 g", serving_grams: 100, calories_per_100g: 128, protein_per_100g: 6.36,
  carbs_per_100g: 24.98, fat_per_100g: 0.35, origin: "user", value_basis: "recipe_calculated", source_ref: "2708346" };

test("search: an Idli saved to My foods is picked for \"3 idli\" with USDA's 38 g piece (built-in list)", async () => {
  const body = await search("3 idli", fakeSupabase({ tables: { custom_foods: ok([copiedIdli]) } }));
  assert.equal(body.pick?.id, "c-idli");
  assert.equal(body.passedOver, undefined);
  const copy = body.foods.find((food) => food.id === "c-idli") as FoodResult;
  assert.equal(grams(copy, "3 idli"), 114);
  assert.equal(copy.dietType, IDLI.dietType);
});

test("search: on the catalogue, the copy found by search_foods gets the catalogue food's measures", async () => {
  const catalogRow = { kind: "catalog", id: "2708346", name: "Idli", aliases: ["idly"], keywords: [], kcal: 128, protein_g: 6.36, carbs_g: 24.98, fat_g: 0.35,
    value_basis: "recipe_calculated", source_data_type: "Survey (FNDDS)", state: "cooked", diet_type: "vegan",
    portions: [{ label: "1 item", unit: "piece", grams: 38, isDefault: true, estimate: true }], recent_count: 0, fuzzy: false };
  const customRow = { kind: "custom", id: "c-idli", name: "Idli", brand: null, kcal: 128, protein_g: 6.36, carbs_g: 24.98, fat_g: 0.35, value_basis: "recipe_calculated",
    origin: "user", serving_size: "100 g", serving_grams: 100, portions: [], recent_count: 1, fuzzy: false };
  const body = await search("3 idli", fakeSupabase({
    rpc: { search_foods: ok([catalogRow, customRow]) },
    tables: { custom_foods: (ids) => ok(ids?.includes("c-idli") ? [{ id: "c-idli", source_ref: "2708346" }] : []) },
  }));
  assert.equal(body.pick?.id, "c-idli");
  assert.equal(grams(body.foods.find((food) => food.id === "c-idli") as FoodResult, "3 idli"), 114);
});

test("search: your own Dal with no cup weight gives way to the catalogue's Dal for \"1 cup dal\", and the answer says so", async () => {
  const ownDal = { id: "c-dal", name: "Dal", serving_size: "100 g", serving_grams: 100, calories_per_100g: 145, protein_per_100g: 9, carbs_per_100g: 20, fat_per_100g: 3, value_basis: "user_entered" };
  const body = await search("1 cup dal", fakeSupabase({ tables: { custom_foods: ok([ownDal]) } }));
  assert.equal(body.pick?.id, "2707427");
  assert.deepEqual(body.passedOver, { source: "FITX custom food", id: "c-dal" });
  assert.equal(grams(body.foods.find((food) => food.id === "2707427") as FoodResult, "1 cup dal"), 240);
});

test("the page's own copies of saved foods (My foods, Recent) take the measures the catalogue has for them", async () => {
  const catalogue = fakeSupabase({ tables: { food_catalog: (ids) => ok(ids?.includes("2708346") ? [{
    id: "2708346", name: "Idli", aliases: [], keywords: [], category: null, diet_type: "vegan", state: "cooked", kcal: 128, protein_g: 6.36, carbs_g: 24.98, fat_g: 0.35,
    fiber_g: null, sugar_g: null, sodium_mg: null, value_basis: "recipe_calculated", source_data_type: "Survey (FNDDS)", image_url: null, image_attribution: null,
    food_portions: [{ label: "1 item", unit: "piece", grams: 38, is_default: true, is_estimate: true, sort_order: 0 }],
  }] : []) } });
  const rows = [row({ id: "c-idli", name: "Idli", source_ref: "2708346" }), row({ id: "c-pack", name: "Biscuits", source_ref: "8901063010031" })];
  const savedFrom = await loadSavedFrom(catalogue, rows);
  assert.deepEqual([...savedFrom.keys()], ["2708346"], "barcodes are not catalogue foods");
  const recent = withCurrentCustomFoods([{ ...IDLI, kind: "custom", id: "c-idli" }], rows, () => null, savedFrom);
  assert.equal(grams(recent[0], "3 idli"), 114);
  assert.equal(recent[0].dietType, "vegan");
  assert.equal((await loadSavedFrom(catalogue, [row({ id: "x", name: "X" })])).size, 0, "no lookup without a catalogue source");
});
