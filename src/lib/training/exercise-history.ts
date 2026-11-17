/**
 * One exercise's logged history (contract C8): the member's completed sessions that contain it, with the sets
 * that count, plus pure helpers for the last performance, the best set and progress series. Feeds the exercise
 * page, "Last time" in the live session and the workout builder.
 *
 * Only completed sessions and counted sets (muscle-history.ts isCountedSet: ticked, with reps or seconds). A
 * movement prescribed in seconds is timed: its sets count for their time and never as lifts (sets.ts), so its
 * best set and progress are durations. Estimated one-rep maxes use one-rep-max.ts (Epley, as the database does)
 * and are estimates: say so wherever they are shown. A merged duplicate's history counts as its survivor's.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingColumnError } from "@/lib/domain/schema-fallback";
import { MERGED_EXERCISE_IDS, survivingExerciseId } from "./exercise-merges";
import { isCountedSet } from "./muscle-history";
import { estimateOneRepMax } from "./one-rep-max";
import { isLiftSet } from "./sets";

export type HistorySet = {
  setNumber: number | null;
  reps: number | null;
  /** 0 for body weight. */
  weightKg: number;
  durationSeconds: number | null;
  completedAt: string;
};

/** One completed session's work on the exercise. */
export type ExerciseSession = {
  sessionId: string;
  sessionName: string;
  startedAt: string;
  completedAt: string | null;
  /** The exercise as listed now (a merged duplicate reads as its survivor). */
  exerciseId: string;
  /** The name as logged in that session. */
  exerciseName: string;
  /** Prescribed in seconds that time (a hold, a stretch, cardio). */
  timed: boolean;
  /** Counted sets only, in the order they were done. */
  sets: HistorySet[];
};

// ---------------------------------------------------------------- pure helpers

const finite = (value: unknown) => (value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value));
const timeOf = (value: string | null | undefined) => {
  const time = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? time : null;
};

/** A set counts as a lift here: reps, no seconds, and the movement is not timed (sets.ts isLiftSet). */
function liftOf(set: HistorySet, timed: boolean): boolean {
  return isLiftSet({ reps: set.reps, duration_seconds: set.durationSeconds }, timed);
}

export type BestSet =
  | { kind: "weighted"; weightKg: number; reps: number; oneRepMaxKg: number; set: HistorySet }
  | { kind: "bodyweight"; reps: number; set: HistorySet }
  | { kind: "timed"; durationSeconds: number; set: HistorySet };

function topLift(lifts: readonly HistorySet[]): BestSet {
  const top = lifts.reduce((winner, set) => (set.weightKg > winner.weightKg || (set.weightKg === winner.weightKg && Number(set.reps) > Number(winner.reps)) ? set : winner));
  const reps = Number(top.reps);
  return top.weightKg > 0
    ? { kind: "weighted", weightKg: top.weightKg, reps, oneRepMaxKg: estimateOneRepMax(top.weightKg, reps), set: top }
    : { kind: "bodyweight", reps, set: top };
}

/**
 * The top set: the heaviest lift (more reps break a tie), or the most reps when every lift was body weight;
 * for a timed movement, or sets with only seconds, the longest time. A timed movement logged with reps only
 * (no seconds) shows those reps as logged. Null when no set counts.
 */
export function bestSet(sets: readonly HistorySet[], timed: boolean): BestSet | null {
  const counted = sets.filter((set) => isCountedSet({ reps: set.reps, duration_seconds: set.durationSeconds, completed_at: set.completedAt }));
  const lifts = counted.filter((set) => liftOf(set, timed));
  if (lifts.length) return topLift(lifts);
  const held = counted.filter((set) => Number(set.durationSeconds) > 0);
  if (held.length) {
    const top = held.reduce((winner, set) => (Number(set.durationSeconds) > Number(winner.durationSeconds) ? set : winner));
    return { kind: "timed", durationSeconds: Number(top.durationSeconds), set: top };
  }
  const repsOnly = counted.filter((set) => liftOf(set, false));
  return repsOnly.length ? topLift(repsOnly) : null;
}

/** "60 kg × 8", "12 reps" or "45s timed": the wording the exercise page uses for a top set. */
export function formatBestSet(best: BestSet): string {
  if (best.kind === "weighted") return `${best.weightKg} kg × ${best.reps}`;
  if (best.kind === "bodyweight") return `${best.reps} reps`;
  return `${best.durationSeconds}s timed`;
}

/** The newest session with counted sets, leaving out `excludeSessionId` (the one in progress) and any from `before` on. */
export function previousPerformance(sessions: readonly ExerciseSession[], options: { excludeSessionId?: string | null; before?: Date | string | null } = {}): ExerciseSession | null {
  const before = options.before == null ? null : timeOf(typeof options.before === "string" ? options.before : options.before.toISOString());
  let latest: ExerciseSession | null = null;
  for (const session of sessions) {
    if (session.sessionId === options.excludeSessionId || !session.sets.length) continue;
    const started = timeOf(session.startedAt);
    if (started === null || (before !== null && started >= before)) continue;
    if (!latest || started > (timeOf(latest.startedAt) ?? 0)) latest = session;
  }
  return latest;
}

/** Kilograms lifted (weight × reps) over the session's weighted lift sets. */
export function sessionVolumeKg(session: ExerciseSession): number {
  return session.sets.reduce((sum, set) => (liftOf(set, session.timed) && set.weightKg > 0 ? sum + set.weightKg * Number(set.reps) : sum), 0);
}

export type ProgressPoint = { sessionId: string; startedAt: string; value: number };

const oldestFirst = (sessions: readonly ExerciseSession[]) => [...sessions].sort((a, b) => (timeOf(a.startedAt) ?? 0) - (timeOf(b.startedAt) ?? 0));

/** The best estimated one-rep max of each session with a weighted lift, oldest first (an estimate). */
export function oneRepMaxSeries(sessions: readonly ExerciseSession[]): ProgressPoint[] {
  return oldestFirst(sessions).flatMap((session) => {
    const values = session.sets.filter((set) => liftOf(set, session.timed) && set.weightKg > 0).map((set) => estimateOneRepMax(set.weightKg, Number(set.reps)));
    return values.length ? [{ sessionId: session.sessionId, startedAt: session.startedAt, value: Math.max(...values) }] : [];
  });
}

/** The most reps in one set of each session whose lifts were all body weight, oldest first. */
export function repsSeries(sessions: readonly ExerciseSession[]): ProgressPoint[] {
  return oldestFirst(sessions).flatMap((session) => {
    const lifts = session.sets.filter((set) => liftOf(set, session.timed));
    if (!lifts.length || lifts.some((set) => set.weightKg > 0)) return [];
    return [{ sessionId: session.sessionId, startedAt: session.startedAt, value: Math.max(...lifts.map((set) => Number(set.reps))) }];
  });
}

/** The longest timed set of each session, in seconds, oldest first. */
export function durationSeries(sessions: readonly ExerciseSession[]): ProgressPoint[] {
  return oldestFirst(sessions).flatMap((session) => {
    const seconds = session.sets.filter((set) => !liftOf(set, session.timed) && Number(set.durationSeconds) > 0).map((set) => Number(set.durationSeconds));
    return seconds.length ? [{ sessionId: session.sessionId, startedAt: session.startedAt, value: Math.max(...seconds) }] : [];
  });
}

export type ProgressSeries = {
  metric: "one_rep_max" | "reps" | "duration";
  unit: "kg" | "reps" | "s";
  /** True for estimated one-rep maxes. */
  estimate: boolean;
  points: ProgressPoint[];
};

/**
 * The series that fits the exercise: estimated one-rep max once any weighted lift is logged, else reps for
 * body-weight lifts, else time for timed work. Null when nothing counts.
 */
export function progressSeries(sessions: readonly ExerciseSession[]): ProgressSeries | null {
  const oneRepMax = oneRepMaxSeries(sessions);
  if (oneRepMax.length) return { metric: "one_rep_max", unit: "kg", estimate: true, points: oneRepMax };
  const reps = repsSeries(sessions);
  if (reps.length) return { metric: "reps", unit: "reps", estimate: false, points: reps };
  const duration = durationSeries(sessions);
  return duration.length ? { metric: "duration", unit: "s", estimate: false, points: duration } : null;
}

// ---------------------------------------------------------------- building sessions from rows

export type SessionExerciseRow = { id: string; session_id: string; exercise_id: string | null; exercise_name: string; target_duration_seconds?: number | null; created_at?: string | null };
export type SessionRow = { id: string; name: string; status: string; started_at: string; completed_at: string | null };
export type SetRow = { session_exercise_id: string; set_number?: number | null; reps: number | null; weight_kg: number | string | null; duration_seconds?: number | null; completed_at: string | null };

/**
 * Groups rows into each requested exercise's sessions, newest first: completed sessions only, counted sets
 * only, sessions without a counted set left out, at most `limit` each. An exercise added twice to one session
 * is one entry with both sets of sets.
 */
export function buildExerciseSessions(
  exerciseIds: readonly string[],
  rows: { sessionExercises: readonly SessionExerciseRow[]; sessions: readonly SessionRow[]; sets: readonly SetRow[] },
  options: { limit?: number; excludeSessionId?: string | null } = {},
): Map<string, ExerciseSession[]> {
  const limit = Math.max(1, Math.round(options.limit ?? 12));
  const sessions = new Map(rows.sessions.filter((session) => session.status === "completed").map((session) => [session.id, session]));
  const setsByRow = new Map<string, HistorySet[]>();
  for (const row of rows.sets) {
    const set: HistorySet = {
      setNumber: finite(row.set_number), reps: finite(row.reps), weightKg: Math.max(0, finite(row.weight_kg) ?? 0),
      durationSeconds: finite(row.duration_seconds), completedAt: typeof row.completed_at === "string" ? row.completed_at : "",
    };
    if (!isCountedSet({ reps: set.reps, duration_seconds: set.durationSeconds, completed_at: set.completedAt })) continue;
    const list = setsByRow.get(row.session_exercise_id) ?? [];
    list.push(set);
    setsByRow.set(row.session_exercise_id, list);
  }
  const result = new Map<string, ExerciseSession[]>();
  for (const requested of new Set(exerciseIds.map(survivingExerciseId))) {
    const bySession = new Map<string, ExerciseSession>();
    for (const row of rows.sessionExercises) {
      if (!row.exercise_id || survivingExerciseId(row.exercise_id) !== requested || row.session_id === options.excludeSessionId) continue;
      const session = sessions.get(row.session_id);
      if (!session) continue;
      const entry = bySession.get(session.id) ?? {
        sessionId: session.id, sessionName: session.name, startedAt: session.started_at, completedAt: session.completed_at ?? null,
        exerciseId: requested, exerciseName: row.exercise_name, timed: false, sets: [],
      };
      entry.timed ||= row.target_duration_seconds != null;
      entry.sets.push(...(setsByRow.get(row.id) ?? []));
      bySession.set(session.id, entry);
    }
    const list = [...bySession.values()].filter((entry) => entry.sets.length > 0);
    for (const entry of list) entry.sets.sort((a, b) => (timeOf(a.completedAt) ?? 0) - (timeOf(b.completedAt) ?? 0) || (a.setNumber ?? 0) - (b.setNumber ?? 0));
    list.sort((a, b) => (timeOf(b.startedAt) ?? 0) - (timeOf(a.startedAt) ?? 0) || a.sessionId.localeCompare(b.sessionId));
    result.set(requested, list.slice(0, limit));
  }
  return result;
}

/** The stored ids that read as this exercise: itself and the duplicates merged into it. */
export function storedIdsOf(exerciseId: string): string[] {
  const survivor = survivingExerciseId(exerciseId);
  return [survivor, ...Object.keys(MERGED_EXERCISE_IDS).filter((id) => MERGED_EXERCISE_IDS[id] === survivor)];
}

// ---------------------------------------------------------------- loading

type Db = Pick<SupabaseClient, "from">;
type Answer = { data: unknown; error: unknown };

/** Added by 20261115110000_fitx_workout_prescription_targets.sql; read when the database has them. */
const OPTIONAL_COLUMNS = ["target_duration_seconds", "duration_seconds"];
const ID_CHUNK = 100;
const SET_CHUNK = 30;

const chunks = <T,>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));

export type ExerciseHistoryResult = {
  /** Set when a request failed; `byExercise` is then empty. */
  error: unknown | null;
  /** Requested id (as listed now) → its sessions, newest first. */
  byExercise: Map<string, ExerciseSession[]>;
};

/**
 * The member's latest completed sessions with each exercise (default 12 each), newest first, with the sets
 * that count. `excludeSessionId` leaves out the session in progress (for "Last time"). Three plain requests
 * (the session rows per exercise, then their sessions, then their sets); databases without the timed-sets
 * columns are read without them.
 */
export async function loadExerciseHistory(db: Db, userId: string, exerciseIds: string | readonly string[], options: { sessions?: number; excludeSessionId?: string | null } = {}): Promise<ExerciseHistoryResult> {
  const limit = Math.max(1, Math.round(options.sessions ?? 12));
  const requested = [...new Set((typeof exerciseIds === "string" ? [exerciseIds] : [...exerciseIds]).filter((id) => typeof id === "string" && id).map(survivingExerciseId))];
  if (!requested.length) return { error: null, byExercise: new Map() };
  let optional = true;
  const run = async (query: (withOptional: boolean) => PromiseLike<Answer>): Promise<Answer> => {
    let answer = await query(optional);
    if (answer.error && optional && isMissingColumnError(answer.error, OPTIONAL_COLUMNS)) {
      optional = false;
      answer = await query(false);
    }
    return answer;
  };

  // A few rows more than sessions wanted: some may be abandoned, in progress or without a counted set.
  const rowLimit = Math.min(200, limit * 2 + 4);
  const exerciseAnswers = await Promise.all(requested.map((id) => run((withOptional) => db.from("workout_session_exercises")
    .select(withOptional ? "id,session_id,exercise_id,exercise_name,target_duration_seconds,created_at" : "id,session_id,exercise_id,exercise_name,created_at")
    .eq("user_id", userId).in("exercise_id", storedIdsOf(id)).order("created_at", { ascending: false }).limit(rowLimit))));
  const failedRows = exerciseAnswers.find((answer) => answer.error);
  if (failedRows) return { error: failedRows.error, byExercise: new Map() };
  const sessionExercises = exerciseAnswers.flatMap((answer) => (Array.isArray(answer.data) ? answer.data : []) as SessionExerciseRow[])
    .filter((row) => row.session_id !== options.excludeSessionId);

  const sessionIds = [...new Set(sessionExercises.map((row) => row.session_id))];
  const sessions: SessionRow[] = [];
  for (const ids of chunks(sessionIds, ID_CHUNK)) {
    const answer = await db.from("workout_sessions").select("id,name,status,started_at,completed_at").eq("user_id", userId).eq("status", "completed").in("id", ids);
    if (answer.error) return { error: answer.error, byExercise: new Map() };
    sessions.push(...((Array.isArray(answer.data) ? answer.data : []) as SessionRow[]));
  }

  const completed = new Set(sessions.map((session) => session.id));
  const rowIds = sessionExercises.filter((row) => completed.has(row.session_id)).map((row) => row.id);
  const sets: SetRow[] = [];
  for (const ids of chunks(rowIds, SET_CHUNK)) {
    const answer = await run((withOptional) => db.from("workout_sets")
      .select(withOptional ? "session_exercise_id,set_number,reps,weight_kg,duration_seconds,completed_at" : "session_exercise_id,set_number,reps,weight_kg,completed_at")
      .eq("user_id", userId).in("session_exercise_id", ids).not("completed_at", "is", null).limit(1000));
    if (answer.error) return { error: answer.error, byExercise: new Map() };
    sets.push(...((Array.isArray(answer.data) ? answer.data : []) as SetRow[]));
  }

  return { error: null, byExercise: buildExerciseSessions(requested, { sessionExercises, sessions, sets }, { limit, excludeSessionId: options.excludeSessionId }) };
}
