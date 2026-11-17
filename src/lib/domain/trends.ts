/**
 * "How am I progressing?": numbers per week (and per part of a week) from what the member logged. Pure, so
 * node tests cover it; the Progress page loads the rows (src/lib/data/progress.ts).
 *
 *  - Workouts: completed sessions, on the local day they started (like Home and the weekly goal).
 *  - Sets: counted sets (muscle-history isCountedSet: ticked, with reps or seconds) of completed sessions, on
 *    the local day they were ticked.
 *  - Volume: weight × reps of counted lift sets that carry a weight (session-stats rule); null when a period has
 *    none, so a body-weight week shows "—", never "0 kg".
 *  - Activities: recorded walks, runs and rides on the day they started: count, distance and moving time. Null
 *    when activities could not be read, never 0.
 *  - Food: averages per logged day (a day with at least one entry) of the known totals; a day whose entries all
 *    lack the value is left out, and the entries without a value are counted (contract C11).
 * Weeks run Monday to Sunday on the browser's calendar (day-keys.ts).
 */
import { addDays, mondayOf } from "./day-keys";
import { localDateKey } from "./dates";
import { knownTotal, type MacroKey, type MealTotals } from "./meal-totals";
import { isCountedSet, isCountedSession, type LoggedSession } from "@/lib/training/muscle-history";
import { isLiftSet, isTimedPrescription } from "@/lib/training/sets";

export type TrendActivity = { startedAt: string; distanceM: number; movingSeconds: number };

export type DayAverage = {
  /** The mean of the days' known totals; null when no day had a known value. */
  average: number | null;
  /** Days with a known value. */
  days: number;
  /** Entries in the period without a value: left out, never counted as 0. */
  missingEntries: number;
};

export type PeriodNumbers = {
  /** First and last day, inclusive (YYYY-MM-DD). */
  from: string;
  to: string;
  workouts: number;
  sets: number;
  volumeKg: number | null;
  /** Null when activities could not be read. */
  activities: number | null;
  distanceM: number | null;
  movingSeconds: number | null;
  /** Days with at least one food entry. */
  loggedDays: number;
  calories: DayAverage;
  protein: DayAverage;
};

export type TrendData = {
  /** Completed sessions with their sets (loadMuscleHistory). Other statuses are ignored. */
  sessions: readonly LoggedSession[];
  /** Null when activities are not available on this database. */
  activities: readonly TrendActivity[] | null;
  /** Food totals per logged day (mealTotalsByDay). */
  foodDays: ReadonlyMap<string, MealTotals>;
};

function dayOf(iso: string | null | undefined): string | null {
  if (typeof iso !== "string" || !iso) return null;
  const time = Date.parse(iso);
  return Number.isFinite(time) ? localDateKey(new Date(time)) : null;
}

const inside = (day: string | null, from: string, to: string): day is string => day !== null && day >= from && day <= to;
const positive = (value: unknown) => {
  const number = Number(value);
  return value !== null && value !== undefined && Number.isFinite(number) && number > 0 ? number : 0;
};

function dayAverage(foodDays: ReadonlyMap<string, MealTotals>, days: readonly string[], key: MacroKey): DayAverage {
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
    average: values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : null,
    days: values.length,
    missingEntries,
  };
}

/** Every day key from `from` to `to`, inclusive. */
export function dayRange(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to && days.length < 400; day = addDays(day, 1)) days.push(day);
  return days;
}

/** The numbers of one stretch of days (inclusive). */
export function periodNumbers(data: TrendData, from: string, to: string): PeriodNumbers {
  let workouts = 0;
  let sets = 0;
  let volume = 0;
  let weighted = 0;
  for (const session of data.sessions) {
    if (!isCountedSession(session)) continue;
    if (inside(dayOf(session.started_at), from, to)) workouts += 1;
    for (const exercise of session.exercises ?? []) {
      const timed = isTimedPrescription({ target_duration_seconds: exercise.target_duration_seconds ?? null });
      for (const set of exercise.sets ?? []) {
        if (!isCountedSet(set) || !inside(dayOf(set.completed_at), from, to)) continue;
        sets += 1;
        const weight = positive(set.weight_kg);
        if (weight > 0 && isLiftSet({ reps: set.reps, duration_seconds: set.duration_seconds ?? null }, timed)) {
          volume += weight * Number(set.reps);
          weighted += 1;
        }
      }
    }
  }

  let activities: number | null = null;
  let distanceM: number | null = null;
  let movingSeconds: number | null = null;
  if (data.activities) {
    activities = 0;
    distanceM = 0;
    movingSeconds = 0;
    for (const activity of data.activities) {
      if (!inside(dayOf(activity.startedAt), from, to)) continue;
      activities += 1;
      distanceM += positive(activity.distanceM);
      movingSeconds += positive(activity.movingSeconds);
    }
    distanceM = Math.round(distanceM);
    movingSeconds = Math.round(movingSeconds);
  }

  const days = dayRange(from, to);
  return {
    from,
    to,
    workouts,
    sets,
    volumeKg: weighted ? Math.round(volume * 10) / 10 : null,
    activities,
    distanceM,
    movingSeconds,
    loggedDays: days.filter((day) => (data.foodDays.get(day)?.entries ?? 0) > 0).length,
    calories: dayAverage(data.foodDays, days, "calories"),
    protein: dayAverage(data.foodDays, days, "protein"),
  };
}

export type WeekTrend = PeriodNumbers & {
  /** The week's Monday. */
  weekStart: string;
  /** This week: it runs to today and is still in progress. */
  inProgress: boolean;
};

/** The last `weeks` Monday-to-Sunday weeks, oldest first; this week runs to today. */
export function weeklyTrends(data: TrendData, today: string, weeks = 12): WeekTrend[] {
  const count = Math.max(1, Math.min(52, Math.round(weeks)));
  const monday = mondayOf(today);
  return Array.from({ length: count }, (_, index) => {
    const start = addDays(monday, -7 * (count - 1 - index));
    const end = addDays(start, 6);
    const inProgress = start === monday;
    return { ...periodNumbers(data, start, inProgress ? today : end), weekStart: start, inProgress };
  });
}

export type WeekSoFar = {
  /** Monday to today. */
  current: PeriodNumbers;
  /** The same days of last week (Monday to the same weekday), so a week in progress is compared fairly. */
  previous: PeriodNumbers;
  /** Days covered: 1 on Monday, 7 on Sunday. */
  days: number;
};

export function weekSoFar(data: TrendData, today: string): WeekSoFar {
  const monday = mondayOf(today);
  const days = dayRange(monday, today).length;
  return { current: periodNumbers(data, monday, today), previous: periodNumbers(data, addDays(monday, -7), addDays(today, -7)), days };
}

export type Change = { difference: number; direction: "up" | "down" | "same" };

/** How a number moved; null when either side is unknown. */
export function change(current: number | null, previous: number | null): Change | null {
  if (current === null || previous === null || !Number.isFinite(current) || !Number.isFinite(previous)) return null;
  const difference = Math.round((current - previous) * 10) / 10;
  return { difference, direction: difference > 0 ? "up" : difference < 0 ? "down" : "same" };
}

/** True when nothing at all was logged in the weeks: no workout, activity or food. */
export function trendsEmpty(weeks: readonly PeriodNumbers[]): boolean {
  return weeks.every((week) => week.workouts === 0 && week.sets === 0 && !week.activities && week.loggedDays === 0);
}
