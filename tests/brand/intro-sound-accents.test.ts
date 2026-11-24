import { test } from "node:test";
import assert from "node:assert/strict";
import { BARBELL } from "@/components/brand/intro/dimensions";
import { INTRO_FILM } from "@/components/brand/intro/director/intro-def";
import type { FilmContext, ShotFrame, ShotModule } from "@/components/brand/intro/director/shot-types";
import { ACT2_LAB } from "@/components/brand/intro/director/shots/act2-gym";
import { LIFT_EVENTS } from "@/components/brand/intro/motion/lift";
import { INTRO_SOUND_ACCENTS, SHOTS } from "@/components/brand/intro/timeline";
import { INTRO_ACCENTS, INTRO_SHEET } from "../../scripts/brand/films/audio/intro.cues.mjs";
import { contextFor } from "./intro-stage";

// INTRO_SOUND_ACCENTS (intro/timeline.ts) against the shots' own motion: each shot's real `update()` runs on the
// stand-in stage (./intro-stage.ts) and the props it moves are read back, so a retimed shot fails here until its
// accent follows it.

const FPS = 60;
const near = (actual: number, expected: number, tolerance: number, message: string) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} is not within ${tolerance} of ${expected}`);

/** Plays shot `id` (enter once; update at any time, its motion is a pure function of film time) and measures the stand-in. */
function probe(id: string, measure: (ctx: FilmContext) => number) {
  const shot = INTRO_FILM.shots.find((entry) => entry.id === id)!;
  const ctx = contextFor("laptop", "dark");
  const frame = (time: number): ShotFrame => ({
    time,
    local: time - shot.start,
    duration: shot.end - shot.start,
    progress: (time - shot.start) / (shot.end - shot.start),
    aspect: ctx.aspect,
  });
  shot.enter(ctx, frame(shot.start));
  return {
    shot,
    gap(time: number) {
      shot.update(ctx, frame(time));
      return measure(ctx);
    },
  };
}

/** When `gap` (m) first closes in a shot: the first frame that touches, then a bisection inside the frame before it. */
function firstContact(shot: ShotModule, gap: (time: number) => number) {
  const first = Math.ceil(shot.start * FPS - 1e-9);
  let touching = first;
  while (touching / FPS < shot.end && gap(touching / FPS) > 1e-7) touching += 1;
  assert.ok(touching / FPS < shot.end, `${shot.id}: no contact inside the shot`);
  assert.ok(touching > first, `${shot.id}: apart on its first frame`);
  let lo = (touching - 1) / FPS;
  let hi = touching / FPS;
  for (let step = 0; step < 50; step += 1) {
    const mid = (lo + hi) / 2;
    if (gap(mid) > 1e-7) lo = mid;
    else hi = mid;
  }
  return hi;
}

test("plateSeat: the frame where the thrown plate first meets the stack in 3a-plate", () => {
  const plate = probe("3a-plate", (ctx) => {
    // The thrown plate is the outermost on the -X sleeve; its offset outward (-X) from its seat.
    const plates = ctx.props.barbell.plates.right;
    const outer = plates[plates.length - 1];
    return outer.restX - outer.object.position.x;
  });
  const seat = firstContact(plate.shot, plate.gap);
  near(seat, plate.shot.start + ACT2_LAB.PLATE.home, 1e-6, "on the shot's PLATE.home");
  assert.equal(INTRO_SOUND_ACCENTS.plateSeat, Math.round(seat * FPS) / FPS);
  assert.ok(plate.gap(INTRO_SOUND_ACCENTS.plateSeat - 1 / FPS) > 0.005, "still sliding down the sleeve a frame before");
  assert.ok(plate.gap(INTRO_SOUND_ACCENTS.plateSeat) < 1e-6, "seated on the accent's frame");
});

test("barDrop: the frame nearest to where the dropped plates first touch the platform in 3d-drop", () => {
  const bar = probe("3d-drop", (ctx) => {
    // Bar centre above the platform minus the plates' radius: 0 when the plates stand on it.
    const platform = ctx.sets.gym.anchors.platform;
    return ctx.props.barbell.group.position.y - platform.position.y - BARBELL.restHeight;
  });
  const land = firstContact(bar.shot, bar.gap);
  near(land, bar.shot.start + ACT2_LAB.DROP_IMPACT, 1e-6, "on the shot's DROP_IMPACT");
  near(ACT2_LAB.LIFT_CLOCK.drop(land), LIFT_EVENTS.dropTime, 1e-6, "Dre's clock at the lift's dropTime");
  assert.equal(INTRO_SOUND_ACCENTS.barDrop, Math.round(land * FPS) / FPS);
  near(INTRO_SOUND_ACCENTS.barDrop, land, 0.5 / FPS, "within half a frame of the touch");
  assert.ok(bar.gap(INTRO_SOUND_ACCENTS.barDrop - 1 / FPS) > 0.05, "falling a frame before");
  assert.ok(bar.gap(INTRO_SOUND_ACCENTS.barDrop + 1 / FPS) <= 0, "down on the next frame");
});

test("the accents sit on the frame grid inside their shots, and the intro's mix plays them", () => {
  for (const [key, id] of [["plateSeat", "3a-plate"], ["barDrop", "3d-drop"]] as const) {
    const time = INTRO_SOUND_ACCENTS[key];
    near(time * FPS, Math.round(time * FPS), 1e-9, `${key} on a frame`);
    const shot = SHOTS.find((entry) => entry.id === id)!;
    assert.ok(time > shot.start && time < shot.end, `${key} inside ${id}`);
  }
  assert.deepEqual({ ...INTRO_ACCENTS }, { ...INTRO_SOUND_ACCENTS }, "the cue sheet takes the timeline's accents, not its defaults");
  const cueAt = (id: string) => INTRO_SHEET.cues.find((entry: { id: string }) => entry.id === id)!.at;
  near(cueAt("plate-3a"), INTRO_SOUND_ACCENTS.plateSeat, 0.0005, "the plate's clang");
  near(cueAt("drop-3d"), INTRO_SOUND_ACCENTS.barDrop, 0.0005, "the drop's thud");
});
