/**
 * The exercise page's tabs (contract C6: Guide · Muscles · History · Progress) and how the open tab is kept in
 * the address (`/exercises/<id>?tab=muscles`). The Guide is the default and is left out of the address. Pure, so
 * the server page, the client view and node tests share it.
 */

export const EXERCISE_TABS = ["guide", "muscles", "history", "progress"] as const;
export type ExerciseTab = (typeof EXERCISE_TABS)[number];

export const DEFAULT_EXERCISE_TAB: ExerciseTab = "guide";

export const EXERCISE_TAB_LABELS: Readonly<Record<ExerciseTab, string>> = {
  guide: "Guide",
  muscles: "Muscles",
  history: "History",
  progress: "Progress",
};

export function isExerciseTab(value: unknown): value is ExerciseTab {
  return typeof value === "string" && (EXERCISE_TABS as readonly string[]).includes(value);
}

/** The tab a `?tab=` value names (the first one when it is repeated); the Guide for anything else. */
export function exerciseTabFrom(value: string | readonly string[] | null | undefined): ExerciseTab {
  const first = typeof value === "string" ? value : Array.isArray(value) ? value[0] : null;
  const wanted = typeof first === "string" ? first.trim().toLowerCase() : null;
  return isExerciseTab(wanted) ? wanted : DEFAULT_EXERCISE_TAB;
}

/**
 * `search` (a query string, with or without its "?") with the tab set: "" or "?…". The Guide, the default, is
 * removed rather than written; other parameters are kept as they are.
 */
export function searchWithTab(search: string, tab: ExerciseTab): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (tab === DEFAULT_EXERCISE_TAB) params.delete("tab");
  else params.set("tab", tab);
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** An exercise page's address, on a tab. */
export function exerciseHref(id: string, tab: ExerciseTab = DEFAULT_EXERCISE_TAB): string {
  return `/exercises/${encodeURIComponent(id)}${searchWithTab("", tab)}`;
}

/** History and Progress read the member's logged sessions; the other tabs do not. */
export function tabNeedsHistory(tab: ExerciseTab): boolean {
  return tab === "history" || tab === "progress";
}
