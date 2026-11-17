import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { enrolInProgramme, topUpProgrammeDays, type ProgrammePlan, type TopUpInput } from "@/lib/training/enrolment";
import type { Programme } from "@/lib/training/programmes";

const TODAY = "2026-11-18";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { code: string; message: string } | null };

/**
 * Just the query shapes enrolling and topping up use. Filters on embedded tables ("workout_sessions.status") and
 * ordering are ignored; `fail` makes reads of a table fail.
 */
class FakeDb {
  tables: Record<string, Row[]>;
  inserts: Array<{ table: string; payload: Row }> = [];
  fail: string | null = null;
  constructor(tables: Record<string, Row[]>) { this.tables = tables; }
  from(table: string) { return new FakeQuery(this, table); }
  rpc(name: string) { return Promise.resolve({ data: null, error: { code: "PGRST202", message: `Could not find the function public.${name}` } }); }
}

class FakeQuery implements PromiseLike<Result> {
  private filters: Array<(row: Row) => boolean> = [];
  private payload: Row | null = null;
  private mode: "many" | "single" | "maybe" = "many";
  private db: FakeDb;
  private table: string;
  constructor(db: FakeDb, table: string) { this.db = db; this.table = table; }
  select() { return this; }
  insert(payload: Row) { this.payload = payload; return this; }
  eq(column: string, value: unknown) { if (!column.includes(".")) this.filters.push((row) => row[column] === value); return this; }
  gte(column: string, value: string) { this.filters.push((row) => typeof row[column] === "string" && (row[column] as string) >= value); return this; }
  lte(column: string, value: string) { this.filters.push((row) => typeof row[column] === "string" && (row[column] as string) <= value); return this; }
  in(column: string, values: unknown[]) { this.filters.push((row) => values.includes(row[column])); return this; }
  order() { return this; }
  limit() { return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  then<A, B = never>(resolve?: ((value: Result) => A | PromiseLike<A>) | null, reject?: ((reason: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve().then(() => this.run()).then(resolve, reject);
  }
  private run(): Result {
    if (this.payload) {
      const row = { id: `${this.table}-${this.db.inserts.length + 1}`, ...this.payload };
      this.db.inserts.push({ table: this.table, payload: this.payload });
      (this.db.tables[this.table] ??= []).push(row);
      return { data: this.mode === "many" ? null : { ...row }, error: null };
    }
    if (this.db.fail === this.table) return { data: null, error: { code: "08006", message: "connection lost" } };
    const rows = (this.db.tables[this.table] ?? []).filter((row) => this.filters.every((keep) => keep(row))).map((row) => ({ ...row }));
    return { data: this.mode === "many" ? rows : rows[0] ?? null, error: null };
  }
}

const programme = {
  id: "test-three-day", title: "Three days · test", summary: "", context: "home", split: "full_body", level: "beginner", daysPerWeek: 7,
  defaultWeekdays: [0, 1, 2, 3, 4, 5, 6], sessionMinutes: 45, builtAround: [], isPremium: false, sourceNotes: "",
  // No slots: every day is reported as one the member cannot do, so a run's dates show in `skippedDays` without plans.
  days: [{ key: "a", title: "Day A", slots: [] }, { key: "b", title: "Day B", slots: [] }, { key: "c", title: "Day C", slots: [] }],
} as unknown as Programme;

const ME = "member-1";
const enrolment = { id: "enrolment-1", weekdays: [0, 1, 2, 3, 4, 5, 6], preferred_time: "18:00:00", context: "home" as const, next_day_index: 0, sessions_completed: 0, status: "active" };
const planRow = (id: string, planned_for: string, programme_day_index: number) => ({ id, title: id, user_id: ME, programme_enrolment_id: "enrolment-1", planned_for, programme_day_index, workout_sessions: [] });

function input(db: FakeDb, overrides: Partial<TopUpInput> = {}): [SupabaseClient, TopUpInput] {
  return [db as unknown as SupabaseClient, {
    userId: ME, enrolment, programme, catalog: [], owned: new Set(), level: "beginner", includeTargets: true,
    plans: [] as ProgrammePlan[], todayKey: TODAY, target: 3, ...overrides,
  }];
}

test("enrolling sends the member's own day as the start, not the database's date", async () => {
  const db = new FakeDb({ programme_enrolments: [] });
  const result = await enrolInProgramme(db as unknown as SupabaseClient, { userId: ME, programme, context: "home", weekdays: [3, 1], time: "07:30", todayKey: TODAY });
  assert.equal(result.error, null);
  assert.equal(db.inserts[0].payload.started_on, TODAY);
  assert.deepEqual(db.inserts[0].payload.weekdays, [1, 3]);

  const zone = process.env.TZ;
  try {
    // 02:00 in India is still the day before in UTC: the start is India's day.
    process.env.TZ = "Asia/Kolkata";
    const local = new FakeDb({ programme_enrolments: [] });
    await enrolInProgramme(local as unknown as SupabaseClient, { userId: ME, programme, context: "home", weekdays: [1], time: "" });
    const now = new Date();
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    assert.equal(local.inserts[0].payload.started_on, key);
  } finally {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  }
});

test("a top-up plans from the plans as they are once it runs, so a stale read never plans past the programme's length", async () => {
  // This tab read no plans, so it thinks three sessions are left. Another tab has planned today and tomorrow since.
  const db = new FakeDb({
    programme_enrolments: [{ id: "enrolment-1", user_id: ME, status: "active", next_day_index: 0, sessions_completed: 0 }],
    workout_plans: [planRow("wed", "2026-11-18", 0), planRow("thu", "2026-11-19", 1)],
  });
  const outcome = await topUpProgrammeDays(...input(db));
  assert.equal(outcome.ran, true);
  assert.equal(outcome.error, null);
  assert.deepEqual(outcome.skippedDays, ["Day C"], "one session is left: Friday, the day after the last planned one, at the next programme day");
  assert.deepEqual(db.inserts, []);
});

test("a top-up does nothing once the programme's sessions are all planned, or it was paused or left meanwhile", async () => {
  const planned = new FakeDb({
    programme_enrolments: [{ id: "enrolment-1", user_id: ME, status: "active", next_day_index: 0, sessions_completed: 0 }],
    workout_plans: [planRow("wed", "2026-11-18", 0), planRow("thu", "2026-11-19", 1), planRow("fri", "2026-11-20", 2)],
  });
  const full = await topUpProgrammeDays(...input(planned));
  assert.deepEqual({ ran: full.ran, skipped: full.skipped, skippedDays: full.skippedDays }, { ran: false, skipped: "nothing", skippedDays: [] });

  // A session finished in another tab: one more done, so nothing is left to plan either.
  const finished = new FakeDb({
    programme_enrolments: [{ id: "enrolment-1", user_id: ME, status: "active", next_day_index: 2, sessions_completed: 1 }],
    workout_plans: [planRow("thu", "2026-11-19", 1), planRow("fri", "2026-11-20", 2)],
  });
  assert.equal((await topUpProgrammeDays(...input(finished))).skipped, "nothing");

  for (const status of ["paused", "left", "completed"]) {
    const db = new FakeDb({ programme_enrolments: [{ id: "enrolment-1", user_id: ME, status, next_day_index: 0, sessions_completed: 0 }], workout_plans: [] });
    const outcome = await topUpProgrammeDays(...input(db));
    assert.equal(outcome.skipped, "nothing", `a programme ${status} meanwhile`);
    assert.deepEqual(outcome.skippedDays, []);
  }
});

test("a top-up skipped because another run is under way says so, in this tab or another", async () => {
  const tables = () => ({ programme_enrolments: [{ id: "enrolment-1", user_id: ME, status: "active", next_day_index: 0, sessions_completed: 0 }], workout_plans: [] });
  // Two runs in this tab at once: the second is skipped.
  const db = new FakeDb(tables());
  const [first, second] = await Promise.all([topUpProgrammeDays(...input(db)), topUpProgrammeDays(...input(db))]);
  assert.equal(first.ran, true);
  assert.deepEqual({ ran: second.ran, skipped: second.skipped }, { ran: false, skipped: "busy" });

  const locks = (globalThis as unknown as { navigator?: { locks?: { request: (name: string, work: () => Promise<unknown>) => Promise<unknown> } } }).navigator?.locks;
  if (locks) {
    // Another tab holds the lock.
    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    const holding = locks.request("fitx-programme-plan-enrolment-1", () => held);
    const outcome = await topUpProgrammeDays(...input(new FakeDb(tables())));
    release();
    await holding;
    assert.deepEqual({ ran: outcome.ran, skipped: outcome.skipped }, { ran: false, skipped: "busy" });
  }

  // Nothing to plan is not "busy".
  const none = await topUpProgrammeDays(...input(new FakeDb(tables()), { enrolment: { ...enrolment, status: "paused" } }));
  assert.equal(none.skipped, "nothing");
});

test("a top-up that cannot read the plans again plans nothing and reports the error", async () => {
  const db = new FakeDb({ programme_enrolments: [{ id: "enrolment-1", user_id: ME, status: "active", next_day_index: 0, sessions_completed: 0 }], workout_plans: [] });
  db.fail = "workout_plans";
  const outcome = await topUpProgrammeDays(...input(db));
  assert.equal(outcome.ran, true);
  assert.ok(outcome.error);
  assert.deepEqual(outcome.skippedDays, []);
  assert.deepEqual(db.inserts, []);
});
