/**
 * A strength session's numbers (contract C10), worked out from what was logged. Pure. Shown with StatStrip
 * (src/components/training/StatStrip.tsx) on the workout record, the finish screen, history rows and the live
 * session.
 *
 *  - Elapsed time: start to finish (completed_at − started_at), measured; while a session is in progress, start
 *    to now.
 *  - Training time: the session timer with pauses left out (duration_seconds once finished; while in progress,
 *    active_duration_seconds plus the running segment). Unknown (null) when it was never recorded.
 *  - Volume: weight × reps over completed lift sets that carry a weight. Null when no set has a weight, so a
 *    body-weight workout shows "—", never "0 kg".
 *  - Sets: completed sets with reps or seconds (muscle-history.ts isCountedSet, the database's rule).
 *  - Exercises: those with at least one completed set.
 *  - Best estimated one-rep max: an estimate (Epley, one-rep-max.ts), flagged as one.
 * Nothing here is invented: no heart rate, calories or averages over nothing.
 */
import { isCountedSet } from "./muscle-history";
import { estimateOneRepMax } from "./one-rep-max";
import { isLiftSet, isTimedPrescription } from "./sets";

export type StatsSet = { reps: number | null; weight_kg?: number | string | null; duration_seconds?: number | null; completed_at: string | null };
export type StatsExercise = { name?: string | null; target_duration_seconds?: number | null; sets: readonly StatsSet[] };
export type StatsSession = {
  status?: string | null;
  started_at: string;
  completed_at?: string | null;
  /** The finished session's training time, pauses excluded. */
  duration_seconds?: number | null;
  /** In progress: training time banked before the current segment. */
  active_duration_seconds?: number | null;
  /** In progress: when the current segment started (null while paused). */
  resumed_at?: string | null;
  /** In progress: set while paused. */
  paused_at?: string | null;
};

export type SessionStats = {
  /** Start to finish, seconds; null when the end is unknown. */
  elapsedSeconds: number | null;
  /** Training time with pauses excluded, seconds; null when it was not recorded. */
  activeSeconds: number | null;
  /** kg over completed lift sets with a weight; null when none has one. */
  volumeKg: number | null;
  completedSets: number;
  /** Completed sets that are lifts (reps, not a timed movement). */
  liftSets: number;
  /** Completed lift sets with a weight above 0. */
  weightedSets: number;
  /** Completed sets with seconds logged. */
  timedSets: number;
  /** Seconds logged across completed timed sets. */
  timedSeconds: number;
  /** Exercises with at least one completed set. */
  exercisesDone: number;
  /** Every exercise in the session, done or not. */
  exercisesPlanned: number;
  /** The best estimated one-rep max among weighted lift sets (an estimate); null when there is none. */
  bestOneRepMax: { kg: number; weightKg: number; reps: number; exerciseName: string | null } | null;
};

const timeOf = (value: string | null | undefined) => {
  const time = typeof value === "string" && value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? time : null;
};
const positive = (value: unknown) => {
  const number = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(number) && number > 0 ? number : null;
};

/**
 * The numbers of one session. `now` is used for a session still in progress (its elapsed and running training
 * time); without it those stay unknown.
 */
export function sessionStats(session: StatsSession, exercises: readonly StatsExercise[], options: { now?: Date } = {}): SessionStats {
  const started = timeOf(session.started_at);
  const finished = timeOf(session.completed_at);
  const now = options.now ? options.now.getTime() : null;
  const live = session.status === "in_progress";

  let elapsedSeconds: number | null = null;
  if (started !== null && finished !== null && finished >= started) elapsedSeconds = Math.round((finished - started) / 1000);
  else if (started !== null && live && now !== null && now >= started) elapsedSeconds = Math.round((now - started) / 1000);

  let activeSeconds: number | null = null;
  if (live) {
    if (now !== null) {
      const banked = positive(session.active_duration_seconds) ?? 0;
      const segmentStart = session.paused_at ? null : timeOf(session.resumed_at) ?? started;
      activeSeconds = Math.round(banked + (segmentStart !== null && now > segmentStart ? (now - segmentStart) / 1000 : 0));
    }
  } else {
    activeSeconds = positive(session.duration_seconds) === null ? null : Math.round(Number(session.duration_seconds));
  }

  let completedSets = 0;
  let liftSets = 0;
  let weightedSets = 0;
  let timedSets = 0;
  let timedSeconds = 0;
  let exercisesDone = 0;
  let volume = 0;
  let bestOneRepMax: SessionStats["bestOneRepMax"] = null;
  for (const exercise of exercises) {
    const timed = isTimedPrescription({ target_duration_seconds: exercise.target_duration_seconds ?? null });
    const counted = exercise.sets.filter((set) => isCountedSet(set));
    if (counted.length) exercisesDone += 1;
    completedSets += counted.length;
    for (const set of counted) {
      const seconds = positive(set.duration_seconds);
      if (seconds !== null) { timedSets += 1; timedSeconds += seconds; }
      if (!isLiftSet({ reps: set.reps, duration_seconds: set.duration_seconds ?? null }, timed)) continue;
      liftSets += 1;
      const weight = positive(set.weight_kg);
      if (weight === null) continue;
      const reps = Number(set.reps);
      weightedSets += 1;
      volume += weight * reps;
      const kg = estimateOneRepMax(weight, reps);
      if (!bestOneRepMax || kg > bestOneRepMax.kg) bestOneRepMax = { kg, weightKg: weight, reps, exerciseName: exercise.name ?? null };
    }
  }

  return {
    elapsedSeconds,
    activeSeconds,
    volumeKg: weightedSets ? Math.round(volume * 100) / 100 : null,
    completedSets,
    liftSets,
    weightedSets,
    timedSets,
    timedSeconds: Math.round(timedSeconds),
    exercisesDone,
    exercisesPlanned: exercises.length,
    bestOneRepMax,
  };
}

/** 45 → "0:45", 2730 → "45:30", 3930 → "1:05:30". */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

export const SESSION_STAT_KEYS = ["elapsed", "active", "volume", "sets", "exercises", "timed", "one_rep_max"] as const;
export type SessionStatKey = (typeof SESSION_STAT_KEYS)[number];

/** The shape StatStrip takes: a null value shows "—", never 0. */
export type SessionStatItem = { key: SessionStatKey; label: string; value: string | null; unit?: string; estimate?: boolean; note?: string };

/**
 * Stats ready for StatStrip, in the order asked for (default: elapsed time, training time, volume, sets).
 * Unknown values stay null; the one-rep max is flagged as an estimate.
 */
export function sessionStatItems(stats: SessionStats, keys: readonly SessionStatKey[] = ["elapsed", "active", "volume", "sets"], options: { locale?: string } = {}): SessionStatItem[] {
  const number = (value: number, digits = 0) => value.toLocaleString(options.locale, { maximumFractionDigits: digits });
  const item = (key: SessionStatKey): SessionStatItem => {
    switch (key) {
      case "elapsed":
        return { key, label: "Elapsed time", value: stats.elapsedSeconds === null ? null : formatClock(stats.elapsedSeconds), note: "Start to finish" };
      case "active":
        return { key, label: "Training time", value: stats.activeSeconds === null ? null : formatClock(stats.activeSeconds), note: "Pauses excluded" };
      case "volume":
        return { key, label: "Total volume", value: stats.volumeKg === null ? null : number(stats.volumeKg), unit: stats.volumeKg === null ? undefined : "kg", note: stats.volumeKg === null ? "No weighted sets" : "Weight × reps of lifted sets" };
      case "sets":
        return { key, label: "Sets", value: number(stats.completedSets), note: "Completed" };
      case "exercises":
        return { key, label: "Exercises", value: number(stats.exercisesDone), note: stats.exercisesPlanned > stats.exercisesDone ? `of ${number(stats.exercisesPlanned)} planned` : undefined };
      case "timed":
        return { key, label: "Timed work", value: stats.timedSets ? formatClock(stats.timedSeconds) : null, note: stats.timedSets ? `${number(stats.timedSets)} timed ${stats.timedSets === 1 ? "set" : "sets"}` : "No timed sets" };
      case "one_rep_max":
        return { key, label: "Best estimated 1RM", value: stats.bestOneRepMax ? number(stats.bestOneRepMax.kg, 1) : null, unit: stats.bestOneRepMax ? "kg" : undefined, estimate: Boolean(stats.bestOneRepMax), note: stats.bestOneRepMax?.exerciseName ?? undefined };
    }
  };
  return keys.map(item);
}
