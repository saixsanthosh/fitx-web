import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
    assert.ok(["Survey (FNDDS)", "SR Legacy"].includes(food.dataType), food.name);
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
      assert.ok(["piece", "cup", "tbsp"].includes(portion.unit), `${food.name}: ${portion.unit}`);
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

test("leaves out FNDDS paneer, whose recipe keeps the whey sugar", () => {
  // FNDDS 14110050 "Cheese, paneer" (fdcId 2705740) is whole milk plus vinegar with all the lactose retained,
  // giving 22.5 g carbohydrate per 100 g. See src/data/DATA_SOURCES.md.
  assert.equal(file.foods.some((food) => food.fdcId === 2705740), false);
});
