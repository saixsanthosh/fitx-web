import type { ActivitySummary, PeriodTotals } from "./repository";
import { totalsOf } from "./repository";
import { SPORTS, type Sport } from "./types";
import { startOfWeek } from "./weeks";

/*
 * Activity statistics from the saved activities themselves (and ones still only on this device):
 * totals for this week, last week, this month and this year, and personal bests per sport. Nothing
 * is estimated or filled in: an activity counts in the period it started in (the viewer's calendar,
 * weeks from Monday), and a best is always one real activity, linked to it.
 */

export type PeriodKey = "week" | "lastWeek" | "month" | "year";
export type Period = { start: number; end: number };

/** The current periods in the viewer's local calendar. `end` is exclusive. */
export function periods(now: number): Record<PeriodKey, Period> {
  const week = startOfWeek(now);
  const lastWeek = new Date(week);
  lastWeek.setDate(lastWeek.getDate() - 7);
  const nextWeek = new Date(week);
  nextWeek.setDate(nextWeek.getDate() + 7);
  const today = new Date(now);
  const month = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1).getTime();
  const year = new Date(today.getFullYear(), 0, 1).getTime();
  const nextYear = new Date(today.getFullYear() + 1, 0, 1).getTime();
  return {
    week: { start: week, end: nextWeek.getTime() },
    lastWeek: { start: lastWeek.getTime(), end: week },
    month: { start: month, end: nextMonth },
    year: { start: year, end: nextYear },
  };
}

export function totalsIn(rows: readonly ActivitySummary[], period: Period): PeriodTotals {
  return totalsOf(rows.filter((row) => row.startedAt >= period.start && row.startedAt < period.end));
}

export function periodTotals(rows: readonly ActivitySummary[], now: number): Record<PeriodKey, PeriodTotals> {
  const bounds = periods(now);
  return { week: totalsIn(rows, bounds.week), lastWeek: totalsIn(rows, bounds.lastWeek), month: totalsIn(rows, bounds.month), year: totalsIn(rows, bounds.year) };
}

/** This week against last week: distance and activity count. */
export type WeekChange = { distanceM: number; count: number; direction: "up" | "down" | "same" };

export function weekChange(week: PeriodTotals, lastWeek: PeriodTotals): WeekChange {
  const distanceM = week.distanceM - lastWeek.distanceM;
  // Changes under 10 m are rounding, not a trend.
  const direction = Math.abs(distanceM) < 10 ? "same" : distanceM > 0 ? "up" : "down";
  return { distanceM, count: week.count - lastWeek.count, direction };
}

/** Only activities at least this long can hold the fastest-average record (a 50 m dash is not a best). */
export const BEST_MIN_DISTANCE_M = 1000;

export type Best = { activity: ActivitySummary; value: number };
export type SportBests = {
  /** The longest distance, metres. */
  longest: Best | null;
  /** Walks and runs: the lowest average pace (seconds per km). Rides: the highest average speed (m/s). */
  fastest: Best | null;
};

const validPace = (pace: number | null): pace is number => pace !== null && Number.isFinite(pace) && pace > 0 && pace < 3600;
const validSpeed = (speed: number | null): speed is number => speed !== null && Number.isFinite(speed) && speed > 0;

/** Personal bests per sport. On a tie the earlier activity keeps the record, as the first to reach it. */
export function personalBests(rows: readonly ActivitySummary[]): Record<Sport, SportBests> {
  const result = {} as Record<Sport, SportBests>;
  for (const sport of SPORTS) result[sport] = { longest: null, fastest: null };
  const ordered = [...rows].sort((a, b) => a.startedAt - b.startedAt);
  for (const row of ordered) {
    const bests = result[row.sport];
    if (row.distanceM > 0 && (!bests.longest || row.distanceM > bests.longest.value)) bests.longest = { activity: row, value: row.distanceM };
    if (row.distanceM < BEST_MIN_DISTANCE_M || !(row.movingSeconds > 0)) continue;
    if (row.sport === "ride") {
      if (validSpeed(row.avgSpeedMps) && (!bests.fastest || row.avgSpeedMps > bests.fastest.value)) bests.fastest = { activity: row, value: row.avgSpeedMps };
    } else if (validPace(row.avgPaceSecondsPerKm) && (!bests.fastest || row.avgPaceSecondsPerKm < bests.fastest.value)) {
      bests.fastest = { activity: row, value: row.avgPaceSecondsPerKm };
    }
  }
  return result;
}

/** Sports with at least one best, in the usual order. */
export function sportsWithBests(bests: Record<Sport, SportBests>): Sport[] {
  return SPORTS.filter((sport) => bests[sport].longest !== null);
}

/** Saved activities plus device-only ones, each counted once (a half-uploaded device copy is already saved). */
export function mergeSummaries(saved: readonly ActivitySummary[], device: readonly ActivitySummary[]): ActivitySummary[] {
  const ids = new Set(saved.map((row) => row.clientId));
  return [...saved, ...device.filter((row) => !ids.has(row.clientId))];
}
