import { test } from "node:test";
import assert from "node:assert/strict";
import { getExerciseRule } from "@/lib/form-rules/catalog";
import { CALIBRATE_MS, calibrateStart, createCoachSession } from "@/lib/form-rules/session";
import type { ExerciseRule, RepMotion } from "@/lib/form-rules/types";
import { count, PORTRAIT, play, repValueAt, planDuration, sequence, squat } from "../form-rules/synthetic";

const rule = getExerciseRule("bodyweight_squat") as ExerciseRule;
const motion = rule.motion as RepMotion;

test("the start moves just inside the member's own steady position, and only so far", () => {
  const fitted = calibrateStart(motion, 152);
  assert.ok(fitted && fitted !== motion);
  const enter = fitted.start.enter.find((c) => c.metric === "knee");
  const exit = fitted.start.exit.find((c) => c.metric === "knee");
  assert.ok(enter && Math.abs(enter.value - (152 - 70 * 0.03)) < 1e-9, `start now ${enter?.value}`);
  assert.ok(exit && Math.abs(exit.value - (150 - (160 - enter.value))) < 1e-9, "the exit moves with it, keeping its gap");
  assert.deepEqual(fitted.target, motion.target, "the turnaround a full rep must reach never moves");
  assert.equal(calibrateStart(motion, 170), motion, "a member who already reaches the start keeps the rule as it is");
  assert.equal(calibrateStart(motion, 140), null, "too far from the start to be a start: never fitted");
});

test("a glute bridge (whose start is the low end) is fitted the other way", () => {
  const bridge = getExerciseRule("glute_bridge")?.motion as RepMotion;
  const fitted = calibrateStart(bridge, 148);
  const enter = fitted?.start.enter.find((c) => c.metric === "hip");
  assert.ok(enter && enter.value > 145 && enter.value <= 148 + 1, `start now ${enter?.value}`);
});

/** A member whose standing knee reads `stand` to this camera, squatting to each depth. */
function frames(stand: number, depths: number[]) {
  const plan = { from: stand, depths, repMs: 2200, restMs: 1500 };
  return sequence(planDuration(plan), (t) => squat(repValueAt(plan, t)), { aspect: PORTRAIT, noise: 0.0015, seed: 9 });
}

test("a member whose straight leg reads 152° can't start without calibration, and counts full squats with it", () => {
  const result = play(createCoachSession(rule), frames(152, [100, 100, 100]));
  assert.equal(count(result.events, "calibrated"), 1);
  assert.equal(result.last.calibrated, true);
  assert.equal(result.last.reps, 3);
});

test("calibration never lets a shallow squat count", () => {
  const result = play(createCoachSession(rule), frames(152, [100, 128, 100]));
  assert.equal(result.last.reps, 2);
  assert.equal(result.last.partials, 1);
});

test("a position far from the start is never taken for one", () => {
  const result = play(createCoachSession(rule), frames(138, [100, 100]));
  assert.equal(count(result.events, "calibrated"), 0);
  assert.equal(result.last.reps, 0);
});

test("the member is asked to hold still while the start is fitted, and it takes under a second", () => {
  const result = play(createCoachSession(rule), frames(152, [100]));
  assert.ok(result.snapshots.some((snapshot) => snapshot.calibrating && /Hold still/.test(snapshot.guidance)));
  assert.ok(CALIBRATE_MS < 1000);
});

test("after a pause the start is fitted again (the camera or the member may have moved)", () => {
  const session = createCoachSession(rule);
  play(session, frames(152, [100]));
  session.pause();
  const again = play(session, frames(152, [100]).map((frame) => ({ ...frame, t: frame.t + 60_000 })));
  assert.equal(count(again.events, "calibrated"), 1);
  assert.equal(again.last.reps, 2);
});
