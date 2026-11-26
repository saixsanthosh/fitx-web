/**
 * The Nutrition first-time setup (brief 3.4): the food questions onboarding no longer asks, answered once on the
 * member's first visit to Nutrition and editable later from there.
 *
 * Answers live in the user_preferences columns that already hold them (diet_type with dietary_preferences kept in
 * step, allergies, food_rules, food_dislikes, meals_per_day, food_source, nutrition_focus). Migration
 * 20261123100040 adds `nutrition_setup_at`; setup counts as done when it is set, or when diet_type is set (the old
 * onboarding required a diet, and the migration backfills from the same rule). Before that migration the answers
 * still save, without the timestamp, and the stored diet marks setup as done, so nobody is asked twice.
 *
 * "Later" only snoozes the setup on this device (localStorage), for SNOOZE_DAYS; the page keeps a quiet way back in.
 * No React here, so node tests cover it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ALLERGY_OPTIONS,
  DIET_OPTIONS,
  FOOD_RULE_OPTIONS,
  FOOD_SOURCE_OPTIONS,
  MAX_FOOD_DISLIKES,
  NUTRITION_FOCUS_OPTIONS,
  commitDraft,
  isOption,
  joinKnown,
  legacyDietaryPreferences,
  normalizeDietType,
  onboardingMeals,
  splitAllergies,
  type AllergyKey,
  type DietType,
  type FoodRule,
  type FoodSource,
  type NutritionFocus,
} from "@/lib/domain/profile-options";
import { isMissingColumnError } from "@/lib/domain/schema-fallback";
import { savePreferences, withColumnTiers } from "@/lib/domain/user-context";

export const NUTRITION_SETUP_COLUMN = "nutrition_setup_at";
/** The device's "Later": the setup stays closed until this many days have passed. */
export const SNOOZE_DAYS = 3;
export const SNOOZE_KEY = "fitx-nutrition-setup-later";
/** The four diets setup offers, in its order ("Both" stays available for accounts that have it). */
export const SETUP_DIETS: readonly DietType[] = ["vegetarian", "eggetarian", "non_vegetarian", "vegan"];

export type NutritionSetupAnswers = {
  diet: DietType | null;
  allergies: AllergyKey[];
  /** The member's own allergy words (not in ALLERGY_OPTIONS). */
  customAllergies: string[];
  foodRules: FoodRule[];
  dislikes: string[];
  /** 2 to 5 (5 means five or more). */
  meals: number;
  foodSource: FoodSource | null;
  nutritionFocus: NutritionFocus | null;
};

/** What the answers start from: the stored preferences (UserContextData.preferences carries these). */
export type SetupSource = {
  diet_type: DietType | null;
  allergies: readonly string[];
  food_rules: readonly FoodRule[];
  food_dislikes: readonly string[];
  meals_per_day: number;
  food_source: FoodSource | null;
  nutrition_focus: NutritionFocus | null;
};

export function initialSetupAnswers(source: SetupSource | null): NutritionSetupAnswers {
  const allergies = splitAllergies(source?.allergies ?? []);
  return {
    diet: source?.diet_type ?? null,
    allergies: allergies.keys,
    customAllergies: allergies.custom,
    foodRules: [...(source?.food_rules ?? [])].filter((rule) => isOption(FOOD_RULE_OPTIONS, rule)),
    dislikes: [...(source?.food_dislikes ?? [])],
    meals: onboardingMeals(source?.meals_per_day ?? 3),
    foodSource: source?.food_source ?? null,
    nutritionFocus: source?.nutrition_focus ?? null,
  };
}

/** The setup's steps, in order. Only the diet must be answered; the rest may be left as they are. */
export const SETUP_STEPS = [
  { id: "diet", title: "How you eat" },
  { id: "avoid", title: "Anything to avoid" },
  { id: "routine", title: "Your meals" },
  { id: "goal", title: "Nutrition goal" },
] as const;
export type SetupStep = (typeof SETUP_STEPS)[number]["id"];

export function setupProblem(step: SetupStep, answers: NutritionSetupAnswers): string | null {
  if (step === "diet" && (!answers.diet || !isOption(DIET_OPTIONS, answers.diet))) return "Choose the option closest to how you eat.";
  if (step === "routine" && (!Number.isInteger(answers.meals) || answers.meals < 2 || answers.meals > 5)) return "Choose how many meals you have.";
  if (step === "routine" && answers.foodSource !== null && !isOption(FOOD_SOURCE_OPTIONS, answers.foodSource)) return "Choose where your food comes from.";
  if (step === "goal" && answers.nutritionFocus !== null && !isOption(NUTRITION_FOCUS_OPTIONS, answers.nutritionFocus)) return "Choose a nutrition goal.";
  return null;
}

/** Every step's problem, the first one first; null when the answers can be saved. */
export function firstSetupProblem(answers: NutritionSetupAnswers): { step: SetupStep; message: string } | null {
  for (const { id } of SETUP_STEPS) {
    const message = setupProblem(id, answers);
    if (message) return { step: id, message };
  }
  return null;
}

/** Adds a typed word (an allergy or a dislike) the way onboarding did, within its limits. */
export function addTag(list: readonly string[], draft: string, kind: "allergy" | "dislike"): string[] {
  return commitDraft(list, draft, kind === "dislike" ? { max: MAX_FOOD_DISLIKES } : {});
}

/**
 * Where the focus goes when an allergy or dislike is removed with its own Remove, which goes with it (D5): the next
 * entry's Remove (its place in the list as it was), else the one before, else "add", the list's Add button (a button,
 * so a phone's keyboard doesn't open).
 */
export function tagFocusAfterRemoving(values: readonly string[], removed: string): number | "add" {
  const at = values.indexOf(removed);
  if (at < 0) return "add";
  if (at + 1 < values.length) return at + 1;
  return at > 0 ? at - 1 : "add";
}

/**
 * The preference columns the answers write. `legacyDiet` is the stored dietary_preferences, kept in step with
 * the diet (its other entries stay). `at` is the setup time, sent only when the column exists.
 */
export function setupPatch(answers: NutritionSetupAnswers, { legacyDiet = [], at = null }: { legacyDiet?: readonly string[]; at?: string | null } = {}): Record<string, unknown> {
  const diet = answers.diet ? { diet_type: answers.diet, dietary_preferences: legacyDietaryPreferences(answers.diet, legacyDiet) } : {};
  return {
    ...diet,
    allergies: joinKnown(answers.allergies.filter((key) => isOption(ALLERGY_OPTIONS, key)), answers.customAllergies),
    food_rules: answers.foodRules.filter((rule) => isOption(FOOD_RULE_OPTIONS, rule)),
    food_dislikes: commitDraft(answers.dislikes, "", { max: MAX_FOOD_DISLIKES }),
    meals_per_day: onboardingMeals(answers.meals),
    food_source: answers.foodSource,
    nutrition_focus: answers.nutritionFocus,
    ...(at ? { [NUTRITION_SETUP_COLUMN]: at } : {}),
  };
}

export type SetupState = {
  /** True when the member has answered (the timestamp is set, or a diet is stored). */
  done: boolean;
  /** When setup was finished; null when not, or before the migration. */
  setupAt: string | null;
  /** Whether the nutrition_setup_at column exists in this database. */
  stamped: boolean;
};

/** Setup is done when its time is set or a diet is stored (diet_type, or the first onboarding's label). */
export function setupDone(row: { nutrition_setup_at?: unknown; diet_type?: unknown; dietary_preferences?: unknown } | null | undefined): boolean {
  if (!row) return false;
  if (typeof row.nutrition_setup_at === "string" && row.nutrition_setup_at) return true;
  return normalizeDietType(row.diet_type, row.dietary_preferences) !== null;
}

type Db = SupabaseClient;

/**
 * Reads whether setup is done. Columns of a migration that is not in the database are left out (diet_type needs
 * profile v2, nutrition_setup_at this job's migration). A member without a preferences row has not answered.
 * Throws when the row cannot be read for another reason, so the page never asks again by mistake.
 */
export async function loadSetupState(db: Db, userId: string): Promise<SetupState> {
  const tiers = [["diet_type"], [NUTRITION_SETUP_COLUMN]] as const;
  const { result, kept } = await withColumnTiers(tiers, (count) => db.from("user_preferences")
    .select(["dietary_preferences", ...tiers.slice(0, count).flat()].join(",")).eq("user_id", userId).maybeSingle());
  if (result.error) throw result.error;
  const row = (result.data ?? null) as Record<string, unknown> | null;
  const setupAt = typeof row?.[NUTRITION_SETUP_COLUMN] === "string" ? (row[NUTRITION_SETUP_COLUMN] as string) : null;
  return { done: setupDone(row), setupAt, stamped: kept >= 2 };
}

/**
 * Saves the answers. The timestamp goes with them while the column exists; when the database reports it missing,
 * the answers are saved again without it (the stored diet then marks setup as done). Columns of an older missing
 * migration are dropped by savePreferences and listed in `skipped`.
 */
export async function saveSetup(
  db: Db,
  userId: string,
  answers: NutritionSetupAnswers,
  { schema, legacyDiet = [], now = new Date() }: { schema: { preferencesV2: boolean; onboardingV3: boolean }; legacyDiet?: readonly string[]; now?: Date },
): Promise<{ error: unknown; skipped: string[]; stamped: boolean }> {
  const options = { v2: schema.preferencesV2, v3: schema.onboardingV3 };
  const first = await savePreferences(db, userId, setupPatch(answers, { legacyDiet, at: now.toISOString() }), options);
  if (!first.error) return { error: null, skipped: first.skipped, stamped: true };
  if (!isMissingColumnError(first.error, [NUTRITION_SETUP_COLUMN])) return { error: first.error, skipped: first.skipped, stamped: false };
  const second = await savePreferences(db, userId, setupPatch(answers, { legacyDiet }), options);
  return { error: second.error, skipped: second.skipped, stamped: false };
}

/** Whether a "Later" saved on `snoozedOn` (YYYY-MM-DD) still holds on `today`. */
export function snoozed(snoozedOn: string | null, today: string): boolean {
  if (!snoozedOn || !/^\d{4}-\d{2}-\d{2}$/.test(snoozedOn) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return false;
  const days = (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${snoozedOn}T12:00:00Z`)) / 86_400_000;
  return days >= 0 && days < SNOOZE_DAYS;
}

/** The device's "Later" (per member), or null. Storage that throws (private mode) counts as none. */
export function readSnooze(userId: string): string | null {
  try {
    const raw = window.localStorage.getItem(SNOOZE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    const value = parsed?.[userId];
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

export function writeSnooze(userId: string, today: string | null): void {
  try {
    const raw = window.localStorage.getItem(SNOOZE_KEY);
    const parsed = (raw ? JSON.parse(raw) : {}) as Record<string, string>;
    if (today) parsed[userId] = today; else delete parsed[userId];
    window.localStorage.setItem(SNOOZE_KEY, JSON.stringify(parsed));
  } catch {
    // No device storage: "Later" holds for this page only.
  }
}
