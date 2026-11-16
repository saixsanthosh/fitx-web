/** The Goals section's tabs; shared by the server page (URL parsing) and the client workspace. */
export const GOALS_TAB_IDS = ["today", "goals", "week"] as const;
export type GoalsTabId = (typeof GOALS_TAB_IDS)[number];

export function isGoalsTab(value: unknown): value is GoalsTabId {
  return typeof value === "string" && (GOALS_TAB_IDS as readonly string[]).includes(value);
}
