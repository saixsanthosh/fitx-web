import { test } from "node:test";
import assert from "node:assert/strict";
import { getExerciseRule } from "@/lib/form-rules/catalog";
import { createCoachSession } from "@/lib/form-rules/session";
import type { ExerciseRule } from "@/lib/form-rules/types";
import type { RepPlan } from "./synthetic";
import { bridge, cueIds, planDuration, play, repValueAt, sequence, squat } from "./synthetic";

const rule = getExerciseRule("glute_bridge") as ExerciseRule;
const run = (plan: RepPlan, options: Parameters<typeof sequence>[2] = {}) =>
  play(createCoachSession(rule), sequence(planDuration(plan), (t) => bridge(repValueAt(plan, t)), options));

test("counts full bridges (hips up until shoulders, hips and knees line up)", () => {
  const result = run({ from: 136, depths: [176, 177, 175, 178, 176, 176, 177, 175, 176, 178], repMs: 1800, restMs: 400 });
  assert.equal(result.last.reps, 10);
  assert.equal(result.last.cleanReps, 10);
  assert.equal(result.last.partials, 0);
});

test("hips that stop low are partial with a 'hips higher' cue", () => {
  const result = run({ from: 136, depths: [176, 157, 176, 159], repMs: 1800 });
  assert.equal(result.last.reps, 2);
  assert.equal(result.last.partials, 2);
  const partial = result.events.find((event) => event.type === "partial");
  assert.match(partial?.type === "partial" ? partial.cue.text : "", /hips higher/i);
});

test("noise does not change the count", () => {
  const result = run({ from: 137, depths: Array.from({ length: 8 }, () => 176), repMs: 1600, restMs: 300 }, { fps: 15, noise: 0.005, seed: 31 });
  assert.equal(result.last.reps, 8);
  assert.equal(result.last.partials, 0);
});

test("pushing the hips past straight raises 'ribs down' but still counts the rep", () => {
  const result = run({ from: 136, depths: [176, 215, 215], repMs: 2000 });
  assert.equal(result.last.reps, 3);
  assert.equal(result.last.cleanReps, 1);
  assert.ok(cueIds(result.events).includes("over_arch"));
});

test("standing is not a bridge position", () => {
  const result = play(createCoachSession(rule), sequence(5000, () => squat(172)));
  assert.equal(result.last.reps, 0);
  assert.equal(result.last.status, "position");
  assert.match(result.last.guidance, /lie on your back/i);
});
