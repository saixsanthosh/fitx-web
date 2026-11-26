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

/**
 * Where an announcement is read: on the page, or inside the modal dialog that is open (Coach settings, the history
 * drawer). A modal dialog makes the rest of the page inert, so a live region behind it is never read (BRIEF-3 D6): each
 * dialog has its own region, always in it.
 */
export type AnnouncePlace = "page" | "settings" | "history";

/** An announcement and where it is read; `place` is null until the render that first shows it (settleAnnouncement). */
export type Announcement = { text: string; count: number; place: AnnouncePlace | null };

export const NO_ANNOUNCEMENT: Announcement = { text: "", count: 0, place: "page" };

/** A new announcement, placed by the next render. */
export function nextAnnouncement(old: Announcement, text: string): Announcement {
  return { text, count: old.count + 1, place: null };
}

/** Where an announcement can be read now: inside the open dialog, else on the page. */
export function readablePlace(open: { settings: boolean; history: boolean }): AnnouncePlace {
  return open.settings ? "settings" : open.history ? "history" : "page";
}

/**
 * The announcement as a render shows it. A new one goes where it can be read in the render that first shows it, so one
 * made in the update that closes a dialog is read on the page, and one made while a dialog stays open is read inside it.
 * One left in a dialog that has closed is dropped, so opening that dialog again reads nothing old, and the page's region
 * doesn't change, so nothing is read twice. The same object when nothing changes.
 */
export function settleAnnouncement(announcement: Announcement, readable: AnnouncePlace): Announcement {
  if (announcement.place === null) return { ...announcement, place: readable };
  if (announcement.place !== "page" && announcement.place !== readable) return { ...announcement, text: "", place: "page" };
  return announcement;
}

/** The text of the live region at `place`: the announcement placed there, else nothing. */
export function liveRegionText(announcement: Announcement, place: AnnouncePlace): string {
  return announcement.place === place ? announcementText(announcement.text, announcement.count) : "";
}
