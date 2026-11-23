import { test } from "node:test";
import assert from "node:assert/strict";
import type { PosePoint } from "@/lib/pose/landmarks";
import { LANDMARK } from "@/lib/pose/landmarks";
import { LandmarkStabiliser, torsoLength } from "@/lib/pose/tracking";

/** A standing body side-on (near = left landmarks), shifted by `dx`, with the wrist at `wrist`. */
function body(options: { dx?: number; wrist?: { x: number; y: number }; swapLegs?: boolean } = {}): PosePoint[] {
  const dx = options.dx ?? 0;
  const points: PosePoint[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.05 }));
  const set = (index: number, x: number, y: number, visibility = 0.95) => {
    points[index] = { x: x + dx, y, visibility };
  };
  set(LANDMARK.nose, 0.52, 0.15);
  set(LANDMARK.leftShoulder, 0.5, 0.28);
  set(LANDMARK.rightShoulder, 0.48, 0.27, 0.6);
  set(LANDMARK.leftElbow, 0.52, 0.42);
  set(LANDMARK.rightElbow, 0.5, 0.41, 0.6);
  set(LANDMARK.leftWrist, options.wrist?.x ?? 0.53, options.wrist?.y ?? 0.55);
  set(LANDMARK.rightWrist, 0.51, 0.54, 0.6);
  set(LANDMARK.leftHip, 0.5, 0.55);
  set(LANDMARK.rightHip, 0.48, 0.54, 0.6);
  // Legs mid-stride: near leg forward, far leg back.
  const near = { knee: [0.56, 0.72], ankle: [0.6, 0.9] };
  const far = { knee: [0.42, 0.72], ankle: [0.38, 0.9] };
  const [l, r] = options.swapLegs ? [far, near] : [near, far];
  set(LANDMARK.leftKnee, l.knee[0], l.knee[1]);
  set(LANDMARK.rightKnee, r.knee[0], r.knee[1], 0.6);
  set(LANDMARK.leftAnkle, l.ankle[0], l.ankle[1]);
  set(LANDMARK.rightAnkle, r.ankle[0], r.ankle[1], 0.6);
  return points;
}

test("torso length is measured from the shoulders and hips", () => {
  const length = torsoLength(body(), 1);
  assert.ok(length !== null && Math.abs(length - 0.27) < 0.01, String(length));
  assert.equal(torsoLength(Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 })), 1), null);
});

test("a landmark leaping further than a body can move in one frame is not believed", () => {
  const stabiliser = new LandmarkStabiliser();
  for (let t = 0; t < 300; t += 33) stabiliser.stabilise(body(), 1, t);
  const glitch = stabiliser.stabilise(body({ wrist: { x: 0.9, y: 0.1 } }), 1, 333);
  assert.equal(glitch.rejected, 1);
  assert.equal(glitch.points[LANDMARK.leftWrist].visibility, 0, "marked unseen for this frame, so nothing is counted from it");
  const back = stabiliser.stabilise(body(), 1, 366);
  assert.equal(back.rejected, 0);
  assert.equal(back.points[LANDMARK.leftWrist].visibility, 0.95);
});

test("a real move that lasts is accepted after a few frames", () => {
  const stabiliser = new LandmarkStabiliser({ confirmFrames: 3 });
  for (let t = 0; t < 300; t += 33) stabiliser.stabilise(body(), 1, t);
  const moved = { x: 0.9, y: 0.1 };
  const results = [366, 399, 432].map((t) => stabiliser.stabilise(body({ wrist: moved }), 1, t));
  assert.deepEqual(results.map((r) => r.points[LANDMARK.leftWrist].visibility), [0, 0, 0.95]);
});

test("fast but possible movement is never rejected", () => {
  const stabiliser = new LandmarkStabiliser();
  let rejected = 0;
  // The whole body steps sideways at 1.5 torso lengths a second (a quick jumping jack is slower than this).
  for (let t = 0; t <= 1000; t += 33) rejected += stabiliser.stabilise(body({ dx: (t / 1000) * 0.4 }), 1, t).rejected;
  assert.equal(rejected, 0);
});

test("legs that trade places for a frame or two are swapped back; a lasting swap is accepted", () => {
  const stabiliser = new LandmarkStabiliser({ confirmFrames: 3 });
  for (let t = 0; t < 300; t += 33) stabiliser.stabilise(body(), 1, t);
  const swapped = stabiliser.stabilise(body({ swapLegs: true }), 1, 333);
  assert.equal(swapped.unswapped, 1);
  assert.ok(Math.abs(swapped.points[LANDMARK.leftKnee].x - 0.56) < 1e-9, "the near knee is back on the near side");
  const after = [366, 399].map((t) => stabiliser.stabilise(body({ swapLegs: true }), 1, t));
  assert.equal(after[0].unswapped, 1);
  assert.equal(after[1].unswapped, 0, "after three frames the new sides are believed");
  assert.ok(Math.abs(after[1].points[LANDMARK.leftKnee].x - 0.42) < 1e-9);
});

test("the smoothed copy for drawing steadies a jittering landmark", () => {
  const stabiliser = new LandmarkStabiliser();
  let rawSpread = 0;
  let smoothSpread = 0;
  let previousRaw = 0.53;
  let previousSmooth = 0.53;
  for (let i = 0; i < 60; i += 1) {
    const x = 0.53 + (i % 2 ? 0.006 : -0.006);
    const result = stabiliser.stabilise(body({ wrist: { x, y: 0.55 } }), 1, i * 33);
    if (i > 10) {
      rawSpread += Math.abs(x - previousRaw);
      smoothSpread += Math.abs(result.smooth[LANDMARK.leftWrist].x - previousSmooth);
    }
    previousRaw = x;
    previousSmooth = result.smooth[LANDMARK.leftWrist].x;
  }
  assert.ok(smoothSpread < rawSpread * 0.5, `smooth ${smoothSpread.toFixed(4)} vs raw ${rawSpread.toFixed(4)}`);
});
