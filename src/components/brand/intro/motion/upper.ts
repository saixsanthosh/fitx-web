/**
 * Upper-body building blocks shared by the drivers (main thread). OWNER: motion agent.
 * Arm swings are authored in the chest frame and realised with the analytic arm IK so the
 * elbow hinge (and therefore the palm orientation) stays anatomically consistent.
 */

import * as THREE from "three";
import type { Rig } from "../rig/three-rig";
import type { Side } from "./foot";
import { PoseContext, quatXYZ, rigMetrics } from "./helpers";

export interface ArmSwing {
  /** Shoulder flexion relative to the chest (rad, + forward, − backward). */
  flex: number;
  /** Elbow flexion (rad, 0 = straight). */
  elbow: number;
  /** Abduction away from the body in the frontal plane (rad). */
  abduct: number;
  /** Forearm yaw towards the midline (rad). */
  across: number;
}

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const DOWN = new THREE.Vector3(0, -1, 0);
const _qc = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _up = new THREE.Vector3();
const _fore = new THREE.Vector3();
const _sh = new THREE.Vector3();
const _hand = new THREE.Vector3();
const _elbow = new THREE.Vector3();
const _pole = new THREE.Vector3();

/** Shoulder-girdle (clavicle) protraction (+ forward) and elevation (+ up) for one side. */
export function setShoulderGirdle(rig: Rig, side: Side, protract: number, elevate: number) {
  const sx = side === "L" ? 1 : -1;
  quatXYZ(0, -sx * protract, sx * elevate, rig.bones[`shoulder_${side}`].quaternion);
}

/** Direction in the chest frame for a hanging segment swung by (flex, abduct). */
export function swingDirection(flex: number, abduct: number, sx: number, out: THREE.Vector3) {
  _qa.setFromAxisAngle(AX, -flex);
  _qb.setFromAxisAngle(AZ, sx * abduct);
  return out.copy(DOWN).applyQuaternion(_qb).applyQuaternion(_qa);
}

/**
 * Wrist target and elbow pole (model space) for chest-relative swing angles, from the current
 * pose of the chest and shoulder girdle. Does not touch the arm bones.
 */
export function armSwingTarget(ctx: PoseContext, rig: Rig, side: Side, arm: ArmSwing, outWrist: THREE.Vector3, outPole: THREE.Vector3) {
  const m = rigMetrics(rig);
  const sx = side === "L" ? 1 : -1;
  ctx.boneQuat("chest", _qc);
  ctx.bonePos(`upperArm_${side}`, _sh);
  swingDirection(arm.flex, arm.abduct, sx, _up);
  swingDirection(arm.flex + arm.elbow, arm.abduct * 0.5, sx, _fore);
  _qa.setFromAxisAngle(AY, -sx * arm.across);
  _fore.applyQuaternion(_qa);
  _elbow.copy(_up).multiplyScalar(m.upperArm).applyQuaternion(_qc).add(_sh);
  outWrist.copy(_fore).multiplyScalar(m.forearm).applyQuaternion(_qc).add(_elbow);
  // Elbow points back (and a little out) relative to the swinging upper arm.
  _qa.setFromAxisAngle(AX, -arm.flex);
  outPole.set(sx * 0.3, 0, -1).applyQuaternion(_qa).applyQuaternion(_qc).multiplyScalar(0.3).add(_elbow);
}

/**
 * Poses one arm from chest-relative swing angles. With `girdle` set, the clavicle follows the
 * swing (protraction ∝ flex); leave it undefined to keep the shoulder girdle as posed.
 * The hand keeps its current local rotation.
 */
export function poseArmSwing(ctx: PoseContext, rig: Rig, side: Side, arm: ArmSwing, girdle?: number) {
  if (girdle !== undefined) setShoulderGirdle(rig, side, girdle * arm.flex, 0.02 + 0.5 * girdle * Math.max(0, arm.flex));
  armSwingTarget(ctx, rig, side, arm, _hand, _pole);
  return ctx.ik(`arm_${side}`, _hand, _pole, { maxExtension: 0.9999 });
}

const _target = new THREE.Quaternion();
const _rel = new THREE.Quaternion();
const IDENTITY = new THREE.Quaternion();

/**
 * Keeps the head level in model space (sprinters stabilise the head against trunk rotation):
 * the head ends up looking along (pitch down `gazePitch`, yaw `gazeYaw`); `neckShare` of the
 * correction goes to the neck.
 */
export function stabiliseHead(ctx: PoseContext, rig: Rig, gazePitch: number, gazeYaw: number, neckShare = 0.45, roll = 0) {
  quatXYZ(0, gazeYaw, 0, _target);
  _target.multiply(quatXYZ(gazePitch, 0, roll, _qa));
  ctx.boneQuat("chest", _qc);
  _rel.copy(_qc).invert().multiply(_target);
  const neck = rig.bones.neck.quaternion;
  neck.copy(IDENTITY).slerp(_rel, neckShare);
  rig.bones.head.quaternion.copy(neck).invert().multiply(_rel);
}
