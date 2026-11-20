import { test } from "node:test";
import assert from "node:assert/strict";
import { getExerciseRule } from "@/lib/form-rules/catalog";
import { createCoachSession } from "@/lib/form-rules/session";
import type { ExerciseRule } from "@/lib/form-rules/types";
import { planFrames, shoulderPress } from "./figure-poses";
import { cueIds, play } from "./synthetic";

const rule = getExerciseRule("shoulder_press") as ExerciseRule;
const run = (depths: number[], options: { farK?: number; lean?: number } = {}, seq = {}) =>
  play(createCoachSession(rule), planFrames("shoulder_press", { from: 0, depths, repMs: 1800, restMs: 500 }, (k) => shoulderPress(k, { ...options, farK: options.farK === undefined ? undefined : options.farK * k }), seq));

test("counts presses from the shoulders to straight arms", () => {
  const result = run(Array(8).fill(1), {}, { noise: 0.003, seed: 12 });
  assert.equal(result.last.reps, 8);
  assert.deepEqual(cueIds(result.events), []);
});

test("one arm stopping short means the rep is partial", () => {
  const result = run([1, 1, 1], { farK: 0.5 });
  assert.equal(result.last.reps, 0);
  assert.equal(result.last.partials, 3);
});

test("leaning back to press raises the ribs-down cue", () => {
  const result = run([1, 1, 1], { lean: 30 });
  assert.ok(cueIds(result.events).includes("lean_back"));
  assert.equal(result.last.reps, 3);
});
