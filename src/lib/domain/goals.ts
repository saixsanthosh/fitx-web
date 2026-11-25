/**
 * Goals v2: what a goal measures, how its progress is judged, and how it is described.
 *
 * The database (fitx_goal_progress) measures the raw value for the goal's current period; this file
 * turns that value into a percentage, an achieved/over-limit state and words. Daily goals restart
 * every day, weekly goals every Monday, and long-term goals run from their start to their due date.
 *
 * Imports only other pure domain files, so `node --test` can load this file directly.
 */
import { addDays, mondayOf } from "./day-keys";
import { localDateKey } from "./dates";
import type { FoodMacros } from "./nutrition";

export type GoalPeriod = "daily" | "weekly" | "long_term";
export type GoalDirection = "increase" | "decrease" | "limit";
export type GoalMetric =
  | "manual" | "calories_kcal" | "protein_g" | "water_ml" | "workouts_completed" | "body_weight_kg" | "tasks_completed"
  | ClientMetric;
/**
 * Goals measured in the browser from recorded activities (and finished workouts). The database only knows the
 * seven metrics above (goals_metric_check), so these are stored as a manual goal whose unit is a reserved marker
 * (CLIENT_METRIC_UNITS) and measured by the app (src/lib/data/goals.ts) from the member's own rows.
 */
export type ClientMetric = "activity_distance_km" | "active_minutes";
export type GoalStatus = "active" | "paused" | "completed" | "cancelled";
export type GoalCategory = "fitness" | "nutrition" | "body" | "consistency" | "personal";

export const GOAL_PERIODS: readonly GoalPeriod[] = ["daily", "weekly", "long_term"];
export const GOAL_CATEGORIES: readonly GoalCategory[] = ["fitness", "nutrition", "body", "consistency", "personal"];

export const PERIOD_LABELS: Record<GoalPeriod, string> = { daily: "Daily", weekly: "Weekly", long_term: "Long-term" };
export const CATEGORY_LABELS: Record<GoalCategory, string> = { fitness: "Fitness", nutrition: "Nutrition", body: "Body", consistency: "Consistency", personal: "Personal" };

type MetricInfo = {
  label: string;
  /** Unit stored with the goal and shown next to numbers. */
  unit: string;
  /** Where the progress comes from, in the user's words. */
  source: string;
  periods: readonly GoalPeriod[];
  directions: readonly GoalDirection[];
  category: GoalCategory;
};

export const GOAL_METRICS: Record<GoalMetric, MetricInfo> = {
  manual: { label: "Logged by you", unit: "", source: "You log progress", periods: GOAL_PERIODS, directions: ["increase"], category: "personal" },
  calories_kcal: { label: "Calories", unit: "kcal", source: "From the food you log", periods: ["daily", "weekly"], directions: ["increase", "limit"], category: "nutrition" },
  protein_g: { label: "Protein", unit: "g", source: "From the food you log", periods: ["daily", "weekly"], directions: ["increase"], category: "nutrition" },
  water_ml: { label: "Water", unit: "ml", source: "From the water you log", periods: ["daily", "weekly"], directions: ["increase"], category: "nutrition" },
  workouts_completed: { label: "Workouts", unit: "workouts", source: "From finished workouts", periods: GOAL_PERIODS, directions: ["increase"], category: "consistency" },
  body_weight_kg: { label: "Body weight", unit: "kg", source: "From your weigh-ins", periods: ["long_term"], directions: ["decrease", "increase"], category: "body" },
  tasks_completed: { label: "Linked To-Dos", unit: "To-Dos", source: "From To-Dos linked to this goal", periods: GOAL_PERIODS, directions: ["increase"], category: "personal" },
  activity_distance_km: { label: "Distance", unit: "km", source: "From your recorded walks, runs, rides and other activities", periods: GOAL_PERIODS, directions: ["increase"], category: "fitness" },
  active_minutes: { label: "Active minutes", unit: "min", source: "Moving time of your activities plus training time of finished workouts", periods: GOAL_PERIODS, directions: ["increase"], category: "fitness" },
};

/**
 * Metrics nothing feeds any more: tasks_completed counted To-Dos linked to the goal, and the To-Do list was
 * removed. Such a goal keeps the count it reached and is never shown as something left to do.
 */
export const RETIRED_METRICS: ReadonlySet<GoalMetric> = new Set<GoalMetric>(["tasks_completed"]);

/** The unit a client-measured goal is stored with (as metric 'manual'); reserved, so a custom goal cannot use it. */
export const CLIENT_METRIC_UNITS: Readonly<Record<ClientMetric, string>> = {
  activity_distance_km: "km (activities)",
  active_minutes: "min (active time)",
};

export function isClientMetric(metric: unknown): metric is ClientMetric {
  return metric === "activity_distance_km" || metric === "active_minutes";
}

/** The client metric a stored manual goal stands for, from its reserved unit; null for an ordinary manual goal. */
export function clientMetricForUnit(unit: unknown): ClientMetric | null {
  if (typeof unit !== "string") return null;
  const wanted = unit.trim().toLowerCase();
  for (const metric of Object.keys(CLIENT_METRIC_UNITS) as ClientMetric[]) if (CLIENT_METRIC_UNITS[metric] === wanted) return metric;
  return null;
}

export function isGoalMetric(value: unknown): value is GoalMetric {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(GOAL_METRICS, value);
}

/** A goal as the app uses it, with its measured progress for the current period. */
export type GoalView = {
  id: string;
  title: string;
  category: GoalCategory;
  metric: GoalMetric;
  period: GoalPeriod;
  direction: GoalDirection;
  targetValue: number;
  baselineValue: number | null;
  unit: string;
  startsOn: string;
  dueOn: string | null;
  status: GoalStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string | null;
  completedAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  /** The measured value for the period; null when there is nothing to measure yet (no weigh-in). */
  currentValue: number | null;
  /** For body weight: the date of the weigh-in behind currentValue. */
  valueAsOf: string | null;
  /** Where progress is measured from: the baseline, or for weight the first relevant weigh-in. */
  startValue: number | null;
  linkedTodos: number;
  linkedTodosDone: number;
  /**
   * Calorie and protein goals: food entries in the period without that value (left out of the total, never
   * read as 0); null when not checked.
   */
  missingEntries: number | null;
  /**
   * The total fitx_goal_progress reports when logged corrections add up to less than zero (made before the app
   * refused that), while the goal shows 0. Progress history counts from it, so deleting minus entries is seen to
   * bring the total back up from there, not from 0.
   */
  negativeTotal?: number;
};

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
};
const str = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

/**
 * One row of fitx_goal_progress, or a plain goals row from a database without goals v2. A total is never below
 * zero: fitx_goal_progress adds a manual goal's entries without a floor, so corrections larger than what was
 * logged (made before the app refused them) would read "-35 of 20 lengths"; like the stored total, which a
 * trigger keeps at zero or above, it reads 0.
 */
export function parseGoalRow(raw: Record<string, unknown>): GoalView {
  const stored = isGoalMetric(raw.metric) && !isClientMetric(raw.metric) ? raw.metric : "manual";
  const client = stored === "manual" ? clientMetricForUnit(raw.unit) : null;
  const metric: GoalMetric = client ?? stored;
  const legacy = raw.period === undefined;
  const measured = client ? null : num(raw.current_value) ?? (legacy ? 0 : null);
  return {
    id: String(raw.id),
    title: String(raw.title ?? ""),
    category: pick(raw.category, GOAL_CATEGORIES, "personal"),
    metric,
    period: pick(raw.period, GOAL_PERIODS, "long_term"),
    direction: pick(raw.direction, ["increase", "decrease", "limit"] as const, "increase"),
    targetValue: num(raw.target_value) ?? 0,
    baselineValue: num(raw.baseline_value),
    unit: client ? GOAL_METRICS[client].unit : String(raw.unit ?? ""),
    startsOn: str(raw.starts_on) ?? "",
    dueOn: str(raw.due_on),
    status: pick(raw.status, ["active", "paused", "completed", "cancelled"] as const, "active"),
    notes: str(raw.notes),
    createdAt: str(raw.created_at) ?? "",
    updatedAt: str(raw.updated_at),
    completedAt: str(raw.completed_at),
    periodStart: str(raw.period_start),
    periodEnd: str(raw.period_end),
    // A database without goals v2 has only the browser-kept manual total. A client-measured goal has no value
    // until the app measures it (src/lib/data/goals.ts): the stored manual total is not its progress.
    currentValue: measured === null ? null : Math.max(0, measured),
    valueAsOf: str(raw.value_as_of),
    startValue: client ? null : num(raw.start_value) ?? num(raw.baseline_value),
    linkedTodos: num(raw.linked_todos) ?? 0,
    linkedTodosDone: num(raw.linked_todos_done) ?? 0,
    missingEntries: null,
    ...(measured !== null && measured < 0 ? { negativeTotal: measured } : {}),
  };
}

export type GoalState = "no_data" | "in_progress" | "achieved" | "within_limit" | "over_limit";
export type GoalEvaluation = {
  state: GoalState;
  /** 0–100 for the bar. For a limit it is the share of the limit used. */
  percent: number;
  /** True when the goal counts as met for this period. */
  achieved: boolean;
  /** Still to go (increase, decrease) or still left under a limit; null without data. */
  remaining: number | null;
  /** How far past a limit the period went. */
  over: number;
};

const clampPercent = (fraction: number) => Math.max(0, Math.min(100, Math.round(fraction * 100)));
const tidy = (value: number) => Math.round(value * 100) / 100;

/**
 * Judges progress. `start` is where the goal began (baseline or first weigh-in); it matters for
 * weight goals, where 80 → 72 kg is 50% done at 76 kg. Without a start, increase goals count from 0.
 */
export function evaluateGoal(input: { current: number | null; target: number; direction: GoalDirection; start?: number | null }): GoalEvaluation {
  const { current, target, direction } = input;
  const start = input.start ?? null;
  if (!Number.isFinite(target) || target <= 0 || current === null || !Number.isFinite(current)) {
    return { state: "no_data", percent: 0, achieved: false, remaining: null, over: 0 };
  }
  if (direction === "limit") {
    const over = tidy(Math.max(0, current - target));
    const logged = current > 0;
    return {
      state: over > 0 ? "over_limit" : logged ? "within_limit" : "in_progress",
      percent: clampPercent(current / target),
      achieved: logged && over === 0,
      remaining: tidy(Math.max(0, target - current)),
      over,
    };
  }
  if (direction === "decrease") {
    const achieved = current <= target;
    const fraction = start !== null && start > target ? (start - current) / (start - target) : achieved ? 1 : 0;
    return { state: achieved ? "achieved" : "in_progress", percent: clampPercent(fraction), achieved, remaining: tidy(Math.max(0, current - target)), over: 0 };
  }
  const base = start ?? 0;
  const achieved = current >= target;
  const fraction = target > base ? (current - base) / (target - base) : achieved ? 1 : 0;
  return { state: achieved ? "achieved" : "in_progress", percent: clampPercent(fraction), achieved, remaining: tidy(Math.max(0, target - current)), over: 0 };
}

export function evaluateView(goal: GoalView): GoalEvaluation {
  return evaluateGoal({ current: goal.currentValue, target: goal.targetValue, direction: goal.direction, start: goal.startValue });
}

const trimNumber = (value: number, digits = 1) => {
  const rounded = Number(value.toFixed(digits));
  return rounded.toLocaleString("en-US", { maximumFractionDigits: digits });
};

/** A value in the goal's unit: "1,250 kcal", "82 g", "1.25 L", "3 workouts", "80.2 kg". */
export function formatGoalValue(value: number | null, metric: GoalMetric, unit = ""): string {
  if (value === null || !Number.isFinite(value)) return "—";
  switch (metric) {
    case "calories_kcal":
      return `${Math.round(value).toLocaleString("en-US")} kcal`;
    case "protein_g":
      return `${Math.round(value).toLocaleString("en-US")} g`;
    case "water_ml":
      return Math.abs(value) >= 1000 ? `${trimNumber(value / 1000, 2)} L` : `${Math.round(value)} ml`;
    case "workouts_completed":
      return `${trimNumber(value, 0)} ${Math.round(value) === 1 ? "workout" : "workouts"}`;
    case "body_weight_kg":
      return `${value.toFixed(1)} kg`;
    case "tasks_completed":
      return `${trimNumber(value, 0)} ${Math.round(value) === 1 ? "To-Do" : "To-Dos"}`;
    case "activity_distance_km":
      return `${trimNumber(value, 1)} km`;
    case "active_minutes":
      return `${Math.round(value).toLocaleString("en-US")} min`;
    default:
      return `${trimNumber(value, 2)}${unit ? ` ${unit}` : ""}`;
  }
}

/** A number in the scale the target is shown in, without the unit ("1.25" for 1,250 ml of a 3 L goal). */
function bareNumber(value: number, metric: GoalMetric, target: number): string {
  switch (metric) {
    case "water_ml":
      return target >= 1000 ? trimNumber(value / 1000, 2) : String(Math.round(value));
    case "calories_kcal":
    case "protein_g":
      return Math.round(value).toLocaleString("en-US");
    case "workouts_completed":
    case "tasks_completed":
    case "active_minutes":
      return trimNumber(value, 0);
    case "body_weight_kg":
      return value.toFixed(1);
    case "activity_distance_km":
      return trimNumber(value, 1);
    default:
      return trimNumber(value, 2);
  }
}

/** "70 of 100 g", "1,200 of 2,000 kcal limit", "1.25 of 3 L", "80.2 kg · target 72.0 kg". */
export function progressSummary(goal: Pick<GoalView, "currentValue" | "targetValue" | "metric" | "unit" | "direction">): string {
  const target = formatGoalValue(goal.targetValue, goal.metric, goal.unit);
  if (goal.metric === "body_weight_kg") {
    return goal.currentValue === null ? `No weigh-in yet · target ${target}` : `${formatGoalValue(goal.currentValue, goal.metric)} · target ${target}`;
  }
  if (goal.currentValue === null) return `Target ${target}`;
  return `${bareNumber(goal.currentValue, goal.metric, goal.targetValue)} of ${target}${goal.direction === "limit" ? " limit" : ""}`;
}

/** What is left, in words: "30 g to go", "550 kcal left", "250 kcal over", "8.2 kg to go", "Done". */
export function remainingLabel(goal: GoalView, evaluation = evaluateView(goal)): string {
  if (RETIRED_METRICS.has(goal.metric) && !evaluation.achieved) return "To-Dos retired";
  if (evaluation.state === "no_data") return goal.metric === "body_weight_kg" ? "Log a weigh-in to start" : "";
  if (evaluation.state === "over_limit") return `${formatGoalValue(evaluation.over, goal.metric, goal.unit)} over`;
  if (goal.direction === "limit") return `${formatGoalValue(evaluation.remaining, goal.metric, goal.unit)} left`;
  if (evaluation.achieved) return goal.period === "long_term" ? "Target reached" : goal.period === "daily" ? "Done today" : "Done this week";
  return `${formatGoalValue(evaluation.remaining, goal.metric, goal.unit)} to go`;
}

/** "31 Dec", with the year when it isn't `today`'s ("31 Dec 2027"), so next year's date never reads as this year's. */
const monthDay = (key: string, today: string) => {
  const [year, month, day] = key.split("-").map(Number);
  const options: Intl.DateTimeFormatOptions = key.slice(0, 4) === today.slice(0, 4) ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" };
  return new Date(year, month - 1, day, 12).toLocaleDateString(undefined, options);
};

/** When the goal's progress applies: "Today", "This week", "Due 31 Dec", "Ended 31 Dec 2025", "Ongoing". */
export function periodLabel(goal: Pick<GoalView, "period" | "dueOn" | "startsOn">, today: string): string {
  if (goal.period === "daily") return "Today";
  if (goal.period === "weekly") return "This week";
  if (goal.startsOn && goal.startsOn > today) return `Starts ${monthDay(goal.startsOn, today)}`;
  if (!goal.dueOn) return "Ongoing";
  return goal.dueOn < today ? `Ended ${monthDay(goal.dueOn, today)}` : `Due ${monthDay(goal.dueOn, today)}`;
}

/** True when a daily or weekly goal applies today (active, started, not past its end date). */
export function appliesOn(goal: Pick<GoalView, "status" | "startsOn" | "dueOn">, today: string): boolean {
  return goal.status === "active" && (!goal.startsOn || goal.startsOn <= today) && (!goal.dueOn || goal.dueOn >= today);
}

const PERIOD_ORDER: Record<GoalPeriod, number> = { daily: 0, weekly: 1, long_term: 2 };
const STATUS_ORDER: Record<GoalStatus, number> = { active: 0, paused: 1, completed: 2, cancelled: 3 };

/** Active first (daily, weekly, long-term), then paused, then completed; oldest first within each. */
export function sortGoals<T extends Pick<GoalView, "status" | "period" | "createdAt">>(goals: readonly T[]): T[] {
  return [...goals].sort((a, b) =>
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    || PERIOD_ORDER[a.period] - PERIOD_ORDER[b.period]
    || a.createdAt.localeCompare(b.createdAt));
}

/** Daily goals that apply today, and how many are met. */
export function dailyGoalsMet(goals: readonly GoalView[], today: string): { met: number; total: number } {
  const daily = goals.filter((goal) => goal.period === "daily" && appliesOn(goal, today));
  return { met: daily.filter((goal) => evaluateView(goal).achieved).length, total: daily.length };
}

/**
 * The days a goal's current period covers, as fitx_goal_progress measures them: today (daily), this Monday to
 * Sunday (weekly), or from the start to the due date or today, whichever is earlier (long-term). The database's
 * own period wins when it sent one. Null for a long-term goal that has not started yet.
 */
export function goalWindow(goal: Pick<GoalView, "period" | "startsOn" | "dueOn" | "periodStart" | "periodEnd">, today: string): { from: string; to: string } | null {
  if (goal.periodStart && goal.periodEnd) return goal.periodStart <= goal.periodEnd ? { from: goal.periodStart, to: goal.periodEnd } : null;
  if (goal.period === "daily") return { from: today, to: today };
  if (goal.period === "weekly") return { from: mondayOf(today), to: addDays(mondayOf(today), 6) };
  const to = goal.dueOn && goal.dueOn < today ? goal.dueOn : today;
  const from = goal.startsOn || to;
  return from <= to ? { from, to } : null;
}

export type GoalActivityRow = { startedAt: string; distanceM: number; movingSeconds: number };
export type GoalSessionRow = { startedAt: string; durationSeconds: number };

function localDay(iso: string): string | null {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? localDateKey(new Date(time)) : null;
}

/**
 * A client-measured goal's value over its window, from the member's own rows (by the local day each started):
 * distance in km from recorded activities; active minutes from activity moving time plus the training time of
 * finished workouts (pauses excluded). Null when a source it needs could not be read: unknown, never 0.
 */
export function clientGoalValue(
  metric: ClientMetric,
  window: { from: string; to: string },
  activities: readonly GoalActivityRow[] | null,
  sessions: readonly GoalSessionRow[] | null,
): number | null {
  if (!activities) return null;
  const inWindow = (iso: string) => {
    const day = localDay(iso);
    return day !== null && day >= window.from && day <= window.to;
  };
  const counted = activities.filter((activity) => inWindow(activity.startedAt));
  if (metric === "activity_distance_km") {
    const metres = counted.reduce((sum, activity) => sum + (Number(activity.distanceM) > 0 ? Number(activity.distanceM) : 0), 0);
    return Math.round(metres / 10) / 100;
  }
  if (!sessions) return null;
  const moving = counted.reduce((sum, activity) => sum + (Number(activity.movingSeconds) > 0 ? Number(activity.movingSeconds) : 0), 0);
  const training = sessions.filter((session) => inWindow(session.startedAt))
    .reduce((sum, session) => sum + (Number(session.durationSeconds) > 0 ? Number(session.durationSeconds) : 0), 0);
  return Math.round((moving + training) / 6) / 10;
}

/** The first active daily goal for a metric that applies today (used for Home targets). */
export function dailyGoalFor(goals: readonly GoalView[] | null | undefined, metric: GoalMetric, today: string): GoalView | null {
  return sortGoals((goals ?? []).filter((goal) => goal.metric === metric && goal.period === "daily" && appliesOn(goal, today)))[0] ?? null;
}

// ---------------------------------------------------------------------------------------------
// Creating and editing goals

export type GoalTemplateKey = "workouts_week" | "distance_week" | "active_week" | "protein_day" | "calories_day" | "water_day" | "weight" | "checklist" | "custom";

export type GoalDraft = {
  template: GoalTemplateKey;
  title: string;
  category: GoalCategory;
  metric: GoalMetric;
  period: GoalPeriod;
  direction: GoalDirection;
  /** Form text, so a field can be empty while typing. */
  target: string;
  baseline: string;
  unit: string;
  startsOn: string;
  dueOn: string;
  notes: string;
};

export type GoalContext = {
  today: string;
  estimate: FoodMacros | null;
  workoutsPerWeek: number | null;
  waterGoalMl: number | null;
  latestWeight: number | null;
  targetWeight: number | null;
};

/**
 * The goals a member can create. "checklist" (a tasks_completed goal counting linked To-Dos) is no longer offered:
 * the To-Do list was removed, so nothing could count toward a new one. A Checklist goal saved before keeps its
 * template for editing (draftFromGoal) and shows the count it reached (RETIRED_METRICS).
 */
export const GOAL_TEMPLATES: ReadonlyArray<{ key: GoalTemplateKey; label: string; hint: string }> = [
  { key: "workouts_week", label: "Workouts per week", hint: "Counts finished workouts, Monday to Sunday" },
  { key: "distance_week", label: "Distance a week", hint: "Adds up your recorded walks, runs, rides and more" },
  { key: "active_week", label: "Active minutes a week", hint: "Activity moving time plus workout training time" },
  { key: "protein_day", label: "Daily protein", hint: "Adds up the protein in the food you log" },
  { key: "calories_day", label: "Daily calories", hint: "A calorie target or a limit to stay under" },
  { key: "water_day", label: "Daily water", hint: "Adds up the water you log" },
  { key: "weight", label: "Reach a weight", hint: "Follows your weigh-ins" },
  { key: "custom", label: "Custom", hint: "Anything else; you log the progress" },
];

const round = (value: number, step = 1) => Math.round(value / step) * step;
const asText = (value: number | null) => (value === null || !Number.isFinite(value) ? "" : String(Number(value.toFixed(2))));

/**
 * The title a template suggests for a target, e.g. "Eat 130 g of protein a day". It always says the period the
 * goal measures ("a day", "a week", "in total"), whatever the template's usual one: a weekly calorie limit adds
 * up the whole week's food, so it is "Stay under 13,000 kcal a week", never "… a day".
 */
export function templateTitle(draft: Pick<GoalDraft, "template" | "target" | "direction" | "metric" | "period" | "unit">): string {
  const target = Number(draft.target);
  const has = draft.target.trim() !== "" && Number.isFinite(target) && target > 0;
  const n = (digits = 0) => (has ? target.toLocaleString("en-US", { maximumFractionDigits: digits }) : "…");
  const per = draft.period === "daily" ? "a day" : draft.period === "weekly" ? "a week" : "in total";
  switch (draft.template) {
    case "workouts_week":
      return `Work out ${n()} ${has && target === 1 ? "time" : "times"} ${per}`;
    case "distance_week":
      return `Cover ${n(1)} km ${per}`;
    case "active_week":
      return `Be active for ${n()} minutes ${per}`;
    case "protein_day":
      return `Eat ${n()} g of protein ${per}`;
    case "calories_day":
      return draft.direction === "limit" ? `Stay under ${n()} kcal ${per}` : `Eat ${n()} kcal ${per}`;
    case "water_day":
      return `Drink ${has ? (target / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "…"} L of water ${per}`;
    case "weight":
      return `Reach ${n(1)} kg`;
    case "checklist":
      return "Finish my checklist";
    default:
      return "";
  }
}

export function weightDirection(start: number | null, target: number): GoalDirection {
  return start !== null && target > start ? "increase" : "decrease";
}

/** A new goal form for a template, prefilled from the user's own numbers where FITX has them. */
export function goalDraft(template: GoalTemplateKey, context: GoalContext): GoalDraft {
  const base: GoalDraft = {
    template, title: "", category: "personal", metric: "manual", period: "long_term", direction: "increase",
    target: "", baseline: "", unit: "", startsOn: context.today, dueOn: "", notes: "",
  };
  let draft: GoalDraft;
  switch (template) {
    case "workouts_week":
      // The member's own weekly days only (null until the Workouts setup answered them: never the column default).
      draft = { ...base, category: "consistency", metric: "workouts_completed", period: "weekly", unit: "workouts", target: asText(context.workoutsPerWeek) };
      break;
    // No target is suggested: FITX has no number of the member's own to start from.
    case "distance_week":
      draft = { ...base, category: "fitness", metric: "activity_distance_km", period: "weekly", unit: "km" };
      break;
    case "active_week":
      draft = { ...base, category: "fitness", metric: "active_minutes", period: "weekly", unit: "min" };
      break;
    case "protein_day":
      draft = { ...base, category: "nutrition", metric: "protein_g", period: "daily", unit: "g", target: asText(context.estimate ? round(context.estimate.protein, 5) : null) };
      break;
    case "calories_day":
      draft = { ...base, category: "nutrition", metric: "calories_kcal", period: "daily", unit: "kcal", direction: "limit", target: asText(context.estimate ? round(context.estimate.calories, 50) : null) };
      break;
    case "water_day":
      draft = { ...base, category: "nutrition", metric: "water_ml", period: "daily", unit: "ml", target: asText(context.waterGoalMl ?? 2500) };
      break;
    case "weight": {
      const target = context.targetWeight;
      draft = {
        ...base, category: "body", metric: "body_weight_kg", period: "long_term", unit: "kg",
        target: asText(target), baseline: asText(context.latestWeight),
        direction: target !== null ? weightDirection(context.latestWeight, target) : "decrease",
      };
      break;
    }
    default:
      draft = { ...base, category: "fitness", metric: "manual", period: "long_term" };
  }
  return { ...draft, title: templateTitle(draft) };
}

/** The goal row to insert or update, or a message saying what to fix. */
export type GoalInput = {
  title: string;
  category: GoalCategory;
  metric: GoalMetric;
  period: GoalPeriod;
  direction: GoalDirection;
  target_value: number;
  baseline_value: number | null;
  unit: string;
  starts_on: string;
  due_on: string | null;
  notes: string | null;
};

export function validateGoalDraft(draft: GoalDraft): { ok: true; value: GoalInput } | { ok: false; error: string } {
  const title = draft.title.trim();
  if (!title) return { ok: false, error: "Give the goal a name." };
  if (title.length > 120) return { ok: false, error: "Keep the goal name under 120 characters." };
  const target = Number(draft.target);
  if (draft.target.trim() === "" || !Number.isFinite(target) || target <= 0) return { ok: false, error: "Enter a target greater than zero." };
  if (target >= 1e9) return { ok: false, error: "That target is too large." };
  const metric = GOAL_METRICS[draft.metric];
  if (!metric.periods.includes(draft.period)) return { ok: false, error: `${metric.label} goals can be ${metric.periods.map((period) => PERIOD_LABELS[period].toLowerCase()).join(" or ")}.` };
  if (!metric.directions.includes(draft.direction)) return { ok: false, error: "Choose whether to reach the target or stay under it." };
  let baseline: number | null = null;
  if (draft.baseline.trim() !== "") {
    baseline = Number(draft.baseline);
    if (!Number.isFinite(baseline) || baseline < 0) return { ok: false, error: "The starting value must be zero or more." };
  }
  if (draft.metric === "body_weight_kg") {
    if (target < 30 || target > 500) return { ok: false, error: "Enter a target weight between 30 and 500 kg." };
    // The start decides whether the goal is to gain or to lose, so it can't be guessed.
    if (baseline === null) return { ok: false, error: "Enter your starting weight." };
    if (baseline < 30 || baseline > 500) return { ok: false, error: "Enter a starting weight between 30 and 500 kg." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.startsOn)) return { ok: false, error: "Choose a start date." };
  if (draft.dueOn && draft.dueOn < draft.startsOn) return { ok: false, error: "The end date can't be before the start date." };
  const notes = draft.notes.trim();
  if (notes.length > 1000) return { ok: false, error: "Keep notes under 1,000 characters." };
  if (draft.metric === "manual" && clientMetricForUnit(draft.unit)) return { ok: false, error: "FITX keeps that unit for its own goals. Choose another unit, or the Distance or Active minutes goal." };
  const direction = draft.metric === "body_weight_kg" ? weightDirection(baseline, target) : draft.direction;
  const client = isClientMetric(draft.metric) ? draft.metric : null;
  return {
    ok: true,
    value: {
      title,
      category: draft.category,
      // A client-measured goal is stored as a manual goal with its reserved unit (the database knows no such metric).
      metric: client ? "manual" : draft.metric,
      period: draft.period,
      direction,
      target_value: Number(target.toFixed(2)),
      baseline_value: client || baseline === null ? null : Number(baseline.toFixed(2)),
      unit: (client ? CLIENT_METRIC_UNITS[client] : draft.metric === "manual" ? draft.unit.trim() : metric.unit).slice(0, 24),
      starts_on: draft.startsOn,
      due_on: draft.dueOn || null,
      notes: notes || null,
    },
  };
}

/** The edit form for an existing goal. */
export function draftFromGoal(goal: GoalView): GoalDraft {
  // The workouts template covers every period (its title follows the period), so a daily or long-term workouts
  // goal edits as one too, not as a custom goal.
  const template: GoalTemplateKey =
    goal.metric === "workouts_completed" ? "workouts_week"
      : goal.metric === "activity_distance_km" ? "distance_week"
      : goal.metric === "active_minutes" ? "active_week"
      : goal.metric === "protein_g" ? "protein_day"
        : goal.metric === "calories_kcal" ? "calories_day"
          : goal.metric === "water_ml" ? "water_day"
            : goal.metric === "body_weight_kg" ? "weight"
              : goal.metric === "tasks_completed" ? "checklist"
                : "custom";
  return {
    template, title: goal.title, category: goal.category, metric: goal.metric, period: goal.period, direction: goal.direction,
    target: asText(goal.targetValue), baseline: asText(goal.baselineValue), unit: goal.unit,
    startsOn: goal.startsOn, dueOn: goal.dueOn ?? "", notes: goal.notes ?? "",
  };
}

/**
 * A progress amount as typed: "2", "-1", "−1" (a typographic minus), "1,500" or "1,50,000" (thousands)
 * and "2,5" (a decimal comma). Null when it is not a number other than zero.
 */
export function parseProgressAmount(text: string): number | null {
  let value = text.trim().replace(/[\u2212\u2012\u2013\u2014]/g, "-").replace(/\s+/g, "");
  if (/^[-+]?\d{1,3}((,\d{3})+|(,\d{2})+,\d{3})(\.\d+)?$/.test(value)) value = value.replace(/,/g, "");
  else if (/^[-+]?\d+,\d+$/.test(value)) value = value.replace(",", ".");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(value)) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount !== 0 ? amount : null;
}

/**
 * Why taking `amount` off would be refused, or null: a correction can take the total down to zero, never below
 * ("-35 of 20 lengths \u00b7 55 to go" was possible). The total is this period's (today, this week) or, long-term,
 * all of it, as the goal shows it.
 */
export function correctionProblem(goal: Pick<GoalView, "currentValue" | "metric" | "unit">, amount: number): string | null {
  if (!(amount < 0)) return null;
  const total = Math.max(0, goal.currentValue ?? 0);
  if (tidy(total + amount) >= 0) return null;
  return total > 0 ? `You can take off at most ${formatGoalValue(total, goal.metric, goal.unit)}.` : "There\u2019s nothing logged to take off yet.";
}

/** The amount to log from the Log progress field, or the message to show beside it. */
export function checkProgressAmount(
  text: string,
  goal: Pick<GoalView, "currentValue" | "metric" | "unit">,
  schema: "v1" | "v2",
): { ok: true; amount: number } | { ok: false; error: string } {
  const amount = parseProgressAmount(text);
  if (amount === null) return { ok: false, error: "Enter a number, for example 2 or 1.5." };
  if (amount < 0 && schema === "v1") return { ok: false, error: "To take progress off, delete the entry in Progress history." };
  const problem = correctionProblem(goal, amount);
  return problem ? { ok: false, error: problem } : { ok: true, amount };
}

/**
 * Whether a logged entry counts in the goal's current total: every entry for a long-term goal, else only those
 * logged on the days of this period (as fitx_goal_progress counts them, by the local day).
 */
export function entryCounts(goal: Pick<GoalView, "period" | "periodStart" | "periodEnd">, loggedAt: string): boolean {
  if (goal.period === "long_term" || !goal.periodStart || !goal.periodEnd) return true;
  const day = localDay(loggedAt);
  return day !== null && day >= goal.periodStart && day <= goal.periodEnd;
}

/** Why deleting a logged entry would be refused (the total would go below zero), or null. */
export function entryRemovalProblem(goal: Pick<GoalView, "currentValue" | "period" | "periodStart" | "periodEnd">, entry: { amount: number; loggedAt: string }): string | null {
  if (!(entry.amount > 0) || !entryCounts(goal, entry.loggedAt)) return null;
  return tidy(Math.max(0, goal.currentValue ?? 0) - entry.amount) < 0 ? "Deleting this would take the total below zero. Delete the minus entries first." : null;
}

/**
 * The goal as deleting `entry` leaves it: the entry no longer counts in its total (an entry of an earlier day or
 * week never did). A total that older corrections took below zero is counted on from its real value, and still
 * shows as 0 while it stays below zero.
 */
export function goalWithoutEntry(goal: GoalView, entry: { amount: number; loggedAt: string }): GoalView {
  if (!entryCounts(goal, entry.loggedAt)) return goal;
  const total = tidy((goal.negativeTotal ?? goal.currentValue ?? 0) - entry.amount);
  const next: GoalView = { ...goal, currentValue: Math.max(0, total) };
  if (total < 0) next.negativeTotal = total;
  else delete next.negativeTotal;
  return next;
}

/**
 * Progress history after the entry `id` is deleted: the entries left, and where keyboard focus goes (D5): the next
 * entry's Delete button, else the one before it, else "empty" (the empty message). An entry that isn't listed any
 * more leaves the list as it is and focus where it is (null).
 */
export function afterEntryRemoved<T extends { id: string }>(list: readonly T[], id: string): { rest: T[]; focus: string | null } {
  const index = list.findIndex((item) => item.id === id);
  if (index < 0) return { rest: [...list], focus: null };
  const rest = list.filter((item) => item.id !== id);
  return { rest, focus: (rest[index] ?? rest[index - 1])?.id ?? "empty" };
}
