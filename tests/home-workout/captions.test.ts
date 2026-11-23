import { test } from "node:test";
import assert from "node:assert/strict";
import type { CoachSnapshot } from "@/lib/form-rules/session";
import { captionFor, isSpokenWait } from "@/lib/home-workout/captions";

const snap = (patch: Partial<CoachSnapshot>): CoachSnapshot => ({
  t: 0, status: "active", guidance: "Counting.", phase: "start", reps: 0, cleanReps: 0, partials: 0, holdMs: 0, positionMs: 0, progress: 0, cue: null, side: "left", events: [], calibrating: false, calibrated: false, usedWorld: false, ...patch,
});

test("a form cue is the caption, in its short spoken words with the full sentence under it", () => {
  const caption = captionFor(snap({ cue: { id: "hip_sag", text: "Hips are sagging. Squeeze your glutes.", speech: "Lift your hips" } }));
  assert.deepEqual(caption, { headline: "Lift your hips", detail: "Hips are sagging. Squeeze your glutes.", tone: "cue" });
  assert.equal(isSpokenWait(caption), false, "cues are already spoken by the rule engine");
});

test("waiting states get a few large words that the voice also says", () => {
  assert.equal(captionFor(null).headline, "Step into view");
  assert.equal(captionFor(snap({ status: "searching", guidance: "Step into view, side-on to the camera." })).headline, "Step into view");
  assert.equal(captionFor(snap({ status: "unclear", guidance: "You're too far away to measure. Move closer to the camera." })).headline, "Move closer");
  assert.equal(captionFor(snap({ status: "unclear", guidance: "Can't see your feet clearly. Move back until your whole body is in view." })).headline, "Move back");
  assert.equal(captionFor(snap({ status: "unclear", guidance: "Can't see your hands clearly. Keep them in view of the camera." })).headline, "Can’t see you clearly");
  assert.equal(captionFor(snap({ status: "position", guidance: "Turn side-on to the camera." })).headline, "Turn side-on");
  assert.equal(captionFor(snap({ status: "position", guidance: "Face the camera." })).headline, "Face the camera");
  const position = captionFor(snap({ status: "position", guidance: "Get into a high plank, side-on to the camera." }));
  assert.deepEqual(position, { headline: "Get in position", detail: "Get into a high plank, side-on to the camera.", tone: "wait" });
  assert.equal(isSpokenWait(position), true);
  for (const caption of [position, captionFor(snap({ status: "searching", guidance: "x" }))]) assert.ok(caption.headline.split(" ").length <= 4);
});

test("while counting the caption stays short and quiet", () => {
  assert.equal(captionFor(snap({ guidance: "Ready. Start whenever you like." })).headline, "Ready. Go");
  assert.equal(captionFor(snap({ phase: "outbound" })).headline, "Counting");
  assert.equal(captionFor(snap({ phase: "holding", guidance: "Hold steady in one straight line." })).headline, "Hold");
  assert.equal(captionFor(snap({ phase: "adjust", guidance: "Straighten your body line to keep the timer running." })).tone, "wait");
});

test("while the coach fits the start position, the caption asks the member to hold still", () => {
  const caption = captionFor(snap({ status: "position", calibrating: true, guidance: "Hold still a moment while the coach fits your start position." }));
  assert.equal(caption.headline, "Hold still");
  assert.equal(caption.tone, "wait");
});
