import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHistory, dateKeyOf, lastDays, type HistoryEntry } from "@/lib/domain/nutrition-history";

const entry = (date: string, calories: number, protein: number | null, carbs: number | null, fat: number | null, estimated = false): HistoryEntry => ({ date, calories, protein, carbs, fat, estimated });

test("lastDays lists local calendar dates ending on the given day", () => {
  assert.deepEqual(lastDays(new Date(2026, 10, 18), 3), ["2026-11-16", "2026-11-17", "2026-11-18"]);
  assert.deepEqual(lastDays(new Date(2026, 2, 2), 3), ["2026-02-28", "2026-03-01", "2026-03-02"]);
  assert.equal(dateKeyOf(new Date(2026, 0, 5)), "2026-01-05");
});

const dates = lastDays(new Date(2026, 10, 18), 7);

test("a day with nothing logged is a gap and does not drag the averages to 0", () => {
  const history = buildHistory([entry("2026-11-18", 2000, 100, 250, 60), entry("2026-11-16", 1800, 90, 200, 50)], dates, null);
  assert.equal(history.loggedDays, 2);
  assert.deepEqual(history.averages, { calories: 1900, protein: 95, carbs: 225, fat: 55 });
  const gap = history.days.find((day) => day.date === "2026-11-17");
  assert.deepEqual([gap?.logged, gap?.entries, gap?.calories], [false, 0, 0]);
  assert.equal(history.adherence, null, "no targets, no adherence");
});

test("with nothing logged there are no averages at all", () => {
  const history = buildHistory([], dates, { calories: 2000, protein: 100 });
  assert.equal(history.loggedDays, 0);
  assert.equal(history.averages, null);
  assert.equal(history.adherence, null);
});

test("unknown values are left out of a day's total and disclosed, not averaged as 0", () => {
  const history = buildHistory([entry("2026-11-18", 500, 30, 40, null), entry("2026-11-18", 300, 10, 20, 5), entry("2026-11-17", 400, null, 30, 10)], dates, null);
  const today = history.days[6];
  assert.deepEqual([today.fat, today.unknown.fat, today.entries], [5, 1, 2]);
  assert.deepEqual(history.daysWithUnknown, { protein: 1, carbs: 0, fat: 1 });
  // 17 Nov has no protein value at all, so the protein average is over 18 Nov alone (not 40 and 0 averaged to 20).
  assert.deepEqual(history.averages, { calories: 600, protein: 40, carbs: 45, fat: 8 });
});

test("a macro no logged day has a value for has no average, not 0", () => {
  const history = buildHistory([entry("2026-11-18", 500, 30, 40, null), entry("2026-11-17", 400, 20, 30, null)], dates, null);
  assert.deepEqual(history.averages, { calories: 450, protein: 25, carbs: 35, fat: null });
  const mixed = buildHistory([entry("2026-11-18", 2000, 120, 250, 60), entry("2026-11-17", 900, null, null, null)], dates, null);
  assert.deepEqual(mixed.averages, { calories: 1450, protein: 120, carbs: 250, fat: 60 });
});

test("a calorie goal alone gives calorie adherence and no protein adherence", () => {
  const history = buildHistory([entry("2026-11-18", 1950, 80, 0, 0), entry("2026-11-17", 2500, 200, 0, 0)], dates, { calories: 2000, protein: null });
  assert.deepEqual(history.adherence, { calorieDays: 1, proteinDays: null, proteinUnknownDays: null });
  assert.deepEqual(history.days.slice(5).map((day) => day.proteinState), [null, null]);
  const proteinOnly = buildHistory([entry("2026-11-18", 1950, 80, 0, 0)], dates, { calories: null, protein: 60 });
  assert.deepEqual(proteinOnly.adherence, { calorieDays: null, proteinDays: 1, proteinUnknownDays: 0 });
  assert.equal(buildHistory([entry("2026-11-18", 1950, 80, 0, 0)], dates, { calories: null, protein: 0 }).adherence, null, "no positive target, no adherence");
});

test("adherence is within 10 percent of the calorie target, and protein met, per logged day", () => {
  const targets = { calories: 2000, protein: 100 };
  const history = buildHistory([
    entry("2026-11-18", 2100, 110, 0, 0),
    entry("2026-11-17", 1700, 120, 0, 0),
    entry("2026-11-16", 2300, 50, 0, 0),
    entry("2026-11-15", 1850, 40, 0, null),
    entry("2026-11-15", 100, null, 0, 0),
  ], dates, targets);
  const states = history.days.filter((day) => day.logged).map((day) => [day.date, day.caloriesState, day.proteinState]);
  assert.deepEqual(states, [
    ["2026-11-15", "within", "unknown"],
    ["2026-11-16", "over", "below"],
    ["2026-11-17", "under", "met"],
    ["2026-11-18", "within", "met"],
  ]);
  assert.deepEqual(history.adherence, { calorieDays: 2, proteinDays: 2, proteinUnknownDays: 1 });
});

test("estimates are counted", () => {
  const history = buildHistory([entry("2026-11-18", 500, 1, 1, 1, true), entry("2026-11-18", 500, 1, 1, 1, false)], dates, null);
  assert.deepEqual([history.estimatedEntries, history.totalEntries], [1, 2]);
});
