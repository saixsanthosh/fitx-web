import { test } from "node:test";
import assert from "node:assert/strict";
import { getExerciseRule } from "@/lib/form-rules/catalog";
import { createCoachSession } from "@/lib/form-rules/session";
import type { ExerciseRule } from "@/lib/form-rules/types";
import type { RepPlan } from "./synthetic";
import { count, cueIds, planDuration, play, pushUp, repValueAt, sequence, squat } from "./synthetic";

const rule = getExerciseRule("push_up") as ExerciseRule;
const reps = (n: number, depth = 80): number[] => Array.from({ length: n }, () => depth);
const run = (plan: RepPlan, options: Parameters<typeof sequence>[2] = {}, sag: (t: number) => number = () => 0) =>
  play(createCoachSession(rule), sequence(planDuration(plan), (t) => pushUp(repValueAt(plan, t), { sag: sag(t) }), options));

test("counts ten full push-ups, all clean", () => {
  const result = run({ from: 170, depths: reps(10), repMs: 1500, restMs: 500 });
  assert.equal(result.last.reps, 10);
  assert.equal(result.last.cleanReps, 10);
  assert.equal(result.last.partials, 0);
  assert.equal(count(result.events, "rep"), 10);
  assert.equal(result.last.status, "active");
});

test("reps that stop short of 100° at the elbow are partial and not counted", () => {
  const result = run({ from: 170, depths: [80, 125, 82, 130, 78], repMs: 1500 });
  assert.equal(result.last.reps, 3);
  assert.equal(result.last.partials, 2);
  const partials = result.events.filter((event) => event.type === "partial");
  assert.equal(partials.length, 2);
  assert.match(partials[0].type === "partial" ? partials[0].cue.text : "", /lower your chest/i);
});

test("small wobbles at the top are neither reps nor partial reps", () => {
  const result = run({ from: 170, depths: [152, 150, 148], repMs: 1200 });
  assert.equal(result.last.reps, 0);
  assert.equal(result.last.partials, 0);
});

test("noisy landmarks still give exact counts, at 30 and at 12 frames per second", () => {
  for (const [fps, seed] of [[30, 1], [30, 2], [12, 3], [12, 4]] as const) {
    const result = run({ from: 168, depths: reps(12, 85), repMs: 1400, restMs: 300 }, { fps, noise: 0.006, seed });
    assert.equal(result.last.reps, 12, `fps ${fps}, seed ${seed}`);
    assert.equal(result.last.partials, 0, `fps ${fps}, seed ${seed}`);
  }
});

test("sagging hips raise the hip cue; those reps count but are not clean", () => {
  const plan: RepPlan = { from: 170, depths: reps(5), repMs: 1500, restMs: 600 };
  // Reps 2 and 3 run from 2.9 s to 6.5 s.
  const result = run(plan, {}, (t) => (t > 2900 && t < 6500 ? 0.12 : 0));
  assert.equal(result.last.reps, 5);
  assert.equal(result.last.cleanReps, 3);
  assert.ok(cueIds(result.events).includes("hip_sag"));
  assert.equal(result.summary.cues.find((cue) => cue.id === "hip_sag")?.count, 2);
});

test("piked hips raise the hips-too-high cue", () => {
  const result = run({ from: 170, depths: reps(3), repMs: 1500 }, {}, () => -0.15);
  assert.equal(result.last.reps, 3);
  assert.deepEqual([...new Set(cueIds(result.events))], ["hip_pike"]);
});

test("losing sight of the feet mid-rep drops that rep instead of guessing", () => {
  const plan: RepPlan = { from: 170, depths: reps(5), repMs: 1500, restMs: 500 };
  // Rep 3 runs from 4.5 s to 6.0 s; hide the ankles across its bottom for 900 ms.
  const result = run(plan, { dropouts: [{ from: 4900, to: 5800, parts: ["ankle", "heel", "foot"] }] });
  assert.equal(result.last.reps, 4);
  assert.equal(count(result.events, "lost"), 1);
  const during = result.snapshots.find((snapshot) => snapshot.t - 10_000 > 5000 && snapshot.t - 10_000 < 5700);
  assert.equal(during?.status, "unclear");
  assert.match(during?.guidance ?? "", /feet/);
});

test("a short blip in tracking (under the grace period) does not lose the rep", () => {
  const plan: RepPlan = { from: 170, depths: reps(5), repMs: 1500, restMs: 500 };
  const result = run(plan, { dropouts: [{ from: 5100, to: 5350, parts: ["wrist"] }] });
  assert.equal(result.last.reps, 5);
  assert.equal(count(result.events, "lost"), 0);
});

test("dim light (every landmark below the confidence bar) counts nothing and says so", () => {
  const result = run({ from: 170, depths: reps(4), repMs: 1500 }, { visibility: 0.4 });
  assert.equal(result.last.reps, 0);
  assert.equal(result.last.status, "unclear");
  assert.match(result.last.guidance, /can't see/i);
});

test("nobody in view is reported as searching", () => {
  const plan: RepPlan = { from: 170, depths: reps(2), repMs: 1500 };
  const result = run(plan, { dropouts: [{ from: 0, to: 1e9, nobody: true }] });
  assert.equal(result.last.reps, 0);
  assert.equal(result.last.status, "searching");
});

test("standing up is not a push-up position, so arm movement there is never counted", () => {
  const frames = sequence(8000, () => squat(175));
  const result = play(createCoachSession(rule), frames);
  assert.equal(result.last.reps, 0);
  assert.equal(result.last.status, "position");
  assert.match(result.last.guidance, /high plank/i);
});

test("facing the camera head-on asks to turn side-on", () => {
  const plan: RepPlan = { from: 170, depths: reps(3), repMs: 1500 };
  const frames = sequence(planDuration(plan), (t) => {
    const body = pushUp(repValueAt(plan, t));
    // Shoulders and hips spread wide and both clearly seen: the camera is in front of the head.
    for (const part of ["shoulder", "hip"] as const) body.far[part] = { x: body.near[part]!.x, y: body.near[part]!.y - 0.25 };
    return { ...body, farVisibility: 0.95 };
  });
  const result = play(createCoachSession(rule), frames);
  assert.equal(result.last.reps, 0);
  assert.equal(result.last.status, "position");
  assert.match(result.last.guidance, /side-on/i);
});

test("going back down before straightening the arms asks for a full lockout and counts one rep", () => {
  const curve = (t: number) => {
    // Down to 80°, up only to 130°, down to 80° again, then all the way up.
    const points: Array<[number, number]> = [[0, 170], [800, 170], [1600, 80], [2300, 130], [3000, 80], [3900, 170], [5000, 170]];
    for (let i = 1; i < points.length; i += 1) {
      const [t0, v0] = points[i - 1];
      const [t1, v1] = points[i];
      if (t <= t1) return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
    return 170;
  };
  const result = play(createCoachSession(rule), sequence(5000, (t) => pushUp(curve(t))));
  assert.equal(result.last.reps, 1);
  assert.ok(cueIds(result.events).includes("lockout"));
});
