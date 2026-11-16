import { test } from "node:test";
import assert from "node:assert/strict";
import { getExerciseRule } from "@/lib/form-rules/catalog";
import { createCoachSession } from "@/lib/form-rules/session";
import type { ExerciseRule } from "@/lib/form-rules/types";
import type { RepPlan } from "./synthetic";
import { cueIds, planDuration, play, PORTRAIT, repValueAt, sequence, splitSquat } from "./synthetic";

const rule = getExerciseRule("split_squat") as ExerciseRule;
/** `leanPerDegree`: extra forward lean for every degree the front knee bends (0 = tall torso). */
const run = (plan: RepPlan, options: Parameters<typeof sequence>[2] = {}, leanPerDegree = 0) =>
  play(createCoachSession(rule), sequence(planDuration(plan), (t) => {
    const knee = repValueAt(plan, t);
    return splitSquat(knee, { lean: (plan.from - knee) * leanPerDegree });
  }, { aspect: PORTRAIT, ...options }));

test("counts full split squats", () => {
  const result = run({ from: 170, depths: [92, 95, 90, 94, 91, 93], repMs: 2000, restMs: 300 });
  assert.equal(result.last.reps, 6);
  assert.equal(result.last.cleanReps, 6);
});

test("shallow dips are partial and not counted", () => {
  const result = run({ from: 170, depths: [92, 128, 94, 132], repMs: 2000 });
  assert.equal(result.last.reps, 2);
  assert.equal(result.last.partials, 2);
});

test("noise does not change the count", () => {
  const result = run({ from: 170, depths: Array.from({ length: 8 }, () => 95), repMs: 1900, restMs: 200 }, { fps: 15, noise: 0.006, seed: 21 });
  assert.equal(result.last.reps, 8);
});

test("leaning the torso forward on the way down raises 'stay tall'", () => {
  const result = run({ from: 170, depths: [95, 95], repMs: 2000 }, {}, 0.5);
  assert.equal(result.last.reps, 2);
  assert.equal(result.last.cleanReps, 0);
  assert.ok(cueIds(result.events).includes("torso_lean"));
});

test("a tall torso raises no cue", () => {
  const result = run({ from: 170, depths: [95, 95], repMs: 2000 });
  assert.deepEqual(cueIds(result.events), []);
});
