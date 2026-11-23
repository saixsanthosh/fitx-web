import { test } from "node:test";
import assert from "node:assert/strict";
import { getExerciseRule } from "@/lib/form-rules/catalog";
import { createCoachSession } from "@/lib/form-rules/session";
import type { ExerciseRule } from "@/lib/form-rules/types";
import { lateralRaise, planFrames } from "./figure-poses";
import { cueIds, play } from "./synthetic";

const rule = getExerciseRule("lateral_raise") as ExerciseRule;
const run = (depths: number[], options: Parameters<typeof lateralRaise>[1] = {}, seq = {}) =>
  play(createCoachSession(rule), planFrames("lateral_raise", { from: 0, depths, repMs: 1800, restMs: 500 }, (k) => lateralRaise(k, options), seq));

test("counts full raises to shoulder height, facing the camera", () => {
  const result = run(Array(8).fill(1), {}, { noise: 0.003, seed: 31 });
  assert.equal(result.last.reps, 8);
  assert.equal(result.last.cleanReps, 8);
  assert.deepEqual(cueIds(result.events), []);
});

test("a raise that stops at half height is a partial rep, not a rep", () => {
  const result = run([1, 0.5, 1]);
  assert.equal(result.last.reps, 2);
  assert.equal(result.last.partials, 1);
});

test("lifting far above shoulder height raises the shoulder-height cue", () => {
  const result = run([1, 1, 1], { high: 40 });
  assert.equal(result.last.reps, 3);
  assert.ok(cueIds(result.events).includes("too_high"));
});

test("curling the arms instead of keeping them long raises the elbow cue", () => {
  const result = run([1, 1, 1], { bend: 75 });
  assert.ok(cueIds(result.events).includes("bent_arms"));
});

test("swinging the body sideways to lift raises the no-swinging cue", () => {
  const result = run([1, 1, 1], { lean: 16 });
  assert.ok(cueIds(result.events).includes("swing"));
});
