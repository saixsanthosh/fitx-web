// "How am I progressing?": food totals with unknown values kept unknown (C11), and the week-by-week numbers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isEstimatedMeal, knownTotal, macroValue, mealTotals, mealTotalsByDay, missingNote } from "@/lib/domain/meal-totals";
import { change, dayRange, periodNumbers, trendsEmpty, weekSoFar, weeklyTrends, type TrendData } from "@/lib/domain/trends";
import { at, exercise, session } from "./support/training";

const TODAY = "2026-11-18"; // a Wednesday

test("a NULL macro, or one the snapshot lists as missing, is unknown and never counted as 0", () => {
  assert.equal(macroValue({ protein: null }, "protein"), null);
  assert.equal(macroValue({ protein: "" }, "protein"), null);
  assert.equal(macroValue({ protein: 0 }, "protein"), 0, "a real zero stays a zero");
  assert.equal(macroValue({ protein: 0, nutrition_snapshot: { missing: ["protein"] } }, "protein"), null, "the snapshot wins over a stored 0");
  assert.equal(macroValue({ protein: "12.5" }, "protein"), 12.5);
  const totals = mealTotals([
    { calories: 300, protein: 20, carbs: 30, fat: 10 },
    { calories: 150, protein: null, carbs: null, fat: 5, nutrition_snapshot: { missing: ["protein", "carbs"] } },
    { calories: 200, protein: 10, carbs: 25, fat: null },
  ]);
  assert.deepEqual(totals.protein, { sum: 30, known: 2, missing: 1 });
  assert.deepEqual(totals.carbs, { sum: 55, known: 2, missing: 1 });
  assert.deepEqual(totals.fat, { sum: 15, known: 2, missing: 1 });
  assert.equal(totals.entries, 3);
  assert.equal(missingNote(totals.protein, "protein"), "1 food has no protein value");
  assert.equal(missingNote(totals.calories, "calories"), "");
  assert.equal(knownTotal(mealTotals([{ protein: null }, { protein: null }]).protein), null, "all unknown: no total, not 0");
});

test("estimates follow the Nutrition log: an estimated value basis or an average portion weight", () => {
  assert.equal(isEstimatedMeal({ source: "FITX catalogue", nutrition_snapshot: { value_basis: "recipe_calculated" } }), true);
  assert.equal(isEstimatedMeal({ source: "FITX catalogue", nutrition_snapshot: { value_basis: "lab_analysed" } }), false);
  assert.equal(isEstimatedMeal({ source: "FITX catalogue", nutrition_snapshot: { value_basis: "label", portion: { estimate: true } } }), true);
  assert.equal(isEstimatedMeal({ source: "Open Food Facts", nutrition_snapshot: {} }), false, "a label value");
  assert.equal(isEstimatedMeal({ source: "FITX custom food", nutrition_snapshot: {} }), false, "the member's own entry");
  assert.equal(mealTotals([{ nutrition_snapshot: { value_basis: "ai_suggested" } }, { nutrition_snapshot: { value_basis: "compiled" } }]).estimated, 1);
});

test("food is grouped by its logged day; days without entries are absent", () => {
  const days = mealTotalsByDay([{ date: "2026-11-16", protein: 40 }, { date: "2026-11-16", protein: 30 }, { date: "2026-11-17", protein: null }, { protein: 10 }]);
  assert.deepEqual([...days.keys()], ["2026-11-16", "2026-11-17"], "a row without a date is skipped");
  assert.equal(days.get("2026-11-16")?.protein.sum, 70);
  assert.equal(days.has("2026-11-18"), false);
});

function data(overrides: Partial<TrendData> = {}): TrendData {
  return { sessions: [], activities: [], foodDays: new Map(), ...overrides };
}

test("a period counts completed workouts, ticked sets and weighted volume; nothing logged is not zero volume", () => {
  const numbers = periodNumbers(data({
    sessions: [
      session("2026-11-16", [exercise("bench_press", "2026-11-16", 3, { reps: 8, kg: 60 }), exercise("plank", "2026-11-16", 2, { reps: null, kg: null, seconds: 45 }, { timed: 45 })]),
      session("2026-11-17", [exercise("push_up", "2026-11-17", 3, { reps: 12, kg: 0 }), exercise("curl", "2026-11-17", 2, { done: false })]),
      session("2026-11-17", [exercise("squat", "2026-11-17", 4)], "abandoned"),
    ],
  }), "2026-11-16", TODAY);
  assert.equal(numbers.workouts, 2, "the abandoned session does not count");
  assert.equal(numbers.sets, 8, "3 bench + 2 timed planks + 3 push-ups; unticked curls do not count");
  assert.equal(numbers.volumeKg, 1440, "only weighted lift sets: 3 × 8 × 60 kg");
  const bodyweight = periodNumbers(data({ sessions: [session("2026-11-17", [exercise("push_up", "2026-11-17", 3, { reps: 12, kg: 0 })])] }), "2026-11-16", TODAY);
  assert.equal(bodyweight.volumeKg, null, "a body-weight week has no volume rather than 0 kg");
  assert.equal(bodyweight.sets, 3);
});

test("activities add count, distance and moving time; unreadable activities stay unknown", () => {
  const activities = [
    { startedAt: at("2026-11-16", 7), distanceM: 5200, movingSeconds: 1800 },
    { startedAt: at("2026-11-18", 7), distanceM: 2400.4, movingSeconds: 900 },
    { startedAt: at("2026-11-12", 7), distanceM: 9000, movingSeconds: 3000 },
  ];
  const numbers = periodNumbers(data({ activities }), "2026-11-16", TODAY);
  assert.deepEqual([numbers.activities, numbers.distanceM, numbers.movingSeconds], [2, 7600, 2700]);
  const unknown = periodNumbers(data({ activities: null }), "2026-11-16", TODAY);
  assert.deepEqual([unknown.activities, unknown.distanceM, unknown.movingSeconds], [null, null, null]);
});

test("food averages run over logged days only, leave unknown values out and count them", () => {
  const foodDays = mealTotalsByDay([
    { date: "2026-11-16", calories: 2000, protein: 100 },
    { date: "2026-11-17", calories: 1800, protein: 60 },
    { date: "2026-11-17", calories: 200, protein: null },
    { date: "2026-11-18", calories: 500, protein: null },
  ]);
  const numbers = periodNumbers(data({ foodDays }), "2026-11-16", "2026-11-19");
  assert.equal(numbers.loggedDays, 3, "the 19th has nothing logged and is not a zero day");
  assert.deepEqual(numbers.calories, { average: 1500, days: 3, missingEntries: 0 });
  assert.deepEqual(numbers.protein, { average: 80, days: 2, missingEntries: 2 }, "the 18th has no known protein: left out, not 0");
  const none = periodNumbers(data(), "2026-11-16", TODAY);
  assert.deepEqual(none.protein, { average: null, days: 0, missingEntries: 0 }, "an average of nothing is unknown");
});

test("weeks run Monday to Sunday, oldest first, and this week runs to today", () => {
  const weeks = weeklyTrends(data({
    sessions: [session("2026-11-09", [exercise("squat", "2026-11-09")]), session(TODAY, [exercise("squat", TODAY)])],
  }), TODAY, 3);
  assert.deepEqual(weeks.map((week) => [week.weekStart, week.to, week.inProgress, week.workouts]), [
    ["2026-11-02", "2026-11-08", false, 0],
    ["2026-11-09", "2026-11-15", false, 1],
    ["2026-11-16", TODAY, true, 1],
  ]);
  assert.equal(trendsEmpty(weeks), false);
  assert.equal(trendsEmpty(weeklyTrends(data(), TODAY, 4)), true);
});

test("this week so far is compared with the same days of last week", () => {
  const sofar = weekSoFar(data({
    sessions: [
      session("2026-11-09", [exercise("squat", "2026-11-09")]),
      session("2026-11-13", [exercise("squat", "2026-11-13")]),
      session("2026-11-17", [exercise("squat", "2026-11-17")]),
    ],
  }), TODAY);
  assert.equal(sofar.days, 3);
  assert.deepEqual([sofar.current.from, sofar.current.to], ["2026-11-16", TODAY]);
  assert.deepEqual([sofar.previous.from, sofar.previous.to], ["2026-11-09", "2026-11-11"], "Friday the 13th is after this point last week");
  assert.equal(sofar.previous.workouts, 1);
  assert.deepEqual(change(1, 3), { difference: -2, direction: "down" });
  assert.deepEqual(change(2, 2), { difference: 0, direction: "same" });
  assert.equal(change(null, 3), null, "an unknown side has no change");
  assert.deepEqual(dayRange("2026-11-30", "2026-12-02"), ["2026-11-30", "2026-12-01", "2026-12-02"]);
});
