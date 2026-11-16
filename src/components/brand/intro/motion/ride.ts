/**
 * Seated pedalling on the road bike (main thread). OWNER: motion agent.
 *
 * Frame: the character group sits at the BIKE origin (floor under the bottom bracket), both
 * facing +Z. Crank convention shared with the bike prop:
 *   crankAngle (rad) = 0 when the RIGHT crank points forward (+Z), increasing with forward
 *   pedalling. The right pedal spindle is at
 *     (−pedalOffsetX, crankY − crankLength·sin a, crankZ + crankLength·cos a)
 *   and the left crank is opposite (a + π). Equivalently the crank assembly is rotated by
 *   +crankAngle about +X (right-hand rule) from a rest pose with the right arm along +Z.
 * The cleat sits on top of the pedal: the ball joint of the shoe is `PEDAL_STACK + ballHeight`
 * above the spindle along the shoe's up axis, so the pedal body should be rotated to the
 * returned `pedalPitch` (+ = toes down, about +X) to stay flush with the sole.
 */

import * as THREE from "three";
import { BIKE } from "../dimensions";
import type { Rig } from "../rig/three-rig";
import { TAU } from "../math";
import { PoseContext, quatXYZ, rigMetrics, updateHelperBones } from "./helpers";
import { GRIP_BAR, gripOffset, handRotation, type HandPoses } from "./hands";
import { setShoulderGirdle, stabiliseHead } from "./upper";
import type { Side } from "./foot";

export interface RideOptions {
  /** Pedalling cadence (default BIKE.cadenceRpm = 94). */
  cadenceRpm?: number;
  /** Crank angle at t = 0 (rad, default 0). */
  phase?: number;
  /** 0..1 scales the effort rock of hips/shoulders (default 1). */
  effort?: number;
}

export interface RideResult {
  /** Crank angle in [0, 2π) — see the module comment for the convention. */
  crankAngle: number;
  /** Shoe / pedal-body pitch per side (rad, + = toes down). */
  pedalPitch: { L: number; R: number };
  /** Model-space pedal spindle centres. */
  pedals: { L: THREE.Vector3; R: THREE.Vector3 };
  hands: HandPoses;
}

/** Cleat + pedal body height above the spindle axis (m). */
export const PEDAL_STACK = 0.012;

export function crankAngleAt(t: number, cadenceRpm: number = BIKE.cadenceRpm, phase = 0) {
  return phase + (TAU * cadenceRpm * t) / 60;
}

/** Model-space pedal spindle centre for one side at a crank angle. */
export function pedalSpindle(side: Side, crankAngle: number, out: THREE.Vector3) {
  const a = side === "R" ? crankAngle : crankAngle + Math.PI;
  return out.set(
    side === "R" ? -BIKE.pedalOffsetX : BIKE.pedalOffsetX,
    BIKE.crankCenter[1] - BIKE.crankLength * Math.sin(a),
    BIKE.crankCenter[2] + BIKE.crankLength * Math.cos(a),
  );
}

/**
 * Natural "ankling" through the stroke for one crank (a = that crank's angle): heel drops
 * in the power phase (~3 o'clock), toes point down through the bottom and the upstroke.
 */
export function pedalFootPitch(a: number) {
  return 0.3 - 0.19 * Math.cos(a) + 0.07 * Math.sin(a);
}

const ctx = new PoseContext();
const AX = new THREE.Vector3(1, 0, 0);
const _q = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _spindle = new THREE.Vector3();
const _up = new THREE.Vector3();
const _ankle = new THREE.Vector3();
const _hip = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _hood = new THREE.Vector3();
const _f = new THREE.Vector3();
const _n = new THREE.Vector3();
const _hq = new THREE.Quaternion();
const _off = new THREE.Vector3();
const _wrist = new THREE.Vector3();
const _sh = new THREE.Vector3();

export function poseRide(rig: Rig, t: number, opts: RideOptions = {}): RideResult {
  rig.resetPose();
  ctx.begin(rig);
  const b = rig.bones;
  const m = rigMetrics(rig);
  const k = m.height / 1.8;
  const crank = crankAngleAt(t, opts.cadenceRpm ?? BIKE.cadenceRpm, opts.phase ?? 0);
  const effort = opts.effort ?? 1;
  // Right power phase peaks with the right crank at ~4:30.
  const stroke = Math.cos(crank - Math.PI / 4);
  const stroke2 = Math.cos(2 * (crank - Math.PI / 4));

  // Pelvis on the saddle, tilted forward; a small effort rock towards the pushing leg.
  const roll = 0.03 * effort * stroke;
  const yaw = 0.025 * effort * stroke;
  const pitch = 0.62;
  quatXYZ(pitch, yaw, roll, _q);
  _mid.set(0, BIKE.saddleTop[1] + 0.1 * k - 0.004 * effort * stroke2, BIKE.saddleTop[2] + 0.035);
  _pos.addVectors(m.hipJoint.L, m.hipJoint.R).multiplyScalar(0.5).sub(m.hips).applyQuaternion(_q);
  b.root.position.set(0, 0, 0);
  b.hips.position.subVectors(_mid, _pos);
  b.hips.quaternion.copy(_q);
  // Rounded back (lumbar + thoracic flexion) so the torso sits ~40° above horizontal.
  quatXYZ(0.22, -0.7 * yaw, -0.8 * roll, b.spine.quaternion);
  quatXYZ(0.18 + 0.012 * effort * stroke2, -0.9 * yaw, -0.5 * roll, b.chest.quaternion);

  // Legs: the cleat locked to the spindle, the shoe pitched by the ankling curve.
  const pitchOut = { L: 0, R: 0 };
  const pedals = { L: new THREE.Vector3(), R: new THREE.Vector3() };
  for (const side of ["L", "R"] as const) {
    const a = side === "R" ? crank : crank + Math.PI;
    const footPitch = pedalFootPitch(a);
    pitchOut[side] = footPitch;
    pedalSpindle(side, crank, _spindle);
    pedals[side].copy(_spindle);
    _q.setFromAxisAngle(AX, footPitch);
    _up.set(0, 1, 0).applyQuaternion(_q);
    const fm = m.foot[side];
    // Ball joint above the spindle, then the ankle from the rigid shoe.
    _ankle.copy(_spindle).addScaledVector(_up, PEDAL_STACK + m.ballHeight);
    _pos.subVectors(fm.ankle, fm.ball).applyQuaternion(_q);
    _ankle.add(_pos);
    ctx.bonePos(`upperLeg_${side}`, _hip);
    const sx = side === "L" ? 1 : -1;
    _pole.set(sx * 0.12, 0.25, 1).multiplyScalar(2 * m.leg).add(_hip);
    ctx.ik(`leg_${side}`, _ankle, _pole, { maxExtension: 0.9995 }, _q);
  }

  // Hands on the hoods, elbows soft and slightly out.
  for (const side of ["L", "R"] as const) {
    const sx = side === "L" ? 1 : -1;
    setShoulderGirdle(rig, side, 0.1, 0.03);
    const h = BIKE.hoods[side === "L" ? 0 : 1];
    _hood.set(h[0], h[1], h[2]);
    _f.set(0, -0.5, 0.87);
    _n.set(-sx * 0.85, -0.5, 0);
    handRotation(rig, side, _f, _n, _hq);
    gripOffset(rig, side, _hq, GRIP_BAR, _off);
    _wrist.subVectors(_hood, _off);
    ctx.bonePos(`upperArm_${side}`, _sh);
    _pole.addVectors(_sh, _wrist).multiplyScalar(0.5).add(_off.set(sx * 0.35, -0.25, -0.2));
    ctx.ik(`arm_${side}`, _wrist, _pole, { maxExtension: 0.9995, twistToLower: 0.5 }, _hq);
  }

  // Head up, eyes on the road ahead; tiny counter-roll keeps the gaze level.
  stabiliseHead(ctx, rig, 0.16, 0, 0.5, -0.4 * roll);
  updateHelperBones(rig);
  const wrapped = ((crank % TAU) + TAU) % TAU;
  return { crankAngle: wrapped, pedalPitch: pitchOut, pedals, hands: { L: "grip", R: "grip" } };
}
