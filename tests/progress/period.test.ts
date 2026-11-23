import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { MealTotals } from "@/lib/domain/meal-totals";
import type { LoggedSession } from "@/lib/training/muscle-history";
import {
  calendarDays, comparisonLabel, currentStreak, delta, highlights, indexDays, noHistory, nutritionSeries, periodBuckets, periodFor,
  periodSummary, previousSummary, strengthGains, trainingDaysAnswered, trainingSeries, weightView, yearMonths,
} from "@/components/progress/period";

// Friday 20 November 2026, on the browser's calendar.
const TODAY = "2026-11-20";
const local = (key: string, hour = 12, minute = 0) => new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)), hour, minute).toISOString();

function session(day: string, sets: Array<{ reps: number; kg: number | null }>, extra: Partial<LoggedSession> = {}): LoggedSession {
  return {
    id: `${day}-${sets.length}-${extra.status ?? "completed"}`,
    name: "Upper",
    status: "completed",
    started_at: local(day, 9),
    completed_at: local(day, 10),
    exercises: [{
      id: `${day}-e`, exercise_id: "bench_press", name: "Bench Press", target_duration_seconds: null, library: null,
      sets: sets.map((set, index) => ({ id: `${day}-${index}`, reps: set.reps, weight_kg: set.kg, duration_seconds: null, completed_at: local(day, 9, index + 1) })),
    }],
    ...extra,
  } as unknown as LoggedSession;
}

function food(calories: number | null, protein: number | null, entries = 1): MealTotals {
  const part = (value: number | null) => ({ sum: value ?? 0, known: value === null ? 0 : entries, missing: value === null ? entries : 0 });
  return { entries, estimated: 0, calories: part(calories), protein: part(protein), carbs: part(null), fat: part(null) };
}

describe("periods", () => {
  test("a week runs Monday to Sunday, ends today while it runs, and names itself", () => {
    const week = periodFor("week", TODAY);
    assert.deepEqual([week.from, week.to, week.end, week.label, week.isCurrent], ["2026-11-16", "2026-11-22", TODAY, "This week", true]);
    const last = periodFor("week", TODAY, -1);
    assert.deepEqual([last.from, last.to, last.end, last.label], ["2026-11-09", "2026-11-15", "2026-11-15", "Last week"]);
    assert.equal(periodFor("week", TODAY, -2).label, "2 – 8 Nov");
    assert.equal(periodFor("week", TODAY, 3).offset, 0, "the future is never shown");
  });
  test("months and years, across a year boundary", () => {
    const month = periodFor("month", "2026-01-10", -1);
    assert.deepEqual([month.from, month.to, month.label], ["2025-12-01", "2025-12-31", "December 2025"]);
    const feb = periodFor("month", "2028-02-10");
    assert.equal(feb.to, "2028-02-29", "a leap February");
    const year = periodFor("year", TODAY);
    assert.deepEqual([year.from, year.to, year.end, year.label], ["2026-01-01", "2026-12-31", TODAY, "2026"]);
    assert.equal(comparisonLabel(year), "last year");
    assert.equal(comparisonLabel(periodFor("month", TODAY, -2)), "August 2026");
  });
  test("buckets: days for a week or month, months for a year; days ahead are future", () => {
    const week = periodBuckets(periodFor("week", TODAY));
    assert.equal(week.length, 7);
    assert.deepEqual(week.map((bucket) => bucket.future), [false, false, false, false, false, true, true]);
    assert.equal(periodBuckets(periodFor("month", TODAY)).length, 30);
    const year = periodBuckets(periodFor("year", TODAY));
    assert.equal(year.length, 12);
    assert.equal(year[11].future, true, "December is ahead on 20 November");
  });
});

describe("what a period holds", () => {
  const sessions = [
    session("2026-11-16", [{ reps: 8, kg: 60 }, { reps: 8, kg: 60 }]),
    session("2026-11-18", [{ reps: 12, kg: null }]),
    session("2026-11-19", [{ reps: 5, kg: 100 }], { status: "abandoned" } as Partial<LoggedSession>),
    session("2026-11-10", [{ reps: 8, kg: 50 }]),
  ];
  const activities = [
    { startedAt: local("2026-11-17", 7), distanceM: 5200, movingSeconds: 1740, kcalEstimate: 320 },
    { startedAt: local("2026-11-19", 7), distanceM: 3000, movingSeconds: 1200, kcalEstimate: null },
  ];
  const foodDays = new Map<string, MealTotals>([["2026-11-16", food(2000, 100)], ["2026-11-17", food(1800, null)], ["2026-11-11", food(2200, 90)]]);
  const index = indexDays(sessions, activities);
  const week = periodFor("week", TODAY);

  test("counts finished workouts, lifted volume, activities and recorded calories only", () => {
    const summary = periodSummary(week, index, foodDays, true);
    assert.equal(summary.workouts, 2, "the abandoned workout is not counted");
    assert.equal(summary.volumeKg, 960, "8 x 60 twice; body-weight sets lift no volume");
    assert.equal(summary.activities, 2);
    assert.equal(summary.distanceM, 8200);
    assert.equal(summary.kcalBurned, 320, "only the activity that recorded an estimate");
    assert.equal(summary.kcalActivities, 1);
    assert.equal(summary.activeDays, 4);
    assert.equal(summary.loggedDays, 2);
    assert.equal(summary.calories.average, 1900);
    assert.deepEqual(summary.protein, { average: 100, days: 1, missingEntries: 1 }, "a day without protein is left out, never 0");
    assert.equal(summary.longestStreak, 4);
  });
  test("unknown stays unknown: no activities read, no weighted sets, no recorded calories", () => {
    const summary = periodSummary(week, indexDays(sessions, null), foodDays, false);
    assert.equal(summary.activities, null);
    assert.equal(summary.distanceM, null);
    assert.equal(summary.kcalBurned, null);
    const bodyweight = periodSummary(week, indexDays([session("2026-11-18", [{ reps: 12, kg: null }])], []), new Map(), true);
    assert.equal(bodyweight.volumeKg, null, "a body-weight week shows a dash, not 0 kg");
    assert.equal(bodyweight.kcalBurned, null);
    assert.equal(bodyweight.calories.average, null);
  });
  test("the period before covers the same days, and is unknown before the member started", () => {
    const before = previousSummary(week, index, foodDays, true, "2026-11-01");
    assert.ok(before);
    assert.equal(before.days, 5, "Monday to Friday of last week, as this week so far");
    assert.equal(before.workouts, 1);
    assert.equal(previousSummary(week, index, foodDays, true, "2026-11-16"), null, "joined this week: no comparison");
    assert.equal(previousSummary(week, index, foodDays, true, null), null);
    assert.deepEqual(delta(3, 1), { difference: 2, direction: "up" });
    assert.equal(delta(null, 1), null);
    assert.equal(delta(3, undefined), null);
  });
  test("chart series: real zeros for counts, nothing for days ahead, gaps where food was not logged", () => {
    const workouts = trainingSeries(week, index, "workouts", true);
    assert.deepEqual(workouts.map((point) => point.value), [1, 0, 1, 0, 0, null, null]);
    assert.deepEqual(trainingSeries(week, index, "distance", false).map((point) => point.value), [null, null, null, null, null, null, null]);
    assert.deepEqual(trainingSeries(week, index, "distance", true).map((point) => point.value).slice(0, 5), [0, 5.2, 0, 3, 0]);
    assert.deepEqual(nutritionSeries(week, foodDays, "calories").map((point) => point.value), [2000, 1800, null, null, null, null, null]);
    const year = trainingSeries(periodFor("year", TODAY), index, "workouts", true);
    assert.equal(year[10].value, 3, "November: three finished workouts");
    assert.equal(year[11].value, null);
  });
  test("the calendar pads the month to its weekday and rings food against the target", () => {
    const month = calendarDays(periodFor("month", TODAY), index, foodDays, 2000);
    assert.equal(month.filter((day) => day === null).length, 6, "1 November 2026 is a Sunday");
    const monday = month.find((day) => day?.key === "2026-11-16");
    assert.equal(monday?.active, true);
    assert.equal(monday?.foodPercent, 100);
    assert.equal(month.find((day) => day?.key === "2026-11-21")?.future, true);
    assert.equal(calendarDays(periodFor("month", TODAY), index, foodDays, null).find((day) => day?.key === "2026-11-16")?.foodPercent, null, "no target, no percentage");
    const months = yearMonths(periodFor("year", TODAY), index, foodDays);
    assert.equal(months[10].activeDays, 5, "10, 16, 17, 18 and 19 November; a food-only day is not active");
    assert.equal(months[10].days, 20);
    assert.equal(months[11].future, true);
  });
  test("streaks and an empty history", () => {
    assert.equal(currentStreak(index, TODAY), 4, "nothing yet today does not break it: Monday to Thursday");
    assert.equal(currentStreak(index, "2026-11-21"), 0, "a whole day without anything does");
    assert.equal(noHistory(new Map(), new Map(), 0), true);
    assert.equal(noHistory(index, foodDays, 0), false);
    assert.equal(noHistory(new Map(), new Map(), 1), false, "a weigh-in is history");
  });
  test("highlights say only what the numbers show", () => {
    const current = periodSummary(week, index, foodDays, true);
    const before = previousSummary(week, index, foodDays, true, "2026-11-01");
    const lines = highlights({ period: week, current, previous: before, proteinTarget: 120, plan: 4 });
    assert.ok(lines.some((line) => line.text === "1 workout more than last week"));
    assert.ok(lines.some((line) => line.text === "Longest streak: 4 active days"));
    assert.ok(lines.length <= 3);
    assert.deepEqual(highlights({ period: week, current: periodSummary(week, new Map(), new Map(), true), previous: null, proteinTarget: null, plan: null }), []);
  });
  test("the weekly plan is the member's own answer only after the Workouts setup", () => {
    const lists = (home: boolean, gym: boolean) => ({ home: { saved: home }, gym: { saved: gym } });
    // Onboarding writes the preferences row (time zone) without asking for days: its 3 is the column default.
    assert.equal(trainingDaysAnswered({ hasPreferences: true, equipmentLists: lists(false, false) }), false);
    assert.equal(trainingDaysAnswered({ hasPreferences: false, equipmentLists: lists(true, false) }), false);
    assert.equal(trainingDaysAnswered(null), false);
    assert.equal(trainingDaysAnswered({ hasPreferences: true, equipmentLists: lists(true, false) }), true);
    assert.equal(trainingDaysAnswered({ hasPreferences: true, equipmentLists: lists(false, true) }), true);
    const current = periodSummary(week, index, foodDays, true);
    const unanswered = highlights({ period: week, current, previous: null, proteinTarget: null, plan: null });
    assert.ok(!unanswered.some((line) => line.id === "plan"), "no 'sessions to hit your 3 a week' for a target nobody set");
  });
});

describe("weight and strength", () => {
  test("weigh-ins in the period, the latest before its end, and the change", () => {
    const rows = [
      { date: "2026-11-19", weight: 71.2 },
      { date: "2026-11-19", weight: 75 },
      { date: "2026-11-16", weight: "71.8" },
      { date: "2026-11-02", weight: 72.5 },
      { date: "2026-10-30", weight: null },
    ];
    const view = weightView(rows, periodFor("week", TODAY));
    assert.deepEqual(view.points, [{ date: "2026-11-16", kg: 71.8 }, { date: "2026-11-19", kg: 71.2 }], "the newer row of a day wins");
    assert.equal(view.changeKg, -0.6);
    const last = weightView(rows, periodFor("week", TODAY, -1));
    assert.deepEqual(last.points, []);
    assert.deepEqual(last.latest, { date: "2026-11-02", kg: 72.5 });
    assert.equal(last.changeKg, null);
  });
  test("strength gains: the estimated one-rep max of the latest session against the first", () => {
    const sessions = [
      session("2026-11-02", [{ reps: 5, kg: 80 }]),
      session("2026-11-16", [{ reps: 5, kg: 85 }, { reps: 8, kg: 70 }]),
      session("2026-11-18", [{ reps: 10, kg: null }]),
    ];
    const gains = strengthGains(sessions, "2026-11-01", TODAY);
    assert.equal(gains.length, 1);
    assert.equal(gains[0].name, "Bench Press");
    assert.equal(gains[0].sessions, 2);
    assert.ok(gains[0].changeKg > 0);
    assert.deepEqual(strengthGains(sessions, "2026-11-10", TODAY), [], "one session in the period is no comparison");
  });
});
