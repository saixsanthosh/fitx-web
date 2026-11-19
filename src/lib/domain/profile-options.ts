/**
 * One vocabulary for everything a user tells FITX about themselves: onboarding, Profile, Settings, the
 * workout generator, nutrition targets and the AI coach all read values and labels from here, so the
 * same stored value never shows two different names.
 *
 * Values are what the database stores (snake_case keys); labels are what people read. Equipment comes
 * from the training taxonomy, so Profile, onboarding and Workouts edit the same keys.
 *
 * Its only imports are the import-free training taxonomy helpers, so it runs under `node --test`.
 */

import { equipmentKeyFor, sortEquipmentKeys } from "@/lib/training/equipment";

export type Option<V extends string = string> = { readonly value: V; readonly label: string; readonly hint?: string };

const values = <V extends string>(options: readonly Option<V>[]) => options.map((option) => option.value);

/** The label for a stored value, or null when the value is not in the list. */
export function optionLabel<V extends string>(options: readonly Option<V>[], value: string | null | undefined): string | null {
  return options.find((option) => option.value === value)?.label ?? null;
}

export function isOption<V extends string>(options: readonly Option<V>[], value: unknown): value is V {
  return typeof value === "string" && options.some((option) => option.value === value);
}

// ─── Goals and activity ──────────────────────────────────────────────────────────────────────────

export const GOAL_OPTIONS = [
  { value: "muscle_gain", label: "Muscle gain", hint: "Build muscle with a small calorie surplus" },
  { value: "weight_gain", label: "Weight gain", hint: "Gain weight steadily with a larger surplus" },
  { value: "fat_loss", label: "Fat loss", hint: "Lose fat and keep muscle, with more protein" },
  { value: "weight_loss", label: "Weight loss", hint: "Bring your weight down at a steady pace" },
  { value: "general_fitness", label: "General fitness", hint: "Feel fitter, stronger and healthier" },
  { value: "strength", label: "Strength", hint: "Lift heavier with focused training" },
  { value: "endurance", label: "Endurance", hint: "Go longer in cardio and sport" },
  { value: "maintain_weight", label: "Maintain weight", hint: "Keep your weight steady" },
] as const satisfies readonly Option[];
export type Goal = (typeof GOAL_OPTIONS)[number]["value"];
export const GOALS: readonly Goal[] = values(GOAL_OPTIONS);
/** Goals the database accepted before migration 20261118110000 widened its check. */
export const GOALS_BEFORE_PROFILE_V2: readonly Goal[] = ["muscle_gain", "fat_loss", "strength", "general_fitness", "endurance"];
/** Goals the database accepted before migration 20261120100000 (onboarding v3) added maintain_weight. */
export const GOALS_BEFORE_ONBOARDING_V3: readonly Goal[] = ["muscle_gain", "weight_gain", "fat_loss", "weight_loss", "general_fitness", "strength", "endurance"];
export const DEFAULT_GOAL: Goal = "general_fitness";
/** The five goals setup offers, in the owner's order (Profile offers every goal). */
export const ONBOARDING_GOALS: readonly Goal[] = ["muscle_gain", "weight_loss", "strength", "general_fitness", "maintain_weight"];

export const ACTIVITY_OPTIONS = [
  { value: "sedentary", label: "Mostly sitting", hint: "Desk work and little walking" },
  { value: "light", label: "Lightly active", hint: "Some walking or light exercise 1–3 days a week" },
  { value: "moderate", label: "Moderately active", hint: "On your feet a lot, or exercise 3–5 days a week" },
  { value: "active", label: "Very active", hint: "Hard exercise 6–7 days a week or a physical job" },
  { value: "very_active", label: "Extremely active", hint: "A physical job and daily hard training" },
] as const satisfies readonly Option[];
export type ActivityLevel = (typeof ACTIVITY_OPTIONS)[number]["value"];
export const DEFAULT_ACTIVITY: ActivityLevel = "moderate";

/** Mifflin-St Jeor activity multipliers, keyed by ACTIVITY_OPTIONS values. */
export const ACTIVITY_MULTIPLIERS: Readonly<Record<ActivityLevel, number>> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

export const SEX_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Prefer not to say", hint: "FITX uses the average of the two formulas" },
] as const satisfies readonly Option[];
export type Sex = (typeof SEX_OPTIONS)[number]["value"];

/**
 * Setup asks activity in three bands. Each band saves one of the five levels above, and a stored level shows
 * as its band: Low covers sitting and light activity, High covers very and extremely active.
 */
export const ACTIVITY_BAND_OPTIONS = [
  { value: "low", label: "Low", hint: "Mostly sitting" },
  { value: "moderate", label: "Moderate", hint: "On your feet, some exercise" },
  { value: "high", label: "High", hint: "Hard training or a physical job" },
] as const satisfies readonly Option[];
export type ActivityBand = (typeof ACTIVITY_BAND_OPTIONS)[number]["value"];
const BAND_LEVEL: Readonly<Record<ActivityBand, ActivityLevel>> = { low: "sedentary", moderate: "moderate", high: "active" };

export function activityBand(level: ActivityLevel): ActivityBand {
  return level === "sedentary" || level === "light" ? "low" : level === "moderate" ? "moderate" : "high";
}

/** The level a band saves; a level already in that band is kept, so a stored "light" stays "light". */
export function activityForBand(band: ActivityBand, current: ActivityLevel): ActivityLevel {
  return activityBand(current) === band ? current : BAND_LEVEL[band];
}

// ─── Training ────────────────────────────────────────────────────────────────────────────────────

export const LOCATION_OPTIONS = [
  { value: "gym", label: "Gym" },
  { value: "home", label: "Home" },
  { value: "both", label: "Gym and home" },
  { value: "outdoor", label: "Outdoors" },
] as const satisfies readonly Option[];
export type TrainingLocation = (typeof LOCATION_OPTIONS)[number]["value"];
export const DEFAULT_LOCATION: TrainingLocation = "gym";
/** The three places setup offers, labelled as the owner wrote them. */
export const ONBOARDING_LOCATION_OPTIONS = [
  { value: "gym", label: "Gym" },
  { value: "home", label: "Home" },
  { value: "both", label: "Both" },
] as const satisfies readonly Option<TrainingLocation>[];

export const EXPERIENCE_OPTIONS = [
  { value: "beginner", label: "Beginner", hint: "New, or back after a long break" },
  { value: "intermediate", label: "Intermediate", hint: "Training regularly for 6 months or more" },
  { value: "advanced", label: "Advanced", hint: "Years of consistent, structured training" },
] as const satisfies readonly Option[];
export type Experience = (typeof EXPERIENCE_OPTIONS)[number]["value"];
export const DEFAULT_EXPERIENCE: Experience = "beginner";

export const SPLIT_OPTIONS = [
  { value: "full_body", label: "Full body", hint: "Every session trains the whole body" },
  { value: "upper_lower", label: "Upper / lower", hint: "Alternate upper-body and leg days" },
  { value: "push_pull_legs", label: "Push / pull / legs", hint: "Three rotating session types" },
  { value: "custom", label: "My own split" },
] as const satisfies readonly Option[];
export type WorkoutSplit = (typeof SPLIT_OPTIONS)[number]["value"];
export const DEFAULT_SPLIT: WorkoutSplit = "full_body";

/** `Dumbbells`, `cable machine` and `pull-up bar` become `dumbbells`, `cable_machine`, `pull_up_bar`. */
export function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/**
 * Equipment uses the training taxonomy (src/lib/training/taxonomy.ts): the keys Workouts, the Home and
 * Gym equipment lists and the exercise catalogue share. Older stored words ("Dumbbells", "bands",
 * "cable machine", this module's earlier keys) map to those keys; "bodyweight" and "none" mean no
 * equipment. Whatever matches nothing is returned as `unknown`, so screens can say it is not used for
 * workouts instead of dropping it silently.
 */
export function normalizeEquipment(input: unknown): { keys: string[]; unknown: string[] } {
  const keys: string[] = [];
  const unknown: string[] = [];
  for (const raw of Array.isArray(input) ? input : []) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const key = equipmentKeyFor(raw);
    if (key) keys.push(key);
    else if (key === null && !unknown.some((item) => item.toLowerCase() === raw.trim().toLowerCase())) unknown.push(raw.trim());
  }
  return { keys: sortEquipmentKeys(keys), unknown };
}

export const SESSION_LENGTHS = [20, 30, 45, 60, 75, 90] as const;
export const DEFAULT_SESSION_MINUTES = 45;
export const DAYS_PER_WEEK = [1, 2, 3, 4, 5, 6, 7] as const;
/** Weekly availability in setup: 2 to 7 days. */
export const ONBOARDING_DAYS_PER_WEEK = [2, 3, 4, 5, 6, 7] as const;
export const DEFAULT_DAYS_PER_WEEK = 3;

export const LIMITATION_OPTIONS = [
  { value: "knee", label: "Knees" },
  { value: "lower_back", label: "Lower back" },
  { value: "shoulder", label: "Shoulders" },
  { value: "wrist", label: "Wrists or elbows" },
  { value: "hip", label: "Hips" },
  { value: "ankle", label: "Ankles or feet" },
  { value: "neck", label: "Neck" },
] as const satisfies readonly Option[];
export type LimitationKey = (typeof LIMITATION_OPTIONS)[number]["value"];

// ─── Food ────────────────────────────────────────────────────────────────────────────────────────

export const DIET_OPTIONS = [
  { value: "vegetarian", label: "Vegetarian", hint: "No meat, fish or eggs" },
  { value: "non_vegetarian", label: "Non-vegetarian", hint: "Meat, fish and eggs" },
  { value: "both", label: "Both", hint: "Vegetarian some days, non-veg on others" },
  { value: "vegan", label: "Vegan", hint: "No animal products, dairy included" },
  { value: "eggetarian", label: "Eggetarian", hint: "Vegetarian, plus eggs" },
] as const satisfies readonly Option[];
export type DietType = (typeof DIET_OPTIONS)[number]["value"];
/** The four diets setup offers ("Both" stays a Profile choice for accounts that have it). */
export const ONBOARDING_DIETS: readonly DietType[] = ["vegetarian", "non_vegetarian", "vegan", "eggetarian"];

/** Labels the first onboarding stored in `user_preferences.dietary_preferences`. */
const LEGACY_DIET_LABELS: Readonly<Record<string, DietType>> = {
  vegetarian: "vegetarian",
  vegan: "vegan",
  eggetarian: "eggetarian",
  non_vegetarian: "non_vegetarian",
  nonvegetarian: "non_vegetarian",
  non_veg: "non_vegetarian",
  both: "both",
};

/** The diet type, falling back to the label the first onboarding kept in `dietary_preferences`. */
export function normalizeDietType(value: unknown, legacy?: unknown): DietType | null {
  if (isOption(DIET_OPTIONS, value)) return value;
  for (const raw of Array.isArray(legacy) ? legacy : []) {
    if (typeof raw !== "string") continue;
    const match = LEGACY_DIET_LABELS[slug(raw)];
    if (match) return match;
  }
  return null;
}

/**
 * The legacy `dietary_preferences` array with its diet label replaced by `diet` (any other legacy
 * entries, such as "Halal", are kept), so older readers of that column stay consistent.
 */
export function legacyDietaryPreferences(diet: DietType | null, previous: unknown): string[] {
  const kept = (Array.isArray(previous) ? previous : []).filter(
    (item): item is string => typeof item === "string" && Boolean(item.trim()) && !LEGACY_DIET_LABELS[slug(item)],
  );
  const label = optionLabel(DIET_OPTIONS, diet);
  return label ? [label, ...kept] : kept;
}

export const ALLERGY_OPTIONS = [
  { value: "dairy", label: "Milk / dairy" },
  { value: "eggs", label: "Eggs" },
  { value: "peanuts", label: "Peanuts" },
  { value: "tree_nuts", label: "Tree nuts" },
  { value: "wheat_gluten", label: "Wheat / gluten" },
  { value: "soy", label: "Soy" },
  { value: "fish", label: "Fish" },
  { value: "shellfish", label: "Shellfish" },
  { value: "sesame", label: "Sesame" },
  { value: "mustard", label: "Mustard" },
] as const satisfies readonly Option[];
export type AllergyKey = (typeof ALLERGY_OPTIONS)[number]["value"];

const ALLERGY_SYNONYMS: Readonly<Record<string, AllergyKey>> = {
  milk: "dairy", lactose: "dairy", milk_dairy: "dairy",
  egg: "eggs",
  peanut: "peanuts", groundnut: "peanuts", groundnuts: "peanuts",
  // "Nuts" stays the user's own entry: mapping it to tree nuts would drop peanuts. Synonyms only ever
  // name the same or a broader allergy.
  tree_nut: "tree_nuts",
  wheat: "wheat_gluten", gluten: "wheat_gluten", wheat_gluten: "wheat_gluten",
  soya: "soy", soybean: "soy", soybeans: "soy",
  shell_fish: "shellfish", crustaceans: "shellfish", prawns: "shellfish", shrimp: "shellfish",
};

export const MAX_CUSTOM_ENTRIES = 10;
export const MAX_CUSTOM_LENGTH = 40;
export const MAX_FOOD_DISLIKES = 30;
/** Injury notes need room for the detail that matters ("no jumping until March"). */
export const MAX_CUSTOM_LIMITATIONS = 5;
export const MAX_LIMITATION_LENGTH = 60;

export type TagLimits = { max?: number; maxLength?: number };

/**
 * Trimmed, de-duplicated free-text entries (case-insensitive), each at most `maxLength` characters,
 * at most `max` of them.
 */
export function normalizeTags(input: unknown, { max = MAX_CUSTOM_ENTRIES, maxLength = MAX_CUSTOM_LENGTH }: TagLimits = {}): string[] {
  const out: string[] = [];
  for (const raw of Array.isArray(input) ? input : []) {
    if (typeof raw !== "string") continue;
    const value = raw.replace(/\s+/g, " ").trim().slice(0, maxLength).trim();
    if (!value || out.some((item) => item.toLowerCase() === value.toLowerCase())) continue;
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

/** The list after adding what was typed (commas separate entries): what a tag field saves on Enter, +, or leaving it. */
export function commitDraft(values: readonly string[], draft: string, limits: TagLimits = {}): string[] {
  return normalizeTags([...values, ...draft.split(",")], limits);
}

/**
 * Splits a stored list into known keys (old labels such as "Tree nuts" included) and the user's own
 * entries, e.g. allergies `["Dairy", "sesame", "Kiwi"]` -> keys `["dairy", "sesame"]`, custom `["Kiwi"]`.
 */
export function splitKnown<V extends string>(
  options: readonly Option<V>[],
  input: unknown,
  synonyms: Readonly<Record<string, V>> = {},
  limits: TagLimits = {},
): { keys: V[]; custom: string[] } {
  const keys = new Set<V>();
  const custom: string[] = [];
  for (const raw of Array.isArray(input) ? input : []) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const key = slug(raw);
    const byLabel = options.find((option) => slug(option.label) === key)?.value;
    const match = isOption(options, key) ? key : byLabel ?? synonyms[key];
    if (match) keys.add(match);
    else custom.push(raw);
  }
  return { keys: options.map((option) => option.value).filter((value) => keys.has(value)), custom: normalizeTags(custom, limits) };
}

export function splitAllergies(input: unknown) {
  return splitKnown(ALLERGY_OPTIONS, input, ALLERGY_SYNONYMS);
}

export function splitLimitations(input: unknown) {
  // Only same-meaning or broader matches: "back" stays as typed rather than becoming "lower back".
  return splitKnown(LIMITATION_OPTIONS, input, { knees: "knee", shoulders: "shoulder", wrists: "wrist", elbow: "wrist", elbows: "wrist", hips: "hip", ankles: "ankle", feet: "ankle", foot: "ankle" }, { maxLength: MAX_LIMITATION_LENGTH });
}

/** Known keys first (in list order), then custom entries: the shape stored in the database. */
export function joinKnown(keys: readonly string[], custom: readonly string[], limits: TagLimits = {}): string[] {
  return [...keys, ...normalizeTags(custom, limits)];
}

/** Limitations keep custom notes up to MAX_LIMITATION_LENGTH characters. */
export function joinLimitations(keys: readonly string[], custom: readonly string[]): string[] {
  return joinKnown(keys, custom, { maxLength: MAX_LIMITATION_LENGTH });
}

export const FOOD_RULE_OPTIONS = [
  { value: "halal", label: "Halal only" },
  { value: "jain", label: "Jain" },
  { value: "no_onion_garlic", label: "No onion or garlic" },
  { value: "no_beef", label: "No beef" },
  { value: "no_pork", label: "No pork" },
  { value: "pescatarian", label: "Fish but no meat" },
  { value: "low_carb", label: "Low carb" },
] as const satisfies readonly Option[];
export type FoodRule = (typeof FOOD_RULE_OPTIONS)[number]["value"];

export function normalizeFoodRules(input: unknown, legacy?: unknown): FoodRule[] {
  const fromLegacy = (Array.isArray(legacy) ? legacy : []).map((item) => (typeof item === "string" ? slug(item) : ""));
  const list = [...(Array.isArray(input) ? input : []), ...fromLegacy];
  const { keys } = splitKnown(FOOD_RULE_OPTIONS, list, { halal: "halal", pescetarian: "pescatarian" });
  return keys;
}

export const CUISINE_OPTIONS = [
  { value: "north_indian", label: "North Indian" },
  { value: "south_indian", label: "South Indian" },
  { value: "east_indian", label: "East Indian", hint: "Bengali, Odia" },
  { value: "west_indian", label: "West Indian", hint: "Gujarati, Maharashtrian, Goan" },
  { value: "northeast_indian", label: "North-East Indian" },
  { value: "indo_chinese", label: "Indo-Chinese" },
  { value: "continental", label: "Continental" },
  { value: "mediterranean", label: "Mediterranean" },
  { value: "middle_eastern", label: "Middle Eastern" },
  { value: "east_asian", label: "East Asian" },
] as const satisfies readonly Option[];
export type Cuisine = (typeof CUISINE_OPTIONS)[number]["value"];

export const BUDGET_LEVEL_OPTIONS = [
  { value: "tight", label: "Tight", hint: "Keep food costs as low as possible" },
  { value: "moderate", label: "Moderate", hint: "Balance cost and variety" },
  { value: "flexible", label: "Flexible", hint: "Cost isn't a big concern" },
] as const satisfies readonly Option[];
export type BudgetLevel = (typeof BUDGET_LEVEL_OPTIONS)[number]["value"];

/** Monthly food budget bounds in Indian rupees (the database checks the same range). */
export const MONTHLY_BUDGET_RANGE = { min: 500, max: 500000 } as const;

/** "₹12,000" in Indian digit grouping. */
export function formatRupees(amount: number) {
  return `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(amount))}`;
}

/** A whole-rupee amount from what was typed ("12,000", "₹ 8500"), or null when it is empty or not a number. */
export function parseRupees(value: string): number | null {
  const digits = value.replace(/[₹,\s]/g, "").replace(/^rs\.?/i, "");
  if (!digits) return null;
  if (!/^\d+(\.\d+)?$/.test(digits)) return Number.NaN;
  return Math.round(Number(digits));
}

export const MEALS_PER_DAY = [1, 2, 3, 4, 5, 6] as const;
/** Meals a day in setup: 2, 3, 4 or 5+ (saved as 5). */
export const ONBOARDING_MEAL_OPTIONS = [
  { value: 2, label: "2" },
  { value: 3, label: "3" },
  { value: 4, label: "4" },
  { value: 5, label: "5+" },
] as const;
/** The setup choice for a stored number of meals: 1 shows as 2, 6 or more as 5+. */
export function onboardingMeals(meals: number): number {
  return Math.min(5, Math.max(2, Math.round(meals)));
}

export const FOOD_SOURCE_OPTIONS = [
  { value: "home", label: "Home-cooked" },
  { value: "outside", label: "Outside food" },
  { value: "both", label: "Both" },
] as const satisfies readonly Option[];
export type FoodSource = (typeof FOOD_SOURCE_OPTIONS)[number]["value"];

export const NUTRITION_FOCUS_OPTIONS = [
  { value: "high_protein", label: "High protein" },
  { value: "balanced", label: "Balanced diet" },
  { value: "none", label: "No specific preference" },
] as const satisfies readonly Option[];
export type NutritionFocus = (typeof NUTRITION_FOCUS_OPTIONS)[number]["value"];
export const DEFAULT_MEALS_PER_DAY = 3;
export const WATER_RANGE_ML = { min: 250, max: 10000 } as const;
export const DEFAULT_WATER_ML = 2500;

// ─── Body and units ──────────────────────────────────────────────────────────────────────────────

export const NAME_MAX_LENGTH = 120;
export const AGE_RANGE = { min: 13, max: 100 } as const;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The calendar date in `value` (YYYY-MM-DD) as [year, month, day], or null when it is not a real date. */
function dateParts(value: unknown): [number, number, number] | null {
  if (typeof value !== "string") return null;
  const match = ISO_DATE.exec(value.trim().slice(0, 10));
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return [year, month, day];
}

/** A stored or typed birth date as YYYY-MM-DD, or null when it is missing or not a real date. */
export function normalizeBirthDate(value: unknown): string | null {
  const parts = dateParts(value);
  return parts ? `${String(parts[0]).padStart(4, "0")}-${String(parts[1]).padStart(2, "0")}-${String(parts[2]).padStart(2, "0")}` : null;
}

/** Whole years from a birth date (YYYY-MM-DD) to `today` (the local date), or null for a missing or future date. */
export function ageFromBirthDate(birthDate: unknown, today: Date = new Date()): number | null {
  const parts = dateParts(birthDate);
  if (!parts) return null;
  const [year, month, day] = parts;
  const [ty, tm, td] = [today.getFullYear(), today.getMonth() + 1, today.getDate()];
  const age = ty - year - (tm < month || (tm === month && td < day) ? 1 : 0);
  return age >= 0 ? age : null;
}

/** The earliest and latest birth dates setup accepts on `today`: ages AGE_RANGE.min to AGE_RANGE.max. */
export function birthDateBounds(today: Date = new Date()): { min: string; max: string } {
  const iso = (year: number) => `${String(year).padStart(4, "0")}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  // Born on today's date AGE_RANGE.max + 1 years ago turns 101 today, so the earliest is one day later.
  const earliest = new Date(today.getFullYear() - AGE_RANGE.max - 1, today.getMonth(), today.getDate() + 1);
  const min = `${String(earliest.getFullYear()).padStart(4, "0")}-${String(earliest.getMonth() + 1).padStart(2, "0")}-${String(earliest.getDate()).padStart(2, "0")}`;
  return { min, max: iso(today.getFullYear() - AGE_RANGE.min) };
}
export const HEIGHT_RANGE_CM = { min: 90, max: 250 } as const;
export const WEIGHT_RANGE_KG = { min: 30, max: 500 } as const;

export const HEIGHT_UNIT_OPTIONS = [
  { value: "cm", label: "cm" },
  { value: "ft_in", label: "ft + in" },
] as const satisfies readonly Option[];
export type HeightUnit = (typeof HEIGHT_UNIT_OPTIONS)[number]["value"];

export const WEIGHT_UNIT_OPTIONS = [
  { value: "kg", label: "kg" },
  { value: "lb", label: "lb" },
] as const satisfies readonly Option[];
export type WeightUnit = (typeof WEIGHT_UNIT_OPTIONS)[number]["value"];

/** Metric by default; every measurement is stored in centimetres and kilograms. */
export const DEFAULT_HEIGHT_UNIT: HeightUnit = "cm";
export const DEFAULT_WEIGHT_UNIT: WeightUnit = "kg";

const CM_PER_INCH = 2.54;
const KG_PER_LB = 0.45359237;

const round1 = (value: number) => Math.round(value * 10) / 10;

export function feetInchesToCm(feet: number, inches: number) {
  return round1((feet * 12 + inches) * CM_PER_INCH);
}

/** Whole feet and inches rounded to the nearest inch (5 ft 11.6 in becomes 6 ft 0 in). */
export function cmToFeetInches(cm: number) {
  const totalInches = Math.round(cm / CM_PER_INCH);
  return { feet: Math.floor(totalInches / 12), inches: totalInches % 12 };
}

export function lbToKg(lb: number) {
  return round1(lb * KG_PER_LB);
}

export function kgToLb(kg: number) {
  return round1(kg / KG_PER_LB);
}

export function formatHeight(cm: number | null | undefined, unit: HeightUnit = DEFAULT_HEIGHT_UNIT) {
  if (cm == null || !Number.isFinite(cm)) return null;
  if (unit === "ft_in") {
    const { feet, inches } = cmToFeetInches(cm);
    return `${feet} ft ${inches} in`;
  }
  return `${round1(cm)} cm`;
}

export function formatWeight(kg: number | null | undefined, unit: WeightUnit = DEFAULT_WEIGHT_UNIT) {
  if (kg == null || !Number.isFinite(kg)) return null;
  return unit === "lb" ? `${kgToLb(kg)} lb` : `${round1(kg)} kg`;
}

/** A number typed into a field ("72,5" counts as 72.5), null when empty, NaN when not a number. */
export function parseDecimal(value: string): number | null {
  const text = value.trim().replace(",", ".");
  if (!text) return null;
  if (!/^-?\d+(\.\d+)?$/.test(text) && !/^-?\.\d+$/.test(text)) return Number.NaN;
  return Number(text);
}

export function inRange(value: number | null, range: { min: number; max: number }) {
  return value !== null && Number.isFinite(value) && value >= range.min && value <= range.max;
}
