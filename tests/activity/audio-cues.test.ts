// Spoken cues while recording: when they fire and what they say.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cueEveryKm, splitCue, stateCue } from "@/lib/activity/audio-cues";

const km = (index: number, movingSeconds: number) => ({ index, distanceM: 1000, movingSeconds, elapsedSeconds: movingSeconds });

test("runs and walks hear every kilometre: distance, time, last kilometre and average pace", () => {
  const splits = [km(1, 300), km(2, 312)];
  assert.equal(
    splitCue("run", splits, { movingSeconds: 612, distanceM: 2000 }),
    "2 kilometres. Time 10 minutes 12 seconds. Last kilometre 5 minutes 12 seconds. Average pace 5 minutes 6 seconds per kilometre.",
  );
  assert.equal(cueEveryKm("hike"), 1);
});

test("rides hear every 5 km, with speeds", () => {
  const splits = [1, 2, 3, 4, 5].map((index) => km(index, 120));
  assert.equal(splitCue("ride", splits.slice(0, 4), { movingSeconds: 480, distanceM: 4000 }), null);
  assert.equal(splitCue("ride", splits, { movingSeconds: 600, distanceM: 5000 }), "5 kilometres. Time 10 minutes. Last 5 kilometres at 30.0 kilometres an hour. Average 30.0.");
});

test("no cue for a partial kilometre or unknown time", () => {
  assert.equal(splitCue("run", [{ index: 1, distanceM: 400, movingSeconds: 100, elapsedSeconds: 100 }], { movingSeconds: 100, distanceM: 400 }), null);
  assert.equal(splitCue("run", [km(1, 0)], { movingSeconds: 0, distanceM: 1000 }), null);
  assert.equal(splitCue("run", [], { movingSeconds: 0, distanceM: 0 }), null);
});

test("long activities say hours", () => {
  const splits = Array.from({ length: 10 }, (_, i) => km(i + 1, 400));
  assert.match(splitCue("walk", splits, { movingSeconds: 4000, distanceM: 10_000 }) ?? "", /^10 kilometres\. Time 1 hour 6 minutes\./);
});

test("state cues", () => {
  assert.equal(stateCue("trail_run", "started"), "Trail run started.");
  assert.equal(stateCue("run", "auto-paused"), "Auto-paused.");
  assert.equal(stateCue("run", "auto-resumed"), "Moving again.");
});
