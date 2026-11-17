/**
 * Totals of logged food with unknown values kept unknown (contract C11), for Home, Progress, insights and goals.
 *
 * A logged entry's calories, protein, carbs or fat is unknown when the column is NULL or the entry's
 * `nutrition_snapshot.missing` names it (the label or the source did not give that value). Totals add up the
 * known values only and count the entries that lack one, so a screen says "1 food has no protein value"
 * instead of reading it as 0, and a day whose entries all lack a value has no total at all (null), never 0.
 * Estimated entries (a typical recipe, an AI suggestion, an average portion weight) are counted with the
 * Nutrition log's own rule (an estimate value basis, or a portion marked as an estimate).
 */
import { entryBasis, type MealEntry } from "@/lib/food/client-data";
import { basisInfo } from "@/lib/food/value-basis";

export const MACRO_KEYS = ["calories", "protein", "carbs", "fat"] as const;
export type MacroKey = (typeof MACRO_KEYS)[number];

/** The meals columns these totals read. */
export const MEAL_VALUE_COLUMNS = "date,calories,protein,carbs,fat,source,nutrition_snapshot";

export type MealValueRow = {
  date?: unknown;
  calories?: unknown;
  protein?: unknown;
  carbs?: unknown;
  fat?: unknown;
  source?: unknown;
  nutrition_snapshot?: unknown;
};

export type MacroTotal = {
  /** The sum of the known values. */
  sum: number;
  /** Entries with a known value. */
  known: number;
  /** Entries without one: never counted as 0. */
  missing: number;
};

export type MealTotals = Record<MacroKey, MacroTotal> & {
  entries: number;
  /** Entries whose values or portion are an estimate. */
  estimated: number;
};

const obj = (value: unknown): Record<string, unknown> | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

function missingList(row: MealValueRow): ReadonlySet<string> {
  const list = obj(row.nutrition_snapshot)?.missing;
  return new Set(Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : []);
}

/** One entry's value for a macro, or null when it is unknown. */
export function macroValue(row: MealValueRow, key: MacroKey): number | null {
  if (missingList(row).has(key)) return null;
  const value = row[key];
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

/** The Nutrition log's estimate rule: an estimated value basis, or a portion weight that is an estimate. */
export function isEstimatedMeal(row: MealValueRow): boolean {
  const snapshot = obj(row.nutrition_snapshot) ?? {};
  if (obj(snapshot.portion)?.estimate === true) return true;
  const entry = { source: typeof row.source === "string" ? row.source : "", nutrition_snapshot: snapshot } as unknown as MealEntry;
  return basisInfo(entryBasis(entry)).estimate;
}

export function emptyMealTotals(): MealTotals {
  return {
    entries: 0,
    estimated: 0,
    calories: { sum: 0, known: 0, missing: 0 },
    protein: { sum: 0, known: 0, missing: 0 },
    carbs: { sum: 0, known: 0, missing: 0 },
    fat: { sum: 0, known: 0, missing: 0 },
  };
}

function add(totals: MealTotals, row: MealValueRow) {
  totals.entries += 1;
  if (isEstimatedMeal(row)) totals.estimated += 1;
  for (const key of MACRO_KEYS) {
    const value = macroValue(row, key);
    if (value === null) totals[key].missing += 1;
    else {
      totals[key].sum += value;
      totals[key].known += 1;
    }
  }
}

/** Totals over any set of entries. */
export function mealTotals(rows: readonly MealValueRow[]): MealTotals {
  const totals = emptyMealTotals();
  for (const row of rows) add(totals, row);
  return totals;
}

/** Totals per logged day (rows need `date`, YYYY-MM-DD). Days without entries are absent, never zero. */
export function mealTotalsByDay(rows: readonly MealValueRow[]): Map<string, MealTotals> {
  const days = new Map<string, MealTotals>();
  for (const row of rows) {
    const date = typeof row.date === "string" ? row.date.slice(0, 10) : null;
    if (!date) continue;
    const totals = days.get(date) ?? emptyMealTotals();
    add(totals, row);
    days.set(date, totals);
  }
  return days;
}

/** The known total, or null when no entry had a value (unknown, never 0). */
export function knownTotal(total: MacroTotal): number | null {
  return total.known > 0 ? Math.round(total.sum * 10) / 10 : null;
}

const NOUNS: Record<MacroKey, string> = { calories: "calorie", protein: "protein", carbs: "carb", fat: "fat" };

/** "1 food has no protein value", "3 foods have no carb value"; "" when none is missing. */
export function missingNote(total: MacroTotal, key: MacroKey): string {
  if (total.missing <= 0) return "";
  return `${total.missing} ${total.missing === 1 ? "food has" : "foods have"} no ${NOUNS[key]} value`;
}
