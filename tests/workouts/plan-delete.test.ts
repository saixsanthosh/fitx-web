// Bug 48, Also seen: after a plan was deleted, its "Today 6:00 PM" entry stayed under Your plans > Scheduled, because
// planner_events.workout_plan_id is ON DELETE SET NULL. Deleting a plan now cancels the item FITX scheduled for it, and
// only once the plan is gone (review round, workouts-r6: it was cancelled first, so a failed delete left the plan with
// no scheduled item and nothing put it back).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deletePlanAndItsItem, itemLeftMessage } from "@/app/(dashboard)/workouts/_lib/plan-delete";
import { ownProgrammeItems } from "@/lib/training/enrolment";

test("the plan's own item is the timed one on its date; a To-Do the member linked on another day, or untimed, is theirs", () => {
  const plan = { id: "plan-1", planned_for: "2026-11-26" };
  const items = [
    { id: "own", workout_plan_id: "plan-1", starts_at: "2026-11-26T12:30:00.000Z", local_date: "2026-11-26" },
    { id: "todo-other-day", workout_plan_id: "plan-1", starts_at: "2026-11-28T12:30:00.000Z", local_date: "2026-11-28" },
    { id: "todo-untimed", workout_plan_id: "plan-1", starts_at: null, local_date: "2026-11-26" },
  ];
  assert.deepEqual(ownProgrammeItems(items, [plan]), ["own"]);
});

type Row = Record<string, unknown>;
type Failure = { code: string; message: string };

/** planner_events and workout_plans, recording each request in order; `fail` names requests that fail ("delete", "update", "select"). */
class FakeDb {
  tables: Record<string, Row[]>;
  log: string[] = [];
  fail: Partial<Record<"select" | "delete" | "update", Failure | number>> = {};
  constructor(tables: Record<string, Row[]>) { this.tables = tables; }
  from(table: string) { return new FakeQuery(this, table); }
}

class FakeQuery implements PromiseLike<{ data: unknown; error: Failure | null }> {
  private filters: Array<(row: Row) => boolean> = [];
  private op: "select" | "delete" | "update" = "select";
  private patch: Row = {};
  private db: FakeDb;
  private table: string;
  constructor(db: FakeDb, table: string) { this.db = db; this.table = table; }
  select() { return this; }
  delete() { this.op = "delete"; return this; }
  update(patch: Row) { this.op = "update"; this.patch = patch; return this; }
  eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this; }
  in(column: string, values: unknown[]) { this.filters.push((row) => values.includes(row[column])); return this; }
  then<A, B = never>(resolve?: ((value: { data: unknown; error: Failure | null }) => A | PromiseLike<A>) | null, reject?: ((reason: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve().then(() => this.run()).then(resolve, reject);
  }
  private run(): { data: unknown; error: Failure | null } {
    this.db.log.push(`${this.op} ${this.table}`);
    const failure = this.db.fail[this.op];
    // A number fails that many requests of the kind, then lets them through.
    if (typeof failure === "number" && failure > 0) { this.db.fail[this.op] = failure - 1; return { data: null, error: { code: "08006", message: "connection lost" } }; }
    if (failure && typeof failure === "object") return { data: null, error: failure };
    const rows = this.db.tables[this.table] ?? [];
    const hit = rows.filter((row) => this.filters.every((keep) => keep(row)));
    if (this.op === "delete") {
      this.db.tables[this.table] = rows.filter((row) => !hit.includes(row));
      // ON DELETE SET NULL
      for (const item of this.db.tables.planner_events ?? []) if (hit.some((plan) => plan.id === item.workout_plan_id)) item.workout_plan_id = null;
    }
    if (this.op === "update") for (const row of hit) Object.assign(row, this.patch);
    return { data: hit.map((row) => ({ ...row })), error: null };
  }
}

const ME = "member-1";
const plan = { id: "plan-1", planned_for: "2026-11-26" };
function tables(): Record<string, Row[]> {
  return {
    workout_plans: [{ id: "plan-1", user_id: ME, title: "Push", planned_for: "2026-11-26" }],
    planner_events: [
      { id: "own", user_id: ME, event_type: "workout", status: "scheduled", workout_plan_id: "plan-1", starts_at: "2026-11-26T12:30:00.000Z", local_date: "2026-11-26" },
      { id: "todo", user_id: ME, event_type: "workout", status: "scheduled", workout_plan_id: "plan-1", starts_at: null, local_date: "2026-11-26" },
    ],
  };
}
const status = (db: FakeDb, id: string) => db.tables.planner_events.find((item) => item.id === id)?.status;
const remove = (db: FakeDb, target: { id: string; planned_for: string | null } = plan) => deletePlanAndItsItem(db as unknown as Pick<SupabaseClient, "from">, ME, target);

describe("deleting a plan", () => {
  test("the plan goes first, then its own scheduled item; a To-Do the member linked stays, unlinked", async () => {
    const db = new FakeDb(tables());
    assert.deepEqual(await remove(db), { status: "deleted" });
    assert.deepEqual(db.log, ["select planner_events", "delete workout_plans", "update planner_events"]);
    assert.deepEqual(db.tables.workout_plans, []);
    assert.equal(status(db, "own"), "cancelled");
    assert.deepEqual([status(db, "todo"), db.tables.planner_events[1].workout_plan_id], ["scheduled", null]);
  });

  test("a delete that fails leaves the plan and its scheduled item as they were", async () => {
    const db = new FakeDb(tables());
    db.fail.delete = { code: "08006", message: "connection lost" };
    const outcome = await remove(db);
    assert.equal(outcome.status, "failed");
    assert.deepEqual(db.log, ["select planner_events", "delete workout_plans"], "nothing is cancelled");
    assert.equal(db.tables.workout_plans.length, 1);
    assert.equal(status(db, "own"), "scheduled");
  });

  test("items that cannot be read: nothing is deleted, so nothing is left behind", async () => {
    const db = new FakeDb(tables());
    db.fail.select = { code: "08006", message: "connection lost" };
    assert.equal((await remove(db)).status, "failed");
    assert.deepEqual(db.log, ["select planner_events"]);
    // A database without the planner has no items to tidy: the plan is deleted.
    const old = new FakeDb(tables());
    old.fail.select = { code: "42P01", message: 'relation "public.planner_events" does not exist' };
    assert.deepEqual(await remove(old), { status: "deleted" });
  });

  test("a cancel that fails once is sent again; if it fails twice the member is told the entry stays until its day is over", async () => {
    const once = new FakeDb(tables());
    once.fail.update = 1;
    assert.deepEqual(await remove(once), { status: "deleted" });
    assert.equal(status(once, "own"), "cancelled");
    const twice = new FakeDb(tables());
    twice.fail.update = 2;
    assert.deepEqual(await remove(twice), { status: "deleted-item-left" });
    assert.equal(twice.tables.workout_plans.length, 0);
    assert.equal(itemLeftMessage("Push"), "Deleted “Push”. Its entry under Scheduled couldn’t be removed, so it stays there until its day is over.");
  });

  test("an undated plan has no scheduled item to look for", async () => {
    const db = new FakeDb(tables());
    assert.deepEqual(await remove(db, { id: "plan-1", planned_for: null }), { status: "deleted" });
    assert.deepEqual(db.log, ["delete workout_plans"]);
  });
});
