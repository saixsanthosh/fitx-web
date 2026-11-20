import { test } from "node:test";
import assert from "node:assert/strict";
import { getExerciseRule } from "@/lib/form-rules/catalog";
import { createCoachSession } from "@/lib/form-rules/session";
import type { ExerciseRule } from "@/lib/form-rules/types";
import { holdFrames, sidePlank } from "./figure-poses";
import { cueIds, play } from "./synthetic";

const rule = getExerciseRule("side_plank") as ExerciseRule;
const near = (actual: number, expected: number, tolerance: number, label: string) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} not within ${tolerance} of ${expected}`);

test("times a straight side plank", () => {
  const result = play(createCoachSession(rule), holdFrames("side_plank", 15_000, () => sidePlank(), { noise: 0.003, seed: 2 }));
  near(result.last.holdMs, 15_000, 300, "hold");
  assert.equal(result.last.phase, "holding");
  assert.deepEqual(cueIds(result.events), []);
});

test("dropping hips stop the timer and raise the hips-up cue", () => {
  const result = play(createCoachSession(rule), holdFrames("side_plank", 12_000, (t) => sidePlank(t >= 4000 && t < 8000 ? 16 : 0)));
  near(result.last.holdMs, 8000, 600, "hold");
  assert.deepEqual(cueIds(result.events), ["hip_drop"]);
});

test("hips pushed too high raise the hips-down cue", () => {
  const result = play(createCoachSession(rule), holdFrames("side_plank", 6000, (t) => sidePlank(t > 2000 ? -20 : 0)));
  assert.deepEqual(cueIds(result.events), ["hip_pike"]);
});

test("time when the hips can't be seen is not counted", () => {
  const result = play(createCoachSession(rule), holdFrames("side_plank", 10_000, () => sidePlank(), { dropouts: [{ from: 2000, to: 6000, parts: ["hip"] }] }));
  near(result.last.holdMs, 6000, 400, "hold");
  assert.equal(result.summary.unclearSeconds, 4);
});
