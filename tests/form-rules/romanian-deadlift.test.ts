import { test } from "node:test";
import assert from "node:assert/strict";
import { getExerciseRule } from "@/lib/form-rules/catalog";
import { createCoachSession } from "@/lib/form-rules/session";
import type { ExerciseRule } from "@/lib/form-rules/types";
import { planFrames, romanianDeadlift } from "./figure-poses";
import { cueIds, play } from "./synthetic";

const rule = getExerciseRule("romanian_deadlift") as ExerciseRule;
const run = (depths: number[], options: Parameters<typeof romanianDeadlift>[1] = {}, seq = {}) =>
  play(createCoachSession(rule), planFrames("romanian_deadlift", { from: 0, depths, repMs: 2400, restMs: 600 }, (k) => romanianDeadlift(k, options), seq));

test("counts full hip hinges seen side-on", () => {
  const result = run(Array(6).fill(1), {}, { noise: 0.003, seed: 34 });
  assert.equal(result.last.reps, 6);
  assert.equal(result.last.cleanReps, 6);
  assert.deepEqual(cueIds(result.events), []);
});

test("a shallow hinge is a partial rep", () => {
  const result = run([1, 0.45, 1]);
  assert.equal(result.last.reps, 2);
  assert.equal(result.last.partials, 1);
});

test("bending the knees into a squat raises the hips-back cue", () => {
  const result = run([1, 1, 1], { squat: 90 });
  assert.ok(cueIds(result.events).includes("squatting"));
});
