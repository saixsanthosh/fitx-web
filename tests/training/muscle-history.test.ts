// The muscle-training counting rule (contract C3): pure summaries, the PostgREST loader against databases with
// and without embedding or the timed-sets columns, and the AI coach's record of recently trained muscles.
import "../ai/support/hooks.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { StubDb, used, type StubCall } from "../home/support/stub-db";
import { BODY_REGIONS, loadShare } from "@/lib/training/anatomy";
import {
  MUSCLE_PERIODS, MUSCLE_PERIOD_LABELS, isCountedSession, isCountedSet, loadLibraryMuscles, loadMuscleHistory, musclePeriodRange, parseMusclePeriod,
  regionsTrained, summariseMusclePeriods, summariseMuscles, weeklyRegionSets,
  type LibraryMuscles, type LoggedExercise, type LoggedSession, type LoggedSet,
} from "@/lib/training/muscle-history";

const { loadContextSources } = await import("@/lib/ai/context");

const db = (stub: StubDb) => stub as unknown as SupabaseClient;
const iso = (year: number, month: number, day: number, hour = 12, minute = 0) => new Date(year, month - 1, day, hour, minute).toISOString();
// Wednesday 18 November 2026, 15:00 local time.
const NOW = new Date(2026, 10, 18, 15);

const BENCH: LibraryMuscles = { id: "bench_press", name: "Barbell Bench Press", primary_muscle: "chest", secondary_muscles: ["triceps", "front_deltoids"] };
const PLANK: LibraryMuscles = { id: "plank", name: "Front Plank", primary_muscle: "abdominals", secondary_muscles: ["shoulders", "glutes"] };
const PULL_UP: LibraryMuscles = { id: "pull_up", name: "Pull-Up", primary_muscle: "lats", secondary_muscles: ["biceps", "core"] };
const JUMPING_JACK: LibraryMuscles = { id: "jumping_jack", name: "Jumping Jack", primary_muscle: "cardio", secondary_muscles: ["calves", "shoulders"] };
const ROWER: LibraryMuscles = { id: "rowing_machine", name: "Rowing, Stationary", primary_muscle: "cardio", secondary_muscles: [] };
const SQUAT: LibraryMuscles = { id: "barbell_back_squat", name: "Barbell Back Squat", primary_muscle: "quadriceps", secondary_muscles: ["glutes", "hamstrings", "core"] };

const lift = (at: string | null, reps: number | null = 8, weight = 60): LoggedSet => ({ reps, weight_kg: weight, duration_seconds: null, completed_at: at });
const hold = (at: string | null, seconds: number): LoggedSet => ({ reps: null, weight_kg: 0, duration_seconds: seconds, completed_at: at });
let rowId = 0;
const exercise = (library: LibraryMuscles | null, sets: LoggedSet[], extra: Partial<LoggedExercise> = {}): LoggedExercise => ({
  id: `row-${++rowId}`, exercise_id: library?.id ?? null, name: library?.name ?? "Custom", target_duration_seconds: null, library, sets, ...extra,
});
const session = (id: string, status: string, startedAt: string, exercises: LoggedExercise[]): LoggedSession =>
  ({ id, name: `Session ${id}`, status, started_at: startedAt, completed_at: status === "completed" ? startedAt : null, exercises });

const MONDAY = (hour: number) => iso(2026, 11, 16, hour);
const TODAY = (hour: number) => iso(2026, 11, 18, hour);
const fixture = (): LoggedSession[] => [
  session("A", "completed", MONDAY(9), [
    // 3 counted sets; an unticked set and a ticked set with no reps do not count.
    exercise(BENCH, [lift(MONDAY(9)), lift(MONDAY(9)), lift(MONDAY(10)), lift(null), lift(MONDAY(10), 0)]),
    exercise(PLANK, [hold(MONDAY(10), 45), hold(MONDAY(10), 40)], { target_duration_seconds: 45 }),
    exercise(null, [lift(MONDAY(10)), lift(MONDAY(10))], { name: "Farmer carry with shopping bags" }),
  ]),
  session("B", "abandoned", MONDAY(18), [exercise(SQUAT, [lift(MONDAY(18)), lift(MONDAY(18)), lift(MONDAY(18))])]),
  session("C", "in_progress", TODAY(14), [exercise(SQUAT, [lift(TODAY(14))])]),
  session("D", "completed", TODAY(7), [
    exercise(PULL_UP, [lift(TODAY(7), 6, 0), lift(TODAY(7), 6, 0), lift(TODAY(8), 5, 0), lift(TODAY(8), 5, 0)]),
    exercise(null, [lift(TODAY(8))], { exercise_id: "removed_exercise", name: "Old Machine Press" }),
    exercise(JUMPING_JACK, [hold(TODAY(8), 60)]),
    exercise(ROWER, [hold(TODAY(8), 300)]),
  ]),
];

describe("the counting rule", () => {
  test("a set counts when ticked with reps or seconds; a session only when completed", () => {
    assert.equal(isCountedSet(lift(TODAY(9))), true);
    assert.equal(isCountedSet(hold(TODAY(9), 30)), true);
    assert.equal(isCountedSet(lift(null)), false, "not ticked");
    assert.equal(isCountedSet(lift(TODAY(9), 0)), false, "no reps, no seconds");
    assert.equal(isCountedSet({ reps: null, completed_at: TODAY(9) }), false, "a database without the seconds column");
    assert.equal(isCountedSet({ reps: 5, completed_at: "not a date" }), false);
    assert.equal(isCountedSession({ status: "completed" }), true);
    for (const status of ["abandoned", "in_progress", "", null, undefined]) assert.equal(isCountedSession({ status }), false, String(status));
  });

  test("periods on the local calendar, weeks from Monday", () => {
    assert.deepEqual([...MUSCLE_PERIODS], ["today", "week", "four_weeks", "all"]);
    assert.equal(MUSCLE_PERIOD_LABELS.four_weeks, "Last 4 weeks");
    assert.deepEqual(musclePeriodRange("today", NOW), { start: new Date(2026, 10, 18), end: new Date(2026, 10, 19) });
    assert.deepEqual(musclePeriodRange("week", NOW), { start: new Date(2026, 10, 16), end: new Date(2026, 10, 23) });
    assert.deepEqual(musclePeriodRange("four_weeks", NOW), { start: new Date(2026, 9, 26), end: new Date(2026, 10, 23) });
    assert.deepEqual(musclePeriodRange("all", NOW), { start: null, end: null });
    assert.deepEqual(musclePeriodRange("week", new Date(2026, 10, 22, 23, 59)).start, new Date(2026, 10, 16), "Sunday is the week's last day");
    assert.equal(parseMusclePeriod("today"), "today");
    assert.equal(parseMusclePeriod("month"), "week");
    assert.equal(parseMusclePeriod(null, "all"), "all");
  });
});

describe("summariseMuscles", () => {
  test("direct and assisting sets, weighted load, share and heat, from completed sets of completed sessions only", () => {
    const summary = summariseMuscles(fixture());
    const regions = summary.regions;
    assert.deepEqual([regions.chest.primarySets, regions.chest.secondarySets], [3, 0]);
    assert.deepEqual([regions.triceps.primarySets, regions.triceps.secondarySets], [0, 3]);
    assert.deepEqual([regions.shoulders.primarySets, regions.shoulders.secondarySets], [0, 6], "bench (front_deltoids), plank and jumping jack");
    assert.deepEqual([regions.abdominals.primarySets, regions.abdominals.secondarySets], [2, 4], "plank direct, the pull-up's core assists");
    assert.deepEqual([regions.lats.primarySets, regions.biceps.secondarySets, regions.glutes.secondarySets, regions.calves.secondarySets], [4, 4, 2, 1]);
    assert.deepEqual([regions.quadriceps.primarySets, regions.hamstrings.secondarySets], [0, 0], "abandoned and in-progress squats never count");
    assert.equal(regions.chest.load, 3);
    assert.equal(regions.triceps.load, 1.5);
    assert.equal(regions.abdominals.load, 4);
    const total = BODY_REGIONS.reduce((sum, key) => sum + regions[key].load, 0);
    assert.equal(total, 19);
    assert.ok(Math.abs(regions.chest.share - (3 * 100) / 19) < 1e-9);
    assert.deepEqual(BODY_REGIONS.map((key) => regions[key].share), BODY_REGIONS.map((key) => loadShare(Object.fromEntries(BODY_REGIONS.map((region) => [region, regions[region].load])))[key]));
    assert.equal(regions.lats.level, 1);
    assert.equal(regions.chest.level, 0.75);
    assert.deepEqual(summary.ranked.map((history) => history.region), ["lats", "abdominals", "shoulders", "chest", "biceps", "triceps", "glutes", "calves"]);
    assert.equal(summary.sets, 14);
    assert.equal(summary.mappedSets, 10);
    assert.equal(summary.sessions, 2);
    assert.deepEqual(summary.days, ["2026-11-16", "2026-11-18"]);
    assert.equal(summary.start, null);
  });

  test("exercises that map to no muscle are reported, never guessed", () => {
    const { unmapped } = summariseMuscles(fixture());
    assert.equal(unmapped.sets, 4);
    assert.deepEqual(unmapped.exercises.map((item) => [item.name, item.sets, item.reason]), [
      ["Farmer carry with shopping bags", 2, "not_linked"],
      ["Old Machine Press", 1, "not_in_library"],
      ["Rowing, Stationary", 1, "no_muscles"],
    ]);
    assert.equal(unmapped.exercises.find((item) => item.reason === "not_in_library")?.id, "removed_exercise");
  });

  test("each region lists its exercises and sessions, and when it was last trained", () => {
    const { regions } = summariseMuscles(fixture());
    assert.deepEqual(regions.shoulders.exercises, [
      { id: "bench_press", name: "Barbell Bench Press", sets: 3, role: "secondary" },
      { id: "plank", name: "Front Plank", sets: 2, role: "secondary" },
      { id: "jumping_jack", name: "Jumping Jack", sets: 1, role: "secondary" },
    ]);
    assert.deepEqual(regions.chest.exercises, [{ id: "bench_press", name: "Barbell Bench Press", sets: 3, role: "primary" }]);
    assert.deepEqual(regions.shoulders.sessionList.map((item) => [item.id, item.primarySets, item.secondarySets]), [["D", 0, 1], ["A", 0, 5]]);
    assert.equal(regions.shoulders.sessions, 2);
    assert.equal(regions.chest.lastTrainedOn, "2026-11-16");
    assert.equal(regions.shoulders.lastTrainedOn, "2026-11-18");
    assert.equal(regions.neck.lastTrainedOn, null);
    assert.deepEqual([regions.neck.exercises, regions.neck.sessionList, regions.neck.sessions], [[], [], 0]);
  });

  test("periods: today, this week, the last 4 weeks and all time", () => {
    const sessions = [
      ...fixture(),
      // Last Sunday 23:50: last week. A session that started then but logged a set after midnight: this week.
      session("E", "completed", iso(2026, 11, 15, 23, 50), [exercise(SQUAT, [lift(iso(2026, 11, 15, 23, 55)), lift(iso(2026, 11, 16, 0, 5))])]),
      session("F", "completed", iso(2026, 10, 20, 10), [exercise(SQUAT, [lift(iso(2026, 10, 20, 10))])]),
    ];
    const periods = summariseMusclePeriods(sessions, NOW);
    assert.deepEqual(Object.keys(periods), [...MUSCLE_PERIODS]);
    assert.deepEqual([periods.today.regions.lats.primarySets, periods.today.regions.chest.primarySets, periods.today.sessions], [4, 0, 1]);
    assert.deepEqual([periods.week.regions.quadriceps.primarySets, periods.week.regions.chest.primarySets, periods.week.sessions], [1, 3, 3]);
    assert.deepEqual([periods.four_weeks.regions.quadriceps.primarySets, periods.four_weeks.sessions], [2, 3]);
    assert.deepEqual([periods.all.regions.quadriceps.primarySets, periods.all.sessions], [3, 4]);
    assert.equal(periods.week.start, new Date(2026, 10, 16).toISOString());
    assert.equal(periods.today.regions.quadriceps.lastTrainedOn, null);
    assert.equal(periods.all.regions.quadriceps.lastTrainedOn, "2026-11-16");
  });

  test("nothing logged: every region at zero and an empty report", () => {
    for (const sessions of [[], [session("X", "abandoned", TODAY(9), [exercise(BENCH, [lift(TODAY(9))])])]]) {
      const summary = summariseMuscles(sessions);
      assert.ok(BODY_REGIONS.every((key) => summary.regions[key].load === 0 && summary.regions[key].share === 0 && summary.regions[key].level === 0));
      assert.deepEqual([summary.ranked, summary.sets, summary.sessions, summary.days, summary.unmapped], [[], 0, 0, [], { sets: 0, exercises: [] }]);
    }
  });

  test("regionsTrained lists direct work first; weekly sets go to their Monday week", () => {
    const summary = summariseMuscles(fixture());
    assert.deepEqual(regionsTrained(summary), ["lats", "chest", "abdominals"]);
    assert.deepEqual(regionsTrained(summary, { includeAssisting: true }), ["lats", "chest", "abdominals", "shoulders", "biceps", "triceps", "glutes", "calves"]);
    const weeks = weeklyRegionSets([...fixture(), session("G", "completed", iso(2026, 11, 10, 9), [exercise(BENCH, [lift(iso(2026, 11, 10, 9))])])], { weeks: 3, now: NOW });
    assert.deepEqual(weeks.map((week) => week.weekStart), ["2026-11-02", "2026-11-09", "2026-11-16"]);
    assert.deepEqual(weeks.map((week) => week.regions.chest.primarySets), [0, 1, 3]);
    assert.deepEqual(weeks.map((week) => week.regions.triceps.secondarySets), [0, 1, 3]);
  });
});

// ---------------------------------------------------------------- the loader

type Rows = Record<string, unknown[]>;
const SESSION_ROW = (id: string, startedAt: string, exercises: unknown[]) => ({ id, name: `Session ${id}`, status: "completed", started_at: startedAt, completed_at: startedAt, workout_session_exercises: exercises });
const rangeOf = (call: StubCall) => (call.ops.find((op) => op.method === "range")?.args as [number, number] | undefined) ?? [0, 999];
const inOf = (call: StubCall) => (call.ops.find((op) => op.method === "in")?.args[1] as string[] | undefined) ?? [];
const selectOf = (call: StubCall) => String(call.ops.find((op) => op.method === "select")?.args[0] ?? "");

function libraryAnswer(call: StubCall, library: LibraryMuscles[]) {
  const ids = new Set(inOf(call));
  return { data: library.filter((row) => ids.has(row.id)) };
}

describe("loadMuscleHistory", () => {
  test("one embedded request per page of sessions, then the library by surviving id", async () => {
    const sessions = [
      SESSION_ROW("s2", TODAY(7), [{ id: "e3", exercise_id: "free-exercise-db-Pushups", exercise_name: "Pushups", target_duration_seconds: null, workout_sets: [{ set_number: 2, reps: 10, weight_kg: "0", duration_seconds: null, completed_at: TODAY(7) }, { set_number: 1, reps: 12, weight_kg: 0, duration_seconds: null, completed_at: TODAY(7) }] }]),
      SESSION_ROW("s1", MONDAY(9), [{ id: "e1", exercise_id: "bench_press", exercise_name: "Bench", target_duration_seconds: null, workout_sets: [{ set_number: 1, reps: 8, weight_kg: "62.5", duration_seconds: null, completed_at: MONDAY(9) }] }, { id: "e2", exercise_id: null, exercise_name: "Custom", workout_sets: [] }]),
    ];
    const pushUp: LibraryMuscles = { id: "push_up", name: "Push-Up", primary_muscle: "chest", secondary_muscles: ["triceps", "front_deltoids", "core"] };
    const stub = new StubDb((call) => {
      if (call.name === "workout_sessions") { const [from, to] = rangeOf(call); return { data: sessions.slice(from, to + 1) }; }
      if (call.name === "exercise_library") return libraryAnswer(call, [BENCH, pushUp]);
      return undefined;
    });
    const result = await loadMuscleHistory(db(stub), "user-1", { since: new Date(2026, 10, 16) });
    assert.equal(result.error, null);
    assert.equal(result.truncated, false);
    assert.deepEqual(result.sessions.map((item) => item.id), ["s2", "s1"]);
    const [first, second] = result.sessions;
    assert.deepEqual(first.exercises[0].sets.map((set) => [set.set_number, set.reps]), [[1, 12], [2, 10]], "sets in order, numbers as numbers");
    assert.equal(first.exercises[0].library?.id, "push_up", "a merged duplicate counts as its survivor");
    assert.equal(second.exercises[0].sets[0].weight_kg, 62.5);
    assert.equal(second.exercises[0].library?.id, "bench_press");
    assert.equal(second.exercises[1].library, null);
    const sessionCall = stub.callsTo("workout_sessions")[0];
    assert.ok(used(sessionCall, "eq", "status", "completed"));
    assert.ok(used(sessionCall, "eq", "user_id", "user-1"));
    assert.ok(used(sessionCall, "gte", "started_at", new Date(2026, 10, 15).toISOString()), "from a day before the window");
    assert.match(selectOf(sessionCall), /workout_session_exercises\(id,exercise_id,exercise_name,target_duration_seconds,workout_sets\(set_number,reps,weight_kg,duration_seconds,completed_at\)\)/);
    assert.deepEqual(inOf(stub.callsTo("exercise_library")[0]).sort(), ["bench_press", "push_up"]);
    assert.deepEqual(summariseMuscles(result.sessions).regions.chest.primarySets, 3);
  });

  test("pages through sessions and says when it stopped early", async () => {
    const sessions = Array.from({ length: 120 }, (_, index) => SESSION_ROW(`s${index}`, TODAY(7), []));
    const stub = new StubDb((call) => {
      if (call.name === "workout_sessions") { const [from, to] = rangeOf(call); return { data: sessions.slice(from, to + 1) }; }
      return { data: [] };
    });
    const all = await loadMuscleHistory(db(stub), "user-1");
    assert.equal(all.sessions.length, 120);
    assert.equal(all.truncated, false);
    assert.deepEqual(stub.callsTo("workout_sessions").map(rangeOf), [[0, 49], [50, 99], [100, 149]]);
    const capped = await loadMuscleHistory(db(new StubDb((call) => (call.name === "workout_sessions" ? { data: sessions.slice(rangeOf(call)[0], rangeOf(call)[1] + 1) } : { data: [] }))), "user-1", { maxSessions: 60 });
    assert.equal(capped.sessions.length, 60);
    assert.equal(capped.truncated, true);
  });

  test("a database without the timed-sets columns is read without them", async () => {
    const stub = new StubDb((call) => {
      if (call.name !== "workout_sessions") return { data: [] };
      if (selectOf(call).includes("duration_seconds")) return { error: { code: "42703", message: "column workout_sets_1.duration_seconds does not exist" } };
      return { data: [SESSION_ROW("s1", TODAY(7), [{ id: "e1", exercise_id: null, exercise_name: "Custom", workout_sets: [{ set_number: 1, reps: 8, weight_kg: 0, completed_at: TODAY(7) }] }])] };
    });
    const result = await loadMuscleHistory(db(stub), "user-1");
    assert.equal(result.error, null);
    assert.equal(result.sessions[0].exercises[0].sets[0].duration_seconds, null);
    assert.equal(result.sessions[0].exercises[0].target_duration_seconds, null);
    assert.equal(stub.callsTo("workout_sessions").length, 2);
  });

  test("when embedding fails it reads sessions, exercises and sets separately", async () => {
    const stub = new StubDb((call) => {
      if (call.name === "workout_sessions") {
        if (selectOf(call).includes("(")) return { error: { code: "PGRST200", message: "Could not find a relationship" } };
        return { data: [{ id: "s1", name: "Push", status: "completed", started_at: TODAY(7), completed_at: TODAY(8) }] };
      }
      if (call.name === "workout_session_exercises") return { data: [{ id: "e1", session_id: "s1", exercise_id: "bench_press", exercise_name: "Bench" }] };
      if (call.name === "workout_sets") return { data: [{ session_exercise_id: "e1", set_number: 1, reps: 8, weight_kg: 60, duration_seconds: null, completed_at: TODAY(7) }] };
      if (call.name === "exercise_library") return libraryAnswer(call, [BENCH]);
      return undefined;
    });
    const result = await loadMuscleHistory(db(stub), "user-1");
    assert.equal(result.error, null);
    assert.equal(summariseMuscles(result.sessions).regions.chest.primarySets, 1);
    assert.ok(used(stub.callsTo("workout_session_exercises")[0], "in", "session_id", ["s1"]));
    assert.ok(used(stub.callsTo("workout_sets")[0], "not", "completed_at", "is", null));
  });

  test("any other failure is returned, with no sessions", async () => {
    const failure = { code: "57014", message: "canceling statement due to statement timeout" };
    const result = await loadMuscleHistory(db(new StubDb(() => ({ error: failure }))), "user-1");
    assert.deepEqual(result, { error: failure, sessions: [], truncated: false });
    const library = await loadLibraryMuscles(db(new StubDb(() => ({ error: failure }))), ["bench_press"]);
    assert.equal(library.error, failure);
    assert.deepEqual(await loadLibraryMuscles(db(new StubDb(() => undefined)), [null, ""]), { error: null, rows: new Map() });
  });
});

// ---------------------------------------------------------------- the AI coach's record

describe("the coach's recent muscles follow the same rule", () => {
  const COACH_NOW = new Date("2026-11-18T12:00:00Z");
  const rows: Rows = {
    workout_sessions: [
      { id: "done", started_at: "2026-11-17T08:00:00Z", status: "completed", duration_seconds: 2400, total_volume: 1000 },
      { id: "quit", started_at: "2026-11-16T08:00:00Z", status: "abandoned", duration_seconds: 300, total_volume: 0 },
      { id: "old", started_at: "2026-11-02T08:00:00Z", status: "completed", duration_seconds: 2400, total_volume: 1000 },
    ],
    workout_session_exercises: [
      { id: "a", session_id: "done", exercise_id: "barbell_back_squat", exercise_name: "Squat", workout_sets: [{ reps: 5, duration_seconds: null, completed_at: "2026-11-17T08:10:00Z" }, { reps: 5, duration_seconds: null, completed_at: "2026-11-17T08:15:00Z" }] },
      // In a finished workout but never ticked: it does not count.
      { id: "b", session_id: "done", exercise_id: "bench_press", exercise_name: "Bench", workout_sets: [{ reps: 8, duration_seconds: null, completed_at: null }] },
      { id: "c", session_id: "done", exercise_id: "plank", exercise_name: "Plank", workout_sets: [{ reps: null, duration_seconds: 45, completed_at: "2026-11-17T08:30:00Z" }] },
      { id: "d", session_id: "quit", exercise_id: "pull_up", exercise_name: "Pull-Up", workout_sets: [{ reps: 6, duration_seconds: null, completed_at: "2026-11-16T08:10:00Z" }] },
    ],
  };
  const handler = (call: StubCall) => {
    if (call.name === "exercise_library") return libraryAnswer(call, [SQUAT, BENCH, PLANK, PULL_UP]);
    if (call.name === "workout_session_exercises") {
      const ids = new Set(inOf(call));
      const withSeconds = selectOf(call).includes("duration_seconds");
      type Row = { session_id: string; workout_sets: Array<Record<string, unknown>> };
      return {
        data: (rows.workout_session_exercises as Row[]).filter((row) => ids.has(row.session_id))
          // An older database has no seconds column, so the answer has none either.
          .map((row) => ({ ...row, workout_sets: row.workout_sets.map(({ duration_seconds, ...set }) => (withSeconds ? { ...set, duration_seconds } : set)) })),
      };
    }
    if (call.name === "profiles" || call.name === "user_preferences") return { data: null };
    return { data: rows[call.name] ?? [] };
  };

  test("only ticked sets of completed sessions in the last 7 days, most direct sets first", async () => {
    const stub = new StubDb(handler);
    const sources = await loadContextSources(db(stub), "user-1", COACH_NOW);
    assert.deepEqual(sources.recentMuscles, ["quadriceps", "abdominals"]);
    const exerciseCalls = stub.callsTo("workout_session_exercises");
    assert.equal(exerciseCalls.length, 1);
    assert.deepEqual(inOf(exerciseCalls[0]), ["done"], "abandoned and older sessions are not read");
    assert.match(selectOf(exerciseCalls[0]), /workout_sets\(reps, duration_seconds, completed_at\)/);
  });

  test("before the timed-sets migration, and when there is nothing to read", async () => {
    const older = new StubDb((call) => (call.name === "workout_session_exercises" && selectOf(call).includes("duration_seconds")
      ? { error: { code: "42703", message: "column workout_sets_1.duration_seconds does not exist" } }
      : handler(call)));
    assert.deepEqual((await loadContextSources(db(older), "user-1", COACH_NOW)).recentMuscles, ["quadriceps"], "the timed plank has no seconds column to count");
    const empty = new StubDb((call) => (call.name === "workout_sessions" ? { data: [] } : handler(call)));
    assert.deepEqual((await loadContextSources(db(empty), "user-1", COACH_NOW)).recentMuscles, []);
    assert.equal(empty.callsTo("workout_session_exercises").length, 0);
    const failing = new StubDb((call) => (call.name === "exercise_library" ? { error: { code: "500", message: "boom" } } : handler(call)));
    assert.deepEqual((await loadContextSources(db(failing), "user-1", COACH_NOW)).recentMuscles, [], "no muscles rather than wrong ones");
  });
});
