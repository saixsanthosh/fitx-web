// Bug 17, review round (workouts-r1, workouts-r7): which programme days a check touches and what it writes, through
// a stand-in database. A day with a finished or running workout is never touched; a day left with nothing the list
// allows is kept and reported; a changed day is saved with its date, title, split, place and notes as they were;
// "Re-plan this day" checks its own day only; the first save that fails stops the run. A check made as a page opens
// leaves alone every day saved after the list was last saved, so an exercise the member put in a day with Edit plan is
// never swapped back behind their back (it was, straight after Save changes, on every load).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogExercise } from "@/lib/training/catalog";
import { expandOwnedEquipment } from "@/lib/training/equipment";
import { replanAfterListSaved, replanUpcomingProgrammeDays, type ReplanMode } from "@/lib/training/programme-replan";
import type { Programme } from "@/lib/training/programmes";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { code: string; message: string } | null };

/** Just the query shapes the check uses; ordering is ignored. `failRpc` makes every save fail. */
class FakeDb {
  tables: Record<string, Row[]>;
  rpcs: Array<{ name: string; args: Row }> = [];
  reads: string[] = [];
  failRpc = false;
  constructor(tables: Record<string, Row[]>) { this.tables = tables; }
  from(table: string) { this.reads.push(table); return new FakeQuery(this, table); }
  rpc(name: string, args: Row) {
    this.rpcs.push({ name, args });
    return Promise.resolve(this.failRpc ? { data: null, error: { code: "08006", message: "connection lost" } } : { data: (args.p_plan as Row).id, error: null });
  }
}

class FakeQuery implements PromiseLike<Result> {
  private filters: Array<(row: Row) => boolean> = [];
  private single = false;
  private db: FakeDb;
  private table: string;
  constructor(db: FakeDb, table: string) { this.db = db; this.table = table; }
  select() { return this; }
  eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this; }
  gte(column: string, value: string) { this.filters.push((row) => typeof row[column] === "string" && (row[column] as string) >= value); return this; }
  lt(column: string, value: string) { this.filters.push((row) => typeof row[column] === "string" && (row[column] as string) < value); return this; }
  in(column: string, values: unknown[]) { this.filters.push((row) => values.includes(row[column])); return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() { this.single = true; return this; }
  then<A, B = never>(resolve?: ((value: Result) => A | PromiseLike<A>) | null, reject?: ((reason: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve().then(() => this.run()).then(resolve, reject);
  }
  private run(): Result {
    const rows = (this.db.tables[this.table] ?? []).filter((row) => this.filters.every((keep) => keep(row))).map((row) => ({ ...row }));
    return { data: this.single ? rows[0] ?? null : rows, error: null };
  }
}

const exercise = (id: string, extra: Partial<CatalogExercise> = {}): CatalogExercise => ({
  id, name: id, primary_muscle: "chest", secondary_muscles: [], muscle_group: "chest", category: "strength", mechanic: "compound", required_equipment: [],
  locations: ["gym", "home"], difficulty: "beginner", movement_pattern: "push", prescription_type: "reps", recommended_sets: 3, reps_min: 8, reps_max: 12,
  rest_seconds: 90, default_duration_seconds: null, alternatives: [], source_ref: null, curated: true, ...extra,
});
const catalog = [
  exercise("db_press", { required_equipment: ["dumbbell"] }),
  exercise("push_up"),
  exercise("bb_curl", { muscle_group: "biceps", primary_muscle: "biceps", required_equipment: ["barbell"] }),
  exercise("db_curl", { muscle_group: "biceps", primary_muscle: "biceps", required_equipment: ["dumbbell"] }),
];
const PUSH_SLOTS = [{ muscle: "chest", sets: 3, reps: [8, 12], rest: 90 }];
const ARMS_SLOTS = [{ muscle: "biceps", sets: 3, reps: [10, 12], rest: 60 }];
const programme = {
  id: "test-two-day", title: "Push and arms · test", summary: "", context: "gym", split: "custom", level: "beginner", daysPerWeek: 2,
  defaultWeekdays: [1, 4], sessionMinutes: 45, builtAround: [], isPremium: false, sourceNotes: "",
  days: [{ key: "push", title: "Push", focus: ["chest"], slots: PUSH_SLOTS }, { key: "arms", title: "Arms", focus: ["biceps"], slots: ARMS_SLOTS }],
} as unknown as Programme;

const ME = "member-1";
const TODAY = "2026-11-26";
/** When the gym list was last saved, as user_equipment_profiles.updated_at says. */
const LIST_SAVED = "2026-11-26T09:00:00.000Z";
const BEFORE_LIST = "2026-11-25T08:00:00.000Z";
const AFTER_LIST = "2026-11-26T09:30:00.000Z";
const TITLES = ["Push · Push and arms", "Arms · Push and arms"];

const day = (id: string, planned_for: string, dayIndex: number, updated_at = BEFORE_LIST, extra: Row = {}): Row => ({
  id, user_id: ME, programme_enrolment_id: "enrolment-1", title: TITLES[dayIndex], split: "custom", workout_location: "gym", planned_for,
  notes: `Push and arms · test, day ${dayIndex + 1} of 2`, programme_day_index: dayIndex, updated_at, ...extra,
});
const rowsFor = (planId: string, ...ids: string[]): Row[] => ids.map((exercise_id, sort_order) => ({
  id: `${planId}-${sort_order}`, user_id: ME, plan_id: planId, exercise_id, exercise_name: exercise_id, sort_order, target_sets: 3, reps_min: 8, reps_max: 12,
  rest_seconds: 90, target_weight_kg: null, target_duration_seconds: null,
}));

/**
 * Monday's Push still has the dumbbell press the list no longer allows; Tuesday's and Wednesday's have a workout running
 * and done; Thursday's has the member's own dumbbell curl added in Edit plan; Friday's Arms has only a barbell curl, and
 * nothing on a body-weight list trains biceps. Last week's day and another programme's day are not this check's.
 */
function tables(): Record<string, Row[]> {
  return {
    workout_plans: [
      day("mon", "2026-11-30", 0), day("tue", "2026-12-01", 0), day("wed", "2026-12-02", 0), day("thu", "2026-12-03", 0), day("fri", "2026-12-04", 1),
      day("last-week", "2026-11-23", 0), day("other", "2026-11-30", 0, BEFORE_LIST, { programme_enrolment_id: "enrolment-2" }),
    ],
    workout_plan_exercises: [
      ...rowsFor("mon", "db_press"), ...rowsFor("tue", "db_press"), ...rowsFor("wed", "db_press"), ...rowsFor("thu", "push_up", "db_curl"),
      ...rowsFor("fri", "bb_curl"), ...rowsFor("last-week", "db_press"), ...rowsFor("other", "db_press"),
    ],
    workout_sessions: [
      { id: "s1", user_id: ME, plan_id: "tue", status: "in_progress" },
      { id: "s2", user_id: ME, plan_id: "wed", status: "completed" },
      { id: "s3", user_id: ME, plan_id: "mon", status: "abandoned" },
    ],
  };
}

const bodyWeight = expandOwnedEquipment([]);
function run(db: FakeDb, mode: ReplanMode, extra: Partial<Parameters<typeof replanUpcomingProgrammeDays>[1]> = {}) {
  return replanUpcomingProgrammeDays(db as unknown as SupabaseClient, {
    userId: ME, enrolment: { id: "enrolment-1", context: "gym" }, programme, catalog, owned: bodyWeight, level: "beginner",
    recentDays: new Map(), todayKey: TODAY, includeTargets: true, mode, ...extra,
  });
}
const savedIds = (db: FakeDb) => db.rpcs.map((call) => (call.args.p_plan as Row).id);

describe("after a list is saved", () => {
  test("only days not started change, saved with their date, title, split, place and notes as they were", async () => {
    const db = new FakeDb(tables());
    const outcome = await run(db, "list-saved");
    assert.equal(outcome.error, null);
    assert.deepEqual(savedIds(db), ["mon"], "a running or finished day, the member's own addition, last week and another programme are not saved");
    assert.deepEqual(db.rpcs[0], {
      name: "fitx_save_workout_plan",
      args: {
        p_plan: { id: "mon", title: "Push · Push and arms", split: "custom", workout_location: "gym", planned_for: "2026-11-30", notes: "Push and arms · test, day 1 of 2" },
        p_exercises: [{ exercise_id: "push_up", exercise_name: "push_up", target_sets: 3, reps_min: 8, reps_max: 12, rest_seconds: 90, target_weight_kg: null, target_duration_seconds: null }],
      },
    });
    assert.deepEqual(outcome.replanned, [{ planId: "mon", title: "Push · Push and arms", replaced: [{ from: "db_press", to: "push_up" }], dropped: [] }]);
  });

  test("an exercise the member added stays and is named; a day nothing on the list fits is kept and reported, not saved", async () => {
    const db = new FakeDb(tables());
    const outcome = await run(db, "list-saved");
    assert.deepEqual(outcome.kept, [{ planId: "thu", title: "Push · Push and arms", names: ["db_curl"] }]);
    assert.deepEqual(outcome.unfixable, [{ planId: "fri", title: "Arms · Push and arms" }]);
    assert.ok(!savedIds(db).includes("thu") && !savedIds(db).includes("fri"));
  });

  test("a day left with only the member's own additions the list rules out is reported, not saved", async () => {
    const data = tables();
    data.workout_plan_exercises = [...rowsFor("mon", "db_press", "db_curl")];
    data.workout_plans = [day("mon", "2026-11-30", 0)];
    // Nothing on a body-weight list replaces the press without the push-up: only the member's curl would be left.
    const db = new FakeDb(data);
    const outcome = await replanUpcomingProgrammeDays(db as unknown as SupabaseClient, {
      userId: ME, enrolment: { id: "enrolment-1", context: "gym" }, programme, catalog: catalog.filter((item) => item.id !== "push_up"), owned: bodyWeight,
      level: "beginner", todayKey: TODAY, includeTargets: true, mode: "list-saved",
    });
    assert.deepEqual([savedIds(db), outcome.unfixable.map((entry) => entry.planId), outcome.kept.map((entry) => entry.names)], [[], ["mon"], [["db_curl"]]]);
  });

  test("the first save that fails stops the run and is returned", async () => {
    const data = tables();
    data.workout_plans.push(day("sat", "2026-12-05", 0));
    data.workout_plan_exercises.push(...rowsFor("sat", "db_press"));
    const db = new FakeDb(data);
    db.failRpc = true;
    const outcome = await run(db, "list-saved");
    assert.deepEqual(savedIds(db), ["mon"], "Saturday is not tried after Monday failed");
    assert.ok(outcome.error);
    assert.deepEqual(outcome.replanned, []);
  });

  test("recent training is read only when there is a day to check", async () => {
    let reads = 0;
    const recentDays = () => { reads += 1; return Promise.resolve(new Map<string, number>()); };
    const started = tables();
    started.workout_plans = started.workout_plans.filter((entry) => entry.id === "tue" || entry.id === "wed");
    await run(new FakeDb(started), "list-saved", { recentDays });
    assert.equal(reads, 0, "every day has started");
    await run(new FakeDb(tables()), "list-saved", { recentDays });
    assert.equal(reads, 1);
  });
});

describe("as a page opens", () => {
  test("a day the member edited after the list was saved keeps its exercises, even one the list rules out", async () => {
    const data = tables();
    // Edit plan on the next Monday's Push, after the list changed: the member put the dumbbell press back themselves.
    data.workout_plans.push(day("next-mon", "2026-12-07", 0, AFTER_LIST));
    data.workout_plan_exercises.push(...rowsFor("next-mon", "db_press"));
    const db = new FakeDb(data);
    const outcome = await run(db, "visit", { listSavedAt: LIST_SAVED });
    assert.deepEqual(savedIds(db), ["mon"], "only the day planned before the list changed");
    assert.ok(![...outcome.replanned, ...outcome.unfixable, ...outcome.kept].some((entry) => entry.planId === "next-mon"));
    // Opening the page again changes nothing more: Monday was saved after the list by the first check.
    data.workout_plans = data.workout_plans.map((entry) => (entry.id === "mon" ? { ...entry, updated_at: "2026-11-26T09:05:00.000Z" } : entry));
    const again = new FakeDb(data);
    await run(again, "visit", { listSavedAt: LIST_SAVED });
    assert.deepEqual(savedIds(again), []);
  });

  test("with no saved list there is nothing newer to check against: nothing is read", async () => {
    const db = new FakeDb(tables());
    const outcome = await run(db, "visit", { listSavedAt: null });
    assert.deepEqual([db.reads, outcome.replanned, outcome.error], [[], [], null]);
  });
});

describe("Re-plan this day", () => {
  test("checks only that day, and replaces the member's own additions too", async () => {
    const db = new FakeDb(tables());
    const outcome = await run(db, "asked", { onlyPlanId: "thu" });
    assert.deepEqual(savedIds(db), ["thu"]);
    assert.deepEqual(db.rpcs[0].args.p_exercises, [{ exercise_id: "push_up", exercise_name: "push_up", target_sets: 3, reps_min: 8, reps_max: 12, rest_seconds: 90, target_weight_kg: null, target_duration_seconds: null }]);
    assert.deepEqual(outcome.replanned, [{ planId: "thu", title: "Push · Push and arms", replaced: [], dropped: ["db_curl"] }], "nothing on the list replaces the curl, so it is left out");
    assert.deepEqual(outcome.kept, []);
  });

  test("a day that has started is not re-planned", async () => {
    const db = new FakeDb(tables());
    const outcome = await run(db, "asked", { onlyPlanId: "tue" });
    assert.deepEqual([savedIds(db), outcome.replanned], [[], []]);
  });
});

describe("after the exercise library saves a list", () => {
  const enrolment = (extra: Row = {}): Row => ({
    id: "enrolment-1", user_id: ME, programme_id: "test-two-day", context: "gym", status: "active", weekdays: [1, 4], preferred_time: "18:00:00",
    next_day_index: 0, sessions_completed: 0, started_on: "2026-11-23", last_session_at: null, updated_at: BEFORE_LIST, ...extra,
  });
  const programmeRow = {
    id: "test-two-day", title: "Push and arms · test", summary: "", context: "gym", split: "custom", level: "beginner", days_per_week: 2, default_weekdays: [1, 4],
    session_minutes: 45, built_around: [], is_premium: false, source_notes: "",
    training_programme_days: [{ day_index: 0, key: "push", title: "Push", focus: ["chest"], slots: PUSH_SLOTS }, { day_index: 1, key: "arms", title: "Arms", focus: ["biceps"], slots: ARMS_SLOTS }],
  };
  const saved = (data: Record<string, Row[]>, context: "home" | "gym") => {
    const db = new FakeDb(data);
    return { db, outcome: replanAfterListSaved(db as unknown as SupabaseClient, { userId: ME, context, keys: [], catalog, level: "beginner", todayKey: TODAY }) };
  };

  test("the programme the member follows for that place is re-planned for the new list", async () => {
    const { db, outcome } = saved({ ...tables(), programme_enrolments: [enrolment()], training_programmes: [programmeRow], workout_session_exercises: [] }, "gym");
    const result = await outcome;
    assert.deepEqual(result?.replanned.map((entry) => entry.planId), ["mon"]);
    assert.deepEqual(result?.kept.map((entry) => entry.planId), ["thu"], "the member's own addition stays");
    assert.ok(db.reads.includes("workout_session_exercises"), "recent training read for the planner's picks");
  });

  test("nothing to check: a paused programme, one for the other place, or none", async () => {
    for (const [rows, context] of [[[enrolment({ status: "paused" })], "gym"], [[enrolment()], "home"], [[], "gym"]] as const) {
      const { db, outcome } = saved({ ...tables(), programme_enrolments: [...rows], training_programmes: [programmeRow] }, context);
      assert.equal(await outcome, null);
      assert.deepEqual(db.rpcs, []);
      assert.ok(!db.reads.includes("workout_plans"));
    }
  });
});
