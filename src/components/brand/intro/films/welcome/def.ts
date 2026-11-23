/**
 * The welcome film ("The Forge") as a `FilmDef` (BRIEF-2 3.2 and 3.3): six shots on the gym set with the three
 * athletes (D5 (a)), both themes (D4), all five compositions. Reached only through `FILM_DEFS.welcome`.
 *
 * Its timings are PROVISIONAL (BRIEF-2 1.2): they follow the C0 timeline and the beats in `timeline.ts`, and are fixed
 * only after gate A has passed and the owner has approved the D5 animatic. `FILM_MANIFESTS.welcome` stays null (D1
 * dormant) until the coordinator's final render pass (S6).
 *
 * Imports stay node-safe, so node tests load it (`tests/brand/film-lab-defs.test.ts`, `tests/brand/welcome-film.test.ts`).
 * Created as a stub by film-lab's film-def commit; film-welcome owns it.
 */

import { COMPOSITIONS } from "../../../films/compositions";
import { CAST_ORDER } from "../../character/cast";
import type { FilmDef } from "../../director/film-def";
import { WELCOME_SHOT_MODULES } from "./shots";
import { WELCOME_DURATION, WELCOME_STAGE_START } from "./timeline";

export const WELCOME_FILM: FilmDef = Object.freeze({
  id: "welcome",
  duration: WELCOME_DURATION,
  stageStart: WELCOME_STAGE_START,
  shots: WELCOME_SHOT_MODULES,
  sets: [...new Set(WELCOME_SHOT_MODULES.map((shot) => shot.set))],
  cast: [...CAST_ORDER],
  comps: COMPOSITIONS.map((band) => band.id),
});
