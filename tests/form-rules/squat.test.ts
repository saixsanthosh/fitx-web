import { test } from "node:test";
import assert from "node:assert/strict";
import { getExerciseRule } from "@/lib/form-rules/catalog";
import { createCoachSession } from "@/lib/form-rules/session";
import type { ExerciseRule } from "@/lib/form-rules/types";
import type { RepPlan } from "./synthetic";
import { count, cueIds, planDuration, play, PORTRAIT, repValueAt, sequence, squat } from "./synthetic";

const rule = getExerciseRule("bodyweight_squat") as ExerciseRule;
const run = (plan: RepPlan, options: Parameters<typeof sequence>[2] = {}, extra: Parameters<typeof squat>[1] = {}) =>
  play(createCoachSession(rule), sequence(planDuration(plan), (t) => squat(repValueAt(plan, t), extra), { aspect: PORTRAIT, ...options }));

test("counts eight full squats", () => {
  const result = run({ from: 172, depths: [88, 90, 85, 92, 88, 86, 90, 89], repMs: 2200, restMs: 400 });
  assert.equal(result.last.reps, 8);
  assert.equal(result.last.cleanReps, 8);
  assert.equal(result.last.partials, 0);
});

test("half squats are partial reps with a 'sit deeper' cue", () => {
  const result = run({ from: 172, depths: [90, 130, 135, 90], repMs: 2000 });
  assert.equal(result.last.reps, 2);
  assert.equal(result.last.partials, 2);
  assert.equal(result.summary.cues.find((cue) => cue.id === "partial")?.count, 2);
});

test("noise does not create or lose squats", () => {
  for (const [fps, seed] of [[30, 11], [15, 12], [12, 13]] as const) {
    const result = run({ from: 172, depths: Array.from({ length: 10 }, () => 90), repMs: 1800, restMs: 200 }, { fps, noise: 0.006, seed });
    assert.equal(result.last.reps, 10, `fps ${fps}, seed ${seed}`);
    assert.equal(result.last.partials, 0, `fps ${fps}, seed ${seed}`);
  }
});

test("an excessive forward lean raises 'chest up' and those reps are not clean", () => {
  const result = run({ from: 172, depths: [90, 90, 90], repMs: 2000 }, {}, { lean: 25 });
  assert.equal(result.last.reps, 3);
  assert.equal(result.last.cleanReps, 0);
  assert.deepEqual([...new Set(cueIds(result.events))], ["chest_drop"]);
});

test("facing the camera asks to turn side-on (a front view can't measure knee bend)", () => {
  const result = run({ from: 172, depths: [90, 90], repMs: 2000 }, {}, { facingCamera: true });
  assert.equal(result.last.reps, 0);
  assert.equal(result.last.status, "position");
  assert.match(result.last.guidance, /side-on/i);
});

test("feet leaving the frame mid-squat drop that rep with a clear message", () => {
  // Rep 2 runs from 3.0 s to 5.0 s; the feet are out of view from 3.6 s to 4.6 s, around its bottom.
  const plan: RepPlan = { from: 172, depths: [90, 90, 90], repMs: 2000, restMs: 500 };
  const result = run(plan, { dropouts: [{ from: 3600, to: 4600, parts: ["ankle", "heel", "foot"] }] });
  assert.equal(result.last.reps, 2);
  assert.equal(count(result.events, "lost"), 1);
  assert.ok(result.snapshots.some((snapshot) => snapshot.status === "unclear" && /feet/.test(snapshot.guidance)));
});

test("feet out of frame between reps pause counting without losing anything", () => {
  const plan: RepPlan = { from: 172, depths: [90, 90], repMs: 2000, restMs: 1500 };
  // The rest between the reps runs from 3.5 s to 5.0 s.
  const result = run(plan, { dropouts: [{ from: 3600, to: 4800, parts: ["ankle"] }] });
  assert.equal(result.last.reps, 2);
  assert.equal(count(result.events, "lost"), 0);
});
