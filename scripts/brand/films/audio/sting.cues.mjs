/**
 * The returning-reveal sting (BRIEF-2 3.4; owner-approved file #6, "Returning sign-in logo reveal"):
 * `ReturningLogin.tsx` plays it once at the reveal's start when the member's sound preference is on.
 * The impact trimmed to 1.2 s from just before its hit (so the hit lands 30 ms after `play()`), a 150 ms fade-out,
 * at −20 LUFS (quieter than the films, which sit at −16), true peak at most −1 dBTP, AAC at most 40 KB.
 */
import { source } from "./sources.mjs";

export const STING_DURATION = 1.2;
/** The hit lands this long after playback starts. */
export const STING_HIT_AT = 0.03;
export const STING_FADE_OUT = 0.15;

const r3 = (value) => Math.round(value * 1000) / 1000;

export function stingSheet() {
  const from = r3(source("impact").anchor.at - STING_HIT_AT);
  return {
    film: "sting",
    duration: STING_DURATION,
    lufs: -20,
    cues: [
      {
        id: "impact",
        source: "impact",
        at: STING_HIT_AT,
        from,
        to: r3(from + STING_DURATION),
        fadeIn: 0.005,
        fadeOut: STING_FADE_OUT,
        gainDb: 0,
        note: "The impact's hit and the first second of its body.",
      },
    ],
  };
}

export const STING_SHEET = stingSheet();
