import type { HistoryDay } from "@/lib/domain/nutrition-history";

/** The History tab's protein, carbs and fat averages: null means no logged day in the period had a value for it. */
export type AverageMacro = "protein" | "carbs" | "fat";

/**
 * A logged day's protein, carbs or fat in History's table: "unknown" when none of that day's entries gives it (never
 * 0, as the averages already leave such a day out), else its known total and how many entries without it were left out.
 */
export function dayMacroText(day: Pick<HistoryDay, "entries" | "unknown" | AverageMacro>, key: AverageMacro): string {
  const missing = day.unknown[key];
  if (day.entries > 0 && missing >= day.entries) return "unknown";
  return `${day[key]}${missing ? ` (${missing} ${missing === 1 ? "entry" : "entries"} without a value left out)` : ""}`;
}

/**
 * The note for a History tile whose average is unknown: it names each macro that no logged day had a value for, so a
 * blank tile says why, or it is null when every average on the tile is known (or there are no averages at all).
 */
export function unknownAverageNote(averages: Partial<Record<AverageMacro, number | null>> | null | undefined, keys: readonly AverageMacro[]): string | null {
  if (!averages) return null;
  const missing = keys.filter((key) => averages[key] === null || averages[key] === undefined);
  return missing.length ? `No logged day has a ${missing.join(" or ")} value.` : null;
}
