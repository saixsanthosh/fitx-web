import { test } from "node:test";
import assert from "node:assert/strict";
import { automaticControls, captureConstraints, displayFilter, exposureLift, lightLevel, meanLuma, pictureLabel, stepDown } from "@/lib/pose/capture";

test("the camera is asked for a native picture, never a rescaled one, and ideal sizes never block it", () => {
  const constraints = captureConstraints({ facing: "user", width: 3840, height: 2160, frameRate: 30 }) as Record<string, unknown>;
  assert.deepEqual(constraints.width, { ideal: 3840 });
  assert.deepEqual(constraints.height, { ideal: 2160 });
  assert.deepEqual(constraints.resizeMode, { ideal: "none" });
  assert.deepEqual(constraints.frameRate, { ideal: 30, max: 30 });
  assert.deepEqual(constraints.facingMode, { ideal: "user" });
  const chosen = captureConstraints({ facing: "user", width: 1920, height: 1080, frameRate: 24, deviceId: "cam-2" }) as Record<string, unknown>;
  assert.deepEqual(chosen.deviceId, { exact: "cam-2" });
  assert.equal(chosen.facingMode, undefined);
});

test("the picture is named from what the camera delivers: 4K only for a real 2160-line picture", () => {
  assert.equal(pictureLabel({ width: 3840, height: 2160 }), "4K");
  assert.equal(pictureLabel({ width: 2160, height: 3840 }), "4K", "a phone held upright");
  assert.equal(pictureLabel({ width: 3200, height: 1800 }), "1440p");
  assert.equal(pictureLabel({ width: 1920, height: 1080 }), "1080p");
  assert.equal(pictureLabel({ width: 1280, height: 720 }), "720p");
  assert.equal(pictureLabel({ width: 640, height: 480 }), "480p");
  assert.equal(pictureLabel({ width: 0, height: 0 }), null);
  assert.equal(pictureLabel({}), null);
});

test("stepping down goes one rung at a time and stops at the bottom", () => {
  assert.deepEqual(stepDown({ width: 3840, height: 2160 }), { width: 2560, height: 1440 });
  assert.deepEqual(stepDown({ width: 1920, height: 1080 }), { width: 1280, height: 720 });
  assert.deepEqual(stepDown({ width: 1080, height: 1920 }), { width: 1280, height: 720 }, "portrait sizes too");
  assert.deepEqual(stepDown({ width: 640, height: 480 }), { width: 480, height: 360 });
  assert.equal(stepDown({ width: 480, height: 360 }), null);
});

test("continuous focus, exposure and white balance are set only where the camera offers them", () => {
  assert.deepEqual(automaticControls({ focusMode: ["manual", "continuous"], exposureMode: ["continuous"], whiteBalanceMode: ["manual"] }), [
    { focusMode: "continuous" },
    { exposureMode: "continuous" },
  ]);
  assert.deepEqual(automaticControls({}), [], "a camera without these controls is left alone");
});

test("brightness is read from the picture, with hysteresis so the level doesn't flicker", () => {
  const grey = (value: number) => Array.from({ length: 16 }, (_, i) => (i % 4 === 3 ? 255 : value));
  assert.ok(Math.abs(meanLuma(grey(255)) - 1) < 1e-9);
  assert.equal(meanLuma(grey(0)), 0);
  assert.equal(meanLuma([]), 0);
  assert.equal(lightLevel(0.5), "ok");
  assert.equal(lightLevel(0.3), "low");
  assert.equal(lightLevel(0.15), "dim");
  assert.equal(lightLevel(0.21, "dim"), "dim", "stays dim just above the threshold");
  assert.equal(lightLevel(0.33, "low"), "low", "stays low just above the threshold");
  assert.equal(lightLevel(0.36, "low"), "ok");
});

test("a dim room lifts the camera's exposure a little, within its range; a bright one is left alone", () => {
  const controls = { exposureCompensation: { min: -2, max: 2, step: 1 / 3 } };
  assert.deepEqual(exposureLift(controls, 0, "dim"), { exposureCompensation: 1 });
  assert.deepEqual(exposureLift(controls, 0, "low"), { exposureCompensation: 0.667 });
  assert.deepEqual(exposureLift(controls, 1.8, "dim"), { exposureCompensation: 2 }, "capped at the camera's maximum");
  assert.equal(exposureLift(controls, 2, "dim"), null, "already at the maximum");
  assert.equal(exposureLift(controls, 0, "ok"), null);
  assert.equal(exposureLift({}, 0, "dim"), null, "a camera without the control");
});

test("the display lift is a gentle filter, and none in good light", () => {
  assert.equal(displayFilter("ok"), "none");
  assert.match(displayFilter("low"), /^brightness\(1\.1\d?\) contrast/);
  assert.match(displayFilter("dim"), /^brightness\(1\.3\)/);
});
