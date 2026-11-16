/**
 * Act 1 — the track (stages 0–2): Maya's sprint start and Leo's ride.
 *
 *   0-set       ground-level product macro on Maya's right shoe at the line, front 3/4 so the toe
 *               box and lace row lead; the low sun (night: a low distant flood) sits just over the
 *               lace row. The heel lifts, the rear leg drives past, the toe pushes off and the grit
 *               hangs in slow-mo as the light floods the empty frame
 *   1a-drive    3/4-side tracking at hip height from the bike-lane side (she runs right→left),
 *               backlit with the sun at the frame edge and a warm rim on her back (0.55× → 1×)
 *   1b-stride   a lead car ~6 m ahead and above her eye-line, so her stride stays above the TRAIN
 *               title; Leo overtakes on the bike lane, the operator hands over to him and his
 *               jersey wipes the lens (pan blur that carries on into 2a)
 *   2a-cadence  low tracking on the drive side: chainring, cranks, the right leg pumping
 *   2b-wheel    head-on on Leo (he lifts his head and the mirrored lenses catch the light), then one
 *               continuous crane arc round and down into the front wheel, which slows until the
 *               spokes resolve: its circle lands where 3a's plate is
 *
 * World = track set space (origin at the start line of lane 4, running +Z). Screen direction:
 * 0-set and 1a run right→left; 1b is head-on and pans right with Leo, so 2a runs left→right on
 * the drive side; 2b is head-on (neutral) into the match cut.
 */

import * as THREE from "three";
import { CAST } from "../../character/cast";
import { BIKE } from "../../dimensions";
import { GRADES, type GradeParams } from "../../fx/post";
import type { LightingPreset } from "../../lighting";
import { poseRide, poseSprint, sprintFootfalls, sprintStartZ, type Footfall, type SprintResult } from "../../motion";
import { computeBindPose } from "../../rig/skeleton";
import { createRig } from "../../rig/three-rig";
import { KEY_DIRS, TRACK_KEY_MAST, TRACK_NIGHT_MACRO_KEY } from "../../sets/presets";
import { createCameraState, evaluateCameraTrack, whipBlurVector, type CameraState, type CameraTrack } from "../camera";
import type { FilmContext, Shot, ShotFrame, ShotView } from "../shot-types";
import { smoothRamp, timeRamp } from "../shot-utils";
import { focusOn, followLighting, followTrack, gradeFor, liveLayers, poseWithHair, stage, window01 } from "./common";

/** Rubber kicked back off a toe-off. The 0-set kick is cheated upward so it sprays across the macro frame. */
const GRIT_KICK = new THREE.Vector3(0, 0.55, -1);
const SET_GRIT_KICK = new THREE.Vector3(-0.25, 1.0, -0.7);
const BIKE_LANE_X = 6.4;
/** Maya runs in lane 8, the one beside the bike lane, so Leo can overtake her close to the 1b lens. */
const MAYA_X = 4 * 1.22;
const WHEEL_ROLL_RADIUS = BIKE.wheelRadius + BIKE.tireRadius;

/** Maya's action clock (sprint time; 0 = push-off) per shot, as a function of film time. */
const SPRINT_CLOCK = {
  // Hold the set, a tense slow heel lift, an explosive over-cranked "go" (the rear leg drives
  // past the lens), then slam into ~0.3× through the right toe-off (0.33, film ≈ 1.07) so the
  // foot leaves and the grit hangs in the backlight for the last frames.
  set: smoothRamp([[0, -0.62], [0.3, -0.32], [0.72, -0.02], [0.88, 0.27], [1.3, 0.4]], 0.1),
  drive: smoothRamp([[1.3, 0.38], [1.72, 0.61], [2.35, 1.22]], 0.15),
  stride: timeRamp([[2.35, 1.22], [3.5, 2.37]]),
} as const;

/**
 * Leo's ride clock from 2a: real time, then a long ease into slow-mo so the 2b spokes resolve.
 * The last slope (0.24×) spins the wheel at ≈ 7.8 rad/s at the cut: 3a's plate leaves at 8.
 */
const RIDE_CLOCK = smoothRamp([[3.5, 3.5], [4.7, 4.7], [4.95, 4.81], [5.1, 4.846]], 0.14);
/** 1b: Leo sprints past Maya (faster than his cruise) and his bike reaches the lens plane at the cut. */
const LEO_PASS_TIME = 3.5;
/** Bike origin (bottom bracket) in front of the 1b lens at LEO_PASS_TIME: his jersey fills the frame. */
const LEO_PASS_GAP = 0.25;
const LEO_OVERTAKE_SPEED = 13.5;
const LEO_OVERTAKE_RPM = 108;
/** Leo's riding pose, bike space: the head bone and the mirrored lenses in front of it. */
const LEO_HEAD = { y: 1.494, z: 0.247 } as const;

interface SprintFacts {
  /** Maya's set-position root z (model space; the group sits on the line). */
  startZ: number;
  /** Her root z and speed at the 1b cut. */
  passRootZ: number;
  passSpeed: number;
  /** Leo's bike z at the 1b cut. */
  leoPassZ: number;
}
let facts: SprintFacts | null = null;

/**
 * Sprint geometry, measured once on a private bind-pose rig (the film builds Maya's rig from the
 * same proportions), so Leo's shots never need Maya generated or posed.
 */
function sprintFacts(): SprintFacts {
  if (facts) return facts;
  const rig = createRig(computeBindPose(CAST.maya.proportions));
  const startZ = sprintStartZ(rig);
  const pass = poseSprint(rig, SPRINT_CLOCK.stride(LEO_PASS_TIME));
  const passRootZ = startZ + pass.distance;
  // Portrait keys share the landscape lens path at the cut, so one pass point serves both.
  const lens = evaluateCameraTrack(STRIDE_TRACK, LEO_PASS_TIME - 2.35, 16 / 9, createCameraState()).position.z;
  facts = { startZ, passRootZ, passSpeed: pass.speed, leoPassZ: passRootZ + lens - LEO_PASS_GAP };
  return facts;
}

/** Leo's bike-lane z at film time `time`: the 1b overtake, then the cruise (slowed by the ride clock). */
function leoZ(time: number) {
  const pass = sprintFacts().leoPassZ;
  if (time < 3.5) return pass + LEO_OVERTAKE_SPEED * (time - LEO_PASS_TIME);
  return pass + LEO_OVERTAKE_SPEED * (3.5 - LEO_PASS_TIME) + BIKE.speed * (RIDE_CLOCK(time) - RIDE_CLOCK(3.5));
}

const camera = createCameraState();
const previous = createCameraState();
const origin = new THREE.Vector3();
const point = new THREE.Vector3();
const point2 = new THREE.Vector3();
const look = new THREE.Vector3();

/** Poses Maya's sprint (with ponytail); returns the driver result (her root z = startZ + distance). */
function sprintPose(ctx: FilmContext, key: string, start: number, action: number): SprintResult {
  const maya = ctx.cast.maya!;
  const result = poseWithHair(maya, key, start, action, (time) => poseSprint(maya.rig, time));
  maya.setHandPose("L", result.hands.L);
  maya.setHandPose("R", result.hands.R);
  liveLayers(maya, action, { seed: 3 });
  return result;
}

/** Triggers grit bursts for the first toe-offs inside [from, to] (sprint time). */
function triggerGrit(ctx: FilmContext, from: number, to: number, kick = GRIT_KICK) {
  const maya = ctx.cast.maya!;
  const falls: Footfall[] = sprintFootfalls(maya.rig, undefined, to + 0.5).filter((fall) => fall.toeOff >= from && fall.toeOff <= to);
  ctx.fx.grit.forEach((burst, index) => {
    const fall = falls[index];
    if (!fall) return;
    point.copy(fall.position).applyMatrix4(maya.group.matrixWorld);
    point.y = 0.004;
    burst.trigger(point, kick, fall.toeOff);
  });
}

function updateGrit(ctx: FilmContext, action: number) {
  for (const burst of ctx.fx.grit) burst.update(action);
}

/** Places Leo and the bike at `z`, pedalling at `clock` (action seconds) and `rpm`; optional head look. */
function rideBike(ctx: FilmContext, z: number, clock: number, rpm: number, blurRate: number, lookAt?: THREE.Vector3, lookWeight = 0) {
  const leo = ctx.cast.leo!;
  stage(ctx, "leo", { x: BIKE_LANE_X, y: 0, z });
  const bike = ctx.props.bike;
  bike.group.visible = true;
  bike.group.position.set(BIKE_LANE_X, 0, z);
  bike.group.rotation.set(0, 0, 0);
  const result = poseRide(leo.rig, clock, { cadenceRpm: rpm });
  leo.setHandPose("L", result.hands.L);
  leo.setHandPose("R", result.hands.R);
  liveLayers(leo, clock, { seed: 11, lookAt, lookWeight });
  bike.setCrankAngle(result.crankAngle);
  bike.setWheelAngle(z / WHEEL_ROLL_RADIUS);
  // Real spokes blur at speed; the spokes only resolve once the slow-mo is slow enough (~0.2×,
  // < 1/2 of the spoke pitch per 60 Hz frame) not to strobe.
  bike.setSpinBlur(THREE.MathUtils.clamp((blurRate - 0.2) / 0.25, 0, 1) * 0.85);
  return result;
}

/** The 2a/2b ride: cruise speed on the ride clock. */
function cruise(ctx: FilmContext, time: number, lookAt?: THREE.Vector3, lookWeight = 0) {
  const z = leoZ(time);
  const rate = (RIDE_CLOCK(time + 0.02) - RIDE_CLOCK(time - 0.02)) / 0.04;
  rideBike(ctx, z, RIDE_CLOCK(time), BIKE.cadenceRpm, rate, lookAt, lookWeight);
  return z;
}

/**
 * Parks the flare (the track's `sun` anchor) for this shot: the sun by day; at night the key mast,
 * or for the macro the low distant flood that keys it (`TRACK_NIGHT_MACRO_KEY`), or `night` when a
 * shot shows a different flood. Set every frame so seeking never depends on which shot moved it last.
 */
function placeFlare(ctx: FilmContext, macro = false, night?: THREE.Vector3Like) {
  const anchor = ctx.sets.track.anchors.sun;
  if (ctx.theme === "light") anchor.position.fromArray(KEY_DIRS.trackLight).multiplyScalar(1000);
  else if (macro) anchor.position.fromArray(TRACK_NIGHT_MACRO_KEY).multiplyScalar(160).add(point.set(MAYA_X, 0, 0));
  else if (night) anchor.position.set(night.x, night.y, night.z);
  else anchor.position.fromArray(TRACK_KEY_MAST);
}

function trackGrade(ctx: FilmContext) {
  return gradeFor(ctx.theme, "trackSunrise", "trackNight");
}

function rideGrade(ctx: FilmContext) {
  return gradeFor(ctx.theme, "rideSunrise", "rideNight");
}

// ---------------------------------------------------------------------------------- 0-set

/**
 * 3 cm off the tartan, front 3/4 on the right shoe and looking back into the sun: the toe box
 * and the lace row lead (the side panel foreshortens), the start line runs under the toe and
 * the sun sits in the gap over the laces, in front of the shin, rimming both (that low a lens
 * is what drops the sun into the gap). The rear foot is a soft shape at frame right and whips
 * past the lens; the toe pushes off and leaves through the top while the grit hangs and the
 * light floods in.
 */
const SET_TRACK: CameraTrack = {
  keys: [
    { t: 0, position: [MAYA_X + 0.335, 0.03, 0.488], target: [MAYA_X - 0.12, 0.1, -0.28], focal: 38, ease: "inOut" },
    { t: 1.3, position: [MAYA_X + 0.288, 0.028, 0.416], target: [MAYA_X - 0.12, 0.098, -0.27], focal: 40 },
  ],
  shake: { amplitude: 0.06, frequency: 0.7, seed: 4 },
  // Portrait: no room for the rear foot; a longer lens fills the narrow frame with the hero shoe,
  // the sun over the laces and the shin rising above it.
  portrait: {
    keys: [
      { t: 0, position: [MAYA_X + 0.335, 0.03, 0.488], target: [MAYA_X - 0.1, 0.13, -0.14], focal: 40, ease: "inOut" },
      { t: 1.3, position: [MAYA_X + 0.288, 0.028, 0.416], target: [MAYA_X - 0.1, 0.13, -0.14], focal: 42 },
    ],
  },
};

/** Screen-space smear of the rear foot's pass (frame heights; it travels left and a little down). */
const REAR_FOOT_SMEAR: [number, number] = [-0.07, -0.012];
/** Without DOF (medium tier) the macro's background is crisp: thicken the haze and close the vignette so it still falls away. */
const MACRO_FLAT_HAZE: Record<"light" | "dark", number> = { light: 0.022, dark: 0.05 };
const macroFlatGrade: Record<"light" | "dark", GradeParams> = {
  light: { ...GRADES.trackSunrise, vignette: 0.42 },
  dark: { ...GRADES.trackNight, vignette: 0.55 },
};

function setLighting(ctx: FilmContext): LightingPreset {
  const lighting = followLighting(ctx, "track", "macro", { x: MAYA_X, y: 0, z: 0 });
  if (!ctx.quality.dof) lighting.fog = { color: lighting.fog.color, density: MACRO_FLAT_HAZE[ctx.theme] };
  return lighting;
}

const shotSet: Shot = {
  id: "0-set",
  set: "track",
  cast: ["maya"],
  enter(ctx) {
    stage(ctx, "maya", { x: MAYA_X, y: 0, z: 0 });
    triggerGrit(ctx, 0.2, 0.5, SET_GRIT_KICK);
    // Night: brighter than the masts' default so the flood reads as a lamp; any more and the
    // flare's halo ring lands across the shoe.
    ctx.fx.flare.setIntensity(ctx.theme === "light" ? 1 : 0.8);
  },
  update(ctx, frame): ShotView {
    placeFlare(ctx, true);
    const action = SPRINT_CLOCK.set(frame.time);
    sprintPose(ctx, "0-set", SPRINT_CLOCK.set(0), action);
    updateGrit(ctx, action);
    evaluateCameraTrack(SET_TRACK, frame.local, frame.aspect, camera);
    // Focus on the lace row (between the ball and the ankle, on top of the shoe): at f/4 the toe
    // and heel hold while the rear foot and the sunrise fall apart into soft shapes.
    const bones = ctx.cast.maya!.rig.bones;
    const laces = bones.toe_R.getWorldPosition(point).lerp(bones.foot_R.getWorldPosition(point2), 0.55);
    laces.y += 0.03;
    const flat = !ctx.quality.dof;
    return {
      camera,
      lighting: setLighting(ctx),
      grade: flat ? macroFlatGrade[ctx.theme] : trackGrade(ctx),
      // Night: a smaller bokeh cap keeps the stars from turning into sample rosettes.
      focus: { distance: focusOn(camera, laces), aperture: 4, maxBlur: ctx.theme === "light" ? 0.04 : 0.018 },
      // The rear foot whips past the lens right→left in two frames: smear it like a 180° shutter would.
      whip: { direction: REAR_FOOT_SMEAR, amount: window01(0.79, 0.84, frame.time) * (1 - window01(0.88, 0.94, frame.time)) },
    };
  },
};

// ---------------------------------------------------------------------------------- 1a-drive

/**
 * Relative to Maya's smoothed root: ahead of her on the bike lane, looking back across the lanes
 * into the sun. Framed low enough that her foot strikes and the long shadow toward the lens sit
 * above the bottom matte, and far enough right that the TRAIN title (lower left) reads on empty track.
 */
const DRIVE_TRACK: CameraTrack = {
  keys: [
    { t: 0, position: [2.6, 0.72, 2.35], target: [-0.6, 0.7, 1.05], focal: 26, ease: "inOut" },
    { t: 1.05, position: [2.5, 0.8, 2.25], target: [-0.65, 0.76, 1.0], focal: 27 },
  ],
  shake: { amplitude: 0.32, frequency: 2.4, seed: 12 },
  // A tall frame has no room for lead space: aim at her, a little more side-on, and a touch
  // behind her so the front foot stays right of the TRAIN zone.
  portrait: {
    keys: [
      { t: 0, position: [2.75, 0.72, 1.75], target: [0, 0.8, 0.26], focal: 30, ease: "inOut" },
      { t: 1.05, position: [2.65, 0.8, 1.65], target: [0, 0.86, 0.22], focal: 31 },
    ],
  },
};

/**
 * Night 1a looks across the whole infield, away from every mast: a distant flood glowing over the
 * far trees gives the frame a light source (and the stadium its scale) instead of a park at dusk.
 */
const NIGHT_FAR_FLOOD = new THREE.Vector3(-96, 18, 2);

const shotDrive: Shot = {
  id: "1a-drive",
  set: "track",
  cast: ["maya"],
  enter(ctx) {
    stage(ctx, "maya", { x: MAYA_X, y: 0, z: 0 });
    triggerGrit(ctx, SPRINT_CLOCK.drive(1.3), SPRINT_CLOCK.drive(2.35));
    ctx.fx.flare.setIntensity(ctx.theme === "light" ? 0.9 : 0.6);
  },
  update(ctx, frame) {
    placeFlare(ctx, false, NIGHT_FAR_FLOOD);
    const action = SPRINT_CLOCK.drive(frame.time);
    const sprint = sprintPose(ctx, "1a-drive", SPRINT_CLOCK.drive(1.3), action);
    updateGrit(ctx, action);
    origin.set(MAYA_X, 0, sprintFacts().startZ + sprint.distance);
    followTrack(DRIVE_TRACK, frame.local, frame.aspect, origin, camera);
    const hips = ctx.cast.maya!.rig.bones.hips.getWorldPosition(point);
    return {
      camera,
      lighting: followLighting(ctx, "track", "side", point2.set(MAYA_X, 0, origin.z - 5)),
      grade: trackGrade(ctx),
      focus: { distance: focusOn(camera, hips), aperture: 2 },
    };
  },
};

// ---------------------------------------------------------------------------------- 1b-stride

/**
 * Relative to Maya's root: a lead car on the inner edge of the bike lane (0.45 m inside Leo's
 * line, ~0.2 m by the cut), ~6 m ahead of her with the lens at Leo's helmet height, looking down the lanes: her whole
 * stride sits above the TRAIN title, Leo grows from a speck behind her to frame-filling, and as he
 * closes in his head stays on the same line in frame (it never rises into the top matte).
 */
const STRIDE_TRACK: CameraTrack = {
  keys: [
    { t: 0, position: [1.07, 1.7, 6.4], target: [0.45, 0.44, 0], focal: 30, ease: "inOut" },
    // The car edges toward Leo's line as he arrives, so his jersey passes right by the lens.
    { t: 0.85, position: [1.09, 1.7, 6.12], target: [0.42, 0.44, -0.3], focal: 30 },
    { t: 1.15, position: [1.27, 1.68, 6.0], target: [0.4, 0.44, -0.4], focal: 30 },
  ],
  shake: { amplitude: 0.42, frequency: 2.1, seed: 21 },
  // Phones: the callouts sit over a tall, narrow frame. Same lens path (Leo's pass point is shared),
  // panned toward the bike lane and tilted up so Leo's face runs under PACE and Maya's feet stay
  // above TRAIN.
  portrait: {
    keys: [
      { t: 0, position: [1.07, 1.7, 6.4], target: [0.94, 1.12, 0], focal: 25, ease: "inOut" },
      { t: 0.85, position: [1.09, 1.7, 6.12], target: [0.91, 1.12, -0.3], focal: 25 },
      { t: 1.15, position: [1.27, 1.68, 6.0], target: [0.9, 1.12, -0.4], focal: 25 },
    ],
  },
};
/**
 * The operator picks Leo up as he draws level with Maya: first a pan that holds his face left of
 * the PACE callout (Maya slides out of frame left), then the tilt once she has gone (`hold`: where
 * his face sits, fractions of the half-frame from centre, + = right / up); for the last frames the
 * aim drops onto his chest, so the dark jersey wipes the whole lens.
 */
const STRIDE_FOLLOW = { yawFrom: 2.75, yawTo: 3.3, pitchFrom: 3.24, pitchTo: 3.4, chestFrom: 3.37, chestTo: 3.47 } as const;
const LEO_HOLD = { landscape: { x: 0.18, y: 0.32 }, portrait: { x: 0.2, y: 0.08 } } as const;
const strideOrigin = new THREE.Vector3();
const aim = new THREE.Vector3();

/** Yaw (about +Y, 0 = +Z) and pitch of the direction from `from` to `to`. */
function aimAngles(from: THREE.Vector3, to: THREE.Vector3) {
  aim.subVectors(to, from);
  return { yaw: Math.atan2(aim.x, aim.z), pitch: Math.atan2(aim.y, Math.hypot(aim.x, aim.z)), distance: aim.length() };
}

/** 1b camera at film `time` around Maya's root z `rootZ`, following Leo at the end. */
function strideCamera(time: number, rootZ: number, aspect: number, out: CameraState) {
  strideOrigin.set(MAYA_X, 0, rootZ);
  followTrack(STRIDE_TRACK, time - 2.35, aspect, strideOrigin, out);
  const panW = window01(STRIDE_FOLLOW.yawFrom, STRIDE_FOLLOW.yawTo, time);
  if (panW <= 0) return out;
  const tiltW = window01(STRIDE_FOLLOW.pitchFrom, STRIDE_FOLLOW.pitchTo, time);
  const chestW = window01(STRIDE_FOLLOW.chestFrom, STRIDE_FOLLOW.chestTo, time);
  const base = aimAngles(out.position, out.target);
  const z = leoZ(time);
  // Aim off his face by the hold angles, so the face itself lands at the hold position.
  const face = aimAngles(out.position, look.set(BIKE_LANE_X, LEO_HEAD.y, z + LEO_HEAD.z));
  const tanV = 36 / Math.max(aspect, 1) / 2 / out.focal;
  const hold = aspect < 1 ? LEO_HOLD.portrait : LEO_HOLD.landscape;
  let yaw = face.yaw + Math.atan(hold.x * tanV * aspect);
  let pitch = face.pitch - Math.atan(hold.y * tanV);
  const chest = aimAngles(out.position, look.set(BIKE_LANE_X, 1.28, z));
  yaw += (chest.yaw - yaw) * chestW;
  pitch += (chest.pitch - pitch) * chestW;
  // Shortest way round, then blend: pan first, tilt later.
  const turn = Math.atan2(Math.sin(yaw - base.yaw), Math.cos(yaw - base.yaw));
  yaw = base.yaw + turn * panW;
  pitch = base.pitch + (pitch - base.pitch) * Math.max(tiltW, chestW);
  out.target.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(base.distance).add(out.position);
  return out;
}

const shotStride: Shot = {
  id: "1b-stride",
  set: "track",
  cast: ["maya", "leo"],
  enter(ctx) {
    stage(ctx, "maya", { x: MAYA_X, y: 0, z: 0 });
    ctx.fx.flare.setIntensity(ctx.theme === "light" ? 0.8 : 0.45);
  },
  update(ctx, frame) {
    placeFlare(ctx);
    const action = SPRINT_CLOCK.stride(frame.time);
    const sprint = sprintPose(ctx, "1b-stride", SPRINT_CLOCK.stride(2.35), action);
    const rootZ = sprintFacts().startZ + sprint.distance;
    const z = leoZ(frame.time);
    rideBike(ctx, z, frame.time, LEO_OVERTAKE_RPM, 1.2);
    strideCamera(frame.time, rootZ, frame.aspect, camera);
    // A frame earlier (the stride clock runs at 1×) for the whip blur; no re-posing needed.
    strideCamera(frame.time - 1 / 60, rootZ - sprint.speed / 60, frame.aspect, previous);
    const chest = ctx.cast.maya!.rig.bones.chest.getWorldPosition(point);
    const head = ctx.cast.leo!.rig.bones.head.getWorldPosition(point2);
    // Rack focus from Maya to Leo as he draws level with her.
    const rack = window01(2.85, 3.15, frame.time);
    const focus = THREE.MathUtils.lerp(focusOn(camera, chest), focusOn(camera, head), rack);
    // The follow keeps Leo sharp (a screen-space whip would smear him too), so the pan blur only
    // builds over the last frames as his jersey fills the lens: the transition into 2a.
    const whip = whipBlurVector(previous, camera, 1 / 60, ctx.camera);
    return {
      camera,
      lighting: followLighting(ctx, "track", "front", point.set(MAYA_X - 1.5, 0, rootZ - 9)),
      grade: trackGrade(ctx),
      focus: { distance: focus, aperture: 2.2 },
      whip: { direction: whip, amount: window01(3.38, 3.49, frame.time) },
    };
  },
};

/** The 1b camera's pan blur at its cut (frame heights), carried into the first frames of 2a. */
function strideExitWhip(ctx: FilmContext, aspect: number): [number, number] {
  const { passRootZ, passSpeed } = sprintFacts();
  strideCamera(3.5 - 1 / 60, passRootZ - passSpeed / 60, aspect, previous);
  strideCamera(3.5, passRootZ, aspect, camera);
  return whipBlurVector(previous, camera, 1 / 60, ctx.camera);
}

// ---------------------------------------------------------------------------------- 2a-cadence

/**
 * Relative to the bike: pedal height on the drive side (−X), drifting forward past the crank. A
 * 24 mm lens a metre off: chainring, crank and the pumping leg with both wheels, the frame bottom
 * on the contact patches so no crisp near asphalt crawls under the move.
 */
const CADENCE_TRACK: CameraTrack = {
  keys: [
    { t: 0, position: [-1.08, 0.3, 0.3], target: [0.0, 0.43, -0.06], focal: 24, ease: "inOut" },
    { t: 0.85, position: [-1.0, 0.28, 0.06], target: [0.12, 0.43, -0.06], focal: 25 },
  ],
  // A car mount at 40 km/h: a quicker, finer buzz than a handheld.
  shake: { amplitude: 0.3, frequency: 3.4, seed: 31 },
  // Portrait: the chainring centred, the pumping leg above it.
  portrait: {
    keys: [
      { t: 0, position: [-1.08, 0.3, 0.2], target: [0, 0.44, 0.02], focal: 21, ease: "inOut" },
      { t: 0.85, position: [-1.0, 0.3, 0.02], target: [0, 0.45, 0.0], focal: 22 },
    ],
  },
};
/** 1b's whip carries into 2a and dies within a couple of frames (out of the wipe, not into it). */
const CADENCE_WHIP_IN = 0.07;

const shotCadence: Shot = {
  id: "2a-cadence",
  set: "track",
  cast: ["leo"],
  enter(ctx) {
    ctx.fx.flare.setIntensity(ctx.theme === "light" ? 0.9 : 0.5);
  },
  update(ctx, frame) {
    placeFlare(ctx);
    const whipIn = 1 - window01(0, CADENCE_WHIP_IN, frame.local);
    const whip = whipIn > 0 ? strideExitWhip(ctx, frame.aspect) : ([0, 0] as [number, number]);
    const z = cruise(ctx, frame.time);
    origin.set(BIKE_LANE_X, 0, z);
    followTrack(CADENCE_TRACK, frame.local, frame.aspect, origin, camera);
    point.set(BIKE_LANE_X - 0.06, 0.3, z);
    return {
      camera,
      lighting: followLighting(ctx, "track", "bike", point2.set(0, 0, z - 18)),
      grade: rideGrade(ctx),
      // Wide open: the stands melt behind the drivetrain, which sells the speed in a still frame.
      focus: { distance: focusOn(camera, point), aperture: 1.8 },
      whip: { direction: whip, amount: whipIn },
    };
  },
};

// ---------------------------------------------------------------------------------- 2b-wheel

/**
 * Relative to the bike: head-on at eye height, drifting back and round to the drive side from
 * the first frame, then one continuous crane arc down to hub height. The last key is solved so
 * the front tyre's circle sits on 3a's first bumper-plate frame (hub at 61.8 % / 52.0 % of the
 * 16:9 frame, rim ≈ 0.955 frame heights), both spinning clockwise on screen.
 */
const WHEEL_TRACK: CameraTrack = {
  // in → out: starts from the cut at rest, peaks once mid-arc and settles onto the match frame.
  keys: [
    { t: 0, position: [-0.56, 1.0, 2.81], target: [-0.08, 1.28, 0.3], focal: 42, ease: "in" },
    { t: 0.4, position: [-1.15, 0.62, 1.54], target: [0.0, 0.62, 0.45], focal: 38, ease: "out" },
    { t: 0.75, position: [-0.6, 0.29, 0.54], target: [0.3943, 0.3774, 0.4792], focal: 33.2 },
  ],
};
/** The reflector a car rig carries above the lens: sweeps across his lenses so the catch travels. */
const PING = { from: 0.0, to: 0.3, sweep: 0.6 } as const;

const shotWheel: Shot = {
  id: "2b-wheel",
  set: "track",
  cast: ["leo"],
  enter(ctx) {
    ctx.fx.flare.setIntensity(ctx.theme === "light" ? 1 : 0.55);
  },
  update(ctx, frame: ShotFrame) {
    placeFlare(ctx);
    // He lifts his eyes to the road ahead (just over the lens) so the mirrored lenses swing into
    // the bright sky / the floodlit end, then settles back into his tuck before the swoop.
    const lift = window01(0.02, 0.14, frame.local) * (1 - window01(0.3, 0.46, frame.local));
    origin.set(BIKE_LANE_X, 0, leoZ(frame.time));
    followTrack(WHEEL_TRACK, frame.local, frame.aspect, origin, camera);
    look.copy(camera.position).y += 0.5;
    const z = cruise(ctx, frame.time, look, lift);
    // The swoop turns the lens ~90° in under half a second: give it the streak a real crane move
    // would have (zero at both ends, where the move is at rest).
    origin.z = leoZ(frame.time - 1 / 60);
    followTrack(WHEEL_TRACK, frame.local - 1 / 60, frame.aspect, origin, previous);
    const head = ctx.cast.leo!.rig.bones.head.getWorldPosition(point);
    const lighting = followLighting(ctx, "track", "wheel", { x: 0, y: 0, z: z - 24 });
    // "Sunglasses catch the light": the one rim spot becomes a soft source just above the lens
    // that sweeps across his mirrored lenses (a travelling glint) and opens his backlit face. It
    // fades out as the swoop starts; the preset's rim then fades back in from zero at its own
    // position, so neither hand-over can pop.
    if (frame.local < 0.39) {
      const light = ctx.theme === "light";
      const u = window01(PING.from, PING.to, frame.local);
      lighting.rim = {
        color: light ? 0xffd9b4 : 0xe2eaff,
        // A hard, tight unit: the glint on the mirrored lenses must clip and bloom. Night: dimmer,
        // or the navy jersey flattens to grey under it.
        intensity: (light ? 24 : 12) * (1 - window01(0.24, 0.38, frame.local)),
        position: [camera.position.x + PING.sweep * (0.5 - u), camera.position.y + 0.45, camera.position.z - 0.2],
        // Aimed at the lenses (in front of the head bone), not the skull pivot.
        target: [head.x, head.y + 0.03, head.z + 0.1],
        angle: light ? 0.13 : 0.1,
        penumbra: 0.7,
        distance: 12,
      };
    } else {
      lighting.rim.intensity *= window01(0.4, 0.52, frame.local);
    }
    const hub = point2.set(BIKE_LANE_X, BIKE.frontAxle[1], z + BIKE.frontAxle[2]);
    const toWheel = THREE.MathUtils.smoothstep(frame.local, 0.3, 0.6);
    const focus = THREE.MathUtils.lerp(focusOn(camera, head), focusOn(camera, hub), toWheel);
    return {
      camera,
      lighting,
      grade: rideGrade(ctx),
      // Night: a smaller bokeh cap keeps the stars behind him from turning into sample rosettes.
      focus: { distance: focus, aperture: 2.8, maxBlur: ctx.theme === "light" ? 0.02 : 0.012 },
      // The crane's own streak through the fast middle of the arc; none on the head-on beat or the settle.
      whip: { direction: whipBlurVector(previous, camera, 1 / 60, ctx.camera, { deadZone: 0.006, max: 0.15 }), amount: window01(0.12, 0.26, frame.local) * (1 - window01(0.56, 0.7, frame.local)) },
    };
  },
};

export const ACT1_SHOTS: Shot[] = [shotSet, shotDrive, shotStride, shotCadence, shotWheel];
