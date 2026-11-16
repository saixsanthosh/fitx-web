import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { singular } from "@/lib/domain/food-query";

type Portion = { label: string; unit: string; grams: number; countDefault?: boolean };
type Staple = {
  id: string;
  fdcId: number;
  name: string;
  dataType: string;
  published: string;
  state: string | null;
  aliases: string[];
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  portions: Portion[];
};

const file = JSON.parse(readFileSync(new URL("../../src/data/fitx-staples.json", import.meta.url), "utf8")) as {
  source: string;
  retrieved: string;
  foods: Staple[];
};

test("records where the staples came from", () => {
  assert.equal(file.source, "USDA FoodData Central");
  assert.match(file.retrieved, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(file.foods.length >= 10);
});

test("every staple is a USDA FoodData Central food with sane per-100 g values", () => {
  const ids = new Set<number>();
  for (const food of file.foods) {
    assert.ok(Number.isInteger(food.fdcId) && food.fdcId > 0, food.name);
    assert.equal(food.id, String(food.fdcId), food.name);
    assert.ok(!ids.has(food.fdcId), `duplicate ${food.fdcId}`);
    ids.add(food.fdcId);
    assert.ok(["Survey (FNDDS)", "SR Legacy", "Foundation"].includes(food.dataType), food.name);
    assert.ok(food.state === null || food.state === "cooked" || food.state === "raw", food.name);
    for (const value of [food.calories, food.protein, food.carbs, food.fat]) assert.ok(Number.isFinite(value) && value >= 0, food.name);
    assert.ok(food.calories <= 900, food.name);
    assert.ok(food.protein + food.carbs + food.fat <= 100.5, food.name);
    // A transcription check: energy should be close to 4 kcal/g protein and carbs plus 9 kcal/g fat.
    const atwater = 4 * food.protein + 4 * food.carbs + 9 * food.fat;
    assert.ok(Math.abs(atwater - food.calories) <= Math.max(10, food.calories * 0.1), `${food.name}: ${food.calories} kcal vs ${atwater.toFixed(0)} from macros`);
    assert.ok(food.aliases.length > 0, food.name);
  }
});

test("portion weights are positive and only piece portions answer bare counts", () => {
  for (const food of file.foods) {
    for (const portion of food.portions) {
      assert.ok(portion.grams > 0, `${food.name}: ${portion.label}`);
      assert.ok(["piece", "slice", "cup", "tbsp", "tsp"].includes(portion.unit), `${food.name}: ${portion.unit}`);
      if (portion.countDefault) assert.equal(portion.unit, "piece", `${food.name}: ${portion.label}`);
    }
    assert.ok(food.portions.filter((portion) => portion.countDefault).length <= 1, food.name);
  }
});

test("idli and cooked rice carry the weights USDA publishes", () => {
  const idli = file.foods.find((food) => food.fdcId === 2708346);
  assert.deepEqual(idli && { calories: idli.calories, item: idli.portions.find((portion) => portion.label === "1 item")?.grams }, { calories: 128, item: 38 });
  const rice = file.foods.find((food) => food.fdcId === 2708408);
  assert.deepEqual(rice && { state: rice.state, calories: rice.calories, cup: rice.portions[0]?.grams }, { state: "cooked", calories: 129, cup: 158 });
});

test("everyday staples carry the values and weights USDA publishes", () => {
  const food = (fdcId: number) => {
    const found = file.foods.find((item) => item.fdcId === fdcId);
    assert.ok(found, `missing ${fdcId}`);
    return found;
  };
  const grams = (fdcId: number, label: string) => food(fdcId).portions.find((portion) => portion.label === label)?.grams;
  assert.equal(food(171287).calories, 143, "Egg, whole, raw, fresh");
  assert.deepEqual(food(171287).portions.filter((portion) => portion.countDefault).map((portion) => [portion.label, portion.grams]), [["1 large", 50]]);
  assert.equal(grams(171413, "1 tablespoon"), 13.5, "olive oil");
  assert.equal(grams(169640, "1 tbsp"), 21, "honey");
  assert.equal(grams(173410, "1 tbsp"), 14.2, "butter");
  assert.equal(grams(746782, "1 cup"), 249, "whole milk");
  assert.equal(grams(2708357, "1 cup, cooked"), 140, "pasta");
  assert.deepEqual([food(173757).state, food(173757).calories], ["cooked", 164], "chickpeas");
  assert.deepEqual([food(169736).state, food(169736).calories], ["raw", 371], "dry pasta");
});

test("no two staples answer to the same name, so a typed name selects one food", () => {
  const phrase = (text: string) => text.toLowerCase().split(/[^a-z0-9%]+/).filter(Boolean).map(singular).join(" ");
  const owner = new Map<string, string>();
  for (const food of file.foods) {
    for (const name of new Set([food.name, ...food.aliases].map(phrase))) {
      assert.ok(!owner.has(name), `"${name}" is used by both ${owner.get(name)} and ${food.name}`);
      owner.set(name, food.name);
    }
  }
  assert.equal(owner.has("biryani"), false, "vegetable, chicken and meat biryani all answer to plain biryani");
});

test("leaves out FNDDS paneer, whose recipe keeps the whey sugar", () => {
  // FNDDS 14110050 "Cheese, paneer" (fdcId 2705740) is whole milk plus vinegar with all the lactose retained,
  // giving 22.5 g carbohydrate per 100 g. See src/data/DATA_SOURCES.md.
  assert.equal(file.foods.some((food) => food.fdcId === 2705740), false);
});
