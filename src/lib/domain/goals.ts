/**
 * Goals v2: what a goal measures, how its progress is judged, and how it is described.
 *
 * The database (fitx_goal_progress) measures the raw value for the goal's current period; this file
 * turns that value into a percentage, an achieved/over-limit state and words. Daily goals restart
 * every day, weekly goals every Monday, and long-term goals run from their start to their due date.
 *
 * No runtime imports, so `node --test` can load this file directly.
 */
import type { FoodMacros } from "./nutrition";

export type GoalPeriod = "daily" | "weekly" | "long_term";
export type GoalDirection = "increase" | "decrease" | "limit";
export type GoalMetric = "manual" | "calories_kcal" | "protein_g" | "water_ml" | "workouts_completed" | "body_weight_kg" | "tasks_completed";
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
};

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
};

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
};
const str = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

/** One row of fitx_goal_progress, or a plain goals row from a database without goals v2. */
export function parseGoalRow(raw: Record<string, unknown>): GoalView {
  const metric = isGoalMetric(raw.metric) ? raw.metric : "manual";
  const legacy = raw.period === undefined;
  return {
    id: String(raw.id),
    title: String(raw.title ?? ""),
    category: pick(raw.category, GOAL_CATEGORIES, "personal"),
    metric,
    period: pick(raw.period, GOAL_PERIODS, "long_term"),
    direction: pick(raw.direction, ["increase", "decrease", "limit"] as const, "increase"),
    targetValue: num(raw.target_value) ?? 0,
    baselineValue: num(raw.baseline_value),
    unit: String(raw.unit ?? ""),
    startsOn: str(raw.starts_on) ?? "",
    dueOn: str(raw.due_on),
    status: pick(raw.status, ["active", "paused", "completed", "cancelled"] as const, "active"),
    notes: str(raw.notes),
    createdAt: str(raw.created_at) ?? "",
    updatedAt: str(raw.updated_at),
    completedAt: str(raw.completed_at),
    periodStart: str(raw.period_start),
    periodEnd: str(raw.period_end),
    // A database without goals v2 has only the browser-kept manual total.
    currentValue: num(raw.current_value) ?? (legacy ? 0 : null),
    valueAsOf: str(raw.value_as_of),
    startValue: num(raw.start_value) ?? num(raw.baseline_value),
    linkedTodos: num(raw.linked_todos) ?? 0,
    linkedTodosDone: num(raw.linked_todos_done) ?? 0,
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
      return trimNumber(value, 0);
    case "body_weight_kg":
      return value.toFixed(1);
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
  if (evaluation.state === "no_data") return goal.metric === "body_weight_kg" ? "Log a weigh-in to start" : "";
  if (evaluation.state === "over_limit") return `${formatGoalValue(evaluation.over, goal.metric, goal.unit)} over`;
  if (goal.direction === "limit") return `${formatGoalValue(evaluation.remaining, goal.metric, goal.unit)} left`;
  if (evaluation.achieved) return goal.period === "long_term" ? "Target reached" : goal.period === "daily" ? "Done today" : "Done this week";
  return `${formatGoalValue(evaluation.remaining, goal.metric, goal.unit)} to go`;
}

const monthDay = (key: string) => {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day, 12).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

/** When the goal's progress applies: "Today", "This week", "Due 31 Dec", "Ended 31 Dec", "Ongoing". */
export function periodLabel(goal: Pick<GoalView, "period" | "dueOn" | "startsOn">, today: string): string {
  if (goal.period === "daily") return "Today";
  if (goal.period === "weekly") return "This week";
  if (goal.startsOn && goal.startsOn > today) return `Starts ${monthDay(goal.startsOn)}`;
  if (!goal.dueOn) return "Ongoing";
  return goal.dueOn < today ? `Ended ${monthDay(goal.dueOn)}` : `Due ${monthDay(goal.dueOn)}`;
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

/** The first active daily goal for a metric that applies today (used for Home targets). */
export function dailyGoalFor(goals: readonly GoalView[] | null | undefined, metric: GoalMetric, today: string): GoalView | null {
  return sortGoals((goals ?? []).filter((goal) => goal.metric === metric && goal.period === "daily" && appliesOn(goal, today)))[0] ?? null;
}

// ---------------------------------------------------------------------------------------------
// Creating and editing goals

export type GoalTemplateKey = "workouts_week" | "protein_day" | "calories_day" | "water_day" | "weight" | "checklist" | "custom";

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

export const GOAL_TEMPLATES: ReadonlyArray<{ key: GoalTemplateKey; label: string; hint: string }> = [
  { key: "workouts_week", label: "Workouts per week", hint: "Counts finished workouts, Monday to Sunday" },
  { key: "protein_day", label: "Daily protein", hint: "Adds up the protein in the food you log" },
  { key: "calories_day", label: "Daily calories", hint: "A calorie target or a limit to stay under" },
  { key: "water_day", label: "Daily water", hint: "Adds up the water you log" },
  { key: "weight", label: "Reach a weight", hint: "Follows your weigh-ins" },
  { key: "checklist", label: "Checklist", hint: "Counts the To-Dos you link to it" },
  { key: "custom", label: "Custom", hint: "Anything else; you log the progress" },
];

const round = (value: number, step = 1) => Math.round(value / step) * step;
const asText = (value: number | null) => (value === null || !Number.isFinite(value) ? "" : String(Number(value.toFixed(2))));

/** The title a template suggests for a target, e.g. "Eat 130 g of protein a day". */
export function templateTitle(draft: Pick<GoalDraft, "template" | "target" | "direction" | "metric" | "period" | "unit">): string {
  const target = Number(draft.target);
  const has = draft.target.trim() !== "" && Number.isFinite(target) && target > 0;
  const n = (digits = 0) => (has ? target.toLocaleString("en-US", { maximumFractionDigits: digits }) : "…");
  switch (draft.template) {
    case "workouts_week":
      return `Work out ${n()} ${has && target === 1 ? "time" : "times"} a week`;
    case "protein_day":
      return `Eat ${n()} g of protein a day`;
    case "calories_day":
      return draft.direction === "limit" ? `Stay under ${n()} kcal a day` : `Eat ${n()} kcal a day`;
    case "water_day":
      return `Drink ${has ? (target / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "…"} L of water a day`;
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
      draft = { ...base, category: "consistency", metric: "workouts_completed", period: "weekly", unit: "workouts", target: asText(context.workoutsPerWeek ?? 3) };
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
    case "checklist":
      draft = { ...base, category: "personal", metric: "tasks_completed", period: "long_term", unit: "To-Dos", target: "5" };
      break;
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
  const direction = draft.metric === "body_weight_kg" ? weightDirection(baseline, target) : draft.direction;
  return {
    ok: true,
    value: {
      title,
      category: draft.category,
      metric: draft.metric,
      period: draft.period,
      direction,
      target_value: Number(target.toFixed(2)),
      baseline_value: baseline === null ? null : Number(baseline.toFixed(2)),
      unit: (draft.metric === "manual" ? draft.unit.trim() : metric.unit).slice(0, 24),
      starts_on: draft.startsOn,
      due_on: draft.dueOn || null,
      notes: notes || null,
    },
  };
}

/** The edit form for an existing goal. */
export function draftFromGoal(goal: GoalView): GoalDraft {
  const template: GoalTemplateKey =
    goal.metric === "workouts_completed" && goal.period === "weekly" ? "workouts_week"
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
