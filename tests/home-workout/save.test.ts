import { test } from "node:test";
import assert from "node:assert/strict";
import type { LoggedSet } from "@/lib/home-workout/log";
import { buildWorkoutRecord, saveWorkoutRecord, sessionNote, tabUnfinishedSaves, type SaveDb, type UnfinishedSaves } from "@/lib/home-workout/save";

const T0 = Date.UTC(2026, 10, 20, 7, 0, 0);
let n = 0;
function set(exerciseId: LoggedSet["exerciseId"], name: string, result: { reps?: number; clean?: number; hold?: number }, minute: number): LoggedSet {
  n += 1;
  const hold = result.hold !== undefined;
  return {
    id: `s${n}`, exerciseId, exerciseName: name, kind: hold ? "hold" : "reps",
    reps: result.reps ?? 0, cleanReps: result.clean ?? result.reps ?? 0, holdSeconds: result.hold ?? 0,
    repLog: Array.from({ length: result.reps ?? 0 }, (_, i) => ({ clean: i < (result.clean ?? result.reps ?? 0), cues: i < (result.clean ?? result.reps ?? 0) ? [] : ["hip_sag"] })),
    cueTexts: {}, startedAt: T0 + minute * 60_000, endedAt: T0 + minute * 60_000 + 45_000,
  };
}
const library = (id: string) => ({ push_up: "push_up", plank: "plank" } as Record<string, string>)[id] ?? null;

test("today's sets become one completed session: exercises in order, sets numbered, holds in seconds", () => {
  const sets = [set("push_up", "Push-up", { reps: 12, clean: 10 }, 0), set("plank", "Plank", { hold: 40 }, 3), set("push_up", "Push-up", { reps: 9 }, 6), set("high_knees", "High knees", { reps: 30 }, 9)];
  const record = buildWorkoutRecord(sets, library);
  assert.ok(record);
  assert.equal(record.session.name, "AI Form Check");
  assert.equal(record.session.status, "completed");
  assert.equal(record.session.started_at, new Date(T0).toISOString());
  assert.equal(record.session.duration_seconds, 4 * 45, "the time measured in the four 45-second sets, not the rests between them");
  assert.equal(record.session.completed_at, new Date(T0 + 9 * 60_000 + 45_000).toISOString());
  assert.equal(record.session.notes, "Counted by the camera on this device. Form: 49 of 51 reps without a cue.");
  assert.deepEqual(record.exercises.map((e) => [e.exercise_id, e.exercise_name, e.sort_order, e.target_sets, e.reps_min, e.reps_max, e.target_duration_seconds]), [
    ["push_up", "Push-up", 0, 2, 9, 12, null],
    ["plank", "Plank", 1, 1, 1, 1, 40],
    [null, "High knees", 2, 1, 30, 30, null],
  ]);
  assert.deepEqual(record.exercises[0].sets.map((s) => [s.set_number, s.reps, s.duration_seconds, s.rep_source, s.weight_kg]), [[1, 12, null, "camera", 0], [2, 9, null, "camera", 0]]);
  assert.deepEqual(record.exercises[1].sets.map((s) => [s.reps, s.duration_seconds]), [[null, 40]]);
  assert.doesNotMatch(JSON.stringify(record), /"(x|y|z|visibility|points|landmarks)"/);
});

test("sets hours apart on one day are saved as the time spent in them, not the hours between", () => {
  const record = buildWorkoutRecord([set("push_up", "Push-up", { reps: 12 }, 0), set("bodyweight_squat", "Squat", { reps: 15 }, 11 * 60)], library);
  assert.ok(record);
  assert.equal(record.session.duration_seconds, 90);
  assert.equal(record.session.started_at, new Date(T0).toISOString());
  assert.equal(record.session.completed_at, new Date(T0 + 11 * 3_600_000 + 45_000).toISOString());
});

test("nothing counted means nothing to save, and an eleventh set of one exercise starts a second row", () => {
  assert.equal(buildWorkoutRecord([set("push_up", "Push-up", { reps: 0 }, 0)], library), null);
  const many = Array.from({ length: 11 }, (_, i) => set("push_up", "Push-up", { reps: 5 }, i));
  const record = buildWorkoutRecord(many, library);
  assert.deepEqual(record?.exercises.map((e) => [e.target_sets, e.sort_order, e.sets.at(-1)?.set_number]), [[10, 0, 10], [1, 1, 1]]);
});

test("a note for holds only does not claim any reps", () => {
  assert.equal(sessionNote([set("plank", "Plank", { hold: 30 }, 0)]), "Counted by the camera on this device.");
});

/** A recording stand-in for the Supabase client. */
function fakeDb(fail: { table?: string; missing?: string[]; error?: boolean; deleteFails?: number } = {}) {
  const calls: Array<{ table: string; op: string; values?: unknown; filters?: Array<[string, unknown]> }> = [];
  let missing = [...(fail.missing ?? [])];
  let deleteFails = fail.deleteFails ?? 0;
  const db: SaveDb = {
    from(table) {
      const call: (typeof calls)[number] = { table, op: "", filters: [] };
      const answer = () => {
        if (call.op === "insert") {
          const rows = Array.isArray(call.values) ? call.values : [call.values];
          const column = missing.find((name) => rows.some((row) => name in (row as object)));
          if (column && table === "workout_sets" || column && table === "workout_session_exercises") {
            return { data: null, error: { code: "PGRST204", message: `Could not find the '${column}' column of '${table}' in the schema cache` } };
          }
          if (fail.error && fail.table === table) return { data: null, error: { code: "23514", message: "check" } };
          if (table === "workout_sessions") return { data: { id: "session-1" }, error: null };
          return { data: rows.map((row, i) => ({ id: `${table}-${i}`, sort_order: (row as { sort_order?: number }).sort_order })), error: null };
        }
        if (call.op === "delete" && deleteFails > 0) {
          deleteFails -= 1;
          return { data: null, error: { code: "", message: "TypeError: Failed to fetch" } };
        }
        return { data: null, error: null };
      };
      const query = {
        select: () => query, single: () => query,
        eq: (column: string, value: unknown) => { call.filters?.push([column, value]); return query; },
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(answer()).then(resolve, reject),
      };
      return {
        insert(values: unknown) { call.op = "insert"; call.values = values; calls.push(call); return query as never; },
        delete() { call.op = "delete"; calls.push(call); return query as never; },
      };
    },
  };
  return { db, calls, clearMissing: () => { missing = []; } };
}

const record = () => buildWorkoutRecord([set("push_up", "Push-up", { reps: 10 }, 0), set("plank", "Plank", { hold: 30 }, 2)], library)!;

test("saves the session, its exercises and its sets as the member", async () => {
  const { db, calls } = fakeDb();
  const outcome = await saveWorkoutRecord(db, "user-1", record());
  assert.deepEqual(outcome, { ok: true, sessionId: "session-1" });
  assert.deepEqual(calls.map((c) => `${c.op} ${c.table}`), ["insert workout_sessions", "insert workout_session_exercises", "insert workout_sets"]);
  const sets = calls[2].values as Array<Record<string, unknown>>;
  assert.ok(sets.every((row) => row.user_id === "user-1" && row.rep_source === "camera"));
  assert.deepEqual(sets.map((row) => row.session_exercise_id), ["workout_session_exercises-0", "workout_session_exercises-1"]);
});

test("an older database without the camera label still takes the sets", async () => {
  const { db, calls } = fakeDb({ missing: ["rep_source"] });
  const outcome = await saveWorkoutRecord(db, "user-1", record());
  assert.equal(outcome.ok, true);
  const last = calls.at(-1)?.values as Array<Record<string, unknown>>;
  assert.ok(last.every((row) => !("rep_source" in row)));
});

test("a failed step removes the half-written session", async () => {
  const { db, calls } = fakeDb({ table: "workout_sets", error: true });
  const outcome = await saveWorkoutRecord(db, "user-1", record());
  assert.equal(outcome.ok, false);
  const undo = calls.at(-1);
  assert.equal(undo?.op, "delete");
  assert.equal(undo?.table, "workout_sessions");
  assert.deepEqual(undo?.filters, [["id", "session-1"], ["user_id", "user-1"]]);
});

test("holds can't be saved without the seconds column, and the member is told", async () => {
  const { db, calls } = fakeDb({ missing: ["duration_seconds"] });
  const outcome = await saveWorkoutRecord(db, "user-1", record());
  assert.equal(outcome.ok, false);
  assert.match(outcome.ok ? "" : outcome.message, /Timed holds/);
  assert.equal(calls.at(-1)?.op, "delete");
});

/** An in-memory list of unfinished saves, as the tab's storage would keep it. */
function memoryStore(ids: string[] = []): UnfinishedSaves & { ids: string[] } {
  const store = { ids: [...ids], read: () => [...store.ids], write: (next: readonly string[]) => { store.ids = [...next]; } };
  return store;
}

test("a clean save leaves nothing to clean up", async () => {
  const { db } = fakeDb();
  const store = memoryStore();
  assert.equal((await saveWorkoutRecord(db, "user-1", record(), store)).ok, true);
  assert.deepEqual(store.ids, []);
});

test("a failed clean-up is retried once", async () => {
  const { db, calls } = fakeDb({ table: "workout_sets", error: true, deleteFails: 1 });
  const store = memoryStore();
  assert.equal((await saveWorkoutRecord(db, "user-1", record(), store)).ok, false);
  assert.deepEqual(calls.filter((c) => c.op === "delete").length, 2);
  assert.deepEqual(store.ids, [], "the second delete removed it");
});

test("a session whose clean-up failed is deleted before the retry writes anything, so no empty workout is left", async () => {
  const offline = fakeDb({ table: "workout_sets", error: true, deleteFails: 2 });
  const store = memoryStore();
  const first = await saveWorkoutRecord(offline.db, "user-1", record(), store);
  assert.equal(first.ok, false);
  assert.deepEqual(store.ids, ["session-1"], "remembered beside the unsaved sets");

  const online = fakeDb();
  const retry = await saveWorkoutRecord(online.db, "user-1", record(), store);
  assert.equal(retry.ok, true);
  assert.deepEqual(online.calls.map((c) => `${c.op} ${c.table}`), ["delete workout_sessions", "insert workout_sessions", "insert workout_session_exercises", "insert workout_sets"]);
  assert.deepEqual(online.calls[0].filters, [["id", "session-1"], ["user_id", "user-1"]]);
  assert.deepEqual(store.ids, []);
});

test("while the leftover session can't be deleted, nothing new is written", async () => {
  const { db, calls } = fakeDb({ deleteFails: 2 });
  const store = memoryStore(["old-session"]);
  const outcome = await saveWorkoutRecord(db, "user-1", record(), store);
  assert.equal(outcome.ok, false);
  assert.ok(calls.every((c) => c.op === "delete"), "no insert after a failed clean-up");
  assert.deepEqual(store.ids, ["old-session"]);
});

test("unfinished saves are kept in the tab's storage, so they survive a reload", async () => {
  const values = new Map<string, string>();
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => void values.set(k, v), removeItem: (k: string) => void values.delete(k) };
  const store = tabUnfinishedSaves(storage);
  store.write(["s-1", "s-2"]);
  assert.deepEqual(tabUnfinishedSaves(storage).read(), ["s-1", "s-2"]);
  values.set("fitx:home-workout:unfinished-save", "not json");
  assert.deepEqual(tabUnfinishedSaves(storage).read(), ["s-1", "s-2"], "unreadable storage falls back to this page's copy");
  store.write([]);
  assert.equal(values.has("fitx:home-workout:unfinished-save"), false);
});
