/**
 * Which day's figures Nutrition may show. Until the day asked for has loaded, nothing about it is known, so the page
 * shows a loading (or failed) state: never "0 kcal eaten", "no target" or another day's figures under this day's date.
 * Pure, so `node --test` can check it.
 */

export type DayLoad = "loading" | "ready" | "failed";

/**
 * `shownKey`: the day whose meals, water and targets the page holds (null before the first load); `failedKey`: the
 * day whose last load failed. The day asked for is ready only once its own data is in.
 */
export function dayLoadState(shownKey: string | null, failedKey: string | null, wantedKey: string): DayLoad {
  if (shownKey === wantedKey) return "ready";
  if (failedKey === wantedKey) return "failed";
  return "loading";
}

/** The overview's line while the day's figures are not there. */
export function dayStatusText(state: Exclude<DayLoad, "ready">): string {
  return state === "loading" ? "Loading this day…" : "This day couldn't be loaded.";
}

/** The meal list's line while the day's meals are not there. */
export function mealsStatusText(state: Exclude<DayLoad, "ready">): string {
  return state === "loading" ? "Loading meals…" : "This day's meals couldn't be loaded. Reload the page to try again.";
}
