import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  ONBOARDING_PAGES,
  initialOnboardingForm,
  pageSave,
  trainingDays,
  unavailableGoals,
  validatePage,
  withDraftsAdded,
  type OnboardingSource,
} from "@/lib/onboarding/form";
import { normalizePreferences } from "@/lib/domain/user-context";

const TODAY = new Date(2026, 10, 19); // 19 November 2026, local time
const FULL = { preferencesV2: true, onboardingV3: true };

function source(overrides: Partial<OnboardingSource> = {}): OnboardingSource {
  return {
    profile: { name: "Asha Rao", date_of_birth: null, gender: null, height: null, target_weight: null },
    preferences: normalizePreferences(null).values,
    currentWeightKg: null,
    equipmentLists: { home: { keys: [] }, gym: { keys: ["barbell", "dumbbell", "machine"] } },
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
  test("exactly three pages: personal details, food and nutrition, workout setup", () => {
    assert.deepEqual(ONBOARDING_PAGES.map((page) => page.title), ["Personal details", "Food and nutrition", "Workout setup"]);
  });
});

describe("starting answers", () => {
  test("start from what is stored, with setup's own ranges", () => {
    const prefs = { ...normalizePreferences({ meals_per_day: 6, workouts_per_week: 1, workout_location: "outdoor", food_source: "outside", nutrition_focus: "high_protein" }).values };
    const form = initialOnboardingForm(source({ preferences: prefs, profile: { name: "", date_of_birth: "1990-02-28", gender: "male", height: 180, target_weight: null } }), "From Google");
    assert.equal(form.name, "From Google", "the sign-up name fills an empty name");
    assert.equal(form.birthDate, "1990-02-28");
    assert.equal(form.meals, 5, "6 meals shows as 5+");
    assert.equal(form.days, 2, "weekly availability starts at 2");
    assert.equal(form.location, "gym", "outdoors is a Profile choice; setup asks gym, home or both");
    assert.equal(form.foodSource, "outside");
    assert.equal(form.nutritionFocus, "high_protein");
    assert.deepEqual(form.gymEquipment, ["barbell", "dumbbell", "machine"]);
  });
});

describe("checking a page", () => {
  test("page 1 needs a name, a real date of birth for ages 13 to 100, gender, height and weight", () => {
    const empty = { ...initialOnboardingForm(source()), name: " " };
    const errors = validatePage("personal", empty, FULL, TODAY);
    assert.deepEqual(Object.keys(errors).sort(), ["birthDate", "gender", "heightCm", "name", "weightKg"]);
    assert.match(errors.gender!, /AI coach/, "sex shapes the coach's advice too, so the message says so");

    assert.deepEqual(validatePage("personal", filled(), FULL, TODAY), {});
    assert.match(validatePage("personal", { ...filled(), birthDate: "2026-12-01" }, FULL, TODAY).birthDate!, /not in the future/);
    assert.match(validatePage("personal", { ...filled(), birthDate: "2014-01-01" }, FULL, TODAY).birthDate!, /13 to 100/);
    assert.match(validatePage("personal", { ...filled(), birthDate: "2023-02-30" }, FULL, TODAY).birthDate!, /real date/);
    assert.ok(validatePage("personal", { ...filled(), targetWeightKg: 12 }, FULL, TODAY).targetWeightKg);
  });

  test("a goal the database can't take yet is refused before saving", () => {
    assert.deepEqual(unavailableGoals(FULL), []);
    assert.deepEqual(unavailableGoals({ preferencesV2: true, onboardingV3: false }), ["maintain_weight"]);
    assert.deepEqual(unavailableGoals({ preferencesV2: false, onboardingV3: false }), ["weight_loss", "maintain_weight"]);
    const errors = validatePage("personal", { ...filled(), goal: "maintain_weight" }, { preferencesV2: true, onboardingV3: false }, TODAY);
    assert.ok(errors.goal);
  });

  test("page 2 needs a diet; page 3 needs 2 to 7 days", () => {
    assert.ok(validatePage("food", filled(), FULL, TODAY).diet);
    assert.deepEqual(validatePage("food", { ...filled(), diet: "eggetarian" }, FULL, TODAY), {});
    assert.ok(validatePage("training", { ...filled(), days: 1 }, FULL, TODAY).days);
    assert.deepEqual(validatePage("training", { ...filled(), days: 7 }, FULL, TODAY), {});
  });
});

describe("what each page saves", () => {
  test("page 1: the profile with the age the birth date gives, and the goal, activity, setup and safety answers", () => {
    const form = withDraftsAdded({ ...filled(), goal: "maintain_weight" as const, location: "both" as const, limitations: ["knee" as const], limitationDraft: "Old ankle sprain", diet: "vegan" as const, allergies: ["peanuts" as const] });
    const save = pageSave("personal", form, { schema: FULL, timezone: "Asia/Kolkata", today: TODAY, legacyDiet: ["Halal"] });
    assert.deepEqual(save.profile, { name: "Asha Rao", age: 29, date_of_birth: "1997-03-14", gender: "female", height: 162, weight: 68.5, target_weight: null });
    assert.equal(save.preferences.primary_goal, "maintain_weight");
    assert.equal(save.preferences.workout_location, "both");
    assert.equal(save.preferences.timezone, "Asia/Kolkata");
    assert.deepEqual(save.preferences.limitations, ["knee", "Old ankle sprain"]);
    assert.equal(save.preferences.diet_type, "vegan");
    assert.deepEqual(save.preferences.dietary_preferences, ["Vegan", "Halal"], "the legacy diet label follows, other entries stay");
    assert.deepEqual(save.preferences.allergies, ["peanuts"]);
    assert.deepEqual(save.equipment, {});
  });

  test("before the onboarding v3 migration the birth date is not sent, but the age is", () => {
    const save = pageSave("personal", filled(), { schema: { preferencesV2: true, onboardingV3: false }, today: TODAY });
    assert.equal(save.profile!.age, 29);
    assert.ok(!("date_of_birth" in save.profile!));
  });

  test("page 1 leaves an unanswered diet alone", () => {
    const save = pageSave("personal", filled(), { schema: FULL, today: TODAY });
    assert.ok(!("diet_type" in save.preferences));
  });

  test("page 2: diet, allergies with custom entries, restrictions, meals, food preference and nutrition goal", () => {
    const form = withDraftsAdded({ ...filled(), diet: "eggetarian" as const, allergies: ["peanuts" as const], customAllergies: ["Kiwi"], allergyDraft: "mango", foodRules: ["jain" as const], dislikeDraft: "Bitter gourd", meals: 5, foodSource: "both" as const, nutritionFocus: "high_protein" as const });
    const save = pageSave("food", form, { schema: FULL, today: TODAY });
    assert.equal(save.profile, null);
    assert.deepEqual(save.preferences, {
      diet_type: "eggetarian",
      dietary_preferences: ["Eggetarian"],
      allergies: ["peanuts", "Kiwi", "mango"],
      food_rules: ["jain"],
      food_dislikes: ["Bitter gourd"],
      meals_per_day: 5,
      food_source: "both",
      nutrition_focus: "high_protein",
    });
  });

  test("page 3: location, experience and days; each list for the places chosen, unknown equipment words kept", () => {
    const form = { ...filled(), location: "both" as const, homeEquipment: ["resistance_band", "dumbbell"], gymEquipment: ["machine", "barbell"], days: 5, experience: "advanced" as const };
    const save = pageSave("training", form, { schema: FULL, unknownEquipment: ["trampoline"], today: TODAY });
    assert.deepEqual(save.preferences, { workout_location: "both", fitness_level: "advanced", workouts_per_week: 5, equipment: ["dumbbell", "resistance_band", "trampoline"] });
    assert.deepEqual(save.equipment, { home: ["dumbbell", "resistance_band"], gym: ["barbell", "machine"] });
    assert.deepEqual(pageSave("training", { ...form, location: "gym" }, { schema: FULL }).equipment, { gym: ["barbell", "machine"] });
    assert.deepEqual(pageSave("training", { ...form, location: "home", homeEquipment: [] }, { schema: FULL }).equipment, { home: [] }, "no equipment: an empty home list (bodyweight only)");
  });
});

describe("the week on the stage", () => {
  test("training days are spread across the week, Monday first", () => {
    assert.deepEqual(trainingDays(2), [true, false, false, true, false, false, false]);
    assert.deepEqual(trainingDays(3), [true, false, true, false, true, false, false]);
    assert.equal(trainingDays(7).filter(Boolean).length, 7);
    for (let days = 1; days <= 7; days += 1) assert.equal(trainingDays(days).filter(Boolean).length, days);
  });
});
