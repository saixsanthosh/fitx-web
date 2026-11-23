import { test } from "node:test";
import assert from "node:assert/strict";
import { getExerciseRule } from "@/lib/form-rules/catalog";
import { createCoachSession } from "@/lib/form-rules/session";
import type { ExerciseRule } from "@/lib/form-rules/types";
import { bentOverRow, planFrames } from "./figure-poses";
import { cueIds, play } from "./synthetic";

const rule = getExerciseRule("bent_over_row") as ExerciseRule;
const run = (depths: number[], options: Parameters<typeof bentOverRow>[1] = {}, seq = {}) =>
  play(createCoachSession(rule), planFrames("bent_over_row", { from: 0, depths, repMs: 1600, restMs: 500 }, (k) => bentOverRow(k, options), seq));

test("counts full rows from a hinged position", () => {
  const result = run(Array(8).fill(1), {}, { noise: 0.003, seed: 35 });
  assert.equal(result.last.reps, 8);
  assert.equal(result.last.cleanReps, 8);
  assert.deepEqual(cueIds(result.events), []);
});

test("a short pull is a partial rep", () => {
  const result = run([1, 0.45, 1]);
  assert.equal(result.last.reps, 2);
  assert.equal(result.last.partials, 1);
});

test("standing up to lift raises the stay-low cue", () => {
  assert.ok(cueIds(run([1, 1, 1], { rise: 30 }).events).includes("standing_up"));
});

test("curls done standing upright are not rows, so nothing is counted", () => {
  const upright = run([1, 1, 1], { standing: true });
  assert.equal(upright.last.reps, 0);
  assert.equal(upright.last.status, "position");
});
