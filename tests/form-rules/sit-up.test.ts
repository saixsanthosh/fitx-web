import { test } from "node:test";
import assert from "node:assert/strict";
import { getExerciseRule } from "@/lib/form-rules/catalog";
import { createCoachSession } from "@/lib/form-rules/session";
import type { ExerciseRule } from "@/lib/form-rules/types";
import { planFrames, sitUp } from "./figure-poses";
import { cueIds, play } from "./synthetic";

const rule = getExerciseRule("sit_up") as ExerciseRule;
const run = (depths: number[], options: Parameters<typeof sitUp>[1] = {}, seq = {}) =>
  play(createCoachSession(rule), planFrames("sit_up", { from: 0, depths, repMs: 2000, restMs: 600 }, (k) => sitUp(k, options), seq));

test("counts full sit-ups seen side-on with the phone on its side", () => {
  const result = run(Array(8).fill(1), {}, { noise: 0.003, seed: 36 });
  assert.equal(result.last.reps, 8);
  assert.equal(result.last.cleanReps, 8);
  assert.deepEqual(cueIds(result.events), []);
});

test("a crunch that only lifts the shoulders is a partial rep, not a sit-up", () => {
  const result = run([1, 0.45, 1]);
  assert.equal(result.last.reps, 2);
  assert.equal(result.last.partials, 1);
});

test("with the legs straight along the floor it waits for bent knees", () => {
  const result = run([1, 1], { straight: true });
  assert.equal(result.last.reps, 0);
  assert.equal(result.last.status, "position");
});
