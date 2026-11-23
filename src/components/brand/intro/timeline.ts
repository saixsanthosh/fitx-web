/**
 * The film's timing contract, shared by the 3D director (`director/`) and the DOM overlay
 * (`CinematicIntro.tsx`). Times are in seconds of *film time* (wall-clock playback time);
 * slow-motion inside a shot changes the characters' action time, never film time.
 *
 * Story: one morning (light theme) or one night (dark theme) in the life of three FITX
 * athletes — Maya runs, Leo rides, Dre lifts, they refuel together and walk out as a team.
 * Beats follow the brand line TRAIN · EAT · PROGRESS and end on the approved FITX mark.
 */

import type { FilmComposition } from "../films/compositions";

export const STAGE = {
  coldOpen: 0,
  run: 1,
  ride: 2,
  lift: 3,
  refuel: 4,
  team: 5,
  brand: 6,
} as const;

export type IntroStage = (typeof STAGE)[keyof typeof STAGE];

/** Film-time start of each stage, indexed by stage number. */
export const STAGE_START: readonly number[] = [0, 1.3, 3.5, 5.1, 7.55, 9.2, 10.6];

/**
 * The scene calls `onComplete` at this film time (brand hold included). The brand stage lasts 2.0 s
 * (BRIEF-2 3.3): the scene clears and settles by 11.8 while `LogoReveal variant="film-end"` (1.8 s)
 * forms and holds to the last frame. The cuts encoded before wave 2 end at 11.917 s; the end card
 * reads the playing cut's length and keeps its shorter card for them (IntroFilmOverlay.tsx).
 */
export const FILM_DURATION = 12.6;

export function stageAt(time: number): IntroStage {
  let stage = 0;
  for (let index = 0; index < STAGE_START.length; index += 1) {
    if (time >= STAGE_START[index]) stage = index;
  }
  return stage as IntroStage;
}

/**
 * Every cut in the film. The director owns what happens inside each shot (camera, action,
 * lighting, grade); this list only fixes *when* the cuts happen so the overlay can sync to them.
 */
export const SHOTS = [
  { id: "0-set", stage: STAGE.coldOpen, start: 0.0, end: 1.3, note: "Macro: Maya's right shoe on the start line, heel lifts, grit kicks up (slow-mo)." },
  { id: "1a-drive", stage: STAGE.run, start: 1.3, end: 2.35, note: "Side tracking at hip height: sprint start, drive phase, ponytail whip, sun backlight." },
  { id: "1b-stride", stage: STAGE.run, start: 2.35, end: 3.5, note: "Front 3/4 tracking pulling back: full stride toward camera; Leo overtakes close to lens at 3.25–3.5." },
  { id: "2a-cadence", stage: STAGE.ride, start: 3.5, end: 4.35, note: "Low tracking at pedal height: cranks, wheel, legs pumping, flare through spokes." },
  { id: "2b-wheel", stage: STAGE.ride, start: 4.35, end: 5.1, note: "Front pull-back on Leo, then push into the spinning front wheel until spokes fill frame." },
  { id: "3a-plate", stage: STAGE.lift, start: 5.1, end: 5.5, note: "Match cut: coral bumper plate spins onto the sleeve, collar clamps, dust in god rays." },
  { id: "3b-chalk", stage: STAGE.lift, start: 5.5, end: 6.05, note: "Dre claps chalk in a light shaft; chalk cloud in slow-mo; backlit medium close-up." },
  { id: "3c-pull", stage: STAGE.lift, start: 6.05, end: 7.25, note: "Low-angle hero wide: setup, pull (slow-mo at lift-off), lockout ~7.0, crane up." },
  { id: "3d-drop", stage: STAGE.lift, start: 7.25, end: 7.55, note: "Bar returns to the platform, dust burst, push-through into the next scene." },
  { id: "4a-table", stage: STAGE.refuel, start: 7.55, end: 8.3, note: "Overhead top-down: two bowls, two smoothies, hands reach in; macro rings draw on the table." },
  { id: "4b-toast", stage: STAGE.refuel, start: 8.3, end: 9.2, note: "Side medium: Maya and Dre clink smoothies and laugh; window light; foreground bokeh." },
  { id: "5a-walk", stage: STAGE.team, start: 9.2, end: 10.15, note: "Squad walk toward a low dolly in slow-mo; coral light bar behind; Leo carries his helmet." },
  { id: "5b-rise", stage: STAGE.team, start: 10.15, end: 10.6, note: "Crane up and push into the coral light bar as the team passes; bloom swells into the brand flash." },
  { id: "6-brand", stage: STAGE.brand, start: 10.6, end: FILM_DURATION, note: "Scene clears to the theme background with a soft fall-off and a few settling motes; the DOM mark (film-end) forms over it and holds." },
] as const;

export type ShotId = (typeof SHOTS)[number]["id"];

/** Big kinetic titles rendered by the DOM overlay. Times are film time. */
export const TITLES = [
  { text: "TRAIN", start: 1.75, end: 3.4 },
  { text: "EAT", start: 8.4, end: 9.2 },
  { text: "PROGRESS", start: 9.35, end: 10.55 },
] as const;

/** Where a data callout sits: its side of the picture (portrait compositions put side callouts at the top). */
export type CalloutPlacement = "right" | "left" | "bottom";

/** The same placement on every composition. */
const everywhere = (placement: CalloutPlacement): Readonly<Record<FilmComposition, CalloutPlacement>> => ({
  phone: placement,
  "tablet-p": placement,
  "tablet-l": placement,
  laptop: placement,
  desktop: placement,
});

/**
 * Small data callouts (the product's tracking language) rendered by the DOM overlay. They are the
 * film's own staged readouts, not anyone's data. `placement` is per composition (BRIEF-2 3.3); the
 * areas themselves are in `overlay-zones.ts`.
 */
export const CALLOUTS = [
  { id: "pace", start: 2.45, end: 3.4, label: "PACE", value: "3:58 /KM", detail: "168 BPM", placement: everywhere("right") },
  { id: "cadence", start: 3.7, end: 4.95, label: "CADENCE", value: "94 RPM", detail: "41.2 KM/H", placement: everywhere("left") },
  { id: "pr", start: 6.95, end: 7.55, label: "DEADLIFT", value: "200 KG", detail: "NEW PR", placement: everywhere("right") },
  // On the tall frames the two meals fill the lower half: the readout rides the top there.
  { id: "macros", start: 7.7, end: 8.3, label: "REFUEL", value: "P 42 G · C 64 G · F 18 G", detail: "612 KCAL", placement: { ...everywhere("bottom"), phone: "right", "tablet-p": "right" } },
] as const;

/**
 * Where each callout sits on the 11.9 s cuts encoded before wave 2 (wave 1's placements, the same on
 * every screen, with wave 1's orientation rules in the CSS). Those cuts were framed for these spots,
 * not for the per-composition areas, so the overlay keeps them until the new cuts play
 * (`overlayLayoutFor`, introOverlayTiming.ts).
 */
export const SEED_PLACEMENT: Readonly<Record<(typeof CALLOUTS)[number]["id"], CalloutPlacement>> = {
  pace: "right",
  cadence: "left",
  pr: "right",
  macros: "bottom",
};

/** Cinematic letterbox (2.39:1 on landscape screens). Film time. */
export const LETTERBOX = { inStart: 0, inEnd: 0.5, outStart: 10.6, outEnd: 11.0 } as const;
