import type { FilmId } from "./compositions";
import { FILM_DURATION, STAGE_START } from "../intro/timeline";
import { WELCOME_DURATION, WELCOME_STAGE, WELCOME_STAGE_START } from "../intro/films/welcome/timeline";

/** Each film's stage table, as the player drives its overlay from the video clock. */
export type FilmTiming = { stageStart: readonly number[]; duration: number; revealStage: number };

export const FILM_TIMING: Record<FilmId, FilmTiming> = {
  intro: { stageStart: STAGE_START, duration: FILM_DURATION, revealStage: STAGE_START.length - 1 },
  // The reveal (LogoReveal "film-end") locks over the igniting lines from the last stage, 9.29 s.
  welcome: { stageStart: WELCOME_STAGE_START, duration: WELCOME_DURATION, revealStage: WELCOME_STAGE.ignite },
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
