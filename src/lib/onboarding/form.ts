/**
 * The three setup pages after sign-up, as data: what each page asks, how answers start from what is stored,
 * how they are checked, and what each page saves. OnboardingFlow renders it; this file has no React so it runs
 * under `node --test`.
 *
 * The owner listed some questions on two pages (workout setup and experience on pages 1 and 3, diet and
 * allergies on pages 1 and 2). Both pages edit the same answer, so the later page starts from what was given
 * on page 1 and either page can change it.
 */

import {
  AGE_RANGE,
  HEIGHT_RANGE_CM,
  MAX_CUSTOM_LIMITATIONS,
  MAX_FOOD_DISLIKES,
  MAX_LIMITATION_LENGTH,
  NAME_MAX_LENGTH,
  ONBOARDING_DAYS_PER_WEEK,
  ONBOARDING_GOALS,
  GOALS_BEFORE_ONBOARDING_V3,
  GOALS_BEFORE_PROFILE_V2,
  WEIGHT_RANGE_KG,
  ageFromBirthDate,
  commitDraft,
  inRange,
  joinKnown,
  joinLimitations,
  legacyDietaryPreferences,
  normalizeBirthDate,
  onboardingMeals,
  splitAllergies,
  splitLimitations,
  type ActivityLevel,
  type AllergyKey,
  type DietType,
  type Experience,
  type FoodRule,
  type FoodSource,
  type Goal,
  type HeightUnit,
  type LimitationKey,
  type NutritionFocus,
  type Sex,
  type TrainingLocation,
  type WeightUnit,
} from "@/lib/domain/profile-options";
import { sortEquipmentKeys } from "@/lib/training/equipment";

export const ONBOARDING_PAGES = [
  { id: "personal", label: "You", title: "Personal details" },
  { id: "food", label: "Food", title: "Food and nutrition" },
  { id: "training", label: "Training", title: "Workout setup" },
] as const;
export type OnboardingPage = (typeof ONBOARDING_PAGES)[number]["id"];

export type OnboardingForm = {
  name: string;
  /** YYYY-MM-DD as the date field gives it, or "" while empty. */
  birthDate: string;
  gender: Sex | null;
  heightCm: number | null;
  weightKg: number | null;
  targetWeightKg: number | null;
  heightUnit: HeightUnit;
  weightUnit: WeightUnit;
  goal: Goal;
  activity: ActivityLevel;
  experience: Experience;
  location: TrainingLocation;
  diet: DietType | null;
  allergies: AllergyKey[];
  customAllergies: string[];
  limitations: LimitationKey[];
  customLimitations: string[];
  foodRules: FoodRule[];
  dislikes: string[];
  meals: number;
  foodSource: FoodSource | null;
  nutritionFocus: NutritionFocus | null;
  days: number;
  /** Equipment keys (src/lib/training/taxonomy.ts); an empty home list means no equipment (body weight). */
  homeEquipment: string[];
  gymEquipment: string[];
  /** Typed into a tag field but not added yet; saved with the page. */
  allergyDraft: string;
  limitationDraft: string;
  dislikeDraft: string;
};

/** What the form starts from: the parts of UserContextData it reads. */
export type OnboardingSource = {
  profile: {
    name: string;
    date_of_birth: string | null;
    gender: Sex | null;
    height: number | null;
    target_weight: number | null;
  } | null;
  preferences: {
    height_unit: HeightUnit;
    weight_unit: WeightUnit;
    primary_goal: Goal;
    activity_level: ActivityLevel;
    fitness_level: Experience;
    workout_location: TrainingLocation;
    diet_type: DietType | null;
    allergies: readonly string[];
    limitations: readonly string[];
    food_rules: readonly FoodRule[];
    food_dislikes: readonly string[];
    meals_per_day: number;
    food_source: FoodSource | null;
    nutrition_focus: NutritionFocus | null;
    workouts_per_week: number;
  };
  currentWeightKg: number | null;
  equipmentLists: { home: { keys: readonly string[] }; gym: { keys: readonly string[] } };
};

/** Which migrations the database has: what the page may offer and save. */
export type OnboardingSchema = { preferencesV2: boolean; onboardingV3: boolean };

const SETUP_LOCATIONS: readonly TrainingLocation[] = ["gym", "home", "both"];

export function initialOnboardingForm(source: OnboardingSource, metadataName = ""): OnboardingForm {
  const profile = source.profile;
  const prefs = source.preferences;
  const allergies = splitAllergies(prefs.allergies);
  const limitations = splitLimitations(prefs.limitations);
  const days = Math.round(prefs.workouts_per_week);
  return {
    name: (profile?.name || metadataName).slice(0, NAME_MAX_LENGTH),
    birthDate: normalizeBirthDate(profile?.date_of_birth) ?? "",
    gender: profile?.gender ?? null,
    heightCm: profile?.height ?? null,
    weightKg: source.currentWeightKg,
    targetWeightKg: profile?.target_weight ?? null,
    heightUnit: prefs.height_unit,
    weightUnit: prefs.weight_unit,
    goal: prefs.primary_goal,
    activity: prefs.activity_level,
    experience: prefs.fitness_level,
    // "Outdoors" is a Profile choice; setup asks gym, home or both.
    location: SETUP_LOCATIONS.includes(prefs.workout_location) ? prefs.workout_location : "gym",
    diet: prefs.diet_type,
    allergies: allergies.keys,
    customAllergies: allergies.custom,
    limitations: limitations.keys,
    customLimitations: limitations.custom,
    foodRules: [...prefs.food_rules],
    dislikes: [...prefs.food_dislikes],
    meals: onboardingMeals(prefs.meals_per_day),
    foodSource: prefs.food_source,
    nutritionFocus: prefs.nutrition_focus,
    days: Math.min(7, Math.max(2, Number.isFinite(days) ? days : 3)),
    homeEquipment: [...source.equipmentLists.home.keys],
    gymEquipment: [...source.equipmentLists.gym.keys],
    allergyDraft: "",
    limitationDraft: "",
    dislikeDraft: "",
  };
}

/** The form with any text still in a tag field added as an entry, as it is saved. */
export function withDraftsAdded(form: OnboardingForm): OnboardingForm {
  return {
    ...form,
    customAllergies: commitDraft(form.customAllergies, form.allergyDraft),
    customLimitations: commitDraft(form.customLimitations, form.limitationDraft, { max: MAX_CUSTOM_LIMITATIONS, maxLength: MAX_LIMITATION_LENGTH }),
    dislikes: commitDraft(form.dislikes, form.dislikeDraft, { max: MAX_FOOD_DISLIKES }),
    allergyDraft: "",
    limitationDraft: "",
    dislikeDraft: "",
  };
}

/** Goals setup shows but cannot save yet, because the database's goal rule predates them. */
export function unavailableGoals(schema: OnboardingSchema): Goal[] {
  const allowed = !schema.preferencesV2 ? GOALS_BEFORE_PROFILE_V2 : !schema.onboardingV3 ? GOALS_BEFORE_ONBOARDING_V3 : null;
  return allowed ? ONBOARDING_GOALS.filter((goal) => !allowed.includes(goal)) : [];
}

export type OnboardingErrors = Partial<Record<keyof OnboardingForm, string>>;

export function validatePage(page: OnboardingPage, form: OnboardingForm, schema: OnboardingSchema, today: Date = new Date()): OnboardingErrors {
  const errors: OnboardingErrors = {};
  if (page === "personal") {
    if (!form.name.trim()) errors.name = "Add your name.";
    const birthDate = normalizeBirthDate(form.birthDate);
    const age = ageFromBirthDate(birthDate, today);
    if (!form.birthDate.trim()) errors.birthDate = "Add your date of birth.";
    else if (!birthDate || age === null) errors.birthDate = "Enter a real date, not in the future.";
    else if (!inRange(age, AGE_RANGE)) errors.birthDate = `FITX is for ages ${AGE_RANGE.min} to ${AGE_RANGE.max}.`;
    if (!form.gender) errors.gender = "Choose one. It shapes your calorie estimate and the AI coach’s advice.";
    if (form.heightCm === null) errors.heightCm = "Add your height.";
    else if (!inRange(form.heightCm, HEIGHT_RANGE_CM)) errors.heightCm = "Enter a height between 90 and 250 cm (2 ft 11 in to 8 ft 2 in).";
    if (form.weightKg === null) errors.weightKg = "Add your current weight.";
    else if (!inRange(form.weightKg, WEIGHT_RANGE_KG)) errors.weightKg = "Enter a weight between 30 and 500 kg (66 to 1,102 lb).";
    if (form.targetWeightKg !== null && !inRange(form.targetWeightKg, WEIGHT_RANGE_KG)) errors.targetWeightKg = "Enter a target between 30 and 500 kg, or leave it empty.";
    if (unavailableGoals(schema).includes(form.goal)) errors.goal = "This goal arrives with the next FITX update. Choose another for now.";
  }
  if (page === "food" && !form.diet) errors.diet = "Choose the option closest to how you eat.";
  if (page === "training" && !ONBOARDING_DAYS_PER_WEEK.includes(form.days as (typeof ONBOARDING_DAYS_PER_WEEK)[number])) errors.days = "Choose 2 to 7 days.";
  return errors;
}

export type Row = Record<string, unknown>;

/** What one page writes: profile fields, preference fields, and the equipment lists to save. */
export type PageSave = {
  profile: Row | null;
  preferences: Row;
  equipment: { home?: string[]; gym?: string[] };
};

/**
 * What a page saves (answers already checked by validatePage). `legacyDiet` is the stored
 * `dietary_preferences` (kept in step with the diet), `unknownEquipment` the stored equipment words FITX does
 * not recognise (kept, never dropped). Preference columns of a missing migration are left for savePreferences
 * to drop; the profile's date of birth is only sent once its column exists.
 */
export function pageSave(
  page: OnboardingPage,
  form: OnboardingForm,
  { schema, legacyDiet = [], unknownEquipment = [], timezone = "UTC", today = new Date() }: {
    schema: OnboardingSchema;
    legacyDiet?: readonly string[];
    unknownEquipment?: readonly string[];
    timezone?: string;
    today?: Date;
  },
): PageSave {
  // An unanswered diet is left as stored; allergies always save (none chosen means none).
  const diet = form.diet ? { diet_type: form.diet, dietary_preferences: legacyDietaryPreferences(form.diet, legacyDiet) } : {};
  const allergies = joinKnown(form.allergies, form.customAllergies);
  if (page === "personal") {
    const birthDate = normalizeBirthDate(form.birthDate);
    return {
      profile: {
        name: form.name.trim().slice(0, NAME_MAX_LENGTH),
        // Kept in step with the birth date here too, so it is right before the database trigger exists.
        age: ageFromBirthDate(birthDate, today),
        ...(schema.onboardingV3 ? { date_of_birth: birthDate } : {}),
        gender: form.gender,
        height: form.heightCm,
        weight: form.weightKg,
        target_weight: form.targetWeightKg,
      },
      preferences: {
        height_unit: form.heightUnit,
        weight_unit: form.weightUnit,
        primary_goal: form.goal,
        activity_level: form.activity,
        fitness_level: form.experience,
        workout_location: form.location,
        limitations: joinLimitations(form.limitations, form.customLimitations),
        timezone,
        ...diet,
        allergies,
      },
      equipment: {},
    };
  }
  if (page === "food") {
    return {
      profile: null,
      preferences: {
        ...diet,
        allergies,
        food_rules: form.foodRules,
        food_dislikes: form.dislikes,
        meals_per_day: onboardingMeals(form.meals),
        food_source: form.foodSource,
        nutrition_focus: form.nutritionFocus,
      },
      equipment: {},
    };
  }
  const home = sortEquipmentKeys(form.homeEquipment);
  const gym = sortEquipmentKeys(form.gymEquipment);
  return {
    profile: null,
    preferences: {
      workout_location: form.location,
      fitness_level: form.experience,
      workouts_per_week: form.days,
      // The original equipment answer: the home kit (it seeds the Home list) plus words FITX doesn't know.
      equipment: [...home, ...unknownEquipment],
    },
    equipment: {
      ...(form.location !== "gym" ? { home } : {}),
      ...(form.location !== "home" ? { gym } : {}),
    },
  };
}

/** Training days spread across the week (Monday first), as a coach would place them. */
export function trainingDays(days: number): boolean[] {
  const patterns: Record<number, number[]> = {
    1: [0], 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 4, 5], 6: [0, 1, 2, 3, 4, 5], 7: [0, 1, 2, 3, 4, 5, 6],
  };
  const on = new Set(patterns[Math.min(7, Math.max(1, Math.round(days)))] ?? []);
  return Array.from({ length: 7 }, (_, index) => on.has(index));
}
