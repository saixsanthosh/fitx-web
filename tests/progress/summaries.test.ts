import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { firstTrackedDay, hasLastWeek, latestMeasurements, measurementSaved, trainingConsistency, weeksFrom, weightSummary, type BodyMetricRow } from "@/lib/data/progress";
import { weeklyTrends } from "@/lib/domain/trends";

const row = (date: string, weight: number | null, extra: Partial<BodyMetricRow> = {}): BodyMetricRow => ({ id: `${date}-${weight}`, date, weight, body_fat: null, measurements: {}, ...extra });

describe("training consistency", () => {
  test("counts finished weeks only, and weeks that reached the member's own plan", () => {
    const weeks = [{ workouts: 0, inProgress: false }, { workouts: 2, inProgress: false }, { workouts: 4, inProgress: false }, { workouts: 5, inProgress: true }];
    assert.deepEqual(trainingConsistency(weeks, 3), { weeks: 3, trainedWeeks: 2, planWeeks: 1, plan: 3, workouts: 6 });
  });
  test("without a plan there is no plan count, not a zero", () => {
    assert.equal(trainingConsistency([{ workouts: 1, inProgress: false }], null).planWeeks, null);
    assert.equal(trainingConsistency([{ workouts: 1, inProgress: false }], 9).plan, null, "an impossible plan is ignored");
  });
});

describe("weeks before the member joined", () => {
  // Friday 20 November 2026; the account was made on Wednesday 11 November, local time.
  const today = "2026-11-20";
  const session = (startedAt: string) => ({ id: startedAt, name: "Upper", status: "completed", started_at: startedAt, completed_at: startedAt, exercises: [] });
  const local = (key: string, hour = 12) => new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)), hour).toISOString();

  test("are neither counted nor drawn: a member who joined last week has one finished week, not eleven", () => {
    const data = { sessions: [session(local("2026-11-12")), session(local("2026-11-13")), session(local("2026-11-19"))], activities: [], foodDays: new Map() };
    const all = weeklyTrends(data, today, 12);
    assert.equal(all.length, 12);
    const from = firstTrackedDay(local("2026-11-11", 9), data);
    assert.equal(from, "2026-11-11");
    const weeks = weeksFrom(all, from);
    assert.deepEqual(weeks.map((week) => week.weekStart), ["2026-11-09", "2026-11-16"]);
    assert.deepEqual(trainingConsistency(weeks, 4), { weeks: 1, trainedWeeks: 1, planWeeks: 0, plan: 4, workouts: 2 });
  });

  test("an earlier logged day (an imported run) counts from that day; nothing known keeps every week", () => {
    const data = { sessions: [], activities: [{ startedAt: local("2026-10-01"), distanceM: 5000, movingSeconds: 1800 }], foodDays: new Map([["2026-10-20", {}]]) };
    assert.equal(firstTrackedDay(local("2026-11-11"), data), "2026-10-01");
    assert.equal(firstTrackedDay(null, { sessions: [], activities: null, foodDays: new Map() }), null);
    const all = weeklyTrends({ sessions: [], activities: [], foodDays: new Map() }, today, 12);
    assert.equal(weeksFrom(all, null).length, 12);
    assert.deepEqual(weeksFrom(all, "2026-11-19").map((week) => week.inProgress), [true], "joined this week: only this week, still running");
  });
});

describe("weight trend", () => {
  // Newest first, as the page reads them.
  const rows = [row("2026-11-20", 70.4), row("2026-11-20", 70.9), row("2026-11-01", null, { body_fat: 18 }), row("2026-10-25", 71.5), row("2026-06-01", 74)];
  test("the later weigh-in of a day counts, unknown weights are skipped, and the change covers the range", () => {
    const month = weightSummary(rows, "2026-11-20", 30);
    assert.deepEqual(month.points, [{ date: "2026-10-25", kg: 71.5 }, { date: "2026-11-20", kg: 70.4 }]);
    assert.equal(month.changeKg, -1.1);
    assert.equal(weightSummary(rows, "2026-11-20", 0).changeKg, -3.6);
  });
  test("one weigh-in has no change; none has no latest", () => {
    assert.equal(weightSummary([row("2026-11-20", 70)], "2026-11-20", 90).changeKg, null);
    assert.equal(weightSummary([], "2026-11-20", 90).latest, null);
  });
});

describe("measurements", () => {
  test("the newest of each, with the change since the first, only for what was logged", () => {
    const rows = [row("2026-11-20", null, { measurements: { waist: 82 } }), row("2026-11-01", 70, { body_fat: 18, measurements: { waist: 84.5, arm: 33 } })];
    assert.deepEqual(latestMeasurements(rows), [
      { name: "body_fat", latest: 18, date: "2026-11-01", changeCm: null, since: null, unit: "%" },
      { name: "arm", latest: 33, date: "2026-11-01", changeCm: null, since: null, unit: "cm" },
      { name: "waist", latest: 82, date: "2026-11-20", changeCm: -2.5, since: "2026-11-01", unit: "cm" },
    ]);
    assert.deepEqual(latestMeasurements([row("2026-11-20", 70)]), [], "a weigh-in alone is no measurement");
  });
});

describe("the Progress page stays minimal", () => {
  const source = (file: string) => readFileSync(new URL(`../../src/app/(dashboard)/progress/${file}`, import.meta.url), "utf8");
  test("keeps what other screens link to, and drops repeated widgets", () => {
    const view = source("ProgressView.tsx");
    assert.match(view, /id="focus-next"/);
    assert.match(view, />This week so far</);
    assert.match(view, /<RecordsSection \/>/);
    assert.match(source("TrendSections.tsx"), />Workouts a week</);
    assert.match(source("ProgressCards.tsx"), /href="\/progress\/muscles\?period=week"/);
    // Food averages live on Nutrition and today's macros on Home; Progress does not repeat them.
    assert.doesNotMatch(view + source("TrendSections.tsx"), /Calories a logged day|Protein a logged day|label: "Calories"/);
    assert.doesNotMatch(view, /MuscleCard|AllTimeCard/);
  });
});

describe("this week against last week", () => {
  // Friday 20 November 2026: this week runs from Monday 16, the same days last week from Monday 9 to Friday 13.
  const today = "2026-11-20";
  test("a member who joined this week has no last week to compare, so no comparison (not a drop to 0)", () => {
    assert.equal(hasLastWeek("2026-11-18", today), false);
    assert.equal(hasLastWeek("2026-11-16", today), false, "joined on Monday");
    assert.equal(hasLastWeek("2026-11-14", today), false, "joined last Saturday: none of last Monday to Friday was tracked");
    assert.equal(hasLastWeek(null, today), false, "nothing known");
  });
  test("compares once some of the same days last week were tracked", () => {
    assert.equal(hasLastWeek("2026-11-13", today), true);
    assert.equal(hasLastWeek("2026-10-01", today), true);
  });
  test("the band leaves the comparison out when there is none", () => {
    const source = readFileSync(new URL("../../src/app/(dashboard)/progress/TrendSections.tsx", import.meta.url), "utf8");
    const view = readFileSync(new URL("../../src/app/(dashboard)/progress/ProgressView.tsx", import.meta.url), "utf8");
    assert.match(source, /compare \? `\$\{label\}: /);
    assert.match(view, /compare: hasLastWeek\(from, today\)/);
    assert.match(view, /derived\?\.compare \? <p className=\{styles\.sectionNote\}>Against the same days last week/);
  });
});

describe("a weigh-in whose profile copy did not save", () => {
  test("keeps the weight to retry, so the page can say the measurement saved but the profile weight did not", () => {
    assert.deepEqual(measurementSaved(63.5, { error: { message: "permission denied" } }), { weighed: true, unsyncedKg: 63.5 });
    assert.deepEqual(measurementSaved(63.5, { error: null }), { weighed: true, unsyncedKg: null });
    assert.deepEqual(measurementSaved(null, null), { weighed: false, unsyncedKg: null }, "a waist size alone has no profile weight");
  });
  test("Progress shows the notice with a retry instead of ignoring the result", () => {
    const body = readFileSync(new URL("../../src/app/(dashboard)/progress/BodySection.tsx", import.meta.url), "utf8");
    assert.match(body, /Measurement saved\. Your profile weight didn't update\./);
    assert.match(body, /measurementSaved\(parsedWeight, synced\)/);
    assert.doesNotMatch(body, /\{ await syncProfileWeight\(db, userId, parsedWeight\); notifyUserContextChanged\(\); \}/);
  });
});
