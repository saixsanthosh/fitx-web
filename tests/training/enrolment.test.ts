import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leaveProgramme, ownProgrammeItems, programmeDayDone, programmeDaysToRemove, upcomingProgrammeDays, type ProgrammePlan } from "@/lib/training/enrolment";

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

// ---------------------------------------------------------------- leaving, against a small in-memory database

type Row = Record<string, unknown>;

/** Just the query shapes leaveProgramme uses, with the schema's "on delete set null" plan links. */
class MiniDb {
  tables: Record<string, Row[]>;
  constructor(tables: Record<string, Row[]>) { this.tables = tables; }
  from(table: string) { return new MiniQuery(this, table); }
}

class MiniQuery implements PromiseLike<{ data: Row[] | null; error: null }> {
  private op: "select" | "update" | "delete" = "select";
  private payload: Row = {};
  private filters: Array<(row: Row) => boolean> = [];
  private db: MiniDb;
  private table: string;
  constructor(db: MiniDb, table: string) { this.db = db; this.table = table; }
  select() { return this; }
  update(payload: Row) { this.op = "update"; this.payload = payload; return this; }
  delete() { this.op = "delete"; return this; }
  eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this; }
  gte(column: string, value: string) { this.filters.push((row) => typeof row[column] === "string" && (row[column] as string) >= value); return this; }
  in(column: string, values: unknown[]) { this.filters.push((row) => values.includes(row[column])); return this; }
  then<A, B = never>(resolve?: ((value: { data: Row[] | null; error: null }) => A | PromiseLike<A>) | null, reject?: ((reason: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve().then(() => this.run()).then(resolve, reject);
  }
  private run() {
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
    return { data: this.op === "select" ? matched.map((row) => ({ ...row })) : null, error: null as null };
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
