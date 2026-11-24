import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { INTRO_FILM } from "@/components/brand/intro/director/intro-def";
import type { FilmContext, ShotFrame, ShotModule } from "@/components/brand/intro/director/shot-types";
import { hideStage, type Stage } from "@/components/brand/intro/director/stage-kit";
import { WELCOME_FILM } from "@/components/brand/intro/films/welcome/def";
import { setGymLampBulbs } from "@/components/brand/intro/sets/gym";
import type { IntroSet } from "@/components/brand/intro/sets/types";
import { contextFor, samples } from "./intro-stage";

// The gym's hanging-lamp bulbs (the `lamp-bulbs` emitter): the intro shows them (its gym shots were approved with
// them); the welcome film hides them in every shot, in both themes (from the loaders' low lenses a far lamp's bulb sat
// right behind Leo's head in w2-leo and Dre's in w3-dre). Shots are played in the director's order: at a shot change
// `hideStage`, the shot's set shown and `enter`, then `update` for each frame.

const noop = () => undefined;

/** The framing stand-in (./intro-stage.ts), plus what `hideStage` also resets and a bulbs mesh registered on its gym set as `createGymSet` does. */
function standIn(theme: "dark" | "light") {
  const ctx = contextFor("laptop", theme);
  for (const burst of [...ctx.fx.grit, ctx.fx.chalk, ...ctx.fx.dust]) Object.assign(burst, { reset: noop });
  Object.assign(ctx.props.rings, { setProgress: noop, setOpacity: noop });
  const bulbs = new THREE.Mesh(new THREE.SphereGeometry(0.06), new THREE.MeshBasicMaterial());
  bulbs.name = "lamp-bulbs";
  ctx.sets.gym.group.add(bulbs);
  ctx.sets.gym.group.userData.lampBulbs = bulbs;
  return { ctx, bulbs };
}

/** Plays `shot` at `times` (ascending, inside the shot) as the director does, calling `check` after each frame. */
function play(ctx: FilmContext, shot: ShotModule, times: readonly number[], check: (time: number) => void) {
  times.forEach((time, index) => {
    const frame: ShotFrame = {
      time,
      local: time - shot.start,
      duration: shot.end - shot.start,
      progress: Math.min(1, Math.max(0, (time - shot.start) / (shot.end - shot.start))),
      aspect: ctx.aspect,
    };
    if (index === 0) {
      hideStage(ctx as unknown as Stage, ctx.cast);
      ctx.sets[shot.set].group.visible = true;
      shot.enter(ctx, frame);
    }
    shot.update(ctx, frame);
    check(time);
  });
}

test("the gym set registers its lamp bulbs, and setGymLampBulbs shows or hides only them", () => {
  const gym = readFileSync(new URL("../../src/components/brand/intro/sets/gym.ts", import.meta.url), "utf8");
  assert.match(gym, /bulbs\.name = "lamp-bulbs";\s*group\.add\(bulbs\);\s*group\.userData\.lampBulbs = bulbs;/, "createGymSet registers its lamp-bulbs emitter");
  const group = new THREE.Group();
  const bulbs = new THREE.Mesh();
  const shade = new THREE.Mesh();
  group.add(bulbs, shade);
  group.userData.lampBulbs = bulbs;
  const set = { group } as unknown as IntroSet;
  setGymLampBulbs(set, false);
  assert.equal(bulbs.visible, false, "the bulbs are off");
  assert.equal(shade.visible, true, "the rest of the set stays");
  assert.equal(group.visible, true, "the set stays");
  setGymLampBulbs(set, true);
  assert.equal(bulbs.visible, true, "back on");
  // A set without registered bulbs is left alone.
  assert.doesNotThrow(() => setGymLampBulbs({ group: new THREE.Group() } as unknown as IntroSet, false));
});

test("the welcome film hides the lamp bulbs in every shot, in both themes", () => {
  assert.ok(WELCOME_FILM.shots.every((shot) => shot.set === "gym"), "The Forge is all on the gym set");
  for (const theme of ["dark", "light"] as const) {
    const { ctx, bulbs } = standIn(theme);
    const seen: string[] = [];
    for (const shot of WELCOME_FILM.shots) {
      play(ctx, shot, samples(shot), (time) => {
        assert.equal(ctx.sets.gym.group.visible, true, `${shot.id} (${theme}) at ${time} s: the gym is shown`);
        assert.equal(bulbs.visible, false, `${shot.id} (${theme}) at ${time} s: the lamp bulbs are off`);
      });
      seen.push(shot.id);
    }
    assert.ok(seen.includes("w2-leo") && seen.includes("w3-dre"), "Leo's and Dre's shots are among them");
  }
});

test("the intro keeps the lamp bulbs on in every shot, in both themes, even on a stage that just played the welcome film", () => {
  const gymShots = INTRO_FILM.shots.filter((shot) => shot.set === "gym").map((shot) => shot.id);
  assert.deepEqual(gymShots, ["3a-plate", "3b-chalk", "3c-pull", "3d-drop"]);
  const leo = WELCOME_FILM.shots.find((shot) => shot.id === "w2-leo")!;
  for (const theme of ["dark", "light"] as const) {
    const { ctx, bulbs } = standIn(theme);
    // A welcome shot first turns them off; `hideStage` must turn them back on for the intro's shots.
    play(ctx, leo, [leo.start + 0.5], () => assert.equal(bulbs.visible, false, "w2-leo turned them off"));
    for (const shot of INTRO_FILM.shots) {
      play(ctx, shot, samples(shot), (time) => assert.equal(bulbs.visible, true, `${shot.id} (${theme}) at ${time} s: the lamp bulbs are on`));
    }
  }
});
