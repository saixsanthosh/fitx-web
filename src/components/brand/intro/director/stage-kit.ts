/**
 * Builds and owns everything the shots stage besides the cast: the four sets, the props
 * (bike, barbell, smoothies, the carried helmet's holder), the particle bursts, the sun flare
 * and the in-world macro rings (main thread).
 *
 * Props and effects live inside the group of the set they belong to, so hiding a set hides
 * them too. Between shots `hideStage` puts every set, prop, effect and character back into
 * one known state; each shot's `enter` then shows only what it needs. That keeps seeking
 * deterministic: a frame never depends on which shot played before it.
 */

import * as THREE from "three";
import type { CharacterInstance } from "../character/assemble";
import type { CharacterId } from "../character/types";
import { TABLE } from "../dimensions";
import {
  createBarbell,
  createBike,
  createGymSet,
  createKitchenSet,
  createSmoothie,
  createStudioSet,
  createTrackSet,
  type BarbellProp,
  type BikeProp,
  type IntroSet,
  type SetName,
  type SmoothieProp,
} from "../sets";
import { createChalkBurst, createDustBurst, createGritBurst, createSunFlare, type LitBurst, type ParticleBurst, type SunFlare } from "../fx";
import type { QualitySettings } from "../fx/quality";
import { setGymLampBulbs } from "../sets/gym";
import { setKitchenForeground } from "../sets/kitchen";
import { setStudioBarLevel } from "../sets/studio";
import type { Theme } from "../types";
import { createMacroRings, type MacroRings } from "./macro-rings";

export type { SetName };
export type FilmSets = Record<SetName, IntroSet>;

export interface FilmProps {
  /** Leo's road bike; lives in the track set. Shots move `bike.group` with the rider. */
  bike: BikeProp;
  /** Dre's loaded barbell; lives in the gym set. */
  barbell: BarbellProp;
  /** Maya's (berry, seat 0) and Dre's (green, seat 1) smoothies; live in the kitchen set. */
  smoothies: [SmoothieProp, SmoothieProp];
  /** Macro rings drawn around both bowls in the overhead shot (kitchen set; index 0 = Maya's). */
  rings: MacroRings;
  /** Studio-set holder that the carried helmet is re-parented to during the team walk. */
  helmetHolder: THREE.Group;
}

export interface FilmFx {
  /** Rubber grit kicked up by the sprint start (two, so consecutive footfalls can overlap). */
  grit: [ParticleBurst, ParticleBurst];
  /** Dre's chalk clap. */
  chalk: LitBurst;
  /** Dust rings where the bumper plates land (one per side). */
  dust: [LitBurst, LitBurst];
  /** Sun (light) or floodlight (dark) flare on the track; parented to the set's `sun` anchor. */
  flare: SunFlare;
}

export interface Stage {
  sets: FilmSets;
  props: FilmProps;
  fx: FilmFx;
  /** Particle allocation at build time (QualitySettings.particleScale), for later downgrades. */
  readonly particleScale: number;
  /** Shows (true) or hides (false) every effect and prop so one compile pass covers all shaders. */
  primeEffects(on: boolean): void;
  applyTheme(theme: Theme): void;
  /** Applies a cheaper particle budget after a quality downgrade. */
  setParticleScale(scale: number): void;
  dispose(): void;
}

const FLARE_COLOR: Record<Theme, number> = { light: 0xffc68a, dark: 0xdfe8ff };

export function buildStage(renderer: THREE.WebGLRenderer, scene: THREE.Scene, theme: Theme, quality: QualitySettings): Stage {
  const setOptions = { quality: quality.tier };
  const sets: FilmSets = {
    track: createTrackSet(renderer, theme, setOptions),
    gym: createGymSet(renderer, theme, setOptions),
    kitchen: createKitchenSet(renderer, theme, setOptions),
    studio: createStudioSet(renderer, theme, setOptions),
  };
  for (const set of Object.values(sets)) {
    set.group.visible = false;
    scene.add(set.group);
  }

  const bike = createBike();
  bike.group.name = "prop-bike";
  sets.track.group.add(bike.group);

  const barbell = createBarbell();
  barbell.group.name = "prop-barbell";
  sets.gym.group.add(barbell.group);

  const smoothies: [SmoothieProp, SmoothieProp] = [createSmoothie("berry"), createSmoothie("green")];
  smoothies.forEach((smoothie, index) => {
    smoothie.group.name = `prop-smoothie-${index}`;
    sets.kitchen.group.add(smoothie.group);
  });

  // One ring set per bowl (Maya's = index 0, Dre's = 1); the group sits on the table top.
  const rings = createMacroRings(theme, TABLE.places.map((place) => [place.bowl[0], place.bowl[2]] as const));
  rings.group.position.set(0, TABLE.height + 0.009, 0);
  sets.kitchen.group.add(rings.group);

  const helmetHolder = new THREE.Group();
  helmetHolder.name = "prop-helmet-holder";
  sets.studio.group.add(helmetHolder);

  const particleScale = quality.particleScale;
  // The track's key is low behind the start in both themes (sun / night macro flood): light the
  // rubber dust from there so the 0-set kick glows against it; [0] is the hero toe-off, read in
  // slow-mo, so it kicks harder. Crumbs in the tartan's own fresh-cut terracotta (not dark
  // debris): lit by the macro's camera-side card they read as rubber against the backlight.
  const gritLight = {
    lightDirection: new THREE.Vector3(-0.6, 0.18, -0.78),
    lightColor: 0xffe4c8,
    lightIntensity: 13,
    dustColor: 0xdcae92,
    colors: [0xc65c40, 0xd8784f, 0xb04e38, 0x93452f, 0xe39c74],
  };
  const grit: [ParticleBurst, ParticleBurst] = [
    createGritBurst({ particleScale, seed: 3, strength: 1.35, ...gritLight }),
    createGritBurst({ particleScale, seed: 11, strength: 0.85, ...gritLight }),
  ];
  for (const burst of grit) sets.track.group.add(burst.object);
  // 3b reads the clap in a medium close-up at ~0.35× for ~0.15 s of cloud age: a big, dense cloud.
  const chalk = createChalkBurst({ particleScale, seed: 5, scale: 2.1, density: 1.25 });
  sets.gym.group.add(chalk.object);
  // 3d drives the lens into these rings, so they must fill the frame within ~0.2 s of the impact.
  const dust: [LitBurst, LitBurst] = [createDustBurst({ particleScale, seed: 17, density: 1.9, radius: 0.28 }), createDustBurst({ particleScale, seed: 29, density: 1.9, radius: 0.28 })];
  for (const burst of dust) sets.gym.group.add(burst.object);

  const flare = createSunFlare({ color: FLARE_COLOR[theme] });
  sets.track.anchors.sun.add(flare.object);

  const props: FilmProps = { bike, barbell, smoothies, rings, helmetHolder };
  const fx: FilmFx = { grit, chalk, dust, flare };
  const bursts: ParticleBurst[] = [...grit, chalk, ...dust];

  const origin = new THREE.Vector3(0, 0.6, 0);
  const up = new THREE.Vector3(0, 1, 0);

  return {
    sets,
    props,
    fx,
    particleScale,
    primeEffects(on) {
      for (const burst of bursts) {
        if (on) {
          burst.trigger(origin, up, 0);
          burst.update(0.35);
        } else {
          burst.reset();
        }
      }
      bike.group.visible = on;
      barbell.group.visible = on;
      for (const smoothie of smoothies) smoothie.group.visible = on;
      rings.group.visible = on;
      rings.setProgress(on ? 1 : 0);
      flare.setIntensity(on ? 1 : 0);
    },
    applyTheme(next) {
      for (const set of Object.values(sets)) set.applyTheme(next);
      rings.applyTheme(next);
      flare.setColor(FLARE_COLOR[next]);
    },
    setParticleScale(scale) {
      for (const burst of bursts) burst.setParticleScale(scale);
    },
    dispose() {
      for (const burst of bursts) burst.dispose();
      flare.dispose();
      rings.dispose();
      bike.dispose();
      barbell.dispose();
      for (const smoothie of smoothies) smoothie.dispose();
      helmetHolder.removeFromParent();
      for (const set of Object.values(sets)) {
        set.group.removeFromParent();
        set.dispose();
      }
    },
  };
}

/** Where a character's helmet normally rides, so the walk shot can borrow it and give it back. */
const helmetHome = new WeakMap<CharacterInstance, { parent: THREE.Object3D; position: THREE.Vector3 }>();

/** Re-parents a character's helmet to `holder`, centred on the holder's origin (walk carry). */
export function carryHelmet(instance: CharacterInstance, holder: THREE.Object3D) {
  const helmet = instance.meshes.helmet as THREE.Mesh | undefined;
  if (!helmet?.parent) return;
  if (!helmetHome.has(instance)) helmetHome.set(instance, { parent: helmet.parent, position: helmet.position.clone() });
  const geometry = helmet.geometry;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const center = geometry.boundingBox!.getCenter(new THREE.Vector3());
  holder.add(helmet);
  helmet.position.copy(center).negate();
  helmet.quaternion.identity();
  instance.setAccessoryVisible("helmetStraps", false);
}

/**
 * Undoes what the refuel and team shots change on a character: the carried helmet (and its
 * straps), the sunglasses Leo takes off for the walk, and the expression the face cues set.
 * Every shot starts from this state, so no frame depends on whether Act 3 played before it.
 */
function restoreHelmet(instance: CharacterInstance) {
  instance.setAccessoryVisible("sunglassesFrame", true);
  instance.setAccessoryVisible("sunglassesLens", true);
  instance.face.setExpression({ smile: 0, laugh: 0 });
  const home = helmetHome.get(instance);
  const helmet = instance.meshes.helmet;
  if (!home || !helmet) return;
  home.parent.add(helmet);
  helmet.position.copy(home.position);
  helmet.quaternion.identity();
  instance.setAccessoryVisible("helmetStraps", true);
}

/** Puts every set, prop, effect and character into the default (hidden, at rest) state. */
export function hideStage(stage: Stage, cast: Partial<Record<CharacterId, CharacterInstance>>) {
  for (const set of Object.values(stage.sets)) set.group.visible = false;
  const { bike, barbell, smoothies, rings, helmetHolder } = stage.props;
  bike.group.visible = false;
  bike.setSpinBlur(0);
  barbell.group.visible = false;
  barbell.setBend(0);
  barbell.setSleeveSpin(0);
  barbell.setCollarClamp(1);
  for (const side of [barbell.plates.left, barbell.plates.right]) {
    for (const plate of side) {
      plate.object.position.x = plate.restX;
      plate.object.rotation.x = 0;
      plate.object.visible = true;
    }
  }
  barbell.collars.forEach((collar) => {
    collar.position.x = collar.userData.restX as number;
    collar.visible = true;
  });
  for (const smoothie of smoothies) smoothie.group.visible = false;
  // Set-level state the Act 3 shots drive per frame: the toast's near plant and the studio bar.
  setKitchenForeground(stage.sets.kitchen, false);
  setStudioBarLevel(stage.sets.studio, 1, 0);
  // The gym's lamp bulbs are on unless a shot turns them off (the welcome film does, in every shot).
  setGymLampBulbs(stage.sets.gym, true);
  rings.group.visible = false;
  rings.setProgress(0);
  rings.setOpacity(1);
  helmetHolder.visible = true;
  for (const burst of [...stage.fx.grit, stage.fx.chalk, ...stage.fx.dust]) burst.reset();
  stage.fx.flare.setIntensity(0);
  for (const instance of Object.values(cast)) {
    if (!instance) continue;
    restoreHelmet(instance);
    instance.group.visible = false;
    instance.group.position.set(0, 0, 0);
    instance.group.quaternion.identity();
    instance.group.scale.setScalar(1);
    instance.setHandPose("L", "relaxed");
    instance.setHandPose("R", "relaxed");
    instance.face.setBlink(0);
    instance.face.setGaze(null);
  }
}
