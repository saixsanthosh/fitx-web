import { test } from "node:test";
import assert from "node:assert/strict";
import { getExerciseRule } from "@/lib/form-rules/catalog";
import { createCoachSession } from "@/lib/form-rules/session";
import type { ExerciseRule } from "@/lib/form-rules/types";
import { planFrames, reverseLunge } from "./figure-poses";
import { cueIds, play } from "./synthetic";

const rule = getExerciseRule("reverse_lunge") as ExerciseRule;
const run = (depths: number[], options: { lean?: number } = {}, seq = {}) =>
  play(createCoachSession(rule), planFrames("reverse_lunge", { from: 0, depths, repMs: 2000, restMs: 600 }, (k) => reverseLunge(k, options), seq));

test("counts reverse lunges that lower to a bent knee and stand up again", () => {
  const result = run([1, 1, 1, 1, 1, 1], {}, { noise: 0.004, seed: 11 });
  assert.equal(result.last.reps, 6);
  assert.equal(result.last.cleanReps, 6);
  assert.deepEqual(cueIds(result.events), []);
});

test("a short step that barely bends the knee is a partial rep, not counted", () => {
  const result = run([1, 0.45, 1]);
  assert.equal(result.last.reps, 2);
  assert.equal(result.last.partials, 1);
});

test("leaning the chest forwards raises the chest-up cue", () => {
  const result = run([1, 1], { lean: 40 });
  assert.equal(result.last.reps, 2);
  assert.ok(cueIds(result.events).includes("torso_lean"));
  assert.equal(result.last.cleanReps, 0);
});

test("reverse lunges in a workout use this rule, not the split squat", () => {
  assert.equal(rule.motion.kind, "reps");
  assert.ok(rule.names.includes("reverse lunge"));
});
