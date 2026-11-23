/**
 * Act 2 — the gym (stage 3): Dre's deadlift.
 *
 *   3a-plate  match cut on the wheel: the outer bumper spins down the -X sleeve, thuds into the stack
 *             and rebounds, the collar is thrown on from off-frame and slams it home; the lens drops
 *             off the matched axis to a low 3/4 macro with the window bokeh and its shafts behind
 *   3b-chalk  real time into the clap, then 0.34× on Dre while the chalk cloud (on its own, faster
 *             clock) billows up-left through the window shaft, clear of his face; backlit MCU, focus
 *             racks from the palms to the eyes
 *   3c-pull   low hero wide on a slow crane: the wedge bows the bar over grounded plates at 0.5×, the
 *             plates break, a grind through the knee, lockout ≈7.0, the hands open and the bar drops
 *   3d-drop   low and close on the +X plates: the falling bar lands and bounces, the dust rings burst
 *             and the lens drives into the dust so the cut to the kitchen plays as a wipe
 *
 * World = gym set space; Dre stands on the platform anchor facing +Z, the bar in front of him.
 */

import * as THREE from "three";
import { BARBELL } from "../../dimensions";
import { GRADES, mixGrades, type GradeParams } from "../../fx/post";
import { LIFT_EVENTS, blinkAmount, handBindFrame, poseLift, rigMetrics, type LiftResult } from "../../motion";
import { KEY_DIRS } from "../../sets";
import { createCameraState, evaluateCameraTrack, type CameraState, type CameraTrack } from "../camera";
import type { FilmContext, Shot, ShotView } from "../shot-types";
import { smoothRamp } from "../shot-utils";
import { focusOn, gradeFor, headBox, jointsBox, lightingFor, liveLayers, pointBox, stage, window01 } from "./common";

/**
 * Dre's lift clock (driver time: clap 0.25, lift-off 1.42, lockout 2.2, release ≈2.27, plates land
 * 2.57) per shot. 3c opens in the wedge: the bar bows over grounded plates at 0.5× (the brace beat)
 * and the plates break at 6.24; from there the driver's own shape carries the weight in real time
 * (creep off the floor, grind at the knee, hips through), lockout 7.02, the hands open at 7.09 and
 * the bar is falling at the cut. 3d continues the fall in real time: the plates land at 7.39.
 */
const LIFT_CLOCK = {
  // Real time into the clap (palms meet at 5.58), then 0.34× on the body while the cloud blooms.
  chalk: smoothRamp([[5.5, 0.17], [5.58, 0.25], [6.05, 0.41]], 0.06),
  pull: smoothRamp([[6.05, 1.325], [6.25, 1.425], [7.02, 2.2], [7.25, 2.43]], 0.08),
  drop: smoothRamp([[7.25, 2.43], [7.55, 2.73]], 0.0),
} as const;

const camera = createCameraState();
const point = new THREE.Vector3();
const point2 = new THREE.Vector3();
const keyDir = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
const Y_UP = new THREE.Vector3(0, 1, 0);

const platformPosition = new THREE.Vector3();
const platformQuaternion = new THREE.Quaternion();
const platformEuler = new THREE.Euler();
let platformYaw = 0;

/** Reads the platform anchor's world pose (each shot's enter; `stageOnAnchor` allocates per call). */
function findPlatform(ctx: FilmContext) {
  const anchor = ctx.sets.gym.anchors.platform;
  anchor.updateWorldMatrix(true, false);
  anchor.getWorldPosition(platformPosition);
  platformYaw = platformEuler.setFromQuaternion(anchor.getWorldQuaternion(platformQuaternion), "YXZ").y;
}

/** Shows Dre on the platform (pose read by `findPlatform`). */
function stageDre(ctx: FilmContext) {
  return stage(ctx, "dre", platformPosition, platformYaw);
}

/** Places Dre on the platform, poses the lift and moves the barbell to the driver's bar. */
function lift(ctx: FilmContext, action: number): LiftResult {
  const dre = stageDre(ctx);
  const result = poseLift(dre.rig, action);
  dre.setHandPose("L", result.hands.L);
  dre.setHandPose("R", result.hands.R);
  liveLayers(dre, action, { seed: 23 });
  placeBar(ctx, result);
  return result;
}

/** Moves the barbell to the driver's bar (its height already carries the bow's rise over grounded plates). */
function placeBar(ctx: FilmContext, result: Pick<LiftResult, "bar" | "barBend">) {
  const { barbell } = ctx.props;
  const platform = ctx.sets.gym.anchors.platform;
  barbell.group.visible = true;
  barbell.group.position.set(platform.position.x, platform.position.y + result.bar.y, platform.position.z + result.bar.z);
  barbell.setBend(result.barBend);
}

type Lit = { setLight(d: THREE.Vector3, c: number, i: number): void; setAmbient(c: number, i: number): void };

/**
 * Lights a burst by the window key. `toward` (from the camera to the burst) pulls the light round
 * behind the cloud: the shafts come from behind it anyway, and the forward-scattering lobe is what
 * makes chalk and dust glow on film.
 */
function lightBurst(ctx: FilmContext, burst: Lit, toward: THREE.Vector3 | null, gain = 1) {
  keyDir.fromArray(ctx.theme === "light" ? KEY_DIRS.gymLight : KEY_DIRS.gymDark);
  if (toward) keyDir.lerp(toward, 0.5).normalize();
  if (ctx.theme === "light") {
    burst.setLight(keyDir, 0xffd6a8, 6 * gain);
    burst.setAmbient(0xb9a690, 0.85);
  } else {
    burst.setLight(keyDir, 0xc4d4ff, 4.6 * gain);
    burst.setAmbient(0x7a5a40, 0.8);
  }
}

/** Damped vertical camera kick for impacts (m): a pure function of time since `at`. */
function jolt(local: number, at: number, amplitude: number, hz = 16, decay = 0.045) {
  const dt = local - at;
  if (dt <= 0) return 0;
  return amplitude * Math.exp(-dt / decay) * Math.sin(dt * hz * Math.PI * 2);
}

function kick(state: CameraState, dy: number) {
  state.position.y += dy;
  state.target.y += dy * 1.6;
}

// ---------------------------------------------------------------------------------- 3a-plate

/**
 * The outer plate is thrown down the sleeve: it slides `travel` m in `home` s, losing speed to the
 * sleeve (launch `v0`, lands at `v1` ≈ 0.6 m/s), thuds into the stack, rebounds `rebound` m and sits
 * there until the collar slams it home. Spin: `spin` rad/s at the cut, stopped by the time it seats.
 */
const PLATE = { home: 0.2, travel: 0.14, v1: 0.62, rebound: 0.009, spin: 8 } as const;
/**
 * The collar is thrown on from beyond the sleeve end along the axis: shown from `show` (off-frame
 * by then, the lens has left the axis), it covers `travel` m and slams home at `home` (≈2.9 m/s),
 * shoving the plate back; the lever snaps shut by `clamp1`.
 */
const COLLAR = { show: 0.14, home: 0.3, travel: 0.6, arrive: 0.38, clamp0: 0.31, clamp1: 0.345 } as const;

/** Outward offset of the thrown plate from its seat (m) at shot time t. */
function plateOffset(t: number) {
  const { home, travel, v1, rebound } = PLATE;
  if (t < home) {
    const v0 = (2 * travel) / home - v1;
    const decel = (v0 - v1) / home;
    return travel - (v0 * t - 0.5 * decel * t * t);
  }
  // Rebound off the stack (decelerating to rest), then shoved home with the collar.
  const out = rebound * Math.sin(Math.min(1, (t - home) / 0.035) * Math.PI * 0.5);
  const shove = THREE.MathUtils.smoothstep(t, COLLAR.home - 0.012, COLLAR.home);
  const settle = 0.0018 * Math.sin(Math.min(1, Math.max(0, (t - COLLAR.home) / 0.04)) * Math.PI);
  return out * (1 - shove) + settle;
}

/** Collar distance from home (m): thrown fast, still travelling ≈`arrive` of its mean speed on impact. */
function collarOffset(t: number) {
  const u = Math.min(1, Math.max(0, (t - COLLAR.show) / (COLLAR.home - COLLAR.show)));
  // Remaining share (1-u)(1-a·u): launch speed ∝ 1+a, impact speed ∝ 1-a.
  const a = 1 - 2 * COLLAR.arrive;
  return COLLAR.travel * (1 - u) * (1 - a * u);
}

/** PLATE_TRACK's frame on each composition (BRIEF-2 3.2; checked in tests/brand/intro-framing.test.ts). */
const PLATE_COMPS: CameraTrack["compositions"] = {
  phone: { offset: [0.015, 0, 0] },
  "tablet-p": {},
  "tablet-l": { offset: [0.023, 0, 0] },
  laptop: { offset: [0, -0.022, 0] },
  desktop: { focalScale: 0.991, offset: [0, -0.024, 0] },
};

const PLATE_TRACK: CameraTrack = {
  // Opens on the plate's axis where 2b leaves the wheel (hub ≈(64 %, 57 %) of the frame, rim ≈1.9
  // half-heights, same clockwise spin), starting from rest as 2b settles. It drops and swings round
  // to a low 3/4 under the plate: the window bokeh and its shafts behind, lettering raking-lit.
  keys: [
    { t: 0, position: [-1.97, 0.28, 0.13], target: [-1.0, 0.259, 0.02], focal: 74, ease: "in" },
    // "out" after the "in": the eased segments meet at the same speed (G1, no velocity kink at the key).
    { t: 0.16, position: [-1.9, 0.2, 0.5], target: [-0.99, 0.3, -0.03], focal: 68, ease: "out" },
    { t: 0.4, position: [-1.72, 0.14, 0.93], target: [-0.98, 0.37, -0.1], focal: 61 },
  ],
  // Phones: the same match (the automatic wider lens) and arc, but the lens turns onto the plate so
  // the lettering stays whole in the narrow frame.
  portrait: {
    keys: [
      { t: 0, position: [-1.97, 0.28, 0.13], target: [-1.0, 0.259, 0.02], focal: 61, ease: "in" },
      { t: 0.16, position: [-1.9, 0.2, 0.5], target: [-0.99, 0.3, 0.07], focal: 52, ease: "out" },
      { t: 0.4, position: [-1.72, 0.14, 0.93], target: [-0.98, 0.36, 0.08], focal: 46 },
    ],
  },
  shake: { amplitude: 0.08, frequency: 1.2, seed: 41 },
  compositions: PLATE_COMPS,
};

const shotPlate: Shot = {
  id: "3a-plate",
  set: "gym",
  cast: [],
  enter(ctx) {
    placeBar(ctx, { bar: { y: BARBELL.restHeight, z: 0.082 }, barBend: 0 });
  },
  update(ctx, frame): ShotView {
    const { barbell } = ctx.props;
    const t = frame.local;
    // The -X sleeve: outward is -X; seen from -X a positive spin about +X turns clockwise like the wheel.
    const plates = barbell.plates.right;
    const outer = plates[plates.length - 1];
    outer.object.position.x = outer.restX - plateOffset(t);
    // Spinning down to rest with the lettering level as it seats.
    const spinLeft = 1 - Math.min(t, PLATE.home) / PLATE.home;
    outer.object.rotation.x = -0.5 * PLATE.spin * PLATE.home * spinLeft * spinLeft;

    const collar = barbell.collars[1];
    const restX = collar.userData.restX as number;
    collar.visible = t >= COLLAR.show;
    collar.position.x = restX - collarOffset(t) - (t > COLLAR.home ? plateOffset(t) : 0);
    barbell.setCollarClamp(window01(COLLAR.clamp0, COLLAR.clamp1, t));

    evaluateCameraTrack(PLATE_TRACK, t, frame.aspect, camera);
    kick(camera, jolt(t, PLATE.home, 0.007, 15) + jolt(t, COLLAR.home, 0.0045, 19));
    outer.object.getWorldPosition(point);
    return {
      camera,
      lighting: lightingFor(ctx, "gym", "plate"),
      grade: gymGrade(ctx),
      focus: { distance: focusOn(camera, point), aperture: 2.8, maxBlur: 0.03 },
    };
  },
  // The match cut opens with the plate's rim past the frame; its hub, and the collar once it has slammed home, stay in.
  subjects(ctx, frame) {
    const { barbell } = ctx.props;
    const plates = barbell.plates.right;
    const hub = plates[plates.length - 1].object.getWorldPosition(point);
    const boxes = [pointBox("plate-hub", hub, 0.05, true)];
    const collar = barbell.collars[1];
    if (collar.visible) boxes.push(pointBox("collar", collar.getWorldPosition(point2), [0.05, 0.05, 0.05], frame.local >= COLLAR.home));
    return boxes;
  },
};

// ---------------------------------------------------------------------------------- 3b-chalk

/** CHALK_TRACK's frame on each composition (BRIEF-2 3.2; checked in tests/brand/intro-framing.test.ts). */
const CHALK_COMPS: CameraTrack["compositions"] = {
  phone: { focalScale: 0.981 },
  "tablet-p": {},
  "tablet-l": {},
  laptop: { offset: [0, 0.012, 0] },
  desktop: {},
};

const CHALK_TRACK: CameraTrack = {
  // Low 3/4 from the right, below the palms: the window sits behind the cloud (it glows) and the burst
  // fans out up-left of the face instead of over it; slow push, ~5 % headroom under the letterbox.
  keys: [
    { t: 0, position: [1.5, 1.17, 1.92], target: [-0.06, 1.47, -0.02], focal: 58, ease: "inOut" },
    { t: 0.55, position: [1.38, 1.19, 1.75], target: [-0.06, 1.5, -0.02], focal: 59 },
  ],
  // Phones: Dre centred (no lead room to spare in a narrow frame), face to belt.
  portrait: {
    keys: [
      { t: 0, position: [1.5, 1.17, 1.92], target: [0.08, 1.46, -0.06], focal: 46, ease: "inOut" },
      { t: 0.55, position: [1.38, 1.19, 1.75], target: [0.08, 1.47, -0.06], focal: 47 },
    ],
  },
  shake: { amplitude: 0.14, frequency: 1.1, seed: 42 },
  compositions: CHALK_COMPS,
};

/** Night MCU: less bloom and deeper corners, so the window's glow doesn't haze the background mid-blue. */
const CHALK_NIGHT_GRADE: GradeParams = { ...GRADES.gymNight, contrast: 1.48, vignette: 0.5, bloomStrength: 0.15, bloomThreshold: 1.8 };

/** Film time the palms meet (LIFT_CLOCK.chalk reaches the clap). */
const CLAP_FILM = 5.585;
/**
 * The cloud's own clock (s since the clap): it billows at 2/3 speed while Dre moves at 0.34×, so
 * it is ~0.3 s old and filling the shaft by the cut instead of blooming in the last frames.
 */
const CHALK_AGE = smoothRamp([[CLAP_FILM - 0.1, -0.1], [CLAP_FILM, 0], [6.05, 0.31]], 0.04);

const palms = new THREE.Vector3();
const jet = new THREE.Vector3();
const handQ = new THREE.Quaternion();
const gazeTarget = new THREE.Vector3();

/** Midpoint between the palm centres (the wrist bones plus 0.42 hand lengths along the fingers). */
function palmCentre(dre: NonNullable<FilmContext["cast"]["dre"]>, out: THREE.Vector3) {
  out.set(0, 0, 0);
  const length = rigMetrics(dre.rig).handLength;
  for (const side of ["L", "R"] as const) {
    const bone = dre.rig.bones[`hand_${side}`];
    bone.getWorldQuaternion(handQ);
    out.add(bone.getWorldPosition(point2)).addScaledVector(point.copy(handBindFrame(dre.rig, side).finger).applyQuaternion(handQ), 0.42 * length);
  }
  return out.multiplyScalar(0.5);
}

const shotChalk: Shot = {
  id: "3b-chalk",
  set: "gym",
  cast: ["dre"],
  enter(ctx, frame) {
    placeBar(ctx, { bar: { y: BARBELL.restHeight, z: 0.082 }, barBend: 0 });
    findPlatform(ctx);
    const dre = stageDre(ctx);
    poseLift(dre.rig, LIFT_EVENTS.clapTime);
    dre.group.updateMatrixWorld(true);
    // Born a few cm under the palm centre: buoyancy carries the cloud up past the chin otherwise.
    palmCentre(dre, palms).y -= 0.035;
    // The cloud jets out in the plane across the burst axis. Palm to palm that plane stands straight
    // up into the face (the palms are just under the chin); tilting the axis up turns the upper lobe
    // toward the window side of the frame and the lower one down past his forearm.
    const left = dre.rig.bones.hand_L.getWorldPosition(point2);
    const right = dre.rig.bones.hand_R.getWorldPosition(point);
    jet.subVectors(left, right).normalize().addScaledVector(Y_UP, 0.9).normalize();
    evaluateCameraTrack(CHALK_TRACK, 0.3, frame.aspect, camera);
    lightBurst(ctx, ctx.fx.chalk, point.subVectors(palms, camera.position).normalize(), 1.15);
    ctx.fx.chalk.trigger(palms, jet, 0);
  },
  update(ctx, frame) {
    const action = LIFT_CLOCK.chalk(frame.time);
    evaluateCameraTrack(CHALK_TRACK, frame.local, frame.aspect, camera);
    // Chin level, eyes down past the lens to the bar's spot on the floor: focus, not a stare.
    lookTarget.set(0.85, 1.4, 2.6);
    gazeTarget.set(0.62, 0.95, 2.45);
    const look = window01(0.0, 0.25, frame.local);
    const dre = stageDre(ctx);
    const result = poseLift(dre.rig, action);
    dre.setHandPose("L", result.hands.L);
    dre.setHandPose("R", result.hands.R);
    liveLayers(dre, action, { seed: 23, lookAt: lookTarget, lookWeight: 0.7 * look, gaze: gazeTarget });
    // A focused squint once the palms have met.
    dre.face.setBlink(Math.max(blinkAmount(action, 23), 0.24 * window01(CLAP_FILM - 0.02, CLAP_FILM + 0.12, frame.time)));
    placeBar(ctx, result);
    ctx.fx.chalk.update(CHALK_AGE(frame.time));
    const head = dre.rig.bones.head.getWorldPosition(point);
    head.y += 0.1;
    const rack = window01(0.1, 0.4, frame.local);
    const distance = THREE.MathUtils.lerp(focusOn(camera, palms), focusOn(camera, head), rack);
    return {
      camera,
      lighting: lightingFor(ctx, "gym", "chalk"),
      grade: ctx.theme === "light" ? GRADES.gymDay : CHALK_NIGHT_GRADE,
      // f/2.2: the window grid melts into bokeh behind the cloud, but the chalk drifting near the
      // face keeps roughly the face's sharpness (the sprites take the DOF of what is behind them).
      focus: { distance, aperture: 2.2, maxBlur: 0.03 },
    };
  },
  // Dre's face and both hands through the clap.
  subjects(ctx) {
    const dre = ctx.cast.dre!;
    return [headBox(dre, "dre-face", true), jointsBox(dre, "hands", ["hand_L", "hand_R"], 0.08, true)];
  },
};

// ---------------------------------------------------------------------------------- 3c-pull

/** PULL_TRACK's frame on each composition (BRIEF-2 3.2; checked in tests/brand/intro-framing.test.ts). */
const PULL_COMPS: CameraTrack["compositions"] = {
  phone: { focalScale: 0.782, distanceScale: 1.292 },
  "tablet-p": { distanceScale: 1.164 },
  "tablet-l": { distanceScale: 1.115, offset: [-0.45, 0, 0] },
  laptop: { offset: [-0.412, 0, 0] },
  desktop: { offset: [-0.15, 0, 0] },
};

const PULL_TRACK: CameraTrack = {
  // Low 3/4 front-right on 22 mm, craning up with the bar; Dre left of centre so the PR callout
  // (upper right) stays clear, with headroom inside the letterbox at lockout. Panned right enough
  // that the far hanging lamp stays out of the top-left corner (its bulb bloomed there at night).
  keys: [
    { t: 0, position: [1.15, 0.16, 2.45], target: [0.55, 0.7, -0.1], focal: 22, ease: "inOut" },
    { t: 1.2, position: [1.0, 0.5, 2.2], target: [0.52, 1.24, -0.1], focal: 22 },
  ],
  // Phones: further round and back on a longer lens, so the loaded bar still fits the narrow frame
  // and Dre fills half its height instead of standing small under the ceiling.
  portrait: {
    keys: [
      { t: 0, position: [1.85, 0.2, 2.75], target: [0.05, 0.72, 0.0], focal: 29, ease: "inOut" },
      { t: 1.2, position: [1.68, 0.55, 2.5], target: [0.04, 1.02, 0.0], focal: 29 },
    ],
  },
  shake: { amplitude: 0.1, frequency: 0.8, seed: 43 },
  compositions: PULL_COMPS,
};

const shotPull: Shot = {
  id: "3c-pull",
  set: "gym",
  cast: ["dre"],
  enter(ctx) {
    findPlatform(ctx);
  },
  update(ctx, frame) {
    const action = LIFT_CLOCK.pull(frame.time);
    lift(ctx, action);
    evaluateCameraTrack(PULL_TRACK, frame.local, frame.aspect, camera);
    const chest = ctx.cast.dre!.rig.bones.chest.getWorldPosition(point);
    return {
      camera,
      lighting: lightingFor(ctx, "gym", "hero"),
      grade: gymGrade(ctx),
      focus: { distance: focusOn(camera, chest), aperture: 4 },
    };
  },
  // The whole loaded bar (plate rims included) and Dre's face.
  subjects(ctx) {
    const { barbell } = ctx.props;
    barbell.group.getWorldPosition(point);
    // The plates are discs: a world box at 0.75 of their radius bounds what a 3/4 view shows of them.
    const rim = (BARBELL.plates[0].diameter / 2) * 0.75;
    return [pointBox("bar", point, [BARBELL.length / 2, rim, rim], true, false), headBox(ctx.cast.dre!, "dre-face", true)];
  },
};

// ---------------------------------------------------------------------------------- 3d-drop

/** DROP_TRACK's frame on each composition (BRIEF-2 3.2; checked in tests/brand/intro-framing.test.ts). */
const DROP_COMPS: CameraTrack["compositions"] = {
  phone: {},
  "tablet-p": {},
  "tablet-l": {},
  laptop: {},
  desktop: {},
};

const DROP_TRACK: CameraTrack = {
  // Floor level off the +X plates: the released bar falls into the top of frame and lands at 0.14;
  // then the lens drops to 5 cm and drives through the chalk knocked off the platform into the dust
  // rolling off the plates, so the cut to the kitchen lands inside the cloud.
  keys: [
    { t: 0, position: [1.75, 0.16, 1.25], target: [0.7, 0.34, 0.1], focal: 24 },
    { t: 0.14, position: [1.67, 0.13, 1.16], target: [0.72, 0.27, 0.12], focal: 23, ease: "in" },
    { t: 0.3, position: [1.32, 0.05, 0.8], target: [0.86, 0.07, 0.18], focal: 20 },
  ],
  // Phones: a wider lens tilted up, so the tall frame shows Dre and the falling bar over less floor.
  portrait: {
    keys: [
      { t: 0, position: [1.75, 0.16, 1.25], target: [0.7, 0.52, 0.1], focal: 19 },
      { t: 0.14, position: [1.67, 0.13, 1.16], target: [0.72, 0.44, 0.12], focal: 18.5, ease: "in" },
      { t: 0.3, position: [1.32, 0.05, 0.8], target: [0.86, 0.14, 0.18], focal: 16.5 },
    ],
  },
  shake: { amplitude: 0.3, frequency: 2.4, seed: 44 },
  compositions: DROP_COMPS,
};

/** Film-local time of the impact in 3d (LIFT_CLOCK.drop reaches the drop time here). */
const DROP_IMPACT = 0.14;

/**
 * The lens inside lit dust: contrast collapses, blacks lift toward the dust colour and the
 * highlights are held down (a wipe, not a white flash). With `DUST_VEIL` as a partial fade.
 */
const DUST_GRADE: Record<"light" | "dark", GradeParams> = {
  light: { ...GRADES.gymDay, contrast: 0.94, saturation: 0.82, lift: [0.12, 0.1, 0.075], gain: [0.93, 0.89, 0.82], bloomStrength: 0.2, bloomThreshold: 2.6 },
  dark: { ...GRADES.gymNight, contrast: 1.0, saturation: 0.75, lift: [0.07, 0.08, 0.1], gain: [0.78, 0.81, 0.88], bloomStrength: 0.2, bloomThreshold: 1.8 },
};
/** Dust colour the veil settles on: warm chalk by day, grey-blue moonlit dust by night. */
const DUST_VEIL = { light: 0xcbb99d, dark: 0x7c879b } as const;

const shotDrop: Shot = {
  id: "3d-drop",
  set: "gym",
  cast: ["dre"],
  enter(ctx, frame) {
    const { barbell } = ctx.props;
    const platform = ctx.sets.gym.anchors.platform;
    findPlatform(ctx);
    // Where the dropped bar lands (pushed a little forward of where it was pulled from).
    const landing = poseLift(ctx.cast.dre!.rig, LIFT_EVENTS.dropTime).bar.z;
    placeBar(ctx, { bar: { y: BARBELL.restHeight, z: landing }, barBend: 0 });
    barbell.group.updateMatrixWorld(true);
    evaluateCameraTrack(DROP_TRACK, 0.22, frame.aspect, camera);
    const stacks = [barbell.plates.left, barbell.plates.right];
    stacks.forEach((plates, index) => {
      const middle = plates[Math.floor(plates.length / 2)].object.getWorldPosition(point);
      middle.y = platform.position.y;
      const burst = ctx.fx.dust[index];
      lightBurst(ctx, burst, point2.subVectors(middle, camera.position).normalize());
      burst.trigger(middle, Y_UP, LIFT_EVENTS.dropTime);
    });
    // Chalk dust shaken off the platform by the impact, between the lens and the near plates (the
    // chalk burst is idle after 3b): it rolls over the lens and turns the push-in into a wipe.
    const residue = point.set(1.11, platform.position.y + 0.01, 0.52);
    lightBurst(ctx, ctx.fx.chalk, point2.subVectors(residue, camera.position).normalize(), 0.75);
    ctx.fx.chalk.trigger(residue, Y_UP, LIFT_EVENTS.dropTime + 0.012);
  },
  update(ctx, frame) {
    const action = LIFT_CLOCK.drop(frame.time);
    lift(ctx, action);
    for (const burst of ctx.fx.dust) burst.update(action);
    ctx.fx.chalk.update(action);
    evaluateCameraTrack(DROP_TRACK, frame.local, frame.aspect, camera);
    kick(camera, jolt(frame.local, DROP_IMPACT, 0.012, 11, 0.06));
    point.set(0.84, 0.2, 0.16);
    // Inside the cloud the dust veils the lens: the cut to the kitchen lands on it.
    const veil = window01(0.19, 0.3, frame.local);
    return {
      camera,
      lighting: lightingFor(ctx, "gym", "drop"),
      grade: veil > 0 ? mixGrades(gymGrade(ctx), DUST_GRADE[ctx.theme], veil) : gymGrade(ctx),
      focus: { distance: focusOn(camera, point), aperture: 2.8 },
      fade: { color: DUST_VEIL[ctx.theme], amount: 0.56 * veil * veil },
    };
  },
  // The landing plates until the lens drives into the dust (the cut is a wipe).
  subjects(ctx, frame) {
    const plates = ctx.props.barbell.plates.left;
    const stack = plates[Math.floor(plates.length / 2)].object.getWorldPosition(point);
    return [pointBox("landing-plates", stack, [0.18, 0.22, 0.22], frame.local >= DROP_IMPACT && frame.local < 0.19, false)];
  },
};

function gymGrade(ctx: FilmContext) {
  return gradeFor(ctx.theme, "gymDay", "gymNight");
}

export const ACT2_SHOTS: Shot[] = [shotPlate, shotChalk, shotPull, shotDrop];

/** Staging data for the lab's projection checks (framing vs overlay zones); not used at runtime. */
export const ACT2_LAB = { PLATE_TRACK, CHALK_TRACK, PULL_TRACK, DROP_TRACK, LIFT_CLOCK, PLATE, COLLAR, CLAP_FILM, DROP_IMPACT };
