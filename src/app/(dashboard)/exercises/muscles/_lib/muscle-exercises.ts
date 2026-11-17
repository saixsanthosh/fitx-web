import { exerciseRegions, isRegionKey, regionsForMuscle, type RegionKey } from "@/lib/training/anatomy";
import type { CatalogExercise } from "@/lib/training/catalog";
import { EMPTY_QUERY, queryCatalog, type QueryContext, type RankedExercise } from "@/lib/training/catalog-search";
import { focusAreasForRegion, type FocusArea } from "@/lib/training/focus";
import type { TrainingContext } from "@/lib/training/taxonomy";

/** A region from a URL value: a region key, or a word for exactly one region ("upper_back", "abs"); else null. */
export function regionFromParam(value: string | null | undefined): RegionKey | null {
  const word = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!word) return null;
  if (isRegionKey(word)) return word;
  const regions = regionsForMuscle(word);
  return regions.length === 1 ? regions[0] : null;
}

export type RegionExercises = {
  /** Exercises with the region as their main muscle, best first (what the member can do first). */
  primary: RankedExercise[];
  /** Exercises that work it as an assisting muscle, best first. */
  assisting: RankedExercise[];
};

/**
 * The exercises for a body-map region, from the catalogue's muscle labels: main muscle first, then assisting.
 * Ranked like the library's "best match" (what the member can do, FITX staples, their level, compound first). At
 * home, only home-friendly exercises or ones the member can do are listed.
 */
export function exercisesForRegion(catalog: readonly CatalogExercise[], region: RegionKey, context: QueryContext & { environment?: TrainingContext | null }): RegionExercises {
  const ranked = queryCatalog(catalog, { ...EMPTY_QUERY, environment: context.environment === "home" ? "home" : null }, context).items;
  const primary: RankedExercise[] = [];
  const assisting: RankedExercise[] = [];
  for (const item of ranked) {
    const regions = exerciseRegions(item.exercise.primary_muscle, item.exercise.secondary_muscles);
    if (regions.primary.includes(region)) primary.push(item);
    else if (regions.secondary.includes(region)) assisting.push(item);
  }
  return { primary, assisting };
}

/** The focus area to build a workout for a region (its own area; traps → back). */
export function focusAreaForRegion(region: RegionKey): FocusArea | null {
  return focusAreasForRegion(region)[0] ?? null;
}

/** A local YYYY-MM-DD day as "Fri 20 Nov" (no time-zone shift). */
export function shortDate(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, date)));
}

/** "Today", "Yesterday", "3 days ago", else the date ("12 Nov 2026"), for a local YYYY-MM-DD day. */
export function lastTrainedText(day: string, todayKey: string): string {
  const parse = (key: string) => {
    const [year, month, date] = key.split("-").map(Number);
    return Date.UTC(year, (month || 1) - 1, date || 1);
  };
  const days = Math.round((parse(todayKey) - parse(day)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  const [year, month, date] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, date)));
}
