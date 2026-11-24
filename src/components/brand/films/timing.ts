import type { FilmId } from "./compositions";
import { FILM_DURATION, STAGE_START } from "../intro/timeline";
import { WELCOME_CLEAR, WELCOME_DURATION, WELCOME_STAGE, WELCOME_STAGE_START } from "../intro/films/welcome/timeline";

/**
 * When a film hands its picture back to the page (film seconds), and how the scope matte's side bars follow it from the
 * stage dark to the page colour from then (FilmVideo's data-film-tail): over `ms`, on `ease` (a CSS timing function).
 */
export type FilmTail = { at: number; ms: number; ease: string };

/** Each film's stage table, as the player drives its overlay from the video clock, and its tail. */
export type FilmTiming = { stageStart: readonly number[]; duration: number; revealStage: number; tail: FilmTail };

const INTRO_BRAND_AT = STAGE_START[STAGE_START.length - 1];

export const FILM_TIMING: Record<FilmId, FilmTiming> = {
  // The intro's frame is already the page colour as its brand stage starts (the end card): the bars go with it.
  intro: {
    stageStart: STAGE_START,
    duration: FILM_DURATION,
    revealStage: STAGE_START.length - 1,
    tail: { at: INTRO_BRAND_AT, ms: 400, ease: "cubic-bezier(.22, .72, .2, 1)" },
  },
  // The reveal (LogoReveal "film-end") locks over the igniting lines from the last stage, 9.29 s, but the frame only
  // clears to the page from 9.75 s to 10.89 s (WELCOME_CLEAR, shots.ts igniteClear): the bars clear with it, as long
  // and on its curve (a smoothstep of a smoothstep, which this cubic-bezier follows within 2%).
  welcome: {
    stageStart: WELCOME_STAGE_START,
    duration: WELCOME_DURATION,
    revealStage: WELCOME_STAGE.ignite,
    tail: { at: WELCOME_CLEAR.start, ms: Math.round((WELCOME_CLEAR.end - WELCOME_CLEAR.start) * 1000), ease: "cubic-bezier(.61, 0, .39, 1)" },
  },
};

/** The stage a film is in at `time` (seconds of film time). */
export function filmStageAt(film: FilmId, time: number): number {
  const starts = FILM_TIMING[film].stageStart;
  let stage = 0;
  for (let index = 0; index < starts.length; index += 1) if (time >= starts[index]) stage = index;
  return stage;
}

/**
 * BRIEF-2 3.1: rotation swaps to the new composition's cut at the same time, except in the first 1 s and the last
 * 1.5 s (a swap there would show a stall where the film starts or ends).
 */
export const SWAP_HEAD_S = 1;
export const SWAP_TAIL_S = 1.5;

export function swapAllowed(time: number, duration: number): boolean {
  return Number.isFinite(time) && Number.isFinite(duration) && time >= SWAP_HEAD_S && time <= duration - SWAP_TAIL_S;
}

/**
 * A resize settles this long before the film follows it with a new composition: FilmVideo's cut swap, and the live
 * film's `data-fitx-film-cut` (CinematicIntro), which the letterbox and the callouts read.
 */
export const RESIZE_SETTLE_MS = 220;
