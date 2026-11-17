// One exercise's logged history (contract C8) and the exercise page's loaders built on it.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { StubDb, used, type StubCall } from "../home/support/stub-db";
import {
  MAX_ROW_PAGES, bestSet, buildExerciseSessions, durationSeries, formatBestSet, loadExerciseHistory, oneRepMaxSeries, previousPerformance, progressSeries,
  repsSeries, sessionVolumeKg, storedIdsOf, type ExerciseSession, type HistorySet,
} from "@/lib/training/exercise-history";
import { loadExerciseDetail, loadRecentSessions, recentSessionRows } from "@/lib/training/exercise-detail";
import { estimateOneRepMax } from "@/lib/training/one-rep-max";

const db = (stub: StubDb) => stub as unknown as SupabaseClient;
const at = (day: number, minute = 0) => new Date(Date.UTC(2026, 10, day, 9, minute)).toISOString();
const set = (reps: number | null, weightKg: number, extra: Partial<HistorySet> = {}): HistorySet => ({ setNumber: null, reps, weightKg, durationSeconds: null, completedAt: at(10), ...extra });
const entry = (sessionId: string, day: number, sets: HistorySet[], timed = false): ExerciseSession =>
  ({ sessionId, sessionName: `Session ${sessionId}`, startedAt: at(day), completedAt: at(day, 50), exerciseId: "bench_press", exerciseName: "Bench", timed, sets });

describe("best set", () => {
  test("the heaviest lift, more reps breaking a tie; its estimated one-rep max", () => {
    const best = bestSet([set(10, 60), set(5, 80), set(8, 80), set(12, 40)], false);
    assert.equal(best?.kind, "weighted");
    assert.deepEqual(best && best.kind === "weighted" ? [best.weightKg, best.reps, best.oneRepMaxKg] : null, [80, 8, estimateOneRepMax(80, 8)]);
    assert.equal(formatBestSet(best!), "80 kg × 8");
    assert.equal(formatBestSet(bestSet([set(8, 62.5)], false)!), "62.5 kg × 8");
  });

  test("body weight: the most reps; timed: the longest hold; nothing counted: null", () => {
    const bodyweight = bestSet([set(12, 0), set(15, 0), set(10, 0)], false);
    assert.deepEqual(bodyweight && bodyweight.kind === "bodyweight" ? bodyweight.reps : null, 15);
    assert.equal(formatBestSet(bodyweight!), "15 reps");
    const timed = bestSet([set(null, 0, { durationSeconds: 40 }), set(null, 0, { durationSeconds: 55 })], true);
    assert.equal(timed?.kind, "timed");
    assert.equal(formatBestSet(timed!), "55s timed");
    // A timed movement's sets never count as lifts, even with reps typed in beside the seconds.
    assert.equal(bestSet([set(1, 20, { durationSeconds: 30 })], true)?.kind, "timed");
    // A timed movement logged with reps only (no seconds) shows those reps as logged.
    assert.equal(formatBestSet(bestSet([set(20, 0)], true)!), "20 reps");
    // Sets with seconds only, on a movement not prescribed in seconds, are timed work.
    assert.equal(formatBestSet(bestSet([set(null, 0, { durationSeconds: 90 })], false)!), "90s timed");
    assert.equal(bestSet([], false), null);
    assert.equal(bestSet([set(0, 60), set(null, 0), set(8, 60, { completedAt: "" })], false), null, "no reps, no seconds or not ticked");
  });
});

describe("history helpers", () => {
  const sessions = [
    entry("s3", 17, [set(5, 100), set(5, 100)]),
    entry("s1", 3, [set(8, 80), set(8, 80)]),
    entry("s2", 10, [set(6, 90), set(10, 0)]),
  ];

  test("previous performance: the newest session with counted sets, leaving out the current one", () => {
    assert.equal(previousPerformance(sessions)?.sessionId, "s3");
    assert.equal(previousPerformance(sessions, { excludeSessionId: "s3" })?.sessionId, "s2");
    assert.equal(previousPerformance(sessions, { before: at(10) })?.sessionId, "s1", "only sessions before the date");
    assert.equal(previousPerformance(sessions, { before: new Date(at(17)) })?.sessionId, "s2");
    assert.equal(previousPerformance([entry("empty", 18, [])]), null);
    assert.equal(previousPerformance([]), null);
  });

  test("progress: estimated one-rep max for weighted lifts, reps for body weight, time for holds; oldest first", () => {
    assert.deepEqual(oneRepMaxSeries(sessions).map((point) => [point.sessionId, point.value]), [["s1", estimateOneRepMax(80, 8)], ["s2", estimateOneRepMax(90, 6)], ["s3", estimateOneRepMax(100, 5)]]);
    const series = progressSeries(sessions);
    assert.equal(series?.metric, "one_rep_max");
    assert.equal(series?.unit, "kg");
    assert.equal(series?.estimate, true, "estimated maxes are labelled as estimates");
    const pushUps = [entry("a", 1, [set(12, 0), set(15, 0)]), entry("b", 8, [set(18, 0)])];
    assert.deepEqual(repsSeries(pushUps).map((point) => point.value), [15, 18]);
    assert.deepEqual(progressSeries(pushUps), { metric: "reps", unit: "reps", estimate: false, points: repsSeries(pushUps) });
    const planks = [entry("p2", 9, [set(null, 0, { durationSeconds: 60 })], true), entry("p1", 2, [set(null, 0, { durationSeconds: 45 }), set(null, 0, { durationSeconds: 50 })], true)];
    assert.deepEqual(durationSeries(planks).map((point) => [point.sessionId, point.value]), [["p1", 50], ["p2", 60]]);
    assert.equal(progressSeries(planks)?.metric, "duration");
    assert.equal(progressSeries([]), null);
    assert.equal(sessionVolumeKg(sessions[0]), 1000);
    assert.equal(sessionVolumeKg(planks[0]), 0);
  });
});

describe("building sessions from rows", () => {
  const rows = {
    sessionExercises: [
      { id: "r1", session_id: "s1", exercise_id: "bench_press", exercise_name: "Bench", target_duration_seconds: null },
      { id: "r2", session_id: "s1", exercise_id: "bench_press", exercise_name: "Bench (again)", target_duration_seconds: null },
      { id: "r3", session_id: "s2", exercise_id: "free-exercise-db-Barbell_Bench_Press_-_Medium_Grip", exercise_name: "Barbell Bench Press - Medium Grip", target_duration_seconds: null },
      { id: "r4", session_id: "quit", exercise_id: "bench_press", exercise_name: "Bench", target_duration_seconds: null },
      { id: "r5", session_id: "s3", exercise_id: "bench_press", exercise_name: "Bench", target_duration_seconds: null },
      { id: "r6", session_id: "s4", exercise_id: "plank", exercise_name: "Plank", target_duration_seconds: 45 },
    ],
    sessions: [
      { id: "s1", name: "Push", status: "completed", started_at: at(5), completed_at: at(5, 50) },
      { id: "s2", name: "Old push", status: "completed", started_at: at(1), completed_at: at(1, 50) },
      { id: "quit", name: "Stopped", status: "abandoned", started_at: at(7), completed_at: null },
      { id: "s3", name: "Skipped bench", status: "completed", started_at: at(9), completed_at: at(9, 50) },
      { id: "s4", name: "Core", status: "completed", started_at: at(9), completed_at: at(9, 50) },
    ],
    sets: [
      { session_exercise_id: "r1", set_number: 2, reps: 8, weight_kg: "80", duration_seconds: null, completed_at: at(5, 20) },
      { session_exercise_id: "r1", set_number: 1, reps: 8, weight_kg: 75, duration_seconds: null, completed_at: at(5, 10) },
      { session_exercise_id: "r2", set_number: 1, reps: 10, weight_kg: 60, duration_seconds: null, completed_at: at(5, 30) },
      { session_exercise_id: "r1", set_number: 3, reps: 8, weight_kg: 80, duration_seconds: null, completed_at: null },
      { session_exercise_id: "r3", set_number: 1, reps: 5, weight_kg: 70, duration_seconds: null, completed_at: at(1, 10) },
      { session_exercise_id: "r4", set_number: 1, reps: 5, weight_kg: 100, duration_seconds: null, completed_at: at(7, 10) },
      { session_exercise_id: "r5", set_number: 1, reps: 0, weight_kg: 80, duration_seconds: null, completed_at: at(9, 10) },
      { session_exercise_id: "r6", set_number: 1, reps: null, weight_kg: 0, duration_seconds: 45, completed_at: at(9, 10) },
    ],
  };

  test("completed sessions with counted sets, merged duplicates included, an exercise done twice as one entry", () => {
    const result = buildExerciseSessions(["bench_press", "free-exercise-db-Barbell_Bench_Press_-_Medium_Grip", "plank"], rows);
    assert.deepEqual([...result.keys()], ["bench_press", "plank"], "a merged duplicate's id reads as its survivor");
    const bench = result.get("bench_press")!;
    assert.deepEqual(bench.map((item) => item.sessionId), ["s1", "s2"], "newest first; abandoned and set-less sessions left out");
    assert.deepEqual(bench[0].sets.map((item) => [item.setNumber, item.reps, item.weightKg]), [[1, 8, 75], [2, 8, 80], [1, 10, 60]], "in the order they were done");
    assert.equal(bench[1].exerciseName, "Barbell Bench Press - Medium Grip");
    assert.equal(bench[0].exerciseId, "bench_press");
    const plank = result.get("plank")!;
    assert.equal(plank[0].timed, true);
    assert.equal(formatBestSet(bestSet(plank[0].sets, plank[0].timed)!), "45s timed");
    assert.deepEqual(buildExerciseSessions(["bench_press"], rows, { limit: 1 }).get("bench_press")!.map((item) => item.sessionId), ["s1"]);
    assert.deepEqual(buildExerciseSessions(["bench_press"], rows, { excludeSessionId: "s1" }).get("bench_press")!.map((item) => item.sessionId), ["s2"]);
  });

  test("the exercise page's rows: date, completed sets and the top set, as it always showed them", () => {
    const result = buildExerciseSessions(["bench_press", "plank"], rows);
    assert.deepEqual(recentSessionRows(result.get("bench_press")!), [
      { id: "s1", started_at: at(5), completedSets: 3, topSet: "80 kg × 8" },
      { id: "s2", started_at: at(1), completedSets: 1, topSet: "70 kg × 5" },
    ]);
    assert.deepEqual(recentSessionRows(result.get("plank")!), [{ id: "s4", started_at: at(9), completedSets: 1, topSet: "45s timed" }]);
    assert.deepEqual(storedIdsOf("bench_press"), ["bench_press", "free-exercise-db-Barbell_Bench_Press_-_Medium_Grip"]);
    assert.deepEqual(storedIdsOf("free-exercise-db-Pushups"), ["push_up", "free-exercise-db-Pushups"]);
    assert.deepEqual(storedIdsOf("plank"), ["plank", "free-exercise-db-Plank"]);
    assert.deepEqual(storedIdsOf("lateral_raise").length, 2);
    assert.deepEqual(storedIdsOf("dead_bug"), ["dead_bug"]);
  });
});

describe("loadExerciseHistory", () => {
  const selectOf = (call: StubCall) => String(call.ops.find((op) => op.method === "select")?.args[0] ?? "");
  const handler = (call: StubCall) => {
    if (call.name === "workout_session_exercises") return { data: [{ id: "r1", session_id: "s1", exercise_id: "bench_press", exercise_name: "Bench", target_duration_seconds: null }, { id: "r9", session_id: "live", exercise_id: "bench_press", exercise_name: "Bench", target_duration_seconds: null }] };
    if (call.name === "workout_sessions") return { data: [{ id: "s1", name: "Push", status: "completed", started_at: at(5), completed_at: at(5, 50) }] };
    if (call.name === "workout_sets") return { data: [{ session_exercise_id: "r1", set_number: 1, reps: 8, weight_kg: 80, duration_seconds: null, completed_at: at(5, 10) }] };
    return undefined;
  };

  test("three plain requests: the exercise's rows (merged duplicates too), completed sessions, ticked sets", async () => {
    const stub = new StubDb(handler);
    const result = await loadExerciseHistory(db(stub), "user-1", "bench_press", { sessions: 8, excludeSessionId: "live" });
    assert.equal(result.error, null);
    assert.deepEqual(result.byExercise.get("bench_press")!.map((item) => item.sessionId), ["s1"]);
    const rowsCall = stub.callsTo("workout_session_exercises")[0];
    assert.ok(used(rowsCall, "in", "exercise_id", ["bench_press", "free-exercise-db-Barbell_Bench_Press_-_Medium_Grip"]));
    assert.ok(used(rowsCall, "order", "created_at", { ascending: false }));
    assert.ok(used(rowsCall, "order", "id", { ascending: false }), "a stable order, so pages do not overlap");
    assert.ok(used(rowsCall, "range", 0, 19));
    assert.equal(result.truncated, false);
    assert.equal(stub.callsTo("workout_session_exercises").length, 1, "a short page is the last one");
    const sessionCall = stub.callsTo("workout_sessions")[0];
    assert.ok(used(sessionCall, "eq", "status", "completed"));
    assert.ok(used(sessionCall, "in", "id", ["s1"]), "the session in progress is not read");
    assert.ok(used(stub.callsTo("workout_sets")[0], "not", "completed_at", "is", null));
    assert.ok(used(stub.callsTo("workout_sets")[0], "in", "session_exercise_id", ["r1"]));
  });

  test("several exercises at once, one request each for their rows; nothing asked, nothing read", async () => {
    const stub = new StubDb(handler);
    const result = await loadExerciseHistory(db(stub), "user-1", ["bench_press", "free-exercise-db-Pushups", "bench_press"]);
    assert.deepEqual([...result.byExercise.keys()], ["bench_press", "push_up"]);
    assert.equal(stub.callsTo("workout_session_exercises").length, 2);
    const none = new StubDb(handler);
    assert.deepEqual(await loadExerciseHistory(db(none), "user-1", []), { error: null, byExercise: new Map(), truncated: false });
    assert.equal(none.calls.length, 0);
  });

  test("a database without the timed-sets columns is read without them; other failures are returned", async () => {
    const stub = new StubDb((call) => {
      if (selectOf(call).includes("duration_seconds")) return { error: { code: "42703", message: `column ${call.name}.${call.name === "workout_sets" ? "duration_seconds" : "target_duration_seconds"} does not exist` } };
      return handler(call);
    });
    const result = await loadExerciseHistory(db(stub), "user-1", "bench_press");
    assert.equal(result.error, null);
    assert.equal(result.byExercise.get("bench_press")?.[0].sets[0].durationSeconds, null);
    const failure = { code: "57014", message: "timeout" };
    const failed = await loadExerciseHistory(db(new StubDb(() => ({ error: failure }))), "user-1", "bench_press");
    assert.deepEqual([failed.error, failed.byExercise.size], [failure, 0]);
  });

  // A member's rows for one exercise, newest first: `counted` of every `every` rows is a completed session with
  // a ticked set; the rest are abandoned sessions. Pages are answered from the range asked for.
  const pagedHistory = (total: number, every: number) => new StubDb((call) => {
    const rangeOp = call.ops.find((op) => op.method === "range");
    if (call.name === "workout_session_exercises") {
      const [from, to] = (rangeOp?.args ?? [0, 0]) as [number, number];
      const rows = Array.from({ length: total }, (_, index) => ({ id: `r${index}`, session_id: `s${index}`, exercise_id: "bench_press", exercise_name: "Bench", target_duration_seconds: null }));
      return { data: rows.slice(from, to + 1) };
    }
    const inOp = call.ops.find((op) => op.method === "in");
    const ids = (inOp?.args[1] ?? []) as string[];
    const index = (id: string) => Number(id.slice(1));
    if (call.name === "workout_sessions") {
      return { data: ids.filter((id) => index(id) % every === 0).map((id) => ({ id, name: "Push", status: "completed", started_at: new Date(Date.UTC(2026, 9, 1) - index(id) * 3_600_000).toISOString(), completed_at: at(1, 50) })) };
    }
    if (call.name === "workout_sets") {
      return { data: ids.map((id) => ({ session_exercise_id: id, set_number: 1, reps: 8, weight_kg: 80, duration_seconds: null, completed_at: at(1, 10) })) };
    }
    return undefined;
  });

  test("reads older pages of rows while too few sessions count, so a short history is the whole history", async () => {
    // 40 sessions wanted, 84 rows a page; only every third row is a completed session: 28 on the first page.
    const stub = pagedHistory(300, 3);
    const result = await loadExerciseHistory(db(stub), "user-1", "bench_press", { sessions: 40 });
    assert.equal(result.error, null);
    assert.equal(result.byExercise.get("bench_press")!.length, 40);
    assert.equal(result.truncated, false);
    const pages = stub.callsTo("workout_session_exercises");
    assert.equal(pages.length, 2);
    assert.ok(used(pages[1], "range", 84, 167));
    const secondIds = stub.callsTo("workout_sessions")[1].ops.find((op) => op.method === "in")!.args[1] as string[];
    assert.deepEqual([secondIds[0], secondIds.length], ["s84", 84], "only the new page's sessions are read");
    assert.deepEqual(result.byExercise.get("bench_press")!.slice(0, 2).map((item) => item.sessionId), ["s0", "s3"], "newest first");
  });

  test("rows that run out end the read with every counted session, not truncated", async () => {
    const stub = pagedHistory(100, 3);
    const result = await loadExerciseHistory(db(stub), "user-1", "bench_press", { sessions: 40 });
    assert.equal(result.byExercise.get("bench_press")!.length, 34);
    assert.equal(result.truncated, false);
    assert.equal(stub.callsTo("workout_session_exercises").length, 2);
  });

  test("a read that reaches the page cap first says it is truncated", async () => {
    const stub = pagedHistory(5000, 50);
    const result = await loadExerciseHistory(db(stub), "user-1", "bench_press", { sessions: 40 });
    assert.equal(stub.callsTo("workout_session_exercises").length, MAX_ROW_PAGES);
    assert.equal(result.byExercise.get("bench_press")!.length, 9, "rows 0 to 419, every 50th");
    assert.equal(result.truncated, true);
  });

  test("the exercise page: recent sessions, or none when they cannot be read", async () => {
    assert.deepEqual(await loadRecentSessions(db(new StubDb(handler)), "user-1", "bench_press"), [{ id: "s1", started_at: at(5), completedSets: 1, topSet: "80 kg × 8" }]);
    assert.deepEqual(await loadRecentSessions(db(new StubDb(() => ({ error: { code: "500", message: "x" } }))), "user-1", "bench_press"), []);
  });
});

describe("loadExerciseDetail", () => {
  test("found, missing or failed, with the text trimmed and the pinned photos when the media table is missing", async () => {
    const row = {
      id: "push_up", name: "Push-Up", primary_muscle: "chest", secondary_muscles: ["triceps"], equipment: [], locations: ["gym", "home"], difficulty: "beginner",
      movement_pattern: "horizontal_push", recommended_sets: 3, reps_min: 8, reps_max: 15, rest_seconds: 60, alternatives: [], description: "  A press. ",
      instructions: [" Step one. ", "", "Step two."], attribution: " ", category: "strength", mechanic: "compound", muscle_group: "chest", required_equipment: [],
      prescription_type: "reps", default_duration_seconds: null, source_ref: "Pushups", catalog_version: 1,
    };
    const found = await loadExerciseDetail(db(new StubDb((call) => (call.name === "exercise_library" ? { data: row } : { error: { code: "PGRST205", message: "missing table" } }))), "push_up", "https://example.supabase.co");
    assert.equal(found.status, "found");
    if (found.status !== "found") return;
    assert.equal(found.detail.exercise.name, "Push-Up");
    assert.equal(found.detail.description, "A press.");
    assert.deepEqual(found.detail.instructions, ["Step one.", "Step two."]);
    assert.equal(found.detail.attribution, null);
    assert.equal(found.detail.media.origin, "pinned");
    assert.equal(found.detail.media.stills.length, 2);
    assert.deepEqual(await loadExerciseDetail(db(new StubDb(() => ({ data: null }))), "nope", null), { status: "missing" });
    const failure = { code: "500", message: "down" };
    assert.deepEqual(await loadExerciseDetail(db(new StubDb((call) => (call.name === "exercise_library" ? { error: failure } : { data: [] }))), "x", null), { status: "error", error: failure });
  });
});
