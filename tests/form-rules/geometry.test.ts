import { test } from "node:test";
import assert from "node:assert/strict";
import { angleAt, offsetFromLine, riseAbove, tiltFromHorizontal, tiltFromVertical, toPlane } from "@/lib/pose/geometry";
import { isConfident, landmarkIndex, LANDMARK } from "@/lib/pose/landmarks";
import { OneEuroFilter } from "@/lib/pose/smoothing";
import { seeded } from "./synthetic";

const close = (actual: number, expected: number, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`);

test("angles are measured in square pixels, not stretched image fractions", () => {
  close(angleAt({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 }), 90);
  close(angleAt({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }), 180);
  // In a 16:9 image, normalised (0.5625, 0) and (0, 1) are equally far from the origin.
  const aspect = 16 / 9;
  const a = toPlane({ x: 0.5625, y: 0 }, aspect);
  const c = toPlane({ x: 0.5625, y: 1 }, aspect);
  close(angleAt(a, { x: 0, y: 0 }, c), 45, 1e-9);
  assert.ok(Number.isNaN(angleAt({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 })));
});

test("tilt reads 0 for upright and 90 for flat, whichever way the segment points", () => {
  close(tiltFromVertical({ x: 0, y: 1 }, { x: 0, y: 0 }), 0);
  close(tiltFromVertical({ x: 0, y: 0 }, { x: 1, y: 0 }), 90);
  close(tiltFromVertical({ x: 1, y: 1 }, { x: 0, y: 0 }), 45);
  close(tiltFromHorizontal({ x: 2, y: 0 }, { x: 0, y: 0 }), 0);
});

test("line offset is positive below the line whichever end the line starts from", () => {
  const shoulder = { x: 1, y: 0.5 };
  const ankle = { x: 0, y: 0.6 };
  const sagging = { x: 0.5, y: 0.65 };
  const piked = { x: 0.5, y: 0.45 };
  assert.ok(offsetFromLine(shoulder, ankle, sagging) > 0);
  assert.ok(offsetFromLine(ankle, shoulder, sagging) > 0);
  assert.ok(offsetFromLine(shoulder, ankle, piked) < 0);
  close(offsetFromLine({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 0.1 }), 0.1);
  close(riseAbove({ x: 0, y: 1 }, { x: 0, y: 0.5 }, 0.5), 1);
});

test("a landmark counts as seen only when visible, present and inside the picture", () => {
  assert.equal(isConfident({ x: 0.5, y: 0.5, visibility: 0.9, presence: 0.9 }), true);
  assert.equal(isConfident({ x: 0.5, y: 0.5, visibility: 0.4, presence: 0.9 }), false);
  assert.equal(isConfident({ x: 0.5, y: 0.5, visibility: 0.9, presence: 0.3 }), false);
  assert.equal(isConfident({ x: 1.2, y: 0.5, visibility: 0.9 }), false);
  assert.equal(isConfident({ x: 0.5, y: -0.1, visibility: 0.9 }), false);
  assert.equal(isConfident(undefined), false);
  assert.equal(isConfident({ x: Number.NaN, y: 0.5, visibility: 1 }), false);
  assert.equal(landmarkIndex("knee", "right"), LANDMARK.rightKnee);
});

test("the One Euro filter steadies a still value and follows a fast one", () => {
  const random = seeded(5);
  const filter = new OneEuroFilter(1, 0.03);
  let rawSpread = 0;
  let smoothSpread = 0;
  for (let i = 0; i < 300; i += 1) {
    const raw = 150 + (random() - 0.5) * 8;
    const out = filter.filter(raw, i * 33);
    if (i > 30) {
      rawSpread = Math.max(rawSpread, Math.abs(raw - 150));
      smoothSpread = Math.max(smoothSpread, Math.abs(out - 150));
    }
  }
  assert.ok(smoothSpread < rawSpread / 2, `jitter ${rawSpread.toFixed(2)} → ${smoothSpread.toFixed(2)}`);

  const fast = new OneEuroFilter(1, 0.03);
  let value = 0;
  for (let i = 0; i <= 10; i += 1) value = fast.filter(i < 2 ? 170 : 90, i * 33);
  assert.ok(value < 100, `a 80° drop is followed within a quarter second (at ${value.toFixed(1)})`);
  assert.equal(fast.filter(50, 330), value, "a repeated timestamp returns the last value");
  fast.reset();
  assert.equal(fast.filter(42, 400), 42);
});
