// Workout history and one session's record: stats and muscles from the logged sets only, abandoned sessions shown
// but never counted, and the loaders against databases with and without the newer workout columns.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { StubDb, used, type StubCall } from "../home/support/stub-db";
import {
  buildHistoryRows, countedSets, groupByMonth, isSessionId, loadHistoryPage, loadInProgressSession, loadSessionRecord, readWithOptional, recordHref,
  recordLine, recordMuscles, recordStats, repeatPlanFrom, saveSessionNote, statusBadge, stripStats, toLoggedSession,
  type RecordExercise, type RecordSet, type SessionRecord,
} from "@/app/(dashboard)/workouts/history/_lib/session-record";
import type { LibraryMuscles } from "@/lib/training/muscle-history";

const db = (stub: StubDb) => stub as unknown as SupabaseClient;
const SESSION = "11111111-2222-4333-8444-555555555555";
const T = (minute: number) => new Date(Date.UTC(2026, 10, 18, 9, minute)).toISOString();
const BENCH: LibraryMuscles = { id: "bench_press", name: "Bench Press", primary_muscle: "chest", secondary_muscles: ["triceps", "front_deltoids"] };
const PUSH_UP: LibraryMuscles = { id: "push_up", name: "Push-Up", primary_muscle: "chest", secondary_muscles: ["triceps"] };
const PLANK: LibraryMuscles = { id: "plank", name: "Plank", primary_muscle: "abdominals", secondary_muscles: [] };

const set = (n: number, reps: number | null, weight: number, done: boolean, extra: Partial<RecordSet> = {}): RecordSet => ({
  id: `set-${n}-${reps}-${weight}`, set_number: n, target_reps: 8, reps, weight_kg: weight, duration_seconds: null, completed_at: done ? T(10 + n) : null, rep_source: null, ...extra,
});
const exercise = (id: string, library: LibraryMuscles | null, sets: RecordSet[], extra: Partial<RecordExercise> = {}): RecordExercise => ({
  id, exercise_id: library?.id ?? null, name: library?.name ?? id, sort_order: 0, target_sets: 3, reps_min: 8, reps_max: 10, rest_seconds: 90,
  target_weight_kg: null, target_duration_seconds: null, sets, library, sourceRef: null, equipment: null, ...extra,
});
const record = (status: string, exercises: RecordExercise[]): SessionRecord => ({
  session: { id: SESSION, name: "Push day", status, started_at: T(0), completed_at: status === "completed" ? T(45) : null, duration_seconds: 2400, notes: null, plan_id: null },
  exercises, records: [], targetsIncluded: true, musclesFailed: false,
});

const sample = [
  exercise("e1", BENCH, [set(1, 8, 60, true), set(2, 8, 60, true), set(3, 6, 60, false)]),
  exercise("e2", PLANK, [set(1, null, 0, true, { duration_seconds: 45 })], { target_duration_seconds: 45, sort_order: 1 }),
  exercise("e3", null, [set(1, 10, 0, true)], { name: "Band pull-apart", sort_order: 2 }),
];

describe("labels and links", () => {
  test("abandoned sessions say they are not counted; ids and links", () => {
    assert.equal(statusBadge("abandoned"), "Abandoned · not counted");
    assert.equal(statusBadge("completed"), null);
    assert.ok(isSessionId(SESSION));
    assert.ok(!isSessionId("not-a-session"));
    assert.equal(recordHref(SESSION), `/workouts/history/${SESSION}`);
    assert.equal(recordLine({ exercise_name: "Bench Press", best_weight_kg: 80, best_reps: 6, estimated_one_rep_max: 96, achieved_at: null }), "Bench Press · 80 kg × 6");
    assert.equal(recordLine({ exercise_name: "Pull-Up", best_weight_kg: 0, best_reps: 12, estimated_one_rep_max: 0, achieved_at: null }), "Pull-Up · 12 reps");
  });
});

describe("a session's record", () => {
  test("muscles come from completed sets only, through the one counting rule", () => {
    const muscles = recordMuscles(record("completed", sample));
    assert.equal(muscles.regions.chest.primarySets, 2, "the unticked third set gives no credit");
    assert.equal(muscles.regions.triceps.secondarySets, 2);
    assert.equal(muscles.regions.abdominals.primarySets, 1, "a timed plank counts as a core set");
    assert.equal(muscles.unmapped.sets, 1, "the free-text exercise is reported, not guessed");
    assert.equal(muscles.ranked[0].region, "chest", "the busiest region first");
    assert.ok(muscles.ranked.some((region) => region.region === "abdominals"));
  });

  test("an abandoned session trains nothing and its stats still describe what was logged", () => {
    const abandoned = record("abandoned", sample);
    assert.equal(recordMuscles(abandoned).sets, 0);
    assert.equal(recordMuscles(abandoned).ranked.length, 0);
    const stats = recordStats(abandoned);
    assert.equal(stats.elapsedSeconds, null, "no finish time");
    assert.equal(stats.completedSets, 4);
  });

  test("stats for StatStrip: training time, volume, sets and exercises", () => {
    const stats = recordStats(record("completed", sample));
    assert.equal(stats.volumeKg, 960);
    assert.equal(stats.exercisesDone, 3);
    const strip = stripStats(stats, undefined, { locale: "en-GB" });
    assert.deepEqual(strip.map((item) => [item.label, item.value, item.unit ?? null]), [
      ["Training time", "40:00", null], ["Total volume", "960", "kg"], ["Sets", "4", null], ["Exercises", "3", null],
    ]);
    const bodyweight = stripStats(recordStats(record("completed", [sample[2]])), ["volume"]);
    assert.equal(bodyweight[0].value, null, "no weighted sets: unknown, never 0 kg");
    assert.deepEqual(countedSets(sample[0]).map((item) => item.set_number), [1, 2]);
  });

  test("toLoggedSession keeps the library muscles and the sets as logged", () => {
    const logged = toLoggedSession(record("completed", sample));
    assert.equal(logged.exercises[0].library?.id, "bench_press");
    assert.equal(logged.exercises[1].target_duration_seconds, 45);
    assert.equal(logged.exercises[0].sets.length, 3);
  });

  test("repeat: a draft plan of the library exercises in order, the rest counted as left out", () => {
    const repeat = repeatPlanFrom(record("abandoned", sample), { location: "home", split: "push_pull_legs" });
    assert.deepEqual(repeat.plan, { title: "Push day", split: "push_pull_legs", workout_location: "home", planned_for: null, notes: null });
    assert.deepEqual(repeat.exercises.map((item) => item.exercise_id), ["bench_press", "plank"]);
    assert.equal(repeat.exercises[1].target_duration_seconds, 45);
    assert.equal(repeat.leftOut, 1);
    const odd = repeatPlanFrom(record("completed", [exercise("e9", BENCH, [], { target_sets: 30, reps_min: 12, reps_max: 4, rest_seconds: 5 })]));
    assert.deepEqual([odd.exercises[0].target_sets, odd.exercises[0].reps_min, odd.exercises[0].reps_max, odd.exercises[0].rest_seconds], [10, 12, 12, 15]);
    assert.equal(odd.plan.workout_location, "gym");
    assert.equal(odd.plan.split, "custom");
  });
});

describe("history rows", () => {
  const sessions = [
    { id: "s2", name: "Legs", status: "abandoned", started_at: T(30), completed_at: null, duration_seconds: 600 },
    { id: "s1", name: "Push", status: "completed", started_at: T(0), completed_at: T(40), duration_seconds: 2100 },
  ];
  const exercises = [
    { id: "x1", session_id: "s1", exercise_id: "free-exercise-db-Pushups", exercise_name: "Pushups" },
    { id: "x2", session_id: "s1", exercise_id: "bench_press", exercise_name: "Bench Press", target_duration_seconds: null },
    { id: "x3", session_id: "s2", exercise_id: "bench_press", exercise_name: "Bench Press" },
  ];
  const sets = [
    { session_exercise_id: "x1", set_number: 1, reps: 12, weight_kg: 0, completed_at: T(5) },
    { session_exercise_id: "x2", set_number: 1, reps: 8, weight_kg: "62.5", completed_at: T(9) },
    { session_exercise_id: "x3", set_number: 1, reps: 8, weight_kg: 60, completed_at: T(31) },
  ];
  const library = new Map([["push_up", PUSH_UP], ["bench_press", BENCH]]);

  test("each row's stats and directly trained regions; abandoned rows train none", () => {
    const rows = buildHistoryRows(sessions, exercises, sets, library);
    assert.deepEqual(rows.map((row) => row.id), ["s2", "s1"]);
    assert.deepEqual(rows[1].regions, ["chest"], "a merged duplicate counts as its survivor");
    assert.equal(rows[1].stats.completedSets, 2);
    assert.equal(rows[1].stats.volumeKg, 500);
    assert.deepEqual(rows[0].regions, []);
    assert.equal(rows[0].stats.completedSets, 1);
  });

  test("grouped by the local month they started in", () => {
    const groups = groupByMonth([
      { started_at: new Date(2026, 10, 18, 9).toISOString() }, { started_at: new Date(2026, 10, 2, 9).toISOString() }, { started_at: new Date(2026, 9, 30, 9).toISOString() },
    ]);
    assert.deepEqual(groups.map((group) => [group.key, group.rows.length]), [["2026-11", 2], ["2026-10", 1]]);
  });
});

const selectOf = (call: StubCall) => String(call.ops.find((op) => op.method === "select")?.args[0] ?? "");
const inOf = (call: StubCall) => (call.ops.find((op) => op.method === "in")?.args[1] ?? []) as string[];
const rangeOf = (call: StubCall) => (call.ops.find((op) => op.method === "range")?.args ?? [0, 0]) as [number, number];
const missing = (column: string) => ({ data: null, error: { code: "42703", message: `column ${column} does not exist` } });

describe("reading with optional columns", () => {
  test("drops only the group the database is missing", async () => {
    const asked: boolean[][] = [];
    const result = await readWithOptional([["duration_seconds"], ["rep_source"]], (included) => {
      asked.push(included);
      return Promise.resolve(included[1] ? missing("workout_sets.rep_source") : { data: [1], error: null });
    });
    assert.deepEqual(asked, [[true, true], [true, false]]);
    assert.deepEqual(result.included, [true, false]);
    assert.deepEqual(result.answer.data, [1]);
    const other = await readWithOptional([["duration_seconds"]], () => Promise.resolve({ data: null, error: { code: "500", message: "boom" } }));
    assert.deepEqual(other.included, [true], "another error is returned untouched");
  });
});

describe("loadSessionRecord", () => {
  const sessionRow = { id: SESSION, name: "Push day", status: "completed", started_at: T(0), completed_at: T(45), duration_seconds: 2400, notes: " ", plan_id: null };
  const exerciseRows = [
    { id: "e2", exercise_id: "free-exercise-db-Pushups", exercise_name: "Pushups", sort_order: 1, target_sets: 2, reps_min: 10, reps_max: 12, rest_seconds: 60, target_weight_kg: null, target_duration_seconds: null },
    { id: "e1", exercise_id: "bench_press", exercise_name: "Bench Press", sort_order: 0, target_sets: 3, reps_min: 8, reps_max: 10, rest_seconds: 90, target_weight_kg: "60", target_duration_seconds: null },
  ];
  const setRows = [
    { id: "a", session_exercise_id: "e1", set_number: 2, target_reps: 9, reps: 8, weight_kg: "60", duration_seconds: null, completed_at: T(8), rep_source: "manual" },
    { id: "b", session_exercise_id: "e1", set_number: 1, target_reps: 9, reps: 9, weight_kg: "60", duration_seconds: null, completed_at: T(5), rep_source: null },
    { id: "c", session_exercise_id: "e2", set_number: 1, target_reps: 11, reps: 12, weight_kg: 0, duration_seconds: null, completed_at: T(20), rep_source: "camera" },
  ];
  const handler = (call: StubCall) => {
    if (call.name === "workout_sessions") return { data: sessionRow };
    if (call.name === "workout_session_exercises") return { data: exerciseRows };
    if (call.name === "workout_sets") return { data: setRows };
    if (call.name === "personal_records") return { data: [{ exercise_name: "Bench Press", best_weight_kg: "60", best_reps: 9, estimated_one_rep_max: "78", achieved_at: T(45) }] };
    if (call.name === "exercise_library") {
      if (selectOf(call).includes("source_ref")) return { data: [{ id: "push_up", source_ref: "Pushups", required_equipment: [] }] };
      return { data: [BENCH, PUSH_UP].filter((row) => inOf(call).includes(row.id)) };
    }
    return undefined;
  };

  test("the session, its exercises in order with their sets, muscles by surviving id and held records", async () => {
    const stub = new StubDb(handler);
    const result = await loadSessionRecord(db(stub), "user-1", SESSION);
    assert.equal(result.status, "found");
    if (result.status !== "found") return;
    const { session, exercises, records } = result.record;
    assert.equal(session.notes, null, "a blank note is no note");
    assert.deepEqual(exercises.map((item) => item.id), ["e1", "e2"]);
    assert.deepEqual(exercises[0].sets.map((item) => item.set_number), [1, 2]);
    assert.equal(exercises[0].target_weight_kg, 60);
    assert.equal(exercises[1].library?.id, "push_up");
    assert.equal(exercises[1].sourceRef, "Pushups");
    assert.equal(exercises[1].sets[0].rep_source, "camera");
    assert.equal(records?.[0].best_weight_kg, 60);
    assert.equal(result.record.musclesFailed, false);
    assert.ok(used(stub.callsTo("workout_sessions")[0], "eq", "user_id", "user-1"));
    assert.ok(used(stub.callsTo("personal_records")[0], "eq", "session_id", SESSION));
    assert.match(selectOf(stub.callsTo("workout_sets")[0]), /duration_seconds,rep_source$/);
    assert.equal(recordMuscles(result.record).regions.chest.primarySets, 3);
  });

  test("older databases: targets, seconds and the rep source are left out and the record still loads", async () => {
    const stub = new StubDb((call) => {
      if (call.name === "workout_session_exercises" && selectOf(call).includes("target_weight_kg")) return missing("workout_session_exercises.target_weight_kg");
      if (call.name === "workout_sets" && selectOf(call).includes("rep_source")) return missing("workout_sets.rep_source");
      if (call.name === "workout_sets" && selectOf(call).includes("duration_seconds")) return missing("workout_sets.duration_seconds");
      if (call.name === "exercise_library" && selectOf(call).includes("source_ref")) return missing("exercise_library.source_ref");
      return handler(call);
    });
    const result = await loadSessionRecord(db(stub), "user-1", SESSION);
    assert.equal(result.status, "found");
    if (result.status !== "found") return;
    assert.equal(result.record.targetsIncluded, false);
    assert.equal(result.record.exercises[1].sourceRef, null);
    assert.equal(stub.callsTo("workout_sets").length, 3, "with both, without the rep source, then without both");
  });

  test("missing, invalid and failing", async () => {
    assert.deepEqual(await loadSessionRecord(db(new StubDb(() => ({ data: null }))), "user-1", SESSION), { status: "missing" });
    const invalid = new StubDb(handler);
    assert.deepEqual(await loadSessionRecord(db(invalid), "user-1", "nope"), { status: "missing" });
    assert.equal(invalid.calls.length, 0, "an invalid id asks nothing");
    const failing = await loadSessionRecord(db(new StubDb(() => ({ error: { code: "500", message: "boom" } }))), "user-1", SESSION);
    assert.equal(failing.status, "error");
    const noRecords = await loadSessionRecord(db(new StubDb((call) => (call.name === "personal_records" ? { error: { code: "500", message: "boom" } } : handler(call)))), "user-1", SESSION);
    assert.equal(noRecords.status === "found" ? noRecords.record.records : "x", null, "records that cannot be read are unknown, not none");
  });

  test("a library that cannot be read leaves the record standing, with its muscles marked as unknown", async () => {
    const stub = new StubDb((call) => (call.name === "exercise_library" && !selectOf(call).includes("source_ref") ? { error: { code: "500", message: "boom" } } : handler(call)));
    const result = await loadSessionRecord(db(stub), "user-1", SESSION);
    assert.equal(result.status, "found");
    if (result.status !== "found") return;
    assert.equal(result.record.musclesFailed, true);
    assert.deepEqual(result.record.exercises.map((item) => item.library), [null, null], "unknown, never guessed");
    assert.deepEqual(result.record.exercises[0].sets.map((item) => item.set_number), [1, 2], "the sets still show");
    assert.equal(recordStats(result.record).completedSets, 3, "and so do the totals");
  });
});

describe("loadHistoryPage", () => {
  const sessions = Array.from({ length: 25 }, (_, index) => ({ id: `s${index}`, name: `Workout ${index}`, status: index % 5 === 0 ? "abandoned" : "completed", started_at: T(59 - index), completed_at: T(59), duration_seconds: 1800 }));
  const handler = (call: StubCall) => {
    if (call.name === "workout_sessions") { const [from, to] = rangeOf(call); return { data: sessions.slice(from, to + 1) }; }
    if (call.name === "workout_session_exercises") return { data: inOf(call).map((sessionId) => ({ id: `x-${sessionId}`, session_id: sessionId, exercise_id: "bench_press", exercise_name: "Bench Press", target_duration_seconds: null })) };
    if (call.name === "workout_sets") return { data: inOf(call).map((exerciseId) => ({ session_exercise_id: exerciseId, set_number: 1, reps: 5, weight_kg: 100, duration_seconds: null, completed_at: T(1) })) };
    if (call.name === "exercise_library") return { data: [BENCH] };
    return undefined;
  };

  test("completed and abandoned sessions, newest first, a page at a time", async () => {
    const stub = new StubDb(handler);
    const first = await loadHistoryPage(db(stub), "user-1");
    assert.equal(first.error, null);
    assert.equal(first.page.rows.length, 20);
    assert.equal(first.page.nextOffset, 20);
    const head = stub.callsTo("workout_sessions")[0];
    assert.ok(used(head, "in", "status", ["completed", "abandoned"]));
    assert.ok(used(head, "order", "started_at", { ascending: false }));
    assert.deepEqual(rangeOf(head), [0, 20], "one more than a page, to know whether more exist");
    assert.deepEqual(first.page.rows[1].regions, ["chest"]);
    assert.deepEqual(first.page.rows[0].regions, [], "the abandoned session trains nothing");
    assert.equal(first.page.rows[1].stats.volumeKg, 500);
    const second = await loadHistoryPage(db(new StubDb(handler)), "user-1", { offset: 20 });
    assert.equal(second.page.rows.length, 5);
    assert.equal(second.page.nextOffset, null);
  });

  test("no sessions, a failing request, a library that cannot be read", async () => {
    const empty = new StubDb(() => ({ data: [] }));
    assert.deepEqual(await loadHistoryPage(db(empty), "user-1"), { error: null, page: { rows: [], nextOffset: null } });
    assert.equal(empty.callsTo("workout_session_exercises").length, 0);
    const failing = await loadHistoryPage(db(new StubDb(() => ({ error: { code: "500", message: "boom" } }))), "user-1");
    assert.ok(failing.error);
    const noLibrary = await loadHistoryPage(db(new StubDb((call) => (call.name === "exercise_library" ? { error: { code: "500" } } : handler(call)))), "user-1");
    assert.equal(noLibrary.error, null);
    assert.deepEqual(noLibrary.page.rows[1].regions, [], "without the library the rows show without muscles");
  });

  test("older databases are read without the timed-sets columns", async () => {
    const stub = new StubDb((call) => {
      if (call.name === "workout_session_exercises" && selectOf(call).includes("target_duration_seconds")) return missing("workout_session_exercises.target_duration_seconds");
      if (call.name === "workout_sets" && selectOf(call).includes("duration_seconds")) return missing("workout_sets.duration_seconds");
      return handler(call);
    });
    const result = await loadHistoryPage(db(stub), "user-1", { pageSize: 3 });
    assert.equal(result.error, null);
    assert.equal(result.page.rows.length, 3);
  });
});

describe("in progress and notes", () => {
  test("the workout in progress, if any", async () => {
    const stub = new StubDb(() => ({ data: { id: SESSION, name: "Push", started_at: T(0) } }));
    assert.equal((await loadInProgressSession(db(stub), "user-1"))?.id, SESSION);
    assert.ok(used(stub.callsTo("workout_sessions")[0], "eq", "status", "in_progress"));
    assert.equal(await loadInProgressSession(db(new StubDb(() => ({ error: { code: "500" } }))), "user-1"), null);
  });

  test("a note is trimmed, capped at 500 characters and only saved on a completed session", async () => {
    const stub = new StubDb(() => ({ data: { id: SESSION } }));
    const saved = await saveSessionNote(db(stub), "user-1", SESSION, `  ${"a".repeat(600)}  `);
    assert.equal(saved.notes?.length, 500);
    const update = stub.callsTo("workout_sessions")[0];
    assert.ok(used(update, "eq", "status", "completed"));
    assert.deepEqual((await saveSessionNote(db(new StubDb(() => ({ data: { id: SESSION } }))), "user-1", SESSION, "   ")).notes, null, "empty clears it");
    assert.ok((await saveSessionNote(db(new StubDb(() => ({ data: null }))), "user-1", SESSION, "Felt strong")).error, "no completed session: not saved");
  });
});
