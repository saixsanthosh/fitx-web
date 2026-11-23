import { test } from "node:test";
import assert from "node:assert/strict";
import { EXERCISE_RULES } from "@/lib/form-rules/catalog";
import { createCoachSession } from "@/lib/form-rules/session";
import { DEMONSTRATIONS } from "./kinematics/demos";
import { loopDuration, sampleDemo } from "./kinematics/figure";
import { cueIds, figureSequence, LANDSCAPE, PORTRAIT, play } from "./synthetic";

/** Reps each demonstration loop should count (high knees lift both knees; the camera counts the near knee of a climber). */
const REPS_PER_LOOP: Record<string, number> = { high_knees: 2 };
const LOOPS = 4;

for (const rule of EXERCISE_RULES) {
  test(`the ${rule.name} reference motion is counted cleanly by its own camera rule`, () => {
    const demo = DEMONSTRATIONS[rule.id];
    assert.ok(demo, `${rule.id} has a demonstration`);
    assert.equal(demo.view, rule.view, `${rule.id}: the demonstration faces the camera the way the rule expects`);
    const loop = loopDuration(demo);
    // Start once the figure has settled into the first pose, which is the rule's start position.
    const start = demo.keyframes[0].moveMs;
    const aspect = rule.landscape ? LANDSCAPE : PORTRAIT;
    const frames = figureSequence(LOOPS * loop + 200, demo.view, (t) => sampleDemo(demo, start + t).points, { aspect, noise: 0.0015, seed: 5 });
    const result = play(createCoachSession(rule), frames);
    assert.deepEqual(cueIds(result.events), [], `${rule.id}: no form cue`);
    if (rule.motion.kind === "reps") {
      assert.equal(result.last.reps, LOOPS * (REPS_PER_LOOP[rule.id] ?? 1), `${rule.id}: reps`);
      assert.equal(result.last.partials, 0, `${rule.id}: partial reps`);
      assert.equal(result.last.cleanReps, result.last.reps, `${rule.id}: clean reps`);
    } else {
      assert.ok(result.last.holdMs > LOOPS * loop * 0.4, `${rule.id}: held ${result.last.holdMs} ms of ${LOOPS * loop}`);
    }
  });
}

test("every reference motion loops in a few seconds and labels its moves", () => {
  for (const [id, demo] of Object.entries(DEMONSTRATIONS)) {
    const loop = loopDuration(demo);
    assert.ok(loop >= 900 && loop <= 6000, `${id}: loop of ${loop} ms`);
    for (const frame of demo.keyframes) assert.ok(frame.label && frame.label.split(" ").length <= 4, `${id}: short label`);
  }
});
