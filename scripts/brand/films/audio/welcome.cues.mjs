/**
 * The welcome film's cue sheet (BRIEF-2 3.4): score #5 at full length from 0 s (score time is film time, so the
 * stage starts in `timeline.ts`, snapped to the score's hits by C0, stay on them), plus the plate sounds on the beats
 * the loading shots play, `WELCOME_BEATS` in the welcome `timeline.ts` (imported, never copied; every beat is a
 * measured hit of the score, and the shots seat the plates on them):
 * - plates 1 (Maya) and 2 (Leo): #3, the plate sliding on, its clang where the plate meets the stack (`plateSeat`);
 * - plate 3 (Dre's, in slow motion): #3 slides it on, its clang on his `plateSeat`, and #4 locks it on his after-tap
 *   (`settle`, the score's next hit), so the slide leads the lock by `settle - plateSeat`.
 * Plates 1 and 2 have no after-tap cue: their `settle` beats are not used.
 */
import { WELCOME_BEATS, WELCOME_DURATION } from "../../../../src/components/brand/intro/films/welcome/timeline.ts";
import { fitTo } from "./sources.mjs";

/** Film seconds at which plates 1, 2 and 3 meet the stack (`WELCOME_BEATS.plateSeat`). */
export const WELCOME_SEATS = Object.freeze([...WELCOME_BEATS.plateSeat]);

/** Film seconds of each plate's after-tap (`WELCOME_BEATS.settle`); only Dre's has a cue, his plate's lock. */
export const WELCOME_SETTLES = Object.freeze([...WELCOME_BEATS.settle]);

const r3 = (value) => Math.round(value * 1000) / 1000;

/** Dre's plate slides on (its clang on the seat) this long before it locks (on the after-tap). */
export const BIG_PLATE_SLIDE_LEAD = r3(WELCOME_SETTLES[2] - WELCOME_SEATS[2]);

export function welcomeSheet(duration = WELCOME_DURATION) {
  const [one, two, three] = WELCOME_SEATS;
  const lock = WELCOME_SETTLES[2];
  return {
    film: "welcome",
    duration,
    lufs: -16,
    cues: [
      {
        id: "score",
        source: "score",
        at: 0,
        to: fitTo("score", 0, duration),
        fadeOut: 0.25,
        gainDb: 0,
        note: "Score #5 from its first sample; its hits are the stage starts.",
      },
      { id: "plate-1", source: "plate-slide", at: r3(one), fadeOut: 0.3, gainDb: -5, note: `Maya's plate meets the stack at ${one} s (plateSeat, the cymbal crash).` },
      { id: "plate-2", source: "plate-slide", at: r3(two), fadeOut: 0.3, gainDb: -5, note: `Leo's plate meets the stack at ${two} s (plateSeat).` },
      {
        id: "plate-3-slide",
        source: "plate-slide",
        at: r3(three),
        to: 0.6,
        fadeOut: 0.2,
        gainDb: -8,
        note: `Dre's plate slides on and meets the stack at ${three} s (plateSeat), ${BIG_PLATE_SLIDE_LEAD} s before it locks.`,
      },
      { id: "plate-3-lock", source: "plate-lock", at: r3(lock), fadeOut: 0.3, gainDb: -5, note: `Dre's plate locks on its after-tap at ${lock} s (settle).` },
    ],
  };
}

export const WELCOME_SHEET = welcomeSheet();
