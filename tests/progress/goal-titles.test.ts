// Bug 29: the name a goal template suggests always says the period chosen in How often, so a weekly calorie limit
// (which adds up the whole week's food) is never called "Stay under 1,900 kcal a day".
import { test } from "node:test";
import assert from "node:assert/strict";
import { draftFromGoal, goalDraft, templateTitle, validateGoalDraft, type GoalContext, type GoalPeriod, type GoalTemplateKey, type GoalView } from "@/lib/domain/goals";

const context: GoalContext = { today: "2026-11-25", estimate: { calories: 1912, protein: 131, carbs: 210, fat: 57 }, workoutsPerWeek: 4, waterGoalMl: 3000, latestWeight: 80, targetWeight: 72 };

const titled = (template: GoalTemplateKey, patch: Partial<ReturnType<typeof goalDraft>> = {}) => templateTitle({ ...goalDraft(template, context), ...patch });

test("calories: Daily says a day, Weekly a week, for a limit and for a target", () => {
  assert.equal(titled("calories_day"), "Stay under 1,900 kcal a day");
  assert.equal(titled("calories_day", { period: "weekly" }), "Stay under 1,900 kcal a week");
  assert.equal(titled("calories_day", { period: "weekly", direction: "increase" }), "Eat 1,900 kcal a week");
});

test("workouts follow every period: a day, a week, in total", () => {
  const cases: Array<[GoalPeriod, string, string]> = [
    ["daily", "1", "Work out 1 time a day"],
    ["weekly", "4", "Work out 4 times a week"],
    ["long_term", "1", "Work out 1 time in total"],
    ["long_term", "30", "Work out 30 times in total"],
  ];
  for (const [period, target, title] of cases) assert.equal(titled("workouts_week", { period, target }), title);
});

test("protein and water follow the period too", () => {
  assert.equal(titled("protein_day"), "Eat 130 g of protein a day");
  assert.equal(titled("protein_day", { period: "weekly", target: "900" }), "Eat 900 g of protein a week");
  assert.equal(titled("water_day"), "Drink 3 L of water a day");
  assert.equal(titled("water_day", { period: "weekly", target: "21000" }), "Drink 21 L of water a week");
});

test("distance and active minutes keep following the period; the others are unchanged", () => {
  assert.equal(titled("distance_week", { target: "15", period: "long_term" }), "Cover 15 km in total");
  assert.equal(titled("active_week", { target: "30", period: "daily" }), "Be active for 30 minutes a day");
  assert.equal(titled("weight"), "Reach 72 kg");
  assert.equal(titled("custom"), "");
});

test("a saved weekly calorie limit keeps its weekly name; a daily or long-term workouts goal edits as a workouts goal", () => {
  const weekly = validateGoalDraft({ ...goalDraft("calories_day", context), period: "weekly", title: titled("calories_day", { period: "weekly" }) });
  assert.ok(weekly.ok);
  if (weekly.ok) assert.deepEqual([weekly.value.period, weekly.value.title], ["weekly", "Stay under 1,900 kcal a week"]);
  const daily: GoalView = {
    id: "g", title: "Work out 1 time a day", category: "consistency", metric: "workouts_completed", period: "daily", direction: "increase",
    targetValue: 1, baselineValue: null, unit: "workouts", startsOn: "2026-11-01", dueOn: null, status: "active", notes: null,
    createdAt: "2026-11-01T00:00:00Z", updatedAt: null, completedAt: null, periodStart: null, periodEnd: null,
    currentValue: 0, valueAsOf: null, startValue: null, linkedTodos: 0, linkedTodosDone: 0, missingEntries: null,
  };
  const draft = draftFromGoal(daily);
  assert.deepEqual([draft.template, draft.period], ["workouts_week", "daily"]);
  assert.equal(templateTitle({ ...draft, period: "long_term", target: "20" }), "Work out 20 times in total");
});
