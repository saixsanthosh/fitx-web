// Review round, finding N6 (bug 5's fix): a "1 cup" the member typed for a food of their own became a cup measure, and
// FITX then worked out ml, spoons, katori and bowl from it as if it were a 236.6 ml US cup, crediting USDA: bug 4's
// "Masala chai (home)" (1 cup = 150 g) made "200 ml masala chai" 126.8 g "worked out from USDA's 1 cup". The member's
// cup (often a 150 ml teacup) was never said to be a US cup. It now counts as itself only ("2 cups" is 300 g); other
// measures come only from a catalogue food's own cup (a copy saved as it was keeps that one).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { localFoodsFrom, rankAndPick, customRowToFood, type RankableFood } from "@/lib/food/catalog-search";
import { customFoodResult, foodFromEntry, type CustomFoodRow, type MealEntry } from "@/lib/food/client-data";
import { extraPortions, parseFoodQuery, resolvePortion, volumeNote, type FoodPortion } from "@/lib/domain/food-query";
import { customServingPortion, passedOverNote, servingToSave } from "@/lib/food/saved-foods";
import type { FoodResult } from "@/lib/food/types";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const data = (file: string) => JSON.parse(read(`src/data/${file}`));
const local = localFoodsFrom(data("fitx-staples.json"), data("usda-foundation-foods.json"));
const DAL = local.all.find((food) => food.id === "2707427") as RankableFood;

const options = (food: Pick<FoodResult, "portions" | "name">): FoodPortion[] => [...food.portions, ...extraPortions(food.portions, food.name)];
const resolve = (food: Pick<FoodResult, "portions" | "name">, typed: string) => resolvePortion(parseFoodQuery(typed), options(food));
const grams = (food: Pick<FoodResult, "portions" | "name">, typed: string) => {
  const resolution = resolve(food, typed);
  return resolution.kind === "portion" || resolution.kind === "grams" ? resolution.grams : null;
};

/** Bug 4's own food: Masala chai (home), 1 cup = 150 g, 90 kcal, macros left blank. */
const chaiRow: CustomFoodRow = {
  id: "c-chai", name: "Masala chai (home)", brand: null, serving_size: "1 cup", serving_grams: 150,
  calories_per_100g: 60, protein_per_100g: null, carbs_per_100g: null, fat_per_100g: null, origin: "user", value_basis: "user_entered",
};

test("a cup or spoon the member saved is their own size: it counts as itself, and nothing is worked out from it", () => {
  assert.equal(customServingPortion("1 cup", 150).ownSize, true);
  assert.equal(customServingPortion("1 tbsp", 14).ownSize, true);
  assert.equal(customServingPortion("1 item", 38).ownSize, undefined, "a piece is a piece");
  assert.equal(customServingPortion("1 bowl", 180).ownSize, undefined, "a bowl is already the member's own bowl");
  for (const chai of [customFoodResult(chaiRow), customRowToFood({ ...chaiRow })]) {
    assert.equal(grams(chai, "2 cups masala chai"), 300, "2 × the member's 150 g cup");
    assert.deepEqual(extraPortions(chai.portions, chai.name), [], "no ml, spoons, katori or bowl from a teacup");
    for (const typed of ["200 ml masala chai", "1 tbsp masala chai", "1 katori masala chai"]) {
      assert.equal(resolve(chai, typed).kind, "ask", `${typed}: asked, never 126.8 g "worked out from USDA's 1 cup"`);
    }
    assert.equal(volumeNote(options(chai)), "Your “1 cup” is your own measure: FITX counts it, but doesn't work out ml or katori from it.");
  }
});

test("a catalogue food's own cup still gives ml and katori, also in a copy saved as it was", () => {
  assert.equal(grams(DAL, "1 katori dal"), 152.2);
  assert.equal(volumeNote(options(DAL)), null);
  const saved = servingToSave(DAL, null);
  assert.deepEqual(saved, { label: "1 cup", grams: 240 });
  const copy = customFoodResult({ ...chaiRow, id: "c-dal", name: "Dal", serving_size: saved.label, serving_grams: saved.grams, calories_per_100g: 145, value_basis: "recipe_calculated", source_ref: DAL.id }, null, DAL);
  assert.equal(copy.portions.length, 1, "the copy's cup is Dal's own, listed once");
  assert.equal(copy.portions[0].ownSize, undefined, "the very measure of the catalogue food it came from");
  assert.equal(grams(copy, "1 katori dal"), 152.2);
  assert.equal(grams(copy, "200 ml dal"), 202.9);
  const changed = customFoodResult({ ...chaiRow, id: "c-dal", name: "Dal", serving_size: "1 cup", serving_grams: 200, calories_per_100g: 145, value_basis: "user_entered", source_ref: DAL.id }, null, DAL);
  assert.equal(grams(changed, "1 cup dal"), 200, "values the member changed: their own cup");
  assert.equal(grams(changed, "1 katori dal"), null);
});

test("your own Dal with its own cup gives way to the catalogue's Dal for a katori, and says why", () => {
  const own = customRowToFood({ ...chaiRow, id: "c-dal", name: "Dal", serving_size: "1 cup", serving_grams: 240, calories_per_100g: 145, protein_per_100g: 9, carbs_per_100g: 20, fat_per_100g: 3 });
  const katori = parseFoodQuery("1 katori dal");
  const picked = rankAndPick([DAL], [own], katori.words, katori);
  assert.equal(picked.pick?.id, DAL.id);
  assert.equal(picked.passedOver?.id, "c-dal");
  assert.equal(passedOverNote(own, DAL, katori), "Your own “Dal” has no katori weight, so this is FITX's Dal. To log yours, go back to the results.");
  const cups = parseFoodQuery("2 cups dal");
  assert.equal(rankAndPick([DAL], [own], cups.words, cups).pick?.id, "c-dal", "a cup is yours to count");
});

test("logged with the member's own cup, Frequent rebuilds it as their own size", () => {
  const page = read("src/app/(dashboard)/nutrition/page.tsx");
  assert.match(page, /\.\.\.\(portion\.ownSize \? \{ own_size: true \} : \{\}\)/, "the entry says the cup was the member's own");
  const entry = {
    id: "m1", date: "2026-11-25", meal: "Dinner", food_name: "Masala chai (home)", brand: null, barcode: null, servings: 1.5, calories: 90, protein: null, carbs: null, fat: null,
    quantity_grams: 150, source: "FITX custom food", provider_id: "c-chai", serving_size: "1 cup (150 g)",
    nutrition_snapshot: { per_100g: { calories: 60, protein: null, carbs: null, fat: null }, missing: ["protein", "carbs", "fat"], kind: "custom", value_basis: "user_entered",
      portion: { count: 1, label: "1 cup", unit: "cup", grams_each: 150, estimate: false, own_size: true } },
  } as unknown as MealEntry;
  const food = foodFromEntry(entry) as FoodResult;
  assert.equal(food.portions[0].ownSize, true);
  assert.deepEqual(extraPortions(food.portions, food.name), []);
  const usda = foodFromEntry({ ...entry, source: "USDA FoodData Central", nutrition_snapshot: { ...entry.nutrition_snapshot, kind: "catalog", portion: { count: 1, label: "1 cup", unit: "cup", grams_each: 240, estimate: true } } } as MealEntry) as FoodResult;
  assert.ok(extraPortions(usda.portions, usda.name).length > 0, "a USDA cup logged before still gives ml and katori");
  assert.match(read("src/components/nutrition/PortionPicker.tsx"), /const noVolume = volumeNote\(options\);/);
});
