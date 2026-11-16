// Start links from planner items, and the requests that start a session from one and schedule a programme
// day. No database: a small stand-in records what the app would send.
import { test } from "node:test";
import assert from "node:assert/strict";
import { schedulePlannerEvent, startSessionWithRpc } from "@/lib/training/plans";
import { plannerEventForStart, startLinkFrom, workoutStartHref } from "@/lib/training/start-link";

const PLAN = "aaaaaaaa-0000-4000-8000-000000000001";
const ITEM = "bbbbbbbb-0000-4000-8000-000000000002";

/** Records rpc calls and inserts. `withoutDayColumn` answers like a database without planner_events.local_date. */
function recordingDb({ withoutDayColumn = false } = {}) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const db = {
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: { session_id: "session-1", resumed: false }, error: null });
    },
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          inserts.push({ table, row });
          const missing = withoutDayColumn && "local_date" in row;
          return Promise.resolve({ data: null, error: missing ? { code: "PGRST204", message: "Could not find the 'local_date' column of 'planner_events' in the schema cache" } : null });
        },
      };
    },
  };
  return { db: db as never, rpcCalls, inserts };
}

test("a planner item's Start link names the plan and the item; an unsaved item links the plan only", () => {
  assert.equal(workoutStartHref(PLAN, ITEM), `/workouts?plan=${PLAN}&event=${ITEM}`);
  assert.equal(workoutStartHref(PLAN, "temp-42"), `/workouts?plan=${PLAN}`);
  assert.equal(workoutStartHref(PLAN), `/workouts?plan=${PLAN}`);
});

test("the Workouts page reads the item from the link, and keeps it only for that plan", () => {
  const link = startLinkFrom(`?plan=${PLAN}&event=${ITEM}`);
  assert.deepEqual(link, { planId: PLAN, plannerEventId: ITEM });
  assert.equal(plannerEventForStart(link, PLAN), ITEM);
  assert.equal(plannerEventForStart(link, "cccccccc-0000-4000-8000-000000000003"), null, "another plan's Start button");
  assert.equal(plannerEventForStart(null, PLAN), null);
  assert.equal(startLinkFrom(`?plan=${PLAN}`), null, "the plan alone names no item");
  assert.equal(startLinkFrom(`?plan=${PLAN}&event=1%27%20or%201=1`), null, "anything but an id is ignored");
  assert.equal(startLinkFrom("?exercise=bench_press"), null);
});

test("starting from an item sends it to fitx_start_workout_session; a plain start sends the plan only", async () => {
  const { db, rpcCalls } = recordingDb();
  assert.equal((await startSessionWithRpc(db, PLAN, ITEM)).sessionId, "session-1");
  await startSessionWithRpc(db, PLAN);
  assert.deepEqual(rpcCalls, [
    { name: "fitx_start_workout_session", args: { p_plan_id: PLAN, p_planner_event_id: ITEM } },
    { name: "fitx_start_workout_session", args: { p_plan_id: PLAN } },
  ]);
});

test("a programme day's planner event is listed on the day it was planned for", async () => {
  const { db, inserts } = recordingDb();
  const result = await schedulePlannerEvent(db, "user-1", PLAN, "Push · PPL", "2026-11-18", "19:00");
  assert.equal(result.error, null);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].table, "planner_events");
  assert.equal(inserts[0].row.local_date, "2026-11-18", "the day the member picked, not one worked out from the saved time zone");
  assert.equal(inserts[0].row.starts_at, new Date("2026-11-18T19:00:00").toISOString());

  const older = recordingDb({ withoutDayColumn: true });
  const saved = await schedulePlannerEvent(older.db, "user-1", PLAN, "Push · PPL", "2026-11-18", "19:00");
  assert.equal(saved.error, null, "a database without local_date gets the event without it");
  assert.deepEqual(older.inserts.map((insert) => "local_date" in insert.row), [true, false]);
});
