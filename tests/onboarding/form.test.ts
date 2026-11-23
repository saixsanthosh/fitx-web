import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ONBOARDING_PAGES,
  firstName,
  initialOnboardingForm,
  pageSave,
  unavailableGoals,
  validatePage,
  type OnboardingSource,
} from "@/lib/onboarding/form";
import { dialScale } from "@/lib/onboarding/dial";
import { normalizePreferences } from "@/lib/domain/user-context";
import { HEIGHT_RANGE_CM, WEIGHT_RANGE_KG, kgToLb } from "@/lib/domain/profile-options";

const TODAY = new Date(2026, 10, 19); // 19 November 2026, local time
const FULL = { preferencesV2: true, onboardingV3: true };

function source(overrides: Partial<OnboardingSource> = {}): OnboardingSource {
  return {
    profile: { name: "Asha Rao", date_of_birth: null, gender: null, height: null, target_weight: null },
    preferences: normalizePreferences(null).values,
    currentWeightKg: null,
    ...overrides,
  };
}

function filled() {
  return {
    ...initialOnboardingForm(source()),
    birthDate: "1997-03-14",
    gender: "female" as const,
    heightCm: 162,
    weightKg: 68.5,
  };
}

describe("pages", () => {
  test("exactly three short pages: about you, your body, your goal", () => {
    assert.deepEqual(ONBOARDING_PAGES.map((page) => page.title), ["About you", "Your body", "Your goal"]);
  });

  test("setup asks only the essentials: no workout, equipment or food questions", () => {
    const flow = readFileSync(new URL("../../src/app/(auth)/onboarding/OnboardingFlow.tsx", import.meta.url), "utf8");
    for (const removed of ["EquipmentGrid", "Workout setup", "Workout location", "Days a week", "Fitness experience", "Diet", "allerg", "Meals per day", "Food preference", "Nutrition goal", "limitation"]) {
      assert.doesNotMatch(flow, new RegExp(removed, "i"), `${removed} moved to the Workout or Nutrition first-time setup`);
    }
    const form = readFileSync(new URL("../../src/lib/onboarding/form.ts", import.meta.url), "utf8");
    for (const column of ["workout_location", "fitness_level", "workouts_per_week", "diet_type", "allergies", "food_rules", "meals_per_day", "food_source", "nutrition_focus", "equipment"]) {
      assert.doesNotMatch(form.replace(/\/\*[\s\S]*?\*\//g, ""), new RegExp(`\\b${column}:`), `setup no longer writes ${column}, so stored answers stay`);
    }
  });
});

describe("starting answers", () => {
  test("start from what is stored; the sign-up name fills an empty name", () => {
    const prefs = { ...normalizePreferences({ primary_goal: "strength", activity_level: "light", height_unit: "ft_in", weight_unit: "lb" }).values };
    const form = initialOnboardingForm(source({ preferences: prefs, currentWeightKg: 80, profile: { name: "", date_of_birth: "1990-02-28", gender: "male", height: 180, target_weight: 75 } }), "From Google");
    assert.equal(form.name, "From Google");
    assert.equal(form.birthDate, "1990-02-28");
    assert.equal(form.gender, "male");
    assert.equal(form.heightCm, 180);
    assert.equal(form.weightKg, 80);
    assert.equal(form.targetWeightKg, 75);
    assert.equal(form.goal, "strength");
    assert.equal(form.activity, "light");
    assert.equal(form.heightUnit, "ft_in");
    assert.equal(form.weightUnit, "lb");
  });

  test("a first name for greetings", () => {
    assert.equal(firstName("  Asha   Rao "), "Asha");
    assert.equal(firstName(""), null);
    assert.equal(firstName(null), null);
  });
});

describe("checking a page", () => {
  test("page 1 needs a name, a real date of birth for ages 13 to 100, and gender", () => {
    const empty = { ...initialOnboardingForm(source()), name: " " };
    const errors = validatePage("you", empty, FULL, TODAY);
    assert.deepEqual(Object.keys(errors).sort(), ["birthDate", "gender", "name"]);
    assert.match(errors.gender!, /AI coach/, "sex shapes the coach's advice too, so the message says so");
    assert.deepEqual(validatePage("you", filled(), FULL, TODAY), {});
    assert.match(validatePage("you", { ...filled(), birthDate: "2026-12-01" }, FULL, TODAY).birthDate!, /not in the future/);
    assert.match(validatePage("you", { ...filled(), birthDate: "2014-01-01" }, FULL, TODAY).birthDate!, /13 to 100/);
    assert.match(validatePage("you", { ...filled(), birthDate: "2023-02-30" }, FULL, TODAY).birthDate!, /real date/);
  });

  test("page 2 needs height and current weight in range; the target is optional but checked", () => {
    const empty = initialOnboardingForm(source());
    assert.deepEqual(Object.keys(validatePage("body", empty, FULL, TODAY)).sort(), ["heightCm", "weightKg"]);
    assert.deepEqual(validatePage("body", filled(), FULL, TODAY), {});
    assert.ok(validatePage("body", { ...filled(), heightCm: Number.NaN }, FULL, TODAY).heightCm, "what is typed must be a number");
    assert.ok(validatePage("body", { ...filled(), weightKg: 900 }, FULL, TODAY).weightKg);
    assert.ok(validatePage("body", { ...filled(), targetWeightKg: 12 }, FULL, TODAY).targetWeightKg);
    assert.deepEqual(validatePage("body", { ...filled(), targetWeightKg: 62 }, FULL, TODAY), {});
  });

  test("page 3: a goal the database can't take yet is refused before saving", () => {
    assert.deepEqual(unavailableGoals(FULL), []);
    assert.deepEqual(unavailableGoals({ preferencesV2: true, onboardingV3: false }), ["maintain_weight"]);
    assert.deepEqual(unavailableGoals({ preferencesV2: false, onboardingV3: false }), ["weight_loss", "maintain_weight"]);
    assert.ok(validatePage("goal", { ...filled(), goal: "maintain_weight" }, { preferencesV2: true, onboardingV3: false }, TODAY).goal);
    assert.deepEqual(validatePage("goal", { ...filled(), goal: "maintain_weight" }, FULL, TODAY), {});
  });
});

describe("what each page saves", () => {
  test("page 1: name, gender and the birth date with the age it gives, plus the time zone", () => {
    const save = pageSave("you", filled(), { schema: FULL, timezone: "Asia/Kolkata", today: TODAY });
    assert.deepEqual(save.profile, { name: "Asha Rao", age: 29, date_of_birth: "1997-03-14", gender: "female" });
    assert.deepEqual(save.preferences, { timezone: "Asia/Kolkata" });
  });

  test("before the onboarding v3 migration the birth date is not sent, but the age is", () => {
    const save = pageSave("you", filled(), { schema: { preferencesV2: true, onboardingV3: false }, today: TODAY });
    assert.equal(save.profile!.age, 29);
    assert.ok(!("date_of_birth" in save.profile!));
  });

  test("page 2: height, weight and target in centimetres and kilograms, and the units shown", () => {
    const save = pageSave("body", { ...filled(), targetWeightKg: 62, heightUnit: "ft_in", weightUnit: "lb" }, { schema: FULL, today: TODAY });
    assert.deepEqual(save.profile, { height: 162, weight: 68.5, target_weight: 62 });
    assert.deepEqual(save.preferences, { height_unit: "ft_in", weight_unit: "lb" });
  });

  test("page 3: the goal and activity level only", () => {
    const save = pageSave("goal", { ...filled(), goal: "weight_loss", activity: "moderate" }, { schema: FULL, timezone: "Europe/London", today: TODAY });
    assert.equal(save.profile, null);
    assert.deepEqual(save.preferences, { primary_goal: "weight_loss", activity_level: "moderate", timezone: "Europe/London" });
  });
});

describe("the height and weight dials", () => {
  test("each slider sits inside the range setup accepts, and rests on a typical value", () => {
    const cm = dialScale("height", "cm");
    assert.ok(cm.min >= HEIGHT_RANGE_CM.min && cm.max <= HEIGHT_RANGE_CM.max && cm.start > cm.min && cm.start < cm.max);
    const inches = dialScale("height", "ft_in");
    assert.ok(inches.min * 2.54 >= HEIGHT_RANGE_CM.min && inches.max * 2.54 <= HEIGHT_RANGE_CM.max);
    const kg = dialScale("weight", "kg");
    assert.ok(kg.min >= WEIGHT_RANGE_KG.min && kg.max <= WEIGHT_RANGE_KG.max && kg.step === 0.5);
    const lb = dialScale("weight", "lb");
    assert.ok(lb.min >= kgToLb(WEIGHT_RANGE_KG.min) - 1 && lb.max <= kgToLb(WEIGHT_RANGE_KG.max));
  });
});
