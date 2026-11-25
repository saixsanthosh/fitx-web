/**
 * Where keyboard focus goes when an action on the coach page removes the control the member used, and how the page's
 * polite announcements are worded. Free of React and of runtime imports so `node --test` can run them (BRIEF-3 D5).
 */

import type { CoachState, CoachStatus } from "@/lib/ai/status";

export type ListFocus = { kind: "thread"; id: string } | { kind: "new" };

/**
 * After a conversation is deleted from the list: the conversation that moves into its place (the next one), else the
 * one before it, else "New conversation" once the list is empty.
 */
export function focusAfterDelete(ids: readonly string[], deletedId: string): ListFocus {
  const index = ids.indexOf(deletedId);
  const rest = ids.filter((id) => id !== deletedId);
  if (index < 0 || !rest.length) return { kind: "new" };
  return { kind: "thread", id: rest[Math.min(index, rest.length - 1)] };
}

/**
 * The text of the page's polite live region. Screen readers announce a live region when its text changes, so the same
 * words twice in a row ("Deleted “Rest days”.") would be read only once: every second announcement ends with a
 * no-break space, which changes the text without changing what is read.
 */
export function announcementText(text: string, count: number): string {
  return text && count % 2 === 1 ? `${text} ` : text;
}

/** The states in which the page shows the paused or not-switched-on screen (CoachUnavailable) instead of the coach. */
export const UNAVAILABLE_STATES: ReadonlySet<CoachState> = new Set<CoachState>(["paused", "not_configured", "not_available"]);

/**
 * On that screen, Coach settings (sharing, "Delete my coach data") stays reachable for a member who has coach data: a
 * consent, or conversations. Not while FITX can't keep coach conversations at all (not_available).
 */
export function settingsReachable(status: Pick<CoachStatus, "state" | "consent">, threadCount: number): boolean {
  return status.state !== "not_available" && (status.consent !== null || threadCount > 0);
}

/**
 * The page's status right after "Delete my coach data" went through. On the paused screen nothing is left for Coach
 * settings, so its button goes at once, in the same update that closes the dialog, and focus moves to the screen's
 * heading then (when it went only once the fresh status arrived, focus was back on it and fell to the page). Elsewhere
 * the status waits for the fresh one: the consent screen that replaces the coach needs its details.
 */
export function statusAfterDelete(status: CoachStatus): CoachStatus {
  return UNAVAILABLE_STATES.has(status.state) ? { ...status, consent: null, threads: [] } : status;
}
