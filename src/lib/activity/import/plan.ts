import type { DbResult } from "../repository";
import type { ActivitySource, ImportFormat, Sport } from "../types";

/*
 * Before anything is saved, each file is checked against the account and the other files chosen
 * with it: the same session twice (same device id) is imported once (the file with the most of it),
 * a session already in FITX is not imported again unless this file holds more of it than the saved
 * import (that one was cut short), when it is offered as a replacement, and one that overlaps
 * another activity in time (a walk recorded with FITX while the watch recorded it too) is held back
 * until the person says to import it anyway.
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
  /**
   * True when an earlier import saved the activity but not all of its GPS points (the upload
   * stopped part way, or the daily limit was reached): importing the file again sends them.
   */
  missingPoints?: boolean;
  /** What the saved row holds (from the account; absent for a copy on this device). */
  pointCount?: number;
  chunkCount?: number;
  sourceFormat?: ImportFormat | null;
  /** Its distance and moving time, to compare with a fuller file (from the account). */
  distanceM?: number;
  movingSeconds?: number;
};

export type Candidate = { key: string; clientId: string; startedAt: number; endedAt: number };

export type ImportCheck =
  | { kind: "ready" }
  /** Another file chosen with it is the same session. */
  | { kind: "same-file"; otherKey: string }
  /** The account already has this session. */
  | { kind: "already"; activity: KnownActivity }
  /** The account has this session from an earlier import, without all its GPS points. */
  | { kind: "incomplete"; activity: KnownActivity }
  /** The account has this session from an earlier import that holds less of it: this file can replace it. */
  | { kind: "fuller"; activity: KnownActivity }
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
  if (saved) return saved.missingPoints && !saved.local && saved.id ? { kind: "incomplete", activity: saved } : { kind: "already", activity: saved };
  const clash = existing.find((activity) => overlaps(activity, candidate));
  if (clash) return { kind: "overlap", activity: clash, otherKey: null };
  const sibling = earlier.find((other) => overlaps(other, candidate));
  if (sibling) return { kind: "overlap", activity: null, otherKey: sibling.key };
  return { kind: "ready" };
}

/** What a file builds to, for comparing with the saved row before filling in its points or replacing it. */
export type RecordShape = { startedAt: number; endedAt: number; pointCount: number; chunkCount: number; sourceFormat: ImportFormat | null; distanceM?: number; movingSeconds?: number };

/**
 * Whether a file can fill in the missing points of an earlier, incomplete import: only when it
 * builds to the same activity as the saved row (same format, start, end, point and chunk counts).
 * Another export of the session (its GPX after a FIT) shares the device id but not its points,
 * and sending those would mix two files' points under one summary, so it is left as it is.
 * Anything not known on either side is not a match.
 */
export function refillsSaved(activity: KnownActivity, shape: RecordShape | null): boolean {
  if (!shape || activity.pointCount === undefined || activity.chunkCount === undefined || !activity.sourceFormat) return false;
  return activity.sourceFormat === shape.sourceFormat
    && activity.pointCount === shape.pointCount
    && activity.chunkCount === shape.chunkCount
    && Math.abs(activity.startedAt - shape.startedAt) < 1000
    && Math.abs(activity.endedAt - shape.endedAt) < 1000;
}

/** Two exports of one session that end within this of each other are the same length (clock and rounding). */
export const SAME_END_MS = 5_000;

/** Whether `a` holds more of a session than `b`: it ends later, or ends together and has more points. */
export function holdsMore(a: { endedAt: number; pointCount: number }, b: { endedAt: number; pointCount: number }): boolean {
  if (Math.abs(a.endedAt - b.endedAt) > SAME_END_MS) return a.endedAt > b.endedAt;
  return a.pointCount > b.pointCount;
}

/**
 * Whether a file is a fuller export of a saved import of its session (same device id): the saved one was
 * cut short (the watch was still syncing, or the export stopped part way), and this file ends later with
 * more points. Only a saved import can be replaced, never a FITX recording or a copy on this device.
 */
export function isFullerExport(saved: KnownActivity, shape: RecordShape | null): boolean {
  if (!shape || !saved.id || saved.local || saved.source !== "file" || saved.pointCount === undefined) return false;
  return shape.endedAt > saved.endedAt + SAME_END_MS && shape.pointCount > saved.pointCount;
}

/**
 * Settles a file whose session is already in FITX: an incomplete import is filled in only by the file that
 * made it (refillsSaved); a fuller export of a saved import is offered as its replacement instead of being
 * called a repeat; anything else is already in FITX.
 */
export function settleRepeat(check: ImportCheck, shape: RecordShape | null): ImportCheck {
  const settled: ImportCheck = check.kind === "incomplete" && !refillsSaved(check.activity, shape) ? { kind: "already", activity: check.activity } : check;
  if (settled.kind === "already" && isFullerExport(settled.activity, shape)) return { kind: "fuller", activity: settled.activity };
  return settled;
}

/**
 * Among files chosen together that are the same session (same device id), the one to import: the one that
 * holds the most of it (the first of equals). The others are "the same activity as" that one.
 */
export function fullestOfEachSession(files: ReadonlyArray<{ key: string; clientId: string; endedAt: number; pointCount: number }>): Set<string> {
  const best = new Map<string, { key: string; endedAt: number; pointCount: number }>();
  for (const file of files) {
    const current = best.get(file.clientId);
    if (!current || holdsMore(file, current)) best.set(file.clientId, file);
  }
  return new Set([...best.values()].map((file) => file.key));
}

/** The key one known activity is held under: saved and device copies of a session are kept apart. */
export const knownKey = (activity: KnownActivity) => `${activity.local ? "local" : "saved"}:${activity.clientId}`;

/**
 * Adds a lookup's activities to what is already known. A later lookup that found an activity only
 * by time did not count its points, so it keeps the earlier count instead of erasing it.
 */
export function mergeKnown(previous: readonly KnownActivity[], found: readonly KnownActivity[]): KnownActivity[] {
  const merged = new Map(previous.map((activity) => [knownKey(activity), activity]));
  for (const activity of found) {
    const key = knownKey(activity);
    const before = merged.get(key);
    const missingPoints = activity.missingPoints ?? before?.missingPoints;
    merged.set(key, missingPoints === undefined ? activity : { ...activity, missingPoints });
  }
  return [...merged.values()];
}

/** What happened to one file. */
export type ImportResult =
  | { kind: "imported"; id: string }
  /** A saved import that held less of the session was replaced by this file. */
  | { kind: "replaced"; id: string }
  | { kind: "already"; id: string | null }
  /** A fuller file whose replacement the person didn't ask for: the saved copy is kept. */
  | { kind: "kept"; id: string | null }
  | { kind: "skipped"; reason: "overlap" | "same-file" }
  | { kind: "unsupported"; label: string }
  | { kind: "failed"; reason: string };

/** "3 imported, 1 replaced, 1 already in FITX, 1 skipped, 1 not a sport FITX records, 1 not imported." */
/** A file in the import list, as the Import bar sees it: where it is, whether it has its result, its sport if known. */
export type BarFile = { phase: "reading" | "ready" | "unsupported" | "failed" | "importing" | "done"; done: boolean; sport: Sport | null };

/**
 * Whether the Import bar shows: while a file is waiting on it (one it can import, or one it will say it can't), and the
 * whole time it imports, so its button ("Importing…", aria-disabled) keeps keyboard focus until every file has its
 * result (D5). It used to go as the last file started importing, and focus fell to the page; once it goes after an
 * import, the result takes focus.
 */
export function importBarShown(files: readonly BarFile[], importing: boolean): boolean {
  return importing || files.some((file) => !file.done && (file.phase === "failed" || file.phase === "unsupported" || (file.phase === "ready" && file.sport !== null)));
}

export function summariseResults(results: readonly ImportResult[]): string {
  const count = (kind: ImportResult["kind"]) => results.filter((result) => result.kind === kind).length;
  const parts: string[] = [];
  const imported = count("imported");
  const replaced = count("replaced");
  const already = count("already") + count("kept");
  const skipped = count("skipped");
  const unsupported = count("unsupported");
  const failed = count("failed");
  if (imported) parts.push(`${imported} imported`);
  if (replaced) parts.push(`${replaced} replaced`);
  if (already) parts.push(`${already} already in FITX`);
  if (skipped) parts.push(`${skipped} skipped`);
  if (unsupported) parts.push(`${unsupported} not a sport FITX records`);
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

/**
 * Whether a saved activity found for a file should have its GPS points counted: an import that
 * should have points (chunkCount > 0) and that ended recently enough for them to be kept. Older
 * ones lose their points to the retention rule, so a short count there is expected, not a fault.
 */
export function shouldCountPoints(activity: { id: string | null; source: ActivitySource; local: boolean; chunkCount: number; endedAt: number }, now: number, keptDays: number): boolean {
  return activity.id !== null && !activity.local && activity.source === "file" && activity.chunkCount > 0 && activity.endedAt >= now - keptDays * 86_400_000;
}

/**
 * Why a file's save failed, in words for the person, and whether the files after it should stop
 * (they would fail the same way). The daily caps raise "... limit reached" (migration 20261118160000), and the
 * member's write budget "write limit reached ..." an hour or a day (20261121100040).
 */
export function saveFailure(result: Exclude<DbResult<unknown>, { status: "ok" }>): { reason: string; stop: boolean } {
  if (result.status === "unavailable") return { reason: "Imports aren’t switched on yet.", stop: true };
  if (result.status === "rejected") return { reason: "FITX can’t keep this activity: it’s outside what an activity can hold.", stop: false };
  if (result.offline) return { reason: "You’re offline. Try again when you’re connected.", stop: true };
  // The per-member write budget (migration 20261121100040): an hourly cap and a daily one.
  if (/write limit reached[^\n]*\ban hour\b/i.test(result.message)) return { reason: "You’ve saved a lot to FITX in the last hour. Import the rest in an hour: files already imported are recognised.", stop: true };
  if (/write limit reached/i.test(result.message)) return { reason: "You’ve saved a lot to FITX today. Import the rest tomorrow: files already imported are recognised.", stop: true };
  if (/gps data limit reached/i.test(result.message)) return { reason: "FITX has saved as many GPS points as it can today. Import the rest tomorrow: files already imported are recognised.", stop: true };
  if (/limit reached/i.test(result.message)) return { reason: "FITX adds at most 50 activities a day. Import the rest tomorrow: files already imported are recognised.", stop: true };
  return { reason: "It couldn’t be saved just now. Try again.", stop: false };
}
