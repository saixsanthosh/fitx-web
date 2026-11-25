/**
 * Progress analytics for one week, month or year, from the member's own logs only. Pure (no React, no database),
 * so node tests cover every number the page draws.
 *
 * Rules (the FITX data contract):
 *  - A workout is a completed session on the local day it started; a set counts when ticked with reps or seconds
 *    (muscle-history isCountedSet), on the day it was ticked; volume is weight × reps of weighted lift sets, null
 *    when a period has none, so a body-weight month shows "—", never "0 kg".
 *  - Activities are recorded walks, runs and rides. When they could not be read they are unknown (null), not 0.
 *  - Calories burned only from activities that recorded an estimate (MET × body weight × moving time); the total
 *    is labelled an estimate and says how many activities it covers. Nothing is guessed for workouts.
 *  - Food: averages per logged day of the known totals; entries without a value are counted, never read as 0.
 *  - Days after today are future, not empty.
 * Weeks run Monday to Sunday on the browser's calendar (day-keys.ts).
 */
import { addDays, daysBetween, isDateKey, keyToLocalDate, mondayOf, weekdayIndex } from "@/lib/domain/day-keys";
import { localDateKey } from "@/lib/domain/dates";
import { knownTotal, type MealTotals } from "@/lib/domain/meal-totals";
import { isCountedSet, isCountedSession, type LoggedSession } from "@/lib/training/muscle-history";
import { estimateOneRepMax } from "@/lib/training/one-rep-max";
import { isLiftSet, isTimedPrescription } from "@/lib/training/sets";
import { isWorkoutSetupDone } from "@/lib/training/setup";

export const PERIOD_KINDS = ["week", "month", "year"] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];
export const PERIOD_LABELS: Readonly<Record<PeriodKind, string>> = { week: "Week", month: "Month", year: "Year" };
/** How far back the period arrows go. */
export const MAX_BACK: Readonly<Record<PeriodKind, number>> = { week: 52, month: 24, year: 4 };

export type Period = {
  kind: PeriodKind;
  /** 0 is the period holding today, -1 the one before, and so on. */
  offset: number;
  from: string;
  to: string;
  /** The last day that has happened: `to`, or today while the period is running. Before `from` when all of it is ahead. */
  end: string;
  today: string;
  /** "This week", "17 – 23 Nov", "November 2026", "2026". */
  label: string;
  isCurrent: boolean;
};

const pad = (value: number) => String(value).padStart(2, "0");
const keyOf = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const fmt = (key: string, options: Intl.DateTimeFormatOptions) => keyToLocalDate(key).toLocaleDateString("en-GB", options);

export function periodFor(kind: PeriodKind, today: string, offset = 0): Period {
  const step = Math.min(0, Math.trunc(offset));
  let from: string;
  let to: string;
  let label: string;
  const [year, month] = today.split("-").map(Number);
  if (kind === "week") {
    from = addDays(mondayOf(today), 7 * step);
    to = addDays(from, 6);
    const sameMonth = from.slice(0, 7) === to.slice(0, 7);
    // A week of another year says the year ("22 – 28 Dec 2025"), so it never reads as this year's.
    const year = to.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" as const } : {};
    label = step === 0 ? "This week" : step === -1 ? "Last week" : `${fmt(from, sameMonth ? { day: "numeric" } : { day: "numeric", month: "short" })} – ${fmt(to, { day: "numeric", month: "short", ...year })}`;
  } else if (kind === "month") {
    const index = year * 12 + (month - 1) + step;
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    from = keyOf(y, m, 1);
    to = keyOf(y, m, daysInMonth(y, m));
    label = fmt(from, { month: "long", year: "numeric" });
  } else {
    const y = year + step;
    from = keyOf(y, 1, 1);
    to = keyOf(y, 12, 31);
    label = String(y);
  }
  const end = to < today ? to : today < from ? addDays(from, -1) : today;
  return { kind, offset: step, from, to, end, today, label, isCurrent: step === 0 };
}

export function previousPeriod(period: Period): Period {
  return periodFor(period.kind, period.today, period.offset - 1);
}

/** What a comparison is against: "last week", "last month", "last year" (or the period's own name further back). */
export function comparisonLabel(period: Period): string {
  const previous = previousPeriod(period);
  if (period.isCurrent) return period.kind === "week" ? "last week" : period.kind === "month" ? "last month" : "last year";
  return previous.label;
}

export type Bucket = { key: string; from: string; to: string; label: string; longLabel: string; future: boolean };

/** The chart columns: the days of a week or month, the months of a year. */
export function periodBuckets(period: Period): Bucket[] {
  if (period.kind === "year") {
    const year = Number(period.from.slice(0, 4));
    return Array.from({ length: 12 }, (_, index) => {
      const from = keyOf(year, index + 1, 1);
      const to = keyOf(year, index + 1, daysInMonth(year, index + 1));
      return { key: from, from, to, label: fmt(from, { month: "narrow" }), longLabel: fmt(from, { month: "long", year: "numeric" }), future: from > period.today };
    });
  }
  const length = daysBetween(period.from, period.to) + 1;
  return Array.from({ length }, (_, index) => {
    const day = addDays(period.from, index);
    return {
      key: day, from: day, to: day,
      label: period.kind === "week" ? fmt(day, { weekday: "narrow" }) : String(Number(day.slice(8))),
      longLabel: fmt(day, { weekday: "long", day: "numeric", month: "long" }),
      future: day > period.today,
    };
  });
}

// ---------------------------------------------------------------- the day index

export type ProgressActivity = { startedAt: string; distanceM: number; movingSeconds: number; kcalEstimate?: number | null };

export type DayFacts = {
  workouts: number;
  sets: number;
  /** Weight × reps of weighted lift sets ticked that day. */
  volumeKg: number;
  weightedSets: number;
  activities: number;
  distanceM: number;
  movingSeconds: number;
  /** Sum of recorded calorie estimates, and how many of the day's activities had one. */
  kcalBurned: number;
  kcalActivities: number;
};

const blankDay = (): DayFacts => ({ workouts: 0, sets: 0, volumeKg: 0, weightedSets: 0, activities: 0, distanceM: 0, movingSeconds: 0, kcalBurned: 0, kcalActivities: 0 });

function dayOf(iso: string | null | undefined): string | null {
  if (typeof iso !== "string" || !iso) return null;
  const time = Date.parse(iso);
  return Number.isFinite(time) ? localDateKey(new Date(time)) : null;
}

const positive = (value: unknown) => {
  const number = Number(value);
  return value !== null && value !== undefined && Number.isFinite(number) && number > 0 ? number : 0;
};

/** One pass over the logs: what happened on each local day. Days with nothing are absent. */
export function indexDays(sessions: readonly LoggedSession[], activities: readonly ProgressActivity[] | null): Map<string, DayFacts> {
  const days = new Map<string, DayFacts>();
  const at = (day: string) => {
    let facts = days.get(day);
    if (!facts) { facts = blankDay(); days.set(day, facts); }
    return facts;
  };
  for (const session of sessions) {
    if (!isCountedSession(session)) continue;
    const started = dayOf(session.started_at);
    if (started) at(started).workouts += 1;
    for (const exercise of session.exercises ?? []) {
      const timed = isTimedPrescription({ target_duration_seconds: exercise.target_duration_seconds ?? null });
      for (const set of exercise.sets ?? []) {
        if (!isCountedSet(set)) continue;
        const day = dayOf(set.completed_at);
        if (!day) continue;
        const facts = at(day);
        facts.sets += 1;
        const weight = positive(set.weight_kg);
        if (weight > 0 && isLiftSet({ reps: set.reps, duration_seconds: set.duration_seconds ?? null }, timed)) {
          facts.volumeKg += weight * Number(set.reps);
          facts.weightedSets += 1;
        }
      }
    }
  }
  for (const activity of activities ?? []) {
    const day = dayOf(activity.startedAt);
    if (!day) continue;
    const facts = at(day);
    facts.activities += 1;
    facts.distanceM += positive(activity.distanceM);
    facts.movingSeconds += positive(activity.movingSeconds);
    const kcal = activity.kcalEstimate;
    if (typeof kcal === "number" && Number.isFinite(kcal) && kcal >= 0) {
      facts.kcalBurned += kcal;
      facts.kcalActivities += 1;
    }
  }
  return days;
}

/** A day counts as active with a finished workout or a recorded activity. */
export const isActive = (facts: DayFacts | undefined) => Boolean(facts && (facts.workouts > 0 || facts.activities > 0 || facts.sets > 0));

// ---------------------------------------------------------------- one period's numbers

export type FoodAverage = { average: number | null; days: number; missingEntries: number };

export type PeriodSummary = {
  /** Days that have happened in the period (0 when all of it is ahead). */
  days: number;
  workouts: number;
  sets: number;
  volumeKg: number | null;
  activeDays: number;
  trainingDays: number;
  /** Null when activities could not be read. */
  activities: number | null;
  distanceM: number | null;
  movingSeconds: number | null;
  /** Estimated calories from activities that recorded one; null when none did (or activities are unknown). */
  kcalBurned: number | null;
  kcalActivities: number;
  loggedDays: number;
  calories: FoodAverage;
  protein: FoodAverage;
  /** The longest run of active days inside the period. */
  longestStreak: number;
};

function foodAverage(foodDays: ReadonlyMap<string, MealTotals>, days: readonly string[], key: "calories" | "protein"): FoodAverage {
  const values: number[] = [];
  let missingEntries = 0;
  for (const day of days) {
    const totals = foodDays.get(day);
    if (!totals || totals.entries === 0) continue;
    missingEntries += totals[key].missing;
    const value = knownTotal(totals[key]);
    if (value !== null) values.push(value);
  }
  return {
    average: values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
    days: values.length,
    missingEntries,
  };
}

export function daysOf(from: string, to: string): string[] {
  const days: string[] = [];
  if (!isDateKey(from) || !isDateKey(to)) return days;
  for (let day = from; day <= to && days.length < 400; day = addDays(day, 1)) days.push(day);
  return days;
}

export function summarise(
  index: ReadonlyMap<string, DayFacts>,
  foodDays: ReadonlyMap<string, MealTotals>,
  from: string,
  to: string,
  activitiesKnown: boolean,
): PeriodSummary {
  const days = daysOf(from, to);
  let workouts = 0, sets = 0, volume = 0, weighted = 0, activeDays = 0, trainingDays = 0;
  let activities = 0, distance = 0, moving = 0, kcal = 0, kcalActivities = 0, run = 0, longest = 0, loggedDays = 0;
  for (const day of days) {
    const facts = index.get(day);
    if (facts) {
      workouts += facts.workouts;
      sets += facts.sets;
      volume += facts.volumeKg;
      weighted += facts.weightedSets;
      if (facts.workouts > 0 || facts.sets > 0) trainingDays += 1;
      activities += facts.activities;
      distance += facts.distanceM;
      moving += facts.movingSeconds;
      kcal += facts.kcalBurned;
      kcalActivities += facts.kcalActivities;
    }
    if (isActive(facts)) { activeDays += 1; run += 1; longest = Math.max(longest, run); } else run = 0;
    if ((foodDays.get(day)?.entries ?? 0) > 0) loggedDays += 1;
  }
  return {
    days: days.length,
    workouts,
    sets,
    volumeKg: weighted ? Math.round(volume) : null,
    activeDays,
    trainingDays,
    activities: activitiesKnown ? activities : null,
    distanceM: activitiesKnown ? Math.round(distance) : null,
    movingSeconds: activitiesKnown ? Math.round(moving) : null,
    kcalBurned: activitiesKnown && kcalActivities > 0 ? Math.round(kcal) : null,
    kcalActivities: activitiesKnown ? kcalActivities : 0,
    loggedDays,
    calories: foodAverage(foodDays, days, "calories"),
    protein: foodAverage(foodDays, days, "protein"),
    longestStreak: longest,
  };
}

/** The period's numbers (to the last day that has happened). */
export function periodSummary(period: Period, index: ReadonlyMap<string, DayFacts>, foodDays: ReadonlyMap<string, MealTotals>, activitiesKnown: boolean): PeriodSummary {
  return summarise(index, foodDays, period.from, period.end, activitiesKnown);
}

/**
 * The period before, over the same number of days, so a running period is compared fairly ("this month so far"
 * against the same first days of last month). Null when none of those days are on or after `firstDay`
 * (before the member joined: unknown, not zero).
 */
export function previousSummary(period: Period, index: ReadonlyMap<string, DayFacts>, foodDays: ReadonlyMap<string, MealTotals>, activitiesKnown: boolean, firstDay: string | null): PeriodSummary | null {
  const previous = previousPeriod(period);
  const length = daysBetween(period.from, period.end);
  if (length < 0) return null;
  const end = period.isCurrent ? minKey(addDays(previous.from, length), previous.to) : previous.to;
  if (firstDay === null || end < firstDay) return null;
  return summarise(index, foodDays, previous.from, end, activitiesKnown);
}

const minKey = (a: string, b: string) => (a < b ? a : b);

/** Consecutive active days up to today (a day without a log yet today does not break it). */
export function currentStreak(index: ReadonlyMap<string, DayFacts>, today: string): number {
  let day = isActive(index.get(today)) ? today : addDays(today, -1);
  let count = 0;
  while (isActive(index.get(day)) && count < 3660) { count += 1; day = addDays(day, -1); }
  return count;
}

export type Delta = { difference: number; direction: "up" | "down" | "same" };

/** How a number moved against the period before; null when either is unknown. */
export function delta(current: number | null, previous: number | null | undefined): Delta | null {
  if (current === null || previous === null || previous === undefined || !Number.isFinite(current) || !Number.isFinite(previous)) return null;
  const difference = Math.round((current - previous) * 10) / 10;
  return { difference, direction: difference > 0 ? "up" : difference < 0 ? "down" : "same" };
}

// ---------------------------------------------------------------- chart series

export const TRAINING_METRICS = ["workouts", "volume", "distance"] as const;
export type TrainingMetric = (typeof TRAINING_METRICS)[number];

export type SeriesPoint = { key: string; label: string; longLabel: string; value: number | null; future: boolean };

/** One value per bucket. A future bucket has no value; a bucket with nothing logged is a real 0 for counts. */
export function trainingSeries(period: Period, index: ReadonlyMap<string, DayFacts>, metric: TrainingMetric, activitiesKnown: boolean): SeriesPoint[] {
  return periodBuckets(period).map((bucket) => {
    if (bucket.future) return { ...bucket, value: null };
    const last = minKey(bucket.to, period.end);
    let total = 0;
    for (const day of daysOf(bucket.from, last)) {
      const facts = index.get(day);
      if (!facts) continue;
      total += metric === "workouts" ? facts.workouts : metric === "volume" ? facts.volumeKg : facts.distanceM / 1000;
    }
    if (metric === "distance" && !activitiesKnown) return { ...bucket, value: null };
    return { ...bucket, value: metric === "distance" ? Math.round(total * 10) / 10 : Math.round(total) };
  });
}

/** Average calories per logged day in each bucket; null where nothing was logged (unknown, not 0). */
export function nutritionSeries(period: Period, foodDays: ReadonlyMap<string, MealTotals>, key: "calories" | "protein"): SeriesPoint[] {
  return periodBuckets(period).map((bucket) => {
    if (bucket.future) return { ...bucket, value: null };
    const average = foodAverage(foodDays, daysOf(bucket.from, minKey(bucket.to, period.end)), key).average;
    return { ...bucket, value: average };
  });
}

// ---------------------------------------------------------------- the calendar

export type CalendarDay = {
  key: string;
  day: number;
  future: boolean;
  today: boolean;
  active: boolean;
  workouts: number;
  activities: number;
  /** Calories eaten against the day's target, 0 to 100+; null without food logged or without a target. */
  foodPercent: number | null;
  foodLogged: boolean;
};

/** The days of a week or month for the ring calendar, padded with nulls so the first day sits under its weekday. */
export function calendarDays(period: Period, index: ReadonlyMap<string, DayFacts>, foodDays: ReadonlyMap<string, MealTotals>, calorieTarget: number | null): Array<CalendarDay | null> {
  if (period.kind === "year") return [];
  const days = daysOf(period.from, period.to).map((key): CalendarDay => {
    const future = key > period.today;
    // A day still ahead is never drawn as trained, whatever a wrong device clock dated on it.
    const facts = future ? undefined : index.get(key);
    const food = foodDays.get(key);
    const eaten = food ? knownTotal(food.calories) : null;
    return {
      key,
      day: Number(key.slice(8)),
      future,
      today: key === period.today,
      active: isActive(facts),
      workouts: facts?.workouts ?? 0,
      activities: facts?.activities ?? 0,
      foodLogged: (food?.entries ?? 0) > 0,
      foodPercent: eaten !== null && calorieTarget && calorieTarget > 0 ? Math.round((eaten / calorieTarget) * 100) : null,
    };
  });
  const lead = period.kind === "month" ? weekdayIndex(period.from) : 0;
  return [...Array.from({ length: lead }, () => null), ...days];
}

export type MonthCell = { key: string; label: string; activeDays: number; days: number; loggedDays: number; future: boolean };

/** The year view's twelve months: active days out of the days that have happened. */
export function yearMonths(period: Period, index: ReadonlyMap<string, DayFacts>, foodDays: ReadonlyMap<string, MealTotals>): MonthCell[] {
  return periodBuckets({ ...period, kind: "year" }).map((bucket) => {
    const days = bucket.future ? [] : daysOf(bucket.from, minKey(bucket.to, period.end));
    return {
      key: bucket.key,
      label: fmt(bucket.from, { month: "short" }),
      activeDays: days.filter((day) => isActive(index.get(day))).length,
      loggedDays: days.filter((day) => (foodDays.get(day)?.entries ?? 0) > 0).length,
      days: days.length,
      future: bucket.future,
    };
  });
}

// ---------------------------------------------------------------- weight

export type WeightPoint = { date: string; kg: number };

export type WeightView = {
  /** Weigh-ins inside the period, oldest first (the later one on a day with two). */
  points: WeightPoint[];
  /** The newest weigh-in on or before the period's end. */
  latest: WeightPoint | null;
  /** Last weigh-in in the period minus the first; null with fewer than two. */
  changeKg: number | null;
};

/** Rows arrive newest first (as body_metrics is read); only positive weights count. */
export function weightView(rows: ReadonlyArray<{ date: string; weight: number | string | null }>, period: Period): WeightView {
  const byDay = new Map<string, number>();
  for (const row of rows) {
    const kg = row.weight === null || row.weight === undefined ? Number.NaN : Number(row.weight);
    if (!Number.isFinite(kg) || kg <= 0 || !isDateKey(row.date) || byDay.has(row.date)) continue;
    byDay.set(row.date, kg);
  }
  const all = [...byDay.entries()].map(([date, kg]) => ({ date, kg })).sort((a, b) => a.date.localeCompare(b.date));
  const points = all.filter((point) => point.date >= period.from && point.date <= period.end);
  const latest = all.filter((point) => point.date <= period.end).at(-1) ?? null;
  return { points, latest, changeKg: points.length >= 2 ? Math.round((points.at(-1)!.kg - points[0].kg) * 10) / 10 : null };
}

// ---------------------------------------------------------------- strength

export type StrengthGain = {
  key: string;
  name: string;
  /** Best estimated one-rep max (Epley) in the first and the latest session of the exercise in the period. */
  firstKg: number;
  lastKg: number;
  changeKg: number;
  sessions: number;
};

/**
 * Exercises whose best weighted set moved inside the period: the estimated one-rep max of the latest session
 * against the first, for exercises done in at least two sessions. Biggest gains first; an estimate, so labelled.
 */
export function strengthGains(sessions: readonly LoggedSession[], from: string, to: string, limit = 4): StrengthGain[] {
  const byExercise = new Map<string, { name: string; points: Array<{ at: string; best: number }> }>();
  for (const session of sessions) {
    if (!isCountedSession(session)) continue;
    const day = dayOf(session.started_at);
    if (!day || day < from || day > to) continue;
    for (const exercise of session.exercises ?? []) {
      const timed = isTimedPrescription({ target_duration_seconds: exercise.target_duration_seconds ?? null });
      let best = 0;
      for (const set of exercise.sets ?? []) {
        if (!isCountedSet(set)) continue;
        const weight = positive(set.weight_kg);
        if (weight > 0 && isLiftSet({ reps: set.reps, duration_seconds: set.duration_seconds ?? null }, timed)) best = Math.max(best, estimateOneRepMax(weight, Number(set.reps)));
      }
      if (best <= 0) continue;
      const key = exercise.library?.id ?? exercise.exercise_id ?? exercise.name.trim().toLowerCase();
      const entry = byExercise.get(key) ?? { name: exercise.library?.name ?? exercise.name, points: [] };
      entry.points.push({ at: session.started_at, best });
      byExercise.set(key, entry);
    }
  }
  const gains: StrengthGain[] = [];
  for (const [key, entry] of byExercise) {
    if (entry.points.length < 2) continue;
    const ordered = entry.points.sort((a, b) => a.at.localeCompare(b.at));
    const firstKg = ordered[0].best;
    const lastKg = ordered.at(-1)!.best;
    gains.push({ key, name: entry.name, firstKg, lastKg, changeKg: Math.round((lastKg - firstKg) * 10) / 10, sessions: ordered.length });
  }
  return gains.sort((a, b) => b.changeKg - a.changeKg || b.sessions - a.sessions).slice(0, limit);
}

// ---------------------------------------------------------------- highlights

export type Highlight = { id: string; tone: "good" | "attention" | "neutral"; text: string };

/**
 * Whether the member's weekly training days (user_preferences.workouts_per_week) are their own answer. Onboarding
 * no longer asks for them, yet its first page creates the preferences row, so a new member's row carries the
 * column's default of 3. The days count as answered only once the Workouts setup is done, by its own rule
 * (training/setup.ts isWorkoutSetupDone): workout_setup_at is set (20261123100020 backfills it for members the
 * old onboarding asked), or a Home or Gym list is saved. Until then Progress shows no plan ring or plan insight.
 */
export function trainingDaysAnswered(context: {
  hasPreferences: boolean;
  workoutSetupAt: string | null;
  equipmentLists: { home: { saved: boolean }; gym: { saved: boolean } };
} | null): boolean {
  if (!context?.hasPreferences) return false;
  return isWorkoutSetupDone({ setupAt: context.workoutSetupAt, hasEquipmentList: context.equipmentLists.home.saved || context.equipmentLists.gym.saved });
}

/**
 * Two or three short, true observations about the period: more or fewer workouts than before, the longest streak,
 * how many days food was logged, protein against the target. Only from known numbers; nothing when there is
 * nothing to say.
 */
export function highlights(input: {
  period: Period;
  current: PeriodSummary;
  previous: PeriodSummary | null;
  proteinTarget: number | null;
  plan: number | null;
}): Highlight[] {
  const { period, current, previous, proteinTarget, plan } = input;
  const against = comparisonLabel(period);
  const out: Highlight[] = [];
  const workouts = delta(current.workouts, previous?.workouts ?? null);
  if (workouts && workouts.direction !== "same" && (current.workouts > 0 || (previous?.workouts ?? 0) > 0)) {
    const n = Math.abs(workouts.difference);
    out.push({ id: "workouts", tone: workouts.direction === "up" ? "good" : "attention", text: `${n} ${n === 1 ? "workout" : "workouts"} ${workouts.direction === "up" ? "more" : "fewer"} than ${against}` });
  }
  if (current.longestStreak >= 3) out.push({ id: "streak", tone: "good", text: `Longest streak: ${current.longestStreak} active days` });
  if (period.kind === "week" && plan !== null && period.isCurrent && current.trainingDays < plan && current.days >= 1) {
    const left = plan - current.trainingDays;
    const daysLeft = daysBetween(period.end, period.to);
    if (left <= daysLeft) out.push({ id: "plan", tone: "neutral", text: `${left} more ${left === 1 ? "session" : "sessions"} to hit your ${plan} a week` });
  }
  if (current.days >= 3 && current.loggedDays > 0 && current.loggedDays < current.days) {
    out.push({ id: "food", tone: current.loggedDays / current.days >= 0.7 ? "good" : "attention", text: `Food logged on ${current.loggedDays} of ${current.days} days` });
  }
  if (proteinTarget && current.protein.average !== null && current.protein.days >= 2) {
    const share = current.protein.average / proteinTarget;
    if (share < 0.85) out.push({ id: "protein", tone: "attention", text: `Protein averaged ${current.protein.average} g of your ${Math.round(proteinTarget)} g` });
    else if (share >= 0.95) out.push({ id: "protein", tone: "good", text: `Protein on target: ${current.protein.average} g a day` });
  }
  return out.slice(0, 3);
}

/** True when nothing at all was logged: no workout, set, activity, food or weigh-in. */
export function noHistory(index: ReadonlyMap<string, DayFacts>, foodDays: ReadonlyMap<string, MealTotals>, weighIns: number): boolean {
  return index.size === 0 && foodDays.size === 0 && weighIns === 0;
}
