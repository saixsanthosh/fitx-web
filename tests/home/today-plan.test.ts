// "What should I do today?": the order Home answers in, programme days and this week's activity.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextTrainingDay, programmeDayTitle, programmeNext, sundayIndex, todayPlan, trainsOn, weekActivity, whenLabel, type PlanWorkout, type TodayPlanInput } from "@/lib/domain/today-plan";
import { at } from "./support/training";

const TODAY = "2026-11-18"; // a Wednesday

function workout(overrides: Partial<PlanWorkout> = {}): PlanWorkout {
  return { planId: "p1", eventId: "e1", title: "Push A", startsAt: null, done: false, exercises: 6, regions: ["chest", "shoulders", "triceps"], secondary: [], programme: null, ...overrides };
}

function input(overrides: Partial<TodayPlanInput> = {}): TodayPlanInput {
  return { today: TODAY, inProgress: null, unfinishedActivity: null, workouts: [], finishedToday: 0, programme: null, nextPlanned: null, ...overrides };
}

test("a workout in progress comes first, then an unfinished recording, then today's planned workout", () => {
  const running = { id: "s1", name: "Push A", startedAt: at(TODAY, 7), planId: "p1" };
  const both = input({ inProgress: running, unfinishedActivity: { sport: "run", startedAt: Date.now() }, workouts: [workout(), workout({ planId: "p2", eventId: "e2", title: "Evening walk" })] });
  const plan = todayPlan(both);
  assert.equal(plan.kind, "resume_workout");
  assert.equal(plan.kind === "resume_workout" && plan.next?.planId, "p2", "the running plan is not offered again");
  assert.equal(todayPlan({ ...both, inProgress: null }).kind, "resume_activity");
  const planned = todayPlan(input({ workouts: [workout({ done: true }), workout({ planId: "p2", eventId: "e2", title: "Pull A" })] }));
  assert.equal(planned.kind === "workout" && planned.workout.title, "Pull A", "the first workout not done yet");
});

test("done for today when a workout was finished and nothing planned is left", () => {
  const plan = todayPlan(input({ workouts: [workout({ done: true })], finishedToday: 1, nextPlanned: { date: "2026-11-20", title: "Legs", projected: false }, programme: { title: "PPL", trainsToday: true, next: { date: "2026-11-19", title: "Pull A", projected: false } } }));
  assert.equal(plan.kind, "done");
  assert.equal(plan.kind === "done" && plan.next?.title, "Pull A", "the soonest next workout");
  assert.equal(todayPlan(input({ finishedToday: 2 })).kind, "done", "an unplanned workout finished today counts too");
});

test("a programme rest day is recovery; a training day that was never planned asks to plan the week", () => {
  const rest = todayPlan(input({ programme: { title: "Push, Pull, Legs", trainsToday: false, next: { date: "2026-11-19", title: "Pull A", projected: true } } }));
  assert.deepEqual(rest, { kind: "rest_day", programme: "Push, Pull, Legs", next: { date: "2026-11-19", title: "Pull A", projected: true } });
  const unplanned = todayPlan(input({ programme: { title: "Push, Pull, Legs", trainsToday: true, next: null } }));
  assert.deepEqual(unplanned, { kind: "plan_week", programme: "Push, Pull, Legs" });
});

test("without a programme: the next planned workout this week, or a nudge to plan the week", () => {
  assert.deepEqual(todayPlan(input({ nextPlanned: { date: "2026-11-20", title: "Legs", projected: false } })), { kind: "free_day", next: { date: "2026-11-20", title: "Legs", projected: false } });
  assert.deepEqual(todayPlan(input()), { kind: "plan_week", programme: null });
});

test("programme weekdays use 0 = Sunday like programme_enrolments.weekdays", () => {
  assert.equal(sundayIndex(TODAY), 3, "Wednesday");
  assert.equal(sundayIndex("2026-11-22"), 0, "Sunday");
  assert.equal(trainsOn([1, 3, 5], TODAY), true);
  assert.equal(trainsOn([1, 5], TODAY), false);
  assert.equal(nextTrainingDay([1, 5], TODAY), "2026-11-20", "Friday");
  assert.equal(nextTrainingDay([3], TODAY), "2026-11-25", "next Wednesday, never today");
  assert.equal(nextTrainingDay([], TODAY), null);
});

test("the next programme day: the first planned one, else projected from the weekdays", () => {
  assert.deepEqual(programmeNext({ today: TODAY, weekdays: [1, 3, 5], planned: [{ date: "2026-11-20", title: "Legs" }, { date: TODAY, title: "Push A" }], nextDayTitle: "Pull A" }), { date: "2026-11-20", title: "Legs", projected: false });
  assert.deepEqual(programmeNext({ today: TODAY, weekdays: [1, 3, 5], planned: [], nextDayTitle: "Pull A" }), { date: "2026-11-20", title: "Pull A", projected: true });
  assert.equal(programmeNext({ today: TODAY, weekdays: [1, 3, 5], planned: [], nextDayTitle: null }), null, "no day title, no guess");
  assert.equal(programmeDayTitle("Push A · Push, Pull, Legs"), "Push A");
  assert.equal(programmeDayTitle("Morning run"), "Morning run");
});

test("dates read naturally", () => {
  assert.equal(whenLabel(TODAY, TODAY), "today");
  assert.equal(whenLabel("2026-11-19", TODAY), "tomorrow");
  assert.equal(whenLabel("2026-11-21", TODAY), "on Saturday");
  assert.equal(whenLabel("2026-11-27", TODAY), "on Fri 27 Nov");
});

test("this week's activity: workouts and recorded activities per day; unreadable activities stay unknown", () => {
  const week = weekActivity(TODAY, [{ date: "2026-11-16", count: 1 }, { date: TODAY, count: 1 }], [
    { startedAt: at("2026-11-17", 7), distanceM: 5210, movingSeconds: 1800 },
    { startedAt: at("2026-11-15", 7), distanceM: 3000, movingSeconds: 1200 },
  ]);
  assert.equal(week.days.length, 7);
  assert.deepEqual(week.days.slice(0, 3).map((day) => [day.date, day.workouts, day.activities]), [["2026-11-16", 1, 0], ["2026-11-17", 0, 1], [TODAY, 1, 0]]);
  assert.deepEqual([week.workouts, week.activities, week.distanceM, week.movingSeconds], [2, 1, 5210, 1800], "last Sunday's walk is not this week's");
  assert.equal(week.days[2].isToday, true);
  assert.equal(week.days[3].isFuture, true);
  const unknown = weekActivity(TODAY, [], null);
  assert.deepEqual([unknown.activities, unknown.distanceM], [null, null]);
});

test("weights show and are typed in the member's unit but are always stored in kilograms", async () => {
  const { weightIn, weightRangeText, weightText, weightToKg, weightUnitName, weightUnitOf } = await import("@/lib/domain/weight-display");
  assert.equal(weightUnitOf("lb"), "lb");
  assert.equal(weightUnitOf("stone"), "kg", "anything else is the default");
  assert.equal(weightText(78.44, "kg"), "78.4");
  assert.equal(weightText(78.4, "lb"), "172.8");
  assert.equal(weightIn(0.7, "lb"), 1.5, "a change converts the same way");
  assert.equal(weightToKg(172.8, "lb"), 78.4);
  assert.equal(weightToKg(71, "kg"), 71);
  assert.equal(weightRangeText("kg"), "between 30 and 500 kg");
  assert.equal(weightRangeText("lb"), "between 67 and 1102 lb");
  assert.equal(weightUnitName("lb"), "pounds");
});
