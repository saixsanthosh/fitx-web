// Review R3X-1: Progress > Weight's change line ("+0.1 lb since 16 Nov") must agree with the readout and the line on
// the same card. Weights typed in pounds are stored to 0.01 kg since bug 6, so the change is worked out in the unit
// shown, from the two weigh-ins as shown, never from a kilogram change rounded to 0.1 kg and then converted.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { periodFor, weightChange, weightView, type WeightPoint } from "@/components/progress/period";
import { weightIn, weightText, weightToKg } from "@/lib/domain/weight-display";

// Friday 20 November 2026.
const TODAY = "2026-11-20";
const round1 = (value: number) => Math.round(value * 10) / 10;

/** Two weigh-ins typed in `unit`, stored as the Log measurement sheet stores them (weightToKg). */
function typed(first: number, last: number, unit: "kg" | "lb"): WeightPoint[] {
  return [{ date: "2026-11-16", kg: weightToKg(first, unit) }, { date: "2026-11-19", kg: weightToKg(last, unit) }];
}

describe("the Weight card's change, in the unit it shows", () => {
  test("pounds: the reviewer's cases read the change that was typed", () => {
    const small = typed(150, 150.1, "lb");
    assert.deepEqual(small.map((point) => point.kg), [68.04, 68.08], "stored to 0.01 kg");
    assert.deepEqual(small.map((point) => weightText(point.kg, "lb")), ["150.0", "150.1"], "the readout and the line");
    assert.equal(weightChange(small, "lb"), 0.1, "was ±0.0 lb");
    assert.equal(weightChange(typed(150, 150.3, "lb"), "lb"), 0.3, "was +0.2 lb");
    assert.equal(weightChange(typed(200, 199.9, "lb"), "lb"), -0.1, "was ±0.0 lb");
    assert.equal(weightChange(typed(150, 151, "lb"), "lb"), 1, "was +0.9 lb");
    assert.equal(weightChange(typed(150, 152.5, "lb"), "lb"), 2.5, "was +2.4 lb");
    assert.equal(weightChange(typed(180.2, 180.9, "lb"), "lb"), 0.7);
    assert.equal(weightChange(typed(165.4, 165.4, "lb"), "lb"), 0);
  });

  test("any two weigh-ins typed to 0.1: the change is the shown last minus the shown first, and what was typed", () => {
    for (const unit of ["lb", "kg"] as const) {
      const [low, high, step] = unit === "lb" ? [67, 400, 3.7] : [30, 200, 1.7];
      for (let first = low; first <= high; first = round1(first + step)) {
        for (let delta = -3; delta <= 3; delta = round1(delta + 0.1)) {
          const points = typed(first, round1(first + delta), unit);
          const shown = points.map((point) => weightIn(point.kg, unit));
          const change = weightChange(points, unit);
          assert.equal(change, round1(shown[1] - shown[0]), `${unit} ${first} then ${round1(first + delta)}`);
          assert.equal(change, delta, `${unit} ${first} then ${round1(first + delta)}`);
        }
      }
    }
  });

  test("kilograms: weigh-ins once typed in pounds still agree with the kilogram readout", () => {
    // 150 and 150.3 lb are stored as 68.04 and 68.17 kg; after a switch to kilograms the card reads 68.0 and 68.2 kg,
    // so the change says +0.2 kg (from the stored kilograms rounded to 0.1 kg it said +0.1).
    const points = typed(150, 150.3, "lb");
    assert.deepEqual(points.map((point) => point.kg), [68.04, 68.17]);
    assert.deepEqual(points.map((point) => weightText(point.kg, "kg")), ["68.0", "68.2"]);
    assert.equal(weightChange(points, "kg"), 0.2);
  });

  test("fewer than two weigh-ins in the period: no change", () => {
    const rows = [{ date: "2026-11-19", weight: 68.08 }, { date: "2026-11-02", weight: 68.04 }];
    const view = weightView(rows, periodFor("week", TODAY));
    assert.equal(view.points.length, 1);
    assert.equal(weightChange(view.points, "lb"), null);
    assert.equal(weightChange([], "kg"), null);
    // Across the month both count, newest first as body_metrics is read.
    assert.equal(weightChange(weightView(rows, periodFor("month", TODAY)).points, "lb"), 0.1);
  });

  test("the card states that change, not a converted kilogram change", () => {
    const source = readFileSync("src/app/(dashboard)/progress/BodySection.tsx", "utf8");
    assert.match(source, /const change = weightChange\(weight\.points, unit\);/);
    assert.match(source, /\{signed\(change\)\} \{unit\}/);
    assert.doesNotMatch(source, /weightIn\(weight\.change/);
  });
});
