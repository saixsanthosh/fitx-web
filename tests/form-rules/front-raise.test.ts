import { test } from "node:test";
import assert from "node:assert/strict";
import { getExerciseRule } from "@/lib/form-rules/catalog";
import { createCoachSession } from "@/lib/form-rules/session";
import type { ExerciseRule } from "@/lib/form-rules/types";
import { frontRaise, planFrames } from "./figure-poses";
import { cueIds, play } from "./synthetic";

const rule = getExerciseRule("front_raise") as ExerciseRule;
const run = (depths: number[], options: Parameters<typeof frontRaise>[1] = {}, seq = {}) =>
  play(createCoachSession(rule), planFrames("front_raise", { from: 0, depths, repMs: 1800, restMs: 500 }, (k) => frontRaise(k, options), seq));

test("counts full front raises seen side-on", () => {
  const result = run(Array(8).fill(1), {}, { noise: 0.003, seed: 32 });
  assert.equal(result.last.reps, 8);
  assert.equal(result.last.cleanReps, 8);
  assert.deepEqual(cueIds(result.events), []);
});

test("a raise that stops well short of shoulder height is a partial rep", () => {
  const result = run([1, 0.6, 1]);
  assert.equal(result.last.reps, 2);
  assert.equal(result.last.partials, 1);
});

test("lifting well past shoulder height raises the shoulder-height cue", () => {
  assert.ok(cueIds(run([1, 1], { high: 50 }).events).includes("too_high"));
});

test("leaning back to heave the weight up raises the no-swinging cue", () => {
  assert.ok(cueIds(run([1, 1, 1], { swing: 18 }).events).includes("swing"));
});
