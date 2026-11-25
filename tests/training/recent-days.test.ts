// The planner's recent training (moved out of the Workouts page so the programme page and the exercise library can
// re-plan days with the same rules, bug 17 review round): days since each exercise was last trained, latest first.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadRecentExerciseDays } from "@/lib/training/recent-days";

const NOW = Date.parse("2026-11-26T12:00:00.000Z");

function db(rows: Array<{ exercise_id: string | null; created_at: string }> | null, calls: string[] = []) {
  const query = {
    select: (columns: string) => { calls.push(`select ${columns}`); return query; },
    eq: (column: string, value: string) => { calls.push(`eq ${column} ${value}`); return query; },
    gte: (column: string, value: string) => { calls.push(`gte ${column} ${value}`); return query; },
    order: () => query,
    limit: () => Promise.resolve(rows ? { data: rows, error: null } : { data: null, error: { message: "offline" } }),
  };
  return { from: (table: string) => { calls.push(table); return query; } } as unknown as Pick<SupabaseClient, "from">;
}

test("days since each exercise was last trained, from the newest row, over the last two weeks", async () => {
  const calls: string[] = [];
  const days = await loadRecentExerciseDays(db([
    { exercise_id: "squat", created_at: "2026-11-25T18:00:00.000Z" },
    { exercise_id: "bench_press", created_at: "2026-11-20T09:00:00.000Z" },
    { exercise_id: "squat", created_at: "2026-11-18T09:00:00.000Z" },
    { exercise_id: null, created_at: "2026-11-24T09:00:00.000Z" },
  ], calls), "member-1", NOW);
  assert.deepEqual([...days], [["squat", 0], ["bench_press", 6]]);
  assert.deepEqual(calls.slice(0, 4), ["workout_session_exercises", "select exercise_id,created_at", "eq user_id member-1", "gte created_at 2026-11-12T12:00:00.000Z"]);
});

test("history that cannot be read gives no recent days, never a failure", async () => {
  assert.deepEqual([...(await loadRecentExerciseDays(db(null), "member-1", NOW))], []);
});
