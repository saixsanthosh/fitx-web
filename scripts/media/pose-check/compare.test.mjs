// The pose check's judgement with landmark fixtures (the harness itself runs in the browser lane: run.mjs --self-test).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LANDMARK, MAX_ANGLE_DIFF, MIN_MOVEMENT, MIN_VISIBILITY, angleAt, comparePair, focusFor, jointAngle, primaryJoints, swapped, torsoTilt } from "./compare.mjs";
import { isStale, keepAlive, releaseHeavySlot, tryLock, STALE_MS } from "./lane.mjs";

/** A standing figure, facing the camera (its left on the image's right), arms at `arm` degrees from the body, knees bent by `knee`. */
function figure({ arm = 10, knee = 0, visibility = 0.95, mirror = false, lying = false } = {}) {
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility }));
  const set = (name, x, y) => { points[LANDMARK[name]] = { x: mirror ? 1 - x : x, y, z: 0, visibility }; };
  const rad = (deg) => (deg * Math.PI) / 180;
  for (const [side, sign] of [["left", 1], ["right", -1]]) {
    const sx = 0.5 + sign * 0.1, hx = sx;
    set(`${side}Shoulder`, sx, 0.3);
    set(`${side}Elbow`, sx + sign * Math.sin(rad(arm)) * 0.15, 0.3 + Math.cos(rad(arm)) * 0.15);
    set(`${side}Wrist`, sx + sign * Math.sin(rad(arm)) * 0.3, 0.3 + Math.cos(rad(arm)) * 0.3);
    set(`${side}Hip`, hx, 0.55);
    set(`${side}Knee`, hx, 0.72);
    set(`${side}Ankle`, hx + sign * Math.sin(rad(knee)) * 0.17, 0.72 + Math.cos(rad(knee)) * 0.17);
  }
  if (lying) for (const point of points) { const { x, y } = point; point.x = y; point.y = x; }
  return points;
}

test("angles and tilt", () => {
  assert.equal(Math.round(angleAt({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 })), 90);
  assert.equal(Math.round(jointAngle(figure({ knee: 0 }), "leftKnee")), 180);
  assert.equal(Math.round(jointAngle(figure({ arm: 90 }), "leftShoulder")), 90);
  assert.ok(torsoTilt(figure()) < 5);
  assert.ok(torsoTilt(figure({ lying: true })) > 80);
  assert.deepEqual(primaryJoints("upper"), ["leftElbow", "rightElbow", "leftShoulder", "rightShoulder"]);
  assert.equal(focusFor("quadriceps"), "lower");
  assert.equal(focusFor("chest"), "upper");
  assert.equal(focusFor("abdominals"), "full");
  assert.deepEqual([MAX_ANGLE_DIFF, MIN_VISIBILITY, MIN_MOVEMENT], [12, 0.5, 0.7]);
});

test("the same pose passes; a pose more than 12 degrees off fails", () => {
  const reference = [figure({ arm: 10 }), figure({ arm: 170 })];
  assert.equal(comparePair({ reference, candidate: [figure({ arm: 14 }), figure({ arm: 165 })] }).verdict, "pass");
  const off = comparePair({ reference, candidate: [figure({ arm: 10 }), figure({ arm: 140 })] });
  assert.equal(off.verdict, "fail");
  assert.ok(off.reasons.some((reason) => /leftShoulder differs by 30°/.test(reason)), off.reasons.join("; "));
});

test("too little movement fails even when each frame is close", () => {
  const reference = [figure({ arm: 10 }), figure({ arm: 40 })];
  const result = comparePair({ reference, candidate: [figure({ arm: 18 }), figure({ arm: 30 })], focus: "upper" });
  assert.equal(result.verdict, "fail");
  assert.ok(result.movementRatio < MIN_MOVEMENT);
});

test("left and right swapped fails", () => {
  const reference = [figure({ arm: 10 }), figure({ arm: 170 })];
  assert.equal(swapped(reference[0], figure({ mirror: true })), true);
  const result = comparePair({ reference, candidate: [figure({ arm: 10, mirror: true }), figure({ arm: 170, mirror: true })] });
  assert.equal(result.verdict, "fail");
  assert.ok(result.reasons.some((reason) => /swapped/.test(reason)));
});

test("hidden joints, lying poses and a missing reference get the eye; no person in the demonstration fails", () => {
  const reference = [figure(), figure({ arm: 90 })];
  assert.equal(comparePair({ reference, candidate: [figure({ visibility: 0.3 }), figure({ arm: 90, visibility: 0.3 })] }).verdict, "needs-eye");
  assert.equal(comparePair({ reference: [figure({ lying: true }), figure({ lying: true, arm: 90 })], candidate: [figure({ lying: true }), figure({ lying: true, arm: 90 })] }).verdict, "needs-eye");
  assert.equal(comparePair({ reference: [null, figure()], candidate: reference }).verdict, "needs-eye");
  assert.equal(comparePair({ reference, candidate: [figure(), null] }).verdict, "fail");
  // A demonstration that hides a joint but already fails on what is visible is a fail, not an eye case.
  const hiddenAndWrong = figure({ arm: 60 });
  hiddenAndWrong[LANDMARK.leftKnee].visibility = 0.2;
  assert.equal(comparePair({ reference, candidate: [hiddenAndWrong, figure({ arm: 90 })] }).verdict, "fail");
});

test("the lane: gives back the heavy slot, takes the lock, keeps it alive, and treats a dead owner or old lock as stale", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "fitx-lane-"));
  try {
    const slot = path.join(dir, "slot");
    mkdirSync(slot);
    writeFileSync(path.join(slot, "pid"), "4242\n");
    const env = { FITX_HEAVY_SLOT: slot };
    assert.equal(releaseHeavySlot(env, 4242), true);
    assert.equal(existsSync(slot), false);
    assert.equal(env.FITX_HEAVY_SLOT, undefined);

    const lock = path.join(dir, "lock");
    const live = () => true;
    assert.equal(tryLock(lock, { pid: 111, job: { kind: "pose-check", label: "t" }, isAlive: live }), true);
    assert.equal(JSON.parse(readFileSync(path.join(lock, "job"), "utf8")).kind, "pose-check");
    assert.equal(tryLock(lock, { pid: 222, job: {}, isAlive: live }), false, "held by a live owner");
    assert.equal(isStale(lock, { isAlive: () => false }), true, "its owner has exited");
    const old = new Date(Date.now() - STALE_MS - 60000);
    utimesSync(lock, old, old);
    assert.equal(isStale(lock, { isAlive: live }), true, "older than 120 minutes");
    keepAlive(lock);
    assert.equal(isStale(lock, { isAlive: live }), false, "touched: fresh again");
    assert.equal(tryLock(lock, { pid: 333, job: {}, isAlive: () => false }), true, "a stale lock is taken over");
    assert.equal(readFileSync(path.join(lock, "pid"), "utf8").trim(), "333");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
