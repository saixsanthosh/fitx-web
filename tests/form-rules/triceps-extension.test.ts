import { test } from "node:test";
import assert from "node:assert/strict";
import { getExerciseRule } from "@/lib/form-rules/catalog";
import { createCoachSession } from "@/lib/form-rules/session";
import type { ExerciseRule } from "@/lib/form-rules/types";
import { planFrames, tricepsExtension } from "./figure-poses";
import { cueIds, play } from "./synthetic";

const rule = getExerciseRule("triceps_extension") as ExerciseRule;
const run = (depths: number[], options: Parameters<typeof tricepsExtension>[1] = {}, seq = {}) =>
  play(createCoachSession(rule), planFrames("triceps_extension", { from: 0, depths, repMs: 1800, restMs: 500 }, (k) => tricepsExtension(k, options), seq));

test("counts full overhead extensions seen side-on", () => {
  const result = run(Array(8).fill(1), {}, { noise: 0.003, seed: 33 });
  assert.equal(result.last.reps, 8);
  assert.equal(result.last.cleanReps, 8);
  assert.deepEqual(cueIds(result.events), []);
});

test("lowering only a little is a partial rep", () => {
  const result = run([1, 0.5, 1]);
  assert.equal(result.last.reps, 2);
  assert.equal(result.last.partials, 1);
});

test("upper arms swinging forwards raise the elbows-up cue", () => {
  assert.ok(cueIds(run([1, 1, 1], { drift: 60 }).events).includes("elbow_drift"));
});

test("arching back raises the ribs-down cue", () => {
  assert.ok(cueIds(run([1, 1, 1], { arch: 20 }).events).includes("arch"));
});
