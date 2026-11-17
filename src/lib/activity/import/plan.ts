import type { ActivitySource, Sport } from "../types";

/*
 * Before anything is saved, each file is checked against the account and the other files chosen
 * with it: the same session twice (same device id) is imported once, a session already in FITX is
 * not imported again, and one that overlaps another activity in time (a walk recorded with FITX
 * while the watch recorded it too) is held back until the person says to import it anyway.
 */

/** Two activities closer than this (seconds of shared time) are not called overlapping: clocks differ a little. */
export const OVERLAP_TOLERANCE_MS = 60_000;

export type KnownActivity = {
  id: string | null;
  clientId: string;
  sport: Sport;
  title: string;
  startedAt: number;
  endedAt: number;
  source: ActivitySource;
  /** Still only on this device (recorded offline, not uploaded yet). */
  local: boolean;
};

export type Candidate = { key: string; clientId: string; startedAt: number; endedAt: number };

export type ImportCheck =
  | { kind: "ready" }
  /** Another file chosen with it is the same session. */
  | { kind: "same-file"; otherKey: string }
  /** The account already has this session. */
  | { kind: "already"; activity: KnownActivity }
  /** It overlaps an activity in the account (or on this device), or another chosen file. */
  | { kind: "overlap"; activity: KnownActivity | null; otherKey: string | null };

/** Shared time of two periods, ms (0 when they don't meet). */
export function overlapMs(a: { startedAt: number; endedAt: number }, b: { startedAt: number; endedAt: number }): number {
  return Math.max(0, Math.min(a.endedAt, b.endedAt) - Math.max(a.startedAt, b.startedAt));
}

const overlaps = (a: { startedAt: number; endedAt: number }, b: { startedAt: number; endedAt: number }) => overlapMs(a, b) > OVERLAP_TOLERANCE_MS;

/**
 * How one file stands. `existing` is what the account (and this device) already holds around its
 * time; `earlier` the files before it in the list that will be imported.
 */
export function checkImport(candidate: Candidate, existing: readonly KnownActivity[], earlier: readonly Candidate[]): ImportCheck {
  const twin = earlier.find((other) => other.clientId === candidate.clientId);
  if (twin) return { kind: "same-file", otherKey: twin.key };
  const saved = existing.find((activity) => activity.clientId === candidate.clientId);
  if (saved) return { kind: "already", activity: saved };
  const clash = existing.find((activity) => overlaps(activity, candidate));
  if (clash) return { kind: "overlap", activity: clash, otherKey: null };
  const sibling = earlier.find((other) => overlaps(other, candidate));
  if (sibling) return { kind: "overlap", activity: null, otherKey: sibling.key };
  return { kind: "ready" };
}

/** What happened to one file. */
export type ImportResult =
  | { kind: "imported"; id: string }
  | { kind: "already"; id: string | null }
  | { kind: "skipped"; reason: "overlap" | "same-file" }
  | { kind: "unsupported"; label: string }
  | { kind: "failed"; reason: string };

/** "3 imported, 1 already in FITX, 1 skipped (overlaps another activity), 1 not a walk, run or ride, 1 failed." */
export function summariseResults(results: readonly ImportResult[]): string {
  const count = (kind: ImportResult["kind"]) => results.filter((result) => result.kind === kind).length;
  const parts: string[] = [];
  const imported = count("imported");
  const already = count("already");
  const skipped = count("skipped");
  const unsupported = count("unsupported");
  const failed = count("failed");
  if (imported) parts.push(`${imported} imported`);
  if (already) parts.push(`${already} already in FITX`);
  if (skipped) parts.push(`${skipped} skipped`);
  if (unsupported) parts.push(`${unsupported} not a walk, run or ride`);
  if (failed) parts.push(`${failed} not imported`);
  return parts.length ? `${parts.join(", ")}.` : "Nothing was imported.";
}

/** The time window to look up existing activities for a set of files (with the tolerance on both sides). */
export function lookupWindow(candidates: readonly Candidate[]): { from: number; to: number } | null {
  if (!candidates.length) return null;
  let from = Infinity;
  let to = -Infinity;
  for (const candidate of candidates) {
    from = Math.min(from, candidate.startedAt);
    to = Math.max(to, candidate.endedAt);
  }
  return { from, to };
}
