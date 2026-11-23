// The sign-in scene's pure parts (src/components/auth/scene/scene-math.ts) and the stage's promises: a still frame of
// the same scene for every theme and framing, the tilt permission behind a button, nothing moving with reduced motion.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import {
  follow, idleDrift, LIFT_TIMES, STILL_SECONDS, liftTimeAt, LOOP_SECONDS, lookWeightAt, medianFrame, pointerLook, sceneVerdict, SLOW_FRAME, tiltLook, TILT_RANGE_DEGREES,
} from "@/components/auth/scene/scene-math";

const source = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

test("the set opens with the chalk clap, then loops without a jump and never lets go of the bar", () => {
  assert.equal(liftTimeAt(0), 0);
  assert.ok(liftTimeAt(0.4) > 0 && liftTimeAt(0.4) < LIFT_TIMES.clapEnd);
  const opening = 0.75;
  assert.ok(Math.abs(liftTimeAt(opening) - LIFT_TIMES.clapEnd) < 1e-9, "the loop starts where the clap ends");
  // Continuous: no frame-to-frame jump bigger than a fast pull would make.
  let previous = liftTimeAt(0);
  for (let t = 0; t <= opening + LOOP_SECONDS * 2.5; t += 1 / 60) {
    const now = liftTimeAt(t);
    assert.ok(Math.abs(now - previous) < 0.03, `jump at ${t.toFixed(2)} s: ${previous} → ${now}`);
    assert.ok(now < 2.27, "the film's release (the bar dropping) never plays");
    previous = now;
  }
  assert.ok(Math.abs(liftTimeAt(opening + 3) - liftTimeAt(opening + 3 + LOOP_SECONDS)) < 1e-9, "it repeats");
  const peak = Math.max(...Array.from({ length: 800 }, (_, i) => liftTimeAt(opening + (i / 800) * LOOP_SECONDS)));
  assert.ok(peak >= LIFT_TIMES.lockout, "each rep reaches lockout");
  for (const bad of [Number.NaN, -3, Number.POSITIVE_INFINITY]) assert.ok(Number.isFinite(liftTimeAt(bad)), String(bad));
});

test("the live scene starts on the still frame's moment: the held lockout, looking at you", () => {
  const t = liftTimeAt(STILL_SECONDS);
  assert.ok(t >= LIFT_TIMES.lockout && t <= LIFT_TIMES.held, `lift time ${t}`);
  assert.ok(lookWeightAt(t) > 0.6);
  assert.match(source("src/components/auth/scene/login-scene.ts"), /let clock = STILL_SECONDS;/);
});

test("he looks up at you standing and at lockout, not while he braces and pulls", () => {
  assert.ok(lookWeightAt(LIFT_TIMES.clapEnd) > 0.8);
  assert.ok(lookWeightAt(LIFT_TIMES.liftOff) < 0.1);
  assert.ok(lookWeightAt((LIFT_TIMES.liftOff + LIFT_TIMES.lockout) / 2) < 0.1);
  assert.ok(lookWeightAt(LIFT_TIMES.held) > 0.6);
  for (let t = 0; t <= 2.3; t += 0.01) {
    const weight = lookWeightAt(t);
    assert.ok(weight >= 0 && weight <= 1, `${weight} at ${t}`);
  }
});

test("the pointer becomes a look direction: centre is still, corners are the edge of the range", () => {
  const rect = { left: 100, top: 50, width: 800, height: 400 };
  assert.deepEqual(pointerLook(500, 250, rect), { x: 0, y: 0 });
  assert.deepEqual(pointerLook(100, 50, rect), { x: -1, y: 1 });
  assert.deepEqual(pointerLook(900, 450, rect), { x: 1, y: -1 });
  assert.deepEqual(pointerLook(5000, -900, rect), { x: 1, y: 1 }, "clamped");
  assert.deepEqual(pointerLook(10, 10, { left: 0, top: 0, width: 0, height: 0 }), { x: 0, y: 0 });
});

test("device tilt is read relative to how the phone was held, and turned with the screen", () => {
  const rest = { beta: 40, gamma: 0 };
  assert.deepEqual(tiltLook({ beta: 40, gamma: 0 }, rest, 0), { x: 0, y: 0 });
  // Tilting right (gamma up) looks right; tipping the top away (beta down) looks up.
  assert.deepEqual(tiltLook({ beta: 40, gamma: TILT_RANGE_DEGREES / 2 }, rest, 0), { x: 0.5, y: 0 });
  assert.deepEqual(tiltLook({ beta: 40 - TILT_RANGE_DEGREES, gamma: 0 }, rest, 0), { x: 0, y: 1 });
  assert.deepEqual(tiltLook({ beta: 40, gamma: 90 }, rest, 0), { x: 1, y: 0 }, "clamped");
  // Landscape: the axes swap.
  const landscape = tiltLook({ beta: 40 - 12, gamma: 0 }, rest, 90);
  assert.equal(landscape?.y, 0);
  assert.equal(landscape?.x, 0.5);
  assert.equal(tiltLook({ beta: null, gamma: 3 }, rest, 0), null, "no reading");
  // Past vertical the difference wraps instead of jumping.
  const wrapped = tiltLook({ beta: -175, gamma: 0 }, { beta: 175, gamma: 0 }, 0);
  assert.ok(wrapped && Math.abs(wrapped.y) < 0.5);
});

test("the camera follows smoothly at any frame rate", () => {
  assert.equal(follow(0, 1, 0.25, 0.25), 0.5, "half the way in one half-life");
  const sixty = Array.from({ length: 60 }).reduce<number>((value) => follow(value, 1, 1 / 60, 0.2), 0);
  const thirty = Array.from({ length: 30 }).reduce<number>((value) => follow(value, 1, 1 / 30, 0.2), 0);
  assert.ok(Math.abs(sixty - thirty) < 1e-9, "60 fps and 30 fps land in the same place");
  assert.equal(follow(0.3, 1, 0, 0.2), 0.3, "no time, no move");
  const drift = idleDrift(12.5);
  assert.ok(Math.abs(drift.x) <= 0.32 && Math.abs(drift.y) <= 0.16, "the idle drift stays small");
});

test("only capable devices start the live scene; everything else keeps the still frame", () => {
  const capable = { reducedMotion: false, cores: 8, memory: 8, workers: true };
  assert.equal(sceneVerdict(capable), "live");
  assert.equal(sceneVerdict({ ...capable, reducedMotion: true }), "reduced-motion");
  assert.equal(sceneVerdict({ ...capable, saveData: true }), "save-data");
  assert.equal(sceneVerdict({ ...capable, workers: false }), "no-workers");
  assert.equal(sceneVerdict({ ...capable, memory: 2 }), "low-end");
  assert.equal(sceneVerdict({ ...capable, cores: 2 }), "low-end");
  assert.equal(sceneVerdict({ ...capable, cores: 2, appleMobile: true }), "live", "iOS always reports 2 cores");
  assert.equal(sceneVerdict({ reducedMotion: false, workers: true }), "live", "unknown hardware gets a chance; the frame-rate guard decides");
  assert.equal(medianFrame([0.02, 0.05, 0.01]), 0.02);
  assert.equal(medianFrame([]), 0);
  assert.ok(SLOW_FRAME.downgrade < SLOW_FRAME.stop);
});

test("the stage: a still frame of the same scene per theme and framing, the tilt permission on a tap, still with reduced motion", () => {
  for (const theme of ["light", "dark"]) {
    for (const framing of ["wide", "tall"]) {
      const file = new URL(`../../public/media/login/still-${theme}-${framing}.webp`, import.meta.url);
      assert.ok(existsSync(file), `${theme} ${framing}`);
      assert.ok(statSync(file).size < 120 * 1024, `${theme} ${framing} stays small for a fast first paint`);
    }
  }
  const stage = source("src/components/auth/AuthStage.tsx");
  assert.match(stage, /requestPermission/, "iOS motion access is asked for");
  assert.match(stage, /onClick=\{\(\) => void askTilt\(\)\}/, "only from the button's tap");
  assert.match(stage, /Tilt to look around/);
  assert.match(stage, /import\("\.\/scene\/login-scene"\)/, "three.js loads after the page, never in the first bundle");
  assert.match(stage, /aria-label=\{paused \? "Play animation" : "Pause animation"\}/);
  const css = source("src/components/auth/auth.module.css");
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*\.still \{ transform: none !important; \}/);
  const scene = source("src/components/auth/scene/login-scene.ts");
  assert.match(scene, /if \(DEV\) \{[\s\S]*__fitxLoginScene/, "the still-frame hook exists only in development");
});
