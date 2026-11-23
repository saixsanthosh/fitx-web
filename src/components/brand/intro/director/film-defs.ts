/**
 * The film registry (BRIEF-2 3.2). The lab (`/lab/film`), the framing test and `scripts/brand/films/render.mjs`
 * reach films only through `FILM_DEFS`: each entry loads its film's definition on demand, so a page that plays one
 * film never downloads the other.
 *
 * The helpers below are pure (no three.js, no DOM), so the director, the lab and node tests share them.
 *
 * Owned by film-lab.
 */

import type { FilmComposition, FilmId } from "../../films/compositions";
import type { FilmDef } from "./film-def";

export const FILM_DEFS: Record<FilmId, () => Promise<FilmDef>> = {
  intro: () => import("./intro-def").then((module) => module.INTRO_FILM),
  welcome: () => import("../films/welcome/def").then((module) => module.WELCOME_FILM),
};

export const FILM_IDS: readonly FilmId[] = Object.freeze(Object.keys(FILM_DEFS) as FilmId[]);

/** The minimum a timing helper needs from a film (a `FilmDef`, or its `describeFilm` data). */
type FilmTiming = {
  duration: number;
  stageStart: readonly number[];
  shots: readonly { start: number; end: number }[];
};

/** Index of the shot playing at film time `time` (before the first shot: 0; at or after the end: the last). */
export function filmShotIndexAt(film: FilmTiming, time: number): number {
  for (let index = film.shots.length - 1; index >= 0; index -= 1) {
    if (time >= film.shots[index].start) return index;
  }
  return 0;
}

/** The stage at film time `time`: the last stage whose start is at or before it (0 before the film). */
export function filmStageAt(film: FilmTiming, time: number): number {
  let stage = 0;
  for (let index = 0; index < film.stageStart.length; index += 1) {
    if (time >= film.stageStart[index]) stage = index;
  }
  return stage;
}

/** Film time of the last stage (the brand or reveal), where a hold that lasts too long jumps to. */
export function filmFinalStageStart(film: FilmTiming): number {
  return film.stageStart.length ? film.stageStart[film.stageStart.length - 1] : 0;
}

/** What a film is, as plain JSON: the lab hands this to the render driver after `load`. */
export type FilmDescription = {
  id: FilmId;
  duration: number;
  stageStart: number[];
  shots: { id: string; start: number; end: number; set: string; cast: string[]; subjects: boolean }[];
  sets: string[];
  cast: string[];
  comps: FilmComposition[];
};

export function describeFilm(film: FilmDef): FilmDescription {
  return {
    id: film.id,
    duration: film.duration,
    stageStart: [...film.stageStart],
    shots: film.shots.map((shot) => ({
      id: shot.id,
      start: shot.start,
      end: shot.end,
      set: shot.set,
      cast: [...shot.cast],
      subjects: typeof shot.subjects === "function",
    })),
    sets: [...film.sets],
    cast: [...film.cast],
    comps: [...film.comps],
  };
}

/**
 * Problems with a film's definition (an empty list when it is sound): shots must run in order from 0 to the
 * duration with no gap or overlap, stages must start at 0 and rise, every shot's set and cast must be declared, and
 * ids must be unique.
 */
export function checkFilmDef(film: {
  duration: number;
  stageStart: readonly number[];
  sets: readonly string[];
  cast: readonly string[];
  shots: readonly { id: string; start: number; end: number; set: string; cast: readonly string[] }[];
}): string[] {
  const problems: string[] = [];
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  if (!(film.duration > 0)) problems.push("the duration must be positive");
  if (film.shots.length === 0) problems.push("a film needs at least one shot");
  if (film.stageStart.length === 0 || film.stageStart[0] !== 0) problems.push("the first stage must start at 0");
  for (let index = 1; index < film.stageStart.length; index += 1) {
    if (!(film.stageStart[index] > film.stageStart[index - 1])) problems.push(`stage ${index} must start after stage ${index - 1}`);
  }
  if (film.stageStart.some((start) => start >= film.duration)) problems.push("every stage must start before the end");
  const ids = new Set<string>();
  film.shots.forEach((shot, index) => {
    if (ids.has(shot.id)) problems.push(`shot id ${shot.id} is used twice`);
    ids.add(shot.id);
    const expectedStart = index === 0 ? 0 : film.shots[index - 1].end;
    if (!near(shot.start, expectedStart)) problems.push(`${shot.id} starts at ${shot.start}, not ${expectedStart}`);
    if (!(shot.end > shot.start)) problems.push(`${shot.id} must end after it starts`);
    if (!film.sets.includes(shot.set)) problems.push(`${shot.id} uses the undeclared set ${shot.set}`);
    for (const id of shot.cast) if (!film.cast.includes(id)) problems.push(`${shot.id} needs the undeclared character ${id}`);
  });
  const last = film.shots[film.shots.length - 1];
  if (last && !near(last.end, film.duration)) problems.push(`the last shot ends at ${last.end}, not at the duration ${film.duration}`);
  return problems;
}
