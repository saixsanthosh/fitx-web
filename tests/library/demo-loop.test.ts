import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BLEND_MS, HOLD_MS, advanceDemo, blendDuration, frameInterval, frameLabel, initialDemoState, replayDemo, showFrame, togglePlay,
} from "@/components/exercises/demo-loop";

describe("the photo demonstration's timing (DemoLoop)", () => {
  test("starts on the first photo, looping, and only plays with two photos or more", () => {
    assert.deepEqual(initialDemoState({ autoplay: true, frames: 2 }), { frame: 0, playing: true, loop: true, steps: 0 });
    assert.equal(initialDemoState({ autoplay: true, frames: 1 }).playing, false);
    assert.equal(initialDemoState({ autoplay: false, frames: 2 }).playing, false);
  });

  test("one repetition visits every photo and comes back to the first; with Loop it carries on", () => {
    let state = initialDemoState({ autoplay: true, frames: 2 });
    state = advanceDemo(state, 2);
    assert.deepEqual([state.frame, state.playing], [1, true]);
    state = advanceDemo(state, 2);
    assert.deepEqual([state.frame, state.playing, state.steps], [0, true, 0]);
    state = advanceDemo(state, 2);
    assert.equal(state.frame, 1);
  });

  test("with Loop off it stops after one repetition, back on the first photo", () => {
    let state = { ...initialDemoState({ autoplay: true, frames: 3 }), loop: false };
    state = advanceDemo(state, 3);
    state = advanceDemo(state, 3);
    assert.equal(state.playing, true);
    state = advanceDemo(state, 3);
    assert.deepEqual([state.frame, state.playing], [0, false]);
  });

  test("Replay restarts from the first photo; choosing a photo pauses on it; play toggles", () => {
    const paused = showFrame({ ...initialDemoState({ autoplay: true, frames: 2 }), frame: 1 }, 7, 2);
    assert.deepEqual([paused.frame, paused.playing], [1, false]);
    assert.deepEqual([replayDemo(paused, 2).frame, replayDemo(paused, 2).playing], [0, true]);
    assert.equal(replayDemo(paused, 1).playing, false);
    assert.equal(togglePlay(paused, 2).playing, true);
    assert.equal(togglePlay(paused, 1).playing, false);
    assert.equal(advanceDemo({ ...paused, playing: true }, 1).playing, false);
  });

  test("half speed doubles the hold and blend; reduced motion cuts without a blend", () => {
    assert.equal(frameInterval(1), HOLD_MS + BLEND_MS);
    assert.equal(frameInterval(0.5), (HOLD_MS + BLEND_MS) * 2);
    assert.equal(frameInterval(0), HOLD_MS + BLEND_MS);
    assert.equal(blendDuration(0.5, false), BLEND_MS * 2);
    assert.equal(blendDuration(1, true), 0);
  });

  test("labels for the live region", () => {
    assert.equal(frameLabel(0, 2), "Photo 1 of 2");
    assert.equal(frameLabel(0, 1), "Photo");
  });
});

describe("DemoLoop and the player (source)", () => {
  const loop = readFileSync(new URL("../../src/components/exercises/DemoLoop.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../src/components/exercises/DemoLoop.module.css", import.meta.url), "utf8");
  const player = readFileSync(new URL("../../src/components/exercises/ExerciseDemoPlayer.tsx", import.meta.url), "utf8");

  test("says plainly that no verified video exists and offers play, replay, loop and half speed", () => {
    assert.match(loop, /No verified video yet/);
    for (const name of ["Replay demonstration", "Loop", "Half speed", "Pause demonstration", "Play demonstration"]) assert.ok(loop.includes(`"${name}"`), name);
    assert.match(loop, /aria-pressed=\{state\.loop\}/);
  });

  test("never starts on its own under reduced motion, and pauses off screen or in a hidden tab", () => {
    assert.match(loop, /if \(autoplayed\.current \|\| reducedMotion \|\| !onScreen \|\| frames < 2\) return;/);
    assert.match(loop, /const running = state\.playing && onScreen && visible && frames > 1;/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.doesNotMatch(css, /\b(width|height|top|left)\s*:[^;]*var\(--demo-blend/);
  });

  test("each frame has its own caption, changing with the frame and read out only while paused", () => {
    assert.match(loop, /const caption = shown\[frame\]\?\.caption \?\? null;/);
    assert.match(loop, /data-demo-caption aria-live=\{state\.playing \? "off" : "polite"\}/);
    assert.match(loop, /key=\{`\$\{frame\}-\$\{caption\}`\}/);
    assert.match(css, /\.frameCaption \{[^}]*min-height/);
  });

  test("the caption row is as tall as the longest caption, so the controls never move when the frame changes", () => {
    // The other frames' captions share the row's grid cell, hidden and out of the accessibility tree.
    assert.match(loop, /className=\{styles\.captionSizer\} aria-hidden="true"/);
    assert.match(css, /\.frameCaption \{[^}]*display: grid/);
    assert.match(css, /\.frameCaption > \* \{ grid-area: 1 \/ 1;/);
    assert.match(css, /\.captionSizer \{ visibility: hidden; \}/);
  });

  test("an AI demonstration says what it is and offers the model choice when both exist", () => {
    assert.match(loop, /DEMO_LABEL/);
    assert.match(loop, /role="radiogroup" aria-label="Demonstration model"/);
    assert.match(loop, /const chooser = onModelChange && models\.length > 1;/);
    assert.match(loop, /type="radio"/);
    assert.match(player, /models=\{models\} model=\{shownModel\} onModelChange=/);
    assert.match(css, /\.model \{[^}]*min-height: 2\.75rem/, "44 px targets");
  });

  test("a verified video keeps replay and loop controls; with no media at all the player says so", () => {
    assert.match(player, /aria-label="Replay demonstration"/);
    assert.match(player, /aria-pressed=\{loop\} aria-label="Loop"/);
    assert.match(player, /No photo or video yet/);
  });
});
