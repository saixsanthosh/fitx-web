import { test } from "node:test";
import assert from "node:assert/strict";
import { applyTransform, fitTransform, liveFrame } from "@/lib/home-workout/live-figure";
import { frameOf, PORTRAIT, squat } from "../form-rules/synthetic";

test("camera landmarks become the figure, mirrored like the picture", () => {
  const frame = frameOf(squat(100), 0, { aspect: PORTRAIT });
  const plain = liveFrame(frame.points, PORTRAIT, false, "left");
  const mirrored = liveFrame(frame.points, PORTRAIT, true, "left");
  assert.ok(plain && mirrored);
  const sum = plain.points.near.knee.x + mirrored.points.near.knee.x;
  assert.ok(Math.abs(sum - PORTRAIT) < 1e-9, "mirrored x is the picture's width minus the plain x");
  assert.equal(plain.points.near.knee.y, mirrored.points.near.knee.y);
  // Limbs seen less clearly than the threshold are left out of the drawing (the far side, side-on).
  const strict = liveFrame(frame.points, PORTRAIT, false, "left", 0.6);
  assert.ok(strict?.hidden.has("far-shin"));
  assert.ok(!strict?.hidden.has("near-shin"));
  assert.ok(!plain.hidden.has("far-shin"), "half-seen limbs are drawn at the default threshold");
});

test("nobody in view gives no figure", () => {
  assert.equal(liveFrame(null, 1, true, null), null);
  assert.equal(liveFrame([], 1, true, null), null);
});

test("the figure is framed to fill the panel with its proportions kept", () => {
  const frame = liveFrame(frameOf(squat(170), 0, { aspect: PORTRAIT }).points, PORTRAIT, true, "left");
  assert.ok(frame);
  const stage = { x: 0, y: 0, width: 400, height: 300 };
  const placed = applyTransform(frame.points, fitTransform(frame.bounds, stage));
  const ys = [placed.near.shoulder.y, placed.near.ankle.y, placed.near.knee.y];
  assert.ok(Math.min(...ys) >= 0 && Math.max(...ys) <= 300);
  assert.ok(placed.near.ankle.y - placed.near.shoulder.y > 180, "a standing figure fills most of the panel's height");
});
