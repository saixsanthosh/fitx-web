/**
 * Act 3 — refuel, team and brand (stages 4–6).
 *
 *   4a-table  flat-lay from just under the pendants: both meals on the frame's diagonal; the hands
 *             come up from the laps, take the glasses and lift them; the macro rings draw
 *   4b-toast  three-quarter two-shot from Maya's side: the clink at 8.6, Dre leans back laughing
 *   5a-walk   the hero walk: the squad walks out of a doorway of light at a low 50 mm lens in deep
 *             slow motion, rim-lit, their long shadows and reflections running down the floor
 *   5b-rise   the lens rises over the squad and flies into the doorway; its light swells into the flash
 *   6-brand   the frame clears to the theme background (the DOM mark forms over it)
 */

import * as THREE from "three";
import type { CharacterInstance } from "../../character/assemble";
import { TABLE } from "../../dimensions";
import { GRADES, mixGrades, type GradeParams } from "../../fx/post";
import { mixLightingPresets, type LightingPreset } from "../../lighting";
import { STUDIO_DOOR } from "../../sets/presets";
import { setKitchenForeground } from "../../sets/kitchen";
import { STUDIO_CONTACTS, setStudioBarLevel, setStudioContacts } from "../../sets/studio";
import { poseTable, poseWalk, type WalkStyle } from "../../motion";
import type { Theme, Vec3Tuple } from "../../types";
import { cameraStateQuaternion, createCameraState, evaluateCameraTrack, type CameraKey, type CameraTrack } from "../camera";
import type { FilmContext, Shot, ShotFrame, ShotView } from "../shot-types";
import { carryHelmet } from "../stage-kit";
import { timeRamp } from "../shot-utils";
import { bodyBox, focusOn, gradeFor, headBox, lightingFor, liveLayers, pointBox, poseWithHair, stage, window01 } from "./common";

const camera = createCameraState();
const scratchCamera = createCameraState();
const point = new THREE.Vector3();
const look = new THREE.Vector3();

/** Brand background colours (globals.css): the film clears to exactly these. */
const BRAND_BG: Record<Theme, number> = { light: 0xf7f7f4, dark: 0x151715 };

// ---------------------------------------------------------------------------------- table

/** Table clock (driver time; reach 0.1, grasp 0.45, clink 1.05). */
const TABLE_CLOCK = timeRamp([[7.55, 0], [9.2, 1.65]]);

const DINERS = [
  { id: "maya" as const, seat: 0 as const, yaw: Math.PI / 2, seed: 5 },
  { id: "dre" as const, seat: 1 as const, yaw: -Math.PI / 2, seed: 29 },
];

const heads = [new THREE.Vector3(), new THREE.Vector3()];
const eyes = [new THREE.Vector3(), new THREE.Vector3()];
const diners: CharacterInstance[] = [];

/**
 * Seats both diners, poses them, moves their smoothies into their hands and plays the driver's
 * face cues (smile into the clink, Dre's laugh). Fills `heads` (head joints) and `eyes` (≈ eye
 * level, the other diner's gaze target), both world space.
 */
function dine(ctx: FilmContext, key: string, start: number, action: number) {
  DINERS.forEach((diner, index) => {
    const seat = TABLE.seats[diner.seat];
    const instance = stage(ctx, diner.id, { x: seat[0], y: 0, z: seat[2] }, diner.yaw);
    const result = poseWithHair(instance, key, start, action, (time) => poseTable(instance.rig, time, diner.seat));
    instance.setHandPose("L", result.hands.L);
    instance.setHandPose("R", result.hands.R);
    instance.face.setExpression(result.face);
    const smoothie = ctx.props.smoothies[diner.seat];
    smoothie.group.visible = true;
    // glassLocal is model space (resting or held); the group transform takes it to the world.
    smoothie.group.position.copy(result.glassLocal.position).applyMatrix4(instance.group.matrixWorld);
    smoothie.group.quaternion.copy(instance.group.quaternion).multiply(result.glassLocal.quaternion);
    instance.rig.bones.head.getWorldPosition(heads[index]);
    eyes[index].copy(heads[index]);
    eyes[index].y += 0.09;
    diners[index] = instance;
  });
  diners.forEach((instance, index) => liveLayers(instance, action, { seed: DINERS[index].seed, gaze: eyes[1 - index] }));
}

/** TABLE_TRACK's frame on each composition (BRIEF-2 3.2; checked in tests/brand/intro-framing.test.ts). */
const TABLE_COMPS: CameraTrack["compositions"] = {
  phone: { focalScale: 0.802 },
  "tablet-p": { focalScale: 0.794 },
  "tablet-l": { focalScale: 0.925, offset: [0, -0.075, 0] },
  laptop: { focalScale: 0.943, offset: [-0.012, 0, 0] },
  desktop: { focalScale: 0.976 },
};

/**
 * Straight down from just under the pendants (hung high enough for a ~1.2 m drop), on a 31 mm
 * lens: close to orthographic, so the tall glasses read upright. Both place settings sit on the
 * frame's diagonal with the glasses on the horizontal midline; the right hands come up from the
 * laps over the table ends at the left and right of frame, take the glasses and lift them, and the
 * bottom-centre REFUEL callout area holds only oak. The frame turns slowly and settles a few
 * centimetres. Position and target share x/z: a vertical lens takes its screen-up from the roll.
 */
const TABLE_TRACK: CameraTrack = {
  keys: [
    { t: 0, position: [0.0, 1.96, 0.0], target: [0.0, 0.75, 0.0], focal: 30.5, roll: 0.5, ease: "inOut" },
    { t: 0.75, position: [0.0, 1.9, 0.0], target: [0.0, 0.75, 0.0], focal: 31.5, roll: 0.64 },
  ],
  // Portrait: the table's long axis on the tall frame, Maya's setting above, Dre's below and left of
  // the bottom centre (on the tall frames the REFUEL readout rides the top, so both rings draw there too).
  portrait: {
    keys: [
      { t: 0, position: [-0.1, 1.97, 0.07], target: [-0.1, 0.75, 0.07], focal: 29, roll: 2.14, ease: "inOut" },
      { t: 0.75, position: [-0.1, 1.91, 0.07], target: [-0.1, 0.75, 0.07], focal: 30, roll: 2.24 },
    ],
  },
  compositions: TABLE_COMPS,
};

/** Warm dust-coloured lift on the cut from the 3d dust cloud; it clears in ~4 frames. */
const TABLE_OPEN_FLASH: Record<Theme, { color: number; amount: number }> = { light: { color: 0xffe3c6, amount: 0.55 }, dark: { color: 0xc89a6e, amount: 0.38 } };
const ringUp = new THREE.Vector3();
const ringQuat = new THREE.Quaternion();

const shotTable: Shot = {
  id: "4a-table",
  set: "kitchen",
  cast: ["maya", "dre"],
  enter(ctx) {
    ctx.props.rings.group.visible = true;
  },
  update(ctx, frame): ShotView {
    const action = TABLE_CLOCK(frame.time);
    dine(ctx, "4a-table", TABLE_CLOCK(7.55), action);
    // Arcs start at screen 12 o'clock (of the mid-shot frame, so they stay in-world) and run
    // clockwise; Maya's draw first, Dre's a beat later (the REFUEL callout lands at 7.7).
    evaluateCameraTrack(TABLE_TRACK, 0.4, frame.aspect, scratchCamera);
    ringUp.set(0, 1, 0).applyQuaternion(cameraStateQuaternion(scratchCamera, ringQuat));
    ctx.props.rings.setStartDirection(ringUp.x, ringUp.z);
    ctx.props.rings.setProgressAt(0, window01(7.62, 8.14, frame.time));
    ctx.props.rings.setProgressAt(1, window01(7.72, 8.26, frame.time));
    evaluateCameraTrack(TABLE_TRACK, frame.local, frame.aspect, camera);
    point.set(camera.position.x, TABLE.height + 0.05, camera.position.z);
    const open = 1 - window01(0, 0.075, frame.local);
    const flash = TABLE_OPEN_FLASH[ctx.theme];
    return {
      camera,
      lighting: lightingFor(ctx, "kitchen", "overhead"),
      grade: gradeFor(ctx.theme, "kitchenOverheadMorning", "kitchenOverheadEvening"),
      // The opening frames are a soft defocus that racks in as the dust lift clears.
      focus: { distance: focusOn(camera, point) * (1 - 0.45 * open), aperture: 4 - 1.6 * open },
      flash: { color: flash.color, amount: flash.amount * open * open },
    };
  },
  // Both meals (bowl and glass) on the table.
  subjects() {
    return TABLE.places.flatMap((place, index) => [
      // A world box round a disc seen from above overstates it by the roll; 0.75 of the rim radius bounds the bowl at this shot's roll.
      pointBox(`bowl-${index}`, point.fromArray(place.bowl).setY(TABLE.height + TABLE.bowlHeight / 2), [TABLE.bowlRadius * 0.75, TABLE.bowlHeight / 2, TABLE.bowlRadius * 0.75], true),
      pointBox(`glass-${index}`, point.fromArray(place.glass).setY(TABLE.height + 0.09), [0.05, 0.09, 0.05], false),
    ]);
  },
};

/** TOAST_TRACK's frame on each composition (BRIEF-2 3.2; checked in tests/brand/intro-framing.test.ts). */
const TOAST_COMPS: CameraTrack["compositions"] = {
  phone: { focalScale: 0.83, offset: [-0.075, 0, 0] },
  "tablet-p": {},
  "tablet-l": { offset: [-0.075, 0, 0] },
  laptop: {},
  desktop: {},
};

/**
 * Three-quarter two-shot from Maya's shoulder side, the window behind her: Maya near profile on the
 * left third, Dre more frontal on the right third, the clink between them. A slow, short arc toward
 * Maya's side opens up Dre's face as he leans back laughing, easing back a touch so his lean stays
 * in frame; a low plant ~1.4 m from the lens drifts through the lower-right corner as soft
 * foreground. Portrait: higher and wider, both faces in the upper third, the clink just below.
 */
const TOAST_TRACK: CameraTrack = {
  keys: [
    { t: 0, position: [-0.64, 1.1, 2.9], target: [0.06, 1.03, 0.0], focal: 39, ease: "inOut" },
    { t: 0.9, position: [-0.98, 1.13, 2.94], target: [0.12, 1.05, 0.0], focal: 37 },
  ],
  shake: { amplitude: 0.12, frequency: 0.8, seed: 52 },
  portrait: {
    keys: [
      { t: 0, position: [-0.38, 1.78, 3.22], target: [0.14, 0.45, 0.0], focal: 25.5, ease: "inOut" },
      { t: 0.9, position: [-0.5, 1.8, 3.2], target: [0.16, 0.45, 0.0], focal: 25 },
    ],
  },
  compositions: TOAST_COMPS,
};

const shotToast: Shot = {
  id: "4b-toast",
  set: "kitchen",
  cast: ["maya", "dre"],
  enter() {},
  update(ctx, frame) {
    const action = TABLE_CLOCK(frame.time);
    dine(ctx, "4b-toast", TABLE_CLOCK(8.3), action);
    evaluateCameraTrack(TOAST_TRACK, frame.local, frame.aspect, camera);
    // Without depth of field (medium tier), or on the narrow portrait frame where it would fill a
    // third of the picture, the near plant would be a sharp clump: drop it there.
    setKitchenForeground(ctx.sets.kitchen, ctx.quality.tier !== "medium" && !ctx.portrait);
    // Focus on the eye-line between them (the clink sits on nearly the same plane).
    look.copy(eyes[0]).lerp(eyes[1], 0.45);
    return {
      camera,
      lighting: lightingFor(ctx, "kitchen", "side"),
      grade: gradeFor(ctx.theme, "kitchenMorning", "kitchenEvening"),
      focus: { distance: focusOn(camera, look), aperture: 2 },
    };
  },
  // Both faces through the clink and the laugh.
  subjects(ctx) {
    return [headBox(ctx.cast.maya!, "maya-face", true), headBox(ctx.cast.dre!, "dre-face", true)];
  },
};

// ---------------------------------------------------------------------------------- team walk

/**
 * Action clock of the hero walk (driver seconds). It comes out of the cut at 0.62× and sinks into
 * a deep 0.42× slow motion by 10.0 that holds through the rise: one clock for both team shots
 * (the camera never cuts at 10.15, so neither may the walk or the ponytail).
 */
const WALK_RATE = { t0: 9.2, t1: 10.0, from: 0.62, to: 0.42 } as const;

function walkClock(film: number) {
  const { t0, t1, from, to } = WALK_RATE;
  const span = t1 - t0;
  if (film <= t0) return from * (film - t0);
  if (film >= t1) return from * span + (to - from) * span * 0.5 + to * (film - t1);
  // The rate eases with a smoothstep, whose integral is u³ − u⁴/2.
  const u = (film - t0) / span;
  return from * (film - t0) + (to - from) * span * (u * u * u - 0.5 * u * u * u * u);
}

interface Walker {
  id: "leo" | "maya" | "dre";
  style: WalkStyle;
  /** Offset from `walkStart` (x lateral, z forward). */
  x: number;
  z: number;
  /** Gait phase (steps) and seed (blinks). */
  phase: number;
  seed: number;
}

/**
 * Arrowhead: Maya leads in the centre; Leo (frame left, the helmet in his right hand on the
 * outside) and Dre (frame right) walk wider, most of a stride behind her, so the long lens stacks
 * them in depth. Different gait phases: the heel strikes land one after another, never in step.
 */
const SQUAD: Walker[] = [
  { id: "leo", style: "leo", x: -0.86, z: 0.2, phase: 0.62, seed: 13 },
  { id: "maya", style: "maya", x: 0, z: 1.05, phase: 0.08, seed: 7 },
  { id: "dre", style: "dre", x: 0.92, z: 0.38, phase: 1.36, seed: 37 },
];
/** The tall portrait frame tightens the arrowhead so Leo's and Dre's faces stay inside it. */
const PORTRAIT_SPREAD = 0.68;

const ahead = new THREE.Vector3();
const gaze = new THREE.Vector3();
const footA = new THREE.Vector3();
const footB = new THREE.Vector3();
const nodQuat = new THREE.Quaternion();
const nodAxis = new THREE.Vector3(1, 0, 0);
const contacts = new Float32Array(STUDIO_CONTACTS * 3);
const walkers: Partial<Record<Walker["id"], CharacterInstance>> = {};
const eyeOf: Record<Walker["id"], THREE.Vector3> = { leo: new THREE.Vector3(), maya: new THREE.Vector3(), dre: new THREE.Vector3() };

/**
 * Performance, a pure function of film time: Maya holds the lens with a confident smile; Leo turns
 * to Maya and grins, then looks back down the line; Dre looks out ahead, then gives the lens one
 * slow nod. Returns the head-look target into `ahead`, the eyes' target into `gaze`.
 */
function perform(id: Walker["id"], film: number, instance: CharacterInstance, lens: THREE.Vector3) {
  const head = instance.group.position;
  if (id === "maya") {
    ahead.copy(lens);
    gaze.copy(lens);
    return { look: 0.42, smile: 0.5 + 0.08 * window01(9.3, 9.9, film), laugh: 0, nod: 0 };
  }
  if (id === "leo") {
    // The glance: in on 9.32–9.52, held, back on 9.86–10.08 (to the lens).
    const glance = window01(9.32, 9.52, film) * (1 - window01(9.86, 10.08, film));
    ahead.copy(lens).lerp(eyeOf.maya, glance);
    gaze.copy(ahead);
    return { look: 0.45 + 0.35 * glance, smile: 0.5 + 0.22 * glance, laugh: 0.14 * glance, nod: 0 };
  }
  // Dre: out ahead down the hall (over the lens), then the nod lands on the lens.
  const turn = window01(9.62, 9.84, film);
  ahead.set(head.x * 0.4, 1.75, head.z + 12).lerp(lens, turn);
  gaze.copy(ahead);
  // One slow nod: down 9.82–10.0, up 10.0–10.22.
  const nod = 0.13 * window01(9.82, 10.0, film) * (1 - window01(10.0, 10.22, film));
  return { look: 0.5, smile: 0.62 + 0.06 * turn, laugh: 0, nod };
}

/**
 * Poses the squad at film time `film` (camera at `lens`): gait, ponytail, helmet, performance and
 * the floor's contact shadows. Returns Maya's eye point (the focus target) in `eyeOf.maya`.
 */
function walk(ctx: FilmContext, film: number, lens: THREE.Vector3) {
  const startAnchor = ctx.sets.studio.anchors.walkStart;
  const spread = ctx.portrait ? PORTRAIT_SPREAD : 1;
  const action = walkClock(film);
  // Maya first: Leo's glance needs her eyes.
  for (const member of [SQUAD[1], SQUAD[0], SQUAD[2]]) {
    const instance = stage(ctx, member.id, { x: startAnchor.position.x + member.x * spread, y: 0, z: startAnchor.position.z + member.z });
    walkers[member.id] = instance;
    const result = poseWithHair(instance, "team-walk", walkClock(9.2), action, (time) =>
      poseWalk(instance.rig, time, { style: member.style, carry: member.id === "leo" ? "helmet" : undefined, phase: member.phase }),
    );
    instance.setHandPose("L", result.hands.L);
    instance.setHandPose("R", result.hands.R);
    if (member.id === "leo" && result.helmet) {
      const holder = ctx.props.helmetHolder;
      holder.position.copy(result.helmet.position);
      holder.quaternion.copy(result.helmet.quaternion);
    }
    const act = perform(member.id, film, instance, lens);
    liveLayers(instance, action, { seed: member.seed, lookAt: ahead, lookWeight: act.look, gaze });
    if (act.nod > 0) instance.rig.bones.head.quaternion.multiply(nodQuat.setFromAxisAngle(nodAxis, act.nod));
    instance.face.setExpression({ smile: act.smile, laugh: act.laugh });
    instance.group.updateMatrixWorld(true);
    instance.rig.bones.head.getWorldPosition(eyeOf[member.id]);
    eyeOf[member.id].y += 0.07;
  }
  // Contact shadows under each foot: full while planted, fading as the foot lifts.
  SQUAD.forEach((member, m) => {
    const rig = walkers[member.id]!.rig;
    (["L", "R"] as const).forEach((side, s) => {
      rig.bones[`foot_${side}`].getWorldPosition(footA);
      rig.bones[`toe_${side}`].getWorldPosition(footB);
      const lift = Math.max(0, Math.min(footA.y - 0.075, footB.y - 0.02));
      const k = (m * 2 + s) * 3;
      contacts[k] = footA.x * 0.45 + footB.x * 0.55;
      contacts[k + 1] = footA.z * 0.45 + footB.z * 0.55;
      contacts[k + 2] = 0.7 * Math.max(0, 1 - lift / 0.14);
    });
  });
  setStudioContacts(ctx.sets.studio, contacts);
}

/**
 * One continuous move across 5a, 5b and 6, authored as three physical beats and sampled into a
 * dense track (so the spline never overshoots between the slow push and the fast rise):
 * - 5a (9.2–10.15): a low lens (knee height, a 50 mm from ~7.5 m) pushes in slowly while the squad
 *   walks at it and drifts across the axis, so the arrowhead turns a little and its depth reads;
 * - 5b (10.15–10.6): without a hitch the lens accelerates up over the squad and pushes on a zoom
 *   into the doorway; the heads leave through the bottom of the frame;
 * - 6: the drift into the light eases out under the flash and the fade. It leaves the cut at the
 *   rise's own speed and zoom rate (BRIEF-2 G1: no velocity jump at the brand cut), so where it
 *   settles 0.4 s later follows from the rise instead of being authored.
 */
interface TeamMove {
  /** 5a lens at 9.2 and 10.15 (constant velocity), the points it looks at then, focal and roll. */
  walk: [Vec3Tuple, Vec3Tuple];
  look: [Vec3Tuple, Vec3Tuple];
  focal: [number, number];
  roll: [number, number];
  /** 5b: lens at the brand cut, where it looks, focal; the push grows as s^riseCurve, the tilt as s^tiltCurve. */
  rise: Vec3Tuple;
  riseLook: Vec3Tuple;
  riseFocal: number;
  riseCurve: number;
  tiltCurve: number;
}

/** How long the brand drift takes to ease out (s). */
const DRIFT_SPAN = 0.4;

const WALK_SPAN = 0.95;
const RISE_SPAN = 0.45;

function teamKeys(m: TeamMove): CameraKey[] {
  const keys: CameraKey[] = [];
  // The rise's velocity and log-zoom rate at the cut: the drift (an ease-out, 1 − (1 − u)², whose start
  // speed is twice its average) starts from exactly these.
  const riseEnd: Vec3Tuple = [0, 0, 0];
  for (let c = 0; c < 3; c += 1) {
    const v = (m.walk[1][c] - m.walk[0][c]) / WALK_SPAN;
    riseEnd[c] = v + ((m.rise[c] - m.walk[1][c] - v * RISE_SPAN) * m.riseCurve) / RISE_SPAN;
  }
  const zoomEnd = (Math.log(m.riseFocal / m.focal[1]) * m.riseCurve) / RISE_SPAN;
  const drift: Vec3Tuple = [0, 1, 2].map((c) => m.rise[c] + riseEnd[c] * DRIFT_SPAN * 0.5) as Vec3Tuple;
  const driftFocal = m.riseFocal * Math.exp(zoomEnd * DRIFT_SPAN * 0.5);
  const at = (a: Vec3Tuple, b: Vec3Tuple, u: number): Vec3Tuple => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  for (let index = 0; index <= 36; index += 1) {
    const t = index * 0.05;
    let position: Vec3Tuple;
    let target: Vec3Tuple;
    let focal: number;
    let roll: number;
    if (t <= WALK_SPAN) {
      const u = t / WALK_SPAN;
      position = at(m.walk[0], m.walk[1], u);
      target = at(m.look[0], m.look[1], u);
      focal = m.focal[0] * Math.pow(m.focal[1] / m.focal[0], u);
      roll = m.roll[0] + (m.roll[1] - m.roll[0]) * u;
    } else if (t <= WALK_SPAN + RISE_SPAN) {
      // Out of the push's velocity with a growing acceleration (s^k), landing on `rise` at the cut.
      // The tilt to the doorway trails the boom a little, so the heads leave the frame late and fast.
      const tau = t - WALK_SPAN;
      const s = tau / RISE_SPAN;
      position = [0, 0, 0];
      for (let c = 0; c < 3; c += 1) {
        const v = (m.walk[1][c] - m.walk[0][c]) / WALK_SPAN;
        position[c] = m.walk[1][c] + v * tau + (m.rise[c] - m.walk[1][c] - v * RISE_SPAN) * Math.pow(s, m.riseCurve);
      }
      const drifting = at(m.look[1], at(m.look[0], m.look[1], 1 + RISE_SPAN / WALK_SPAN), s);
      const tilt = Math.pow(s, m.tiltCurve);
      target = at(drifting, m.riseLook, tilt * tilt * (3 - 2 * tilt));
      focal = m.focal[1] * Math.pow(m.riseFocal / m.focal[1], Math.pow(s, m.riseCurve));
      roll = m.roll[1] * (1 - s);
    } else {
      const u = Math.min(1, (t - WALK_SPAN - RISE_SPAN) / DRIFT_SPAN);
      const e = 1 - (1 - u) * (1 - u);
      position = at(m.rise, drift, e);
      target = m.riseLook;
      focal = m.riseFocal * Math.pow(driftFocal / m.riseFocal, e);
      roll = 0;
    }
    keys.push({ t, position, target, focal, roll });
  }
  return keys;
}

const DOOR_LIGHT: Vec3Tuple = [0, STUDIO_DOOR.height * 0.52, STUDIO_DOOR.wallZ];

/** TEAM_TRACK's frame on each composition (BRIEF-2 3.2; checked in tests/brand/intro-framing.test.ts). */
const TEAM_COMPS: CameraTrack["compositions"] = {
  phone: {},
  "tablet-p": {},
  "tablet-l": {},
  laptop: { focalScale: 0.911 },
  desktop: { focalScale: 0.881 },
};

const TEAM_TRACK: CameraTrack = {
  keys: teamKeys({
    walk: [[0.42, 0.56, 5.4], [0.1, 0.66, 4.95]],
    look: [[0.04, 0.98, -2.4], [0.02, 1.02, -2.0]],
    focal: [50, 52],
    roll: [0.012, -0.004],
    rise: [0.0, 2.05, 3.55],
    riseLook: DOOR_LIGHT,
    riseFocal: 80,
    riseCurve: 2.2,
    tiltCurve: 1.4,
  }),
  shake: { amplitude: 0.05, frequency: 0.7, seed: 61 },
  portrait: {
    // Portrait: the squad tightened, a longer way back on a slightly wider lens; Maya holds the
    // vertical centre, the doorway towers over the team and the floor carries the title.
    keys: teamKeys({
      walk: [[0.25, 0.78, 6.4], [0.06, 0.86, 5.95]],
      look: [[0.02, 1.32, -2.4], [0.01, 1.36, -2.0]],
      focal: [46, 48],
      roll: [0.01, -0.004],
      rise: [0.0, 2.1, 4.4],
      riseLook: DOOR_LIGHT,
      riseFocal: 62,
      riseCurve: 2.2,
      tiltCurve: 1.4,
    }),
  },
  compositions: TEAM_COMPS,
};
const TEAM_START = 9.2;

const lens = new THREE.Vector3();

function teamCamera(frame: ShotFrame) {
  evaluateCameraTrack(TEAM_TRACK, frame.time - TEAM_START, frame.aspect, camera);
  lens.copy(camera.position);
  return camera;
}

function holdHelmet(ctx: FilmContext) {
  const leo = ctx.cast.leo!;
  carryHelmet(leo, ctx.props.helmetHolder);
  // Sunglasses off for the walk (hideStage puts them back with the helmet).
  leo.setAccessoryVisible("sunglassesFrame", false);
  leo.setAccessoryVisible("sunglassesLens", false);
}

/** Grades that animate: two scratch objects used in turn, so the reference changes every frame without allocating. */
const gradeScratch: [GradeParams, GradeParams] = [{ ...GRADES.studioLight }, { ...GRADES.studioLight }];
let gradeFlip = 0;
function blendGrade(a: GradeParams, b: GradeParams, t: number): GradeParams {
  gradeFlip = 1 - gradeFlip;
  return mixGrades(a, b, t, gradeScratch[gradeFlip]);
}

/**
 * The cut in from the kitchen lands on the light: the doorway opens flared (twice its level, its
 * glow spread wide) and settles in ~4 frames, as if the hall's light had just been thrown on.
 */
const OPEN_FLARE = { level: 1.25, spread: 0.55, until: 0.16 } as const;

const shotWalk: Shot = {
  id: "5a-walk",
  set: "studio",
  cast: ["maya", "leo", "dre"],
  enter: holdHelmet,
  update(ctx, frame) {
    teamCamera(frame);
    walk(ctx, frame.time, lens);
    const open = 1 - window01(0, OPEN_FLARE.until, frame.local);
    setStudioBarLevel(ctx.sets.studio, 1 + OPEN_FLARE.level * open * open, OPEN_FLARE.spread * open);
    const base = gradeFor(ctx.theme, "studioLight", "studioDark");
    return {
      camera,
      lighting: lightingFor(ctx, "studio", "walk"),
      grade: open > 0 ? blendGrade(base, gradeFor(ctx.theme, "studioSwellLight", "studioSwellDark"), 0.6 * open) : base,
      // Focus on Maya's eyes; Leo and Dre, most of a stride behind, stay inside f/2.8 at ~7.5 m.
      focus: { distance: focusOn(camera, eyeOf.maya), aperture: 2.8 },
    };
  },
  // Every face on every composition; on the wide ones the whole squad, head to toes.
  subjects(ctx) {
    const wide = ctx.composition === "laptop" || ctx.composition === "desktop";
    return SQUAD.flatMap((member) => {
      const instance = ctx.cast[member.id]!;
      return [headBox(instance, `${member.id}-face`, true), bodyBox(instance, member.id, wide)];
    });
  },
};

// ---------------------------------------------------------------------------------- rise + brand

/**
 * The climax is carried by the doorway itself: its light swells and its glow spreads as the lens
 * flies at it, the bloom widens with it, and global exposure is saved for the last frames.
 * Light: the doorway's white light swallows the frame and lands on the page. Dark: a coral bloom
 * that fills the doorway's part of the frame (never the whole of it), then the light goes out.
 */
const SWELL: Record<Theme, { level: number; spread: number; flash: number; flashColor: number; exposure: number }> = {
  light: { level: 2.6, spread: 1, flash: 0.32, flashColor: 0xfff1e4, exposure: 0.55 },
  dark: { level: 2.2, spread: 1, flash: 0.06, flashColor: 0xff7a5c, exposure: 0.25 },
};

/** Swell amount through 5b (0 at 10.15, 1 at the brand cut), eased in. */
const swellAt = (film: number) => {
  const s = window01(10.15, 10.6, film);
  return s * s;
};

function riseLighting(ctx: FilmContext, swell: number): LightingPreset {
  return mixLightingPresets(lightingFor(ctx, "studio", "walk"), lightingFor(ctx, "studio", "rise"), swell);
}

const doorLight = new THREE.Vector3(...DOOR_LIGHT);

const shotRise: Shot = {
  id: "5b-rise",
  set: "studio",
  cast: ["maya", "leo", "dre"],
  enter: holdHelmet,
  update(ctx, frame) {
    teamCamera(frame);
    walk(ctx, frame.time, lens);
    const swell = swellAt(frame.time);
    const spec = SWELL[ctx.theme];
    setStudioBarLevel(ctx.sets.studio, 1 + (spec.level - 1) * swell, spec.spread * swell);
    const grade = blendGrade(gradeFor(ctx.theme, "studioLight", "studioDark"), gradeFor(ctx.theme, "studioSwellLight", "studioSwellDark"), Math.sqrt(swell));
    grade.exposure += spec.exposure * swell * swell;
    // Focus racks from Maya to the doorway as the lens clears the heads.
    const rack = window01(10.22, 10.45, frame.time);
    const flash = window01(10.4, 10.6, frame.time);
    return {
      camera,
      lighting: riseLighting(ctx, swell),
      grade,
      focus: { distance: THREE.MathUtils.lerp(focusOn(camera, eyeOf.maya), focusOn(camera, doorLight), rack), aperture: 2.8 },
      flash: { color: spec.flashColor, amount: spec.flash * flash * flash },
    };
  },
  // The heads leave through the bottom of the frame as the lens rises (by design): nothing must stay.
  subjects(ctx) {
    return SQUAD.map((member) => headBox(ctx.cast[member.id]!, `${member.id}-face`, false));
  },
};

const brandGrade: Partial<Record<Theme, GradeParams>> = {};

/**
 * The tail (BRIEF-2 3.2a shot 14, local seconds from 10.6). By `settle` the swell has cleared under a
 * `veil` of the page colour; the doorway's last glow and its drifting dust then fall away under that
 * veil (a soft light fall-off behind the forming mark) until the frame is exactly the page colour at
 * `clear` (11.8), held to the end (12.6). The DOM `LogoReveal variant="film-end"` forms over it.
 */
export const BRAND_TAIL = { settle: 0.29, veil: 0.9, clear: 1.2 } as const;
/** The tail's lens: focused just past the glass at its widest blur, so what is left of the doorway is light, not a shape. */
const TAIL_FOCUS = { distance: 0.25, aperture: 1.2, maxBlur: 0.05 } as const;
/** The doorway light (a share of its swell level) still glowing as the tail's fall-off begins. */
const TAIL_GLOW: Record<Theme, number> = { light: 0.7, dark: 0.32 };

const shotBrand: Shot = {
  id: "6-brand",
  set: "studio",
  cast: [],
  enter() {},
  update(ctx, frame) {
    const local = frame.local;
    const theme = ctx.theme;
    const spec = SWELL[theme];
    // The swell clears to the veil by ~10.9 (the DOM reveal's bar is already drawing), then the fall-off.
    const settle = window01(0.0, BRAND_TAIL.settle, local);
    const fall = window01(BRAND_TAIL.settle, BRAND_TAIL.clear, local);
    const done = local >= BRAND_TAIL.clear;
    ctx.sets.studio.group.visible = !done;
    teamCamera(frame);
    const swellGrade = gradeFor(theme, "studioSwellLight", "studioSwellDark");
    const brand = gradeFor(theme, "brandLight", "brandDark");
    let grade: GradeParams;
    let flash: ShotView["flash"];
    if (done) {
      grade = brandGrade[theme] ??= { ...mixGrades(swellGrade, brand, 1) };
    } else {
      grade = blendGrade(swellGrade, brand, settle);
      grade.exposure = spec.exposure + (theme === "light" ? 1.1 : -2.6) * window01(0, 0.2, local) * (1 - fall);
    }
    // What is left of the doorway's light as the tail falls off (its dust drifts with it, then settles out).
    const glow = TAIL_GLOW[theme] * spec.level * settle * (1 - fall);
    if (theme === "light") {
      // The white-out: the doorway's light takes the frame, the flash carries it onto the page.
      const swell = spec.level * (1 + 0.6 * window01(0, 0.12, local)) * (1 - settle);
      setStudioBarLevel(ctx.sets.studio, swell + glow, spec.spread);
      flash = { color: spec.flashColor, amount: THREE.MathUtils.lerp(spec.flash, 0.9, window01(0, 0.1, local)) * (1 - window01(0.2, 0.29, local)) };
    } else {
      // The light goes out: the doorway's glow sinks into the charcoal as the page lands.
      setStudioBarLevel(ctx.sets.studio, spec.level * (1 - window01(0.02, 0.22, local)) + glow, spec.spread * (1 - window01(0, 0.2, local)));
      flash = { color: spec.flashColor, amount: spec.flash * (1 - window01(0, 0.08, local)) };
    }
    return {
      camera,
      lighting: lightingFor(ctx, "studio", "rise"),
      grade,
      // Focused a hand's width from the lens: the doorway behind the veil melts into a soft glow with no edges.
      focus: TAIL_FOCUS,
      flash,
      fade: { color: BRAND_BG[theme], amount: done ? 1 : settle * BRAND_TAIL.veil + fall * (1 - BRAND_TAIL.veil) },
    };
  },
  // The frame clears: nothing stands behind the mark.
  subjects() {
    return [];
  },
};

export const ACT3_SHOTS: Shot[] = [shotTable, shotToast, shotWalk, shotRise, shotBrand];

/** Staging data for the lab's projection checks (framing vs overlay zones); not used at runtime. */
export const ACT3_LAB = { TABLE_TRACK, TOAST_TRACK, TEAM_TRACK, TEAM_START, SQUAD, DINERS, TABLE_CLOCK, walkClock, PORTRAIT_SPREAD, BRAND_TAIL, BRAND_BG };
