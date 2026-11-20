import { test } from "node:test";
import assert from "node:assert/strict";
import { EXERCISE_RULES, getExerciseRule } from "@/lib/form-rules/catalog";
import { createCoachSession, SIDEWAYS_HINT } from "@/lib/form-rules/session";
import type { ExerciseId, ExerciseRule } from "@/lib/form-rules/types";
import type { PoseFrame } from "@/lib/pose/landmarks";
import type { RepPlan } from "./synthetic";
import { bridge, fitInto, plank, planDuration, play, PORTRAIT, pushUp, quarterTurn, repValueAt, sequence, squat } from "./synthetic";

const rule = (id: ExerciseId) => getExerciseRule(id) as ExerciseRule;
const pushUps: RepPlan = { from: 170, depths: [80, 80, 80, 80], repMs: 1500, restMs: 500 };
const bridges: RepPlan = { from: 136, depths: [176, 176, 176], repMs: 1800, restMs: 400 };

/** The three floor exercises, filmed as the tips say: phone on its side, a landscape picture. */
const FLOOR: ReadonlyArray<{ id: ExerciseId; frames: () => PoseFrame[]; counted: (snapshot: { reps: number; holdMs: number }) => number }> = [
  { id: "push_up", frames: () => sequence(planDuration(pushUps), (t) => pushUp(repValueAt(pushUps, t))), counted: (s) => s.reps },
  { id: "plank", frames: () => sequence(10_000, () => plank()), counted: (s) => s.holdMs },
  { id: "glute_bridge", frames: () => sequence(planDuration(bridges), (t) => bridge(repValueAt(bridges, t))), counted: (s) => s.reps },
];

const mentionsAutoRotate = (guidance: string) => /auto-rotate/.test(guidance);

test("only the floor exercises ask for a landscape picture", () => {
  const landscape = EXERCISE_RULES.filter((r) => r.landscape).map((r) => r.id).sort();
  assert.deepEqual(landscape, ["glute_bridge", "mountain_climber", "plank", "push_up", "side_plank", "superman"]);
  for (const id of landscape) {
    assert.match(rule(id).setupTips[0], /auto-rotate on/, `${id}: the first tip says how to set the phone up`);
  }
});

test("filmed with the phone on its side, floor exercises count and never mention auto-rotate", () => {
  for (const { id, frames, counted } of FLOOR) {
    const result = play(createCoachSession(rule(id)), frames());
    assert.ok(counted(result.last) > 0, `${id} counts`);
    assert.ok(!result.snapshots.some((s) => mentionsAutoRotate(s.guidance)), `${id} never asks for auto-rotate`);
  }
});

test("with auto-rotate off (the picture turned a quarter turn), nothing is counted and the coach says why", () => {
  for (const { id, frames, counted } of FLOOR) {
    for (const direction of [1, -1] as const) {
      const label = `${id}, turned ${direction === 1 ? "clockwise" : "anticlockwise"}`;
      const result = play(createCoachSession(rule(id)), frames().map((frame) => quarterTurn(frame, direction)));
      assert.equal(counted(result.last), 0, `${label}: nothing counted`);
      assert.ok(result.snapshots.every((s) => s.status === "position"), `${label}: the body is seen, the position is not recognised`);
      assert.ok(result.snapshots.every((s) => s.guidance === SIDEWAYS_HINT), `${label}: the hint names the fix`);
    }
  }
});

test("a phone standing upright still counts push-ups it can see; standing up there asks for the phone on its side", () => {
  // A portrait picture with the body lying across it, small but clearly seen.
  const across = sequence(planDuration(pushUps), (t) => fitInto(pushUp(repValueAt(pushUps, t)), { x: 0.05, y: 0.55, width: 0.6, height: 0.4 }), { aspect: PORTRAIT });
  const lying = play(createCoachSession(rule("push_up")), across);
  assert.equal(lying.last.reps, 4);
  assert.ok(!lying.snapshots.some((s) => mentionsAutoRotate(s.guidance)));

  const standing = play(createCoachSession(rule("push_up")), sequence(4000, () => fitInto(squat(175), { x: 0.2, y: 0.1, width: 0.4, height: 0.8 }), { aspect: PORTRAIT }));
  assert.equal(standing.last.reps, 0);
  assert.equal(standing.last.status, "position");
  assert.equal(standing.last.guidance, SIDEWAYS_HINT);
});

test("standing exercises keep their own hints in a portrait picture", () => {
  // Lying down in front of an upright phone is not a squat position; the hint is the squat's own.
  const frames = sequence(3000, () => fitInto(pushUp(170), { x: 0.05, y: 0.55, width: 0.6, height: 0.4 }), { aspect: PORTRAIT });
  const result = play(createCoachSession(rule("bodyweight_squat")), frames);
  assert.equal(result.last.status, "position");
  assert.equal(result.last.guidance, rule("bodyweight_squat").postureHint);
});
