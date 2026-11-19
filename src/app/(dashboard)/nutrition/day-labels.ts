import { readableDate } from "@/lib/domain/dates";

export type NutritionDayLabels = { picker: string; heading: string; summary: string; diary: string };

/**
 * The nutrition page's date texts: the day picker, the overview's heading, the overview's accessible name and the
 * day's meals.
 * The page is prerendered once, at build time, so its HTML can know neither the viewer's day nor their locale.
 * Until the page has hydrated (`day` null) they say "Today", which is the day it always opens on; after that
 * they name the chosen day in the viewer's own format.
 */
export function nutritionDayLabels(day: Date | null): NutritionDayLabels {
  if (!day) return { picker: "Today", heading: "Today", summary: "Today's nutrition summary", diary: "Today" };
  return {
    picker: readableDate(day, { weekday: "short", month: "short", day: "numeric", year: "numeric" }),
    heading: readableDate(day, { weekday: "long", month: "long", day: "numeric" }),
    summary: `Nutrition summary for ${readableDate(day)}`,
    diary: readableDate(day, { weekday: "short", month: "short", day: "numeric" }),
  };
}
