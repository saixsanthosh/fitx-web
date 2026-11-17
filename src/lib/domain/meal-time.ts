/**
 * Meal sections: the four standard ones, the member's own named sections, and which one to suggest for the time of
 * day. A section is just the text in meals.meal, so nothing in the database limits the names.
 */

export const DEFAULT_MEALS = ["Breakfast", "Lunch", "Dinner", "Snack"] as const;

export const MEAL_NAME_MAX = 40;
/** How far back a named section stays in the list once it was last used. */
export const SECTION_DAYS = 30;

/**
 * The meal to suggest at a local time: before 11:00 Breakfast, 11:00-16:00 Lunch, 16:00-19:00 Snack, from 19:00
 * Dinner. It is only a starting point; the member can pick any section.
 */
export function mealForTime(date: Date): (typeof DEFAULT_MEALS)[number] {
  const hour = date.getHours() + date.getMinutes() / 60;
  if (hour < 11) return "Breakfast";
  if (hour < 16) return "Lunch";
  if (hour < 19) return "Snack";
  return "Dinner";
}

/** A typed section name trimmed and squeezed, or the reason it cannot be used. */
export function checkSectionName(input: string): { ok: true; name: string } | { ok: false; reason: string } {
  const name = input.replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, reason: "Give the meal a name." };
  if (name.length > MEAL_NAME_MAX) return { ok: false, reason: `Keep the name to ${MEAL_NAME_MAX} characters or fewer.` };
  if (/[<>]/.test(name)) return { ok: false, reason: "Use letters, numbers and spaces in the name." };
  return { ok: true, name };
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The sections to list: the four standard ones, then the member's own names (used in the last 30 days, or just added
 * on this page) once each, matched without regard to case, in the order first seen. A name that only differs from a
 * standard one by case is that standard section.
 */
export function mealSections(used: readonly string[], extra: readonly string[] = []): string[] {
  const out: string[] = [...DEFAULT_MEALS];
  for (const raw of [...used, ...extra]) {
    const name = raw.replace(/\s+/g, " ").trim();
    if (!name || out.some((existing) => same(existing, name))) continue;
    out.push(name);
  }
  return out;
}

/** The standard spelling of a typed section that is one of the four standard ones; otherwise the name as typed. */
export function canonicalMeal(name: string): string {
  const trimmed = name.replace(/\s+/g, " ").trim();
  return DEFAULT_MEALS.find((meal) => same(meal, trimmed)) ?? trimmed;
}
