import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_MULTIPLIERS,
  ACTIVITY_OPTIONS,
  DIET_OPTIONS,
  EQUIPMENT_OPTIONS,
  GOAL_OPTIONS,
  GOALS_BEFORE_PROFILE_V2,
  cmToFeetInches,
  feetInchesToCm,
  formatHeight,
  formatRupees,
  formatWeight,
  inRange,
  joinKnown,
  kgToLb,
  lbToKg,
  legacyDietaryPreferences,
  normalizeDietType,
  normalizeEquipment,
  normalizeFoodRules,
  normalizeTags,
  optionLabel,
  parseDecimal,
  parseRupees,
  splitAllergies,
  splitLimitations,
  WEIGHT_RANGE_KG,
} from "@/lib/domain/profile-options";

// The equipment tags used by the exercise catalogue (decoded from supabase/migrations/20260930180*.sql
// and the starter rows in 20260924170604): the vocabulary must offer every one of them.
const CATALOGUE_EQUIPMENT = ["barbell", "dumbbell", "other", "bodyweight", "cable", "machine", "kettlebell", "bands", "medicine_ball", "exercise_ball", "foam_roller", "ez_bar", "bench", "pull_up_bar", "rack"];

describe("vocabulary", () => {
  test("offers every goal the owner asked for, plus the two the database already had", () => {
    const goals = GOAL_OPTIONS.map((option) => option.value);
    for (const goal of ["muscle_gain", "weight_gain", "fat_loss", "weight_loss", "general_fitness"]) assert.ok(goals.includes(goal as never), goal);
    for (const goal of GOALS_BEFORE_PROFILE_V2) assert.ok(goals.includes(goal), goal);
    assert.deepEqual(new Set(goals).size, goals.length);
  });

  test("diet types are vegetarian, non-vegetarian, both, vegan and eggetarian", () => {
    assert.deepEqual(DIET_OPTIONS.map((option) => option.value), ["vegetarian", "non_vegetarian", "both", "vegan", "eggetarian"]);
  });

  test("equipment keys are exactly the exercise catalogue's tags", () => {
    assert.deepEqual(EQUIPMENT_OPTIONS.map((option) => option.value).sort(), [...CATALOGUE_EQUIPMENT].sort());
  });

  test("activity labels are the same everywhere and each has a multiplier", () => {
    assert.equal(optionLabel(ACTIVITY_OPTIONS, "active"), "Very active");
    assert.equal(optionLabel(ACTIVITY_OPTIONS, "very_active"), "Extremely active");
    for (const option of ACTIVITY_OPTIONS) assert.ok(ACTIVITY_MULTIPLIERS[option.value] > 1, option.value);
    assert.equal(optionLabel(ACTIVITY_OPTIONS, "nonsense"), null);
  });
});

describe("equipment", () => {
  test("maps what people typed in the old Profile box to catalogue keys", () => {
    const { keys, unknown } = normalizeEquipment(["Dumbbells", "resistance bands", "Cable machine", "pull-up bar", "EZ curl bar", "squat rack", "trampoline"]);
    assert.deepEqual(keys, ["dumbbell", "ez_bar", "rack", "cable", "bands", "pull_up_bar"]);
    assert.deepEqual(unknown, ["trampoline"]);
  });

  test("ignores blanks, duplicates and non-strings", () => {
    assert.deepEqual(normalizeEquipment(["dumbbell", "", "  ", "Dumbbell", 4, null]).keys, ["dumbbell"]);
    assert.deepEqual(normalizeEquipment(null), { keys: [], unknown: [] });
  });
});

describe("diet, allergies, rules and lists", () => {
  test("reads the first onboarding's diet labels", () => {
    assert.equal(normalizeDietType(null, ["Vegetarian"]), "vegetarian");
    assert.equal(normalizeDietType(undefined, ["Vegan"]), "vegan");
    assert.equal(normalizeDietType(null, ["Halal", "Low carb"]), null);
    assert.equal(normalizeDietType("both", ["Vegetarian"]), "both");
    assert.equal(normalizeDietType("pescatarian", []), null);
  });

  test("keeps the legacy dietary_preferences column in step without losing other entries", () => {
    assert.deepEqual(legacyDietaryPreferences("non_vegetarian", ["Vegetarian", "Halal"]), ["Non-vegetarian", "Halal"]);
    assert.deepEqual(legacyDietaryPreferences(null, ["Vegan"]), []);
  });

  test("splits allergies into known keys (old labels included) and the user's own", () => {
    assert.deepEqual(splitAllergies(["Dairy", "Tree nuts", "Wheat", "sesame", "Kiwi", "kiwi "]), { keys: ["dairy", "tree_nuts", "wheat_gluten", "sesame"], custom: ["Kiwi"] });
    assert.deepEqual(joinKnown(["dairy"], ["Kiwi", " kiwi"]), ["dairy", "Kiwi"]);
  });

  test("limitations accept common spellings", () => {
    assert.deepEqual(splitLimitations(["Knees", "back", "Old ankle sprain"]), { keys: ["knee", "lower_back"], custom: ["Old ankle sprain"] });
  });

  test("food rules come from the new column or the old labels", () => {
    assert.deepEqual(normalizeFoodRules(["jain", "keto"]), ["jain"]);
    assert.deepEqual(normalizeFoodRules([], ["Halal", "Low carb", "Vegetarian"]), ["halal", "low_carb"]);
  });

  test("free-text entries are trimmed, capped and de-duplicated", () => {
    assert.deepEqual(normalizeTags(["  Bitter   gourd ", "bitter gourd", "x".repeat(60), ""]), ["Bitter gourd", "x".repeat(40)]);
    assert.equal(normalizeTags(Array.from({ length: 20 }, (_, i) => `food ${i}`), { max: 5 }).length, 5);
  });
});

describe("units and numbers", () => {
  test("converts heights between centimetres and feet and inches", () => {
    assert.deepEqual(cmToFeetInches(175), { feet: 5, inches: 9 });
    assert.deepEqual(cmToFeetInches(182.6), { feet: 6, inches: 0 });
    assert.equal(feetInchesToCm(5, 9), 175.3);
    assert.equal(formatHeight(175, "ft_in"), "5 ft 9 in");
    assert.equal(formatHeight(175.25, "cm"), "175.3 cm");
    assert.equal(formatHeight(null), null);
  });

  test("converts weights between kilograms and pounds", () => {
    assert.equal(kgToLb(72.5), 159.8);
    assert.equal(lbToKg(159.8), 72.5);
    assert.equal(formatWeight(72.5, "lb"), "159.8 lb");
    assert.equal(formatWeight(72.46), "72.5 kg");
  });

  test("parses typed decimals and rupees", () => {
    assert.equal(parseDecimal("72,5"), 72.5);
    assert.equal(parseDecimal(" "), null);
    assert.ok(Number.isNaN(parseDecimal("72kg")));
    assert.equal(parseRupees("₹ 12,000"), 12000);
    assert.equal(parseRupees("Rs. 8500"), 8500);
    assert.equal(parseRupees(""), null);
    assert.ok(Number.isNaN(parseRupees("lots")));
    assert.equal(formatRupees(125000), "₹1,25,000");
    assert.equal(inRange(72, WEIGHT_RANGE_KG), true);
    assert.equal(inRange(12, WEIGHT_RANGE_KG), false);
    assert.equal(inRange(null, WEIGHT_RANGE_KG), false);
  });
});
