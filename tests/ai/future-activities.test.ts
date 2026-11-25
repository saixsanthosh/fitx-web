// The coach leaves out activities dated in the future (bug 7; the activity stream's cross-stream edit, reports-3/
// activity.md open 1). A watch with the wrong clock can export a walk that "starts" tomorrow; Activity, Progress, Home
// and goals count it in no total until then (src/lib/activity/future.ts), but the coach's last 28 days and its week
// prompt read activities from a date onwards with no upper bound, so they still counted it.
import "./support/hooks.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { StubDb, type StubCall } from "../home/support/stub-db";
import { CLOCK_SKEW_MS } from "@/lib/activity/future";

const { loadContextSources } = await import("@/lib/ai/context");
const { loadPromptSignals } = await import("@/lib/ai/quick-prompts");

const NOW = new Date("2026-11-26T09:00:00.000Z");
const minutes = (count: number) => new Date(NOW.getTime() + count * 60_000).toISOString();
// A run yesterday, a walk just now (a watch two minutes fast), and the hunt's walk dated tomorrow.
const ROWS = [
  { sport: "run", started_at: minutes(-24 * 60), distance_m: 5000, moving_seconds: 1500, elevation_gain_m: 10 },
  { sport: "walk", started_at: minutes(2), distance_m: 1200, moving_seconds: 900, elevation_gain_m: 0 },
  { sport: "walk", started_at: minutes(22.5 * 60), distance_m: 830, moving_seconds: 600, elevation_gain_m: 0 },
];

/** Answers the activities table as PostgREST would, applying the query's gte and lte on started_at. */
function activitiesDb() {
  const stub = new StubDb((call: StubCall) => {
    if (call.name !== "activities") return { data: [] };
    const bound = (method: string) => call.ops.find((op) => op.method === method && op.args[0] === "started_at")?.args[1] as string | undefined;
    const from = bound("gte");
    const to = bound("lte");
    return { data: ROWS.filter((row) => (!from || row.started_at >= from) && (!to || row.started_at <= to)) };
  });
  return { stub, db: stub as unknown as SupabaseClient };
}

describe("the coach counts only activities that have started", () => {
  test("the last 28 days: yesterday's run and the walk just started, not tomorrow's walk", async () => {
    const { stub, db } = activitiesDb();
    const sources = await loadContextSources(db, "user-1", NOW);
    assert.deepEqual(sources.activities?.map((row) => row.started_at), [ROWS[0].started_at, ROWS[1].started_at]);
    const [call] = stub.callsTo("activities");
    assert.deepEqual(call.ops.find((op) => op.method === "lte")?.args, ["started_at", new Date(NOW.getTime() + CLOCK_SKEW_MS).toISOString()], "the import's 5-minute clock allowance");
  });

  test("the week prompt's activities: the same rule", async () => {
    const { stub, db } = activitiesDb();
    const context = { facts: { today: "2026-11-26" }, summary: {} } as unknown as Parameters<typeof loadPromptSignals>[2];
    const signals = await loadPromptSignals(db as never, "user-1", context, NOW);
    assert.deepEqual(signals.activities, [{ sport: "run", distanceM: 5000 }, { sport: "walk", distanceM: 1200 }]);
    const [call] = stub.callsTo("activities");
    assert.deepEqual(call.ops.find((op) => op.method === "lte")?.args, ["started_at", new Date(NOW.getTime() + CLOCK_SKEW_MS).toISOString()]);
  });
});
