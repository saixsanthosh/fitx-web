import { test } from "node:test";
import assert from "node:assert/strict";
import { getExerciseRule } from "@/lib/form-rules/catalog";
import { createCoachSession, missingGuidance } from "@/lib/form-rules/session";
import type { ExerciseRule } from "@/lib/form-rules/types";
import type { Body, RepPlan } from "./synthetic";
import { cueIds, frameOf, plank, planDuration, play, pushUp, repValueAt, sequence, squat } from "./synthetic";

const pushUpRule = getExerciseRule("push_up") as ExerciseRule;
const plankRule = getExerciseRule("plank") as ExerciseRule;

test("a fault that lasts the whole set is counted on every rep but spoken at most every 6 s", () => {
  const plan: RepPlan = { from: 170, depths: Array.from({ length: 8 }, () => 80), repMs: 1500, restMs: 300 };
  const result = play(createCoachSession(pushUpRule), sequence(planDuration(plan), (t) => pushUp(repValueAt(plan, t), { sag: 0.12 })));
  assert.equal(result.last.reps, 8);
  assert.equal(result.last.cleanReps, 0);
  assert.equal(result.summary.cues.find((cue) => cue.id === "hip_sag")?.count, 8);
  const spoken = cueIds(result.events).filter((id) => id === "hip_sag").length;
  assert.ok(spoken >= 2 && spoken <= Math.ceil(planDuration(plan) / 6000) + 1, `spoken ${spoken} times`);
});

test("pause() drops a rep in progress and the paused time is not counted", () => {
  const session = createCoachSession(pushUpRule);
  const plan: RepPlan = { from: 170, depths: [80, 80, 80], repMs: 1500, restMs: 500 };
  const frames = sequence(planDuration(plan), (t) => pushUp(repValueAt(plan, t)));
  // Pause in the middle of rep 2 (2.5 s – 4.0 s), resume at the same point a minute later.
  const cut = frames.findIndex((frame) => frame.t - 10_000 >= 3200);
  play(session, frames.slice(0, cut));
  session.pause();
  const resumed = frames.slice(cut).map((frame) => ({ ...frame, t: frame.t + 60_000 }));
  const result = play(session, resumed);
  assert.equal(result.last.reps, 2, "rep 2 was interrupted by the pause; reps 1 and 3 count");
  const seconds = planDuration(plan) / 1000;
  assert.ok(Math.abs(result.summary.activeSeconds - seconds) <= 1, `Time is ${result.summary.activeSeconds} s for a ${seconds} s set with a minute paused`);
});

test("the summary's Time runs from the first counted movement to the last", () => {
  const plan: RepPlan = { from: 170, depths: [80, 80, 80], repMs: 1500, restMs: 500 };
  const frames = sequence(planDuration(plan), (t) => pushUp(repValueAt(plan, t)));
  // Five seconds of standing before getting down is not part of the set.
  const before = sequence(5000, () => squat(175)).map((frame) => ({ ...frame, t: frame.t - 6000 }));
  const result = play(createCoachSession(pushUpRule), [...before, ...frames]);
  assert.equal(result.summary.reps, 3);
  assert.ok(Math.abs(result.summary.activeSeconds - planDuration(plan) / 1000) <= 1, `Time is ${result.summary.activeSeconds} s`);
});

test("a paused plank keeps its time and adds nothing while paused", () => {
  const session = createCoachSession(plankRule);
  play(session, sequence(5000, () => plank()));
  session.pause();
  const later = sequence(5000, () => plank()).map((frame) => ({ ...frame, t: frame.t + 120_000 }));
  const result = play(session, later);
  assert.ok(Math.abs(result.last.holdMs - 10_000) < 400, `held ${result.last.holdMs} ms`);
});

test("the summary holds only counts and cue labels, never body positions", () => {
  const plan: RepPlan = { from: 170, depths: [80, 125, 80], repMs: 1500 };
  const result = play(createCoachSession(pushUpRule), sequence(planDuration(plan), (t) => pushUp(repValueAt(plan, t))));
  assert.deepEqual(Object.keys(result.summary).sort(), ["activeSeconds", "cleanReps", "cues", "exerciseId", "holdSeconds", "kind", "partials", "positionSeconds", "repLog", "reps", "unclearSeconds"]);
  assert.deepEqual(result.summary.cues.map((cue) => Object.keys(cue).sort()), [["count", "id", "text"]]);
  // Form per rep: whether each counted rep was clean, and the cue ids raised during it.
  assert.deepEqual(result.summary.repLog, [{ clean: true, cues: [] }, { clean: true, cues: [] }]);
  const json = JSON.stringify(result.summary);
  assert.doesNotMatch(json, /"(x|y|z|visibility|points|landmarks)"/);
  assert.equal(result.summary.reps, 2);
  assert.equal(result.summary.partials, 1);
});

test("someone far from the camera is told to move closer instead of being counted", () => {
  const shrink = (body: Body): Body => {
    const scale = (limb: Body["near"]) => Object.fromEntries(Object.entries(limb).map(([part, p]) => [part, { x: 0.9 + (p.x - 0.9) * 0.15, y: 0.75 + (p.y - 0.75) * 0.15 }]));
    return { ...body, near: scale(body.near), far: scale(body.far) };
  };
  const plan: RepPlan = { from: 170, depths: [80, 80], repMs: 1500 };
  const result = play(createCoachSession(pushUpRule), sequence(planDuration(plan), (t) => shrink(pushUp(repValueAt(plan, t)))));
  assert.equal(result.last.reps, 0);
  assert.equal(result.last.status, "unclear");
  assert.match(result.last.guidance, /move closer/i);
});

test("a single frame never counts and an empty frame list is harmless", () => {
  const session = createCoachSession(pushUpRule);
  const snapshot = session.update(frameOf(pushUp(80), 1000));
  assert.equal(snapshot.reps, 0);
  assert.equal(session.summary().activeSeconds, 0);
});

test("missing-joint messages name the body part and what to do", () => {
  assert.equal(missingGuidance([]), "");
  assert.match(missingGuidance(["ankle"]), /^Can't see your feet clearly\. Move back/);
  assert.match(missingGuidance(["wrist", "elbow"]), /elbows and hands clearly\. Keep them in view/);
  assert.match(missingGuidance(["ear"]), /head clearly\. Keep it in view/);
  assert.match(missingGuidance(["shoulder", "hip", "knee"]), /whole body is in view/);
});
