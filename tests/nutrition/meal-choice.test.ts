// Bug 22 (nutrition-7): the meal picked with a meal's "+" (or "Add a meal") stayed for the rest of the visit, so Log
// food, Quick add and the one-tap Add under Frequent foods sent dinner to Lunch or Breakfast. A choice now lasts for
// one Log food: each time the sheet opens it is on the meal asked for, or the one just added from the Meals tab (that
// once), or the one that suits the time of day at that moment.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mealForOpen, mealForTime } from "@/lib/domain/meal-time";

const at = (hours: number, minutes = 0) => new Date(2026, 10, 25, hours, minutes);

test("Log food opens on the meal asked for, a meal just added, or the time of day now", () => {
  assert.equal(mealForOpen(null, null, at(20, 56)), "Dinner", "an evening Log food");
  assert.equal(mealForOpen("Lunch", null, at(20, 56)), "Lunch", "a meal's + picks it for that one log");
  assert.equal(mealForOpen(undefined, null, at(23, 46)), "Dinner", "after that, the time of day again: never the earlier +");
  assert.equal(mealForOpen(null, "Pre-workout", at(20, 56)), "Pre-workout", "a meal just added from the Meals tab");
  assert.equal(mealForOpen("Lunch", "Pre-workout", at(9)), "Lunch", "a + wins over it");
  assert.equal(mealForOpen(null, null, at(7)), mealForTime(at(7)));
  assert.equal(mealForOpen(null, null, at(7)), "Breakfast");
});

test("the page sets the meal each time Log food opens, and nothing makes a choice stick", () => {
  const page = readFileSync(new URL("../../src/app/(dashboard)/nutrition/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /mealPicked/, "no flag that stops the time of day choosing the meal");
  const openLog = page.slice(page.indexOf("function openLog("), page.indexOf("function closeLog("));
  assert.match(openLog, /setMeal\(mealForOpen\(options\.meal, pendingMeal\.current, new Date\(\)\)\);\s*pendingMeal\.current = null;/);
  // Every other way the sheet opens from outside also starts from the time of day.
  for (const opener of ['label: "Log it"', 'get("scan") !== "1"']) {
    const at = page.indexOf(opener);
    assert.ok(at > 0, opener);
    assert.match(page.slice(at, at + 500), /setMeal\(mealForOpen\(null, null, new Date\(\)\)\)/, opener);
  }
});
