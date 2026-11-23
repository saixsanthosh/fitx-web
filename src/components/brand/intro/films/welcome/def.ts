/**
 * The welcome film ("The Forge") as a `FilmDef`: a stub until film-welcome fills it (BRIEF-2 3.2, 3.3).
 *
 * One black shot for the whole 12.0 s, no cast and no compositions (`comps` is empty, so nothing serves or renders
 * it as a finished film). It exists so the registry, the lab and the render driver work end to end before the real
 * shots exist. It imports only pure modules, so node tests can load it through `FILM_DEFS.welcome`.
 *
 * Created by film-lab's film-def commit; film-welcome owns it afterwards.
 */

import { GRADES } from "../../fx/grades";
import { createCameraState } from "../../director/camera";
import type { FilmDef } from "../../director/film-def";
import type { ShotModule } from "../../director/shot-types";
import { WELCOME_DURATION, WELCOME_STAGE_START } from "./timeline";

const camera = createCameraState();
camera.position.set(0, 1.6, 6);
camera.target.set(0, 1.2, 0);

const BLACK = 0x000000;

const black: ShotModule = {
  id: "w-stub",
  set: "studio",
  cast: [],
  enter(ctx) {
    ctx.sets.studio.group.visible = false;
  },
  update(ctx) {
    return {
      camera,
      lighting: ctx.sets.studio.lighting(),
      grade: GRADES.brandDark,
      focus: { distance: 6, aperture: 0 },
      fade: { color: BLACK, amount: 1 },
    };
  },
  start: 0,
  end: WELCOME_DURATION,
};

export const WELCOME_FILM: FilmDef = Object.freeze({
  id: "welcome",
  duration: WELCOME_DURATION,
  stageStart: WELCOME_STAGE_START,
  shots: [black],
  sets: ["studio"],
  cast: [],
  comps: [],
});
