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

export type DayActionLabels = { copy: string; copyEmpty: string; saveDay: string };

/**
 * The meal log's day buttons, in the words of the day being viewed: on today they copy "yesterday" and save "today";
 * on any other day they copy "the day before" and save "this day" (what they act on, and what screen readers hear).
 */
export function dayActionLabels(isToday: boolean): DayActionLabels {
  return isToday
    ? { copy: "Copy yesterday", copyEmpty: "Copy yesterday's meals", saveDay: "Save today as a routine" }
    : { copy: "Copy the day before", copyEmpty: "Copy meals from the day before", saveDay: "Save this day as a routine" };
}

/** What copying the day before says, naming that day ("Sunday, 22 November"), never a "yesterday" it isn't. */
export function copyDayMessages(previous: Date, isToday: boolean) {
  const day = readableDate(previous, { weekday: "long", day: "numeric", month: "long" });
  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  return {
    readFailed: isToday ? "Yesterday's meals could not be read. Please try again." : `The meals of ${day} could not be read. Please try again.`,
    nothing: `Nothing was logged on ${day}.`,
    confirm: (existing: number, count: number) => `This day already has ${plural(existing, "entry", "entries")}. Add the ${plural(count, "food", "foods")} from ${day} too?`,
    copyFailed: `The meals of ${day} could not be copied. Please try again.`,
    copied: (count: number) => `Copied ${plural(count, "food", "foods")} from ${day}.`,
  };
}
