/**
 * "Last time" in the live workout: what the member logged for an exercise in their latest completed session
 * (exercise-history.ts previousPerformance, contract C8). Only counted sets of completed sessions reach here, and
 * every line is dated by the caller, so nothing is shown that was not logged.
 */
import { bestSet, formatBestSet, type ExerciseSession, type HistorySet } from "@/lib/training/exercise-history";
import { isLiftSet } from "@/lib/training/sets";
import { formatKg } from "./session-progress";

/** One logged set: "40 kg × 8", "12 reps", "45 s" or "45 s · 20 kg". */
export function formatHistorySet(set: HistorySet, timed: boolean): string {
  const seconds = Number(set.durationSeconds) > 0 ? Number(set.durationSeconds) : 0;
  if (isLiftSet({ reps: set.reps, duration_seconds: set.durationSeconds }, timed)) {
    return set.weightKg > 0 ? `${formatKg(set.weightKg)} kg × ${set.reps}` : `${set.reps} reps`;
  }
  if (seconds) return set.weightKg > 0 ? `${seconds} s · ${formatKg(set.weightKg)} kg` : `${seconds} s`;
  return `${Number(set.reps) || 0} reps`;
}

/** The same set written for a whole group: "8 @ 40 kg", "12 reps", "45 s" or "45 s @ 20 kg". */
function groupCore(set: HistorySet, timed: boolean): string {
  const seconds = Number(set.durationSeconds) > 0 ? Number(set.durationSeconds) : 0;
  if (isLiftSet({ reps: set.reps, duration_seconds: set.durationSeconds }, timed)) {
    return set.weightKg > 0 ? `${set.reps} @ ${formatKg(set.weightKg)} kg` : `${set.reps} reps`;
  }
  if (seconds) return set.weightKg > 0 ? `${seconds} s @ ${formatKg(set.weightKg)} kg` : `${seconds} s`;
  return `${Number(set.reps) || 0} reps`;
}

/**
 * The session's sets in one line: "3 × 8 @ 40 kg" when every set matched, a single set as "40 kg × 8", otherwise
 * the count and the best set ("3 sets · best 42.5 kg × 6"). Empty for a session without sets.
 */
export function summariseLastTime(session: Pick<ExerciseSession, "sets" | "timed">): string {
  const sets = session.sets;
  if (!sets.length) return "";
  if (sets.length === 1) return formatHistorySet(sets[0], session.timed);
  const cores = sets.map((set) => groupCore(set, session.timed));
  if (cores.every((core) => core === cores[0])) return `${sets.length} × ${cores[0]}`;
  const best = bestSet(sets, session.timed);
  return best ? `${sets.length} sets · best ${formatBestSet(best).replace(/s timed$/, " s")}` : `${sets.length} sets`;
}

/**
 * The set of last time that matches set `setNumber` today: the one logged with that number, else the one in that
 * position. Null when last time had fewer sets.
 */
export function lastTimeForSet(session: Pick<ExerciseSession, "sets"> | null, setNumber: number): HistorySet | null {
  if (!session || !Number.isInteger(setNumber) || setNumber < 1) return null;
  const numbered = session.sets.find((set) => set.setNumber === setNumber);
  if (numbered) return numbered;
  if (session.sets.some((set) => set.setNumber !== null)) return null;
  return session.sets[setNumber - 1] ?? null;
}
