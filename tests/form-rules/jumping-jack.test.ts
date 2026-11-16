import { test } from "node:test";
import assert from "node:assert/strict";
import { getExerciseRule } from "@/lib/form-rules/catalog";
import { createCoachSession } from "@/lib/form-rules/session";
import type { ExerciseRule } from "@/lib/form-rules/types";
import type { RepPlan } from "./synthetic";
import { count, cueIds, jack, planDuration, play, PORTRAIT, repValueAt, sequence, squat } from "./synthetic";

const rule = getExerciseRule("jumping_jack") as ExerciseRule;
const run = (plan: RepPlan, options: Parameters<typeof sequence>[2] = {}, reach: Parameters<typeof jack>[1] = {}) =>
  play(createCoachSession(rule), sequence(planDuration(plan), (t) => jack(repValueAt(plan, t), reach), { aspect: PORTRAIT, ...options }));
const continuous = (n: number, repMs: number): RepPlan => ({ from: 0, depths: Array.from({ length: n }, () => 1), repMs, restMs: 0, tailMs: 800 });

test("counts continuous jumping jacks at a brisk pace", () => {
  const result = run({ ...continuous(20, 750), restMs: 0 }, { fps: 30 });
  assert.equal(result.last.reps, 20);
  assert.equal(result.last.partials, 0);
});

test("still counts every jack at 15 frames per second with noise", () => {
  for (const seed of [51, 52, 53]) {
    const result = run(continuous(20, 750), { fps: 15, noise: 0.005, seed });
    assert.equal(result.last.reps, 20, `seed ${seed}`);
  }
});

test("arms that stop at shoulder height make a partial jack and an 'arms up' cue", () => {
  const result = run({ from: 0, depths: [1, 1, 1], repMs: 900, restMs: 300 }, {}, { armReach: 0.55 });
  assert.equal(result.last.reps, 0);
  assert.equal(result.last.partials, 3);
  assert.ok(cueIds(result.events).includes("arms_low"));
});

test("feet that stay together make a partial jack and a 'feet wider' cue", () => {
  const result = run({ from: 0, depths: [1, 1, 1], repMs: 900, restMs: 300 }, {}, { legReach: 0.15 });
  assert.equal(result.last.reps, 0);
  assert.equal(result.last.partials, 3);
  assert.ok(cueIds(result.events).includes("feet_narrow"));
});

test("side-on to the camera asks to face it", () => {
  const result = play(createCoachSession(rule), sequence(4000, () => squat(172), { aspect: PORTRAIT }));
  assert.equal(result.last.reps, 0);
  assert.notEqual(result.last.status, "active");
  assert.ok(result.snapshots.some((snapshot) => /face the camera/i.test(snapshot.guidance) || snapshot.status === "unclear"));
});

test("hands leaving the frame overhead pause counting instead of guessing", () => {
  // Jacks 4–6 happen with the wrists hidden (e.g. cut off at the top of the picture).
  const plan = continuous(10, 800);
  const result = run(plan, { dropouts: [{ from: 2400, to: 4800, parts: ["wrist"] }] });
  assert.equal(result.last.reps, 7, "the three jacks nobody could see are not counted");
  const countedWhileHidden = result.snapshots.filter((s) => s.t - 10_000 >= 2400 && s.t - 10_000 < 4800 && s.events.some((e) => e.type === "rep"));
  assert.equal(countedWhileHidden.length, 0);
  assert.ok(result.snapshots.some((snapshot) => snapshot.status === "unclear" && /hands clearly\. Keep them/.test(snapshot.guidance)));
});

test("losing the hands halfway through a jack drops that jack", () => {
  const plan = continuous(6, 800);
  // Jack 3 runs from 1.6 s to 2.4 s; the wrists vanish at its top for 700 ms. Jack 4 is already
  // under way when they come back, so only jacks 1, 2, 5 and 6 are seen whole.
  const result = run(plan, { dropouts: [{ from: 1900, to: 2600, parts: ["wrist"] }] });
  assert.equal(count(result.events, "lost"), 1);
  assert.equal(result.last.reps, 4);
});
