/**
 * App routes that more than one area links to. Link through these instead of typing the path, so a
 * move only changes this file (old paths keep working through redirects in next.config.ts).
 */

/** Camera-coached bodyweight training (was the Form coach at /form-coach, which redirects here). */
export const HOME_WORKOUT = "/home-workout";

/** The panels Home opens over its dashboard: goals, the To-Do list and the week plan. */
export const HOME_PANELS = ["goals", "todo", "week"] as const;
export type HomePanel = (typeof HOME_PANELS)[number];

/**
 * A link to one of Home's panels: `/dashboard?panel=goals`, plus any extra parameters (for example
 * `{ new: "water_day" }` to open the goal editor on a template). `panel` always comes first and an
 * extra `panel` key is ignored.
 */
export function homePanel(panel: HomePanel, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ panel });
  for (const [key, value] of Object.entries(extra)) if (key !== "panel") params.append(key, value);
  return `/dashboard?${params.toString()}`;
}
