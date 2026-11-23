/**
 * The intro film as a `FilmDef` (film-def.ts): today's timeline (`timeline.ts`) and shot list (`shots/`), unchanged.
 * Reached through `FILM_DEFS.intro`; `createIntroDirector` plays it.
 *
 * Created by film-lab's film-def commit; film-intro owns it afterwards.
 */

import { COMPOSITIONS } from "../../films/compositions";
import { CAST_ORDER } from "../character/cast";
import { FILM_DURATION, SHOTS, STAGE_START } from "../timeline";
import type { FilmDef } from "./film-def";
import type { ShotModule } from "./shot-types";
import { SHOT_LIST } from "./shots";

/** Each shot with its place on the clock from `SHOTS` (the two lists share their order; `shots/index.ts` checks it). */
const shots: readonly ShotModule[] = SHOT_LIST.map((shot, index) => ({ ...shot, start: SHOTS[index].start, end: SHOTS[index].end }));

export const INTRO_FILM: FilmDef = Object.freeze({
  id: "intro",
  duration: FILM_DURATION,
  stageStart: STAGE_START,
  shots,
  sets: [...new Set(SHOT_LIST.map((shot) => shot.set))],
  cast: [...CAST_ORDER],
  comps: COMPOSITIONS.map((band) => band.id),
});
