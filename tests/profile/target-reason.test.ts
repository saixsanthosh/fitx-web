import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { calculateNutritionTargets } from "@/lib/domain/nutrition";
import { targetReason } from "@/lib/domain/target-reason";

describe("how the target was set", () => {
  test("names the floor only when the target equals it", () => {
    const lean = calculateNutritionTargets({ age: 40, gender: "male", height: 165, weight: 55 }, "sedentary", "weight_loss")!;
    assert.equal(lean.calories, 1500);
    assert.match(targetReason(lean), /safe minimum of 1,500 kcal/);
  });

  test("says the target stays at maintenance when maintenance is already under the floor", () => {
    const small = calculateNutritionTargets({ age: 60, gender: "female", height: 150, weight: 48 }, "sedentary", "weight_loss")!;
    assert.equal(small.calories, 1148);
    const reason = targetReason(small);
    assert.doesNotMatch(reason, /1,200/);
    assert.match(reason, /stays at maintenance/);
  });

  test("explains deficits, surpluses, maintenance and the under-18 rule", () => {
    const man = { age: 28, gender: "male", height: 178, weight: 78 };
    assert.match(targetReason(calculateNutritionTargets(man, "moderate", "weight_loss")!), /^About 545 kcal under maintenance, roughly 0\.5 kg a week\.$/);
    assert.match(targetReason(calculateNutritionTargets(man, "moderate", "muscle_gain")!), /^About 272 kcal over maintenance/);
    assert.equal(targetReason(calculateNutritionTargets(man, "moderate", "general_fitness")!), "Set at maintenance, to keep your weight steady.");
    assert.match(targetReason(calculateNutritionTargets({ age: 16, gender: "female", height: 162, weight: 70 }, "moderate", "fat_loss")!), /Under 18/);
  });

  test("adds one short clause for High protein, and nothing otherwise", () => {
    const man = { age: 28, gender: "male", height: 178, weight: 78 };
    const high = targetReason(calculateNutritionTargets(man, "moderate", "muscle_gain", "high_protein")!);
    assert.match(high, /^About 272 kcal over maintenance, roughly 0\.3 kg a week\. Protein set high, at up to 2\.2 g per kg\.$/);
    assert.doesNotMatch(targetReason(calculateNutritionTargets(man, "moderate", "muscle_gain", "balanced")!), /Protein/);
  });
});
