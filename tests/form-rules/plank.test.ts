import { test } from "node:test";
import assert from "node:assert/strict";
import { getExerciseRule } from "@/lib/form-rules/catalog";
import { createCoachSession } from "@/lib/form-rules/session";
import type { ExerciseRule } from "@/lib/form-rules/types";
import { cueIds, plank, play, sequence, squat } from "./synthetic";

const rule = getExerciseRule("plank") as ExerciseRule;
const near = (actual: number, expected: number, tolerance: number, label: string) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} not within ${tolerance} of ${expected}`);

test("times a steady plank", () => {
  const result = play(createCoachSession(rule), sequence(20_000, () => plank(), { noise: 0.004, seed: 41 }));
  near(result.last.holdMs, 20_000, 300, "hold");
  near(result.last.positionMs, 20_000, 300, "position");
  assert.equal(result.last.status, "active");
  assert.equal(result.last.phase, "holding");
  assert.equal(result.summary.holdSeconds, 19);
  assert.deepEqual(cueIds(result.events), []);
});

test("sagging hips stop the timer and raise the hip cue", () => {
  // 10 s good, 4 s sagging, 6 s good.
  const result = play(createCoachSession(rule), sequence(20_000, (t) => plank({ sag: t >= 10_000 && t < 14_000 ? 0.12 : 0 })));
  near(result.last.holdMs, 16_000, 500, "hold");
  near(result.last.positionMs, 20_000, 300, "position");
  assert.deepEqual(cueIds(result.events), ["hip_sag"]);
  const sagging = result.snapshots.find((snapshot) => snapshot.t - 10_000 > 11_000 && snapshot.t - 10_000 < 13_000);
  assert.equal(sagging?.phase, "adjust");
  assert.equal(sagging?.cue?.id, "hip_sag");
});

test("hips piked high raise the hips-down cue", () => {
  const result = play(createCoachSession(rule), sequence(6000, (t) => plank({ sag: t > 2000 ? -0.16 : 0 })));
  assert.deepEqual(cueIds(result.events), ["hip_pike"]);
  near(result.last.holdMs, 2300, 400, "hold");
});

test("tracking jitter shorter than the grace period does not stop the timer", () => {
  // The hips flick out of line for 150 ms every 2 s.
  const result = play(createCoachSession(rule), sequence(10_000, (t) => plank({ sag: t % 2000 < 150 ? 0.12 : 0 })));
  near(result.last.holdMs, 10_000, 300, "hold");
  assert.deepEqual(cueIds(result.events), []);
});

test("resting on the knees is not a plank, so the timer does not run", () => {
  const result = play(createCoachSession(rule), sequence(6000, () => plank({ kneeAngle: 90 })));
  assert.equal(result.last.holdMs, 0);
  assert.equal(result.last.status, "position");
});

test("standing or unclear time is never counted", () => {
  const standing = play(createCoachSession(rule), sequence(5000, () => squat(172)));
  assert.equal(standing.last.holdMs, 0);
  const dark = play(createCoachSession(rule), sequence(5000, () => plank(), { visibility: 0.3 }));
  assert.equal(dark.last.holdMs, 0);
  assert.equal(dark.last.status, "unclear");
  const hidden = play(createCoachSession(rule), sequence(10_000, () => plank(), { dropouts: [{ from: 3000, to: 7000, parts: ["hip"] }] }));
  near(hidden.last.holdMs, 6000, 300, "hold with 4 s unseen");
  assert.equal(hidden.summary.unclearSeconds, 4);
});
