/**
 * Saves today's Home workout sets to workout history as one completed session, with the member's
 * own rights (owner RLS on the workout tables): the session, one row per exercise and one row per
 * set, each set labelled as counted by the camera. Only counts leave the device.
 *
 * If any step fails, the session written so far is deleted (its exercises and sets go with it), so
 * history never shows half a workout. A session whose clean-up could not run (the connection
 * dropped, the tab reloaded) is remembered beside the unsaved sets in this tab and deleted before
 * the next attempt writes anything, so a retry never leaves an empty session plus the real one.
 * Databases without the newer optional columns (target_duration_seconds, duration_seconds,
 * rep_source) still take rep sets.
 *
 * Known gap until the three inserts become one database transaction (an RPC the coordinator would
 * apply): if the tab is closed for good mid-save, that tab's leftover session can't be cleaned up.
 */
import { missingColumnFromError } from "@/lib/domain/schema-fallback";
import type { LoggedSet } from "./log";

/** The name history shows for these sessions. */
export const HOME_WORKOUT_SESSION_NAME = "Home workout";
/** A workout row holds at most this many sets of one exercise (the table's limit). */
const MAX_SETS_PER_ROW = 10;
const MAX_ROWS = 100;

export interface RecordSet {
  set_number: number;
  target_reps: null;
  reps: number | null;
  duration_seconds: number | null;
  weight_kg: 0;
  completed_at: string;
  rep_source: "camera";
}

export interface RecordExercise {
  exercise_id: string | null;
  exercise_name: string;
  sort_order: number;
  target_sets: number;
  reps_min: number;
  reps_max: number;
  target_duration_seconds: number | null;
  sets: RecordSet[];
}

export interface WorkoutRecord {
  session: {
    name: string;
    status: "completed";
    started_at: string;
    completed_at: string;
    duration_seconds: number;
    total_volume: 0;
    notes: string;
  };
  exercises: RecordExercise[];
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, Math.round(value)));

/** The history record for today's sets, or null when there is nothing to save. */
export function buildWorkoutRecord(sets: readonly LoggedSet[], libraryIdFor: (exerciseId: string) => string | null): WorkoutRecord | null {
  const kept = [...sets].filter((set) => (set.kind === "hold" ? set.holdSeconds > 0 : set.reps > 0)).sort((a, b) => a.startedAt - b.startedAt);
  if (kept.length === 0) return null;

  // Exercises in the order they were first done; more than ten sets of one go on to a second row.
  const groups = new Map<string, LoggedSet[]>();
  for (const set of kept) groups.set(set.exerciseId, [...(groups.get(set.exerciseId) ?? []), set]);
  const exercises: RecordExercise[] = [];
  for (const group of groups.values()) {
    for (let start = 0; start < group.length; start += MAX_SETS_PER_ROW) {
      const chunk = group.slice(start, start + MAX_SETS_PER_ROW);
      const hold = chunk[0].kind === "hold";
      const reps = chunk.map((set) => set.reps);
      exercises.push({
        exercise_id: libraryIdFor(chunk[0].exerciseId),
        exercise_name: chunk[0].exerciseName,
        sort_order: exercises.length,
        target_sets: chunk.length,
        reps_min: hold ? 1 : clamp(Math.min(...reps), 1, 100),
        reps_max: hold ? 1 : clamp(Math.max(...reps), 1, 100),
        target_duration_seconds: hold ? clamp(Math.max(...chunk.map((set) => set.holdSeconds)), 1, 86_400) : null,
        sets: chunk.map((set, index) => ({
          set_number: index + 1,
          target_reps: null,
          reps: hold ? null : clamp(set.reps, 1, 500),
          duration_seconds: hold ? clamp(set.holdSeconds, 1, 86_400) : null,
          weight_kg: 0,
          completed_at: new Date(set.endedAt).toISOString(),
          rep_source: "camera",
        })),
      });
    }
  }
  if (exercises.length > MAX_ROWS) exercises.length = MAX_ROWS;

  const startedAt = kept[0].startedAt;
  const endedAt = Math.max(...kept.map((set) => set.endedAt));
  // Training time is the time measured in the sets themselves, not the span from the first set to
  // the last: sets kept from 08:00 and 19:00 are not eleven hours of training.
  const trainingMs = kept.reduce((total, set) => total + Math.max(0, set.endedAt - set.startedAt), 0);
  return {
    session: {
      name: HOME_WORKOUT_SESSION_NAME,
      status: "completed",
      started_at: new Date(startedAt).toISOString(),
      completed_at: new Date(endedAt).toISOString(),
      duration_seconds: Math.max(0, Math.round(trainingMs / 1000)),
      total_volume: 0,
      notes: sessionNote(kept),
    },
    exercises,
  };
}

/** One line for the session's note: where the counts came from and the form across all reps. */
export function sessionNote(sets: readonly LoggedSet[]): string {
  const reps = sets.filter((set) => set.kind === "reps");
  const total = reps.reduce((sum, set) => sum + set.reps, 0);
  const clean = reps.reduce((sum, set) => sum + set.cleanReps, 0);
  const form = total > 0 ? ` Form: ${clean} of ${total} reps without a cue.` : "";
  return `Counted by the camera on this device.${form}`.slice(0, 500);
}

type Answer = { data: unknown; error: unknown };
interface Query extends PromiseLike<Answer> {
  select(columns: string): Query;
  single(): Query;
  eq(column: string, value: unknown): Query;
}
interface Table {
  insert(values: unknown): Query;
  delete(): Query;
}
export interface SaveDb {
  from(table: string): Table;
}

export type SaveOutcome = { ok: true; sessionId: string } | { ok: false; message: string };

const FAILED = "Your workout couldn’t be saved. Check your connection and try again.";

/** Sessions written by a save that failed and could not be deleted yet. */
export interface UnfinishedSaves {
  read(): string[];
  write(ids: readonly string[]): void;
}

const UNFINISHED_KEY = "fitx:home-workout:unfinished-save";
/** Used when the tab's storage is blocked: the ids still last as long as the page. */
let unfinishedInMemory: string[] = [];

/** The unfinished saves kept in this tab's storage, beside the unsaved sets they belong to. */
export function tabUnfinishedSaves(storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null): UnfinishedSaves {
  return {
    read() {
      try {
        const raw = storage?.getItem(UNFINISHED_KEY);
        const value: unknown = raw ? JSON.parse(raw) : unfinishedInMemory;
        return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
      } catch {
        return [...unfinishedInMemory];
      }
    },
    write(ids) {
      unfinishedInMemory = [...ids];
      try {
        if (!storage) return;
        if (ids.length === 0) storage.removeItem(UNFINISHED_KEY);
        else storage.setItem(UNFINISHED_KEY, JSON.stringify(ids));
      } catch {
        // Blocked or full storage: the in-memory copy covers a retry on this page.
      }
    },
  };
}

/** Deletes a session (its exercises and sets go with it), trying twice. True once it is gone. */
async function removeSession(db: SaveDb, userId: string, sessionId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const answer = await db.from("workout_sessions").delete().eq("id", sessionId).eq("user_id", userId);
      if (!answer.error) return true;
    } catch {
      // A dropped connection can throw as well as answer with an error; try once more.
    }
  }
  return false;
}

/**
 * Writes the record. The sets are not cleared here: the page does that once this says ok. A
 * session left over from an earlier failed attempt is deleted first; if that can't be done, nothing
 * new is written.
 */
export async function saveWorkoutRecord(db: SaveDb, userId: string, record: WorkoutRecord, unfinished: UnfinishedSaves = tabUnfinishedSaves(null)): Promise<SaveOutcome> {
  const forget = (id: string) => unfinished.write(unfinished.read().filter((item) => item !== id));
  for (const leftover of unfinished.read()) {
    if (!(await removeSession(db, userId, leftover))) return { ok: false, message: FAILED };
    forget(leftover);
  }

  const created = await db.from("workout_sessions").insert({ user_id: userId, ...record.session }).select("id").single();
  const sessionId = (created.data as { id?: string } | null)?.id;
  if (created.error || !sessionId) return { ok: false, message: FAILED };
  // Remembered until the save finishes or its clean-up succeeds, so a reload mid-save can't strand it.
  unfinished.write([...unfinished.read().filter((item) => item !== sessionId), sessionId]);

  const undo = async (message: string): Promise<SaveOutcome> => {
    if (await removeSession(db, userId, sessionId)) forget(sessionId);
    return { ok: false, message };
  };

  const exerciseRows = record.exercises.map((exercise) => {
    const row: Record<string, unknown> = { user_id: userId, session_id: sessionId, ...exercise };
    delete row.sets;
    return row;
  });
  const exercises = await insertDropping(db, "workout_session_exercises", exerciseRows, ["target_duration_seconds"], "id,sort_order");
  if (exercises.error) return undo(FAILED);
  const ids = new Map<number, string>();
  for (const row of (exercises.data as Array<{ id: string; sort_order: number }> | null) ?? []) ids.set(row.sort_order, row.id);
  if (ids.size !== record.exercises.length) return undo(FAILED);

  const setRows = record.exercises.flatMap((exercise) => exercise.sets.map((set) => ({ user_id: userId, session_exercise_id: ids.get(exercise.sort_order), ...set })));
  const hasHolds = setRows.some((row) => row.duration_seconds !== null);
  const sets = await insertDropping(db, "workout_sets", setRows, ["rep_source", ...(hasHolds ? [] : ["duration_seconds"])], "id");
  if (sets.error) {
    const missing = missingColumnFromError(sets.error);
    return undo(missing?.column === "duration_seconds" ? "Timed holds can’t be saved to history yet. Remove them and save the rest." : FAILED);
  }
  forget(sessionId);
  return { ok: true, sessionId };
}

/** Inserts rows, dropping an optional column the database reports missing and trying again. */
async function insertDropping(db: SaveDb, table: string, rows: Array<Record<string, unknown>>, optional: readonly string[], columns: string): Promise<Answer> {
  let current = rows;
  const left = new Set(optional);
  for (;;) {
    const answer = await db.from(table).insert(current).select(columns);
    const missing = answer.error ? missingColumnFromError(answer.error) : null;
    const column = missing?.column ?? null;
    if (!answer.error || !column || !left.has(column)) return answer;
    left.delete(column);
    current = current.map((row) => {
      const copy = { ...row };
      delete copy[column];
      return copy;
    });
  }
}
