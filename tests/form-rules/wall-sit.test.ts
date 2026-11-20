import { test } from "node:test";
import assert from "node:assert/strict";
import { getExerciseRule } from "@/lib/form-rules/catalog";
import { createCoachSession } from "@/lib/form-rules/session";
import type { ExerciseRule } from "@/lib/form-rules/types";
import { holdFrames, wallSit } from "./figure-poses";
import { cueIds, play } from "./synthetic";

const rule = getExerciseRule("wall_sit") as ExerciseRule;
const near = (actual: number, expected: number, tolerance: number, label: string) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} not within ${tolerance} of ${expected}`);

test("times a wall sit with thighs level", () => {
  const result = play(createCoachSession(rule), holdFrames("wall_sit", 20_000, () => wallSit(1), { noise: 0.003, seed: 6 }));
  near(result.last.holdMs, 20_000, 300, "hold");
  assert.deepEqual(cueIds(result.events), []);
});

test("standing up is not timed", () => {
  const result = play(createCoachSession(rule), holdFrames("wall_sit", 5000, () => wallSit(0)));
  assert.equal(result.last.holdMs, 0);
  assert.equal(result.last.status, "position");
});

test("sitting too high stops the timer and asks to slide lower", () => {
  const result = play(createCoachSession(rule), holdFrames("wall_sit", 10_000, (t) => wallSit(1, { thigh: t > 4000 ? 32 : 0 })));
  near(result.last.holdMs, 4000, 600, "hold");
  assert.deepEqual(cueIds(result.events), ["too_high"]);
});

test("sinking below level asks for the feet further out", () => {
  const result = play(createCoachSession(rule), holdFrames("wall_sit", 6000, (t) => wallSit(1, { thigh: t > 2000 ? -26 : 0 })));
  assert.deepEqual(cueIds(result.events), ["too_low"]);
});

test("leaning off the wall asks for the back flat against it", () => {
  const result = play(createCoachSession(rule), holdFrames("wall_sit", 6000, (t) => wallSit(1, { lean: t > 2000 ? 32 : 0 })));
  assert.deepEqual(cueIds(result.events), ["lean"]);
});
