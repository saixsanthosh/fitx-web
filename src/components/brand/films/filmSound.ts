"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import type { FilmAudio } from "./manifest";

/**
 * A film's sound (BRIEF-2 3.4): a separate audio element beside the always-muted video, muted by default, started
 * from the "Sound" button. The pieces are plain so tests/brand/film-sound.test.ts can drive them without a browser:
 * `soundReducer` (what the control shows), `FilmSoundController` (the audio element: synchronous play in the gesture,
 * drift correction, holds, the fade) and `useFilmSound` (the React glue).
 */

/** localStorage: "on" or "off", the member's last choice (read and written inside try/catch). */
export const SOUND_PREF_KEY = "fitx-film-sound";

/** Drift between sound and picture: nudge the rate by 3% above 30 ms, re-seek above 150 ms. */
export const SOUND_NUDGE_S = 0.03;
export const SOUND_RESEEK_S = 0.15;
export const SOUND_NUDGE_RATE = 0.03;
export const SOUND_FADE_MS = 200;
const SYNC_MS = 250;

export type SoundState = { on: boolean; needsTap: boolean };

export type SoundAction =
  /** Play was asked for (a tap, or a stored "on" being tried). */
  | { type: "request" }
  /** The audio element is playing. */
  | { type: "playing" }
  /** The browser refused to play without a gesture (NotAllowedError): show "Tap for sound". */
  | { type: "rejected" }
  /** Sound off (a tap, or the file could not play). */
  | { type: "off" };

export const SOUND_START: SoundState = { on: false, needsTap: false };

export function soundReducer(state: SoundState, action: SoundAction): SoundState {
  switch (action.type) {
    case "request":
    case "playing":
      return state.on && !state.needsTap ? state : { on: true, needsTap: false };
    case "rejected":
      return { on: false, needsTap: true };
    case "off":
      return state.on || state.needsTap ? SOUND_START : state;
    default:
      return state;
  }
}

type PrefStorage = Pick<Storage, "getItem" | "setItem">;

export function readSoundPref(storage: PrefStorage | null): "on" | "off" | null {
  try {
    const value = storage?.getItem(SOUND_PREF_KEY) ?? null;
    return value === "on" || value === "off" ? value : null;
  } catch {
    return null;
  }
}

export function writeSoundPref(storage: PrefStorage | null, on: boolean) {
  try {
    storage?.setItem(SOUND_PREF_KEY, on ? "on" : "off");
  } catch {
    // Storage blocked: the choice lasts for this film only.
  }
}

/** The parts of an HTMLAudioElement the controller uses. */
export type SoundElement = {
  currentTime: number;
  playbackRate: number;
  volume: number;
  readonly paused: boolean;
  play(): Promise<void>;
  pause(): void;
};

export type SoundClock = { readonly currentTime: number; readonly paused: boolean };

export function isNotAllowed(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "NotAllowedError";
}

type ControllerOptions = {
  src: string;
  /** Makes the audio element (`new Audio(src)` with `preload = "auto"` in the browser). Called once. */
  createAudio: (src: string) => SoundElement;
  /** The film's video clock (null before it mounts). */
  clock: () => SoundClock | null;
  dispatch: (action: SoundAction) => void;
  storage: PrefStorage | null;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
};

/**
 * The audio element of one film. Never awaits before `play()`: in a tap, `start()` creates (once) the element, sets
 * its time to the video's and calls `play()` in the same task, so the browser still sees the user's gesture (Safari
 * is the strictest about this).
 */
export class FilmSoundController {
  audio: SoundElement | null = null;
  wanted = false;
  private options: ControllerOptions;
  private fade: unknown = null;

  constructor(options: ControllerOptions) {
    this.options = options;
  }

  private element(): SoundElement {
    if (!this.audio) this.audio = this.options.createAudio(this.options.src);
    return this.audio;
  }

  /** Plays from the video's time, synchronously (call it straight from a click). */
  start(remember: boolean): Promise<void> {
    const audio = this.element();
    const clock = this.options.clock();
    if (clock) audio.currentTime = clock.currentTime;
    audio.volume = 1;
    audio.playbackRate = 1;
    const playing = audio.play();
    this.wanted = true;
    this.options.dispatch({ type: "request" });
    if (remember) writeSoundPref(this.options.storage, true);
    return Promise.resolve(playing).then(
      () => this.options.dispatch({ type: "playing" }),
      (error: unknown) => {
        this.wanted = false;
        this.options.dispatch(isNotAllowed(error) ? { type: "rejected" } : { type: "off" });
      },
    );
  }

  stop(remember: boolean) {
    this.wanted = false;
    this.audio?.pause();
    this.options.dispatch({ type: "off" });
    if (remember) writeSoundPref(this.options.storage, false);
  }

  /** The "Sound" button. */
  toggle(): Promise<void> | void {
    if (this.wanted) {
      this.stop(true);
      return;
    }
    return this.start(true);
  }

  /** A film started: a stored "on" is tried, never assumed (a refusal shows "Tap for sound"). */
  tryStored(): Promise<void> | void {
    if (this.wanted || readSoundPref(this.options.storage) !== "on") return;
    return this.start(false);
  }

  /** The picture holds (buffering, a hidden tab): the sound waits with it. */
  hold() {
    if (this.audio && !this.audio.paused) this.audio.pause();
  }

  /** The picture runs again: the sound follows if it is on. */
  resume() {
    if (!this.wanted || !this.audio || !this.audio.paused) return;
    const clock = this.options.clock();
    if (clock) this.audio.currentTime = clock.currentTime;
    void this.audio.play().catch(() => undefined);
  }

  /** Keeps the sound on the picture: a ±3% rate nudge for drift over 30 ms, a re-seek only past 150 ms. */
  sync() {
    const audio = this.audio;
    const clock = this.options.clock();
    if (!this.wanted || !audio || !clock || audio.paused || clock.paused) return;
    const drift = audio.currentTime - clock.currentTime;
    if (Math.abs(drift) > SOUND_RESEEK_S) {
      audio.currentTime = clock.currentTime;
      audio.playbackRate = 1;
    } else if (Math.abs(drift) > SOUND_NUDGE_S) {
      audio.playbackRate = drift > 0 ? 1 - SOUND_NUDGE_RATE : 1 + SOUND_NUDGE_RATE;
    } else if (audio.playbackRate !== 1) {
      audio.playbackRate = 1;
    }
  }

  /** The film is finishing: the sound fades out over 200 ms, then stops (iOS ignores volume and just stops). */
  fadeOut(ms = SOUND_FADE_MS) {
    const audio = this.audio;
    if (!audio || audio.paused || this.fade !== null) return;
    const setTimer = this.options.setTimer ?? ((fn: () => void, wait: number) => setTimeout(fn, wait));
    const steps = 8;
    let step = 0;
    const next = () => {
      step += 1;
      try {
        audio.volume = Math.max(0, 1 - step / steps);
      } catch {
        // Read-only volume (iOS).
      }
      if (step >= steps) {
        audio.pause();
        this.fade = null;
        return;
      }
      this.fade = setTimer(next, ms / steps);
    };
    this.fade = setTimer(next, ms / steps);
  }

  dispose() {
    if (this.fade !== null) (this.options.clearTimer ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>)))(this.fade);
    this.fade = null;
    this.wanted = false;
    if (this.audio) {
      this.audio.pause();
      this.audio = null;
    }
  }
}

function localStore(): PrefStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function makeAudio(src: string): SoundElement {
  const audio = new Audio(src);
  audio.preload = "auto";
  return audio;
}

export type FilmSound = { available: boolean; on: boolean; needsTap: boolean; toggle(): void };

/**
 * The sound of the film playing in `video`. `available` is false (and the control renders nothing) when the film has
 * no sound. A stored "on" is tried when the film starts; `held` and `ending` pause and fade it.
 */
export function useFilmSound(video: HTMLVideoElement | null, audio: FilmAudio | null, opts: { held: boolean; ending: boolean }): FilmSound {
  const [state, dispatch] = useReducer(soundReducer, SOUND_START);
  const controller = useRef<FilmSoundController | null>(null);
  const videoRef = useRef(video);
  const src = audio?.src ?? null;

  useEffect(() => {
    videoRef.current = video;
  }, [video]);

  useEffect(() => {
    if (!src) return;
    const made = new FilmSoundController({ src, createAudio: makeAudio, clock: () => videoRef.current, dispatch, storage: localStore() });
    controller.current = made;
    return () => {
      made.dispose();
      if (controller.current === made) controller.current = null;
      dispatch({ type: "off" });
    };
  }, [src]);

  // The film's own clock: the sound tries a stored "on" when it starts, waits while it buffers, follows it.
  useEffect(() => {
    if (!video || !src) return;
    let tried = false;
    const onPlaying = () => {
      const sound = controller.current;
      if (!sound) return;
      if (!tried) {
        tried = true;
        void sound.tryStored();
      } else {
        sound.resume();
      }
    };
    const onWaiting = () => controller.current?.hold();
    const onVisibility = () => {
      if (document.hidden) controller.current?.hold();
    };
    const timer = window.setInterval(() => controller.current?.sync(), SYNC_MS);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("pause", onWaiting);
    document.addEventListener("visibilitychange", onVisibility);
    if (!video.paused) onPlaying();
    return () => {
      window.clearInterval(timer);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("pause", onWaiting);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [video, src]);

  useEffect(() => {
    if (opts.held) controller.current?.hold();
    else controller.current?.resume();
  }, [opts.held]);

  useEffect(() => {
    if (opts.ending) controller.current?.fadeOut();
  }, [opts.ending]);

  // Straight from the click: no await before play() (FilmSoundController.start).
  const toggle = useCallback(() => {
    void controller.current?.toggle();
  }, []);

  return { available: src !== null, on: state.on, needsTap: state.needsTap, toggle };
}
