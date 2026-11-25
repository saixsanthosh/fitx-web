/**
 * The welcome film ("The Forge") as a `FilmDef` (BRIEF-2 3.2 and 3.3): six shots on the gym set with the three
 * athletes (D5 (a)), both themes (D4), all five compositions. Reached only through `FILM_DEFS.welcome`.
 *
 * Its timings follow the C0 timeline and the beats in `timeline.ts`, and are final: gate A passed (BRIEF-2 D10) and the
 * owner approved the D5 animatic (D11). The film is live since release 2b: `FILM_MANIFESTS.welcome`
 * (`films/cuts.generated.ts`) holds the cuts S6, the coordinator's final render pass, made from this definition, so a
 * change here reaches members only with the next final render.
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
