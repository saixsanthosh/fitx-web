// What the coach is told about activities counts only the ones that have started, each on the member's own day
// (release 3, round 3c, open-earlier-coach-future-dated: the coach's part of bug 7). The coach's activity reads stop at
// now plus the import's clock allowance since 9c59ea5 (tests/ai/future-activities.test.ts); the summary now keeps the
// same rule for whatever rows it is given, and dates activities, workouts and records in the member's time zone, as
// its `today` is, so nothing done today is told as tomorrow's (west of UTC) or yesterday's (a 5 am run in India).
import "./support/hooks.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

const { buildCoachContext } = await import("@/lib/ai/context");

type ActivityBlock = { count: number; by_sport: Record<string, Record<string, number>>; last_activity: string | null; days_since_last: number | null };
type TrainingBlock = { sessions_completed: number; sessions_per_week_oldest_first: number[]; last_session?: string };

const minutes = (from: Date, count: number) => new Date(from.getTime() + count * 60_000).toISOString();

function sources(timezone: string, overrides: Record<string, unknown> = {}) {
  return {
    profile: { age: 30, gender: "female", height: 165, weight: 60 },
    preferences: { timezone, primary_goal: "general_fitness", activity_level: "moderate" },
    weighIns: [],
    meals: [],
    customFoods: [],
    sessions: [],
    recentMuscles: [],
    records: [],
    goals: [],
    planner: [],
    activities: [],
    ...overrides,
  };
}

function activityBlock(timezone: string, activities: unknown[], now: Date): { today: string; block: ActivityBlock } {
  const { summary } = buildCoachContext(sources(timezone, { activities }) as never, now, { activities: true });
  return { today: summary.today as string, block: summary.activities_last_28_days as ActivityBlock };
}

const walk = (startedAt: string, metres = 1200) => ({ sport: "walk", started_at: startedAt, distance_m: metres, moving_seconds: 900, elevation_gain_m: 0 });

describe("the coach's activity summary counts only activities that have started", () => {
  // 2:30 pm in India on 26 November.
  const NOW = new Date("2026-11-26T09:00:00.000Z");

  test("a walk a wrong watch clock dated tomorrow is in no count, even when the rows passed in hold it", () => {
    const rows = [
      { sport: "run", started_at: "2026-11-25T01:00:00+00:00", distance_m: 5000, moving_seconds: 1500, elevation_gain_m: 10 },
      walk(minutes(NOW, 2)),
      walk(minutes(NOW, 22.5 * 60), 830),
    ];
    const { today, block } = activityBlock("Asia/Kolkata", rows, NOW);
    assert.equal(today, "2026-11-26");
    assert.equal(block.count, 2);
    assert.deepEqual(block.by_sport.walk, { count: 1, km: 1.2, moving_minutes: 15, climb_m: 0 }, "the walk just started counts, tomorrow's does not");
    assert.equal(block.last_activity, "2026-11-26");
    assert.equal(block.days_since_last, 0);
  });

  test("a start inside the import's five-minute clock allowance counts as now, and as today's just after midnight", () => {
    // 11:58 pm in India: a walk 4 minutes ahead starts at 12:02 am on the 27th by the watch's clock.
    const late = new Date("2026-11-26T18:28:00.000Z");
    const inside = activityBlock("Asia/Kolkata", [walk(minutes(late, 4))], late);
    assert.equal(inside.today, "2026-11-26");
    assert.equal(inside.block.count, 1);
    assert.equal(inside.block.last_activity, "2026-11-26", "never a day after today");
    assert.equal(inside.block.days_since_last, 0, "never a negative number of days");
    const outside = activityBlock("Asia/Kolkata", [walk(minutes(late, 6))], late);
    assert.equal(outside.block.count, 0, "6 minutes ahead is beyond the allowance");
    assert.equal(outside.block.last_activity, null);
    assert.equal(outside.block.days_since_last, null);
  });
});

describe("the coach's dates are the member's own days", () => {
  test("a 5 am run in India is today's, not yesterday's UTC date", () => {
    const now = new Date("2026-11-26T09:00:00.000Z");
    // 5:00 am IST on 26 November is 11:30 pm UTC on the 25th.
    const { today, block } = activityBlock("Asia/Kolkata", [{ sport: "run", started_at: "2026-11-25T23:30:00+00:00", distance_m: 5000, moving_seconds: 1600, elevation_gain_m: 12 }], now);
    assert.equal(today, "2026-11-26");
    assert.equal(block.last_activity, "2026-11-26");
    assert.equal(block.days_since_last, 0);
  });

  test("an evening walk west of UTC is not told as tomorrow's", () => {
    // 8:30 pm in New York on 26 November is 1:30 am UTC on the 27th; the walk started at 8 pm.
    const now = new Date("2026-11-27T01:30:00.000Z");
    const { today, block } = activityBlock("America/New_York", [walk("2026-11-27T01:00:00+00:00")], now);
    assert.equal(today, "2026-11-26");
    assert.equal(block.count, 1);
    assert.equal(block.last_activity, "2026-11-26", "not 2026-11-27, a day after today");
    assert.equal(block.days_since_last, 0, "not -1");
  });

  test("workouts and personal records are dated on the member's day too", () => {
    const now = new Date("2026-11-26T09:00:00.000Z");
    // 5:00 am IST today and 5:00 am IST six days ago: both in the last 7 days. By their UTC dates (the 25th and the 19th)
    // the older one fell into the week before.
    const sessions = [
      { started_at: "2026-11-25T23:30:00+00:00", status: "completed", duration_seconds: 2400, total_volume: 3000 },
      { started_at: "2026-11-19T23:30:00+00:00", status: "completed", duration_seconds: 2400, total_volume: 3000 },
    ];
    const records = [{ exercise_name: "Goblet Squat", best_weight_kg: 20, best_reps: 10, estimated_one_rep_max: 26.7, achieved_at: "2026-11-25T23:50:00+00:00" }];
    const { summary } = buildCoachContext(sources("Asia/Kolkata", { sessions, records }) as never, now);
    const training = summary.training_last_28_days as TrainingBlock;
    assert.equal(training.sessions_completed, 2);
    assert.deepEqual(training.sessions_per_week_oldest_first, [0, 0, 0, 2]);
    assert.equal(training.last_session, "2026-11-26");
    assert.equal((summary.personal_records as Array<{ date?: string }>)[0].date, "2026-11-26");
  });

  test("in UTC nothing moves", () => {
    const now = new Date("2026-11-26T09:00:00.000Z");
    const { today, block } = activityBlock("UTC", [walk("2026-11-25T23:30:00+00:00")], now);
    assert.equal(today, "2026-11-26");
    assert.equal(block.last_activity, "2026-11-25");
    assert.equal(block.days_since_last, 1);
  });
});
