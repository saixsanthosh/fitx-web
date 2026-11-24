/**
 * The intro film's cue sheet (BRIEF-2 3.4). Every time comes from the intro timeline (`STAGE_START`, `SHOTS`,
 * `FILM_DURATION`) or from the logo reveal's own CSS timing, so a timing change moves the sound with it.
 *
 * - riser #1, offset so its measured boom lands on `STAGE_START[6]` (10.6 s, the brand stage and the film-end reveal);
 * - whoosh #2 on the chapter cuts 1.3, 3.5, 7.55 and 9.2 s (`STAGE_START[1, 2, 4, 5]`), its pass on the cut;
 * - plate #3 on `3a-plate`, its clang where the plate seats on the sleeve;
 * - impact #6, low-passed to a thud, on `3d-drop` where the bar meets the platform;
 * - #3 then #4 on the film-end plates: the reveal's plate 1 seating, then plate 3 locking on.
 *
 * `gainDb` is relative to the cue's levelled loudness (−23 LUFS); the whole mix then goes to −16 LUFS.
 * The two in-shot accents (`plateSeat`, `barDrop`) come from `INTRO_SOUND_ACCENTS` in `timeline.ts` (film seconds,
 * the frames where the shots' own motion seats the plate and lands the bar); the defaults below are only a fallback
 * for a timeline without that export.
 */
import * as timeline from "../../../../src/components/brand/intro/timeline.ts";
import { cubicBezier } from "./lib.mjs";
import { fitTo, source } from "./sources.mjs";

const { STAGE_START, SHOTS, FILM_DURATION } = timeline;

/** The brand stage: the riser's boom and the start of `LogoReveal variant="film-end"`. */
export const BOOM_AT = STAGE_START[6];

/**
 * The mark's plates in its formation (`src/app/globals.css`, `.fitx-mark__piece--plate-N`): delay and duration in ms,
 * eased with `cubic-bezier(.16, 1, .3, 1)` at the default tempo. `tests/brand/film-cues.test.ts` reads the CSS and
 * fails when these drift.
 */
export const REVEAL_PLATES = Object.freeze({
  easing: [0.16, 1, 0.3, 1],
  "plate-1": { atMs: 880, durationMs: 420 },
  "plate-2": { atMs: 960, durationMs: 420 },
  "plate-3": { atMs: 1040, durationMs: 400 },
});

/** A plate counts as seated when it has covered 95% of its travel. */
export const SEATED = 0.95;

/** Seconds after the reveal starts at which a plate seats. */
export function plateSeat(plate) {
  const { atMs, durationMs } = REVEAL_PLATES[plate];
  return (atMs + cubicBezier(...REVEAL_PLATES.easing).timeFor(SEATED) * durationMs) / 1000;
}

export function shot(id) {
  const found = SHOTS.find((entry) => entry.id === id);
  if (!found) throw new Error(`No intro shot ${id}`);
  return found;
}

const DEFAULT_ACCENTS = Object.freeze({
  /** `3a-plate` (5.1 to 5.5 s): the plate spins on and seats just before the hard cut on the clamp. */
  plateSeat: shot("3a-plate").start + 0.28,
  /** `3d-drop` (7.25 to 7.55 s): the bar meets the platform. */
  barDrop: shot("3d-drop").start + 0.05,
});

export const INTRO_ACCENTS = Object.freeze({ ...DEFAULT_ACCENTS, ...(timeline.INTRO_SOUND_ACCENTS ?? {}) });

const r3 = (value) => Math.round(value * 1000) / 1000;

/** The sheet for a film of `duration` seconds (the timeline's, unless a preview asks for another tail). */
export function introSheet(duration = FILM_DURATION) {
  const boom = source("riser").anchor.at;
  const riserFrom = r3(boom - BOOM_AT);
  const whoosh = (stage) => ({
    id: `whoosh-${stage}`,
    source: "whoosh",
    at: STAGE_START[stage],
    to: 2.6,
    fadeOut: 0.3,
    gainDb: -5,
    note: `Chapter cut at ${STAGE_START[stage]} s (STAGE_START[${stage}]): the whoosh's pass on the cut.`,
  });
  const plateOne = r3(BOOM_AT + plateSeat("plate-1"));
  const plateThree = r3(BOOM_AT + plateSeat("plate-3"));
  /** Cut a cue that would run past the film at the film's end, with a fade of up to 0.3 s (40% of what is left). */
  const endFade = (sourceId, at, wanted) => {
    const to = fitTo(sourceId, at, duration, wanted);
    return { to, fadeOut: r3(Math.min(0.3, to * 0.4)) };
  };
  return {
    film: "intro",
    duration,
    lufs: -16,
    cues: [
      {
        id: "riser",
        source: "riser",
        at: BOOM_AT,
        from: riserFrom,
        to: r3(riserFrom + duration),
        fadeIn: 0.6,
        fadeOut: 0.9,
        gainDb: 0,
        note: `The bed: the riser from ${riserFrom} s in its file, so its boom (${boom} s) lands at ${BOOM_AT} s; the boom's tail fades out under the held logo.`,
      },
      whoosh(1),
      whoosh(2),
      whoosh(4),
      whoosh(5),
      {
        id: "plate-3a",
        source: "plate-slide",
        at: r3(INTRO_ACCENTS.plateSeat),
        fadeOut: 0.3,
        gainDb: -6,
        note: "3a-plate: the clang where the plate seats on the sleeve, before the cut on the clamp.",
      },
      {
        id: "drop-3d",
        source: "impact",
        at: r3(INTRO_ACCENTS.barDrop),
        from: 0.06,
        to: 1.2,
        lowpass: 700,
        fadeOut: 0.5,
        gainDb: -4,
        note: "3d-drop: the bar meets the platform; the impact low-passed to a thud under the dust burst.",
      },
      {
        id: "end-plates",
        source: "plate-slide",
        at: plateOne,
        ...endFade("plate-slide", plateOne, 1.5),
        gainDb: -8,
        note: `Film-end reveal: plate 1 seats ${r3(plateSeat("plate-1"))} s after the reveal starts.`,
      },
      {
        id: "end-lock",
        source: "plate-lock",
        at: plateThree,
        ...endFade("plate-lock", plateThree, 1.0),
        gainDb: -6,
        note: `Film-end reveal: plate 3 locks on ${r3(plateSeat("plate-3"))} s after the reveal starts.`,
      },
    ],
  };
}

export const INTRO_SHEET = introSheet();
