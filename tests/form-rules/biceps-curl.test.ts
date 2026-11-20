import { test } from "node:test";
import assert from "node:assert/strict";
import { getExerciseRule } from "@/lib/form-rules/catalog";
import { createCoachSession } from "@/lib/form-rules/session";
import type { ExerciseRule } from "@/lib/form-rules/types";
import { bicepsCurl, planFrames } from "./figure-poses";
import { cueIds, play } from "./synthetic";

const rule = getExerciseRule("biceps_curl") as ExerciseRule;
const run = (depths: number[], options: { drift?: number; swing?: number } = {}, seq = {}) =>
  play(createCoachSession(rule), planFrames("biceps_curl", { from: 0, depths, repMs: 1600, restMs: 400 }, (k) => bicepsCurl(k, options), seq));

test("counts full curls", () => {
  const result = run(Array(10).fill(1), {}, { noise: 0.003, seed: 21 });
  assert.equal(result.last.reps, 10);
  assert.equal(result.last.cleanReps, 10);
  assert.deepEqual(cueIds(result.events), []);
});

test("a half curl is a partial rep", () => {
  const result = run([1, 0.5, 1]);
  assert.equal(result.last.reps, 2);
  assert.equal(result.last.partials, 1);
});

test("elbows drifting forwards raise the elbows-in cue", () => {
  const result = run([1, 1, 1], { drift: 45 });
  assert.ok(cueIds(result.events).includes("elbow_drift"));
});

test("swinging the body raises the no-swinging cue", () => {
  const result = run([1, 1, 1], { swing: 18 });
  assert.ok(cueIds(result.events).includes("swing"));
});
