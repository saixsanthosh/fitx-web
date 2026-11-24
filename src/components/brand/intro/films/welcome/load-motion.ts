/**
 * The welcome film's own motion clips (main thread, three.js): loading a plate onto the bar, and standing by it.
 *
 * Built on the motion system's public pieces (PoseContext and its two-bone IK, rig metrics, flat feet, hand
 * rotations, the shoulder girdle and head helpers), imported from their own modules so node tests can load the film's
 * definition (`motion/index.ts` re-exports drivers that strip-only TypeScript cannot load).
 *
 * Frame (model space, as every driver): the character group stands at its root facing +Z; the bar runs along model
 * Z ahead of it, its sleeve tip pointing back at the loader. A pure function of action time, like every driver.
 *
 * `poseLoad`: the loader stands behind a plate already hung on the sleeve tip (Maya's rests on the floor and rolls),
 * hinges, sets both palms flat on the plate's near face either side of the top, steps in with the lead foot and
 * drives the plate home along the sleeve; at the seat the hands come off, the hips rise and the arms settle.
 * The plate's travel is the shot's (`plateTravel`); the hands follow it every frame, so they never slide on it.
 */

import * as THREE from "three";
import type { Rig } from "../../rig/three-rig";
import { PoseContext, quatXYZ, ramp, bump, rigMetrics, updateHelperBones, type RigMetrics } from "../../motion/helpers";
import { handBindFrame, handRotation } from "../../motion/hands";
import { flatAnkle, type Side } from "../../motion/foot";
import { armSwingTarget, setShoulderGirdle, stabiliseHead, type ArmSwing } from "../../motion/upper";
import { applyBreath } from "../../motion/layers";
import { lerp, smootherstep01 } from "../../math";
import { BAR_Y } from "./props";

/** A plate's travel along the sleeve: where its centre is (m ahead of the loader's root, model z) and how it turns. */
export type PlateTravel = { z: number; roll: number; seated: boolean };

export type LoadSpec = {
  /** Plate radius and its centre height above the loader's ground (m). */
  radius: number;
  height: number;
  /** Plate centre, model z, at the start and at the seat (the seat is further from the loader). */
  zStart: number;
  zSeat: number;
  /** Action times (s): hands on, push start, seat, hands off. */
  handsOn: number;
  push: number;
  seat: number;
  release: number;
  /** Rolls on the floor (turns by distance / radius) instead of sliding on the sleeve. */
  rolls: boolean;
  /** Rebound off the stack at the seat (m) and the settle time (s). */
  rebound: number;
  /** Palms either side of the top of the plate, at this angle from the top (rad). */
  gripAngle: number;
  /** Hip height in the push, as a share of the standing hip height (deeper for lower hands). */
  sink: number;
  /** Lead (left) foot step forward (m). */
  step: number;
  seed: number;
};

/** Each athlete's loading performance (times are the clip's own; the shots map film time onto them). */
export const LOADS = {
  // Maya rolls the 20 kg plate: light and quick, a long step, the plate turning under her palms.
  maya: { radius: 0.225, height: BAR_Y, zStart: 0.62, zSeat: 0.97, handsOn: 0.12, push: 0.4, seat: 1.0, release: 1.12, rolls: true, rebound: 0.006, gripAngle: 0.62, sink: 0.82, step: 0.3, seed: 11 },
  // Leo slides the 10 kg plate off the tip: a short, neat shove.
  leo: { radius: 0.175, height: BAR_Y, zStart: 0.65, zSeat: 0.9, handsOn: 0.05, push: 0.3, seat: 0.88, release: 0.98, rolls: false, rebound: 0.004, gripAngle: 0.95, sink: 0.76, step: 0.22, seed: 29 },
  // Dre drives the last plate home: a deep, heavy stance (the shot plays it at 0.42x after its first 0.25 s).
  dre: { radius: 0.13, height: BAR_Y, zStart: 0.69, zSeat: 0.86, handsOn: 0.05, push: 0.22, seat: 0.56, release: 0.7, rolls: false, rebound: 0.003, gripAngle: 1.15, sink: 0.7, step: 0.18, seed: 47 },
} as const satisfies Record<string, LoadSpec>;

/** The plate's centre and turn at action time t: eased off the start, decelerating into the seat, a small rebound. */
export function plateTravel(spec: LoadSpec, t: number): PlateTravel {
  const distance = spec.zSeat - spec.zStart;
  let z: number;
  if (t <= spec.push) z = spec.zStart;
  else if (t < spec.seat) {
    const u = (t - spec.push) / (spec.seat - spec.push);
    // Accelerates out of the hands, still travelling at about 40% of its mean speed when it meets the stack.
    const eased = u * u * (3 - 2 * u) * 0.6 + u * 0.4;
    z = spec.zStart + distance * eased;
  } else {
    const tau = t - spec.seat;
    z = spec.zSeat - spec.rebound * Math.sin(Math.min(1, tau / 0.05) * Math.PI) * Math.exp(-tau / 0.08);
  }
  const roll = spec.rolls ? -(z - spec.zStart) / spec.radius : 0;
  return { z, roll, seated: t >= spec.seat };
}

/**
 * How firmly the palms are on the plate at action time t (0..1): they land on it at `handsOn` and come off at
 * `release`. Above 0.5 the clip counts them as on it (`LoadResult.gripping`; the shots' framing subjects use the same).
 */
export function gripAt(spec: LoadSpec, t: number) {
  return ramp(spec.handsOn - 0.04, spec.handsOn + 0.06, t) * (1 - ramp(spec.release - 0.02, spec.release + 0.06, t));
}

interface Setup {
  m: RigMetrics;
  k: number;
  hipMid: THREE.Vector3;
  standY: number;
  reach: number;
  rest: Record<Side, THREE.Quaternion>;
}

const setups = new WeakMap<Rig, Setup>();

function setupFor(rig: Rig): Setup {
  const cached = setups.get(rig);
  if (cached) return cached;
  const m = rigMetrics(rig);
  const k = m.height / 1.8;
  const hipMid = m.hipJoint.L.clone().add(m.hipJoint.R).multiplyScalar(0.5);
  const rest = { L: new THREE.Quaternion(), R: new THREE.Quaternion() };
  for (const side of ["L", "R"] as const) {
    const sx = side === "L" ? 1 : -1;
    handRotation(rig, side, new THREE.Vector3(sx * 0.08, -1, 0.12), new THREE.Vector3(-sx, 0, 0.15), rest[side]);
  }
  const setup = { m, k, hipMid, standY: hipMid.y * 0.985, reach: m.upperArm + m.forearm, rest };
  setups.set(rig, setup);
  return setup;
}

const ctx = new PoseContext();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _d = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _hands = new THREE.Vector3();
const _palm = new THREE.Vector3();
const _wrist = new THREE.Vector3();
const _free = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _sh = new THREE.Vector3();
const _ground = new THREE.Vector3();
const _ankle = new THREE.Vector3();
const _hip = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _hq = new THREE.Quaternion();
const _push = new THREE.Quaternion();
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const _arm: ArmSwing = { flex: 0.06, elbow: 0.22, abduct: 0.1, across: 0 };

/** Shoulder midpoint relative to the hip midpoint for the current spine pose, in the hips bone frame. */
function shouldersFromHips(rig: Rig, s: Setup, out: THREE.Vector3) {
  const b = rig.bones;
  out.set(0, 0, 0);
  for (const side of ["L", "R"] as const) {
    _v.copy(b[`upperArm_${side}`].position).applyQuaternion(b[`shoulder_${side}`].quaternion).add(b[`shoulder_${side}`].position);
    _v.applyQuaternion(b.chest.quaternion).add(b.chest.position);
    _v.applyQuaternion(b.spine.quaternion).add(b.spine.position);
    out.add(_v);
  }
  return out.multiplyScalar(0.5).sub(_v.copy(s.hipMid).sub(s.m.hips));
}

/** Pitch about +X of the hips for which hipMid + Rx(τ)·w lies `r` from `target - hipMid` (`d`), the root nearest `guess`. */
function solvePitch(w: THREE.Vector3, d: THREE.Vector3, r: number, guess: number) {
  const A = w.y * d.y + w.z * d.z;
  const B = w.y * d.z - w.z * d.y;
  const C = (w.lengthSq() + d.lengthSq() - r * r) / 2 - w.x * d.x;
  const M = Math.hypot(A, B);
  if (M < 1e-9) return guess;
  const beta = Math.atan2(B, A);
  const half = Math.acos(THREE.MathUtils.clamp(C / M, -1, 1));
  const wrap = (a: number) => Math.atan2(Math.sin(a - guess), Math.cos(a - guess));
  const a1 = wrap(beta + half);
  const a2 = wrap(beta - half);
  return guess + (Math.abs(a1) < Math.abs(a2) ? a1 : a2);
}

export type LoadResult = { plate: PlateTravel; hands: { L: "open" | "relaxed"; R: "open" | "relaxed" }; gripping: boolean };

/**
 * Poses the loader at action time t for `spec`. Before `handsOn` and after the release it is the standing pose
 * (`poseStand`'s), so a shot can open and close on it.
 */
export function poseLoad(rig: Rig, t: number, spec: LoadSpec): LoadResult {
  rig.resetPose();
  ctx.begin(rig);
  const b = rig.bones;
  const s = setupFor(rig);
  const { m, k } = s;
  const plate = plateTravel(spec, t);

  // Weights: reach down and set the hands, the push, then up and off.
  const set = smootherstep01((t - (spec.handsOn - 0.18)) / 0.3);
  const off = smootherstep01((t - spec.release) / 0.34);
  const engaged = set * (1 - off);
  const grip = gripAt(spec, t);
  const drive = bump(spec.push - 0.05, spec.seat + 0.05, t);

  // Feet: square stance, then the lead (left) foot steps in with the push; the rear heel stays down.
  const stepU = smootherstep01((t - spec.push + 0.06) / 0.26);
  const footZ = { L: 0.04 * k + spec.step * stepU, R: -0.06 * k };
  const lift = { L: bump(spec.push - 0.06, spec.push + 0.2, t), R: 0 };

  // Spine: flexes a little into the push (a flat back, not a curl), chest up as the hands come off.
  quatXYZ(0.1 * engaged + 0.04 * drive, 0, 0, b.spine.quaternion);
  quatXYZ(0.08 * engaged - 0.03 * off, 0, 0, b.chest.quaternion);
  for (const side of ["L", "R"] as const) setShoulderGirdle(rig, side, 0.08 * engaged, -0.02 * engaged);

  // Hips: from standing to the push height, travelling with the plate; the pitch is solved for the hands' reach.
  _hands.set(0, spec.height + spec.radius * Math.cos(spec.gripAngle), plate.z - 0.05);
  const pushY = s.standY * spec.sink;
  const hipY = lerp(s.standY, pushY + 0.015 * k * Math.sin(t * 9 + spec.seed) * drive, engaged);
  const hipZ = lerp(0, plate.z - 0.62 * k - 0.04 * drive, engaged) + 0.5 * footZ.L * stepU * (1 - engaged);
  _mid.set(0, hipY, hipZ);
  shouldersFromHips(rig, s, _w);
  _d.subVectors(_hands, _mid);
  const solved = solvePitch(_w, _d, s.reach * 0.9, 1.0);
  const pitch = lerp(0.03, THREE.MathUtils.clamp(solved, 0.2, 1.35), engaged);
  quatXYZ(pitch, 0, 0, _q);
  _v.copy(s.hipMid).sub(m.hips).applyQuaternion(_q);
  b.root.position.set(0, 0, 0);
  b.hips.position.subVectors(_mid, _v);
  b.hips.quaternion.copy(_q);

  // Legs: flat feet, toes out a touch, knees tracking over the toes.
  for (const side of ["L", "R"] as const) {
    const sx = side === "L" ? 1 : -1;
    const fm = m.foot[side];
    _ground.set(sx * 0.13 * k, 0, fm.ballGround.z + footZ[side]);
    const yaw = sx * 0.16;
    flatAnkle(fm, _ground, yaw, _ankle);
    _ankle.y += 0.06 * k * lift[side];
    _q.setFromAxisAngle(AY, yaw);
    _q2.setFromAxisAngle(AX, -0.2 * lift[side]);
    _q.multiply(_q2);
    ctx.bonePos(`upperLeg_${side}`, _hip);
    _pole.set(Math.sin(yaw) + sx * 0.2, 0.1, Math.cos(yaw)).multiplyScalar(2 * m.leg).add(_hip);
    ctx.ik(`leg_${side}`, _ankle, _pole, { maxExtension: 0.9995 }, _q);
  }

  // Arms: palms flat on the plate's near face (fingers up and out, the heel of the hand low), blended from the hang.
  const L = m.handLength;
  for (const side of ["L", "R"] as const) {
    const sx = side === "L" ? 1 : -1;
    armSwingTarget(ctx, rig, side, _arm, _free, _pole);
    _hq.copy(s.rest[side]);
    if (engaged > 0) {
      const angle = spec.gripAngle;
      _palm.set(sx * spec.radius * Math.sin(angle) * 0.92, spec.height + spec.radius * Math.cos(angle) * 0.92, plate.z - 0.045);
      // Palm faces +z (into the plate), fingers along the rim tangent pointing up and out.
      handRotation(rig, side, _v.set(sx * Math.sin(angle) * 0.5, 0.86, 0.12).normalize(), _d.set(0, -0.12, 1).normalize(), _push);
      const fb = handBindFrame(rig, side);
      _wrist.copy(fb.finger).applyQuaternion(_push).multiplyScalar(-0.45 * L).add(_palm);
      _wrist.add(_v.copy(fb.palm).applyQuaternion(_push).multiplyScalar(-0.018 * k));
      const g = smootherstep01(engaged);
      _free.lerp(_wrist, g);
      ctx.bonePos(`upperArm_${side}`, _sh);
      _pole.lerp(_v.copy(_sh).add(_d.set(sx * 0.55, -0.25, -0.35)), g);
      _hq.slerp(_push, g);
    }
    ctx.ik(`arm_${side}`, _free, _pole, { maxExtension: 0.9999, twistToLower: 0.5 }, _hq);
  }

  // Head: eyes on the plate while it moves, then up to the bar's middle as it seats.
  const gaze = lerp(0.12, 0.62, engaged) - 0.18 * ramp(spec.seat, spec.seat + 0.3, t) * (1 - off);
  stabiliseHead(ctx, rig, gaze, 0, 0.5);
  updateHelperBones(rig);
  const open = grip > 0.4 ? "open" : "relaxed";
  return { plate, hands: { L: open, R: open }, gripping: grip > 0.5 };
}

/**
 * Standing by the bar: weight settled, arms hanging, breathing. `shift` (-1..1) moves the weight onto one leg.
 * A pure function of time (the breath and a slow sway come from `time`).
 */
export function poseStand(rig: Rig, time: number, options: { seed: number; shift?: number; breath?: number }) {
  rig.resetPose();
  ctx.begin(rig);
  const b = rig.bones;
  const s = setupFor(rig);
  const { m, k } = s;
  const sway = 0.006 * k * Math.sin(time * 0.9 + options.seed) + 0.025 * k * (options.shift ?? 0);
  quatXYZ(-0.02, 0, 0, b.spine.quaternion);
  quatXYZ(-0.03, 0, 0, b.chest.quaternion);
  _mid.set(sway, s.standY - 0.006 * k * Math.abs(options.shift ?? 0), 0.005);
  quatXYZ(0.03, 0, 0.03 * (options.shift ?? 0), _q);
  _v.copy(s.hipMid).sub(m.hips).applyQuaternion(_q);
  b.root.position.set(0, 0, 0);
  b.hips.position.subVectors(_mid, _v);
  b.hips.quaternion.copy(_q);
  for (const side of ["L", "R"] as const) {
    const sx = side === "L" ? 1 : -1;
    const fm = m.foot[side];
    _ground.set(sx * 0.12 * k, 0, fm.ballGround.z + (side === "L" ? 0.05 * k : -0.04 * k));
    const yaw = sx * 0.14;
    flatAnkle(fm, _ground, yaw, _ankle);
    _q.setFromAxisAngle(AY, yaw);
    ctx.bonePos(`upperLeg_${side}`, _hip);
    _pole.set(Math.sin(yaw) + sx * 0.2, 0.1, Math.cos(yaw)).multiplyScalar(2 * m.leg).add(_hip);
    ctx.ik(`leg_${side}`, _ankle, _pole, { maxExtension: 0.9995 }, _q);
  }
  for (const side of ["L", "R"] as const) {
    setShoulderGirdle(rig, side, 0, -0.01);
    armSwingTarget(ctx, rig, side, _arm, _free, _pole);
    ctx.ik(`arm_${side}`, _free, _pole, { maxExtension: 0.9999, twistToLower: 0.5 }, s.rest[side]);
  }
  stabiliseHead(ctx, rig, 0.3, 0, 0.5);
  if (options.breath ?? 1) applyBreath(rig, time, options.breath ?? 1, { phase: options.seed * 0.37 });
  updateHelperBones(rig);
}
