import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { CALORIE_FLOORS, calculateNutritionTargets, estimateNutritionTargets, MINIMUM_CALORIES } from "@/lib/domain/nutrition";

const woman = { age: 30, gender: "female", height: 160, weight: 60 };
const man = { age: 28, gender: "male", height: 178, weight: 78 };

describe("daily targets", () => {
  test("maintenance is Mifflin-St Jeor BMR times the activity factor", () => {
    const targets = calculateNutritionTargets(woman, "moderate", "general_fitness")!;
    // 10*60 + 6.25*160 - 5*30 - 161 = 1289; * 1.55 = 1998
    assert.equal(targets.bmr, 1289);
    assert.equal(targets.maintenance, 1998);
    assert.equal(targets.calories, 1998);
    assert.equal(targets.rule, "maintenance");
    assert.equal(targets.weeklyChangeKg, 0);
  });

  test("each goal moves calories the expected way, with caps", () => {
    const at = (goal: string) => calculateNutritionTargets(man, "moderate", goal)!;
    const maintenance = at("general_fitness").calories; // 10*78 + 6.25*178 - 140 + 5 = 1757.5 -> 2724
    assert.equal(maintenance, 2724);
    assert.equal(at("muscle_gain").adjustment, 272); // +10%
    assert.equal(at("weight_gain").adjustment, 409); // +15%
    assert.equal(at("fat_loss").adjustment, -409); // -15%
    assert.equal(at("weight_loss").adjustment, -545); // -20%
    assert.equal(at("strength").adjustment, 0);
    assert.equal(at("maintain_weight").adjustment, 0); // Maintain weight keeps maintenance
    assert.equal(at("maintain_weight").rule, "maintenance");
    assert.ok(at("weight_gain").calories > at("muscle_gain").calories);
    assert.ok(at("weight_loss").calories < at("fat_loss").calories);
    // A very large maintenance still changes by at most the cap.
    const big = calculateNutritionTargets({ age: 25, gender: "male", height: 195, weight: 130 }, "very_active", "weight_loss")!;
    assert.equal(big.adjustment, -750);
    assert.equal(calculateNutritionTargets({ age: 25, gender: "male", height: 195, weight: 130 }, "very_active", "weight_gain")!.adjustment, 500);
  });

  test("estimates the weekly change from the adjustment", () => {
    const loss = calculateNutritionTargets(man, "moderate", "weight_loss")!;
    assert.equal(loss.weeklyChangeKg, -0.5); // -545 * 7 / 7700
    assert.equal(loss.rule, "deficit");
  });

  test("loss targets never go below the safe floor for the person's sex", () => {
    const small = { age: 60, gender: "female", height: 150, weight: 48 };
    const targets = calculateNutritionTargets(small, "sedentary", "weight_loss")!;
    // maintenance 10*48 + 937.5 - 300 - 161 = 956.5 * 1.2 = 1148, already under 1,200: no deficit at all
    assert.equal(targets.maintenance, 1148);
    assert.equal(targets.calories, 1148);
    assert.equal(targets.adjustment, 0);
    // The floor did not set this number (maintenance did), so it is not reported as applied.
    assert.equal(targets.floorApplied, null);
    assert.equal(targets.maintenanceBelowFloor, true);
    assert.equal(targets.weeklyChangeKg, 0);

    const lean = calculateNutritionTargets({ age: 40, gender: "male", height: 165, weight: 55 }, "sedentary", "weight_loss")!;
    // maintenance 550 + 1031.25 - 200 + 5 = 1386 * 1.2 = 1663; -20% would be 1330, raised to 1,500
    assert.equal(lean.calories, CALORIE_FLOORS.male);
    assert.equal(lean.floorApplied, CALORIE_FLOORS.male);
    assert.equal(lean.maintenanceBelowFloor, false);
    assert.equal(lean.adjustment, CALORIE_FLOORS.male - lean.maintenance);

    const unspecified = calculateNutritionTargets({ age: 35, gender: null, height: 158, weight: 52 }, "sedentary", "weight_loss")!;
    assert.equal(unspecified.calories, CALORIE_FLOORS.other);
    assert.equal(unspecified.floorApplied, CALORIE_FLOORS.other);
  });

  test("under-18s with a loss goal stay at maintenance", () => {
    const teen = calculateNutritionTargets({ age: 16, gender: "female", height: 162, weight: 70 }, "moderate", "fat_loss")!;
    assert.equal(teen.youthMaintenance, true);
    assert.equal(teen.calories, teen.maintenance);
    assert.equal(teen.rule, "maintenance");
    const growing = calculateNutritionTargets({ age: 16, gender: "male", height: 170, weight: 55 }, "moderate", "muscle_gain")!;
    assert.equal(growing.youthMaintenance, false);
    assert.ok(growing.adjustment > 0);
  });

  test("protein follows the goal and is capped for very heavy bodies", () => {
    assert.equal(calculateNutritionTargets(woman, "moderate", "fat_loss")!.protein, 120); // 2.0 g/kg
    assert.equal(calculateNutritionTargets(woman, "moderate", "general_fitness")!.protein, 96); // 1.6 g/kg
    const heavy = calculateNutritionTargets({ age: 40, gender: "male", height: 170, weight: 120 }, "light", "fat_loss")!;
    // counted against 27.5 * 1.7^2 = 79.5 kg, not 120 kg
    assert.equal(heavy.protein, 159);
  });

  test("macros add up to the calories", () => {
    for (const goal of ["muscle_gain", "weight_gain", "fat_loss", "weight_loss", "general_fitness", "strength", "endurance"]) {
      const t = calculateNutritionTargets(man, "active", goal)!;
      const fromMacros = t.protein * 4 + t.carbs * 4 + t.fat * 9;
      assert.ok(Math.abs(fromMacros - t.calories) <= 12, `${goal}: ${fromMacros} vs ${t.calories}`);
      assert.ok(t.calories >= MINIMUM_CALORIES);
    }
  });

  test("missing or impossible measurements give no targets", () => {
    assert.equal(calculateNutritionTargets({ age: null, gender: "male", height: 178, weight: 78 }), null);
    assert.equal(calculateNutritionTargets({ age: 30, gender: "male", height: 178, weight: null }), null);
    assert.equal(calculateNutritionTargets({ age: 12, gender: "male", height: 150, weight: 40 }), null);
    assert.equal(calculateNutritionTargets({ age: 30, gender: "male", height: 300, weight: 78 }), null);
  });

  test("unknown goals and activity levels fall back to maintenance at moderate activity", () => {
    const fallback = calculateNutritionTargets(man, "couch", "be_awesome")!;
    assert.equal(fallback.calories, calculateNutritionTargets(man, "moderate", "general_fitness")!.calories);
  });

  test("estimateNutritionTargets keeps its old signature for the pages that call it", () => {
    const macros = estimateNutritionTargets(man, "moderate", "fat_loss")!;
    assert.equal(macros.calories, calculateNutritionTargets(man, "moderate", "fat_loss")!.calories);
    assert.equal(estimateNutritionTargets({}), null);
  });
});
