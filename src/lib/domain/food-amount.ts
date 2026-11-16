/**
 * The food log's Amount and Unit fields: what an amount weighs, and what the amount becomes when the
 * unit changes. Pure functions, so the nutrition page and `node --test` share them.
 */
import { formatAmount } from "./food-query";
import type { FoodPortion, FoodUnit, PortionResolution } from "./food-query";

/** A count typed before FITX had to ask about it, such as the 2 in "2 small boiled eggs", and what it counts. */
export interface TypedCount {
  amount: number;
  unit: FoodUnit;
}

/** Units of whole things: another size of piece or slice is still the same number of them. */
const COUNTED_UNITS = new Set<FoodUnit>(["piece", "slice"]);

/** What `count` of a portion weighs, or `count` grams when there is no portion; NaN when no amount is entered. */
export function amountInGrams(count: number, portion: FoodPortion | null): number {
  return Number.isFinite(count) ? Math.round(count * (portion ? portion.grams : 1) * 10) / 10 : Number.NaN;
}

/**
 * The Amount field's text after the unit changes from one portion to another (null is grams).
 * - Between two sizes of the same piece or slice the count stays and the grams follow the size: 2 samosas
 *   switched to the small size are 2 small samosas (50 g), not 8.
 * - Otherwise the weight stays (grams and a measure, a piece and a cup, a tablespoon and a teaspoon), so
 *   "100" g does not become 100 servings: 114 g of idli becomes 3 × 38 g, and 3 idlis become 114 g.
 * - With no amount yet, grams start at 100 and a measure at 1, or at the count typed for it when FITX had
 *   to ask about the size (see countToKeep).
 */
export function amountAfterUnitChange(amount: string, from: FoodPortion | null, to: FoodPortion | null, typed: TypedCount | null = null): string {
  const count = amount.trim() ? Number(amount) : Number.NaN;
  if (from && to && from.unit === to.unit && COUNTED_UNITS.has(to.unit) && Number.isFinite(count) && count > 0) return amount;
  const grams = amountInGrams(count, from);
  const converted = grams > 0 ? (to ? grams / to.grams : grams) : Number.NaN;
  if (converted >= 0.01) return formatAmount(converted);
  if (!to) return "100";
  return typed && typed.unit === to.unit ? formatAmount(typed.amount) : "1";
}

/**
 * The count to keep while FITX asks for an amount. Only a missing size keeps one: "2 small boiled eggs" is
 * still 2 eggs once one of USDA's sizes is picked, while "150 rice" or "2 cups idli" say nothing about how
 * many of another measure were meant.
 */
export function countToKeep(resolution: PortionResolution): TypedCount | null {
  if (resolution.kind !== "ask" || resolution.reason !== "no-size-weight") return null;
  return { amount: resolution.amount, unit: resolution.unit ?? "piece" };
}
