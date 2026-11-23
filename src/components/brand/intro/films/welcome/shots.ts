/**
 * "The Forge": the welcome film's six shots (D5 (a): the same three athletes in a new story; D4: both themes), on the
 * gym set with a night-forge treatment (dark: one night, moonlit window shafts and a single warm strip light over a
 * dark platform; light: one dawn, low warm sun through the same windows, the strip light warming the platform).
 *
 *   w0-light   0.00-1.40  black; the strip light stutters on with the score's three opening hits and holds on the
 *                         swell's arrival; a macro along the empty bar on its loading blocks, chalk dust in the beam
 *   w1-maya    1.40-3.60  Maya rolls the 20 kg plate down the sleeve; it seats on the cymbal crash (2.40)
 *   w2-leo     3.60-4.88  over the seated plate: Leo shoves the 10 kg plate home (4.48), a small after-tap (4.71)
 *   w3-dre     4.88-6.91  slow motion, low hero angle: Dre drives the last plate home (5.86), chalk off his palms
 *   w4-crane   6.91-9.29  the three stand round the platform; the lens cranes up and over until it looks straight
 *                         down, where the bar, its three plates and the floor lines line up into the mark
 *   w5-ignite  9.29-12.0  the floor lines ignite in the DOM mark's forming order; the lens rises towards the reveal's
 *                         size while the frame clears to the theme background, and `LogoReveal film-end` locks over
 *
 * World = gym set space (see `mark-floor.ts` for the mark's axes and `props.ts` for the bar). Every frame is a pure
 * function of film time (seekable); the beats come from `timeline.ts` (PROVISIONAL until the owner approves the
 * animatic and gate A has passed).
 *
 * Imports stay node-safe (no `motion/index.ts`, `fx/post.ts`, `sets/index.ts` or `shots/common.ts`, which strip-only
 * TypeScript cannot load), so `FILM_DEFS.welcome()` loads in node tests.
 */

import * as THREE from "three";
import type { CharacterInstance } from "../../character/assemble";
import type { CharacterId } from "../../character/types";
import { createCameraState, evaluateCameraTrack, type CameraState, type CameraTrack } from "../../director/camera";
import type { ShotContext, ShotModule, ShotView, SubjectBox } from "../../director/shot-types";
import { GRADES, mixGrades, type GradeParams } from "../../fx/grades";
import type { LightingPreset } from "../../lighting";
import { applyHeadLook, blinkAmount } from "../../motion/layers";
import { PonytailSpring } from "../../motion/secondary";
import { clamp01, lerp, smoothstep } from "../../math";
import type { Theme } from "../../types";
import type { FilmComposition } from "../../../films/compositions";
import { CRANE_LIMITS, closestRevealRatio, ignitionAt, MARK_IGNITION_ORDER, topDownFraming } from "./mark-floor";
import { LOADS, plateTravel, poseLoad, poseStand, type LoadSpec } from "./load-motion";
import { BAR_CENTRE, INLAY_TOP, leoIndoors, PLATE_SEATS, placePlate, plateWorld, resetWelcomeProps, showPlates, sleeveZ, welcomePlates, welcomeProps, WELCOME_COLOURS } from "./props";
import { WELCOME_BEATS, WELCOME_DURATION, WELCOME_SHOTS } from "./timeline";

const SHOT = Object.fromEntries(WELCOME_SHOTS.map((shot) => [shot.id, shot])) as Record<(typeof WELCOME_SHOTS)[number]["id"], (typeof WELCOME_SHOTS)[number]>;

/** The page's background in each theme (`--fitx-bg`), which the last frames clear to (the hand-off to the page). */
export const WELCOME_BRAND_BG: Record<Theme, number> = { light: 0xf7f7f4, dark: 0x151715 };

const camera = createCameraState();
const point = new THREE.Vector3();
const point2 = new THREE.Vector3();

// ------------------------------------------------------------------------------------------------- helpers

function window01(a: number, b: number, x: number) {
  const u = clamp01((x - a) / (b - a));
  return u * u * (3 - 2 * u);
}

function show(ctx: ShotContext, id: CharacterId, x: number, z: number, yaw: number): CharacterInstance {
  const instance = ctx.cast[id];
  if (!instance) throw new Error(`character ${id} is not ready`);
  instance.group.position.set(x, 0, z);
  instance.group.rotation.set(0, yaw, 0);
  instance.group.visible = true;
  instance.group.updateMatrixWorld(true);
  return instance;
}

/** Yaw that turns a +Z-facing character at (x, z) to face (tx, tz). */
function yawToward(x: number, z: number, tx: number, tz: number) {
  return Math.atan2(tx - x, tz - z);
}

const springs = new WeakMap<CharacterInstance, Map<string, PonytailSpring>>();
/** Maya's ponytail: one spring per shot, re-simulated from the shot's start, so a seek lands on the same strands. */
function withHair(instance: CharacterInstance, key: string, start: number, time: number, drive: (time: number) => void) {
  if (instance.id !== "maya") {
    drive(time);
    return;
  }
  let map = springs.get(instance);
  if (!map) springs.set(instance, (map = new Map()));
  let spring = map.get(key);
  if (!spring) map.set(key, (spring = new PonytailSpring(instance.rig, { startTime: start })));
  spring.simulateTo(instance.rig, time, drive);
}

function layers(instance: CharacterInstance, time: number, seed: number, look?: THREE.Vector3, weight = 0) {
  if (look && weight > 0) {
    instance.group.updateMatrixWorld(true);
    applyHeadLook(instance.rig, look, weight);
  }
  instance.face.setBlink(blinkAmount(time, seed));
}

/** A character's box from its joints (lab framing checks only). */
function bodyBox(id: string, instance: CharacterInstance | undefined, must: boolean): SubjectBox | null {
  if (!instance || !instance.group.visible) return null;
  instance.group.updateMatrixWorld(true);
  const box = new THREE.Box3();
  for (const bone of ["head", "hand_L", "hand_R", "foot_L", "foot_R", "hips", "chest"] as const) box.expandByPoint(instance.rig.bones[bone].getWorldPosition(point));
  box.expandByScalar(0.12);
  return { id, min: box.min.toArray() as [number, number, number], max: box.max.toArray() as [number, number, number], must };
}

function plateBox(id: string, centre: THREE.Vector3, radius: number): SubjectBox {
  return { id, min: [centre.x - radius, centre.y - radius, centre.z - 0.05], max: [centre.x + radius, centre.y + radius, centre.z + 0.05], must: true };
}

const focusOn = (state: CameraState, target: THREE.Vector3) => state.position.distanceTo(target);

// ------------------------------------------------------------------------------------------------- light

const STRIP = { x: -1.9, y: 3.24, z: [-0.45, 0.65] as const };
const forge: Record<Theme, LightingPreset | null> = { light: null, dark: null };
const scratch: { preset: LightingPreset | null } = { preset: null };

/** A deep copy of plain preset data. */
function clonePreset(preset: LightingPreset): LightingPreset {
  return JSON.parse(JSON.stringify(preset)) as LightingPreset;
}

/**
 * The forge's light for this frame. `strip` is the strip light's level (0 off, 1 on); `glow` (0..1) moves the two
 * practicals down onto the burning mark (the ignite shot). Night: the moon through the windows stays, the platform's
 * warmth is the strip; dawn: a low sun, the strip warming the platform.
 */
function forgeLight(ctx: ShotContext, strip: number, glow = 0): LightingPreset {
  const theme = ctx.theme;
  let base = forge[theme];
  if (!base) {
    base = clonePreset(ctx.sets.gym.lighting("hero"));
    const light = theme === "light";
    base.sun.intensity *= light ? 0.72 : 0.9;
    base.sky.intensity *= light ? 0.75 : 0.55;
    base.fill.intensity *= 0.5;
    base.environmentIntensity *= light ? 0.75 : 0.6;
    base.sun.target = [BAR_CENTRE.x, 0.4, BAR_CENTRE.z + 0.6];
    base.sun.shadowExtent = 3.4;
    forge[theme] = base;
  }
  const out = (scratch.preset ??= clonePreset(base));
  Object.assign(out.sun, base.sun);
  Object.assign(out.sky, base.sky);
  Object.assign(out.fill, base.fill);
  Object.assign(out.rim, base.rim);
  out.environmentIntensity = base.environmentIntensity * (0.55 + 0.45 * clamp01(strip));
  out.exposure = base.exposure;
  out.fog = { ...base.fog };
  const light = ctx.theme === "light";
  const level = Math.max(0, strip);
  const stripColour = light ? 0xffe6c4 : 0xffd9ae;
  for (let index = 0; index < 2; index += 1) {
    const ember = { x: BAR_CENTRE.x - 0.55 + index * 0.9, y: 0.32, z: index === 0 ? 0.55 : -0.2 };
    out.practicals[index] = {
      color: glow > 0 ? lerpColour(stripColour, WELCOME_COLOURS.ember, glow) : stripColour,
      intensity: lerp(level * (light ? 7 : 10), 3.2 * glow, glow),
      position: [lerp(STRIP.x, ember.x, glow), lerp(STRIP.y, ember.y, glow), lerp(STRIP.z[index], ember.z, glow)],
      distance: lerp(9, 3.2, glow),
      decay: 2,
    };
  }
  return out;
}

const _c1 = new THREE.Color();
const _c2 = new THREE.Color();
function lerpColour(a: number, b: number, t: number) {
  return _c1.setHex(a).lerp(_c2.setHex(b), clamp01(t)).getHex();
}

function grade(ctx: ShotContext): GradeParams {
  return ctx.theme === "light" ? GRADES.gymDay : GRADES.gymNight;
}

/** The strip light's stutter: dark, three flashes on the opening hits (each brighter), then on at the swell. */
export function stripLevel(time: number) {
  if (time >= WELCOME_BEATS.lightOn) {
    // On, with a short buzz as the tube settles.
    const tau = time - WELCOME_BEATS.lightOn;
    return 1 + 0.18 * Math.exp(-tau / 0.05) - 0.06 * Math.exp(-tau / 0.12) * Math.sin(tau * 90);
  }
  let level = 0;
  WELCOME_BEATS.flicker.forEach((hit, index) => {
    const tau = time - hit;
    if (tau < -0.02) return;
    const peak = 0.35 + 0.25 * index;
    level = Math.max(level, peak * (tau < 0 ? (tau + 0.02) / 0.02 : Math.exp(-tau / (0.07 + 0.03 * index))));
  });
  // The last pre-heat before it catches: the tube glows faintly from the third flash.
  return Math.max(level, 0.12 * window01(WELCOME_BEATS.flicker[2], WELCOME_BEATS.lightOn, time));
}

function base(ctx: ShotContext, cast: readonly CharacterId[] = []) {
  const welcome = welcomeProps(ctx.sets.gym, ctx.theme);
  welcome.applyTheme(ctx.theme);
  resetWelcomeProps(welcome, ctx.props.barbell);
  // D11: indoors Leo has his helmet off (set down by the platform) and his sunglasses off, in every shot he is in.
  // `hideStage` put them back on him before this `enter`, so this runs at every such shot's start (seeks included).
  // Only for the shots that cast him, so no frame depends on whether he happened to be assembled already; the spot is
  // out of frame in the others (tested).
  const leo = ctx.cast.leo;
  if (leo && cast.includes("leo")) leoIndoors(welcome, leo);
  return welcome;
}

// ------------------------------------------------------------------------------------------------- the plates' travel per loader

/** Maya's, Leo's and Dre's clip, the plate each loads and the root they load it from (on the bar's axis, facing -Z). */
const LOADERS = (["maya", "leo", "dre"] as const).map((id, index) => {
  const spec = LOADS[id];
  const seat = sleeveZ(PLATE_SEATS[index]);
  const rootZ = seat + spec.zSeat;
  return { id, index, spec, rootZ, x: BAR_CENTRE.x };
});

/** Puts plate `index` where its loader's clip has it at action time `action` (world: u from the inner collar). */
function movePlate(ctx: ShotContext, index: number, spec: LoadSpec, action: number) {
  const loader = LOADERS[index];
  const travel = plateTravel(spec, action);
  // Model z is the distance ahead of the loader's root, who faces -Z: world Z = rootZ - z.
  const worldZ = loader.rootZ - travel.z;
  const u = worldZ - (BAR_CENTRE.z + 0.655);
  placePlate(welcomePlates(ctx.props.barbell)[index], u, travel.roll);
  return travel;
}

function load(ctx: ShotContext, index: number, action: number, key: string, start: number) {
  const loader = LOADERS[index];
  const instance = show(ctx, loader.id, loader.x, loader.rootZ, Math.PI);
  let result: ReturnType<typeof poseLoad> | null = null;
  withHair(instance, key, start, action, (time) => {
    result = poseLoad(instance.rig, time, loader.spec);
  });
  const r = result as unknown as ReturnType<typeof poseLoad>;
  instance.setHandPose("L", r.hands.L);
  instance.setHandPose("R", r.hands.R);
  movePlate(ctx, index, loader.spec, action);
  layers(instance, action, loader.spec.seed);
  return instance;
}

// ------------------------------------------------------------------------------------------------- w0-light

const LIGHT_TRACK: CameraTrack = {
  // A macro low along the empty bar from its +Z tip towards the windows: knurling, the inner collar, chalk dust in the
  // moon (or dawn) shafts behind; a slow push as the strip light catches.
  keys: [
    { t: 0, position: [1.27, 0.31, 1.6], target: [0.93, 0.262, 0.82], focal: 58, ease: "inOut" },
    { t: 1.4, position: [1.14, 0.29, 1.36], target: [0.925, 0.262, 0.74], focal: 62 },
  ],
  portrait: { focalScale: 0.82 },
  shake: { amplitude: 0.06, frequency: 0.9, seed: 61 },
};

const shotLight: ShotModule = {
  id: "w0-light",
  set: "gym",
  cast: [],
  start: SHOT["w0-light"].start,
  end: SHOT["w0-light"].end,
  enter(ctx) {
    base(ctx);
    showPlates(ctx.props.barbell, 0);
  },
  update(ctx, frame): ShotView {
    const level = stripLevel(frame.time);
    welcomeProps(ctx.sets.gym, ctx.theme).setStrip(level);
    evaluateCameraTrack(LIGHT_TRACK, frame.local, frame.aspect, camera);
    // Focus pulls from the sleeve tip to the inner collar as the light holds.
    point.set(BAR_CENTRE.x, BAR_CENTRE.y, sleeveZ(0.44));
    point2.set(BAR_CENTRE.x, BAR_CENTRE.y, BAR_CENTRE.z + 0.62);
    const rack = window01(0.6, 1.35, frame.local);
    const darkness = 1 - clamp01(level * 1.6);
    return {
      camera,
      lighting: forgeLight(ctx, level),
      grade: grade(ctx),
      focus: { distance: lerp(focusOn(camera, point), focusOn(camera, point2), rack), aperture: 2, maxBlur: 0.025 },
      // The first frames are black: the film opens in the dark and the tube's flashes light it.
      fade: { color: 0x000000, amount: 0.92 * darkness * (1 - window01(0, 0.25, frame.time) * 0.2) },
    };
  },
  subjects() {
    return [plateBox("sleeve-tip", point.set(BAR_CENTRE.x, BAR_CENTRE.y, sleeveZ(0.3)), 0.06)];
  },
};

// ------------------------------------------------------------------------------------------------- w1-maya

const MAYA_TRACK: CameraTrack = {
  // Three-quarter front from the bar's -X side, lit by the strip behind the lens: Maya head to toe, the plate rolling
  // away from her down the sleeve; a slow dolly round as it seats.
  keys: [
    { t: 0, position: [-0.95, 0.98, 0.22], target: [0.95, 0.66, 1.5], focal: 27, ease: "inOut" },
    { t: 1.1, position: [-0.88, 1.0, 0.31], target: [0.95, 0.74, 1.5], focal: 27 },
    // She stands up from 1.12: the lens tilts up with her so her head stays in frame.
    { t: 1.6, position: [-0.84, 1.08, 0.36], target: [0.95, 0.96, 1.56], focal: 25.5 },
    { t: 2.2, position: [-0.78, 1.1, 0.42], target: [0.95, 0.98, 1.56], focal: 25.5 },
  ],
  portrait: { distanceScale: 1.25, focalScale: 0.8 },
  shake: { amplitude: 0.16, frequency: 1.1, seed: 62 },
};

const shotMaya: ShotModule = {
  id: "w1-maya",
  set: "gym",
  cast: ["maya"],
  start: SHOT["w1-maya"].start,
  end: SHOT["w1-maya"].end,
  enter(ctx) {
    base(ctx);
    showPlates(ctx.props.barbell, 1);
  },
  update(ctx, frame) {
    // Real time: the plate seats on the cymbal crash (local 1.0 = 2.40 s).
    const action = frame.local;
    const maya = load(ctx, 0, action, "w1", 0);
    const plate = plateWorld(welcomePlates(ctx.props.barbell)[0], point);
    evaluateCameraTrack(MAYA_TRACK, frame.local, frame.aspect, camera);
    const chest = maya.rig.bones.chest.getWorldPosition(point2);
    const focus = lerp(focusOn(camera, plate), focusOn(camera, chest), window01(1.1, 1.6, action));
    return {
      camera,
      lighting: forgeLight(ctx, 1),
      grade: grade(ctx),
      focus: { distance: focus, aperture: 2.8 },
    };
  },
  subjects(ctx) {
    const plate = plateWorld(welcomePlates(ctx.props.barbell)[0], new THREE.Vector3());
    return [plateBox("plate-1", plate, 0.225), bodyBox("maya", ctx.cast.maya, true)].filter(Boolean) as SubjectBox[];
  },
};

// ------------------------------------------------------------------------------------------------- w2-leo

const LEO_TRACK: CameraTrack = {
  // From the bar's +X side, low, the windows' shafts behind him: Leo shoves his plate home against Maya's.
  keys: [
    { t: 0, position: [2.15, 0.52, 0.55], target: [0.95, 0.66, 1.6], focal: 22, ease: "out" },
    { t: 1.28, position: [2.05, 0.56, 0.68], target: [0.95, 0.7, 1.58], focal: 23 },
  ],
  // Phones: further back and aimed between Leo and his plate, so both stay in the narrow frame.
  portrait: {
    keys: [
      { t: 0, position: [2.55, 0.62, 0.1], target: [0.95, 0.62, 1.32], focal: 22, ease: "out" },
      { t: 1.28, position: [2.45, 0.66, 0.22], target: [0.95, 0.66, 1.3], focal: 23 },
    ],
  },
  shake: { amplitude: 0.2, frequency: 1.4, seed: 63 },
};

const shotLeo: ShotModule = {
  id: "w2-leo",
  set: "gym",
  cast: ["leo"],
  start: SHOT["w2-leo"].start,
  end: SHOT["w2-leo"].end,
  enter(ctx) {
    base(ctx, shotLeo.cast);
    showPlates(ctx.props.barbell, 2);
  },
  update(ctx, frame) {
    const action = frame.local;
    const leo = load(ctx, 1, action, "w2", 0);
    evaluateCameraTrack(LEO_TRACK, frame.local, frame.aspect, camera);
    const plate = plateWorld(welcomePlates(ctx.props.barbell)[1], point);
    const head = leo.rig.bones.head.getWorldPosition(point2);
    return {
      camera,
      lighting: forgeLight(ctx, 1),
      grade: grade(ctx),
      focus: { distance: lerp(focusOn(camera, plate), focusOn(camera, head), window01(0.9, 1.2, action)), aperture: 2.4 },
    };
  },
  subjects(ctx) {
    const plate = plateWorld(welcomePlates(ctx.props.barbell)[1], new THREE.Vector3());
    return [plateBox("plate-2", plate, 0.175), bodyBox("leo", ctx.cast.leo, true)].filter(Boolean) as SubjectBox[];
  },
};

// ------------------------------------------------------------------------------------------------- w3-dre

/** Dre's clock: real time for 0.25 s, then 0.42x (the push and the seat in slow motion), so the seat lands on 5.86 s. */
const DRE_SLOW = 0.42;
export function dreAction(local: number) {
  return local <= 0.25 ? local : 0.25 + (local - 0.25) * DRE_SLOW;
}

const DRE_TRACK: CameraTrack = {
  // Floor level from the -X side, looking up at Dre over the stack, the strip light on him: the hero angle; a slow push.
  keys: [
    { t: 0, position: [-0.42, 0.2, 0.72], target: [0.94, 0.86, 1.78], focal: 20, ease: "inOut" },
    { t: 2.03, position: [-0.26, 0.23, 0.84], target: [0.94, 0.9, 1.76], focal: 21 },
  ],
  // Phones: a little higher and level, so the platform does not fill the bottom of the tall frame.
  portrait: {
    keys: [
      { t: 0, position: [-0.75, 0.42, 0.62], target: [0.94, 0.66, 1.62], focal: 20, ease: "inOut" },
      { t: 2.03, position: [-0.6, 0.45, 0.74], target: [0.94, 0.7, 1.62], focal: 21 },
    ],
  },
  shake: { amplitude: 0.08, frequency: 0.7, seed: 64 },
};

const shotDre: ShotModule = {
  id: "w3-dre",
  set: "gym",
  cast: ["dre"],
  start: SHOT["w3-dre"].start,
  end: SHOT["w3-dre"].end,
  enter(ctx) {
    base(ctx);
    showPlates(ctx.props.barbell, 3);
    // Chalk off his palms where they meet the plate (the clip's hands-on), drifting in the slow motion.
    const spec = LOADS.dre;
    const loader = LOADERS[2];
    point.set(BAR_CENTRE.x, spec.height + spec.radius * 0.6, loader.rootZ - spec.zStart + 0.05);
    ctx.fx.chalk.setLight(point2.set(0.2, 0.6, 0.8).normalize(), ctx.theme === "light" ? 0xffd6a8 : 0xffd2a0, 3.2);
    ctx.fx.chalk.setAmbient(ctx.theme === "light" ? 0xb9a690 : 0x7a5a40, 0.7);
    ctx.fx.chalk.trigger(point, point2.set(0.4, 1, -0.2).normalize(), spec.handsOn + 0.02);
  },
  update(ctx, frame) {
    const action = dreAction(frame.local);
    const dre = load(ctx, 2, action, "w3", 0);
    ctx.fx.chalk.update(action);
    evaluateCameraTrack(DRE_TRACK, frame.local, frame.aspect, camera);
    const plate = plateWorld(welcomePlates(ctx.props.barbell)[2], point);
    const head = dre.rig.bones.head.getWorldPosition(point2);
    return {
      camera,
      lighting: forgeLight(ctx, 1),
      grade: grade(ctx),
      focus: { distance: lerp(focusOn(camera, plate), focusOn(camera, head), window01(1.0, 1.5, frame.local)), aperture: 2.8 },
    };
  },
  subjects(ctx) {
    const plate = plateWorld(welcomePlates(ctx.props.barbell)[2], new THREE.Vector3());
    return [plateBox("plate-3", plate, 0.13), bodyBox("dre", ctx.cast.dre, true)].filter(Boolean) as SubjectBox[];
  },
};

// ------------------------------------------------------------------------------------------------- the team round the mark

/** Where the three stand for the crane and the ignition: beside the platform, clear of the mark, looking down at it. */
const TEAM = [
  { id: "maya" as const, x: 0.3, z: 1.62, look: [0.2, 0.05, 0.6] as const, shift: 0.6, seed: 11 },
  { id: "leo" as const, x: -0.78, z: 1.56, look: [-0.2, 0.05, 0.4] as const, shift: -0.4, seed: 29 },
  { id: "dre" as const, x: 0.35, z: -1.66, look: [0.3, 0.05, -0.5] as const, shift: 0.3, seed: 47 },
];

function team(ctx: ShotContext, time: number, key: string, start: number) {
  for (const member of TEAM) {
    const instance = show(ctx, member.id, member.x, member.z, yawToward(member.x, member.z, member.look[0], member.look[2]));
    withHair(instance, key, start, time, (t) => poseStand(instance.rig, t, { seed: member.seed, shift: member.shift }));
    point.set(member.look[0], member.look[1], member.look[2]);
    layers(instance, time, member.seed, point, 0.8);
  }
}

/** The crane's last key and the ignite shot's lens for a composition (cached: pure data per composition). */
const cranes = new Map<FilmComposition, CameraTrack>();
const TOP_RATIO = 2.2;
const TOP_HEIGHT = 4.4;

function topDown(comp: FilmComposition, ratio: number, height: number) {
  const framing = topDownFraming(comp, ratio, height);
  // 6 cm off vertical towards -X, so the horizon stays defined and screen-up is +X (camera.ts uses -Z when vertical).
  const offset = 0.06;
  return {
    position: [framing.centre.x - offset, INLAY_TOP + height, framing.centre.z] as [number, number, number],
    target: [framing.centre.x, INLAY_TOP, framing.centre.z] as [number, number, number],
    focal: framing.focal,
  };
}

function craneTrack(comp: FilmComposition): CameraTrack {
  let track = cranes.get(comp);
  if (!track) {
    const top = topDown(comp, TOP_RATIO, TOP_HEIGHT);
    track = {
      keys: [
        { t: 0, position: [-2.05, 0.95, 0.18], target: [0.7, 0.42, 0.08], focal: 24, ease: "in" },
        { t: 1.1, position: [-1.55, 2.3, 0.12], target: [0.45, 0.12, 0.05], focal: 23 },
        { t: 2.38, position: top.position, target: top.target, focal: top.focal, ease: "out" },
      ],
      // The last key is already framed per composition; no automatic portrait change on top of it.
      portrait: {},
    };
    cranes.set(comp, track);
  }
  return track;
}

const shotCrane: ShotModule = {
  id: "w4-crane",
  set: "gym",
  cast: ["maya", "leo", "dre"],
  start: SHOT["w4-crane"].start,
  end: SHOT["w4-crane"].end,
  enter(ctx) {
    base(ctx, shotCrane.cast);
    showPlates(ctx.props.barbell, 3);
  },
  update(ctx, frame) {
    team(ctx, frame.time, "w4", SHOT["w4-crane"].start);
    evaluateCameraTrack(craneTrack(ctx.composition), frame.local, frame.aspect, camera);
    // The floor lines catch the strip light one after another on the crane's hits (a sheen, not yet fire).
    const welcome = welcomeProps(ctx.sets.gym, ctx.theme);
    MARK_IGNITION_ORDER.forEach((id, index) => {
      const hit = WELCOME_BEATS.craneHits[Math.min(index >> 1, WELCOME_BEATS.craneHits.length - 1)];
      const glint = Math.exp(-(((frame.time - hit) / 0.09) ** 2)) * 0.6;
      welcome.setIgnition(id, glint > 0.01 ? 1 : 0, glint);
    });
    point.set(BAR_CENTRE.x * 0.5, INLAY_TOP, 0);
    return {
      camera,
      lighting: forgeLight(ctx, 1),
      grade: grade(ctx),
      focus: { distance: focusOn(camera, point), aperture: lerp(3.2, 5.6, window01(0, 2.38, frame.local)) },
    };
  },
  subjects(ctx) {
    const boxes: SubjectBox[] = [{ id: "mark", min: [-1.13, INLAY_TOP, -1.19], max: [1.13, INLAY_TOP + 0.45, 1.19], must: false }];
    for (const member of TEAM) {
      const box = bodyBox(member.id, ctx.cast[member.id], false);
      if (box) boxes.push(box);
    }
    return boxes;
  },
};

// ------------------------------------------------------------------------------------------------- w5-ignite

/** The lens rises from the crane's end towards the reveal's size (eased out) while the frame clears. */
function igniteCamera(comp: FilmComposition, local: number, out: CameraState) {
  const from = topDown(comp, TOP_RATIO, TOP_HEIGHT);
  const to = topDown(comp, closestRevealRatio(comp), CRANE_LIMITS.maxHeight);
  const u = 1 - (1 - window01(0, 1.7, local)) ** 2;
  out.position.fromArray(from.position).lerp(point2.fromArray(to.position), u);
  out.target.fromArray(from.target).lerp(point2.fromArray(to.target), u);
  out.focal = Math.exp(lerp(Math.log(from.focal), Math.log(to.focal), u));
  out.roll = 0;
  return out;
}

/** The frame clears to the page's background from 9.75 s, fully by 10.9 s (the reveal's mark has formed by 10.73 s). */
export function igniteClear(time: number) {
  const u = window01(WELCOME_BEATS.reveal + 0.46, WELCOME_BEATS.reveal + 1.6, time);
  return u * u * (3 - 2 * u);
}

const igniteGrades: Partial<Record<Theme, GradeParams>> = {};
function igniteGrade(ctx: ShotContext, heat: number) {
  const hot = (igniteGrades[ctx.theme] ??= { ...grade(ctx), bloomStrength: 0.95, bloomThreshold: 1.1, bloomRadius: 0.75, vignette: 0.35 });
  return mixGrades(grade(ctx), hot, heat);
}

const shotIgnite: ShotModule = {
  id: "w5-ignite",
  set: "gym",
  cast: ["maya", "leo", "dre"],
  start: SHOT["w5-ignite"].start,
  end: SHOT["w5-ignite"].end,
  enter(ctx) {
    base(ctx, shotIgnite.cast);
    showPlates(ctx.props.barbell, 3);
  },
  update(ctx, frame) {
    team(ctx, frame.time, "w5", SHOT["w5-ignite"].start);
    const welcome = welcomeProps(ctx.sets.gym, ctx.theme);
    let burning = 0;
    for (const id of MARK_IGNITION_ORDER) {
      const amount = ignitionAt(id, frame.time, WELCOME_BEATS.reveal);
      burning += amount;
      // Each line flares as it catches and settles to a steady burn; the whole mark swells to the bloom peak.
      const swell = 1 + 0.8 * Math.exp(-(((frame.time - WELCOME_BEATS.bloomPeak) / 0.35) ** 2));
      welcome.setIgnition(id, amount, (ctx.theme === "light" ? 5 : 7) * swell);
    }
    const glow = burning / MARK_IGNITION_ORDER.length;
    igniteCamera(ctx.composition, frame.local, camera);
    const clear = igniteClear(frame.time);
    point.set(0, INLAY_TOP, 0);
    return {
      camera,
      lighting: forgeLight(ctx, 1 - 0.5 * glow, glow),
      grade: igniteGrade(ctx, smoothstep(0, 0.6, glow)),
      focus: { distance: focusOn(camera, point), aperture: 5.6 },
      fade: { color: WELCOME_BRAND_BG[ctx.theme], amount: clear },
    };
  },
  subjects() {
    return [{ id: "mark", min: [-1.13, INLAY_TOP, -1.19], max: [1.13, INLAY_TOP + 0.45, 1.19], must: true }];
  },
};

/** The six shots in film order (`def.ts` builds the `FilmDef` from them). */
export const WELCOME_SHOT_MODULES: readonly ShotModule[] = [shotLight, shotMaya, shotLeo, shotDre, shotCrane, shotIgnite];

/** Staging data for the lab's projection checks and the tests (not used at runtime). */
export const WELCOME_LAB = { LIGHT_TRACK, MAYA_TRACK, LEO_TRACK, DRE_TRACK, TEAM, LOADERS, TOP_RATIO, TOP_HEIGHT, DRE_SLOW, craneTrack, igniteCamera, WELCOME_DURATION };
