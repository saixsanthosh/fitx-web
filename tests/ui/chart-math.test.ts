import { test } from "node:test";
import assert from "node:assert/strict";
import { barFractions, labelIndexes, linePoints, pathFor, seriesStats, summarizeSeries } from "@/components/charts/chart-math";

test("seriesStats ignores unknown values", () => {
  assert.deepEqual(seriesStats([null, 4, undefined, 10, 7]), { count: 3, first: 4, last: 7, min: 4, max: 10 });
  assert.equal(seriesStats([]), null);
  assert.equal(seriesStats([null, NaN]), null);
});

test("linePoints spans the box, top is the highest value", () => {
  const { segments } = linePoints([0, 10], 100, 50, 0);
  assert.deepEqual(segments, [[{ x: 0, y: 50 }, { x: 100, y: 0 }]]);
});

test("unknown values break the line instead of being drawn as 0", () => {
  const { segments, points } = linePoints([1, 2, null, 3, 4], 100, 40);
  assert.equal(segments.length, 2);
  assert.equal(points[2], null);
});

test("a single point is centred and a flat series sits in the middle", () => {
  const single = linePoints([5], 100, 40);
  assert.deepEqual(single.segments, [[{ x: 50, y: 20 }]]);
  const flat = linePoints([3, 3, 3], 100, 40);
  assert.ok(flat.points.every((point) => point?.y === 20));
});

test("empty series has no segments", () => {
  assert.deepEqual(linePoints([], 100, 40).segments, []);
  assert.deepEqual(linePoints([null, null], 100, 40).segments, []);
});

test("pathFor writes M then L commands", () => {
  assert.equal(pathFor([{ x: 1, y: 2 }, { x: 3, y: 4 }]), "M1 2 L3 4");
});

test("barFractions scale to the tallest and keep unknown as null", () => {
  assert.deepEqual(barFractions([2, 4, null, 0]), [0.5, 1, null, 0]);
  assert.deepEqual(barFractions([0, 0]), [0, 0]);
  assert.deepEqual(barFractions([null, -1]), [null, null]);
});

test("labelIndexes keeps the last and thins evenly", () => {
  assert.deepEqual(labelIndexes(5, 7), [0, 1, 2, 3, 4]);
  const picked = labelIndexes(30, 6);
  assert.equal(picked[picked.length - 1], 29);
  assert.ok(picked.length <= 6);
  assert.deepEqual(labelIndexes(0, 5), []);
});

test("labelIndexes always keeps the first label when the count does not line up with the step", () => {
  // The exercise page's Volume per session card: up to 8 bars with the default 7 labels.
  assert.deepEqual(labelIndexes(8, 7), [0, 2, 4, 7]);
  assert.deepEqual(labelIndexes(10, 7), [0, 2, 4, 6, 9]);
  assert.deepEqual(labelIndexes(30, 6), [0, 6, 12, 18, 29]);
  assert.deepEqual(labelIndexes(13, 7), [0, 2, 4, 6, 8, 10, 12]);
  assert.deepEqual(labelIndexes(9, 2), [0, 8]);
  assert.deepEqual(labelIndexes(9, 1), [8]);
  for (let count = 1; count <= 60; count++) {
    for (let max = 2; max <= 10; max++) {
      const picked = labelIndexes(count, max);
      const label = `${count} of ${max}`;
      assert.equal(picked[0], 0, label);
      assert.equal(picked[picked.length - 1], count - 1, label);
      assert.ok(picked.length <= max, label);
      for (let i = 1; i < picked.length; i++) {
        assert.ok(picked[i] > picked[i - 1], label);
        if (count > max) assert.ok(picked[i] - picked[i - 1] >= (count - 1) / (max - 1), label);
      }
    }
  }
});

test("summarizeSeries reads out range and flags unknowns", () => {
  const format = (value: number) => `${value} kg`;
  assert.equal(summarizeSeries([], format), "No data yet.");
  assert.match(summarizeSeries([60, null, 70], format, "sessions"), /2 sessions, from 60 kg to 70 kg\. Lowest 60 kg, highest 70 kg\. 1 entry is unknown/);
  assert.match(summarizeSeries([null, 50], format), /One of 2 values is known: 50 kg/);
});
