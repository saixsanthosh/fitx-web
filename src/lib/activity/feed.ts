import { startsInFuture } from "./future";
import type { ActivitySummary } from "./repository";
import { personalBests, type SportBests } from "./stats";
import { isSport, SPORTS, type Sport } from "./types";
import { startOfWeek } from "./weeks";

/*
 * Figures for the Activity feed and the per-sport pages: distance per day of this week, distance per
 * week for the last few weeks, and one sport's totals. Every figure is a sum of real activities; a
 * day or week without any is 0 km because nothing was recorded, and an average without moving time
 * is null (shown as a dash), never 0. A day, week or "this week" figure counts only activities that
 * have started by now: one dated later (a device clock set wrong) waits for its day (future.ts).
 */

export type SportFilter = Sport | "all";

/** `?sport=` from a URL: one of the sports, anything else is "all". */
export function parseSportFilter(value: unknown): SportFilter {
  const raw = Array.isArray(value) ? value[0] : value;
  return isSport(raw) ? raw : "all";
}

/**
 * Where the statistics stand: "ready" once there are rows to count, "error" when the request for
 * them failed, otherwise still "loading". Only "ready" may show a figure or say nothing was logged.
 */
export function figuresStatus(rows: readonly unknown[] | null, failed: boolean): "loading" | "ready" | "error" {
  if (rows) return "ready";
  return failed ? "error" : "loading";
}

export function matchesFilter(row: Pick<ActivitySummary, "sport">, filter: SportFilter): boolean {
  return filter === "all" || row.sport === filter;
}

export type DayBar = {
  /** Local midnight, epoch ms. */
  dayStart: number;
  distanceM: number;
  movingSeconds: number;
  count: number;
  /** Distance per sport that day (for stacked bars). */
  bySport: Record<Sport, number>;
};

const emptyBySport = (): Record<Sport, number> => Object.fromEntries(SPORTS.map((sport) => [sport, 0])) as Record<Sport, number>;

function addDays(ms: number, days: number): number {
  const date = new Date(ms);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

/** Monday to Sunday of the week containing `now`, each day with its totals. */
export function weekDays(rows: readonly ActivitySummary[], now: number, filter: SportFilter = "all"): DayBar[] {
  const monday = startOfWeek(now);
  const days: DayBar[] = Array.from({ length: 7 }, (_, i) => ({ dayStart: addDays(monday, i), distanceM: 0, movingSeconds: 0, count: 0, bySport: emptyBySport() }));
  const end = addDays(monday, 7);
  for (const row of rows) {
    if (!matchesFilter(row, filter) || row.startedAt < monday || row.startedAt >= end || startsInFuture(row.startedAt, now)) continue;
    let index = 6;
    while (index > 0 && row.startedAt < days[index].dayStart) index -= 1;
    const day = days[index];
    day.distanceM += row.distanceM;
    day.movingSeconds += row.movingSeconds;
    day.count += 1;
    day.bySport[row.sport] += row.distanceM;
  }
  return days;
}

export type WeekBar = { weekStart: number; distanceM: number; movingSeconds: number; count: number };

/** The last `weeks` weeks (this one included), oldest first. */
export function recentWeeks(rows: readonly ActivitySummary[], now: number, weeks = 12, filter: SportFilter = "all"): WeekBar[] {
  const thisWeek = startOfWeek(now);
  const bars: WeekBar[] = Array.from({ length: weeks }, (_, i) => ({ weekStart: addDays(thisWeek, -7 * (weeks - 1 - i)), distanceM: 0, movingSeconds: 0, count: 0 }));
  const first = bars[0].weekStart;
  const end = addDays(thisWeek, 7);
  for (const row of rows) {
    if (!matchesFilter(row, filter) || row.startedAt < first || row.startedAt >= end || startsInFuture(row.startedAt, now)) continue;
    const week = startOfWeek(row.startedAt);
    const bar = bars.find((item) => item.weekStart === week);
    if (!bar) continue;
    bar.distanceM += row.distanceM;
    bar.movingSeconds += row.movingSeconds;
    bar.count += 1;
  }
  return bars;
}

/** Heights 0..1 for a bar chart; all zeros stay zeros (no invented scale). */
export function barScale(values: readonly number[]): number[] {
  const max = Math.max(0, ...values);
  return values.map((value) => (max > 0 ? Math.max(0, value) / max : 0));
}

export type SportSummary = {
  sport: Sport;
  count: number;
  distanceM: number;
  movingSeconds: number;
  /** This week only, from the activities that have started by now. */
  weekDistanceM: number;
  weekCount: number;
  /** Over all activities with moving time: total distance over total moving time. Null without any. */
  avgSpeedMps: number | null;
  avgPaceSecondsPerKm: number | null;
  bests: SportBests;
};

/**
 * One sport's totals, averages and bests from its saved (and device-only) activities. This week counts only the
 * ones that have started; all time, the averages and the bests count every stored activity, one dated ahead too,
 * which is why its history card names only the weekly, monthly and yearly totals (FUTURE_DATE_MARK).
 */
export function sportSummary(rows: readonly ActivitySummary[], sport: Sport, now: number): SportSummary {
  const mine = rows.filter((row) => row.sport === sport);
  const monday = startOfWeek(now);
  const end = addDays(monday, 7);
  let distanceM = 0, movingSeconds = 0, timedDistance = 0, weekDistanceM = 0, weekCount = 0;
  for (const row of mine) {
    distanceM += row.distanceM;
    movingSeconds += row.movingSeconds;
    if (row.movingSeconds > 0) timedDistance += row.distanceM;
    if (row.startedAt >= monday && row.startedAt < end && !startsInFuture(row.startedAt, now)) {
      weekDistanceM += row.distanceM;
      weekCount += 1;
    }
  }
  const avgSpeedMps = movingSeconds > 0 && timedDistance > 0 ? timedDistance / movingSeconds : null;
  const avgPaceSecondsPerKm = avgSpeedMps !== null && timedDistance >= 100 ? 1000 / avgSpeedMps : null;
  return { sport, count: mine.length, distanceM, movingSeconds, weekDistanceM, weekCount, avgSpeedMps, avgPaceSecondsPerKm, bests: personalBests(mine)[sport] };
}

/** This week's distance per sport, for the sport launchers. */
export function weekBySport(rows: readonly ActivitySummary[], now: number): Record<Sport, number> {
  const monday = startOfWeek(now);
  const end = addDays(monday, 7);
  const result = emptyBySport();
  for (const row of rows) if (row.startedAt >= monday && row.startedAt < end && !startsInFuture(row.startedAt, now)) result[row.sport] += row.distanceM;
  return result;
}
