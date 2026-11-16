/**
 * Today's numbers for Home: reading fitx_today_summary, building the same summary from raw rows
 * when that function is not available yet, and deciding each daily target and where it came from
 * (the user's own goal, the targets they set in Nutrition, their saved preference, or an estimate
 * from their profile).
 *
 * No runtime imports beyond other pure domain files, so `node --test` can load it directly.
 */
import { addDays, weekKeys } from "./day-keys";
import { evaluateGoal, dailyGoalFor, type GoalView } from "./goals";
import { estimateNutritionTargets, type FoodMacros } from "./nutrition";

export type WeighIn = { kg: number; date: string | null };
export type PlannedWorkout = { id: string; title: string; startsAt: string | null; status: string; workoutPlanId: string | null };

export type TodaySummary = {
  localDate: string;
  timezone: string;
  weekStart: string;
  nutrition: FoodMacros & { entries: number };
  water: { ml: number; entries: number };
  workouts: { today: number; week: number; weekDays: Array<{ date: string; count: number }> };
  weight: WeighIn | null;
  previousWeight: WeighIn | null;
  profile: { name: string | null; age: number | null; gender: string | null; height: number | null; weight: number | null; targetWeight: number | null };
  /** Null when the user has no preferences row: no workout or water target is invented then. */
  preferences: { workoutsPerWeek: number | null; dailyWaterGoalMl: number | null; activityLevel: string | null; primaryGoal: string | null } | null;
  plannedWorkouts: PlannedWorkout[];
  /** Null when the To-Do list is not available yet. */
  todo: { total: number; completed: number } | null;
  /** The daily calorie and macro targets the user set in Nutrition (nutrition_targets), or null. */
  targets: FoodMacros | null;
};

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
};
const str = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const obj = (value: unknown): Record<string, unknown> | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

function weighIn(value: unknown): WeighIn | null {
  const row = obj(value);
  const kg = num(row?.kg);
  return row && kg !== null ? { kg, date: str(row.date) } : null;
}

/** Reads the JSON fitx_today_summary returns. Missing parts become zeros or nulls, never guesses. */
export function parseTodaySummary(raw: unknown): TodaySummary | null {
  const root = obj(raw);
  if (!root || !str(root.local_date)) return null;
  const nutrition = obj(root.nutrition) ?? {};
  const water = obj(root.water) ?? {};
  const workouts = obj(root.workouts) ?? {};
  const profile = obj(root.profile) ?? {};
  const preferences = obj(root.preferences);
  const todo = obj(root.todo);
  const localDate = str(root.local_date)!;
  return {
    localDate,
    timezone: str(root.timezone) ?? "UTC",
    weekStart: str(root.week_start) ?? weekKeys(localDate)[0],
    nutrition: {
      calories: num(nutrition.calories) ?? 0,
      protein: num(nutrition.protein) ?? 0,
      carbs: num(nutrition.carbs) ?? 0,
      fat: num(nutrition.fat) ?? 0,
      entries: num(nutrition.entries) ?? 0,
    },
    water: { ml: num(water.ml) ?? 0, entries: num(water.entries) ?? 0 },
    workouts: {
      today: num(workouts.today) ?? 0,
      week: num(workouts.week) ?? 0,
      weekDays: Array.isArray(workouts.week_days)
        ? workouts.week_days.flatMap((day) => {
          const row = obj(day);
          const date = str(row?.date);
          return date ? [{ date, count: num(row?.count) ?? 0 }] : [];
        })
        : [],
    },
    weight: weighIn(root.weight),
    previousWeight: weighIn(root.previous_weight),
    profile: {
      name: str(profile.name),
      age: num(profile.age),
      gender: str(profile.gender),
      height: num(profile.height),
      weight: num(profile.weight),
      targetWeight: num(profile.target_weight),
    },
    preferences: preferences
      ? {
        workoutsPerWeek: num(preferences.workouts_per_week),
        dailyWaterGoalMl: num(preferences.daily_water_goal_ml),
        activityLevel: str(preferences.activity_level),
        primaryGoal: str(preferences.primary_goal),
      }
      : null,
    plannedWorkouts: Array.isArray(root.planned_workouts)
      ? root.planned_workouts.flatMap((item) => {
        const row = obj(item);
        return row && str(row.id) ? [{ id: String(row.id), title: String(row.title ?? ""), startsAt: str(row.starts_at), status: String(row.status ?? "scheduled"), workoutPlanId: str(row.workout_plan_id) }] : [];
      })
      : [],
    todo: todo ? { total: num(todo.total) ?? 0, completed: num(todo.completed) ?? 0 } : null,
    targets: macros(root.targets),
  };
}

/** Calorie and macro targets from {calories, protein, carbs, fat}, or null when calories are missing. */
function macros(value: unknown): FoodMacros | null {
  const row = obj(value);
  const calories = num(row?.calories);
  if (!row || calories === null || calories <= 0) return null;
  return { calories, protein: num(row.protein) ?? 0, carbs: num(row.carbs) ?? 0, fat: num(row.fat) ?? 0 };
}

export type SummaryRows = {
  localDate: string;
  timezone: string;
  meals: Array<{ calories?: unknown; protein?: unknown; carbs?: unknown; fat?: unknown }>;
  water: Array<{ amount_ml?: unknown }>;
  /** Completed sessions this week, each with the local day it started on. */
  sessions: Array<{ localDate: string }>;
  /** Newest first. */
  weights: Array<{ weight?: unknown; date?: unknown }>;
  profile: Record<string, unknown> | null;
  preferences: Record<string, unknown> | null;
  plannedWorkouts: PlannedWorkout[];
};

/** The same summary from rows the browser fetched, for a database without fitx_today_summary. */
export function summaryFromRows(rows: SummaryRows): TodaySummary {
  const sum = (list: Array<Record<string, unknown>>, key: string) => list.reduce((total, row) => total + (num(row[key]) ?? 0), 0);
  const week = weekKeys(rows.localDate);
  const counts = new Map<string, number>();
  for (const session of rows.sessions) if (week.includes(session.localDate)) counts.set(session.localDate, (counts.get(session.localDate) ?? 0) + 1);
  const weights = rows.weights.flatMap((row) => {
    const kg = num(row.weight);
    return kg === null ? [] : [{ kg, date: str(row.date) }];
  });
  return parseTodaySummary({
    local_date: rows.localDate,
    timezone: rows.timezone,
    week_start: week[0],
    nutrition: {
      calories: sum(rows.meals as Array<Record<string, unknown>>, "calories"),
      protein: sum(rows.meals as Array<Record<string, unknown>>, "protein"),
      carbs: sum(rows.meals as Array<Record<string, unknown>>, "carbs"),
      fat: sum(rows.meals as Array<Record<string, unknown>>, "fat"),
      entries: rows.meals.length,
    },
    water: { ml: sum(rows.water as Array<Record<string, unknown>>, "amount_ml"), entries: rows.water.length },
    workouts: {
      today: counts.get(rows.localDate) ?? 0,
      week: [...counts.values()].reduce((total, count) => total + count, 0),
      week_days: [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count })),
    },
    weight: weights[0] ?? null,
    previous_weight: weights[1] ?? null,
    profile: rows.profile ?? {},
    preferences: rows.preferences,
    planned_workouts: rows.plannedWorkouts.map((item) => ({ id: item.id, title: item.title, starts_at: item.startsAt, status: item.status, workout_plan_id: item.workoutPlanId })),
    todo: null,
  })!;
}

export type TargetSource = "goal" | "target" | "preference" | "estimate";
export type DailyTarget = {
  value: number;
  target: number | null;
  source: TargetSource | null;
  /** "limit" when the user's own goal is to stay under the target. */
  direction: "increase" | "limit";
  percent: number;
  /** How far the day went past a ceiling: a limit goal, a target set in Nutrition or an estimate. 0 otherwise. */
  over: number;
};

/**
 * The user's own goal wins; otherwise the first positive fallback, in the order given. A "reach at
 * least" goal that is passed is met, not over, so only ceilings report `over`.
 */
function target(value: number, goal: GoalView | null, ...fallbacks: Array<[number | null | undefined, TargetSource]>): DailyTarget {
  const fallback = fallbacks.find(([amount]) => typeof amount === "number" && Number.isFinite(amount) && amount > 0) ?? null;
  const amount = goal ? goal.targetValue : fallback ? Number(fallback[0]) : null;
  const direction = goal?.direction === "limit" ? "limit" : "increase";
  const evaluation = amount ? evaluateGoal({ current: value, target: amount, direction: "limit" }) : null;
  return {
    value,
    target: amount,
    source: goal ? "goal" : fallback ? fallback[1] : null,
    direction,
    percent: evaluation?.percent ?? 0,
    over: goal && direction !== "limit" ? 0 : evaluation?.over ?? 0,
  };
}

/**
 * The calorie and protein estimate from the profile and the newest weigh-in (so a weigh-in on
 * Progress updates the target straight away), or null when age, height or weight are missing.
 */
export function estimatedTargets(summary: TodaySummary): FoodMacros | null {
  return estimateNutritionTargets(
    { age: summary.profile.age, gender: summary.profile.gender, height: summary.profile.height, weight: summary.weight?.kg ?? summary.profile.weight },
    summary.preferences?.activityLevel ?? undefined,
    summary.preferences?.primaryGoal ?? undefined,
  );
}

/** The user's own Nutrition targets, else the estimate: what goal templates prefill from. */
export function dailyTargets(summary: TodaySummary): FoodMacros | null {
  return summary.targets ?? estimatedTargets(summary);
}

/**
 * Each daily number with the target it is measured against and where that target came from: the
 * user's daily goal, then the targets they set in Nutrition, then (water) their saved setting or
 * (food) the estimate. Matches the Nutrition page, which also puts set targets before the estimate.
 */
export function todayTargets(summary: TodaySummary, goals: readonly GoalView[] | null | undefined) {
  const estimate = estimatedTargets(summary);
  const set = summary.targets;
  const today = summary.localDate;
  return {
    estimate,
    calories: target(summary.nutrition.calories, dailyGoalFor(goals, "calories_kcal", today), [set?.calories, "target"], [estimate?.calories, "estimate"]),
    protein: target(summary.nutrition.protein, dailyGoalFor(goals, "protein_g", today), [set?.protein, "target"], [estimate?.protein, "estimate"]),
    carbs: target(summary.nutrition.carbs, null, [set?.carbs, "target"], [estimate?.carbs, "estimate"]),
    fat: target(summary.nutrition.fat, null, [set?.fat, "target"], [estimate?.fat, "estimate"]),
    water: target(summary.water.ml, dailyGoalFor(goals, "water_ml", today), [summary.preferences?.dailyWaterGoalMl, "preference"]),
  };
}

export type WeightView = {
  current: number | null;
  date: string | null;
  /** Change since the weigh-in before, rounded to 0.1 kg. */
  change: number | null;
  changeSince: string | null;
  target: number | null;
  targetSource: "goal" | "profile" | null;
  start: number | null;
  toGo: number | null;
  percent: number | null;
};

/** The weight card: newest weigh-in, change since the previous one, and progress to a target. */
export function weightView(summary: TodaySummary, goals: readonly GoalView[] | null | undefined): WeightView {
  const goal = (goals ?? []).find((item) => item.metric === "body_weight_kg" && item.status === "active") ?? null;
  const current = summary.weight?.kg ?? null;
  const previous = summary.previousWeight?.kg ?? null;
  const targetValue = goal?.targetValue ?? summary.profile.targetWeight ?? null;
  const start = goal?.startValue ?? null;
  // Without a goal the profile's target has no direction: above it means losing; below it means
  // gaining, unless an earlier weight (the previous weigh-in or the profile) was above it.
  const reference = summary.previousWeight?.kg ?? summary.profile.weight ?? current;
  const direction = goal
    ? goal.direction
    : current !== null && targetValue !== null && (current > targetValue || (reference !== null && reference > targetValue)) ? "decrease" : "increase";
  const evaluation = current !== null && targetValue ? evaluateGoal({ current, target: targetValue, direction, start }) : null;
  return {
    current,
    date: summary.weight?.date ?? null,
    change: current !== null && previous !== null ? Math.round((current - previous) * 10) / 10 : null,
    changeSince: previous !== null ? summary.previousWeight?.date ?? null : null,
    target: targetValue,
    targetSource: goal ? "goal" : targetValue !== null ? "profile" : null,
    start,
    toGo: evaluation?.remaining ?? null,
    percent: goal && start !== null && evaluation ? evaluation.percent : null,
  };
}

/** Monday to Sunday with the workouts finished each day. */
export function weekStrip(summary: TodaySummary) {
  const counts = new Map(summary.workouts.weekDays.map((day) => [day.date, day.count]));
  return weekKeys(summary.localDate).map((date) => ({
    date,
    count: counts.get(date) ?? 0,
    isToday: date === summary.localDate,
    isFuture: date > summary.localDate,
  }));
}

/** The day after `localDate`, for scheduling the midnight refresh. */
export function nextDay(localDate: string): string {
  return addDays(localDate, 1);
}
