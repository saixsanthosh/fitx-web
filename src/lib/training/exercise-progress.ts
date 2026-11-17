/**
 * What the exercise page's History and Progress tabs show, from the member's logged sessions (exercise-history.ts,
 * contract C8: completed sessions and counted sets only). Pure.
 *
 * Every figure comes from logged sets. Estimated one-rep maxes (Epley, as the database computes them) are
 * estimates and the page labels them so. Volume is weight × reps over lifts with a weight; body-weight and timed
 * sets have no kilograms and are never counted as 0 kg.
 */
import { bestSet, sessionVolumeKg, type BestSet, type ExerciseSession, type HistorySet, type ProgressPoint } from "./exercise-history";
import { isLiftSet } from "./sets";

/** Sessions shown per page of History. */
export const HISTORY_PAGE_SIZE = 10;
/** How many sessions are read: the first load, then one larger load ("Show older" past the first). */
export const HISTORY_LOADS = [40, 100] as const;
/** Bars in the volume chart: the latest sessions with a weighted lift. */
export const VOLUME_BARS = 8;

/** 45 -> "45 s", 60 -> "1 min", 90 -> "1 min 30 s". */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  if (whole < 60) return `${whole} s`;
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

/** Kilograms with at most one decimal and digit grouping: 62.5 -> "62.5 kg", 1440 -> "1,440 kg". */
export function formatKg(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded.toLocaleString("en-GB", { maximumFractionDigits: 1 })} kg`;
}

/** A set counts for its time: seconds logged, and the movement is timed or the set has no lift. */
function countsForTime(set: HistorySet, timed: boolean): boolean {
  return Number(set.durationSeconds) > 0 && !isLiftSet({ reps: set.reps, duration_seconds: set.durationSeconds }, timed);
}

/** One logged set, as the History tab lists it: "60 kg × 8", "12 reps" or "45 s". */
export function setResult(set: HistorySet, timed: boolean): string {
  if (countsForTime(set, timed)) return formatDuration(Number(set.durationSeconds));
  const reps = Number(set.reps);
  if (set.weightKg > 0) return `${formatKg(set.weightKg)} × ${reps}`;
  return `${reps} ${reps === 1 ? "rep" : "reps"}`;
}

/** The session's top set (exercise-history.ts bestSet), or null. */
export function topSetOf(session: ExerciseSession): HistorySet | null {
  return bestSet(session.sets, session.timed)?.set ?? null;
}

/** "62.5 kg × 8", "15 reps" or "1 min 5 s": a best set in the page's wording. */
export function bestSetText(best: BestSet): string {
  if (best.kind === "weighted") return `${formatKg(best.weightKg)} × ${best.reps}`;
  if (best.kind === "bodyweight") return `${best.reps} ${best.reps === 1 ? "rep" : "reps"}`;
  return formatDuration(best.durationSeconds);
}

const KIND_RANK: Record<BestSet["kind"], number> = { weighted: 3, bodyweight: 2, timed: 1 };

/** True when `a` beats `b`: a weighted lift beats body weight beats time; then weight and reps, reps, or seconds. */
function beats(a: BestSet, b: BestSet): boolean {
  if (a.kind !== b.kind) return KIND_RANK[a.kind] > KIND_RANK[b.kind];
  if (a.kind === "weighted" && b.kind === "weighted") return a.weightKg > b.weightKg || (a.weightKg === b.weightKg && a.reps > b.reps);
  if (a.kind === "bodyweight" && b.kind === "bodyweight") return a.reps > b.reps;
  if (a.kind === "timed" && b.kind === "timed") return a.durationSeconds > b.durationSeconds;
  return false;
}

const timeOf = (value: string) => {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
};

/** The best set over the sessions given, with the session it was set in (the first one, on a tie). */
export function overallBest(sessions: readonly ExerciseSession[]): { best: BestSet; session: ExerciseSession } | null {
  let winner: { best: BestSet; session: ExerciseSession } | null = null;
  const oldestFirst = [...sessions].sort((a, b) => timeOf(a.startedAt) - timeOf(b.startedAt));
  for (const session of oldestFirst) {
    const best = bestSet(session.sets, session.timed);
    if (best && (!winner || beats(best, winner.best))) winner = { best, session };
  }
  return winner;
}

/** Kilograms lifted in each session with a weighted lift, oldest first; sessions without one are left out. */
export function volumeSeries(sessions: readonly ExerciseSession[]): ProgressPoint[] {
  return [...sessions]
    .sort((a, b) => timeOf(a.startedAt) - timeOf(b.startedAt))
    .flatMap((session) => {
      const value = sessionVolumeKg(session);
      return value > 0 ? [{ sessionId: session.sessionId, startedAt: session.startedAt, value: Math.round(value * 10) / 10 }] : [];
    });
}

/** The latest `count` points of a series (oldest first). */
export function latestPoints(points: readonly ProgressPoint[], count: number): ProgressPoint[] {
  return points.slice(Math.max(0, points.length - Math.max(0, count)));
}

/**
 * What the figures are based on: every completed session with this exercise, or (when the read stopped at its
 * limit) the latest ones. `capped` says older sessions may exist.
 */
export function historyBasis(count: number, limit: number): { capped: boolean; text: string } {
  const capped = count >= limit;
  if (capped) return { capped, text: `Based on your latest ${count} completed sessions with this exercise.` };
  return { capped, text: `Based on ${count === 1 ? "your 1 completed session" : `all ${count} of your completed sessions`} with this exercise.` };
}

/** The next, larger read after `limit` sessions, or null when the largest read has been made. */
export function nextHistoryLoad(limit: number): number | null {
  return HISTORY_LOADS.find((size) => size > limit) ?? null;
}

/**
 * History pages to show after "Show older sessions" starts a larger read. The first click moves on one page (shown
 * once the read arrives); trying a failed read again keeps the page that click already asked for.
 */
export function pagesAfterLoadMore(pages: number, retrying: boolean): number {
  return retrying ? pages : pages + 1;
}
