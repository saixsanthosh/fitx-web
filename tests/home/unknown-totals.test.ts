// Home's Today and Macros widgets: a day whose foods all lack a value has an unknown total, never 0 (C11).
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyMealTotals, mealTotals, unknownDayTotal } from "@/lib/domain/meal-totals";

test("a total is unknown only when food is logged and none of it gives the value", () => {
  const labels = mealTotals([
    { calories: 120, protein: null, carbs: 20, fat: null },
    { calories: 90, protein: 4, carbs: 15, fat: 3, nutrition_snapshot: { missing: ["protein", "fat"] } },
  ]);
  assert.equal(unknownDayTotal(labels, "protein"), true, "neither label gives protein");
  assert.equal(unknownDayTotal(labels, "fat"), true);
  assert.equal(unknownDayTotal(labels, "calories"), false);
  assert.equal(unknownDayTotal(labels, "carbs"), false);

  const partly = mealTotals([{ calories: 100, protein: 10 }, { calories: 50, protein: null }]);
  assert.equal(unknownDayTotal(partly, "protein"), false, "one known value gives a total (the note names the other)");

  assert.equal(unknownDayTotal(emptyMealTotals(), "calories"), false, "nothing logged is a real 0");
  assert.equal(unknownDayTotal(null, "calories"), false, "the check could not run: the summary number stands");
});
