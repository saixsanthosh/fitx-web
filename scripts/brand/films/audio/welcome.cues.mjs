/**
 * The welcome film's cue sheet (BRIEF-2 3.4): score #5 at full length from 0 s (score time is film time, so the
 * stage starts in `timeline.ts`, snapped to the score's hits by C0, stay on them), plus the plate sounds where the
 * loading shots seat each plate on the stack, `WELCOME_BEATS.plateSeat` in the welcome `timeline.ts` (imported, never
 * copied; every beat is a measured hit of the score, and the shots' own motion seats the plates on them, which
 * tests/brand/film-cues.test.ts measures again from the plates' travel):
 * - plates 1 (Maya) and 2 (Leo): #3, the plate sliding on, its clang where the plate meets the stack;
 * - plate 3 (Dre's, the last, in slow motion): #3's slide alone, cut just before its own clang, runs into the seat,
 *   where #4's lock-on clank lands, so the two clangs never double.
 * Nothing is cued on the `settle` beats: the picture has no event there (each plate's rebound is over within 0.05 s
 * of its clip's seat, 0.12 s of film time for Dre in slow motion, and the plate then stays still).
 */
import { WELCOME_BEATS, WELCOME_DURATION } from "../../../../src/components/brand/intro/films/welcome/timeline.ts";
import { fitTo, source } from "./sources.mjs";

/** Film seconds at which plates 1, 2 and 3 meet the stack (`WELCOME_BEATS.plateSeat`). */
export const WELCOME_SEATS = Object.freeze([...WELCOME_BEATS.plateSeat]);

const r3 = (value) => Math.round(value * 1000) / 1000;

/** Where Dre's slide (#3) is cut, in its file's seconds: 10 ms before its own clang (its anchor), so only #4 clanks. */
export const DRE_SLIDE_TO = r3(source("plate-slide").anchor.at - 0.01);

export function welcomeSheet(duration = WELCOME_DURATION) {
  const [one, two, three] = WELCOME_SEATS;
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
        to: DRE_SLIDE_TO,
        fadeOut: 0.03,
        gainDb: -8,
        note: `Dre's plate slides into the stack: #3 up to just before its clang, which would fall at ${three} s (plateSeat), where his lock sounds instead.`,
      },
      { id: "plate-3-lock", source: "plate-lock", at: r3(three), fadeOut: 0.3, gainDb: -5, note: `Dre's plate meets the stack and locks on at ${three} s (plateSeat).` },
    ],
  };
}

export const WELCOME_SHEET = welcomeSheet();
