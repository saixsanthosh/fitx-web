import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_MULTIPLIERS,
  ACTIVITY_OPTIONS,
  AGE_RANGE,
  GOALS_BEFORE_ONBOARDING_V3,
  ONBOARDING_DIETS,
  ONBOARDING_GOALS,
  ONBOARDING_MEAL_OPTIONS,
  SEX_OPTIONS,
  activityBand,
  choicesKeeping,
  unavailableProfileGoals,
  activityForBand,
  ageFromBirthDate,
  birthDateBounds,
  birthDateEdit,
  BIRTH_DATE_SAVED_ERROR,
  isBirthDateLocked,
  profileAge,
  normalizeBirthDate,
  onboardingMeals,
  DIET_OPTIONS,
  GOAL_OPTIONS,
  GOALS_BEFORE_PROFILE_V2,
  goalsAwaitingMigration,
  goalsAwaitingMigrationHint,
  cmToFeetInches,
  commitDraft,
  feetInchesToCm,
  formatHeight,
  formatRupees,
  formatWeight,
  inRange,
  joinKnown,
  joinLimitations,
  MAX_LIMITATION_LENGTH,
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

  test("every key this module used to store maps to the training taxonomy Workouts uses", () => {
    // The earlier vocabulary (the exercise catalogue's tags), as onboarding and Profile stored it.
    const earlier = ["dumbbell", "barbell", "ez_bar", "bench", "rack", "kettlebell", "cable", "machine", "bands", "pull_up_bar", "medicine_ball", "exercise_ball", "foam_roller", "other"];
    const { keys, unknown } = normalizeEquipment(earlier);
    assert.deepEqual(unknown, []);
    assert.equal(keys.length, earlier.length);
  });

  test("activity labels are the same everywhere and each has a multiplier", () => {
    assert.equal(optionLabel(ACTIVITY_OPTIONS, "active"), "Very active");
    assert.equal(optionLabel(ACTIVITY_OPTIONS, "very_active"), "Extremely active");
    for (const option of ACTIVITY_OPTIONS) assert.ok(ACTIVITY_MULTIPLIERS[option.value] > 1, option.value);
    assert.equal(optionLabel(ACTIVITY_OPTIONS, "nonsense"), null);
  });
});

describe("equipment", () => {
  test("maps what people typed in the old Profile box to the training taxonomy", () => {
    const { keys, unknown } = normalizeEquipment(["Dumbbells", "resistance bands", "Cable machine", "pull-up bar", "EZ curl bar", "squat rack", "trampoline", "TRX"]);
    for (const key of ["dumbbell", "resistance_band", "cable_machine", "pull_up_bar", "ez_bar", "squat_rack", "suspension_trainer"]) assert.ok(keys.includes(key), key);
    assert.deepEqual(unknown, ["trampoline"]);
  });

  test("bodyweight means no equipment; blanks, duplicates and non-strings are ignored", () => {
    assert.deepEqual(normalizeEquipment(["bodyweight", "none"]), { keys: [], unknown: [] });
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

  test("an allergy is never narrowed: \"Nuts\" stays as typed instead of becoming tree nuts", () => {
    assert.deepEqual(splitAllergies(["Nuts"]), { keys: [], custom: ["Nuts"] });
    assert.deepEqual(splitAllergies(["groundnuts", "lactose"]).keys, ["dairy", "peanuts"]);
  });

  test("limitations accept same-meaning spellings and never narrow one", () => {
    assert.deepEqual(splitLimitations(["Knees", "elbows", "back", "Old ankle sprain"]), { keys: ["knee", "wrist"], custom: ["back", "Old ankle sprain"] });
  });

  test("injury notes keep up to 60 characters through save and load", () => {
    const long = "Recent knee surgery: no jumping or deep squats until March";
    assert.equal(long.length <= MAX_LIMITATION_LENGTH, true);
    assert.deepEqual(joinLimitations(["knee"], [long]), ["knee", long]);
    assert.deepEqual(splitLimitations(["knee", long]).custom, [long]);
    // Two notes that start alike both survive (cutting at 40 would merge them).
    const a = "Left knee ACL reconstruction 2025: avoid jumps";
    const b = "Left knee ACL reconstruction 2025: avoid deep squats";
    assert.deepEqual(splitLimitations([a, b]).custom, [a, b]);
  });

  test("a tag field adds typed text on Enter, + or leaving the field, split at commas", () => {
    assert.deepEqual(commitDraft(["Kiwi"], "mango,  kiwi , "), ["Kiwi", "mango"]);
    assert.deepEqual(commitDraft([], "x".repeat(70), { maxLength: 60 }), ["x".repeat(60)]);
    assert.deepEqual(commitDraft(["a", "b"], "c", { max: 2 }), ["a", "b"]);
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

describe("setup v3 vocabulary", () => {
  test("setup offers the owner's five goals, including Maintain weight", () => {
    assert.deepEqual(ONBOARDING_GOALS.map((goal) => optionLabel(GOAL_OPTIONS, goal)), ["Muscle gain", "Weight loss", "Strength", "General fitness", "Maintain weight"]);
    assert.ok(!GOALS_BEFORE_ONBOARDING_V3.includes("maintain_weight"));
    for (const goal of GOALS_BEFORE_PROFILE_V2) assert.ok(GOALS_BEFORE_ONBOARDING_V3.includes(goal));
  });

  test("Profile greys out goals the database can't store yet, Maintain weight included before onboarding v3", () => {
    assert.deepEqual(goalsAwaitingMigration({ preferencesV2: false, onboardingV3: false }), ["weight_gain", "weight_loss", "maintain_weight"]);
    assert.deepEqual(goalsAwaitingMigration({ preferencesV2: true, onboardingV3: false }), ["maintain_weight"]);
    assert.deepEqual(goalsAwaitingMigration({ preferencesV2: true, onboardingV3: true }), []);
    assert.deepEqual(goalsAwaitingMigration({ preferencesV2: true, onboardingV3: false }, ONBOARDING_GOALS), ["maintain_weight"]);
    assert.equal(goalsAwaitingMigrationHint(["maintain_weight"]), "Maintain weight arrives with the next FITX update.");
    assert.equal(goalsAwaitingMigrationHint(["weight_gain", "weight_loss", "maintain_weight"]), "Weight gain, weight loss and maintain weight arrive with the next FITX update.");
    assert.equal(goalsAwaitingMigrationHint([]), undefined);
  });

  test("gender reads Male, Female, Prefer not to say; diets include Eggetarian; meals 2 to 5+", () => {
    assert.deepEqual(SEX_OPTIONS.map((option) => option.label), ["Male", "Female", "Prefer not to say"]);
    assert.deepEqual(ONBOARDING_DIETS.map((diet) => optionLabel(DIET_OPTIONS, diet)), ["Vegetarian", "Non-vegetarian", "Vegan", "Eggetarian"]);
    assert.deepEqual(ONBOARDING_MEAL_OPTIONS.map((option) => option.label), ["2", "3", "4", "5+"]);
    assert.deepEqual([1, 2, 5, 6, 8].map(onboardingMeals), [2, 2, 5, 5, 5]);
  });

  test("activity in three bands keeps a stored level that is already in the chosen band", () => {
    assert.deepEqual(ACTIVITY_OPTIONS.map((option) => activityBand(option.value)), ["low", "low", "moderate", "high", "high"]);
    assert.equal(activityForBand("low", "light"), "light");
    assert.equal(activityForBand("low", "moderate"), "sedentary");
    assert.equal(activityForBand("high", "moderate"), "active");
    assert.equal(activityForBand("high", "very_active"), "very_active");
  });

  test("age from a birth date counts whole years, birthdays included", () => {
    const today = new Date(2026, 10, 19);
    assert.equal(ageFromBirthDate("1997-11-19", today), 29, "the birthday itself");
    assert.equal(ageFromBirthDate("1997-11-20", today), 28, "the day before the birthday");
    assert.equal(ageFromBirthDate("2000-02-29", new Date(2026, 1, 28)), 25, "a leap-day birthday before 1 March");
    assert.equal(ageFromBirthDate("2027-01-01", today), null, "the future");
    assert.equal(ageFromBirthDate("1997-02-30", today), null, "not a real date");
    assert.equal(ageFromBirthDate(null, today), null);
    assert.equal(normalizeBirthDate("1997-03-14T00:00:00Z"), "1997-03-14");
    assert.equal(normalizeBirthDate("14/03/1997"), null);
  });

  test("the date field allows exactly ages 13 to 100", () => {
    const today = new Date(2026, 10, 19);
    const { min, max } = birthDateBounds(today);
    assert.equal(max, "2013-11-19");
    assert.equal(ageFromBirthDate(max, today), AGE_RANGE.min);
    assert.equal(min, "1925-11-20");
    assert.equal(ageFromBirthDate(min, today), AGE_RANGE.max);
    assert.equal(ageFromBirthDate("1925-11-19", today), AGE_RANGE.max + 1);
  });
});

describe("birthDateEdit (Profile, once profiles.date_of_birth exists)", () => {
  const today = new Date(2026, 10, 20);
  const withBirthDate = { age: 29, date_of_birth: "1997-03-14" };

  test("a saved birth date is never changed here: changing it is a FITX support request", () => {
    assert.deepEqual(birthDateEdit(withBirthDate, "1996-03-14", today), { error: BIRTH_DATE_SAVED_ERROR, patch: {}, age: 29 });
    assert.match(BIRTH_DATE_SAVED_ERROR, /ask FITX support/);
  });

  test("an account without a birth date adds one, and the age follows it", () => {
    assert.deepEqual(birthDateEdit({ age: 41, date_of_birth: null }, "1996-03-14", today), { error: null, patch: { date_of_birth: "1996-03-14", age: 30 }, age: 30 });
  });

  test("an unchanged birth date saves nothing", () => {
    assert.deepEqual(birthDateEdit(withBirthDate, "1997-03-14", today), { error: null, patch: {}, age: 29 });
  });

  test("never sends an age on its own, which the database trigger would overwrite", () => {
    for (const typed of ["", "1996-03-14", "1997-03-14", "2001-01-01"]) {
      const { patch } = birthDateEdit(withBirthDate, typed, today);
      if ("age" in patch) assert.ok("date_of_birth" in patch, typed);
    }
  });

  test("a saved birth date is never cleared here either, so its age stays", () => {
    assert.deepEqual(birthDateEdit(withBirthDate, "", today), { error: BIRTH_DATE_SAVED_ERROR, patch: {}, age: 29 });
  });

  test("an account with only an age keeps it until a birth date is added", () => {
    assert.deepEqual(birthDateEdit({ age: 41, date_of_birth: null }, "", today), { error: null, patch: {}, age: 41 });
    assert.deepEqual(birthDateEdit({ age: null, date_of_birth: null }, "", today), { error: null, patch: {}, age: null });
  });

  test("the database's refusal to change a saved birth date is recognised", () => {
    assert.equal(isBirthDateLocked({ message: "birth_date_locked" }), true);
    assert.equal(isBirthDateLocked({ message: "permission denied for table profiles" }), false);
    assert.equal(isBirthDateLocked(null), false);
  });

  test("future, unreal and out-of-range dates are refused without a patch", () => {
    assert.match(birthDateEdit(withBirthDate, "2027-01-01", today).error ?? "", /real date/);
    assert.match(birthDateEdit(withBirthDate, "1997-02-30", today).error ?? "", /real date/);
    assert.match(birthDateEdit(withBirthDate, "2020-01-01", today).error ?? "", new RegExp(`ages ${AGE_RANGE.min} to ${AGE_RANGE.max}`));
    assert.deepEqual(birthDateEdit(withBirthDate, "2020-01-01", today).patch, {});
  });
});

describe("profileAge (Home, Nutrition and the AI coach read the birth date, not the stored age)", () => {
  test("the birth date wins over a stored age a birthday has outdated", () => {
    const row = { age: 17, date_of_birth: "2008-11-20" };
    assert.equal(profileAge(row, "2026-11-20"), 18);
    assert.equal(profileAge(row, "2026-11-19"), 17);
    assert.equal(profileAge(row, new Date(2026, 10, 20)), 18);
  });

  test("without a birth date the stored age stands, and unknown stays unknown", () => {
    assert.equal(profileAge({ age: 41 }, "2026-11-20"), 41);
    assert.equal(profileAge({ age: "41", date_of_birth: null }, "2026-11-20"), 41);
    assert.equal(profileAge({ age: null, date_of_birth: null }, "2026-11-20"), null);
    assert.equal(profileAge({ age: "" }, "2026-11-20"), null);
    assert.equal(profileAge(null), null);
    assert.equal(profileAge({ age: 30, date_of_birth: "not a date" }, "2026-11-20"), 30);
  });
});

describe("Profile edit choices", () => {
  test("goals the database cannot store yet are offered but disabled", () => {
    assert.deepEqual(unavailableProfileGoals({ preferencesV2: true, onboardingV3: true }), []);
    assert.deepEqual(unavailableProfileGoals({ preferencesV2: true, onboardingV3: false }), ["maintain_weight"]);
    assert.deepEqual(unavailableProfileGoals({ preferencesV2: false, onboardingV3: false }), ["weight_gain", "weight_loss", "maintain_weight"]);
  });

  test("an older stored answer stays a choice, so an untouched form never changes it", () => {
    const days = [2, 3, 4, 5, 6, 7].map((value) => ({ value, label: String(value) }));
    assert.deepEqual(choicesKeeping(days, 4).map((option) => option.value), [2, 3, 4, 5, 6, 7]);
    assert.deepEqual(choicesKeeping(days, 1).map((option) => option.value), [1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual(choicesKeeping(ONBOARDING_MEAL_OPTIONS, 6).map((option) => option.label), ["2", "3", "4", "5+", "6"]);
    assert.deepEqual(choicesKeeping(ONBOARDING_MEAL_OPTIONS, 5).map((option) => option.label), ["2", "3", "4", "5+"]);
  });
});
