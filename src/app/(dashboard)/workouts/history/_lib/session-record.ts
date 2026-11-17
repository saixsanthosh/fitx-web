/**
 * Workout history and one session's record (/workouts/history and /workouts/history/[id]).
 *
 * Everything shown comes from what the member logged:
 *  - statistics: session-stats.ts (contract C10), worked out from the saved sets;
 *  - muscles: muscle-history.ts summariseMuscles (contract C3), the one counting rule. Only completed sessions
 *    count, so an abandoned session lists its sets but trains no muscle and claims no record;
 *  - records: personal_records rows that still point at the session (a later best moves a record on, so a
 *    record page can only show what the session still holds, and says so).
 * Loaders take the browser's Supabase client (owner RLS) and read databases without the newer workout columns
 * (targets, timed sets, rep source) by leaving those columns out.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { PRESCRIPTION_TARGET_COLUMNS, SET_DURATION_COLUMNS, SET_REP_SOURCE_COLUMNS } from "@/app/(dashboard)/workouts/_lib/workout-columns";
import { isMissingColumnError } from "@/lib/domain/schema-fallback";
import type { RegionKey } from "@/lib/training/anatomy";
import { survivingExerciseId } from "@/lib/training/exercise-merges";
import { isCountedSet, loadLibraryMuscles, regionsTrained, summariseMuscles, type LibraryMuscles, type LoggedSession, type MuscleSummary } from "@/lib/training/muscle-history";
import type { NewPlanInput, PlanExerciseInput } from "@/lib/training/plans";
import { sessionStatItems, sessionStats, type SessionStatKey, type SessionStats } from "@/lib/training/session-stats";

type Db = Pick<SupabaseClient, "from">;
type Answer = { data: unknown; error: unknown };

/** The sessions the history lists: finished and abandoned. In-progress sessions are resumed, not listed. */
export const HISTORY_STATUSES = ["completed", "abandoned"] as const;
export type HistoryStatus = (typeof HISTORY_STATUSES)[number];
export const HISTORY_PAGE_SIZE = 20;
/** The longest session note kept (the column has no limit of its own). */
export const NOTE_MAX_LENGTH = 500;

/** "Abandoned · not counted" for an abandoned session; null for a completed one. */
export function statusBadge(status: string): string | null {
  return status === "abandoned" ? "Abandoned · not counted" : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isSessionId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** The record page of a session. */
export function recordHref(sessionId: string): string {
  return `/workouts/history/${encodeURIComponent(sessionId)}`;
}

// ---------------------------------------------------------------- shapes

export type RecordSet = {
  id: string;
  set_number: number;
  target_reps: number | null;
  reps: number | null;
  /** 0 for body weight. */
  weight_kg: number;
  duration_seconds: number | null;
  completed_at: string | null;
  /** "camera" when the form coach counted it; null when typed or logged before the label existed. */
  rep_source: "manual" | "camera" | null;
};

export type RecordExercise = {
  id: string;
  exercise_id: string | null;
  name: string;
  sort_order: number;
  target_sets: number;
  reps_min: number;
  reps_max: number;
  rest_seconds: number;
  target_weight_kg: number | null;
  target_duration_seconds: number | null;
  /** Every set of the exercise, in set order (ticked or not). */
  sets: RecordSet[];
  /** Its catalogue row as listed now (a merged duplicate reads as its survivor); null when not in the library. */
  library: LibraryMuscles | null;
  /** For the thumbnail: the catalogue's Free Exercise DB reference and equipment, when known. */
  sourceRef: string | null;
  equipment: string[] | null;
};

export type RecordSession = {
  id: string;
  name: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
  notes: string | null;
  plan_id: string | null;
};

export type HeldRecord = { exercise_name: string; best_weight_kg: number; best_reps: number; estimated_one_rep_max: number; achieved_at: string | null };

export type SessionRecord = {
  session: RecordSession;
  exercises: RecordExercise[];
  /** Personal records this session still holds; null when they could not be read. */
  records: HeldRecord[] | null;
  /** False when the database has no target columns yet (targets were left out). */
  targetsIncluded: boolean;
};

export type RecordResult =
  | { status: "found"; record: SessionRecord }
  | { status: "missing" }
  | { status: "error"; error: unknown };

// ---------------------------------------------------------------- pure builders

const numberOrNull = (value: unknown) => (value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value));

/** The session as muscle-history.ts reads it, for the one counting rule. */
export function toLoggedSession(record: Pick<SessionRecord, "session" | "exercises">): LoggedSession {
  return {
    id: record.session.id,
    name: record.session.name,
    status: record.session.status,
    started_at: record.session.started_at,
    completed_at: record.session.completed_at,
    exercises: record.exercises.map((exercise) => ({
      id: exercise.id,
      exercise_id: exercise.exercise_id,
      name: exercise.name,
      target_duration_seconds: exercise.target_duration_seconds,
      library: exercise.library,
      sets: exercise.sets.map((set) => ({ reps: set.reps, weight_kg: set.weight_kg, duration_seconds: set.duration_seconds, completed_at: set.completed_at, set_number: set.set_number })),
    })),
  };
}

/** The muscles the session trained (C3). Empty for a session that is not completed: it does not count. */
export function recordMuscles(record: Pick<SessionRecord, "session" | "exercises">): MuscleSummary {
  return summariseMuscles([toLoggedSession(record)]);
}

/** The session's numbers (C10), from its saved sets. */
export function recordStats(record: Pick<SessionRecord, "session" | "exercises">, options: { now?: Date } = {}): SessionStats {
  return sessionStats(
    { status: record.session.status, started_at: record.session.started_at, completed_at: record.session.completed_at, duration_seconds: record.session.duration_seconds },
    record.exercises.map((exercise) => ({ name: exercise.name, target_duration_seconds: exercise.target_duration_seconds, sets: exercise.sets })),
    options,
  );
}

/** StatStrip's shape (src/components/training/StatStrip.tsx). Null values show "—", never 0. */
export type StripStat = { label: string; value: string | null; unit?: string; estimate?: boolean; note?: string };

/** The stats for StatStrip, in the order asked for (default: training time, volume, sets, exercises). */
export function stripStats(stats: SessionStats, keys: readonly SessionStatKey[] = ["active", "volume", "sets", "exercises"], options: { locale?: string } = {}): StripStat[] {
  return sessionStatItems(stats, keys, options).map((item) => ({ label: item.label, value: item.value, unit: item.unit, estimate: item.estimate, note: item.note }));
}

/** Completed sets of one exercise (ticked, with reps or seconds: the database's rule). */
export function countedSets(exercise: Pick<RecordExercise, "sets">): RecordSet[] {
  return exercise.sets.filter((set) => isCountedSet(set));
}

/** "Records this session still holds", one line each: "Bench Press · 80 kg × 6". */
export function recordLine(record: HeldRecord): string {
  const weight = Math.round(Number(record.best_weight_kg) * 100) / 100;
  return weight > 0 ? `${record.exercise_name} · ${weight} kg × ${record.best_reps}` : `${record.exercise_name} · ${record.best_reps} reps`;
}

/**
 * A plan made from the session, for "Repeat this workout": its exercises in order with their targets, each read
 * as the library lists it now. Exercises no longer in the library (or never linked) are left out and counted; at
 * most 20 are kept (a plan's limit).
 */
export function repeatPlanFrom(record: Pick<SessionRecord, "session" | "exercises">, options: { split?: string | null; location?: string | null } = {}): { plan: NewPlanInput; exercises: PlanExerciseInput[]; leftOut: number } {
  const kept = record.exercises.filter((exercise) => exercise.library !== null).slice(0, 20);
  const exercises: PlanExerciseInput[] = kept.map((exercise) => {
    const repsMin = Math.min(100, Math.max(1, Math.round(exercise.reps_min || 1)));
    return {
      exercise_id: exercise.library!.id,
      exercise_name: exercise.library!.name || exercise.name,
      target_sets: Math.min(10, Math.max(1, Math.round(exercise.target_sets || 1))),
      reps_min: repsMin,
      reps_max: Math.min(100, Math.max(repsMin, Math.round(exercise.reps_max || repsMin))),
      rest_seconds: Math.min(600, Math.max(15, Math.round(exercise.rest_seconds || 90))),
      target_weight_kg: exercise.target_weight_kg !== null && exercise.target_weight_kg >= 0 ? exercise.target_weight_kg : null,
      target_duration_seconds: exercise.target_duration_seconds !== null && exercise.target_duration_seconds > 0 ? exercise.target_duration_seconds : null,
    };
  });
  const location = options.location === "home" || options.location === "outdoor" || options.location === "both" ? options.location : "gym";
  return {
    plan: { title: record.session.name.trim().slice(0, 120) || "Workout", split: options.split?.trim() || "custom", workout_location: location, planned_for: null, notes: null },
    exercises,
    leftOut: record.exercises.length - kept.length,
  };
}

// ---------------------------------------------------------------- history rows

export type HistorySessionRow = { id: string; name: string; status: string; started_at: string; completed_at: string | null; duration_seconds: number | null };
export type HistoryExerciseRow = { id: string; session_id: string; exercise_id: string | null; exercise_name: string; target_duration_seconds?: number | null };
export type HistorySetRow = { session_exercise_id: string; set_number?: number | null; reps: number | null; weight_kg: number | string | null; duration_seconds?: number | null; completed_at: string | null };

export type HistoryRow = {
  id: string;
  name: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  stats: SessionStats;
  /** Up to three regions trained directly, most sets first; empty for a session that does not count. */
  regions: RegionKey[];
};

/** History rows from plain rows: each session's stats, and the regions it trained when it counts. */
export function buildHistoryRows(
  sessions: readonly HistorySessionRow[],
  exercises: readonly HistoryExerciseRow[],
  sets: readonly HistorySetRow[],
  library: ReadonlyMap<string, LibraryMuscles>,
): HistoryRow[] {
  const setsByExercise = new Map<string, HistorySetRow[]>();
  for (const set of sets) {
    const list = setsByExercise.get(set.session_exercise_id) ?? [];
    list.push(set);
    setsByExercise.set(set.session_exercise_id, list);
  }
  const exercisesBySession = new Map<string, HistoryExerciseRow[]>();
  for (const exercise of exercises) {
    const list = exercisesBySession.get(exercise.session_id) ?? [];
    list.push(exercise);
    exercisesBySession.set(exercise.session_id, list);
  }
  return sessions.map((session) => {
    const logged: LoggedSession = {
      id: session.id, name: session.name, status: session.status, started_at: session.started_at, completed_at: session.completed_at ?? null,
      exercises: (exercisesBySession.get(session.id) ?? []).map((exercise) => ({
        id: exercise.id,
        exercise_id: exercise.exercise_id ?? null,
        name: exercise.exercise_name,
        target_duration_seconds: numberOrNull(exercise.target_duration_seconds),
        library: exercise.exercise_id ? library.get(survivingExerciseId(exercise.exercise_id)) ?? null : null,
        sets: (setsByExercise.get(exercise.id) ?? []).map((set) => ({
          reps: numberOrNull(set.reps), weight_kg: numberOrNull(set.weight_kg), duration_seconds: numberOrNull(set.duration_seconds),
          completed_at: typeof set.completed_at === "string" ? set.completed_at : null, set_number: numberOrNull(set.set_number),
        })),
      })),
    };
    const stats = sessionStats(
      { status: session.status, started_at: session.started_at, completed_at: session.completed_at, duration_seconds: numberOrNull(session.duration_seconds) },
      logged.exercises.map((exercise) => ({ name: exercise.name, target_duration_seconds: exercise.target_duration_seconds, sets: exercise.sets })),
    );
    return {
      id: session.id, name: session.name, status: session.status, started_at: session.started_at, completed_at: session.completed_at ?? null,
      stats, regions: regionsTrained(summariseMuscles([logged])).slice(0, 3),
    };
  });
}

/** Rows grouped by the local month they started in, newest first as given: [{ key: "2026-11", rows }]. */
export function groupByMonth<T extends { started_at: string }>(rows: readonly T[]): Array<{ key: string; rows: T[] }> {
  const groups: Array<{ key: string; rows: T[] }> = [];
  for (const row of rows) {
    const date = new Date(row.started_at);
    const key = Number.isNaN(date.getTime()) ? "unknown" : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.rows.push(row);
    else groups.push({ key, rows: [row] });
  }
  return groups;
}

// ---------------------------------------------------------------- loading

const ROW_PAGE = 1000;
const ID_CHUNK = 50;
const SET_CHUNK = 30;

const chunks = <T,>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));

/**
 * Runs a read with optional column groups, dropping a group (and asking again) when the database says one of its
 * columns does not exist. `run` gets one flag per group and must build a fresh request each time.
 */
export async function readWithOptional(groups: ReadonlyArray<readonly string[]>, run: (included: boolean[]) => PromiseLike<Answer>): Promise<{ answer: Answer; included: boolean[] }> {
  const included = groups.map(() => true);
  let answer = await run([...included]);
  while (answer.error) {
    const index = groups.findIndex((group, position) => included[position] && isMissingColumnError(answer.error, group));
    if (index < 0) break;
    included[index] = false;
    answer = await run([...included]);
  }
  return { answer, included };
}

/** Pages through a read until a short page; `run(from, to)` builds a fresh request each time. */
async function readAll<T>(run: (from: number, to: number) => PromiseLike<Answer>): Promise<{ rows: T[]; error: unknown | null }> {
  const rows: T[] = [];
  for (let from = 0; ; from += ROW_PAGE) {
    const { data, error } = await run(from, from + ROW_PAGE - 1);
    if (error) return { rows, error };
    const page = Array.isArray(data) ? (data as T[]) : [];
    rows.push(...page);
    if (page.length < ROW_PAGE) return { rows, error: null };
  }
}

const columns = (base: readonly string[], ...groups: Array<[readonly string[], boolean]>) =>
  [...base, ...groups.flatMap(([group, include]) => (include ? group : []))].join(",");

const SESSION_COLUMNS = "id,name,status,started_at,completed_at,duration_seconds,notes,plan_id";
const EXERCISE_COLUMNS = ["id", "exercise_id", "exercise_name", "sort_order", "target_sets", "reps_min", "reps_max", "rest_seconds"] as const;
const SET_COLUMNS = ["id", "session_exercise_id", "set_number", "target_reps", "reps", "weight_kg", "completed_at"] as const;

type ExerciseRow = { id: string; exercise_id: string | null; exercise_name: string; sort_order: number; target_sets: number; reps_min: number; reps_max: number; rest_seconds: number; target_weight_kg?: number | string | null; target_duration_seconds?: number | null };
type SetRow = { id: string; session_exercise_id: string; set_number: number; target_reps: number | null; reps: number | null; weight_kg: number | string | null; duration_seconds?: number | null; completed_at: string | null; rep_source?: string | null };
type ThumbRow = { id: string; source_ref?: string | null; required_equipment?: string[] | null };

/** Thumbnail details for exercise ids (surviving ids), when the catalogue columns exist; empty otherwise. */
async function loadThumbDetails(db: Db, ids: readonly string[]): Promise<Map<string, ThumbRow>> {
  const rows = new Map<string, ThumbRow>();
  for (const chunk of chunks(ids, ID_CHUNK)) {
    const { data, error } = await db.from("exercise_library").select("id,source_ref,required_equipment").in("id", chunk);
    if (error) return rows;
    for (const row of (Array.isArray(data) ? data : []) as ThumbRow[]) rows.set(row.id, row);
  }
  return rows;
}

/**
 * One session's record: the session, its exercises in order with every set, the library muscles, and the personal
 * records it still holds. "missing" when the member has no session with this id (owner RLS).
 */
export async function loadSessionRecord(db: Db, userId: string, sessionId: string): Promise<RecordResult> {
  if (!isSessionId(sessionId)) return { status: "missing" };
  const session = await db.from("workout_sessions").select(SESSION_COLUMNS).eq("id", sessionId).eq("user_id", userId).maybeSingle();
  if (session.error) return { status: "error", error: session.error };
  const sessionRow = session.data as (Omit<RecordSession, "duration_seconds"> & { duration_seconds?: number | string | null }) | null;
  if (!sessionRow) return { status: "missing" };

  const exerciseRead = await readWithOptional([PRESCRIPTION_TARGET_COLUMNS], ([targets]) =>
    db.from("workout_session_exercises").select(columns(EXERCISE_COLUMNS, [PRESCRIPTION_TARGET_COLUMNS, targets])).eq("user_id", userId).eq("session_id", sessionId).order("sort_order"));
  if (exerciseRead.answer.error) return { status: "error", error: exerciseRead.answer.error };
  const exerciseRows = (Array.isArray(exerciseRead.answer.data) ? exerciseRead.answer.data : []) as ExerciseRow[];

  const setRows: SetRow[] = [];
  let setGroups = [true, true];
  for (const ids of chunks(exerciseRows.map((row) => row.id), SET_CHUNK)) {
    const read = await readWithOptional([SET_DURATION_COLUMNS, SET_REP_SOURCE_COLUMNS], ([duration, source]) =>
      db.from("workout_sets").select(columns(SET_COLUMNS, [SET_DURATION_COLUMNS, duration && setGroups[0]], [SET_REP_SOURCE_COLUMNS, source && setGroups[1]]))
        .eq("user_id", userId).in("session_exercise_id", ids).order("set_number"));
    if (read.answer.error) return { status: "error", error: read.answer.error };
    setGroups = [setGroups[0] && read.included[0], setGroups[1] && read.included[1]];
    setRows.push(...((Array.isArray(read.answer.data) ? read.answer.data : []) as SetRow[]));
  }

  const ids = exerciseRows.map((row) => row.exercise_id);
  const [library, thumbs, records] = await Promise.all([
    loadLibraryMuscles(db, ids),
    loadThumbDetails(db, [...new Set(ids.filter((id): id is string => Boolean(id)).map(survivingExerciseId))]),
    db.from("personal_records").select("exercise_name,best_weight_kg,best_reps,estimated_one_rep_max,achieved_at").eq("user_id", userId).eq("session_id", sessionId),
  ]);
  if (library.error) return { status: "error", error: library.error };

  const setsByExercise = new Map<string, RecordSet[]>();
  for (const row of setRows) {
    const list = setsByExercise.get(row.session_exercise_id) ?? [];
    list.push({
      id: row.id, set_number: Number(row.set_number), target_reps: numberOrNull(row.target_reps), reps: numberOrNull(row.reps),
      weight_kg: Math.max(0, numberOrNull(row.weight_kg) ?? 0), duration_seconds: numberOrNull(row.duration_seconds),
      completed_at: typeof row.completed_at === "string" ? row.completed_at : null,
      rep_source: row.rep_source === "camera" || row.rep_source === "manual" ? row.rep_source : null,
    });
    setsByExercise.set(row.session_exercise_id, list);
  }

  return {
    status: "found",
    record: {
      session: {
        id: sessionRow.id, name: sessionRow.name, status: sessionRow.status, started_at: sessionRow.started_at, completed_at: sessionRow.completed_at ?? null,
        duration_seconds: numberOrNull(sessionRow.duration_seconds), notes: typeof sessionRow.notes === "string" && sessionRow.notes.trim() ? sessionRow.notes : null,
        plan_id: sessionRow.plan_id ?? null,
      },
      exercises: [...exerciseRows].sort((a, b) => a.sort_order - b.sort_order).map((row) => {
        const survivor = row.exercise_id ? survivingExerciseId(row.exercise_id) : null;
        const thumb = survivor ? thumbs.get(survivor) : undefined;
        return {
          id: row.id, exercise_id: row.exercise_id ?? null, name: row.exercise_name, sort_order: row.sort_order,
          target_sets: row.target_sets, reps_min: row.reps_min, reps_max: row.reps_max, rest_seconds: row.rest_seconds,
          target_weight_kg: numberOrNull(row.target_weight_kg), target_duration_seconds: numberOrNull(row.target_duration_seconds),
          sets: (setsByExercise.get(row.id) ?? []).sort((a, b) => a.set_number - b.set_number),
          library: survivor ? library.rows.get(survivor) ?? null : null,
          sourceRef: thumb?.source_ref ?? null,
          equipment: Array.isArray(thumb?.required_equipment) ? thumb.required_equipment : null,
        };
      }),
      records: records.error ? null : ((Array.isArray(records.data) ? records.data : []) as Array<Record<string, unknown>>).map((row) => ({
        exercise_name: String(row.exercise_name ?? ""), best_weight_kg: Number(row.best_weight_kg ?? 0), best_reps: Number(row.best_reps ?? 0),
        estimated_one_rep_max: Number(row.estimated_one_rep_max ?? 0), achieved_at: typeof row.achieved_at === "string" ? row.achieved_at : null,
      })),
      targetsIncluded: exerciseRead.included[0],
    },
  };
}

export type HistoryPage = {
  rows: HistoryRow[];
  /** Where the next page starts; null when there are no more sessions. */
  nextOffset: number | null;
};

/**
 * One page of the history: completed and abandoned sessions, newest first, with their stats and the muscles they
 * trained. Asks for one session more than a page so it can tell whether more exist.
 */
export async function loadHistoryPage(db: Db, userId: string, options: { offset?: number; pageSize?: number } = {}): Promise<{ error: unknown | null; page: HistoryPage }> {
  const offset = Math.max(0, Math.round(options.offset ?? 0));
  const size = Math.max(1, Math.min(50, Math.round(options.pageSize ?? HISTORY_PAGE_SIZE)));
  const head = await db.from("workout_sessions").select("id,name,status,started_at,completed_at,duration_seconds").eq("user_id", userId)
    .in("status", [...HISTORY_STATUSES]).order("started_at", { ascending: false }).order("id", { ascending: true }).range(offset, offset + size);
  if (head.error) return { error: head.error, page: { rows: [], nextOffset: null } };
  const all = (Array.isArray(head.data) ? head.data : []) as HistorySessionRow[];
  const sessions = all.slice(0, size);
  const nextOffset = all.length > size ? offset + size : null;
  if (!sessions.length) return { error: null, page: { rows: [], nextOffset: null } };

  const exercises: HistoryExerciseRow[] = [];
  let withTimed = true;
  for (const ids of chunks(sessions.map((session) => session.id), ID_CHUNK)) {
    const read = await readWithOptional([["target_duration_seconds"]], ([timed]) => readAll<HistoryExerciseRow>((from, to) =>
      db.from("workout_session_exercises").select(columns(["id", "session_id", "exercise_id", "exercise_name"], [["target_duration_seconds"], timed && withTimed]))
        .eq("user_id", userId).in("session_id", ids).order("id", { ascending: true }).range(from, to)).then((result) => ({ data: result.rows, error: result.error })));
    if (read.answer.error) return { error: read.answer.error, page: { rows: [], nextOffset: null } };
    withTimed = withTimed && read.included[0];
    exercises.push(...(read.answer.data as HistoryExerciseRow[]));
  }

  const sets: HistorySetRow[] = [];
  let withDuration = true;
  for (const ids of chunks(exercises.map((exercise) => exercise.id), SET_CHUNK)) {
    const read = await readWithOptional([SET_DURATION_COLUMNS], ([duration]) => readAll<HistorySetRow>((from, to) =>
      db.from("workout_sets").select(columns(["session_exercise_id", "set_number", "reps", "weight_kg", "completed_at"], [SET_DURATION_COLUMNS, duration && withDuration]))
        .eq("user_id", userId).in("session_exercise_id", ids).not("completed_at", "is", null).order("id", { ascending: true }).range(from, to)).then((result) => ({ data: result.rows, error: result.error })));
    if (read.answer.error) return { error: read.answer.error, page: { rows: [], nextOffset: null } };
    withDuration = withDuration && read.included[0];
    sets.push(...(read.answer.data as HistorySetRow[]));
  }

  const library = await loadLibraryMuscles(db, exercises.map((exercise) => exercise.exercise_id));
  // Muscles are a detail of the list: without the library the rows still show, without muscle chips.
  return { error: null, page: { rows: buildHistoryRows(sessions, exercises, sets, library.error ? new Map() : library.rows), nextOffset } };
}

/** The member's workout in progress, if any (to offer Resume at the top of the history). */
export async function loadInProgressSession(db: Db, userId: string): Promise<{ id: string; name: string; started_at: string } | null> {
  const { data, error } = await db.from("workout_sessions").select("id,name,started_at").eq("user_id", userId).eq("status", "in_progress").order("started_at", { ascending: false }).limit(1).maybeSingle();
  return error || !data ? null : (data as { id: string; name: string; started_at: string });
}

/** Saves the note on a completed session (trimmed, at most 500 characters; empty clears it). */
export async function saveSessionNote(db: Db, userId: string, sessionId: string, note: string): Promise<{ error: unknown | null; notes: string | null }> {
  const notes = note.trim().slice(0, NOTE_MAX_LENGTH) || null;
  const { data, error } = await db.from("workout_sessions").update({ notes }).eq("id", sessionId).eq("user_id", userId).eq("status", "completed").select("id").maybeSingle();
  if (error) return { error, notes: null };
  return data ? { error: null, notes } : { error: new Error("session not found"), notes: null };
}
