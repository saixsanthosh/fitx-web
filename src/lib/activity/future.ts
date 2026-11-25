/*
 * Activities dated after now. A watch or phone whose clock was set wrong exports a session that "starts"
 * tomorrow, or next year. FITX refuses such a file at import (import/to-record.ts), and an activity already
 * saved with a start after now (imported before that check) counts in no weekly, monthly or yearly total
 * until its time comes, so Activity, Progress, Home and goals give the same totals for the same days. It
 * stays in the history, marked, so it can be opened and deleted.
 */

/** How far ahead of this device's clock a start may be and still count as now: clocks differ by a few minutes. */
export const CLOCK_SKEW_MS = 5 * 60_000;

/** True when an activity starts after now, beyond the clock allowance. */
export function startsInFuture(startedAt: number, now: number): boolean {
  return Number.isFinite(startedAt) && Number.isFinite(now) && startedAt > now + CLOCK_SKEW_MS;
}

/** The activities that have started by `now`: the ones a period total counts. */
export function startedBy<T extends { startedAt: number }>(rows: readonly T[], now: number): T[] {
  return rows.filter((row) => !startsInFuture(row.startedAt, now));
}
