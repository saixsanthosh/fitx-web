// Review round, finding N1 (bug 5's fix): a food of the member's own whose serving is only a weight (a blank
// "Serving (optional)" is saved as "45 g"; a package copied to My foods keeps the label's "30 g") stopped opening on
// that serving and opened at 100 g instead (Digestive biscuits: 480 kcal ready to add, not 216). Such a serving is
// still never a piece ("3 digestive biscuits" asks for grams), but it is what the food opens on when nothing was typed:
// from My foods' Use, the "Log it" toast, Recent, a search result or a scan of the member's own barcode.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { customRowToFood, localFoodsFrom, type RankableFood } from "@/lib/food/catalog-search";
import { customFoodResult, customFoodRowValues, type CustomFoodRow } from "@/lib/food/client-data";
import { extraPortions, parseFoodQuery, resolvePortion, type FoodPortion } from "@/lib/domain/food-query";
import { openingPortion } from "@/lib/food/log-sheet";
import { servingToSave } from "@/lib/food/saved-foods";
import type { FoodResult } from "@/lib/food/types";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const data = (file: string) => JSON.parse(read(`src/data/${file}`));
const local = localFoodsFrom(data("fitx-staples.json"), data("usda-foundation-foods.json"));
const IDLI = local.all.find((food) => food.id === "2708346") as RankableFood;
const DAL = local.all.find((food) => food.id === "2707427") as RankableFood;

/** The food's measures as the Log food sheet lists them, and what it opens on with nothing typed (the page's rule). */
function opening(food: Pick<FoodResult, "kind" | "portions" | "name" | "calories">) {
  const portions: FoodPortion[] = [...food.portions, ...extraPortions(food.portions, food.name)];
  const index = openingPortion(food, portions);
  const grams = index >= 0 ? portions[index].grams : 100;
  return { index, label: index >= 0 ? portions[index].label : "100 g", grams, kcal: Math.round(food.calories * grams / 100), portions };
}

/** "Digestive biscuits", 45 g and 216 kcal a serving, with Serving (optional) left blank, as the form saves it. */
const typed = customFoodRowValues({
  name: "Digestive biscuits", brand: "", servingLabel: "", servingGrams: 45, calories: 216, protein: 3.2, carbs: 28.4, fat: 9.5,
  barcode: "5000159484695", valueBasis: "user_entered", origin: "user",
}, true);
const biscuits: CustomFoodRow = { id: "c-biscuits", ...typed, origin: "user", value_basis: "user_entered" } as CustomFoodRow;

test("a food of your own with a serving that is only a weight opens at 1 × that serving, not 100 g", () => {
  assert.equal(typed.serving_size, "45 g", "a blank serving is saved as its weight");
  for (const [where, food] of [["My foods, Recent, the Log it toast", customFoodResult(biscuits)], ["search results and your own barcode", customRowToFood(biscuits)]] as const) {
    const opened = opening(food);
    assert.equal(opened.index, 0, where);
    assert.equal(opened.label, "1 serving (45 g)", where);
    assert.deepEqual([opened.grams, opened.kcal], [45, 216], `${where}: 216 kcal, not 480`);
  }
});

test("that weight still never counts pieces: \"3 digestive biscuits\" asks for grams", () => {
  const { portions } = opening(customFoodResult(biscuits));
  const resolution = resolvePortion(parseFoodQuery("3 digestive biscuits"), portions);
  assert.equal(resolution.kind, "ask");
  assert.equal(resolution.kind === "ask" && resolution.reason, "no-count-weight", "never 3 × 45 g");
  assert.equal(resolvePortion(parseFoodQuery("90 g digestive biscuits"), portions).kind, "grams");
});

test("a package saved to My foods opens on the label's serving it kept", () => {
  const label = servingToSave({ portions: [{ label: "1 serving (30 g)", unit: "serving", grams: 30, estimate: false }] }, null);
  assert.deepEqual(label, { label: "30 g", grams: 30 });
  const copy = customFoodResult({ ...biscuits, id: "c-pack", serving_size: label.label, serving_grams: label.grams, value_basis: "label", origin: "barcode" });
  assert.deepEqual([opening(copy).label, opening(copy).grams], ["1 serving (30 g)", 30]);
});

test("a default piece or serving still comes first; other foods open as before", () => {
  const named = customFoodResult({ ...biscuits, id: "c-named", serving_size: "2 biscuits", serving_grams: 25 });
  assert.equal(opening(named).label, "1 serving (2 biscuits, 25 g)", "a named serving is the default count, as before");
  const oldCopy = customFoodResult({ ...biscuits, id: "c-idli", name: "Idli", serving_size: "100 g", serving_grams: 100, value_basis: "recipe_calculated", source_ref: "2708346" }, null, IDLI);
  assert.deepEqual([opening(oldCopy).label, opening(oldCopy).grams], ["1 item", 38], "an old 100 g copy of Idli opens on Idli's piece, which counts \"3 idli\"");
  assert.deepEqual([opening(IDLI).label, opening(IDLI).grams], ["1 item", 38]);
  assert.equal(opening(DAL).index, -1, "a catalogue food with no default piece opens at 100 g, as before");
  const packaged = { kind: "packaged", name: "Marie biscuits", calories: 440, portions: [{ label: "1 serving (6 biscuits, 27 g)", unit: "serving", grams: 27, estimate: false }, { label: "1 pack (250 g)", unit: "piece", grams: 250, estimate: false }] } as Pick<FoodResult, "kind" | "portions" | "name" | "calories">;
  assert.equal(opening(packaged).index, 0, "a scanned product opens on its label's serving, as before");
});

test("the page opens a food with nothing typed through openingPortion", () => {
  const page = read("src/app/(dashboard)/nutrition/page.tsx");
  const choose = page.slice(page.indexOf("const chooseFood = useCallback("), page.indexOf("const lookupBarcode = useCallback("));
  assert.match(choose, /const index = openingPortion\(food, portions\);/);
  assert.match(choose, /setAmount\(index >= 0 \? "1" : "100"\)/);
});
