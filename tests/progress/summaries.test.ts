import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { latestMeasurements, trainingConsistency, weightSummary, type BodyMetricRow } from "@/lib/data/progress";

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
      { name: "body_fat", latest: 18, date: "2026-11-01", changeCm: null, unit: "%" },
      { name: "arm", latest: 33, date: "2026-11-01", changeCm: null, unit: "cm" },
      { name: "waist", latest: 82, date: "2026-11-20", changeCm: -2.5, unit: "cm" },
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
