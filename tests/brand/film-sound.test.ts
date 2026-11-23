import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FilmSoundController,
  readSoundPref,
  SOUND_PREF_KEY,
  SOUND_START,
  soundReducer,
  type SoundAction,
  type SoundElement,
} from "@/components/brand/films/filmSound";
import { playReturnSting } from "@/components/brand/films/sting";
import type { FilmAudio } from "@/components/brand/films/manifest";

/** A localStorage stand-in. */
function store(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

/** An audio element whose play() resolves, or rejects with `rejectWith`; it records what happened, in order. */
function fakeAudio(rejectWith: string | null = null) {
  const log: string[] = [];
  const element = {
    currentTime: 0,
    playbackRate: 1,
    volume: 1,
    paused: true,
    play() {
      log.push(`play@${element.currentTime}`);
      if (rejectWith) {
        const error = Object.assign(new Error("refused"), { name: rejectWith });
        return Promise.reject(error);
      }
      element.paused = false;
      return Promise.resolve();
    },
    pause() {
      log.push("pause");
      element.paused = true;
    },
  };
  return { element: element as SoundElement & { paused: boolean }, log };
}

function controller({ rejectWith = null as string | null, pref = null as string | null, time = 3.25 } = {}) {
  const audio = fakeAudio(rejectWith);
  const actions: SoundAction[] = [];
  const storage = store(pref ? { [SOUND_PREF_KEY]: pref } : {});
  const clock = { currentTime: time, paused: false };
  let made = 0;
  const timers: Array<() => void> = [];
  const sound = new FilmSoundController({
    src: "/brand/films/intro/abcd1234/sound.m4a",
    createAudio: (src) => {
      made += 1;
      audio.log.push(`create ${src}`);
      return audio.element;
    },
    clock: () => clock,
    dispatch: (action) => void actions.push(action),
    storage,
    setTimer: (fn) => timers.push(fn),
    clearTimer: () => undefined,
  });
  return { sound, audio, actions, storage, clock, made: () => made, timers };
}

test("the reducer: muted to start; a request turns it on; a refusal shows the hint; off clears both", () => {
  assert.deepEqual(SOUND_START, { on: false, needsTap: false });
  const on = soundReducer(SOUND_START, { type: "request" });
  assert.deepEqual(on, { on: true, needsTap: false });
  assert.equal(soundReducer(on, { type: "playing" }), on, "no change, same object");
  const refused = soundReducer(on, { type: "rejected" });
  assert.deepEqual(refused, { on: false, needsTap: true });
  assert.deepEqual(soundReducer(refused, { type: "request" }), { on: true, needsTap: false }, "a tap clears the hint");
  assert.deepEqual(soundReducer(refused, { type: "off" }), SOUND_START);
  assert.equal(soundReducer(SOUND_START, { type: "off" }), SOUND_START);
});

test("a tap creates the audio element once, at the video's time, and plays it in the same task", async () => {
  const { sound, audio, actions, storage, made } = controller({ time: 3.25 });
  const pending = sound.toggle();
  // Synchronously, before any await: created, seeked to the picture and asked to play.
  assert.deepEqual(audio.log, ["create /brand/films/intro/abcd1234/sound.m4a", "play@3.25"]);
  assert.deepEqual(actions, [{ type: "request" }]);
  assert.equal(storage.map.get(SOUND_PREF_KEY), "on", "the choice is remembered");
  await pending;
  assert.deepEqual(actions.at(-1), { type: "playing" });
  sound.toggle();
  assert.equal(audio.log.at(-1), "pause");
  assert.equal(storage.map.get(SOUND_PREF_KEY), "off");
  await sound.toggle();
  assert.equal(made(), 1, "one element, reused");
});

test("no await comes before play() in the click path", () => {
  const start = FilmSoundController.prototype.start.toString();
  const toggle = FilmSoundController.prototype.toggle.toString();
  const beforePlay = start.slice(0, start.indexOf(".play("));
  assert.ok(start.includes(".play("), "start() calls play()");
  assert.equal(/\bawait\b/.test(beforePlay), false, "start() awaits nothing before play()");
  assert.equal(/\basync\b/.test(start.slice(0, 20)) || /\bawait\b/.test(toggle), false, "toggle() and start() are not async");
  const hook = readFileSync("src/components/brand/films/filmSound.ts", "utf8");
  const click = hook.slice(hook.indexOf("const toggle = useCallback"), hook.indexOf("}, []);", hook.indexOf("const toggle = useCallback")));
  assert.equal(/\bawait\b/.test(click), false, "the hook's click handler calls toggle() straight away");
  const control = readFileSync("src/components/brand/films/SoundControl.tsx", "utf8");
  assert.match(control, /onClick=\{sound\.toggle\}/);
});

test("a stored 'on' is tried when a film starts, never assumed: a refusal (NotAllowedError) asks for a tap", async () => {
  const refused = controller({ rejectWith: "NotAllowedError", pref: "on" });
  await refused.sound.tryStored();
  assert.deepEqual(refused.actions, [{ type: "request" }, { type: "rejected" }]);
  assert.equal(refused.sound.wanted, false);
  assert.equal(refused.storage.map.get(SOUND_PREF_KEY), "on", "the member's choice is kept for the tap");

  const other = controller({ rejectWith: "NotSupportedError", pref: "on" });
  await other.sound.tryStored();
  assert.deepEqual(other.actions.at(-1), { type: "off" }, "a file that cannot play turns sound off without a hint");

  for (const pref of [null, "off"]) {
    const quiet = controller({ pref });
    assert.equal(quiet.sound.tryStored(), undefined, `pref ${pref}: nothing`);
    assert.deepEqual(quiet.audio.log, [], "no element made");
  }

  const allowed = controller({ pref: "on" });
  await allowed.sound.tryStored();
  assert.deepEqual(allowed.actions, [{ type: "request" }, { type: "playing" }]);
});

test("sync: within 30 ms nothing, a 3% rate nudge up to 150 ms, a re-seek past it", async () => {
  const { sound, audio, clock } = controller({ time: 10 });
  await sound.toggle();
  audio.element.currentTime = 10.02;
  sound.sync();
  assert.equal(audio.element.playbackRate, 1);
  audio.element.currentTime = 10.1;
  sound.sync();
  assert.equal(audio.element.playbackRate, 0.97, "ahead: slow down");
  audio.element.currentTime = 9.9;
  sound.sync();
  assert.equal(audio.element.playbackRate, 1.03, "behind: speed up");
  audio.element.currentTime = 10.4;
  sound.sync();
  assert.equal(audio.element.currentTime, 10, "re-seeked to the picture");
  assert.equal(audio.element.playbackRate, 1);
  clock.paused = true;
  audio.element.currentTime = 12;
  sound.sync();
  assert.equal(audio.element.currentTime, 12, "nothing while the picture is paused");
});

test("holds pause it, a resume follows the picture if it is on, and the end fades it out over 200 ms", async () => {
  const { sound, audio, clock, timers } = controller({ time: 4 });
  await sound.toggle();
  sound.hold();
  assert.equal(audio.element.paused, true);
  clock.currentTime = 5.5;
  sound.resume();
  assert.equal(audio.element.paused, false);
  assert.equal(audio.log.at(-1), "play@5.5");
  sound.fadeOut(200);
  while (timers.length) timers.shift()!();
  assert.equal(audio.element.volume, 0);
  assert.equal(audio.element.paused, true);
  const off = controller();
  off.sound.resume();
  assert.deepEqual(off.audio.log, [], "a sound never turned on stays off");
});

test("the stored choice reads only 'on' and 'off', and blocked storage reads as no choice", () => {
  assert.equal(readSoundPref(store({ [SOUND_PREF_KEY]: "on" })), "on");
  assert.equal(readSoundPref(store({ [SOUND_PREF_KEY]: "yes" })), null);
  assert.equal(readSoundPref({ getItem: () => { throw new Error("blocked"); }, setItem: () => undefined }), null);
  assert.equal(readSoundPref(null), null);
});

const STING: FilmAudio = { src: "/brand/films/return/abcd1234/sting.m4a", bytes: 30_000, sha256: "0".repeat(64), lufs: -20, duration: 1.2 };

test("the returning-reveal sting: plays once only with sound on, a sting and motion; a refusal stays silent", async () => {
  const played: string[] = [];
  const createAudio = (src: string) => ({ play: () => { played.push(src); return Promise.resolve(); } });
  // 1. Sound on, a sting, motion: it plays, once.
  assert.equal(playReturnSting({ sting: STING, storage: store({ [SOUND_PREF_KEY]: "on" }), reduced: false, createAudio }), true);
  assert.deepEqual(played, [STING.src]);
  // 2. Sound not turned on (off, or never chosen): silent.
  for (const pref of ["off", null]) {
    assert.equal(playReturnSting({ sting: STING, storage: store(pref ? { [SOUND_PREF_KEY]: pref } : {}), reduced: false, createAudio }), false);
  }
  // 3. No sting yet (RETURN_STING is null until S6): silent.
  assert.equal(playReturnSting({ sting: null, storage: store({ [SOUND_PREF_KEY]: "on" }), reduced: false, createAudio }), false);
  // 4. Reduced motion: silent.
  assert.equal(playReturnSting({ sting: STING, storage: store({ [SOUND_PREF_KEY]: "on" }), reduced: true, createAudio }), false);
  assert.equal(played.length, 1);
  // A refused play() is swallowed: no hint, no error.
  let caught = false;
  const refuse = () => ({ play: () => Promise.reject(Object.assign(new Error("refused"), { name: "NotAllowedError" })) });
  process.once("unhandledRejection", () => { caught = true; });
  assert.equal(playReturnSting({ sting: STING, storage: store({ [SOUND_PREF_KEY]: "on" }), reduced: false, createAudio: refuse }), true);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(caught, false, "the refusal never surfaces");
  const login = readFileSync("src/components/brand/logo/ReturningLogin.tsx", "utf8");
  assert.match(login, /playReturnSting\(\{/);
  assert.match(login, /prefers-reduced-motion: reduce/);
});
