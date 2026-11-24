// The hero reel's start-up: the still first, the reel only after the page's load event and an idle moment, the
// phone cut on phones, and the reel starting on the still's own frame.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { POSTER_SECONDS, REEL_IDLE_TIMEOUT_MS, REEL_SECONDS, afterLoadAndIdle, chapterAt, chapterProgress, posterSource, reelSource, shapeFor, type ReelWindow } from "@/components/landing/film";
import { JOBS } from "../../scripts/brand/films/lib/plan.mjs";

const ROOT = new URL("../../", import.meta.url);

/** A window whose load event, idle callbacks and timers run only when the test says so. */
function fakeWindow({ loaded = false, idle = true } = {}) {
  const state = { readyState: loaded ? "complete" : "loading", load: [] as Array<() => void>, idle: new Map<number, () => void>(), timers: new Map<number, () => void>(), idleTimeouts: [] as number[], next: 1 };
  const win: ReelWindow = {
    document: { get readyState() { return state.readyState; } },
    addEventListener: (_type, listener) => void state.load.push(listener),
    removeEventListener: (_type, listener) => { state.load = state.load.filter((item) => item !== listener); },
    setTimeout: (handler) => { const id = state.next++; state.timers.set(id, handler); return id; },
    clearTimeout: (id) => void state.timers.delete(id),
    ...(idle ? {
      requestIdleCallback: (callback: () => void, options?: { timeout: number }) => { const id = state.next++; state.idle.set(id, callback); state.idleTimeouts.push(options?.timeout ?? -1); return id; },
      cancelIdleCallback: (id: number) => void state.idle.delete(id),
    } : {}),
  };
  const fire = {
    load() { state.readyState = "complete"; for (const listener of state.load.splice(0)) listener(); },
    idle() { for (const [id, callback] of [...state.idle]) { state.idle.delete(id); callback(); } },
    timers() { for (const [id, handler] of [...state.timers]) { state.timers.delete(id); handler(); } },
  };
  return { win, state, fire };
}

test("the reel waits for the load event and then an idle moment, never before", () => {
  const { win, state, fire } = fakeWindow();
  let started = 0;
  afterLoadAndIdle(win, () => { started += 1; });
  fire.idle();
  assert.equal(started, 0, "nothing before the page has loaded");
  fire.load();
  assert.equal(started, 0, "nothing in the load event itself");
  assert.deepEqual(state.idleTimeouts, [REEL_IDLE_TIMEOUT_MS], "an idle callback, with a ceiling");
  fire.idle();
  assert.equal(started, 1);
  fire.idle();
  fire.load();
  assert.equal(started, 1, "once only");
});

test("a page that has already loaded starts at the next idle moment; without requestIdleCallback a short timer stands in", () => {
  const loaded = fakeWindow({ loaded: true });
  let started = 0;
  afterLoadAndIdle(loaded.win, () => { started += 1; });
  assert.equal(started, 0, "never synchronously");
  loaded.fire.idle();
  assert.equal(started, 1);
  const safari = fakeWindow({ idle: false });
  let safariStarted = 0;
  afterLoadAndIdle(safari.win, () => { safariStarted += 1; });
  safari.fire.timers();
  assert.equal(safariStarted, 0, "the timer is set only after load");
  safari.fire.load();
  safari.fire.timers();
  assert.equal(safariStarted, 1);
});

test("cancelling (the hero unmounts, reduced motion turns on) means the reel never starts", () => {
  for (const at of ["before load", "after load"] as const) {
    const { win, state, fire } = fakeWindow();
    let started = 0;
    const cancel = afterLoadAndIdle(win, () => { started += 1; });
    if (at === "after load") fire.load();
    cancel();
    fire.load();
    fire.idle();
    fire.timers();
    assert.equal(started, 0, at);
    assert.equal(state.load.length, 0, "the load listener is removed");
  }
});

test("phones get the 30 fps phone cut (540 × 960), wider screens the landscape one; the still matches the cut", () => {
  assert.equal(shapeFor(390, 844), "portrait");
  assert.equal(shapeFor(412, 915), "portrait");
  assert.equal(shapeFor(820, 1180), "portrait", "a tablet held upright too");
  assert.equal(shapeFor(1440, 900), "landscape");
  assert.equal(reelSource("dark", "portrait"), "/media/landing-film/reel-dark-portrait.mp4");
  assert.equal(posterSource("light", "landscape"), "/media/landing-film/poster-light-landscape.webp");
  for (const theme of ["light", "dark"] as const) {
    const phone = new URL(`public${reelSource(theme, "portrait")}`, ROOT);
    const wide = new URL(`public${reelSource(theme, "landscape")}`, ROOT);
    assert.ok(statSync(phone).size < statSync(wide).size, `${theme}: the phone cut is the smaller file`);
    assert.ok(statSync(new URL(`public${posterSource(theme, "portrait")}`, ROOT)).size < 50 * 1024, "the still is small");
  }
  // A file path, not URL.pathname: the checkout's path can hold a space ("all files"), which .pathname keeps as %20.
  const probe = (file: string) => {
    try {
      return execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate", "-of", "csv=p=0", fileURLToPath(new URL(`public${file}`, ROOT))], { encoding: "utf8" }).trim();
    } catch (error) {
      // ffprobe is not on every machine; the sizes above still hold. Any other failure (a missing file) fails the test.
      if ((error as { code?: string }).code === "ENOENT") return null;
      throw error;
    }
  };
  for (const theme of ["light", "dark"] as const) {
    for (const [shape, expected] of [["portrait", "540,960,30/1"], ["landscape", "1280,720,30/1"]] as const) {
      const facts = probe(reelSource(theme, shape));
      if (facts !== null) assert.equal(facts, expected, `${theme} ${shape}`);
    }
  }
});

test("the reel starts on the still's own frame, so the fade from the still never jumps the sprint back", () => {
  // The posters are the reel's frame at the film lab's still time (the reel starts at its `from`, film time 1.3 s).
  const reel = JOBS["landing-reel"];
  for (const id of ["poster-landscape", "poster-portrait"] as const) {
    assert.ok(Math.abs(reel.stills[id].time - reel.from - POSTER_SECONDS) < 1e-9, `${id}: film ${reel.stills[id].time} s is reel ${POSTER_SECONDS} s`);
  }
  assert.ok(POSTER_SECONDS > 0 && POSTER_SECONDS < REEL_SECONDS);
  assert.equal(chapterAt(POSTER_SECONDS), 0, "the rail opens in Run");
  assert.ok(Math.abs(chapterProgress(0, POSTER_SECONDS) - 0.75 / 2.2) < 1e-9, "a third of the way through it, where the film is");
  // The hero's first source seeks there on loadedmetadata (before the first frame is painted); a chapter chosen
  // before the reel has loaded replaces it, and a theme or shape swap keeps the place the film has reached.
  const hero = readFileSync(new URL("src/components/landing/FilmHero.tsx", ROOT), "utf8");
  assert.match(hero, /const startAt = useRef\(POSTER_SECONDS\);/);
  assert.match(hero, /const at = element\.currentTime \|\| startAt\.current;/);
  assert.match(hero, /if \(at\) element\.currentTime = at;/);
  assert.match(hero, /element\.addEventListener\("loadedmetadata", resume, \{ once: true \}\);/);
  assert.match(hero, /startAt\.current = CHAPTERS\[index\]\.start \+ 0\.01;/);
});

test("the hero mounts its video only once the gate opened, so the first screen never fetches the reel", () => {
  const hero = readFileSync(new URL("src/components/landing/FilmHero.tsx", ROOT), "utf8");
  assert.match(hero, /return afterLoadAndIdle\(window, \(\) => setSettled\(true\)\);/);
  assert.match(hero, /const source = settled && theme && allowed \? reelSource\(theme, shape\) : null;/);
  assert.match(hero, /\{source && \(\s*<video/);
  assert.match(hero, /data-film=\{filmState\}/);
});
