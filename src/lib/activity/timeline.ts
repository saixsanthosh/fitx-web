import { addedIds, focusAfterShowMore } from "@/lib/workouts/show-more";
import type { ListFocus } from "./focus";
import type { ActivityView, DbResult } from "./repository";
import type { StrengthSession } from "./strength";

/*
 * The Activity history as one timeline: walks, runs and rides next to completed strength sessions,
 * newest first. Both lists are read a page at a time, so an item is shown only once nothing newer
 * can still be missing: an entry older than the oldest loaded entry of a list that has more pages
 * waits until that list's next page is read. Strength sessions never change distance totals.
 */

export type TimelineEntry =
  | { kind: "activity"; startedAt: number; key: string; activity: ActivityView }
  | { kind: "strength"; startedAt: number; key: string; session: StrengthSession };

export type Paged<T> = { items: readonly T[]; more: boolean };

const oldest = <T extends { startedAt: number }>(source: Paged<T>) => (source.items.length ? source.items[source.items.length - 1].startedAt : null);

/** The time before which entries may still be missing (null when both lists are complete). */
export function timelineBoundary(activities: Paged<{ startedAt: number }>, sessions: Paged<{ startedAt: number }>): number | null {
  const bounds = [activities.more ? oldest(activities) : null, sessions.more ? oldest(sessions) : null].filter((value): value is number => value !== null);
  return bounds.length ? Math.max(...bounds) : null;
}

/** Which list to read next for "Show older": the one whose oldest loaded entry is newest. */
export function nextToLoad(activities: Paged<{ startedAt: number }>, sessions: Paged<{ startedAt: number }>): "activities" | "sessions" | null {
  const a = activities.more ? oldest(activities) : null;
  const s = sessions.more ? oldest(sessions) : null;
  if (a === null && s === null) return null;
  if (s === null) return "activities";
  if (a === null) return "sessions";
  return a >= s ? "activities" : "sessions";
}

const activityKey = (activity: ActivityView) => (activity.local ? `local-${activity.clientId}` : `activity-${activity.id ?? activity.clientId}`);

/**
 * The entries that can be shown now, newest first, and whether older ones remain. `onDevice` are
 * activities kept only on this device: all of them are known, so they never hold the boundary back.
 */
export function mergeTimeline(activities: Paged<ActivityView>, sessions: Paged<StrengthSession>, onDevice: readonly ActivityView[] = []): { entries: TimelineEntry[]; more: boolean } {
  const boundary = timelineBoundary(activities, sessions);
  const entries: TimelineEntry[] = [
    ...[...onDevice, ...activities.items].map((activity): TimelineEntry => ({ kind: "activity", startedAt: activity.startedAt, key: activityKey(activity), activity })),
    ...sessions.items.map((session): TimelineEntry => ({ kind: "strength", startedAt: session.startedAt, key: `strength-${session.id}`, session })),
  ]
    .filter((entry) => boundary === null || entry.startedAt >= boundary)
    .sort((a, b) => b.startedAt - a.startedAt || a.key.localeCompare(b.key));
  return { entries, more: activities.more || sessions.more };
}

/**
 * Where keyboard focus goes once "Show older activities" has read its page (D5, FITX's rule for every "show more"
 * button, show-more.ts): nowhere new while older entries remain, since the button stays and keeps focus; once it goes,
 * the first entry the press brought (by its key), or the last entry shown when it brought none.
 */
export function focusAfterOlder(shown: readonly string[], next: readonly string[], more: boolean): string | null {
  const target = focusAfterShowMore({ more, shown, added: addedIds(shown, next) });
  return target === "button" ? null : target;
}

/*
 * Strength sessions that couldn't be read. A failed page of them stops them holding the timeline back (`more: false`),
 * so older activities still show; the list says so, with Try again. Try again reads on from the last session it has,
 * page by page, until the sessions reach the oldest entry the list already shows: with more pages of sessions the
 * boundary moves back to their oldest one, and an entry already on screen must never be held back again.
 */

/** The oldest time the timeline shows (its last entry), or null when it shows nothing. */
export function shownFloor(entries: readonly { startedAt: number }[]): number | null {
  return entries.length ? entries[entries.length - 1].startedAt : null;
}

/** Whether Try again must read another page of sessions: there are more, and the oldest read is still newer than the floor. */
export function sessionsBehind(more: boolean, oldestRead: number | null, floor: number | null): boolean {
  return more && floor !== null && oldestRead !== null && oldestRead > floor;
}

/**
 * Try again's read: pages of `pageSize` sessions older than the last one it has (`read(before)`, null when a page
 * fails), until the sessions reach `floor` or there are no more. A failed page ends it with what was read (`failed`);
 * null when the list was read again from the start meanwhile (`stillWanted`), so its result is dropped. At most
 * `maxPages` pages, a stop for a server that ignores `before`.
 */
export async function readSessionsOn(
  start: readonly StrengthSession[],
  floor: number | null,
  pageSize: number,
  read: (before: number | null) => Promise<StrengthSession[] | null>,
  options: { maxPages: number; stillWanted: () => boolean },
): Promise<{ items: StrengthSession[]; more: boolean; failed: boolean } | null> {
  let items = [...start];
  let more = true;
  for (let page = 0; page < options.maxPages; page += 1) {
    const rows = await read(items.length ? items[items.length - 1].startedAt : null);
    if (!options.stillWanted()) return null;
    if (!rows) return { items, more: false, failed: true };
    items = [...items, ...rows];
    more = rows.length === pageSize;
    if (!sessionsBehind(more, items.length ? items[items.length - 1].startedAt : null, floor)) break;
  }
  return { items, more, failed: false };
}

/**
 * Where focus goes once Try again has read the sessions (D5): its line and button go, so to the first entry it brought;
 * when it brought none, to "Show older activities" if that stays ("older"), else to the last entry shown.
 */
export function focusAfterSessionsRetry(shown: readonly string[], next: readonly string[], more: boolean): string | "older" | null {
  const added = addedIds(shown, next);
  if (added.length) return added[0];
  if (more) return "older";
  return next[next.length - 1] ?? null;
}

/*
 * The list on screen read again (round 3e, D5): back online, Upload now or the figures' Try again read the history again
 * from its newest entry. It used to be drawn from its loading state and from its first page only, so every entry, "Show
 * older activities" and the strength sessions' Try again went while it read (and the older pages for good), and focus on
 * any of them fell to the page. Now it stays on screen while it is read again, as far back as it shows, and is swapped
 * in at once: what had focus is still there, or focus goes where focusAfterReread says.
 */

/** One page of a list: the entries older than `before` (from the newest with null). */
export type PageRead<T> = (before: number | null) => Promise<DbResult<T[]>>;

/** A list read again: what was read, or the first page's failure (the list itself couldn't be read). */
export type ReadAgain<T> =
  | { status: "ok"; items: T[]; more: boolean; olderFailed: boolean }
  | { status: "failed"; result: Exclude<DbResult<T[]>, { status: "ok" }> };

/**
 * Reads a list again from its newest entry, page by page, until it reaches `floor` (the oldest entry the timeline
 * shows: shownFloor) or has no more, so a list read again on screen never shows less than it did. A later page that
 * fails keeps what was read, with more to come (`olderFailed`: said beside "Show older activities"). Null when the
 * list was read again meanwhile, or another sport chosen (`stillWanted`). At most `maxPages` pages.
 */
export async function readListAgain<T extends { startedAt: number }>(
  read: PageRead<T>,
  floor: number | null,
  pageSize: number,
  options: { maxPages: number; stillWanted: () => boolean },
): Promise<ReadAgain<T> | null> {
  let items: T[] = [];
  for (let page = 0; page < options.maxPages; page += 1) {
    const result = await read(items.length ? items[items.length - 1].startedAt : null);
    if (!options.stillWanted()) return null;
    if (result.status !== "ok") return page === 0 ? { status: "failed", result } : { status: "ok", items, more: true, olderFailed: true };
    items = [...items, ...result.data];
    const more = result.data.length === pageSize;
    if (!sessionsBehind(more, items.length ? items[items.length - 1].startedAt : null, floor)) return { status: "ok", items, more, olderFailed: false };
  }
  return { status: "ok", items, more: true, olderFailed: false };
}

/**
 * Where focus goes once the history list is drawn again (read again, or after its loading state) when what had focus
 * went with it (D5). An entry: the same one, or the entry the same activity is now (one kept on this device and
 * uploaded meanwhile is listed as saved, under another key). Show older activities: itself while it is shown, else the
 * last entry (FITX's show-more rule). The strength sessions' Try again: itself while its line is shown, else, as after
 * a press of it (focusAfterSessionsRetry), the first session the read brought (not a new activity at the top), else
 * Show older activities, else the last entry. Else the list heading ("list").
 */
export function focusAfterReread(
  went: ListFocus,
  list: { before: readonly TimelineEntry[]; after: readonly TimelineEntry[]; more: boolean; sessionsShown: boolean },
): string | "older" | "sessions" | "list" {
  const keys = list.after.map((entry) => entry.key);
  if ("entry" in went) {
    if (keys.includes(went.entry)) return went.entry;
    const was = list.before.find((entry) => entry.key === went.entry);
    const clientId = was?.kind === "activity" ? was.activity.clientId : null;
    const same = clientId === null ? undefined : list.after.find((entry) => entry.kind === "activity" && entry.activity.clientId === clientId);
    return same?.key ?? "list";
  }
  if (went.control === "sessions") {
    if (list.sessionsShown) return "sessions";
    const shown = new Set(list.before.map((entry) => entry.key));
    const brought = list.after.find((entry) => entry.kind === "strength" && !shown.has(entry.key));
    if (brought) return brought.key;
  }
  return list.more ? "older" : keys[keys.length - 1] ?? "list";
}
