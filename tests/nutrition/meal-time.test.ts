import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalMeal, checkSectionName, mealForTime, mealSections } from "@/lib/domain/meal-time";

const at = (hour: number, minute = 0) => new Date(2026, 10, 18, hour, minute);

test("the suggested meal follows the local time of day", () => {
  assert.equal(mealForTime(at(7)), "Breakfast");
  assert.equal(mealForTime(at(10, 59)), "Breakfast");
  assert.equal(mealForTime(at(11)), "Lunch");
  assert.equal(mealForTime(at(15, 59)), "Lunch");
  assert.equal(mealForTime(at(16)), "Snack");
  assert.equal(mealForTime(at(18, 59)), "Snack");
  assert.equal(mealForTime(at(19)), "Dinner");
  assert.equal(mealForTime(at(0, 30)), "Breakfast");
});

test("meal names are trimmed, limited to 40 characters and need a name", () => {
  assert.deepEqual(checkSectionName("  Pre-workout   shake "), { ok: true, name: "Pre-workout shake" });
  assert.equal(checkSectionName("   ").ok, false);
  assert.equal(checkSectionName("x".repeat(41)).ok, false);
  assert.equal(checkSectionName("x".repeat(40)).ok, true);
  assert.equal(checkSectionName("<b>bold</b>").ok, false);
});

test("sections are the four standard ones, then the member's own names once each", () => {
  assert.deepEqual(mealSections([]), ["Breakfast", "Lunch", "Dinner", "Snack"]);
  assert.deepEqual(mealSections(["Breakfast", "Evening tea", "evening tea", "  Pre-workout ", "snack"]), ["Breakfast", "Lunch", "Dinner", "Snack", "Evening tea", "Pre-workout"]);
  assert.deepEqual(mealSections(["Brunch"], ["Midnight", "brunch"]), ["Breakfast", "Lunch", "Dinner", "Snack", "Brunch", "Midnight"]);
  assert.equal(canonicalMeal("lunch"), "Lunch");
  assert.equal(canonicalMeal(" Evening  tea "), "Evening tea");
});
