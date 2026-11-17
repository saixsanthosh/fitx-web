/**
 * Nutrition history for the History tab: one row per calendar day over the last 7 or 30 days, averages over the days
 * that were logged, and how many logged days met the targets. A day with nothing logged is a gap, never 0 kcal, and a
 * protein, carbs or fat value an entry did not have is left out of that day's total and disclosed (see sumKnown).
 * Dates are local calendar days as YYYY-MM-DD.
 */
import { sumKnown, MACRO_KEYS, type KnownTotals, type MacroKey } from "@/lib/domain/nutrition";

export interface HistoryEntry {
  date: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  /** The entry's values or grams are an estimate. */
  estimated: boolean;
}

/** The daily targets, or null for one the member has none for (a calorie goal alone sets no protein target). */
export interface HistoryTargets {
  calories: number | null;
  protein: number | null;
}

export interface HistoryDay {
  date: string;
  logged: boolean;
  entries: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  /** Entries on this day that lack each value. */
  unknown: Record<MacroKey, number>;
  estimated: number;
  /** Calories against the target: within 10 % either way, or null with no target or no log. */
  caloriesState: "within" | "under" | "over" | null;
  /** Protein against the target. "unknown" when the day is below it but an entry has no protein value. */
  proteinState: "met" | "below" | "unknown" | null;
}

export interface NutritionHistory {
  days: HistoryDay[];
  loggedDays: number;
  /**
   * Averages over logged days only (null when no day was logged). A protein, carbs or fat average counts only the
   * logged days with at least one known value for it, and is null when no day has one (never averaged as 0).
   */
  averages: { calories: number; protein: number | null; carbs: number | null; fat: number | null } | null;
  /** Logged days where at least one entry lacks the value, per macro: the average is then a lower bound. */
  daysWithUnknown: Record<MacroKey, number>;
  estimatedEntries: number;
  totalEntries: number;
  /** Logged days on target, or null for a target the member has none for (and as a whole when they have neither). */
  adherence: { calorieDays: number | null; proteinDays: number | null; proteinUnknownDays: number | null } | null;
}

/** A band of 10 % either side of the calorie target counts as on target. */
export const CALORIE_BAND = 0.1;

export function dateKeyOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** The `count` local dates ending at `end` (inclusive), oldest first. */
export function lastDays(end: Date, count: number): string[] {
  const out: string[] = [];
  for (let back = count - 1; back >= 0; back -= 1) out.push(dateKeyOf(new Date(end.getFullYear(), end.getMonth(), end.getDate() - back)));
  return out;
}

export function buildHistory(entries: readonly HistoryEntry[], dates: readonly string[], targets: HistoryTargets | null): NutritionHistory {
  const byDate = new Map<string, HistoryEntry[]>();
  for (const entry of entries) {
    const list = byDate.get(entry.date);
    if (list) list.push(entry); else byDate.set(entry.date, [entry]);
  }
  const calorieTarget = positive(targets?.calories);
  const proteinTarget = positive(targets?.protein);
  const days = dates.map((date): HistoryDay => {
    const list = byDate.get(date) ?? [];
    const totals: KnownTotals = sumKnown(list);
    const logged = list.length > 0;
    let caloriesState: HistoryDay["caloriesState"] = null;
    let proteinState: HistoryDay["proteinState"] = null;
    if (logged && calorieTarget !== null) {
      const ratio = totals.calories / calorieTarget;
      caloriesState = ratio > 1 + CALORIE_BAND ? "over" : ratio < 1 - CALORIE_BAND ? "under" : "within";
    }
    if (logged && proteinTarget !== null) {
      proteinState = totals.protein >= proteinTarget ? "met" : totals.unknown.protein > 0 ? "unknown" : "below";
    }
    return {
      date, logged, entries: list.length, calories: Math.round(totals.calories),
      protein: round1(totals.protein), carbs: round1(totals.carbs), fat: round1(totals.fat),
      unknown: totals.unknown, estimated: list.filter((entry) => entry.estimated).length, caloriesState, proteinState,
    };
  });
  const logged = days.filter((day) => day.logged);
  const average = (list: readonly HistoryDay[], pick: (day: HistoryDay) => number) => Math.round(list.reduce((sum, day) => sum + pick(day), 0) / list.length);
  // A day where no entry has the value has no known amount of it, so it is left out of that average, not counted as 0.
  const macroAverage = (key: MacroKey) => {
    const known = logged.filter((day) => day.unknown[key] < day.entries);
    return known.length ? average(known, (day) => day[key]) : null;
  };
  const daysWithUnknown = { protein: 0, carbs: 0, fat: 0 };
  for (const day of logged) for (const key of MACRO_KEYS) if (day.unknown[key] > 0) daysWithUnknown[key] += 1;
  return {
    days,
    loggedDays: logged.length,
    averages: logged.length ? { calories: average(logged, (day) => day.calories), protein: macroAverage("protein"), carbs: macroAverage("carbs"), fat: macroAverage("fat") } : null,
    daysWithUnknown,
    estimatedEntries: days.reduce((sum, day) => sum + day.estimated, 0),
    totalEntries: days.reduce((sum, day) => sum + day.entries, 0),
    adherence: (calorieTarget !== null || proteinTarget !== null) && logged.length
      ? {
        calorieDays: calorieTarget !== null ? logged.filter((day) => day.caloriesState === "within").length : null,
        proteinDays: proteinTarget !== null ? logged.filter((day) => day.proteinState === "met").length : null,
        proteinUnknownDays: proteinTarget !== null ? logged.filter((day) => day.proteinState === "unknown").length : null,
      }
      : null,
  };
}

function positive(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}
