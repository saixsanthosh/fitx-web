import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, daysBetween, isDateKey, mondayOf, weekKeys, weekdayIndex } from "@/lib/domain/day-keys";
import { dailyTargets, parseTodaySummary, summaryFromRows, todayTargets, weekStrip, weightView, estimatedTargets, type TodaySummary } from "@/lib/domain/today";
import { estimateNutritionTargets } from "@/lib/domain/nutrition";
import { parseGoalRow } from "@/lib/domain/goals";

const TODAY = "2026-11-18";
const rpcJson = {
  local_date: TODAY, timezone: "Asia/Kolkata", week_start: "2026-11-16",
  nutrition: { calories: 1200, protein: 70, carbs: 110, fat: 35, entries: 2 },
  water: { ml: 1250, entries: 2 },
  workouts: { today: 2, week: 3, week_days: [{ date: "2026-11-17", count: 1 }, { date: TODAY, count: 2 }] },
  weight: { kg: 80.2, date: "2026-11-17" }, previous_weight: { kg: 80.8, date: "2026-11-10" },
  profile: { name: "Asha", age: 30, gender: "female", height: 165, weight: 82, target_weight: 70 },
  preferences: { workouts_per_week: 4, daily_water_goal_ml: 3000, activity_level: "light", primary_goal: "fat_loss" },
  planned_workouts: [{ id: "e1", title: "Push day", starts_at: "2026-11-18T12:30:00Z", status: "scheduled", workout_plan_id: "p1" }],
  todo: { total: 4, completed: 1 },
};

function summary(overrides: Record<string, unknown> = {}): TodaySummary {
  return parseTodaySummary({ ...rpcJson, ...overrides })!;
}

test("day keys: Monday weeks, month and year edges, and validation", () => {
  assert.equal(mondayOf(TODAY), "2026-11-16");
  assert.equal(mondayOf("2026-11-16"), "2026-11-16");
  assert.equal(mondayOf("2026-11-22"), "2026-11-16", "Sunday belongs to the week that began on Monday");
  assert.deepEqual(weekKeys(TODAY), ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]);
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-03-01", -1), "2028-02-29");
  assert.equal(weekdayIndex("2026-11-22"), 6);
  assert.equal(daysBetween("2026-11-16", "2026-11-22"), 6);
  assert.equal(isDateKey("2026-02-30"), false);
  assert.equal(isDateKey("2026-11-18"), true);
  assert.equal(isDateKey("18/11/2026"), false);
});

test("the database summary is read as numbers, with nothing invented", () => {
  const today = summary();
  assert.deepEqual(today.nutrition, { calories: 1200, protein: 70, carbs: 110, fat: 35, entries: 2 });
  assert.equal(today.weight?.kg, 80.2);
  assert.equal(today.preferences?.dailyWaterGoalMl, 3000);
  assert.deepEqual(today.todo, { total: 4, completed: 1 });
  assert.equal(today.plannedWorkouts[0].startsAt, "2026-11-18T12:30:00Z");
  const sparse = parseTodaySummary({ local_date: TODAY, nutrition: { calories: "450.5" } })!;
  assert.equal(sparse.nutrition.calories, 450.5, "numeric strings are accepted");
  assert.equal(sparse.preferences, null, "no preferences row: no workout or water target is assumed");
  assert.equal(sparse.weight, null);
  assert.equal(sparse.todo, null);
  assert.equal(parseTodaySummary(null), null);
  assert.equal(parseTodaySummary({ nutrition: {} }), null, "a summary without its day is rejected");
});

test("the browser fallback adds up every row (no 50-row cap) and places workouts on their day", () => {
  const meals = Array.from({ length: 60 }, () => ({ calories: 10, protein: 1, carbs: 2, fat: 0.5 }));
  const built = summaryFromRows({
    localDate: TODAY, timezone: "Asia/Kolkata", meals, water: [{ amount_ml: 250 }, { amount_ml: 500 }],
    sessions: [{ localDate: "2026-11-17" }, { localDate: TODAY }, { localDate: TODAY }, { localDate: "2026-11-15" }],
    weights: [{ weight: 80.2, date: "2026-11-17" }, { weight: "80.8", date: "2026-11-10" }],
    profile: { name: "Asha", age: 30, gender: "female", height: 165, weight: 82, target_weight: 70 },
    preferences: null, plannedWorkouts: [],
  });
  assert.deepEqual(built.nutrition, { calories: 600, protein: 60, carbs: 120, fat: 30, entries: 60 });
  assert.deepEqual(built.water, { ml: 750, entries: 2 });
  assert.deepEqual(built.workouts, { today: 2, week: 3, weekDays: [{ date: "2026-11-17", count: 1 }, { date: TODAY, count: 2 }] }, "last Sunday's workout is not this week's");
  assert.deepEqual(built.previousWeight, { kg: 80.8, date: "2026-11-10" });
  assert.equal(built.todo, null, "the fallback has no To-Do counts");
});

test("estimated targets use the newest weigh-in, not the profile's stale weight", () => {
  const fromWeighIn = estimatedTargets(summary());
  const fromProfile = estimatedTargets(summary({ weight: null, previous_weight: null }));
  assert.ok(fromWeighIn && fromProfile);
  assert.ok(fromWeighIn.calories < fromProfile.calories, "80.2 kg needs less than the 82 kg on the profile");
  const weighed = summary();
  assert.deepEqual(
    fromWeighIn,
    estimateNutritionTargets(
      { age: weighed.profile.age, gender: weighed.profile.gender, height: weighed.profile.height, weight: 80.2 },
      weighed.preferences?.activityLevel ?? undefined,
      weighed.preferences?.primaryGoal ?? undefined,
    ),
    "the targets follow the profile rules for the 80.2 kg weigh-in",
  );
  assert.equal(estimatedTargets(summary({ profile: { name: "Asha" } })), null, "no age, height or weight: no estimate");
});

test("a daily goal sets the target and says so; otherwise the estimate or the saved water goal", () => {
  const plain = todayTargets(summary(), []);
  assert.equal(plain.calories.source, "estimate");
  assert.equal(plain.protein.source, "estimate");
  assert.equal(plain.water.source, "preference");
  assert.equal(plain.water.target, 3000);
  assert.equal(plain.calories.direction, "increase");

  const goals = [
    parseGoalRow({ id: "c", title: "Calories", metric: "calories_kcal", period: "daily", direction: "limit", target_value: 1800, status: "active", starts_on: "2026-11-01", created_at: "2026-11-01", current_value: 1200 }),
    parseGoalRow({ id: "w", title: "Water", metric: "water_ml", period: "daily", direction: "increase", target_value: 2000, status: "paused", starts_on: "2026-11-01", created_at: "2026-11-01", current_value: 1250 }),
  ];
  const withGoals = todayTargets(summary(), goals);
  assert.deepEqual([withGoals.calories.source, withGoals.calories.target, withGoals.calories.direction], ["goal", 1800, "limit"]);
  assert.equal(withGoals.calories.percent, 67);
  assert.equal(withGoals.water.source, "preference", "a paused goal does not set today's target");

  const over = todayTargets(summary({ nutrition: { calories: 2000, protein: 0, carbs: 0, fat: 0, entries: 3 } }), goals);
  assert.deepEqual([over.calories.percent, over.calories.over], [100, 200]);

  const nothing = todayTargets(summary({ profile: {}, preferences: null }), []);
  assert.deepEqual([nothing.calories.target, nothing.calories.source, nothing.water.target, nothing.water.source], [null, null, null, null]);
});

test("the weight card shows the change since the last weigh-in and what is left to the target", () => {
  const view = weightView(summary(), []);
  assert.deepEqual(view, { current: 80.2, date: "2026-11-17", change: -0.6, changeSince: "2026-11-10", target: 70, targetSource: "profile", start: null, toGo: 10.2, percent: null });
  const goal = parseGoalRow({ id: "g", title: "Reach 72 kg", metric: "body_weight_kg", period: "long_term", direction: "decrease", target_value: 72, status: "active", starts_on: "2026-11-01", created_at: "2026-11-01", current_value: 80.2, start_value: 84.2 });
  const withGoal = weightView(summary(), [goal]);
  assert.deepEqual([withGoal.target, withGoal.targetSource, withGoal.toGo, withGoal.percent], [72, "goal", 8.2, 33]);
  const reached = weightView(summary({ weight: { kg: 69.5, date: TODAY } }), []);
  assert.equal(reached.toGo, 0, "past a lower target there is nothing left to lose");
  const empty = weightView(summary({ weight: null, previous_weight: null, profile: {} }), []);
  assert.deepEqual([empty.current, empty.change, empty.target, empty.toGo], [null, null, null, null]);
});

test("the week strip runs Monday to Sunday and marks today and the days ahead", () => {
  const strip = weekStrip(summary());
  assert.equal(strip.length, 7);
  assert.deepEqual(strip.map((day) => day.count), [0, 1, 2, 0, 0, 0, 0]);
  assert.deepEqual(strip.filter((day) => day.isToday).map((day) => day.date), [TODAY]);
  assert.equal(strip.filter((day) => day.isFuture).length, 4);
});

test("a met 'reach at least' calorie goal is not 'over'; ceilings still are", () => {
  const goal = (direction: "increase" | "limit", target: number) =>
    parseGoalRow({ id: `c-${direction}`, title: "Calories", metric: "calories_kcal", period: "daily", direction, target_value: target, status: "active", starts_on: "2026-11-01", created_at: "2026-11-01", current_value: 0 });
  const bulking = todayTargets(summary({ nutrition: { calories: 3000, protein: 0, carbs: 0, fat: 0, entries: 4 } }), [goal("increase", 2800)]);
  assert.deepEqual([bulking.calories.source, bulking.calories.direction, bulking.calories.percent, bulking.calories.over], ["goal", "increase", 100, 0]);
  const cutting = todayTargets(summary({ nutrition: { calories: 3000, protein: 0, carbs: 0, fat: 0, entries: 4 } }), [goal("limit", 2800)]);
  assert.deepEqual([cutting.calories.direction, cutting.calories.over], ["limit", 200]);
  const estimated = todayTargets(summary({ nutrition: { calories: 9000, protein: 0, carbs: 0, fat: 0, entries: 9 } }), []);
  assert.equal(estimated.calories.source, "estimate");
  assert.ok(estimated.calories.over > 0, "past an estimated target is still over");
});

test("targets set in Nutrition come before the estimate; the user's own daily goal comes first", () => {
  const set = { calories: 2400, protein: 150, carbs: 260, fat: 70 };
  const withTargets = todayTargets({ ...summary(), targets: set }, []);
  assert.deepEqual(
    [withTargets.calories.target, withTargets.calories.source, withTargets.protein.target, withTargets.carbs.target, withTargets.fat.source],
    [2400, "target", 150, 260, "target"],
  );
  assert.equal(withTargets.water.source, "preference", "water still follows the saved setting");
  const proteinGoal = parseGoalRow({ id: "p", title: "Protein", metric: "protein_g", period: "daily", direction: "increase", target_value: 120, status: "active", starts_on: "2026-11-01", created_at: "2026-11-01", current_value: 70 });
  const withGoal = todayTargets({ ...summary(), targets: set }, [proteinGoal]);
  assert.deepEqual([withGoal.protein.target, withGoal.protein.source, withGoal.calories.source], [120, "goal", "target"]);
  assert.deepEqual(dailyTargets({ ...summary(), targets: set }), set, "goal templates prefill from the set targets");
  assert.deepEqual(dailyTargets(summary()), estimatedTargets(summary()), "and from the estimate when there are none");
  assert.deepEqual(parseTodaySummary({ ...rpcJson, targets: { calories: "2400", protein: 150, carbs: 260, fat: 70 } })?.targets, set);
  assert.equal(parseTodaySummary({ ...rpcJson, targets: { calories: 0 } })?.targets, null, "no calories: no set targets");
});
