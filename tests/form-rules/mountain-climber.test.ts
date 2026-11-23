import { test } from "node:test";
import assert from "node:assert/strict";
import { getExerciseRule } from "@/lib/form-rules/catalog";
import { createCoachSession } from "@/lib/form-rules/session";
import type { ExerciseRule } from "@/lib/form-rules/types";
import { mountainClimber, planFrames } from "./figure-poses";
import { cueIds, play } from "./synthetic";
import { fromFigure, sequence, PORTRAIT } from "./synthetic";
import { DEMONSTRATIONS } from "./kinematics/demos";
import { place } from "./kinematics/figure";

const rule = getExerciseRule("mountain_climber") as ExerciseRule;
const run = (depths: number[], options: { torso?: number } = {}, seq = {}) =>
  play(createCoachSession(rule), planFrames("mountain_climber", { from: 0, depths, repMs: 700, restMs: 150 }, (k) => mountainClimber(k, options), seq));

test("counts each drive of the near knee", () => {
  const result = run(Array(12).fill(1), {}, { noise: 0.003, seed: 9 });
  assert.equal(result.last.reps, 12);
  assert.deepEqual(cueIds(result.events), []);
});

test("a knee that stops halfway is a partial rep", () => {
  const result = run([1, 0.45, 1]);
  assert.equal(result.last.reps, 2);
  assert.equal(result.last.partials, 1);
});

test("hips piked above the shoulders raise the hips-down cue", () => {
  const result = run(Array(4).fill(1), { torso: 12 });
  assert.ok(cueIds(result.events).includes("hip_pike"));
});

test("hips sagging towards the floor raise the lift-your-hips cue", () => {
  const result = run(Array(4).fill(1), { torso: -42 });
  assert.ok(cueIds(result.events).includes("hip_sag"));
});

test("standing up is not a plank, so knee lifts are not counted", () => {
  const stand = place(DEMONSTRATIONS.reverse_lunge, DEMONSTRATIONS.reverse_lunge.keyframes[0].pose, DEMONSTRATIONS.reverse_lunge.at);
  const result = play(createCoachSession(rule), sequence(4000, () => fromFigure(stand, "side")(PORTRAIT), { aspect: PORTRAIT }));
  assert.equal(result.last.reps, 0);
  assert.equal(result.last.status, "position");
});
