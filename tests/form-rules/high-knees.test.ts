import { test } from "node:test";
import assert from "node:assert/strict";
import { getExerciseRule } from "@/lib/form-rules/catalog";
import { createCoachSession } from "@/lib/form-rules/session";
import type { ExerciseRule } from "@/lib/form-rules/types";
import { highKnees, planFrames } from "./figure-poses";
import { cueIds, play } from "./synthetic";

const rule = getExerciseRule("high_knees") as ExerciseRule;
/** Alternating knees: odd reps lift the far knee. */
const run = (depths: number[], options: { lean?: number } = {}, seq = {}, repMs = 560) =>
  play(createCoachSession(rule), planFrames("high_knees", { from: 0, depths, repMs, restMs: 120 }, (k, t) => highKnees(k, { ...options, far: Math.floor(t / (repMs + 120)) % 2 === 1 }), seq));

test("counts every knee that reaches hip height, left and right", () => {
  const result = run(Array(10).fill(1), {}, { noise: 0.003, seed: 3 });
  assert.equal(result.last.reps, 10);
  assert.deepEqual(cueIds(result.events), []);
});

test("still counts at twelve frames a second", () => {
  const result = run(Array(8).fill(1), {}, { fps: 12, seed: 4 });
  assert.equal(result.last.reps, 8);
});

test("a knee lifted only partway is a partial rep", () => {
  const result = run([1, 0.65, 1, 0.65]);
  assert.equal(result.last.reps, 2);
  assert.equal(result.last.partials, 2);
});

test("leaning to one side to lift the knees raises the stay-upright cue", () => {
  const result = run(Array(6).fill(1), { lean: 45 });
  assert.ok(cueIds(result.events).includes("lean"));
});
