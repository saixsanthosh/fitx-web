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
/** Goals the database cannot store yet, given which goal-widening migrations it has. */
export function goalsAwaitingMigration(schema: { preferencesV2: boolean; onboardingV3: boolean }, offered: readonly Goal[] = GOALS): Goal[] {
  const allowed = !schema.preferencesV2 ? GOALS_BEFORE_PROFILE_V2 : !schema.onboardingV3 ? GOALS_BEFORE_ONBOARDING_V3 : null;
  return allowed ? offered.filter((goal) => !allowed.includes(goal)) : [];
}
/** "Weight gain and weight loss arrive with the next FITX update.", or undefined when none wait. */
export function goalsAwaitingMigrationHint(goals: readonly Goal[]): string | undefined {
  if (!goals.length) return undefined;
  const labels = goals.map((goal, index) => {
    const label = optionLabel(GOAL_OPTIONS, goal) ?? goal;
    return index === 0 ? label : label.toLowerCase();
  });
  const list = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `${list} ${goals.length === 1 ? "arrives" : "arrive"} with the next FITX update.`;
}

/** Goals Profile shows but this database cannot store yet: before profile v2 only five, before onboarding v3 all but Maintain weight. */
export function unavailableProfileGoals(schema: { preferencesV2: boolean; onboardingV3: boolean }): Goal[] {
  return goalsAwaitingMigration(schema);
}

/**
 * Number choices for an edit form: the standard ones, plus the stored value when it is not among them (an older
 * answer such as 1 training day or 6 meals), so saving an untouched form never changes it. Sorted, no repeats.
 */
export function choicesKeeping(standard: readonly { value: number; label: string }[], current: number): { value: number; label: string }[] {
  const list = [...standard];
  if (Number.isFinite(current) && !list.some((option) => option.value === current)) list.push({ value: current, label: String(current) });
  return list.sort((a, b) => a.value - b.value);
}
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
/** The oldest age a readout or hint shows: past it the date is a typo (born in the year 0100 is not "1926 years"). */
export const OLDEST_SHOWN_AGE = 130;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function daysInMonth(year: number, month: number) {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/**
 * The calendar date in `value` (YYYY-MM-DD) as [year, month, day], or null when it is not a real date. Checked with
 * the calendar's own rules, not Date.UTC, which reads the years 0 to 99 as 1900 to 1999: 0001-01-01 is a real date
 * (one FITX doesn't take, "ages 13 to 100"), not "not a real date".
 */
function dateParts(value: unknown): [number, number, number] | null {
  if (typeof value !== "string") return null;
  const match = ISO_DATE.exec(value.trim().slice(0, 10));
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return [year, month, day];
}

/** Local midnight of a calendar date, the year as written (new Date(y, m, d) would read 0 to 99 as 1900 to 1999). */
function localDay([year, month, day]: [number, number, number]): Date {
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date;
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

/**
 * The age a readout or hint shows for a date being typed: the age it gives, or null when there is none or nobody could
 * be that old. A date field reports its year as it is typed (2-0-0-1 passes through 0200), so only a real age shows.
 */
export function shownAge(birthDate: unknown, today: Date = new Date()): number | null {
  const age = ageFromBirthDate(birthDate, today);
  return age !== null && age <= OLDEST_SHOWN_AGE ? age : null;
}

/**
 * The age to use for a profile row on `today` (a Date, or a YYYY-MM-DD day key such as the member's local date):
 * the one its birth date gives, else the stored profiles.age. The database refreshes profiles.age from the birth
 * date only when the row is saved, so after a birthday the stored age lags; reading the birth date keeps Home,
 * Nutrition, Profile and the AI coach on the same age. Null when neither is known (never 0).
 */
export function profileAge(row: { age?: unknown; date_of_birth?: unknown } | null | undefined, today: Date | string = new Date()): number | null {
  if (!row) return null;
  const parts = typeof today === "string" ? dateParts(today) : null;
  const day = typeof today === "string" ? (parts ? localDay(parts) : null) : today;
  const fromBirthDate = day ? ageFromBirthDate(row.date_of_birth, day) : null;
  if (fromBirthDate !== null) return fromBirthDate;
  if (row.age === null || row.age === undefined || row.age === "") return null;
  const stored = Number(row.age);
  return Number.isFinite(stored) ? stored : null;
}

/**
 * The Profile edit for a member's birth date. Once profiles.date_of_birth exists, the database sets profiles.age
 * from it on every save (profiles_age_from_birth_date), so Profile edits the birth date and never the age alone.
 * A member adds a birth date once: a saved one is changed or cleared only by FITX support (the database refuses a
 * member's change, profiles_birth_date_locked in 20261124100000), so a typed date other than the saved one is an
 * error with no patch. `stored` is the profile as normalizeProfile returns it; `typed` is the date field's
 * YYYY-MM-DD, or "" when empty. `age` is the age after the save.
 */
export const BIRTH_DATE_SAVED_ERROR = "Your date of birth is already saved. To change it, ask FITX support.";
/**
 * Said beside the date field before a date of birth is first saved, wherever that happens (setup's first step, Profile
 * > Body and Explore settings use these words): a typo in the year, which decides the teen rules, needs FITX support.
 */
export const BIRTH_DATE_ONCE_NOTE = "You can add it once. To change it later, ask FITX support.";

/** True for the database's refusal to change or clear a saved date of birth (birth_date_locked, 20261124100000). */
export function isBirthDateLocked(error: { message?: string | null } | null | undefined): boolean {
  return typeof error?.message === "string" && /\bbirth_date_locked\b/.test(error.message);
}

export function birthDateEdit(
  stored: { age: number | null; date_of_birth: string | null },
  typed: string,
  today: Date = new Date(),
): { error: string | null; patch: { date_of_birth?: string | null; age?: number | null }; age: number | null } {
  const value = typed.trim();
  const savedAge = stored.date_of_birth ? ageFromBirthDate(stored.date_of_birth, today) ?? stored.age : stored.age;
  if (!value) {
    return stored.date_of_birth ? { error: BIRTH_DATE_SAVED_ERROR, patch: {}, age: savedAge } : { error: null, patch: {}, age: stored.age };
  }
  const birthDate = normalizeBirthDate(value);
  const age = ageFromBirthDate(birthDate, today);
  if (!birthDate || age === null) return { error: "Enter a real date, not in the future.", patch: {}, age: savedAge };
  if (!inRange(age, AGE_RANGE)) return { error: `FITX is for ages ${AGE_RANGE.min} to ${AGE_RANGE.max}.`, patch: {}, age: savedAge };
  if (birthDate === stored.date_of_birth) return { error: null, patch: {}, age };
  if (stored.date_of_birth) return { error: BIRTH_DATE_SAVED_ERROR, patch: {}, age: savedAge };
  return { error: null, patch: { date_of_birth: birthDate, age }, age };
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
const round2 = (value: number) => Math.round(value * 100) / 100;

/*
 * Precision. A height or weight is typed, shown and checked to 0.1 in the member's own unit (cm, inches, kg or lb) and
 * stored in centimetres to 0.1 and kilograms to 0.01. That is fine enough for every height typed to 0.1 in and every
 * weight typed to 0.1 lb to come back exactly as typed: 150 lb is stored as 68.04 kg and shows as 150 lb again (at
 * 0.1 kg it was 68.0 kg, which shows as 149.9 lb). Between units nothing is rounded twice.
 */

/** A height in the unit shown, to 0.1: centimetres, or inches in all for feet and inches. */
export function heightInUnit(cm: number, unit: HeightUnit): number {
  return unit === "ft_in" ? round1(cm / CM_PER_INCH) : round1(cm);
}

/** Centimetres, as stored, for a height typed in the unit shown (inches in all for feet and inches), read to 0.1. */
export function heightFromUnit(value: number, unit: HeightUnit): number {
  return unit === "ft_in" ? round1(round1(value) * CM_PER_INCH) : round1(value);
}

/** A weight in the unit shown, to 0.1 kg or 0.1 lb. */
export function weightInUnit(kg: number, unit: WeightUnit): number {
  return unit === "lb" ? kgToLb(kg) : round1(kg);
}

/** Kilograms, as stored, for a weight typed in the unit shown, read to 0.1. */
export function weightFromUnit(value: number, unit: WeightUnit): number {
  return unit === "lb" ? lbToKg(round1(value)) : round1(value);
}

export function feetInchesToCm(feet: number, inches: number) {
  return heightFromUnit(feet * 12 + inches, "ft_in");
}

/** Whole feet and the inches left, to 0.1 in (175 cm is 5 ft 8.9 in; 182.8 cm rounds to 72.0 in, 6 ft 0 in). */
export function cmToFeetInches(cm: number) {
  const totalInches = heightInUnit(cm, "ft_in");
  const feet = Math.floor(totalInches / 12);
  return { feet, inches: round1(totalInches - feet * 12) };
}

/** Kilograms to 0.01 (the stored precision), so pounds typed to 0.1 come back unchanged. */
export function lbToKg(lb: number) {
  return round2(lb * KG_PER_LB);
}

/** Pounds to 0.1, as shown. */
export function kgToLb(kg: number) {
  return round1(kg / KG_PER_LB);
}

/** Two stored weights that are the same to the stored 0.01 kg: 0.1 lb (0.045 kg) is a change. */
export function sameWeightKg(a: number | null, b: number | null): boolean {
  return a === null || b === null ? a === b : Math.abs(a - b) < 0.005;
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
  return `${weightInUnit(kg, unit)} ${unit}`;
}

// ─── Limits a height or weight must keep, in the unit the member types ───────────────────────────

type Limits = { readonly min: number; readonly max: number };

/**
 * The heights and weights FITX takes, in each unit the member can type them in: the metric ranges, and the whole
 * imperial values inside them, in inches in all and pounds. Every limit a message names is one FITX accepts: 2 ft 11 in
 * (88.9 cm) and 66 lb (29.94 kg) are below the minimums, so the imperial ones are 3 ft 0 in and 67 lb. A value is
 * checked as it is shown, in its own unit and to 0.1, so the field never shows a number other than the one checked.
 */
export const HEIGHT_LIMITS: Readonly<Record<HeightUnit, Limits>> = {
  cm: HEIGHT_RANGE_CM,
  ft_in: { min: Math.ceil(HEIGHT_RANGE_CM.min / CM_PER_INCH), max: Math.floor(HEIGHT_RANGE_CM.max / CM_PER_INCH) },
};
export const WEIGHT_LIMITS: Readonly<Record<WeightUnit, Limits>> = {
  kg: WEIGHT_RANGE_KG,
  lb: { min: Math.ceil(WEIGHT_RANGE_KG.min / KG_PER_LB), max: Math.floor(WEIGHT_RANGE_KG.max / KG_PER_LB) },
};

/** True for a height (stored, in cm) that is a number inside the limits of the unit shown. */
export function heightInLimits(cm: number | null, unit: HeightUnit): boolean {
  return cm !== null && Number.isFinite(cm) && inRange(heightInUnit(cm, unit), HEIGHT_LIMITS[unit]);
}

/** True for a weight (stored, in kg) that is a number inside the limits of the unit shown. */
export function weightInLimits(kg: number | null, unit: WeightUnit): boolean {
  return kg !== null && Number.isFinite(kg) && inRange(weightInUnit(kg, unit), WEIGHT_LIMITS[unit]);
}

const grouped = (value: number) => value.toLocaleString("en-GB", { maximumFractionDigits: 1 });
const feetAndInches = (totalInches: number) => `${Math.floor(totalInches / 12)} ft ${round1(totalInches % 12)} in`;

/** "90 and 250 cm" or "3 ft 0 in and 8 ft 2 in", for messages. */
export function heightLimitsText(unit: HeightUnit): string {
  const { min, max } = HEIGHT_LIMITS[unit];
  return unit === "ft_in" ? `${feetAndInches(min)} and ${feetAndInches(max)}` : `${grouped(min)} and ${grouped(max)} cm`;
}

/** "30 and 500 kg" or "67 and 1,102 lb", for messages. */
export function weightLimitsText(unit: WeightUnit): string {
  const { min, max } = WEIGHT_LIMITS[unit];
  return `${grouped(min)} and ${grouped(max)} ${unit}`;
}

const UNIT_NAMES: Readonly<Record<HeightUnit | WeightUnit, string>> = { cm: "centimetres", ft_in: "feet and inches", kg: "kilograms", lb: "pounds" };

/**
 * Why a height (stored, in cm; NaN when what is typed is not a number) can't be saved, in the unit shown, or null
 * when it can. An empty height is the caller's to judge (setup asks for one, Profile doesn't); `optional` adds "or
 * leave it empty" to the message.
 */
export function heightError(cm: number | null, unit: HeightUnit, { optional = false }: { optional?: boolean } = {}): string | null {
  if (cm === null || heightInLimits(cm, unit)) return null;
  const empty = optional ? ", or leave it empty" : "";
  if (Number.isNaN(cm)) return `Enter your height in ${UNIT_NAMES[unit]}, for example ${unit === "ft_in" ? "5 ft 9 in" : "175"}${empty}.`;
  return `Enter a height between ${heightLimitsText(unit)}${empty}.`;
}

/**
 * Why a weight (stored, in kg; NaN when what is typed is not a number) can't be saved, in the unit shown, or null when
 * it can. An empty weight is the caller's to judge; a `target` weight may always be left empty, and its message says so.
 */
export function weightError(kg: number | null, unit: WeightUnit, { target = false }: { target?: boolean } = {}): string | null {
  if (kg === null || weightInLimits(kg, unit)) return null;
  if (Number.isNaN(kg)) {
    return target
      ? `Enter your target in ${UNIT_NAMES[unit]}, for example ${unit === "lb" ? "145" : "65"}, or leave it empty.`
      : `Enter your weight in ${UNIT_NAMES[unit]}, for example ${unit === "lb" ? "155" : "70.5"}.`;
  }
  return target ? `Enter a target between ${weightLimitsText(unit)}, or leave it empty.` : `Enter a weight between ${weightLimitsText(unit)}.`;
}

// ─── Reading what is typed in a height or weight field ───────────────────────────────────────────

/** The units a height or weight field's text can name: centimetres, feet, inches, kilograms and pounds. */
export type MeasureTextUnit = "cm" | "ft" | "in" | "kg" | "lb";

const UNIT_WORDS: Readonly<Record<MeasureTextUnit, readonly string[]>> = {
  cm: ["cm", "cms", "centimetre", "centimetres", "centimeter", "centimeters"],
  ft: ["ft", "feet", "foot", "'", "’", "′"],
  in: ["in", "ins", "inch", "inches", "\"", "”", "″"],
  kg: ["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms", "kilogramme", "kilogrammes"],
  lb: ["lb", "lbs", "pound", "pounds"],
};

// A number ("65", "65.5", "65,5", "65." while typing, ".5", "1,102"), then perhaps a unit and a full stop ("lbs.").
const MEASURE_TEXT = /^(-?)(\d{1,3}(?:,\d{3})+|\d+(?:[.,]\d*)?|[.,]\d+)\s*([a-z'"’”′″]*)\.?$/i;

/**
 * A number typed in a height or weight field, with or without a unit after it ("65", "65kg", "70 kg", "5 ft",
 * "1,102 lb"), and which of `units` it names (null when none is typed). The value is null when the text is empty and
 * NaN when it is not a number, or names a unit not in `units`. The start of a unit's name counts ("65 k"), so the value
 * never disappears while the unit is being typed; "1,102" is 1102 (the way messages write it), "72,5" is 72.5.
 */
export function readMeasureText(text: string, units: readonly MeasureTextUnit[]): { value: number | null; unit: MeasureTextUnit | null } {
  const trimmed = text.trim();
  if (!trimmed) return { value: null, unit: null };
  const match = MEASURE_TEXT.exec(trimmed);
  if (!match) return { value: Number.NaN, unit: null };
  const word = match[3].toLowerCase();
  const unit = word ? units.find((candidate) => UNIT_WORDS[candidate].some((name) => name.startsWith(word))) ?? null : null;
  if (word && !unit) return { value: Number.NaN, unit: null };
  const digits = /^\d{1,3}(?:,\d{3})+$/.test(match[2]) ? match[2].replace(/,/g, "") : match[2].replace(",", ".");
  const value = Number(`${match[1]}${digits}`);
  return { value: Number.isFinite(value) ? value : Number.NaN, unit };
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
