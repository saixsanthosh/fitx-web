/**
 * Logged food per day for Home, Progress, insights and goals, with unknown values kept unknown (contract C11):
 * see src/lib/domain/meal-totals.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { MEAL_VALUE_COLUMNS, mealTotalsByDay, type MealTotals, type MealValueRow } from "@/lib/domain/meal-totals";
import { DataError } from "./missing-schema";
import { pagedRows } from "./rows";

type Db = Pick<SupabaseClient, "from">;

/** Without the estimate check only the values and the snapshot's `missing` list are read (a smaller answer). */
const VALUE_ONLY_COLUMNS = "date,calories,protein,carbs,fat,missing:nutrition_snapshot->missing";

export type FoodDays = {
  /** Totals per logged day; days without entries are absent. */
  days: Map<string, MealTotals>;
  /** True when more rows existed than were read. */
  capped: boolean;
};

/**
 * Entries logged on the days from `fromKey` to `toKey` (inclusive), totalled per day. With `estimates` the
 * snapshot is read whole, so estimated entries are counted too.
 */
export async function loadFoodDays(db: Db, userId: string, fromKey: string, toKey: string, options: { estimates?: boolean } = {}): Promise<FoodDays> {
  const columns = options.estimates ? MEAL_VALUE_COLUMNS : VALUE_ONLY_COLUMNS;
  const result = await pagedRows<Record<string, unknown>>((from, to) => db.from("meals")
    .select(columns)
    .eq("user_id", userId)
    .gte("date", fromKey)
    .lte("date", toKey)
    .order("date", { ascending: true })
    .order("id", { ascending: true })
    .range(from, to), { maxPages: 6 });
  if (result.error) throw new DataError("Your food log could not be loaded.", result.error);
  const rows: MealValueRow[] = options.estimates
    ? result.rows
    : result.rows.map((row) => ({ ...row, nutrition_snapshot: { missing: Array.isArray(row.missing) ? row.missing : [] } }));
  return { days: mealTotalsByDay(rows), capped: result.capped };
}
