/**
 * The welcome film's cue sheet (BRIEF-2 3.4): score #5 at full length from 0 s (score time is film time, so the
 * stage starts in `timeline.ts`, snapped to the score's hits by C0, stay on them), plus the plate sounds on the three
 * loading shots.
 *
 * Plates: each loading shot ends on its plate seating, which is the cut to the next shot (`WELCOME_STAGE_START[2]`,
 * `[3]`, `[4]`: 3.6, 4.88 and 6.91 s). C0 found no distinct score accent at 4.88 and 6.91 s, so the plates make it.
 * - plates 1 (Maya) and 2 (Leo): #3, the plate sliding on and meeting the collar;
 * - plate 3 (Dre's big plate, in slow motion): #3 slides it on and #4 locks it, the lock on the cut.
 * When film-welcome's `timeline.ts` exports `WELCOME_PLATE_SEATS` (three film times), those win.
 */
import * as timeline from "../../../../src/components/brand/intro/films/welcome/timeline.ts";
import { fitTo } from "./sources.mjs";

const { WELCOME_DURATION, WELCOME_STAGE_START } = timeline;

const DEFAULT_SEATS = Object.freeze([WELCOME_STAGE_START[2], WELCOME_STAGE_START[3], WELCOME_STAGE_START[4]]);

/** Film seconds at which plates 1, 2 and 3 seat. */
export const WELCOME_SEATS = Object.freeze([...(timeline.WELCOME_PLATE_SEATS ?? DEFAULT_SEATS)]);

/** Dre's plate slides on this long before it locks. */
export const BIG_PLATE_SLIDE_LEAD = 0.15;

const r3 = (value) => Math.round(value * 1000) / 1000;

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
      { id: "plate-1", source: "plate-slide", at: r3(one), fadeOut: 0.3, gainDb: -5, note: `Maya's plate seats at ${one} s, on the cut to Leo.` },
      { id: "plate-2", source: "plate-slide", at: r3(two), fadeOut: 0.3, gainDb: -5, note: `Leo's plate seats at ${two} s, on the cut to Dre.` },
      {
        id: "plate-3-slide",
        source: "plate-slide",
        at: r3(three - BIG_PLATE_SLIDE_LEAD),
        to: 0.6,
        fadeOut: 0.2,
        gainDb: -8,
        note: "Dre's big plate slides on, just before it locks.",
      },
      { id: "plate-3-lock", source: "plate-lock", at: r3(three), fadeOut: 0.3, gainDb: -5, note: `Dre's big plate locks at ${three} s, on the cut to the crane.` },
    ],
  };
}

export const WELCOME_SHEET = welcomeSheet();
