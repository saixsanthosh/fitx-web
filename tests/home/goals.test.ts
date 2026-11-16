import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dailyGoalsMet,
  draftFromGoal,
  evaluateGoal,
  formatGoalValue,
  goalDraft,
  parseGoalRow,
  periodLabel,
  progressSummary,
  remainingLabel,
  sortGoals,
  templateTitle,
  validateGoalDraft,
  type GoalContext,
  type GoalView,
} from "@/lib/domain/goals";

const today = "2026-11-18";
const context: GoalContext = { today, estimate: { calories: 1912, protein: 131, carbs: 210, fat: 57 }, workoutsPerWeek: 4, waterGoalMl: 3000, latestWeight: 80.2, targetWeight: 72 };

function goal(overrides: Partial<GoalView>): GoalView {
  return {
    id: "g1", title: "Goal", category: "personal", metric: "manual", period: "long_term", direction: "increase",
    targetValue: 10, baselineValue: null, unit: "", startsOn: "2026-11-01", dueOn: null, status: "active", notes: null,
    createdAt: "2026-11-01T00:00:00Z", updatedAt: null, completedAt: null, periodStart: null, periodEnd: null,
    currentValue: 0, valueAsOf: null, startValue: null, linkedTodos: 0, linkedTodosDone: 0, ...overrides,
  };
}

test("increase goals count up from zero, or from a baseline", () => {
  assert.deepEqual(evaluateGoal({ current: 70, target: 100, direction: "increase" }), { state: "in_progress", percent: 70, achieved: false, remaining: 30, over: 0 });
  assert.deepEqual(evaluateGoal({ current: 120, target: 100, direction: "increase" }), { state: "achieved", percent: 100, achieved: true, remaining: 0, over: 0 });
  assert.equal(evaluateGoal({ current: 65, target: 70, direction: "increase", start: 60 }).percent, 50, "gaining 60 → 70 kg, half way at 65");
  assert.equal(evaluateGoal({ current: 0, target: 3, direction: "increase" }).state, "in_progress");
});

test("decrease goals measure the way down from where the goal started", () => {
  const halfway = evaluateGoal({ current: 76, target: 72, direction: "decrease", start: 80 });
  assert.deepEqual(halfway, { state: "in_progress", percent: 50, achieved: false, remaining: 4, over: 0 });
  assert.equal(evaluateGoal({ current: 81, target: 72, direction: "decrease", start: 80 }).percent, 0, "above the start: 0%, never negative");
  assert.equal(evaluateGoal({ current: 71.5, target: 72, direction: "decrease", start: 80 }).achieved, true);
  assert.equal(evaluateGoal({ current: 80.2, target: 72, direction: "decrease", start: 80.2 }).remaining, 8.2, "no floating-point noise");
  assert.equal(evaluateGoal({ current: 75, target: 72, direction: "decrease" }).percent, 0, "no start: 0% until reached");
  assert.equal(evaluateGoal({ current: 71, target: 72, direction: "decrease" }).percent, 100);
});

test("limit goals are met only when something is logged and the day stays under", () => {
  assert.deepEqual(evaluateGoal({ current: 0, target: 2000, direction: "limit" }), { state: "in_progress", percent: 0, achieved: false, remaining: 2000, over: 0 });
  assert.deepEqual(evaluateGoal({ current: 1450, target: 2000, direction: "limit" }), { state: "within_limit", percent: 73, achieved: true, remaining: 550, over: 0 });
  assert.deepEqual(evaluateGoal({ current: 2250, target: 2000, direction: "limit" }), { state: "over_limit", percent: 100, achieved: false, remaining: 0, over: 250 });
});

test("no data, or a target that is not positive, is reported as no data rather than 0%", () => {
  assert.equal(evaluateGoal({ current: null, target: 72, direction: "decrease", start: 80 }).state, "no_data");
  assert.equal(evaluateGoal({ current: 5, target: 0, direction: "increase" }).state, "no_data");
  assert.equal(evaluateGoal({ current: 5, target: Number.NaN, direction: "increase" }).state, "no_data");
});

test("values read the way people say them", () => {
  assert.equal(formatGoalValue(1250, "calories_kcal"), "1,250 kcal");
  assert.equal(formatGoalValue(82.4, "protein_g"), "82 g");
  assert.equal(formatGoalValue(1250, "water_ml"), "1.25 L");
  assert.equal(formatGoalValue(3000, "water_ml"), "3 L");
  assert.equal(formatGoalValue(500, "water_ml"), "500 ml");
  assert.equal(formatGoalValue(1, "workouts_completed"), "1 workout");
  assert.equal(formatGoalValue(3, "workouts_completed"), "3 workouts");
  assert.equal(formatGoalValue(80.24, "body_weight_kg"), "80.2 kg");
  assert.equal(formatGoalValue(2, "tasks_completed"), "2 To-Dos");
  assert.equal(formatGoalValue(2.5, "manual", "books"), "2.5 books");
  assert.equal(formatGoalValue(null, "manual"), "—");
});

test("progress summaries put the current value next to the target", () => {
  assert.equal(progressSummary(goal({ metric: "protein_g", currentValue: 70, targetValue: 100, unit: "g" })), "70 of 100 g");
  assert.equal(progressSummary(goal({ metric: "calories_kcal", direction: "limit", currentValue: 1200, targetValue: 2000 })), "1,200 of 2,000 kcal limit");
  assert.equal(progressSummary(goal({ metric: "water_ml", currentValue: 1250, targetValue: 3000 })), "1.25 of 3 L");
  assert.equal(progressSummary(goal({ metric: "water_ml", currentValue: 250, targetValue: 750 })), "250 of 750 ml");
  assert.equal(progressSummary(goal({ metric: "body_weight_kg", direction: "decrease", currentValue: 80.2, targetValue: 72 })), "80.2 kg · target 72.0 kg");
  assert.equal(progressSummary(goal({ metric: "body_weight_kg", currentValue: null, targetValue: 72 })), "No weigh-in yet · target 72.0 kg");
});

test("what is left is said plainly", () => {
  assert.equal(remainingLabel(goal({ metric: "protein_g", period: "daily", currentValue: 70, targetValue: 100 })), "30 g to go");
  assert.equal(remainingLabel(goal({ metric: "protein_g", period: "daily", currentValue: 110, targetValue: 100 })), "Done today");
  assert.equal(remainingLabel(goal({ metric: "workouts_completed", period: "weekly", currentValue: 4, targetValue: 4 })), "Done this week");
  assert.equal(remainingLabel(goal({ metric: "calories_kcal", direction: "limit", period: "daily", currentValue: 1450, targetValue: 2000 })), "550 kcal left");
  assert.equal(remainingLabel(goal({ metric: "calories_kcal", direction: "limit", period: "daily", currentValue: 2250, targetValue: 2000 })), "250 kcal over");
  assert.equal(remainingLabel(goal({ metric: "body_weight_kg", direction: "decrease", currentValue: 76, targetValue: 72, startValue: 80 })), "4.0 kg to go");
  assert.equal(remainingLabel(goal({ metric: "body_weight_kg", currentValue: null, targetValue: 72 })), "Log a weigh-in to start");
  assert.equal(remainingLabel(goal({ currentValue: 10, targetValue: 10 })), "Target reached");
});

test("period labels", () => {
  assert.equal(periodLabel(goal({ period: "daily" }), today), "Today");
  assert.equal(periodLabel(goal({ period: "weekly" }), today), "This week");
  assert.equal(periodLabel(goal({ dueOn: null }), today), "Ongoing");
  assert.match(periodLabel(goal({ dueOn: "2026-12-31" }), today), /^Due /);
  assert.match(periodLabel(goal({ dueOn: "2026-11-10" }), today), /^Ended /);
  assert.match(periodLabel(goal({ startsOn: "2026-12-01" }), today), /^Starts /);
});

test("goals sort active daily, weekly, long-term, then paused, then completed", () => {
  const sorted = sortGoals([
    goal({ id: "done", status: "completed" }),
    goal({ id: "long", period: "long_term" }),
    goal({ id: "paused", status: "paused", period: "daily" }),
    goal({ id: "week", period: "weekly" }),
    goal({ id: "day2", period: "daily", createdAt: "2026-11-05T00:00:00Z" }),
    goal({ id: "day1", period: "daily", createdAt: "2026-11-02T00:00:00Z" }),
  ]);
  assert.deepEqual(sorted.map((item) => item.id), ["day1", "day2", "week", "long", "paused", "done"]);
});

test("daily goals met counts only active daily goals that apply today", () => {
  const goals = [
    goal({ id: "a", period: "daily", metric: "protein_g", currentValue: 120, targetValue: 100 }),
    goal({ id: "b", period: "daily", metric: "water_ml", currentValue: 1000, targetValue: 3000 }),
    goal({ id: "c", period: "daily", status: "paused", currentValue: 5, targetValue: 1 }),
    goal({ id: "d", period: "daily", dueOn: "2026-11-10", currentValue: 5, targetValue: 1 }),
    goal({ id: "e", period: "weekly", currentValue: 5, targetValue: 1 }),
  ];
  assert.deepEqual(dailyGoalsMet(goals, today), { met: 1, total: 2 });
});

test("templates prefill from the user's own numbers", () => {
  const protein = goalDraft("protein_day", context);
  assert.deepEqual([protein.metric, protein.period, protein.direction, protein.target, protein.title], ["protein_g", "daily", "increase", "130", "Eat 130 g of protein a day"]);
  const calories = goalDraft("calories_day", context);
  assert.deepEqual([calories.direction, calories.target, calories.title], ["limit", "1900", "Stay under 1,900 kcal a day"]);
  assert.equal(templateTitle({ ...calories, direction: "increase" }), "Eat 1,900 kcal a day");
  const workouts = goalDraft("workouts_week", context);
  assert.deepEqual([workouts.period, workouts.target, workouts.title], ["weekly", "4", "Work out 4 times a week"]);
  const water = goalDraft("water_day", context);
  assert.deepEqual([water.target, water.title], ["3000", "Drink 3 L of water a day"]);
  const weight = goalDraft("weight", context);
  assert.deepEqual([weight.period, weight.direction, weight.baseline, weight.target, weight.title], ["long_term", "decrease", "80.2", "72", "Reach 72 kg"]);
  const noProfile = goalDraft("protein_day", { ...context, estimate: null });
  assert.equal(noProfile.target, "", "no estimate: the user fills it in");
  assert.equal(noProfile.title, "Eat … g of protein a day");
});

test("validation catches what the database would reject, with readable messages", () => {
  const ok = validateGoalDraft(goalDraft("protein_day", context));
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual(ok.value, { title: "Eat 130 g of protein a day", category: "nutrition", metric: "protein_g", period: "daily", direction: "increase", target_value: 130, baseline_value: null, unit: "g", starts_on: today, due_on: null, notes: null });
  const bad = (overrides: object) => validateGoalDraft({ ...goalDraft("custom", context), title: "Read", target: "12", ...overrides });
  assert.deepEqual(bad({ title: "  " }), { ok: false, error: "Give the goal a name." });
  assert.deepEqual(bad({ target: "0" }), { ok: false, error: "Enter a target greater than zero." });
  assert.deepEqual(bad({ target: "abc" }), { ok: false, error: "Enter a target greater than zero." });
  assert.deepEqual(bad({ dueOn: "2026-11-01" }), { ok: false, error: "The end date can't be before the start date." });
  assert.deepEqual(validateGoalDraft({ ...goalDraft("weight", context), period: "daily" }), { ok: false, error: "Body weight goals can be long-term." });
  assert.deepEqual(validateGoalDraft({ ...goalDraft("weight", context), target: "12" }), { ok: false, error: "Enter a target weight between 30 and 500 kg." });
  assert.deepEqual(validateGoalDraft({ ...goalDraft("protein_day", context), direction: "limit" }), { ok: false, error: "Choose whether to reach the target or stay under it." });
});

test("a weight goal's direction follows the start and target, whatever the form says", () => {
  const gain = validateGoalDraft({ ...goalDraft("weight", context), baseline: "60", target: "68", direction: "decrease" });
  assert.equal(gain.ok && gain.value.direction, "increase");
  const lose = validateGoalDraft({ ...goalDraft("weight", context), baseline: "90", target: "80" });
  assert.equal(lose.ok && lose.value.direction, "decrease");
});

test("custom goals keep their unit; automatic goals use the metric's unit", () => {
  const custom = validateGoalDraft({ ...goalDraft("custom", context), title: "Read", target: "12", unit: " books " });
  assert.equal(custom.ok && custom.value.unit, "books");
  const water = validateGoalDraft({ ...goalDraft("water_day", context), unit: "cups" });
  assert.equal(water.ok && water.value.unit, "ml");
});

test("rows from the database and from a Phase 1 database parse into the same shape", () => {
  const v2 = parseGoalRow({ id: "x", title: "Protein", category: "nutrition", metric: "protein_g", period: "daily", direction: "increase", target_value: "130.00", baseline_value: null, unit: "g", starts_on: "2026-11-01", due_on: null, status: "active", notes: null, created_at: "2026-11-01T00:00:00Z", current_value: "70.5", start_value: null, linked_todos: 0, linked_todos_done: 0, period_start: today, period_end: today });
  assert.equal(v2.targetValue, 130);
  assert.equal(v2.currentValue, 70.5);
  assert.equal(v2.period, "daily");
  const v1 = parseGoalRow({ id: "y", title: "Run", category: "fitness", metric: "manual", target_value: 100, current_value: 7, unit: "km", starts_on: "2026-10-01", due_on: null, status: "active", notes: null, created_at: "2026-10-01T00:00:00Z" });
  assert.deepEqual([v1.period, v1.direction, v1.currentValue, v1.metric], ["long_term", "increase", 7, "manual"]);
  const weird = parseGoalRow({ id: "z", title: "Odd", metric: "steps", category: "x", status: "x", target_value: 5 });
  assert.deepEqual([weird.metric, weird.category, weird.status], ["manual", "personal", "active"]);
  const noWeighIn = parseGoalRow({ id: "w", title: "Weight", metric: "body_weight_kg", period: "long_term", target_value: 72, current_value: null });
  assert.equal(noWeighIn.currentValue, null, "a v2 row without a weigh-in stays null, not 0 kg");
});

test("an edit form round-trips the goal", () => {
  const existing = goal({ metric: "calories_kcal", period: "daily", direction: "limit", targetValue: 2000, unit: "kcal", title: "Stay under 2,000 kcal a day", dueOn: "2026-12-31", notes: "Cutting" });
  const draft = draftFromGoal(existing);
  assert.deepEqual([draft.template, draft.target, draft.dueOn, draft.notes], ["calories_day", "2000", "2026-12-31", "Cutting"]);
  const value = validateGoalDraft(draft);
  assert.equal(value.ok && value.value.direction, "limit");
});
