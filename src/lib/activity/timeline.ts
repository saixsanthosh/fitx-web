import type { ActivityView } from "./repository";
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
