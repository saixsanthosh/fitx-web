/**
 * The three short setup pages after sign-up, as data: what each page asks, how answers start from what is
 * stored, how they are checked, and what each page saves. OnboardingFlow renders it; this file has no React so
 * it runs under `node --test`.
 *
 * Only the essentials (owner's phase 5): who you are, your body, your goal. Workout questions (location,
 * equipment, experience, days, limitations) moved to the Workout first-time setup and food questions (diet,
 * allergies, rules, dislikes, meals, food source, nutrition focus) to the Nutrition first-time setup. Setup no
 * longer reads or writes those columns, so answers a member already gave stay exactly as they were.
 */

import {
  AGE_RANGE,
  NAME_MAX_LENGTH,
  ageFromBirthDate,
  goalsAwaitingMigration,
  heightError,
  inRange,
  normalizeBirthDate,
  weightError,
  ONBOARDING_GOALS,
  type ActivityLevel,
  type Goal,
  type HeightUnit,
  type Sex,
  type WeightUnit,
} from "@/lib/domain/profile-options";
import type { MeasureText } from "@/lib/onboarding/measure-field";

export const ONBOARDING_PAGES = [
  { id: "you", label: "You", title: "About you" },
  { id: "body", label: "Body", title: "Your body" },
  { id: "goal", label: "Goal", title: "Your goal" },
] as const;
export type OnboardingPage = (typeof ONBOARDING_PAGES)[number]["id"];

export type OnboardingForm = {
  name: string;
  /** YYYY-MM-DD as the date field gives it, or "" while empty. */
  birthDate: string;
  gender: Sex | null;
  /** null while empty, NaN while what is typed is not a number. */
  heightCm: number | null;
  weightKg: number | null;
  targetWeightKg: number | null;
  heightUnit: HeightUnit;
  weightUnit: WeightUnit;
  goal: Goal;
  activity: ActivityLevel;
};

/** The step 2 answers typed into a height or weight dial (MeasureDial). */
export type MeasureKey = "heightCm" | "weightKg" | "targetWeightKg";

/**
 * What each of those dials shows in place of its value: the text while it is typed, then text kept because it is not
 * a number (null: the value's own text shows). Setup holds it beside the answers, not in the dial, because Back
 * unmounts step 2's dials: a new dial must show the text that gave a NaN answer, never an empty box that Continue
 * refuses (bug 8).
 */
export type MeasureDrafts = Record<MeasureKey, MeasureText | null>;
export const NO_DRAFTS: MeasureDrafts = { heightCm: null, weightKg: null, targetWeightKg: null };

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
  };
  currentWeightKg: number | null;
};

/** Which migrations the database has: what the page may offer and save. */
export type OnboardingSchema = { preferencesV2: boolean; onboardingV3: boolean };

export function initialOnboardingForm(source: OnboardingSource, metadataName = ""): OnboardingForm {
  const profile = source.profile;
  const prefs = source.preferences;
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
  };
}

/** Goals setup shows but cannot save yet, because the database's goal rule predates them. */
export function unavailableGoals(schema: OnboardingSchema): Goal[] {
  return goalsAwaitingMigration(schema, ONBOARDING_GOALS);
}

export type OnboardingErrors = Partial<Record<keyof OnboardingForm, string>>;

export function validatePage(page: OnboardingPage, form: OnboardingForm, schema: OnboardingSchema, today: Date = new Date()): OnboardingErrors {
  const errors: OnboardingErrors = {};
  if (page === "you") {
    if (!form.name.trim()) errors.name = "Add your name.";
    const birthDate = normalizeBirthDate(form.birthDate);
    const age = ageFromBirthDate(birthDate, today);
    if (!form.birthDate.trim()) errors.birthDate = "Add your date of birth.";
    else if (!birthDate || age === null) errors.birthDate = "Enter a real date, not in the future.";
    else if (!inRange(age, AGE_RANGE)) errors.birthDate = `FITX is for ages ${AGE_RANGE.min} to ${AGE_RANGE.max}.`;
    if (!form.gender) errors.gender = "Choose one. It shapes your calorie estimate and the AI coach’s advice.";
  }
  if (page === "body") {
    // Checked in the unit shown, so a message names limits that are accepted as typed (2 ft 11 in is under 90 cm).
    const height = form.heightCm === null ? "Add your height." : heightError(form.heightCm, form.heightUnit);
    if (height) errors.heightCm = height;
    const weight = form.weightKg === null ? "Add your current weight." : weightError(form.weightKg, form.weightUnit);
    if (weight) errors.weightKg = weight;
    const target = weightError(form.targetWeightKg, form.weightUnit, { target: true });
    if (target) errors.targetWeightKg = target;
  }
  if (page === "goal" && unavailableGoals(schema).includes(form.goal)) errors.goal = "This goal arrives with the next FITX update. Choose another for now.";
  return errors;
}

/** The step 2 answers measured in each unit. */
export const MEASURED_IN: Readonly<Record<"heightUnit" | "weightUnit", readonly MeasureKey[]>> = {
  heightUnit: ["heightCm"],
  weightUnit: ["weightKg", "targetWeightKg"],
};

/**
 * The messages once a unit changes. `form` has the new unit and the value the switch left in each field (kept text
 * read again in it). A message already shown for one of that unit's answers is said again for what the answer holds
 * now, in the new unit, whose limits it names, and goes if that is fine; an answer showing no message gets none. So a
 * unit switch never hides a problem, and never raises one the member wasn't shown.
 */
export function messagesAfterUnitChange(shown: OnboardingErrors, form: OnboardingForm, key: "heightUnit" | "weightUnit", schema: OnboardingSchema): OnboardingErrors {
  const found = validatePage("body", form, schema);
  const next = { ...shown };
  for (const field of MEASURED_IN[key]) {
    if (!shown[field]) continue;
    if (found[field]) next[field] = found[field];
    else delete next[field];
  }
  return next;
}

export type Row = Record<string, unknown>;

/** What one page writes: profile fields (or null) and preference fields (possibly none). */
export type PageSave = { profile: Row | null; preferences: Row };

/**
 * What a page saves (answers already checked by validatePage). Preference columns of a missing migration are
 * left for savePreferences to drop; the profile's date of birth is only sent once its column exists.
 */
export function pageSave(
  page: OnboardingPage,
  form: OnboardingForm,
  { schema, timezone = "UTC", today = new Date() }: { schema: OnboardingSchema; timezone?: string; today?: Date },
): PageSave {
  if (page === "you") {
    const birthDate = normalizeBirthDate(form.birthDate);
    return {
      profile: {
        name: form.name.trim().slice(0, NAME_MAX_LENGTH),
        // Kept in step with the birth date here too, so it is right before the database trigger exists.
        age: ageFromBirthDate(birthDate, today),
        ...(schema.onboardingV3 ? { date_of_birth: birthDate } : {}),
        gender: form.gender,
      },
      preferences: { timezone },
    };
  }
  if (page === "body") {
    return {
      profile: { height: form.heightCm, weight: form.weightKg, target_weight: form.targetWeightKg },
      preferences: { height_unit: form.heightUnit, weight_unit: form.weightUnit },
    };
  }
  return { profile: null, preferences: { primary_goal: form.goal, activity_level: form.activity, timezone } };
}

/** The member's first name, for greetings: the first word of the name, or null. */
export function firstName(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first ? first.slice(0, NAME_MAX_LENGTH) : null;
}
