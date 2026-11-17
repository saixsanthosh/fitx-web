// The Home, Progress and Goals loaders added for the connected experience, against stand-in databases with and
// without the activity and programme tables.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { StubDb, used, type StubCall } from "./support/stub-db";
import { loadActivitiesBetween } from "@/lib/data/activities";
import { loadGoals } from "@/lib/data/goals";
import { loadFoodDays } from "@/lib/data/meals";
import { loadTodayPlanData } from "@/lib/data/today-plan";
import { DataError } from "@/lib/data/missing-schema";
import { at } from "./support/training";

const USER = "user-1";
const DAY = "2026-11-18"; // a Wednesday
const MISSING_TABLE = { code: "PGRST205", message: "Could not find the table 'public.activities' in the schema cache" };
const db = (stub: StubDb) => stub as unknown as SupabaseClient;

test("activities: summary numbers for the days asked, or 'unavailable' on a database without them", async () => {
  const stub = new StubDb(() => ({ data: [{ id: "a1", sport: "run", started_at: at(DAY, 7), distance_m: "5210.5", moving_seconds: 1800 }, { id: "bad", started_at: null }] }));
  const result = await loadActivitiesBetween(db(stub), USER, "2026-11-16", DAY);
  assert.deepEqual(result, { available: true, capped: false, activities: [{ id: "a1", sport: "run", startedAt: at(DAY, 7), distanceM: 5210.5, movingSeconds: 1800 }] });
  const call = stub.callsTo("activities")[0];
  assert.ok(used(call, "eq", "user_id", USER));
  assert.ok(used(call, "select", "id,sport,started_at,distance_m,moving_seconds"), "no routes are read");
  assert.deepEqual(await loadActivitiesBetween(db(new StubDb(() => ({ error: MISSING_TABLE }))), USER, DAY, DAY), { available: false, activities: [], capped: false });
  await assert.rejects(loadActivitiesBetween(db(new StubDb(() => ({ error: { code: "57014", message: "timeout" } }))), USER, DAY, DAY), DataError);
});

test("food days: unknown values stay unknown and pages are read until a short one", async () => {
  const pages: StubCall[] = [];
  const stub = new StubDb((call) => {
    pages.push(call);
    if (pages.length === 1) return { data: Array.from({ length: 1000 }, (_, index) => ({ date: index < 500 ? "2026-11-16" : "2026-11-17", calories: 10, protein: 1, carbs: 1, fat: 1, missing: [] })) };
    return { data: [{ date: DAY, calories: 300, protein: null, carbs: 30, fat: 5, missing: ["protein"] }] };
  });
  const result = await loadFoodDays(db(stub), USER, "2026-11-16", DAY);
  assert.equal(pages.length, 2);
  assert.ok(used(pages[1], "range", 1000, 1999));
  assert.equal(result.days.get("2026-11-16")?.entries, 500);
  assert.deepEqual(result.days.get(DAY)?.protein, { sum: 0, known: 0, missing: 1 });
  assert.equal(result.days.has("2026-11-19"), false);
});

/** A programme member on Wednesday: Push planned today (with its exercises), Pull planned Friday. */
function programmeDb(overrides: Record<string, (call: StubCall) => unknown> = {}) {
  return new StubDb((call) => {
    const handler = overrides[call.name];
    if (handler) return handler(call) as { data?: unknown; error?: { code: string } };
    switch (call.name) {
      case "workout_sessions":
        if (used(call, "eq", "status", "in_progress")) return { data: [] };
        return { data: [] };
      case "programme_enrolments":
        return { data: [{ id: "en1", programme_id: "ppl-3", weekdays: [1, 3, 5], next_day_index: 1 }] };
      case "workout_plans":
        return { data: [
          { id: "p-push", title: "Push A · Push, Pull, Legs", planned_for: DAY, programme_enrolment_id: "en1", programme_day_index: 0 },
          { id: "p-pull", title: "Pull A · Push, Pull, Legs", planned_for: "2026-11-20", programme_enrolment_id: "en1", programme_day_index: 1 },
        ] };
      case "planner_events":
        return { data: [
          { id: "e-push", event_type: "workout", title: "Push A · Push, Pull, Legs", local_date: DAY, starts_at: "2026-11-18T12:30:00Z", status: "scheduled", sort_order: 0, workout_plan_id: "p-push" },
          { id: "e-walk", event_type: "workout", title: "Evening walk", local_date: "2026-11-19", starts_at: null, status: "scheduled", sort_order: 0, workout_plan_id: null },
          { id: "e-task", event_type: "task", title: "Buy oats", local_date: DAY, starts_at: null, status: "scheduled", sort_order: 1, workout_plan_id: null },
        ] };
      case "workout_plan_exercises":
        return { data: [{ plan_id: "p-push", exercise_id: "bench_press" }, { plan_id: "p-push", exercise_id: "dumbbell_shoulder_press" }, { plan_id: "p-push", exercise_id: "incline_dumbbell_press" }] };
      case "exercise_library":
        return { data: [
          { id: "bench_press", name: "Bench press", primary_muscle: "chest", secondary_muscles: ["shoulders", "triceps"] },
          { id: "dumbbell_shoulder_press", name: "Dumbbell shoulder press", primary_muscle: "shoulders", secondary_muscles: ["triceps"] },
          { id: "incline_dumbbell_press", name: "Incline dumbbell press", primary_muscle: "chest", secondary_muscles: ["shoulders"] },
        ] };
      default:
        return { data: [] };
    }
  });
}

test("today's plan: the programme day planned today, with its exercises and main muscles, and what comes next", async () => {
  const stub = programmeDb();
  const data = await loadTodayPlanData(db(stub), USER, DAY);
  assert.equal(data.inProgress, null);
  assert.equal(data.workouts.length, 1, "the task and tomorrow's walk are not today's workouts");
  assert.deepEqual(
    { ...data.workouts[0], regions: data.workouts[0].regions.slice(0, 2) },
    { planId: "p-push", eventId: "e-push", title: "Push", startsAt: "2026-11-18T12:30:00Z", done: false, programme: "Push, Pull, Legs", exercises: 3, regions: ["chest", "shoulders"], secondary: ["triceps"] },
  );
  assert.deepEqual(data.programme, { title: "Push, Pull, Legs", trainsToday: true, next: { date: "2026-11-20", title: "Pull", projected: false } }, "day names come from the programme");
  assert.deepEqual(data.nextPlanned, { date: "2026-11-19", title: "Evening walk", projected: false }, "the next workout outside the programme");
});

test("today's plan: a programme day finished early counts as done; a workout in progress is offered to resume", async () => {
  const finished = await loadTodayPlanData(db(programmeDb({
    workout_sessions: (call) => (used(call, "eq", "status", "completed") ? { data: [{ plan_id: "p-push" }] } : { data: [{ id: "s9", name: "Legs", started_at: at("2026-11-17", 18), plan_id: null }] }),
  })), USER, DAY);
  assert.equal(finished.workouts[0].done, true);
  assert.deepEqual(finished.inProgress, { id: "s9", name: "Legs", startedAt: at("2026-11-17", 18), planId: null }, "yesterday's unfinished workout can still be resumed");
});

test("today's plan: no programme tables means no programme, not an error", async () => {
  const data = await loadTodayPlanData(db(programmeDb({
    programme_enrolments: () => ({ error: { code: "42P01", message: "relation does not exist" } }),
    workout_plans: () => ({ error: { code: "42703", message: "column workout_plans.programme_enrolment_id does not exist" } }),
  })), USER, DAY);
  assert.equal(data.programme, null);
  assert.equal(data.workouts[0].title, "Push A · Push, Pull, Legs", "the planner item keeps its own title");
  assert.equal(data.workouts[0].programme, null);
  await assert.rejects(loadTodayPlanData(db(programmeDb({ workout_sessions: () => ({ error: { code: "57014" } }) })), USER, DAY), DataError);
});

test("goals: distance goals are measured from activities and protein goals say how many foods lack a value", async () => {
  const rows = [
    { id: "g-km", title: "Cover 20 km a week", category: "fitness", metric: "manual", period: "weekly", direction: "increase", target_value: 20, unit: "km (activities)", starts_on: "2026-11-01", status: "active", created_at: "2026-11-01T00:00:00Z", current_value: 0, period_start: "2026-11-16", period_end: "2026-11-22" },
    { id: "g-protein", title: "Eat 120 g of protein a day", category: "nutrition", metric: "protein_g", period: "daily", direction: "increase", target_value: 120, unit: "g", starts_on: "2026-11-01", status: "active", created_at: "2026-11-01T00:00:00Z", current_value: 70, period_start: DAY, period_end: DAY },
    { id: "g-read", title: "Read", category: "personal", metric: "manual", period: "long_term", direction: "increase", target_value: 12, unit: "books", starts_on: "2026-11-01", status: "active", created_at: "2026-11-01T00:00:00Z", current_value: 3 },
  ];
  const stub = new StubDb((call) => {
    if (call.kind === "rpc") return { data: rows };
    if (call.name === "activities") return { data: [{ id: "a1", sport: "run", started_at: at("2026-11-16", 7), distance_m: 5200, moving_seconds: 1800 }, { id: "a2", sport: "walk", started_at: at(DAY, 7), distance_m: 2300, moving_seconds: 1500 }] };
    if (call.name === "meals") return { data: [{ date: DAY, calories: 500, protein: 70, missing: [] }, { date: DAY, calories: 300, protein: null, missing: ["protein"] }] };
    return { data: [] };
  });
  const { goals } = await loadGoals(db(stub), USER, DAY, "Asia/Kolkata");
  const km = goals.find((goal) => goal.id === "g-km")!;
  assert.deepEqual([km.metric, km.unit, km.currentValue], ["activity_distance_km", "km", 7.5]);
  assert.ok(used(stub.callsTo("activities")[0], "gte", "started_at", new Date(2026, 10, 16).toISOString()));
  const protein = goals.find((goal) => goal.id === "g-protein")!;
  assert.deepEqual([protein.currentValue, protein.missingEntries], [70, 1]);
  assert.equal(goals.find((goal) => goal.id === "g-read")?.currentValue, 3, "an ordinary manual goal keeps its own total");
  assert.equal(stub.callsTo("workout_sessions").length, 0, "no active-minute goal, no workout query");
});

test("goals: without the activities table a distance goal is unknown, never 0 km", async () => {
  const stub = new StubDb((call) => {
    if (call.kind === "rpc") return { data: [{ id: "g-km", title: "Cover 20 km a week", metric: "manual", period: "weekly", unit: "km (activities)", target_value: 20, current_value: 0, period_start: "2026-11-16", period_end: "2026-11-22" }] };
    return { error: MISSING_TABLE };
  });
  const { goals } = await loadGoals(db(stub), USER, DAY, null);
  assert.equal(goals[0].currentValue, null);
});
