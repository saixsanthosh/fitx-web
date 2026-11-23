/**
 * The film definition (BRIEF-2 3.2): everything the director needs to play one film, so the same director, lab and
 * render pipeline serve the intro and the welcome film.
 *
 * A `FilmDef` is plain data plus its shot modules. Films are reached only through the registry in `film-defs.ts`
 * (`FILM_DEFS`), never by importing a film's own files, so the lab never imports a welcome file directly.
 * `createFilmDirector(film, options)` plays a `FilmDef`; `createIntroDirector(options)` stays as the intro's wrapper
 * with its signature unchanged.
 *
 * Owned by film-lab.
 */

import type { FilmComposition, FilmId } from "../../films/compositions";
import type { ShotModule } from "./shot-types";

export type FilmDef = {
  id: FilmId;
  /** Film time (seconds) at which the film ends and `onComplete` fires, the end hold included. */
  duration: number;
  /** Film-time start of each stage, indexed by stage number (the first is 0); the last stage is the brand. */
  stageStart: readonly number[];
  /** The shots in film order; each covers `[start, end)` and together they run from 0 to `duration`. */
  shots: readonly ShotModule[];
  /** The sets the film's shots use (`ShotModule.set`). */
  sets: readonly string[];
  /** Character ids in generation order; the first one opens the film, so a failure to make it is fatal. */
  cast: readonly string[];
  /** The compositions this film is authored and served for (`COMPOSITIONS` ids); empty until it is authored. */
  comps: readonly FilmComposition[];
};

export { createFilmDirector } from "./director";
export type { DirectorOptions, FilmFrameInfo, IntroDirector } from "./director";
