import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { datesToSchedule, finishProgramme, leaveProgramme, ownProgrammeItems, pauseProgramme, programmeDayDone, programmeDaysToRemove, resumeProgramme, topUpWindow, upcomingProgrammeDays, type ProgrammePlan } from "@/lib/training/enrolment";

const TODAY = "2026-11-18";
/** A start time in the test's own time zone, as the app writes planner items from the browser. */
const at = (day: string, hour: number) => { const [y, m, d] = day.split("-").map(Number); return new Date(y, m - 1, d, hour).toISOString(); };
const day = (id: string, planned_for: string | null, last_done_key: string | null = null): ProgrammePlan => ({ id, title: id, planned_for, programme_day_index: 0, last_done_key });

test("a programme day is done once any session of it is finished, also one done before its date", () => {
  assert.equal(programmeDayDone(day("wed", "2026-11-18", "2026-11-17")), true, "Wednesday's Pull done on Tuesday");
  assert.equal(programmeDayDone(day("wed", "2026-11-18", "2026-11-18")), true);
  assert.equal(programmeDayDone(day("wed", "2026-11-18")), false);
});

test("upcoming days are today's and later ones not yet done; one done early is not upcoming", () => {
  const plans = [day("mon", "2026-11-16"), day("wed", "2026-11-18"), day("fri", "2026-11-20", "2026-11-17"), day("sun", "2026-11-22"), day("undated", null)];
  assert.deepEqual(upcomingProgrammeDays(plans, TODAY).map((plan) => plan.id), ["wed", "sun"]);
  assert.deepEqual(upcomingProgrammeDays([day("fri", "2026-11-20", "2026-11-17")], TODAY), [], "with the last day done early, the next week can be planned");
});

test("only days nobody started are dropped, and only the items FITX scheduled for them are cancelled", () => {
  const days = [{ id: "wed", planned_for: "2026-11-18" }, { id: "fri", planned_for: "2026-11-20" }, { id: "sun", planned_for: "2026-11-22" }];
  assert.deepEqual(programmeDaysToRemove(days, new Set(["fri"])).map((plan) => plan.id), ["wed", "sun"]);
  const items = [
    { id: "wed-own", workout_plan_id: "wed", starts_at: at("2026-11-18", 18) },
    { id: "wed-todo-thursday", workout_plan_id: "wed", starts_at: at("2026-11-19", 7) },
    { id: "sun-todo-untimed", workout_plan_id: "sun", starts_at: null },
    { id: "sun-own", workout_plan_id: "sun", starts_at: at("2026-11-22", 18) },
    { id: "other-plan", workout_plan_id: "elsewhere", starts_at: at("2026-11-18", 18) },
  ];
  assert.deepEqual(ownProgrammeItems(items, days), ["wed-own", "sun-own"]);
});

test("an item's day is the day it was scheduled on, wherever the phone is when the member leaves", () => {
  // Scheduled from India: Wednesday's own item at 05:00 IST (23:30 UTC on Tuesday), and a To-Do the member
  // linked to that day for Thursday 04:30 IST (23:00 UTC on Wednesday). In London the starts fall a day earlier.
  const days = [{ id: "wed", planned_for: "2026-11-18" }];
  const items = [
    { id: "fitx-own-0500-ist", workout_plan_id: "wed", starts_at: "2026-11-17T23:30:00.000Z", local_date: "2026-11-18" },
    { id: "todo-thu-0430-ist", workout_plan_id: "wed", starts_at: "2026-11-18T23:00:00.000Z", local_date: "2026-11-19" },
  ];
  const zone = process.env.TZ;
  try {
    for (const tz of ["Europe/London", "Asia/Kolkata", "America/Los_Angeles"]) {
      process.env.TZ = tz;
      assert.deepEqual(ownProgrammeItems(items, days), ["fitx-own-0500-ist"], `with the phone in ${tz}`);
    }
  } finally {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  }
});

// ---------------------------------------------------------------- leaving, against a small in-memory database

type Row = Record<string, unknown>;

/**
 * Just the query shapes leaveProgramme uses, with the schema's "on delete set null" plan links.
 * `missingColumns`: columns this database does not have yet; selecting one fails as Postgres does (42703).
 */
class MiniDb {
  tables: Record<string, Row[]>;
  missingColumns: string[];
  constructor(tables: Record<string, Row[]>, missingColumns: string[] = []) { this.tables = tables; this.missingColumns = missingColumns; }
  from(table: string) { return new MiniQuery(this, table); }
}

type MiniResult = { data: Row[] | null; error: { code: string; message: string } | null };

class MiniQuery implements PromiseLike<MiniResult> {
  private op: "select" | "update" | "delete" = "select";
  private payload: Row = {};
  private filters: Array<(row: Row) => boolean> = [];
  private columns: string[] = [];
  private db: MiniDb;
  private table: string;
  constructor(db: MiniDb, table: string) { this.db = db; this.table = table; }
  select(columns = "*") { this.columns = columns.split(",").map((column) => column.trim()); return this; }
  update(payload: Row) { this.op = "update"; this.payload = payload; return this; }
  delete() { this.op = "delete"; return this; }
  eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this; }
  gte(column: string, value: string) { this.filters.push((row) => typeof row[column] === "string" && (row[column] as string) >= value); return this; }
  in(column: string, values: unknown[]) { this.filters.push((row) => values.includes(row[column])); return this; }
  then<A, B = never>(resolve?: ((value: MiniResult) => A | PromiseLike<A>) | null, reject?: ((reason: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve().then(() => this.run()).then(resolve, reject);
  }
  private run(): MiniResult {
    const missing = this.op === "select" ? this.columns.find((column) => this.db.missingColumns.includes(column)) : undefined;
    if (missing) return { data: null, error: { code: "42703", message: `column ${this.table}.${missing} does not exist` } };
    const rows = this.db.tables[this.table];
    const matched = rows.filter((row) => this.filters.every((keep) => keep(row)));
    if (this.op === "update") matched.forEach((row) => Object.assign(row, this.payload));
    if (this.op === "delete") {
      this.db.tables[this.table] = rows.filter((row) => !matched.includes(row));
      if (this.table === "workout_plans") {
        const gone = new Set(matched.map((row) => row.id));
        for (const item of this.db.tables.planner_events) if (gone.has(item.workout_plan_id)) item.workout_plan_id = null;
        for (const session of this.db.tables.workout_sessions) if (gone.has(session.plan_id)) session.plan_id = null;
      }
    }
    return { data: this.op === "select" ? matched.map((row) => ({ ...row })) : null, error: null };
  }
}

test("leaving a programme removes the days not started from today on, cancels only their own items and keeps To-Dos", async () => {
  const me = "member-1";
  const plan = (id: string, planned_for: string) => ({ id, user_id: me, programme_enrolment_id: "enrolment-1", planned_for });
  const item = (id: string, workout_plan_id: string, starts_at: string | null, status = "scheduled") => ({ id, user_id: me, event_type: "workout", workout_plan_id, starts_at, status });
  const db = new MiniDb({
    workout_plans: [plan("mon", "2026-11-16"), plan("wed", "2026-11-18"), plan("fri", "2026-11-20"), plan("sun", "2026-11-22"), { id: "mine", user_id: me, programme_enrolment_id: null, planned_for: "2026-11-19" }],
    workout_sessions: [
      { id: "s-fri", user_id: me, plan_id: "fri", status: "completed" },
      { id: "s-sun", user_id: me, plan_id: "sun", status: "abandoned" },
    ],
    planner_events: [
      item("mon-own", "mon", at("2026-11-16", 18)),
      item("wed-own", "wed", at("2026-11-18", 18)),
      item("wed-todo", "wed", null),
      item("fri-own", "fri", at("2026-11-20", 18), "completed"),
      item("sun-own", "sun", at("2026-11-22", 18)),
      item("sun-todo", "sun", at("2026-11-21", 7)),
      item("mine-own", "mine", at("2026-11-19", 18)),
    ],
    programme_enrolments: [{ id: "enrolment-1", user_id: me, status: "active" }],
  });
  const result = await leaveProgramme(db as unknown as SupabaseClient, { userId: me, enrolmentId: "enrolment-1", todayKey: TODAY });
  assert.equal(result.error, null);
  assert.deepEqual(db.tables.workout_plans.map((row) => row.id), ["mon", "fri", "mine"], "today's and Sunday's days go (Sunday's session was abandoned); the day done early and past days stay");
  const status = Object.fromEntries(db.tables.planner_events.map((row) => [row.id, `${row.status}${row.workout_plan_id ? ` · ${row.workout_plan_id}` : ""}`]));
  assert.deepEqual(status, {
    "mon-own": "scheduled · mon",
    "wed-own": "cancelled",
    "wed-todo": "scheduled",
    "fri-own": "completed · fri",
    "sun-own": "cancelled",
    "sun-todo": "scheduled",
    "mine-own": "scheduled · mine",
  }, "To-Dos linked to removed days stay in the planner, unlinked");
  assert.equal(db.tables.programme_enrolments[0].status, "left");
});

test("leaving reads each item's day, and still works on a database without local_date", async () => {
  const me = "member-1";
  const tables = (withDay: boolean) => ({
    workout_plans: [{ id: "wed", user_id: me, programme_enrolment_id: "enrolment-1", planned_for: "2026-11-18" }],
    workout_sessions: [],
    planner_events: [
      // FITX's own item for Wednesday, scheduled at 05:00 from India, and the member's Thursday To-Do linked to that day.
      { id: "fitx-own", user_id: me, event_type: "workout", workout_plan_id: "wed", status: "scheduled", starts_at: withDay ? "2026-11-17T23:30:00.000Z" : at("2026-11-18", 5), ...(withDay ? { local_date: "2026-11-18" } : {}) },
      { id: "todo-thu", user_id: me, event_type: "workout", workout_plan_id: "wed", status: "scheduled", starts_at: withDay ? "2026-11-18T23:00:00.000Z" : at("2026-11-19", 4), ...(withDay ? { local_date: "2026-11-19" } : {}) },
    ],
    programme_enrolments: [{ id: "enrolment-1", user_id: me, status: "active" }],
  });
  const statuses = (db: MiniDb) => Object.fromEntries(db.tables.planner_events.map((row) => [row.id, row.status]));
  const zone = process.env.TZ;
  try {
    process.env.TZ = "Europe/London";
    const current = new MiniDb(tables(true));
    assert.equal((await leaveProgramme(current as unknown as SupabaseClient, { userId: me, enrolmentId: "enrolment-1", todayKey: TODAY })).error, null);
    assert.deepEqual(statuses(current), { "fitx-own": "cancelled", "todo-thu": "scheduled" }, "the phone is in London now; the days come from local_date");
  } finally {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  }
  const older = new MiniDb(tables(false), ["local_date"]);
  assert.equal((await leaveProgramme(older as unknown as SupabaseClient, { userId: me, enrolmentId: "enrolment-1", todayKey: TODAY })).error, null);
  assert.deepEqual(statuses(older), { "fitx-own": "cancelled", "todo-thu": "scheduled" }, "before the planner migration: the start time's day in this browser");
});

// ---------------------------------------------------------------- keeping the next week planned, pausing and finishing

test("a top-up plans only dates without a plan, keeps the cycle over the dates it leaves out, and stops at the sessions left", () => {
  // From Monday 2026-11-16 on Monday, Wednesday and Friday, starting at day 0 of a three-day cycle.
  const all = datesToSchedule({ fromKey: "2026-11-16", weekdays: [1, 3, 5], horizonDays: 7, startDay: 0, dayCount: 3 });
  assert.deepEqual(all, [{ date: "2026-11-16", dayIndex: 0 }, { date: "2026-11-18", dayIndex: 1 }, { date: "2026-11-20", dayIndex: 2 }]);
  // Another tab planned Wednesday meanwhile: it is left out, and Friday is still day 2.
  assert.deepEqual(datesToSchedule({ fromKey: "2026-11-16", weekdays: [1, 3, 5], horizonDays: 7, startDay: 0, dayCount: 3, planned: new Set(["2026-11-18"]) }),
    [{ date: "2026-11-16", dayIndex: 0 }, { date: "2026-11-20", dayIndex: 2 }]);
  assert.deepEqual(datesToSchedule({ fromKey: "2026-11-16", weekdays: [1, 3, 5], horizonDays: 7, startDay: 0, dayCount: 3, maxDays: 1 }), [{ date: "2026-11-16", dayIndex: 0 }]);
  assert.deepEqual(datesToSchedule({ fromKey: "2026-11-16", weekdays: [1, 3, 5], horizonDays: 7, startDay: 0, dayCount: 3, maxDays: 0 }), []);
});

test("the top-up window: after the last planned day, only while active, and only sessions a programme with a length still needs", () => {
  const enrolment = { id: "e", weekdays: [1, 3, 5], preferred_time: "18:00:00", context: "home" as const, next_day_index: 1, sessions_completed: 1, status: "active" };
  const plans = [{ ...day("mon", "2026-11-16", "2026-11-16"), programme_day_index: 0 }, { ...day("wed", "2026-11-18"), programme_day_index: 1 }];
  assert.deepEqual(topUpWindow({ enrolment, plans, todayKey: TODAY, target: null, dayCount: 3 }), { fromKey: "2026-11-19", startDay: 2, horizonDays: 6, maxDays: null });
  assert.equal(topUpWindow({ enrolment: { ...enrolment, status: "paused" }, plans, todayKey: TODAY, target: null, dayCount: 3 }), null);
  // 3 sessions in all: one done and one planned leave one to plan.
  assert.equal(topUpWindow({ enrolment, plans, todayKey: TODAY, target: 3, dayCount: 3 })?.maxDays, 1);
  assert.equal(topUpWindow({ enrolment, plans, todayKey: TODAY, target: 2, dayCount: 3 }), null);
});

function programmeDb(status = "active") {
  const me = "member-1";
  const plan = (id: string, planned_for: string) => ({ id, user_id: me, programme_enrolment_id: "enrolment-1", planned_for });
  return {
    me,
    db: new MiniDb({
      workout_plans: [plan("mon", "2026-11-16"), plan("wed", "2026-11-18"), plan("fri", "2026-11-20")],
      workout_sessions: [{ id: "s-mon", user_id: me, plan_id: "mon", status: "completed" }],
      planner_events: [
        { id: "wed-own", user_id: me, event_type: "workout", workout_plan_id: "wed", starts_at: at("2026-11-18", 18), status: "scheduled" },
        { id: "fri-own", user_id: me, event_type: "workout", workout_plan_id: "fri", starts_at: at("2026-11-20", 18), status: "scheduled" },
      ],
      programme_enrolments: [{ id: "enrolment-1", user_id: me, status }],
    }),
  };
}

test("pausing removes the days not started from today on and keeps the enrolment's place; resuming makes it active again", async () => {
  const { me, db } = programmeDb();
  assert.equal((await pauseProgramme(db as unknown as SupabaseClient, { userId: me, enrolmentId: "enrolment-1", todayKey: TODAY })).error, null);
  assert.deepEqual(db.tables.workout_plans.map((row) => row.id), ["mon"], "the coming days go; the done one stays");
  assert.deepEqual(db.tables.planner_events.map((row) => row.status), ["cancelled", "cancelled"]);
  assert.equal(db.tables.programme_enrolments[0].status, "paused");
  const resumed = await resumeProgramme(db as unknown as SupabaseClient, { userId: me, enrolmentId: "enrolment-1" });
  assert.equal(resumed.error, null);
  assert.equal(resumed.alreadyActive, false);
  assert.equal(db.tables.programme_enrolments[0].status, "active");
});

test("only an active programme is paused, and only a paused one resumed", async () => {
  const left = programmeDb("left");
  await pauseProgramme(left.db as unknown as SupabaseClient, { userId: left.me, enrolmentId: "enrolment-1", todayKey: TODAY });
  assert.equal(left.db.tables.programme_enrolments[0].status, "left");
  await resumeProgramme(left.db as unknown as SupabaseClient, { userId: left.me, enrolmentId: "enrolment-1" });
  assert.equal(left.db.tables.programme_enrolments[0].status, "left");
});

test("finishing a programme marks it completed and removes the days not started", async () => {
  const { me, db } = programmeDb();
  assert.equal((await finishProgramme(db as unknown as SupabaseClient, { userId: me, enrolmentId: "enrolment-1", todayKey: TODAY })).error, null);
  assert.equal(db.tables.programme_enrolments[0].status, "completed");
  assert.deepEqual(db.tables.workout_plans.map((row) => row.id), ["mon"]);
});
