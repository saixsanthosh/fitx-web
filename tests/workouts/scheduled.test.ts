import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SCHEDULED_LIMIT, fetchUpcomingScheduled, joinScheduledToPlans, scheduledItems, type ScheduledRow } from "@/app/(dashboard)/workouts/_lib/scheduled";

const TODAY = "2026-11-23";
const PLAN = "11111111-1111-4111-8111-111111111111";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n: number, local_date: string, starts_at: string | null, workout_plan_id: string | null = PLAN, title = `Workout ${n}`): ScheduledRow =>
  ({ id: id(n), title, local_date, starts_at, workout_plan_id });

test("soonest first: by day, then start time, an untimed workout after the timed ones that day; nothing before today", () => {
  const items = scheduledItems([
    row(1, "2026-11-25", "2026-11-25T07:00:00.000Z"),
    row(2, TODAY, null),
    row(3, TODAY, "2026-11-23T18:00:00.000Z"),
    row(4, "2026-11-22", "2026-11-22T18:00:00.000Z"),
    row(5, TODAY, "2026-11-23T06:30:00.000Z"),
  ], TODAY);
  assert.deepEqual(items.map((item) => item.id), [id(5), id(3), id(2), id(1)]);
});

test("only today's workouts with a plan get Start, a link that keeps the planner item on the session", () => {
  const [today, untethered, later] = scheduledItems([
    row(1, TODAY, "2026-11-23T18:00:00.000Z"),
    row(2, TODAY, "2026-11-23T19:00:00.000Z", null),
    row(3, "2026-11-24", "2026-11-24T18:00:00.000Z"),
  ], TODAY);
  assert.equal(today.startHref, `/workouts?plan=${PLAN}&event=${id(1)}`);
  assert.equal(untethered.startHref, null, "a planned item whose plan was deleted cannot start");
  assert.equal(later.startHref, null, "a later day is listed, not started");
  assert.equal(later.day, "2026-11-24");
  assert.equal(later.startsAt, "2026-11-24T18:00:00.000Z");
});

test("compact: the soonest few only; a blank title reads Workout; none means an empty list", () => {
  const many = Array.from({ length: 9 }, (_, index) => row(index + 1, "2026-11-24", `2026-11-24T${String(6 + index).padStart(2, "0")}:00:00.000Z`));
  assert.equal(scheduledItems(many, TODAY).length, SCHEDULED_LIMIT);
  assert.equal(scheduledItems([row(1, TODAY, null, PLAN, "  ")], TODAY)[0].title, "Workout");
  assert.deepEqual(scheduledItems([], TODAY), []);
});

/** A stand-in for the Supabase query builder that records the chain. */
function fakeClient(result: { data: unknown; error: unknown } | Error) {
  const calls: unknown[][] = [];
  const chain = {
    select: (...args: unknown[]) => { calls.push(["select", ...args]); return chain; },
    eq: (...args: unknown[]) => { calls.push(["eq", ...args]); return chain; },
    gte: (...args: unknown[]) => { calls.push(["gte", ...args]); return chain; },
    order: (...args: unknown[]) => { calls.push(["order", ...args]); return chain; },
    limit: (...args: unknown[]) => { calls.push(["limit", ...args]); return result instanceof Error ? Promise.reject(result) : Promise.resolve(result); },
  };
  return { client: { from: (table: string) => { calls.push(["from", table]); return chain; } }, calls };
}

test("the query: the member's scheduled workouts from today, by day then start time", async () => {
  const { client, calls } = fakeClient({ data: [row(1, TODAY, null)], error: null });
  const items = await fetchUpcomingScheduled(client, "user-1", TODAY);
  assert.equal(items.length, 1);
  assert.deepEqual(calls, [
    ["from", "planner_events"],
    ["select", "id,title,local_date,starts_at,workout_plan_id"],
    ["eq", "user_id", "user-1"], ["eq", "event_type", "workout"], ["eq", "status", "scheduled"],
    ["gte", "local_date", TODAY],
    ["order", "local_date", { ascending: true }], ["order", "starts_at", { ascending: true, nullsFirst: false }],
    ["limit", SCHEDULED_LIMIT],
  ]);
});

test("an error or a fault shows nothing rather than a broken block", async () => {
  assert.deepEqual(await fetchUpcomingScheduled(fakeClient({ data: null, error: { code: "42703" } }).client, "u", TODAY), []);
  assert.deepEqual(await fetchUpcomingScheduled(fakeClient(new Error("offline")).client, "u", TODAY), []);
});

test("Workouts shows the list in both modes, opens the plan on Start, and has no Week link", () => {
  const page = readFileSync(new URL("../../src/app/(dashboard)/workouts/page.tsx", import.meta.url), "utf8");
  assert.equal((page.match(/<ScheduledWorkouts /g) ?? []).length, 2, "Home and Gym");
  assert.match(page, /startLink\.current = \{ planId, plannerEventId \}/);
  assert.doesNotMatch(page, /homePanel\("week"\)/);
  const view = readFileSync(new URL("../../src/components/workouts/ScheduledWorkouts.tsx", import.meta.url), "utf8");
  assert.match(view, /if \(!items\.length\) return null;/, "nothing at all when none are scheduled");
});

test("Your plans lists each plan once: its scheduled item on its own day joins its row; the Scheduled list keeps the rest", () => {
  const OTHER = "22222222-2222-4222-8222-222222222222";
  const PROGRAMME = "33333333-3333-4333-8333-333333333333";
  const items = scheduledItems([
    row(1, TODAY, "2026-11-23T18:00:00.000Z", PLAN, "Chest and arms"),
    row(2, "2026-11-25", "2026-11-25T07:00:00.000Z", PLAN, "Chest and arms"),
    row(3, "2026-11-24", null, OTHER, "Legs"),
    row(4, "2026-11-24", null, PROGRAMME, "Programme day"),
    row(5, "2026-11-26", null, null, "Swim"),
  ], TODAY);
  const plans = [{ id: PLAN, planned_for: TODAY }, { id: OTHER, planned_for: "2026-11-27" }];
  const { rest, byPlan } = joinScheduledToPlans(items, plans);
  // "Chest and arms" today joins its row, with Start keeping the planner item (start-link.ts is unchanged).
  assert.equal(byPlan.get(PLAN)?.id, id(1));
  assert.equal(byPlan.get(PLAN)?.startHref, `/workouts?plan=${PLAN}&event=${id(1)}`);
  // Its second date, a plan whose own day differs, a plan not in the list and an item without a plan stay listed.
  assert.deepEqual(rest.map((item) => item.id), [id(3), id(4), id(2), id(5)]);
  assert.equal(byPlan.has(OTHER), false);
  assert.equal(byPlan.size, 1);
  assert.deepEqual(joinScheduledToPlans([], plans), { rest: [], byPlan: new Map() });
});
