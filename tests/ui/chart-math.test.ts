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

test("summarizeSeries reads out range and flags unknowns", () => {
  const format = (value: number) => `${value} kg`;
  assert.equal(summarizeSeries([], format), "No data yet.");
  assert.match(summarizeSeries([60, null, 70], format, "sessions"), /2 sessions, from 60 kg to 70 kg\. Lowest 60 kg, highest 70 kg\. 1 entry is unknown/);
  assert.match(summarizeSeries([null, 50], format), /One of 2 values is known: 50 kg/);
});
