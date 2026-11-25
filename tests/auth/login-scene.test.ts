// The sign-in scene's pure parts (src/components/auth/scene/scene-math.ts) and the stage's promises: a still frame of
// the same scene for every theme and framing, the tilt permission behind a button, nothing moving with reduced motion,
// and (hotfix 2d) the live scene only when the address asks for it with ?scene=live: without it no page of the auth
// group can load three.js or the athlete's worker.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createFrameGuard, follow, FRAME_GUARD, type FrameGuard, type FrameVerdict, idleDrift, LIFT_TIMES, liveSceneRequested, STILL_DRIFT_SECONDS, STILL_SECONDS, STILL_SWING, liftTimeAt,
  LOOP_SECONDS, lookWeightAt, medianFrame, pointerLook, sceneVerdict, SLOW_FRAME, stillDriftKeyframes, stillShift, tiltLook, TILT_RANGE_DEGREES,
} from "@/components/auth/scene/scene-math";
import { JOBS } from "../../scripts/brand/films/lib/plan.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
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
  const capable = { enabled: true, reducedMotion: false, cores: 8, memory: 8, workers: true };
  assert.equal(sceneVerdict(capable), "live");
  assert.equal(sceneVerdict({ ...capable, reducedMotion: true }), "reduced-motion");
  assert.equal(sceneVerdict({ ...capable, saveData: true }), "save-data");
  assert.equal(sceneVerdict({ ...capable, workers: false }), "no-workers");
  assert.equal(sceneVerdict({ ...capable, memory: 2 }), "low-end");
  assert.equal(sceneVerdict({ ...capable, cores: 2 }), "low-end");
  assert.equal(sceneVerdict({ ...capable, cores: 2, appleMobile: true }), "live", "iOS always reports 2 cores");
  assert.equal(sceneVerdict({ enabled: true, reducedMotion: false, workers: true }), "live", "unknown hardware gets a chance; the frame-rate guard decides");
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
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*\.still \{ transform: none !important; translate: none !important; scale: none !important; transition: none; \}/);
  const scene = source("src/components/auth/scene/login-scene.ts");
  assert.match(scene, /if \(DEV\) \{[\s\S]*__fitxLoginScene/, "the still-frame hook exists only in development");
});

// ------------------------------------------------------------------------------- hotfix 2d: the still frame by default

test("the live scene is off unless the address asks for it with ?scene=live", () => {
  const capable = { enabled: true, reducedMotion: false, cores: 8, memory: 8, workers: true };
  assert.equal(sceneVerdict({ ...capable, enabled: false }), "disabled", "a capable device keeps the still frame when nobody asked");
  assert.equal(sceneVerdict({ ...capable, enabled: false, reducedMotion: true }), "disabled", "not being asked for comes first");
  assert.equal(sceneVerdict({ ...capable, enabled: false, saveData: true, workers: false, memory: 1 }), "disabled");
  assert.equal(sceneVerdict(capable), "live", "asked for, a capable device may start it");
  assert.equal(liveSceneRequested("?scene=live"), true);
  assert.equal(liveSceneRequested("?next=%2Fprogress&scene=live"), true, "alongside other parameters");
  for (const search of ["", "?", "?scene=", "?scene=still", "?scene=Live", "?scenery=live", "?next=%2Fscene%3Dlive"]) {
    assert.equal(liveSceneRequested(search), false, search || "(no query)");
  }
  const stage = source("src/components/auth/AuthStage.tsx");
  assert.match(stage, /enabled: liveSceneRequested\(window\.location\.search\),/, "the stage reads the address it was opened with");
});

test("the stage imports the scene module only after the verdict says live", () => {
  const stage = source("src/components/auth/AuthStage.tsx");
  const runtime = [...stage.matchAll(/^import\s+(?!type\b)[^;]*?from\s+["']\.\/scene\/login-scene["']/gm)];
  assert.equal(runtime.length, 0, "no static import of the scene module (its type is imported as a type only)");
  assert.match(stage, /^import type \{ LoginScene \} from "\.\/scene\/login-scene";$/m);
  const imports = [...stage.matchAll(/import\("\.\/scene\/login-scene"\)/g)];
  assert.equal(imports.length, 1, "one dynamic import");
  const guard = stage.indexOf('if (reduced || verdict !== "live" || started.current) return;');
  const load = imports[0].index ?? -1;
  assert.ok(guard > 0 && guard < load, "the guard comes first");
  const effect = stage.lastIndexOf("useEffect(", load);
  assert.ok(effect >= 0 && effect < guard, "inside the same effect as the guard");
  assert.doesNotMatch(stage.slice(guard, load), /useEffect\(|=>\s*\{\s*import/, "nothing between the guard and the import starts it another way");
});

// A static import graph of the auth pages: every module the pages, their layouts and error boundaries pull in with
// `import ... from` (bundled into the pages' own chunks), and the dynamic `import()`s those modules hold.
const SRC = path.join(ROOT, "src");
const CODE = /\.(tsx?|mjs|js)$/;

function resolveModule(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(from), specifier);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, `${base}.js`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const packageName = (specifier: string) => specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");

function importsOf(file: string) {
  const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
  const found: { specifier: string; dynamic: boolean }[] = [];
  for (const match of code.matchAll(/\bimport\s+(type\s+)?([\w$*{}\s,]*?)\s*from\s*["']([^"']+)["']/g)) {
    if (match[1]) continue;
    const named = /^\{([\s\S]*)\}$/.exec(match[2].trim());
    if (named && named[1].split(",").map((part) => part.trim()).filter(Boolean).every((part) => part.startsWith("type "))) continue;
    found.push({ specifier: match[3], dynamic: false });
  }
  for (const match of code.matchAll(/\bimport\s+["']([^"']+)["']/g)) found.push({ specifier: match[1], dynamic: false });
  for (const match of code.matchAll(/\bexport\s+(type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*["']([^"']+)["']/g)) {
    if (!match[1]) found.push({ specifier: match[2], dynamic: false });
  }
  for (const match of code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) found.push({ specifier: match[1], dynamic: true });
  return found;
}

function staticGraph(entries: string[]) {
  const modules = new Set<string>();
  const packages = new Set<string>();
  const dynamic: { from: string; specifier: string }[] = [];
  const queue = [...entries];
  while (queue.length) {
    const file = queue.pop()!;
    if (modules.has(file)) continue;
    modules.add(file);
    if (!CODE.test(file)) continue;
    for (const { specifier, dynamic: lazy } of importsOf(file)) {
      if (lazy) {
        dynamic.push({ from: file, specifier });
        continue;
      }
      const target = resolveModule(file, specifier);
      if (target) queue.push(target);
      else if (!specifier.startsWith(".") && !specifier.startsWith("@/")) packages.add(packageName(specifier));
    }
  }
  return { modules, packages, dynamic };
}

test("no auth page can reach three.js or the athlete's worker except through the stage's guarded import", () => {
  const app = path.join(SRC, "app");
  const entries = [
    "layout.tsx", "error.tsx", "global-error.tsx", "not-found.tsx",
    "(auth)/layout.tsx", "(auth)/error.tsx",
    "(auth)/signin/page.tsx", "(auth)/signup/page.tsx", "(auth)/forgot-password/page.tsx", "(auth)/reset-password/page.tsx",
  ].map((file) => path.join(app, file));
  for (const entry of entries) assert.ok(existsSync(entry), entry);
  const graph = staticGraph(entries);
  const stagePath = path.join(SRC, "components/auth/AuthStage.tsx");
  const scenePath = path.join(SRC, "components/auth/scene/login-scene.ts");
  const workerClient = path.join(SRC, "components/brand/intro/character/client.ts");
  assert.ok(graph.modules.has(stagePath), "the walk reaches the stage (so it is really walking the pages)");
  assert.ok(graph.modules.has(path.join(SRC, "components/auth/scene/scene-math.ts")));
  assert.ok(graph.packages.has("framer-motion") && graph.packages.has("react"), "packages are seen");
  assert.ok(!graph.packages.has("three"), "three.js is not in the auth pages' own chunks");
  assert.ok(!graph.modules.has(scenePath), "the scene module is not in them either");
  assert.ok(!graph.modules.has(workerClient), "nor the athlete's worker client");
  // Every dynamic import those modules hold, and what it would bring: only the stage's import of the scene loads three.js.
  const lazyThree = graph.dynamic.filter(({ from, specifier }) => {
    const target = resolveModule(from, specifier);
    if (!target) return packageName(specifier) === "three";
    const closure = staticGraph([target]);
    return closure.packages.has("three") || closure.modules.has(workerClient);
  }).map(({ from, specifier }) => `${path.relative(ROOT, from)} → ${specifier}`);
  assert.deepEqual(lazyThree, ["src/components/auth/AuthStage.tsx → ./scene/login-scene"]);
  // And that import, followed, really is where three.js and the worker come from (the walk would see them).
  const scene = staticGraph([scenePath]);
  assert.ok(scene.packages.has("three") && scene.modules.has(workerClient), "the walk finds three.js behind the scene module");
});

test("the still frame drifts on the compositor: one loop of the idle drift as keyframes, the look in steps", () => {
  const frames = stillDriftKeyframes();
  assert.equal(frames.length, 25);
  assert.equal(frames[0].offset, 0);
  assert.equal(frames.at(-1)?.offset, 1);
  assert.equal(frames[0].transform, frames.at(-1)?.transform, "the loop has no seam");
  for (const [index, frame] of frames.entries()) {
    const match = /^translate3d\((-?\d+\.\d{3})%, (-?\d+\.\d{3})%, 0\)$/.exec(frame.transform);
    assert.ok(match, frame.transform);
    const drift = idleDrift((index / 24) * STILL_DRIFT_SECONDS);
    assert.ok(Math.abs(Number(match[1]) + drift.x * STILL_SWING.x) < 0.001 && Math.abs(Number(match[2]) - drift.y * STILL_SWING.y) < 0.001, frame.transform);
  }
  assert.ok(Math.abs(STILL_DRIFT_SECONDS - (2 * Math.PI) / 0.21) < 1e-9);
  assert.equal(stillShift(null), "0% 0%");
  assert.equal(stillShift({ x: 1, y: 1 }), "-1.6% 1.2%");
  assert.equal(stillShift({ x: -1, y: -1 }), "1.6% -1.2%");
  assert.equal(stillShift({ x: 0.5, y: -0.5 }), "-0.8% -0.6%");
  assert.equal(stillShift({ x: 0.02, y: -0.03 }), "0% 0%", "a phone's sensor noise moves nothing");
  assert.equal(stillShift({ x: 7, y: -7 }), "-1.6% -1.2%", "clamped");
  const stage = source("src/components/auth/AuthStage.tsx");
  assert.doesNotMatch(stage, /requestAnimationFrame/, "no script runs per frame for the still frame");
  assert.match(stage, /element\.animate\(stillDriftKeyframes\(\), \{ duration: STILL_DRIFT_SECONDS \* 1000, iterations: Infinity \}\)/);
  assert.match(stage, /element\.style\.translate = next;/);
  const css = source("src/components/auth/auth.module.css");
  assert.match(css, /\.still \{[^}]*transition: scale 0\.9s [^;]*, translate 0\.9s [^;]*;/, "the look and the zoom ease on the compositor");
  assert.match(css, /\.stage\[data-scene="still"\] \.still \{ scale: 1\.06; will-change: transform; \}/);
});

test("the films' still render opens the live scene on purpose", () => {
  const page = JOBS["login-stills"].page;
  assert.equal(page, "/signin?scene=live");
  assert.equal(liveSceneRequested(new URL(page, "http://fitx-lab.localhost").search), true);
  assert.match(source("scripts/brand/films/render.mjs"), /\$\{def\.page\}/, "render.mjs opens the plan's page");
});

// ------------------------------------------------------------------------- hotfix 2d: slow frames count in the guard

/** Feeds `count` frames of `seconds` each; returns the frame numbers (1-based) of each verdict other than "keep". */
function feed(guard: FrameGuard, seconds: number, count: number, visible = true) {
  const said: [number, FrameVerdict][] = [];
  for (let index = 1; index <= count; index += 1) {
    const verdict = guard.frame(seconds, visible);
    if (verdict !== "keep") said.push([index, verdict]);
  }
  return said;
}

test("the frame-rate guard counts slow frames, so a scene that runs slowly gives way to the still frame", () => {
  // 10 fps: frames of 0.1 s, which the old guard left out as stalls (dt >= 0.095), so the scene ran on for ever.
  for (const seconds of [0.1, 0.095, 0.25]) {
    const said = feed(createFrameGuard(), seconds, 200);
    assert.deepEqual(said.map(([, verdict]) => verdict).slice(0, 2), ["downgrade", "stop"], `${seconds} s frames step down, then stop (${JSON.stringify(said)})`);
    const stopAt = said[1][0];
    // The warm-up, then twice two seconds of frames (each judgement may overrun by a frame).
    assert.ok(stopAt * seconds <= FRAME_GUARD.warmup + seconds + 2 * (FRAME_GUARD.seconds + seconds) + 0.01, `within seconds of frames, not minutes (stops at frame ${stopAt})`);
  }
  // One frame in two seconds (a weak GPU): out of the warm-up, five frames to step down, five more to stop.
  assert.deepEqual(feed(createFrameGuard(), 2, 11), [[6, "downgrade"], [11, "stop"]]);
  // A healthy scene never hears anything; 25 fps steps down once and carries on at the lower quality.
  assert.deepEqual(feed(createFrameGuard(), 1 / 60, 2000), []);
  assert.deepEqual(feed(createFrameGuard(), 1 / 30, 2000), []);
  const at25 = feed(createFrameGuard(), 1 / 25, 2000);
  assert.deepEqual(at25.map(([, verdict]) => verdict), ["downgrade"], "1/25 s is past the step-down line but not the stop line");
  assert.ok(1 / 25 > SLOW_FRAME.downgrade && 1 / 25 < SLOW_FRAME.stop);
});

test("the guard leaves out hidden frames and the warm-up, and a stray long frame decides nothing", () => {
  const hidden = createFrameGuard();
  assert.deepEqual(feed(hidden, 0.5, 100, false), [], "a background tab says nothing about the GPU");
  assert.deepEqual(feed(hidden, 1 / 60, 100), [], "and its frames did not count towards anything");
  for (const seconds of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(createFrameGuard().frame(seconds, true), "keep", String(seconds));
  // The first uploads and compiles: slow, but inside the warm-up.
  const warming = createFrameGuard();
  assert.deepEqual(feed(warming, 0.3, 3), []);
  assert.deepEqual(feed(warming, 1 / 60, 500), [], "a slow start alone does not stop a fast scene");
  // A fast scene with a long frame now and then (a garbage collection, a resize): the median holds.
  const stray = createFrameGuard();
  const said: FrameVerdict[] = [];
  for (let index = 0; index < 1000; index += 1) said.push(stray.frame(index % 9 === 0 ? 0.6 : 1 / 60, true));
  assert.ok(said.every((verdict) => verdict === "keep"), "stray long frames never step it down");
  // Paused and started again: the frames before are dropped, the step down is kept.
  const resumed = createFrameGuard();
  assert.deepEqual(feed(resumed, 0.1, 40).map(([, verdict]) => verdict), ["downgrade"], "stepped down");
  resumed.restart();
  assert.deepEqual(feed(resumed, 1 / 60, 500), [], "fast after a restart: carries on");
  const again = feed(resumed, 0.1, 40).map(([, verdict]) => verdict);
  assert.equal(again[0], "stop", `slow again: no second step down, it stops (${again.join(", ")})`);
  assert.ok(!again.includes("downgrade"));
});

test("the scene feeds the guard each frame's real length, not the animation's capped step", () => {
  const scene = source("src/components/auth/scene/login-scene.ts");
  assert.doesNotMatch(scene, /0\.095/, "no frame is left out for being slow");
  assert.match(scene, /const elapsed = last \? \(now - last\) \/ 1000 : 0;\s*const dt = Math\.min\(0\.1, elapsed\);/);
  assert.match(scene, /guard\(elapsed\);/);
  assert.match(scene, /frames\.frame\(seconds, document\.visibilityState === "visible"\)/);
  assert.match(scene, /if \(verdict === "downgrade"\) \{[\s\S]*?downgradeQuality\(quality\)[\s\S]*?\} else if \(verdict === "stop"\) \{\s*fail\("frame rate"\);/);
  assert.match(scene, /last = 0;\s*frames\.restart\(\);/, "starting the loop again drops the frames before");
});
