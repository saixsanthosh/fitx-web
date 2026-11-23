import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LIMITATION_OPTIONS, MAX_CUSTOM_LIMITATIONS, MAX_LIMITATION_LENGTH, NUTRITION_FOCUS_OPTIONS, normalizeDietType, optionLabel, profileAge, type FoodSource, type NutritionFocus } from "@/lib/domain/profile-options";
import { normalizePreferences, normalizeProfile, targetsFor } from "@/lib/domain/user-context";
import { clientMetricForUnit } from "@/lib/domain/goals";
import { isMissingColumnError } from "@/lib/supabase/errors";
import { survivingExerciseId } from "@/lib/training/exercise-merges";
import { isWorkoutSetupDone } from "@/lib/training/setup";
import { isCountedSession, loadLibraryMuscles, regionsTrained, summariseMuscles, type LoggedSession } from "@/lib/training/muscle-history";
import { allergyRulesFrom, describeAllergies, describeDiet, dietRulesFrom, type AllergyRule, type DietRule } from "./diet-rules";
import { calorieFloor } from "./safety";
import type { Macros } from "./types";
import { cleanText, round1 } from "./validate";

/**
 * What the coach knows about a member: read fresh on every request with the member's own session
 * (row-level security limits every query to their rows), then reduced to a compact summary of about
 * 1-2k tokens. The summary never contains a name, email, photo, account or row id, free-text notes
 * or exact times: only dates, numbers, and the short labels the member chose (diet, goal titles,
 * food names).
 */

export type ContextSources = {
  profile: Record<string, unknown> | null;
  preferences: Record<string, unknown> | null;
  weighIns: Array<{ date: string; weight: number | null }>;
  meals: Array<{ date: string; meal: string | null; food_name: string | null; calories: number | null; protein: number | null; carbs: number | null; fat: number | null }>;
  customFoods: Array<{ name: string | null }>;
  sessions: Array<{ started_at: string; status: string; duration_seconds: number | null; total_volume: number | null }>;
  recentMuscles: string[];
  records: Array<{ exercise_name: string | null; best_weight_kg: number | null; best_reps: number | null; estimated_one_rep_max: number | null; achieved_at: string | null }>;
  /** metric and period are there on a database with goals v2; see storedGoalProgress for what current_value means. */
  goals: Array<{ title: string | null; category: string | null; metric?: string | null; period?: string | null; target_value: number | null; current_value: number | null; unit: string | null; due_on: string | null }>;
  // starts_at is null for an untimed To-Do (Planner v2); local_date is its calendar day.
  planner: Array<{ event_type: string | null; starts_at: string | null; local_date?: string | null }>;
  /**
   * Recorded and imported activities of the last 28 days (walks, runs, rides and the other Activity sports); null
   * when they could not be read (no activities table yet), so the summary leaves them out instead of saying none.
   */
  activities?: Array<{ sport: string | null; started_at: string | null; distance_m: number | string | null; moving_seconds: number | null; elevation_gain_m?: number | string | null }> | null;
  /**
   * Whether the member has a saved Home or Gym equipment list (user_equipment_profiles). With
   * preferences.workout_setup_at it says whether the Workouts setup is done (isWorkoutSetupDone), and so whether
   * the training answers in the preferences row are the member's or the columns' defaults. False when unknown.
   */
  equipmentListSaved?: boolean;
};

/** Facts the server uses for its own checks. Never sent to a model as such. */
export type MemberFacts = {
  age: number | null;
  /** The profile's age is under 18. */
  minor: boolean;
  /**
   * The profile's age is 18 or over. Only then is the member's FITX data shared with the coach: an account
   * without an age (it can be removed in Profile) is never taken to be an adult's.
   */
  adult: boolean;
  sex: "male" | "female" | null;
  today: string;
  timeZone: string;
  diet: DietRule[];
  allergies: { rules: AllergyRule[]; other: string[] };
  target: Macros | null;
  calorieFloor: number;
  budget: string | null;
  /** Where the member's meals mostly come from (onboarding's "Food preference"); null when not answered. */
  foodSource: FoodSource | null;
  /** The member's nutrition goal; null when not answered or "No specific preference". */
  nutritionFocus: Exclude<NutritionFocus, "none"> | null;
  location: string;
  equipment: string[];
  level: string;
  goal: string;
  sessionMinutes: number;
  split: string;
  recentMuscles: string[];
  /** Whether the summary carries where meals come from and the nutrition goal (FOOD_HABITS_IN_SUMMARY). */
  foodHabitsShared: boolean;
  /** "High protein", "Balanced diet" or "No specific preference", when answered. */
  nutritionGoal: string | null;
};

export type CoachContext = { facts: MemberFacts; summary: Record<string, unknown> };

type Db = Pick<SupabaseClient, "from">;

const EMPTY_SOURCES: Omit<ContextSources, "profile" | "preferences"> = { weighIns: [], meals: [], customFoods: [], sessions: [], recentMuscles: [], records: [], goals: [], planner: [], activities: null };

/**
 * Reads everything in parallel. A query that fails (a table not there yet) counts as no data.
 * With `full: false` only the profile and preferences are read: enough for FITX's own safety checks
 * (age, time zone) when the member has not agreed to share their data with the coach.
 */
export async function loadContextSources(supabase: Db, userId: string, now = new Date(), options: { full: boolean } = { full: true }): Promise<ContextSources> {
  const day = (offset: number) => new Date(now.getTime() - offset * 86_400_000).toISOString().slice(0, 10);
  const rows = async <T>(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> => {
    try {
      const { data, error } = await query;
      return !error && Array.isArray(data) ? (data as T[]) : [];
    } catch {
      return [];
    }
  };
  /** Uses the newer query, or the older one when the database does not have its column yet. */
  const withFallback = async <T>(newer: () => PromiseLike<{ data: unknown; error: unknown }>, older: () => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> => {
    try {
      const { data, error } = await newer();
      if (!error) return Array.isArray(data) ? (data as T[]) : [];
      return isMissingColumnError(error) ? rows<T>(older()) : [];
    } catch {
      return [];
    }
  };
  const one = async (query: PromiseLike<{ data: unknown; error: unknown }>): Promise<Record<string, unknown> | null> => {
    try {
      const { data, error } = await query;
      return !error && data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };

  /** The profile, with the birth date once migration #41 has added it (the age is worked out from it). */
  const profileRow = async () => {
    const columns = "age, gender, height, weight, target_weight, experience";
    try {
      const newer = await supabase.from("profiles").select(`${columns}, date_of_birth`).eq("id", userId).maybeSingle();
      if (!newer.error || !isMissingColumnError(newer.error)) return one(Promise.resolve(newer));
    } catch {
      return null;
    }
    return one(supabase.from("profiles").select(columns).eq("id", userId).maybeSingle());
  };

  /** Whether a Home or Gym list is saved; a failed read (no lists table) counts as none. */
  const listSaved = async () => {
    try {
      return (await rows<{ context: string }>(supabase.from("user_equipment_profiles").select("context").eq("user_id", userId).limit(2))).length > 0;
    } catch {
      return false;
    }
  };

  const basics = Promise.all([
    profileRow(),
    one(supabase.from("user_preferences").select("*").eq("user_id", userId).maybeSingle()),
    listSaved(),
  ]);
  if (!options.full) {
    const [profile, preferences, equipmentListSaved] = await basics;
    return { profile, preferences, ...EMPTY_SOURCES, equipmentListSaved };
  }

  /** Activities, or null when they could not be read (never "no activities" for a missing table). */
  const activityRows = async (): Promise<ContextSources["activities"]> => {
    try {
      const { data, error } = await supabase.from("activities").select("sport, started_at, distance_m, moving_seconds, elevation_gain_m").eq("user_id", userId).gte("started_at", `${day(28)}T00:00:00Z`).order("started_at", { ascending: false }).limit(200);
      return !error && Array.isArray(data) ? (data as NonNullable<ContextSources["activities"]>) : null;
    } catch {
      return null;
    }
  };

  const [[profile, preferences, equipmentListSaved], weighIns, meals, customFoods, sessions, records, goals, planner, activities] = await Promise.all([
    basics,
    // Newest first; on the same date the later entry wins (the rule Profile and Progress use).
    rows<ContextSources["weighIns"][number]>(
      supabase.from("body_metrics").select("date, weight").eq("user_id", userId).gte("date", day(95)).order("date", { ascending: false }).order("created_at", { ascending: false }).limit(90),
    ),
    rows<ContextSources["meals"][number]>(
      supabase.from("meals").select("date, meal, food_name, calories, protein, carbs, fat").eq("user_id", userId).gte("date", day(8)).order("date", { ascending: true }).limit(400),
    ),
    withFallback<ContextSources["customFoods"][number]>(
      // Archived foods (Nutrition v2) are not the member's foods any more.
      () => supabase.from("custom_foods").select("name").eq("user_id", userId).is("archived_at", null).order("updated_at", { ascending: false }).limit(15),
      () => supabase.from("custom_foods").select("name").eq("user_id", userId).order("updated_at", { ascending: false }).limit(15),
    ),
    rows<ContextSources["sessions"][number] & { id: string }>(
      supabase.from("workout_sessions").select("id, started_at, status, duration_seconds, total_volume").eq("user_id", userId).gte("started_at", `${day(29)}T00:00:00Z`).order("started_at", { ascending: false }).limit(80),
    ),
    rows<ContextSources["records"][number]>(
      supabase.from("personal_records").select("exercise_name, best_weight_kg, best_reps, estimated_one_rep_max, achieved_at").eq("user_id", userId).order("estimated_one_rep_max", { ascending: false }).limit(8),
    ),
    withFallback<ContextSources["goals"][number]>(
      // Without goals v2 (no metric or period) a goal's stored value is never read as its progress.
      () => supabase.from("goals").select("title, category, metric, period, target_value, current_value, unit, due_on").eq("user_id", userId).eq("status", "active").order("due_on", { ascending: true, nullsFirst: false }).limit(6),
      () => supabase.from("goals").select("title, category, target_value, current_value, unit, due_on").eq("user_id", userId).eq("status", "active").order("due_on", { ascending: true, nullsFirst: false }).limit(6),
    ),
    withFallback<ContextSources["planner"][number]>(
      // Planner v2 puts every item on a calendar day (local_date), so untimed To-Dos count too.
      () => supabase.from("planner_events").select("event_type, starts_at, local_date").eq("user_id", userId).eq("status", "scheduled").gte("local_date", day(0)).lte("local_date", day(-8)).limit(60),
      () => supabase.from("planner_events").select("event_type, starts_at").eq("user_id", userId).eq("status", "scheduled").gte("starts_at", now.toISOString()).lte("starts_at", new Date(now.getTime() + 7 * 86_400_000).toISOString()).limit(40),
    ),
    activityRows(),
  ]);

  const recentMuscles = await recentMusclesFrom(supabase, userId, sessions, now, withFallback);

  return { profile, preferences, weighIns, meals, customFoods, sessions, recentMuscles, records, goals, planner, activities, equipmentListSaved };
}

type FetchWithFallback = <T>(newer: () => PromiseLike<{ data: unknown; error: unknown }>, older: () => PromiseLike<{ data: unknown; error: unknown }>) => Promise<T[]>;
type WorkoutSetRow = { reps: number | null; duration_seconds?: number | null; completed_at: string | null };
type WorkoutExerciseRow = { id: string; session_id: string; exercise_id: string | null; exercise_name: string | null; workout_sets: WorkoutSetRow[] | null };

/**
 * The muscles the last 7 days of training worked directly, most sets first, so a workout suggestion can
 * balance them. FITX's one counting rule (muscle-history.ts): completed sessions only, sets ticked as done with
 * reps or seconds, each exercise's catalogue primary muscle as a body-map region. An exercise left unticked in a
 * finished workout counts for nothing.
 */
async function recentMusclesFrom(supabase: Db, userId: string, sessions: Array<{ id: string; started_at: string; status: string }>, now: Date, withFallback: FetchWithFallback): Promise<string[]> {
  const since = now.getTime() - 7 * 86_400_000;
  // A session that started the evening before the window can still hold sets inside it.
  const lastWeek = sessions.filter((session) => isCountedSession(session) && Date.parse(session.started_at) >= since - 86_400_000).slice(0, 30);
  if (!lastWeek.length) return [];
  const ids = lastWeek.map((session) => session.id);
  const exerciseRows = await withFallback<WorkoutExerciseRow>(
    () => supabase.from("workout_session_exercises").select("id, session_id, exercise_id, exercise_name, workout_sets(reps, duration_seconds, completed_at)").eq("user_id", userId).in("session_id", ids).limit(200),
    // Before the timed-sets migration a set has no seconds column; reps alone decide.
    () => supabase.from("workout_session_exercises").select("id, session_id, exercise_id, exercise_name, workout_sets(reps, completed_at)").eq("user_id", userId).in("session_id", ids).limit(200),
  );
  if (!exerciseRows.length) return [];
  let library: Awaited<ReturnType<typeof loadLibraryMuscles>>["rows"];
  try {
    const result = await loadLibraryMuscles(supabase, exerciseRows.map((row) => row.exercise_id));
    if (result.error) return [];
    library = result.rows;
  } catch {
    return [];
  }
  const logged: LoggedSession[] = lastWeek.map((session) => ({
    id: session.id, name: "", status: session.status, started_at: session.started_at, completed_at: null,
    exercises: exerciseRows.filter((row) => row.session_id === session.id).map((row) => ({
      id: row.id, exercise_id: row.exercise_id ?? null, name: row.exercise_name ?? "", target_duration_seconds: null,
      library: row.exercise_id ? library.get(survivingExerciseId(row.exercise_id)) ?? null : null,
      sets: (row.workout_sets ?? []).map((set) => ({ reps: set.reps ?? null, weight_kg: null, duration_seconds: set.duration_seconds ?? null, completed_at: set.completed_at ?? null })),
    })),
  }));
  return regionsTrained(summariseMuscles(logged, { start: new Date(since), end: null }));
}

/**
 * Where meals come from and the nutrition goal (onboarding v3) go to the coach in the summary and the meal-plan
 * rules: the privacy page's AI coach section and the consent list name them ("where your meals come from" and
 * "your nutrition goal"). Turning this off keeps them for the quick prompts and the protein target only.
 */
export const FOOD_HABITS_IN_SUMMARY = true;

/**
 * `activities`: put the last 4 weeks of activities in the summary. Only for a consent whose screen listed them
 * (store.ACTIVITIES_CONSENT_VERSION); coach.ts decides.
 */
export function buildCoachContext(sources: ContextSources, now = new Date(), options: { foodHabits?: boolean; activities?: boolean } = {}): CoachContext {
  const prefs = sources.preferences ?? {};
  const profile = sources.profile ?? {};
  const timeZone = validTimeZone(text(prefs.timezone)) ?? "UTC";
  const today = localDate(now, timeZone);
  // Profile's own readers (user-context.ts), so the daily targets match Home, Nutrition and Profile.
  const memberProfile = normalizeProfile(sources.profile, new Date(`${today}T12:00:00`));
  const memberPrefs = normalizePreferences(sources.preferences).values;
  const answered = (key: string) => prefs[key] !== null && prefs[key] !== undefined && prefs[key] !== "";
  // Onboarding no longer asks where, with what, at which level or how many days a member trains, yet it creates
  // the preferences row, so until the Workouts setup is done those columns hold their defaults (gym, bodyweight,
  // beginner, 3 days): the summary then leaves them out rather than tell the coach the member said so.
  const setupDone = isWorkoutSetupDone({ setupAt: text(prefs.workout_setup_at), hasEquipmentList: sources.equipmentListSaved === true });
  const daysPerWeek = setupDone ? integer(prefs.workouts_per_week, 1, 7) : null;

  // From the birth date on the member's own date: the stored age is only refreshed when the profile is saved.
  const age = integer(profileAge(profile, today), 13, 100);
  const minor = age !== null && age < 18;
  const adult = age !== null && age >= 18;
  const sex = profile.gender === "male" || profile.gender === "female" ? profile.gender : null;
  const latestWeighIn = sources.weighIns.find((entry) => positive(entry.weight) !== null);
  const weight = positive(latestWeighIn?.weight) ?? positive(profile.weight);
  const height = positive(profile.height);

  const goal = text(prefs.primary_goal) ?? "general_fitness";
  const activity = text(prefs.activity_level) ?? "moderate";
  const floor = calorieFloor(sex);
  // The shared target rules, as Home and Nutrition work them out (targetsFor: goal, activity and nutrition goal).
  const estimated = minor || !memberProfile ? null : targetsFor({ ...memberProfile, age, gender: sex, height }, memberPrefs, weight);
  const target = estimated ? { ...estimated, calories: Math.max(estimated.calories, floor) } : null;

  // Onboarding v2 keeps the diet in diet_type plus food_rules. The first onboarding's labels
  // (dietary_preferences) count as Profile reads them (user-context.ts): the diet label while diet_type is
  // empty, and the food-rule labels ("Pescatarian", "Low carb") only on a database without food_rules. With
  // that column, Profile edits the rules there, so a rule removed in Profile no longer reaches the coach.
  const dietType = normalizeDietType(prefs.diet_type, prefs.dietary_preferences);
  const legacyRules = prefs.food_rules === undefined ? list(prefs.dietary_preferences) : [];
  const diet = dietRulesFrom([...(dietType ? [dietType] : []), ...list(prefs.food_rules), ...legacyRules]);
  const allergies = allergyRulesFrom([...list(prefs.allergies), ...list(prefs.other_allergies)]);
  const budget = budgetText(prefs);
  // Onboarding v3 answers. "No specific preference" tells the coach nothing, so it is left out.
  const source = prefs.food_source;
  const foodSource: FoodSource | null = source === "home" || source === "outside" || source === "both" ? source : null;
  const focus = prefs.nutrition_focus;
  const nutritionFocus: MemberFacts["nutritionFocus"] = focus === "high_protein" || focus === "balanced" ? focus : null;
  const equipment = [...new Set(list(prefs.equipment).map((item) => normalizeEquipment(String(item))).filter(Boolean))].slice(0, 20);
  const foodHabits = options.foodHabits ?? FOOD_HABITS_IN_SUMMARY;
  const nutritionGoal = answered("nutrition_focus") ? optionLabel(NUTRITION_FOCUS_OPTIONS, memberPrefs.nutrition_focus) : null;

  const facts: MemberFacts = {
    age,
    minor,
    adult,
    sex,
    today,
    timeZone,
    diet,
    allergies,
    target,
    calorieFloor: floor,
    budget,
    foodSource,
    nutritionFocus,
    location: text(prefs.workout_location) ?? "gym",
    equipment: equipment.length ? equipment : ["bodyweight"],
    level: text(prefs.fitness_level) ?? "beginner",
    goal,
    sessionMinutes: integer(prefs.session_duration_minutes, 15, 180) ?? 45,
    split: text(prefs.workout_split) ?? "full_body",
    recentMuscles: sources.recentMuscles.slice(0, 12),
    foodHabitsShared: foodHabits,
    nutritionGoal,
  };

  const summary: Record<string, unknown> = {
    v: 1,
    today,
    member: compact({
      age,
      sex,
      height_cm: height,
      weight_kg: weight,
      target_weight_kg: positive(profile.target_weight),
      experience: cleanText(profile.experience, 30),
    }),
    goal,
    activity_level: activity,
    training_setup: compact({
      location: setupDone ? facts.location : null,
      equipment: setupDone ? facts.equipment : null,
      level: setupDone ? facts.level : null,
      days_per_week: daysPerWeek,
      minutes_per_session: facts.sessionMinutes,
      split: facts.split,
      limitations: limitationsText(prefs),
    }),
    food_preferences: compact({
      diet: describeDiet(diet),
      allergies: describeAllergies(allergies),
      meals_per_day: integer(prefs.meals_per_day, 1, 8),
      meals_from: foodHabits && foodSource ? FOOD_SOURCE_TEXT[foodSource] : null,
      nutrition_focus: foodHabits && nutritionFocus ? humanize(nutritionFocus) : null,
      budget,
      cuisines: shortList(prefs.cuisines, 6, 30).map(humanize),
      dislikes: shortList(prefs.food_dislikes ?? prefs.disliked_foods, 10, 30),
      prefers_low_carb: list(prefs.food_rules).includes("low_carb") || legacyRules.some((item) => /low.?carb/i.test(String(item))) || null,
    }),
    daily_targets: target ? { ...target, basis: "FITX estimate from age, height, weight, sex, activity and goal" } : null,
    nutrition: nutritionSummary(sources.meals, today),
    my_custom_foods: shortList(sources.customFoods.map((food) => food.name), 15, 40),
    weight_trend: weightTrend(sources.weighIns, today),
    training_last_28_days: trainingSummary(sources.sessions, sources.recentMuscles, today, daysPerWeek),
    personal_records: sources.records
      .filter((record) => cleanText(record.exercise_name, 60))
      .slice(0, 8)
      .map((record) => compact({
        exercise: cleanText(record.exercise_name, 60),
        best: positive(record.best_weight_kg) ? `${round1(Number(record.best_weight_kg))} kg x ${integer(record.best_reps, 1, 500) ?? 1}` : `${integer(record.best_reps, 1, 500) ?? 1} reps`,
        estimated_1rm_kg: positive(record.estimated_one_rep_max),
        date: dateOnly(record.achieved_at),
      })),
    active_goals: sources.goals
      .filter((goalRow) => cleanText(goalRow.title, 80))
      .map((goalRow) => compact({
        title: cleanText(goalRow.title, 80),
        category: cleanText(goalRow.category, 20),
        progress: goalProgressText(goalRow),
        due: dateOnly(goalRow.due_on),
      })),
    next_7_days: {
      planned_workouts: sources.planner.filter((event) => event.event_type === "workout").length,
      other_events: sources.planner.filter((event) => event.event_type !== "workout").length,
    },
  };
  if (options.activities && sources.activities) summary.activities_last_28_days = activitySummary(sources.activities, today);
  return { facts, summary };
}

const knownNumber = (value: unknown) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));

/**
 * A goal's progress as the goals table stores it, or null when that column is not its progress. In goals v2
 * (20261118120001) current_value is kept only for a goal the member logs by hand, as a lifetime total (baseline
 * plus entries), so it is the progress only of a long-term one. Automatic goals (workouts, food, water, weight,
 * To-Dos), distance and active-minutes goals (manual with a reserved unit) and daily or weekly goals are measured
 * per period by fitx_goal_progress (data/goals.ts), and their column keeps its default 0: never their progress.
 */
export function storedGoalProgress(goal: { metric?: unknown; period?: unknown; unit?: unknown; current_value: unknown }): number | null {
  if (goal.metric !== "manual" || goal.period !== "long_term" || clientMetricForUnit(goal.unit) !== null) return null;
  return knownNumber(goal.current_value) ? Number(goal.current_value) : null;
}

const PERIOD_WORDS: Record<string, string> = { daily: " a day", weekly: " a week" };

/** "1 of 4 kg", "unknown of 4 workouts a week"; an unknown value is said to be unknown, never counted as 0. */
function goalProgressText(goal: ContextSources["goals"][number]): string | null {
  if (!knownNumber(goal.target_value)) return null;
  const unit = goal.unit && clientMetricForUnit(goal.unit) === null ? ` ${cleanText(goal.unit, 12) ?? ""}`.trimEnd() : "";
  const progress = storedGoalProgress(goal);
  return `${progress !== null ? round1(progress) : "unknown"} of ${round1(Number(goal.target_value))}${unit}${PERIOD_WORDS[String(goal.period)] ?? ""}`;
}

function nutritionSummary(meals: ContextSources["meals"], today: string) {
  const start = shiftDate(today, -6);
  const inWeek = meals.filter((meal) => meal.date >= start && meal.date <= today);
  const byDay = new Map<string, Macros>();
  for (const meal of inWeek) {
    const total = byDay.get(meal.date) ?? { calories: 0, protein: 0, carbs: 0, fat: 0 };
    total.calories += num(meal.calories);
    total.protein += num(meal.protein);
    total.carbs += num(meal.carbs);
    total.fat += num(meal.fat);
    byDay.set(meal.date, total);
  }
  const logged = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  const average = logged.length
    ? {
        calories: Math.round(logged.reduce((sum, [, day]) => sum + day.calories, 0) / logged.length),
        protein: round1(logged.reduce((sum, [, day]) => sum + day.protein, 0) / logged.length),
        carbs: round1(logged.reduce((sum, [, day]) => sum + day.carbs, 0) / logged.length),
        fat: round1(logged.reduce((sum, [, day]) => sum + day.fat, 0) / logged.length),
      }
    : null;
  const todayTotal = byDay.get(today);
  // A food logged without a calorie or protein value is left out of the totals, and the summary says how many.
  const missing = (field: "calories" | "protein") => inWeek.filter((meal) => meal[field] === null || meal[field] === undefined).length;
  const counts = new Map<string, number>();
  for (const meal of inWeek) {
    const name = cleanText(meal.food_name, 40);
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return {
    days_logged_last_7: logged.length,
    average_per_logged_day: average,
    by_day: logged.map(([date, day]) => ({ date, kcal: Math.round(day.calories), protein_g: round1(day.protein) })),
    today: todayTotal
      ? { kcal: Math.round(todayTotal.calories), protein_g: round1(todayTotal.protein), carbs_g: round1(todayTotal.carbs), fat_g: round1(todayTotal.fat), items_logged: inWeek.filter((meal) => meal.date === today).length }
      : { items_logged: 0 },
    ...(missing("calories") ? { foods_without_calories: missing("calories") } : {}),
    ...(missing("protein") ? { foods_without_protein: missing("protein") } : {}),
    most_logged_foods: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name]) => name),
  };
}

function weightTrend(entries: ContextSources["weighIns"], today: string) {
  const valid = entries.filter((entry) => positive(entry.weight) !== null && entry.date <= today).sort((a, b) => b.date.localeCompare(a.date));
  if (!valid.length) return null;
  const latest = valid[0];
  const changeSince = (days: number) => {
    const since = shiftDate(today, -days);
    const older = valid.filter((entry) => entry.date <= since)[0] ?? valid.filter((entry) => entry.date >= since).at(-1);
    return older && older !== latest ? round1(Number(latest.weight) - Number(older.weight)) : null;
  };
  return compact({ latest_kg: round1(Number(latest.weight)), latest_date: latest.date, change_30_days_kg: changeSince(30), change_90_days_kg: changeSince(90), weigh_ins_90_days: valid.length });
}

function trainingSummary(sessions: ContextSources["sessions"], muscles: string[], today: string, perWeek: number | null) {
  const completed = sessions.filter((session) => session.status === "completed");
  const weeks = [0, 0, 0, 0];
  for (const session of completed) {
    const age = daysBetween(dateOnly(session.started_at) ?? today, today);
    if (age >= 0 && age < 28) weeks[3 - Math.floor(age / 7)] += 1;
  }
  return compact({
    sessions_completed: completed.length,
    sessions_planned: perWeek ? perWeek * 4 : null,
    sessions_per_week_oldest_first: weeks,
    total_minutes: Math.round(completed.reduce((sum, session) => sum + num(session.duration_seconds), 0) / 60),
    total_volume_kg: Math.round(completed.reduce((sum, session) => sum + num(session.total_volume), 0)),
    last_session: completed[0] ? dateOnly(completed[0].started_at) : null,
    muscles_trained_last_7_days: muscles.slice(0, 12),
  });
}

/**
 * Activities of the last 28 days per sport: how many, distance (km, one decimal) and moving time (minutes), plus the
 * newest date. Distances are only summed when every activity of that sport has one (unknown is never 0).
 */
export function activitySummary(rows: NonNullable<ContextSources["activities"]>, today: string) {
  const bySport = new Map<string, { count: number; km: number | null; minutes: number; climb_m: number | null }>();
  for (const row of rows) {
    const sport = cleanText(row.sport, 20);
    if (!sport) continue;
    const entry = bySport.get(sport) ?? { count: 0, km: 0, minutes: 0, climb_m: 0 };
    entry.count += 1;
    const metres = knownNumber(row.distance_m) ? Number(row.distance_m) : null;
    entry.km = entry.km === null || metres === null ? null : entry.km + metres / 1000;
    entry.minutes += num(row.moving_seconds) / 60;
    const climb = knownNumber(row.elevation_gain_m) ? Number(row.elevation_gain_m) : null;
    entry.climb_m = entry.climb_m === null || climb === null ? null : entry.climb_m + climb;
    bySport.set(sport, entry);
  }
  const newest = rows.map((row) => dateOnly(row.started_at)).filter((date): date is string => Boolean(date)).sort().at(-1) ?? null;
  return {
    count: [...bySport.values()].reduce((sum, entry) => sum + entry.count, 0),
    by_sport: Object.fromEntries([...bySport].map(([sport, entry]) => [sport, compact({
      count: entry.count,
      km: entry.km === null ? null : round1(entry.km),
      moving_minutes: Math.round(entry.minutes),
      climb_m: entry.climb_m === null ? null : Math.round(entry.climb_m),
    })])),
    last_activity: newest,
    days_since_last: newest ? daysBetween(newest, today) : null,
  };
}

function budgetText(prefs: Record<string, unknown>): string | null {
  // Letters only for the words: this text goes into the coach's instructions.
  const word = (value: unknown, max: number) => {
    const text = cleanText(value, max);
    return text && /^[A-Za-z ]+$/.test(text) ? text.toLowerCase() : null;
  };
  // Onboarding v2: a monthly amount in rupees and/or a level (tight, moderate, flexible).
  const monthly = positive(prefs.monthly_food_budget_inr);
  const levelV2 = word(prefs.food_budget_level, 12);
  if (monthly) return `₹${Math.round(monthly)} per month (about ₹${Math.round(monthly / 30)} a day)${levelV2 ? `, ${levelV2}` : ""}`;
  if (levelV2) return `${levelV2} budget`;
  const amount = positive(prefs.food_budget_amount ?? prefs.food_budget);
  if (amount) {
    const currency = (word(prefs.food_budget_currency, 6) ?? "inr").toUpperCase();
    const period = word(prefs.food_budget_period, 10) ?? "day";
    return `${currency === "INR" ? "₹" : `${currency} `}${Math.round(amount)} per ${period}`;
  }
  const level = word(prefs.food_budget_level ?? prefs.budget_level, 20);
  return level ? `${level} budget` : null;
}

/** Typed equipment from older profiles ("Dumbbells", "cable machine") mapped to exercise-library tags. */
const EQUIPMENT_WORDS: Record<string, string> = {
  dumbbells: "dumbbell", barbells: "barbell", kettlebells: "kettlebell", benches: "bench", machines: "machine",
  cables: "cable", "cable machine": "cable", "resistance bands": "bands", "resistance band": "bands", band: "bands",
  "pull up bar": "pull_up_bar", "pullup bar": "pull_up_bar", "chin up bar": "pull_up_bar", "ez bar": "ez_bar",
  "medicine ball": "medicine_ball", "exercise ball": "exercise_ball", "swiss ball": "exercise_ball", "foam roller": "foam_roller",
  "squat rack": "rack", "power rack": "rack", "body weight": "bodyweight", none: "bodyweight",
};

export function normalizeEquipment(item: string) {
  const words = item.toLowerCase().replace(/[_-]+/g, " ").replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();
  return words ? EQUIPMENT_WORDS[words] ?? words.replace(/ /g, "_") : "";
}

/**
 * Injuries or limits to train around: onboarding v2 keys ("lower_back") and custom entries, or older free text.
 * Every entry Profile can save goes in whole: each listed key plus up to 5 notes of 60 characters.
 */
function limitationsText(prefs: Record<string, unknown>): string | null {
  const items = shortList(prefs.limitations, LIMITATION_OPTIONS.length + MAX_CUSTOM_LIMITATIONS, MAX_LIMITATION_LENGTH).map(humanize);
  if (items.length) return items.join(", ");
  return cleanText(prefs.training_limitations ?? prefs.injuries, 200);
}

const FOOD_SOURCE_TEXT: Record<FoodSource, string> = { home: "mostly home-cooked", outside: "mostly outside food", both: "home-cooked and outside food" };

function humanize(value: string) {
  return value.replace(/_/g, " ");
}

/** The member's local date (YYYY-MM-DD) in their time zone. */
export function localDate(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function validTimeZone(zone: string | null) {
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

function dateOnly(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function list(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return typeof value === "string" && value.trim() ? [value] : [];
}

function shortList(value: unknown, max: number, length: number) {
  return list(value).map((item) => cleanText(item, length)).filter((item): item is string => item !== null).slice(0, max);
}

function num(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function positive(value: unknown): number | null {
  const number = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(number) && number > 0 ? round1(number) : null;
}

function integer(value: unknown, min: number, max: number) {
  const number = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isInteger(number) && number >= min && number <= max ? number : null;
}

/** Drops empty fields so the summary stays short. */
function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined && !(Array.isArray(item) && item.length === 0))) as Partial<T>;
}
