import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingFunctionError } from "@/lib/supabase/errors";
import { equipmentFor, loadEquipmentProfiles } from "@/lib/training/data";
import { isWorkoutSetupDone } from "@/lib/training/setup";
import { localDateKey } from "./dates";
import { calculateNutritionTargets, type NutritionTargets } from "./nutrition";
import {
  ACTIVITY_OPTIONS,
  BUDGET_LEVEL_OPTIONS,
  CUISINE_OPTIONS,
  DEFAULT_ACTIVITY,
  DEFAULT_DAYS_PER_WEEK,
  DEFAULT_EXPERIENCE,
  DEFAULT_GOAL,
  DEFAULT_HEIGHT_UNIT,
  DEFAULT_LOCATION,
  DEFAULT_MEALS_PER_DAY,
  DEFAULT_SESSION_MINUTES,
  DEFAULT_SPLIT,
  DEFAULT_WATER_ML,
  DEFAULT_WEIGHT_UNIT,
  EXPERIENCE_OPTIONS,
  GOAL_OPTIONS,
  HEIGHT_UNIT_OPTIONS,
  LOCATION_OPTIONS,
  FOOD_SOURCE_OPTIONS,
  MAX_FOOD_DISLIKES,
  NUTRITION_FOCUS_OPTIONS,
  SEX_OPTIONS,
  ageFromBirthDate,
  SPLIT_OPTIONS,
  WEIGHT_UNIT_OPTIONS,
  isOption,
  joinKnown,
  joinLimitations,
  normalizeDietType,
  normalizeEquipment,
  normalizeFoodRules,
  normalizeBirthDate,
  normalizeTags,
  splitAllergies,
  splitLimitations,
  type ActivityLevel,
  type BudgetLevel,
  type Cuisine,
  type DietType,
  type Experience,
  type FoodRule,
  type FoodSource,
  type Goal,
  type HeightUnit,
  type NutritionFocus,
  type Option,
  type Sex,
  type TrainingLocation,
  type WeightUnit,
  type WorkoutSplit,
} from "./profile-options";
import { isMissingColumnError, missingColumnFromError, omitColumns } from "./schema-fallback";

/**
 * Everything FITX knows about the signed-in person, loaded once and shared: the profile row, training
 * and food preferences, the latest weigh-in, and the daily targets calculated from them. Used by the
 * UserContextProvider, onboarding, Profile and Progress; the AI coach can call loadUserContext with a
 * server client. Reads and writes go through the user's own session, so row-level security applies.
 */

export const PROFILE_COLUMNS = ["name", "age", "gender", "height", "weight", "target_weight", "avatar", "onboarded", "created_at", "updated_at"] as const;

export const PREFERENCE_COLUMNS = [
  "workout_location", "equipment", "fitness_level", "primary_goal", "workouts_per_week", "session_duration_minutes",
  "workout_split", "activity_level", "dietary_preferences", "allergies", "meals_per_day", "timezone", "daily_water_goal_ml",
] as const;

/** Columns added by migration 20261118110000_fitx_profile_v2; the app works without them. */
export const PREFERENCE_COLUMNS_V2 = [
  "diet_type", "food_rules", "cuisines", "food_dislikes", "food_budget_level", "monthly_food_budget_inr",
  "limitations", "height_unit", "weight_unit",
] as const;

export type PreferenceColumnV2 = (typeof PREFERENCE_COLUMNS_V2)[number];

/** Columns added by migration 20261120100000_fitx_onboarding_v3; the app works without them. */
export const PROFILE_COLUMNS_V3 = ["date_of_birth"] as const;
export const PREFERENCE_COLUMNS_V3 = ["food_source", "nutrition_focus"] as const;
export type PreferenceColumnV3 = (typeof PREFERENCE_COLUMNS_V3)[number];
/** Added by migration 20261123100020_fitx_workout_setup; read only (the Workouts setup writes it, training/setup.ts). */
export const PREFERENCE_COLUMNS_V4 = ["workout_setup_at"] as const;
/** Added by migration 20261123100040_fitx_nutrition_v2; read only (the Nutrition setup writes it, food/setup.ts). */
export const PREFERENCE_COLUMNS_V5 = ["nutrition_setup_at"] as const;
export type OptionalPreferenceColumn = PreferenceColumnV2 | PreferenceColumnV3;

/**
 * Runs a request with tiers of optional columns (oldest migration first; a later tier needs every earlier one).
 * `run(kept)` builds the request with the first `kept` tiers. When the database reports a column of tier i as
 * missing, it runs again with the first i tiers; any other error is returned as it is.
 */
export async function withColumnTiers<R extends { error: unknown }>(
  tiers: readonly (readonly string[])[],
  run: (kept: number) => PromiseLike<R>,
  start: number = tiers.length,
): Promise<{ result: R; kept: number }> {
  let kept = Math.max(0, Math.min(start, tiers.length));
  for (;;) {
    const result = await run(kept);
    if (!result.error || kept === 0 || !isMissingColumnError(result.error, tiers.slice(0, kept).flat())) return { result, kept };
    const column = missingColumnFromError(result.error)?.column?.toLowerCase();
    const tier = column ? tiers.findIndex((list) => list.some((name) => name.toLowerCase() === column)) : -1;
    kept = tier >= 0 && tier < kept ? tier : kept - 1;
  }
}

/** Dispatched on window after a save, so the provider (header, targets) reloads. */
export const USER_CONTEXT_EVENT = "fitx:user-context-changed";

export type ProfileValues = {
  name: string;
  /** From the birth date when there is one (so it is always current), else as stored. */
  age: number | null;
  /** YYYY-MM-DD, or null when not given (or before the onboarding v3 migration). */
  date_of_birth: string | null;
  gender: Sex | null;
  height: number | null;
  weight: number | null;
  target_weight: number | null;
  avatar: string | null;
  onboarded: boolean;
  created_at: string | null;
  updated_at: string | null;
};

export type PreferenceValues = {
  workout_location: TrainingLocation;
  /** Training-taxonomy keys from the original equipment answer (it seeds the Home list until one is saved). */
  equipment: string[];
  fitness_level: Experience;
  primary_goal: Goal;
  workouts_per_week: number;
  session_duration_minutes: number;
  workout_split: WorkoutSplit;
  activity_level: ActivityLevel;
  diet_type: DietType | null;
  /** Allergy keys first, then the user's own entries. */
  allergies: string[];
  meals_per_day: number;
  daily_water_goal_ml: number;
  /** Where meals mostly come from; null until answered (or before the onboarding v3 migration). */
  food_source: FoodSource | null;
  /** The nutrition goal; null until answered (or before the onboarding v3 migration). */
  nutrition_focus: NutritionFocus | null;
  food_rules: FoodRule[];
  cuisines: Cuisine[];
  food_dislikes: string[];
  food_budget_level: BudgetLevel | null;
  monthly_food_budget_inr: number | null;
  /** Limitation keys first, then the user's own entries. */
  limitations: string[];
  height_unit: HeightUnit;
  weight_unit: WeightUnit;
  timezone: string;
};

export type WeighIn = { weight: number; date: string };

export type UserContextData = {
  userId: string;
  email: string | null;
  /** null when the profile row is missing (see ensureProfileRow). */
  profile: ProfileValues | null;
  preferences: PreferenceValues;
  /** False until a user_preferences row exists (the values above are then defaults). */
  hasPreferences: boolean;
  /** When the Workouts setup was last saved (user_preferences.workout_setup_at); null when not, or before its migration. */
  workoutSetupAt: string | null;
  /** When the Nutrition setup was answered (user_preferences.nutrition_setup_at); null when not, or before its migration. */
  nutritionSetupAt: string | null;
  /** Stored values that are not part of the vocabulary, kept so screens can mention them. */
  legacy: { dietaryPreferences: string[]; unknownEquipment: string[] };
  /** Home and Gym equipment as Workouts sees it. */
  equipmentLists: EquipmentLists;
  latestWeighIn: WeighIn | null;
  /** The latest weigh-in, or the profile weight when nothing has been logged. */
  currentWeightKg: number | null;
  targets: NutritionTargets | null;
  /** Whether the profile v2 and onboarding v3 migrations are in the database. */
  schema: { preferencesV2: boolean; onboardingV3: boolean };
};

export type LoadPart = "profile" | "preferences" | "weigh_in" | "equipment";

/** The Home and Gym equipment lists Workouts uses (user_equipment_profiles), with their starting points. */
export type EquipmentLists = {
  /** False until the equipment-lists migration exists; until then only the original answer can be saved. */
  available: boolean;
  home: { keys: string[]; saved: boolean };
  gym: { keys: string[]; saved: boolean };
};
export type LoadResult = { data: UserContextData; error: null } | { data: null; error: { part: LoadPart; cause: unknown } };

type Row = Record<string, unknown>;

const numberOrNull = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const stringList = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

const pick = <V extends string>(options: readonly Option<V>[], value: unknown, fallback: V): V => (isOption(options, value) ? value : fallback);

const pickOrNull = <V extends string>(options: readonly Option<V>[], value: unknown): V | null => (isOption(options, value) ? value : null);

export function normalizeProfile(row: Row | null | undefined, today: Date = new Date()): ProfileValues | null {
  if (!row) return null;
  const birthDate = normalizeBirthDate(row.date_of_birth);
  const birthAge = ageFromBirthDate(birthDate, today);
  return {
    name: typeof row.name === "string" ? row.name : "",
    age: birthAge ?? numberOrNull(row.age),
    date_of_birth: birthDate,
    gender: pickOrNull(SEX_OPTIONS, row.gender),
    height: numberOrNull(row.height),
    weight: numberOrNull(row.weight),
    target_weight: numberOrNull(row.target_weight),
    avatar: typeof row.avatar === "string" && row.avatar ? row.avatar : null,
    onboarded: row.onboarded === true,
    created_at: typeof row.created_at === "string" ? row.created_at : null,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

/** Preference values with the vocabulary's defaults for anything missing or unknown. */
export function normalizePreferences(row: Row | null | undefined): { values: PreferenceValues; legacy: UserContextData["legacy"] } {
  const source = row ?? {};
  const equipment = normalizeEquipment(source.equipment ?? []);
  const allergies = splitAllergies(source.allergies);
  const limitations = splitLimitations(source.limitations);
  const legacyDiet = stringList(source.dietary_preferences);
  const between = (value: unknown, min: number, max: number, fallback: number) => {
    const number = numberOrNull(value);
    return number !== null && number >= min && number <= max ? Math.round(number) : fallback;
  };
  const budget = numberOrNull(source.monthly_food_budget_inr);
  return {
    values: {
      workout_location: pick(LOCATION_OPTIONS, source.workout_location, DEFAULT_LOCATION),
      equipment: equipment.keys,
      fitness_level: pick(EXPERIENCE_OPTIONS, source.fitness_level, DEFAULT_EXPERIENCE),
      primary_goal: pick(GOAL_OPTIONS, source.primary_goal, DEFAULT_GOAL),
      workouts_per_week: between(source.workouts_per_week, 1, 7, DEFAULT_DAYS_PER_WEEK),
      session_duration_minutes: between(source.session_duration_minutes, 15, 180, DEFAULT_SESSION_MINUTES),
      workout_split: pick(SPLIT_OPTIONS, source.workout_split, DEFAULT_SPLIT),
      activity_level: pick(ACTIVITY_OPTIONS, source.activity_level, DEFAULT_ACTIVITY),
      diet_type: normalizeDietType(source.diet_type, legacyDiet),
      allergies: joinKnown(allergies.keys, allergies.custom),
      meals_per_day: between(source.meals_per_day, 1, 8, DEFAULT_MEALS_PER_DAY),
      daily_water_goal_ml: between(source.daily_water_goal_ml, 250, 10000, DEFAULT_WATER_ML),
      food_source: pickOrNull(FOOD_SOURCE_OPTIONS, source.food_source),
      nutrition_focus: pickOrNull(NUTRITION_FOCUS_OPTIONS, source.nutrition_focus),
      food_rules: normalizeFoodRules(source.food_rules, source.food_rules === undefined ? legacyDiet : []),
      cuisines: stringList(source.cuisines).filter((value): value is Cuisine => isOption(CUISINE_OPTIONS, value)),
      food_dislikes: normalizeTags(source.food_dislikes, { max: MAX_FOOD_DISLIKES }),
      food_budget_level: pickOrNull(BUDGET_LEVEL_OPTIONS, source.food_budget_level),
      monthly_food_budget_inr: budget !== null && budget >= 500 && budget <= 500000 ? Math.round(budget) : null,
      limitations: joinLimitations(limitations.keys, limitations.custom),
      height_unit: pick(HEIGHT_UNIT_OPTIONS, source.height_unit, DEFAULT_HEIGHT_UNIT),
      weight_unit: pick(WEIGHT_UNIT_OPTIONS, source.weight_unit, DEFAULT_WEIGHT_UNIT),
      timezone: typeof source.timezone === "string" && source.timezone ? source.timezone : "UTC",
    },
    legacy: { dietaryPreferences: legacyDiet, unknownEquipment: equipment.unknown },
  };
}

/**
 * Daily targets from the profile, the latest weight, the goal and the nutrition goal ("High protein" raises protein
 * to the top of the goal's range); null until the body details exist. Home, Nutrition, onboarding, Profile and the
 * AI coach all work their targets out this way, so they agree.
 */
export function targetsFor(profile: ProfileValues | null, preferences: PreferenceValues, weightKg: number | null) {
  if (!profile) return null;
  return calculateNutritionTargets(
    { age: profile.age, gender: profile.gender, height: profile.height, weight: weightKg },
    preferences.activity_level,
    preferences.primary_goal,
    preferences.nutrition_focus,
  );
}

export async function loadUserContext(supabase: SupabaseClient, user: { id: string; email?: string | null }): Promise<LoadResult> {
  const preferenceTiers = [PREFERENCE_COLUMNS_V2, PREFERENCE_COLUMNS_V3, PREFERENCE_COLUMNS_V4, PREFERENCE_COLUMNS_V5] as const;
  const [profileOutcome, preferenceOutcome, weighInResult, equipmentResult] = await Promise.all([
    withColumnTiers([PROFILE_COLUMNS_V3], (kept) =>
      supabase.from("profiles").select([...PROFILE_COLUMNS, ...(kept ? PROFILE_COLUMNS_V3 : [])].join(",")).eq("id", user.id).maybeSingle(),
    ),
    withColumnTiers(preferenceTiers, (kept) =>
      supabase
        .from("user_preferences")
        .select([...PREFERENCE_COLUMNS, ...preferenceTiers.slice(0, kept).flat()].join(","))
        .eq("user_id", user.id)
        .maybeSingle(),
    ),
    supabase
      .from("body_metrics")
      .select("date,weight")
      .eq("user_id", user.id)
      .not("weight", "is", null)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    loadEquipmentProfiles(supabase, user.id),
  ]);
  const profileResult = profileOutcome.result;
  if (profileResult.error) return { data: null, error: { part: "profile", cause: profileResult.error } };
  const preferenceResult = preferenceOutcome.result;
  if (preferenceResult.error) return { data: null, error: { part: "preferences", cause: preferenceResult.error } };
  if (weighInResult.error) return { data: null, error: { part: "weigh_in", cause: weighInResult.error } };
  // A failed read must not look like "no lists yet": Profile would then save to the wrong place.
  if (equipmentResult.error) return { data: null, error: { part: "equipment", cause: equipmentResult.error } };

  const profile = normalizeProfile(profileResult.data as Row | null);
  const { values: preferences, legacy } = normalizePreferences(preferenceResult.data as Row | null);
  const weighInRow = weighInResult.data as Row | null;
  const loggedWeight = numberOrNull(weighInRow?.weight);
  const latestWeighIn = loggedWeight !== null && typeof weighInRow?.date === "string" ? { weight: loggedWeight, date: weighInRow.date } : null;
  const currentWeightKg = latestWeighIn?.weight ?? profile?.weight ?? null;
  const profiles = equipmentResult.profiles;
  const preferenceRow = preferenceResult.data as unknown as Row | null;
  const legacyWords = Array.isArray(preferenceRow?.equipment) ? (preferenceRow.equipment as unknown[]).filter((item): item is string => typeof item === "string") : null;
  const equipmentLists: EquipmentLists = {
    available: profiles.available,
    home: equipmentFor(profiles, "home", legacyWords),
    gym: equipmentFor(profiles, "gym", legacyWords),
  };
  return {
    data: {
      userId: user.id,
      email: user.email ?? null,
      profile,
      preferences,
      hasPreferences: Boolean(preferenceResult.data),
      workoutSetupAt: typeof preferenceRow?.workout_setup_at === "string" && preferenceRow.workout_setup_at ? preferenceRow.workout_setup_at : null,
      nutritionSetupAt: typeof preferenceRow?.nutrition_setup_at === "string" && preferenceRow.nutrition_setup_at ? preferenceRow.nutrition_setup_at : null,
      legacy,
      equipmentLists,
      latestWeighIn,
      currentWeightKg,
      targets: targetsFor(profile, preferences, currentWeightKg),
      schema: { preferencesV2: preferenceOutcome.kept >= 1, onboardingV3: preferenceOutcome.kept >= 2 && profileOutcome.kept >= 1 },
    },
    error: null,
  };
}

// ─── Writing ─────────────────────────────────────────────────────────────────────────────────────

type WriteError = { code?: string; message?: string } | null;

/**
 * Creates the signed-in user's profile row when it is missing. Inserts into profiles are server-only
 * once the privileges migration is in, so this asks the fitx_ensure_profile() database function; before
 * that function exists it tries the insert the old policy allowed.
 */
export async function ensureProfileRow(supabase: SupabaseClient, userId: string): Promise<{ error: WriteError }> {
  const rpc = await supabase.rpc("fitx_ensure_profile");
  if (!rpc.error) return { error: null };
  if (!isMissingFunctionError(rpc.error)) return { error: rpc.error };
  const insert = await supabase.from("profiles").upsert({ id: userId }, { onConflict: "id", ignoreDuplicates: true });
  return { error: insert.error };
}

/** Updates the user's profile row, creating it first if it turns out to be missing. */
/**
 * The member's birth date (YYYY-MM-DD), or null when none is set, the column is not there yet (before
 * migration #41) or the read fails; callers then keep the stored age.
 */
export async function loadBirthDate(supabase: SupabaseClient, userId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.from("profiles").select("date_of_birth").eq("id", userId).maybeSingle();
    return error ? null : normalizeBirthDate((data as Row | null)?.date_of_birth);
  } catch {
    return null;
  }
}

/**
 * The member's nutrition goal ("high_protein", "balanced" or "none"), or null when none is set, the column is not
 * there yet (before migration #41) or the read fails; the targets are then the standard ones.
 */
export async function loadNutritionFocus(supabase: SupabaseClient, userId: string): Promise<NutritionFocus | null> {
  try {
    const { data, error } = await supabase.from("user_preferences").select("nutrition_focus").eq("user_id", userId).maybeSingle();
    return error ? null : pickOrNull(NUTRITION_FOCUS_OPTIONS, (data as Row | null)?.nutrition_focus);
  } catch {
    return null;
  }
}

export async function updateProfileRow(supabase: SupabaseClient, userId: string, patch: Row): Promise<{ error: WriteError }> {
  const payload = { ...patch, updated_at: new Date().toISOString() };
  const first = await supabase.from("profiles").update(payload).eq("id", userId).select("id");
  if (first.error) return { error: first.error };
  if (Array.isArray(first.data) && first.data.length > 0) return { error: null };
  const ensured = await ensureProfileRow(supabase, userId);
  if (ensured.error) return ensured;
  const second = await supabase.from("profiles").update(payload).eq("id", userId).select("id");
  if (second.error) return { error: second.error };
  return Array.isArray(second.data) && second.data.length > 0 ? { error: null } : { error: { code: "profile_missing", message: "The profile row could not be created." } };
}

/**
 * Saves preference columns (only those in `patch`). Columns of a migration that is not in the database yet
 * (v2 without `v2`, v3 without `v3`, or reported missing) are left out and listed in `skipped`, so the
 * screen can say they will save after FITX's next update.
 */
export async function savePreferences(
  supabase: SupabaseClient,
  userId: string,
  patch: Row,
  { v2, v3 = false }: { v2: boolean; v3?: boolean },
): Promise<{ error: WriteError; skipped: OptionalPreferenceColumn[] }> {
  const tiers = [PREFERENCE_COLUMNS_V2, PREFERENCE_COLUMNS_V3] as const;
  const row = { ...patch, user_id: userId, updated_at: new Date().toISOString() };
  const outcome = await withColumnTiers(
    tiers,
    (kept) => supabase.from("user_preferences").upsert(omitColumns(row, tiers.slice(kept).flat()), { onConflict: "user_id" }),
    !v2 ? 0 : v3 ? 2 : 1,
  );
  const skipped = tiers.slice(outcome.kept).flat().filter((column) => column in patch);
  return { error: outcome.result.error as WriteError, skipped };
}

/**
 * Whether experience, where the member trains and their days a week are their own answers: the Workouts setup is
 * done (training/setup isWorkoutSetupDone). Until then user_preferences holds only the column defaults, which
 * Profile shows as "Not set".
 */
export function trainingAnswersKnown(data: Pick<UserContextData, "workoutSetupAt" | "equipmentLists">): boolean {
  return isWorkoutSetupDone({ setupAt: data.workoutSetupAt, hasEquipmentList: data.equipmentLists.home.saved || data.equipmentLists.gym.saved });
}

/** The columns a Profile > Training save records as answered when the Workouts setup has not been done yet. */
export function trainingAnswerPatch(draft: { location: string; experience: string; days: number }): Row {
  return { workout_location: draft.location, fitness_level: draft.experience, workouts_per_week: draft.days };
}

/**
 * Records that the member answered the setup's questions (user_preferences.workout_setup_at). Before migration
 * 20261123100020 the column is missing and nothing is stored; the setup then counts as done once a list is saved.
 */
export async function markWorkoutSetupAnswered(supabase: SupabaseClient, userId: string, now = new Date()): Promise<{ error: WriteError; stored: boolean }> {
  const result = await supabase.from("user_preferences").update({ workout_setup_at: now.toISOString() }).eq("user_id", userId);
  if (result.error && isMissingColumnError(result.error, PREFERENCE_COLUMNS_V4)) return { error: null, stored: false };
  return { error: result.error as WriteError, stored: !result.error };
}

/**
 * Records that the member answered the Nutrition setup's questions (user_preferences.nutrition_setup_at), as the
 * setup itself does: a Profile > Food save answers them too. Before migration 20261123100040 the column is missing and
 * nothing is stored; the stored diet then marks the setup as done (lib/food/setup.ts setupDone).
 */
export async function markNutritionSetupAnswered(supabase: SupabaseClient, userId: string, now = new Date()): Promise<{ error: WriteError; stored: boolean }> {
  const result = await supabase.from("user_preferences").update({ nutrition_setup_at: now.toISOString() }).eq("user_id", userId);
  if (result.error && isMissingColumnError(result.error, PREFERENCE_COLUMNS_V5)) return { error: null, stored: false };
  return { error: result.error as WriteError, stored: !result.error };
}

/** Keeps profiles.weight equal to the latest weigh-in, so every screen calculates from the same weight. */
export async function syncProfileWeight(supabase: SupabaseClient, userId: string, weightKg: number): Promise<{ error: WriteError }> {
  const result = await supabase.from("profiles").update({ weight: weightKg, updated_at: new Date().toISOString() }).eq("id", userId);
  return { error: result.error };
}

/** Logs today's weigh-in (local date) and brings profiles.weight up to date. */
export async function logWeighIn(
  supabase: SupabaseClient,
  userId: string,
  weightKg: number,
  note: string,
): Promise<{ error: WriteError; synced: boolean }> {
  const inserted = await supabase.from("body_metrics").insert({ user_id: userId, date: localDateKey(), weight: weightKg, note });
  if (inserted.error) return { error: inserted.error, synced: false };
  const synced = await syncProfileWeight(supabase, userId, weightKg);
  return { error: null, synced: !synced.error };
}

// ─── Comparing ───────────────────────────────────────────────────────────────────────────────────

const SET_LIKE = new Set(["equipment", "allergies", "food_rules", "cuisines", "food_dislikes", "limitations"]);

function sameValue(key: string, a: unknown, b: unknown) {
  if (Array.isArray(a) || Array.isArray(b)) {
    const left = (Array.isArray(a) ? a : []).map(String);
    const right = (Array.isArray(b) ? b : []).map(String);
    if (left.length !== right.length) return false;
    if (SET_LIKE.has(key)) {
      const lower = (list: string[]) => list.map((item) => item.toLowerCase()).sort();
      const [x, y] = [lower(left), lower(right)];
      return x.every((item, index) => item === y[index]);
    }
    return left.every((item, index) => item === right[index]);
  }
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9;
  return (a ?? null) === (b ?? null);
}

/** Only the fields whose value changed, ready to send as a patch. */
export function changedFields<T extends Record<string, unknown>>(original: T, edited: T, keys: readonly (keyof T & string)[] = Object.keys(edited)): Partial<T> {
  const patch: Partial<T> = {};
  for (const key of keys) {
    if (!sameValue(key, original[key], edited[key])) patch[key] = edited[key];
  }
  return patch;
}

/** Tells the UserContextProvider (and anything else listening) to reload. */
export function notifyUserContextChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(USER_CONTEXT_EVENT));
}
