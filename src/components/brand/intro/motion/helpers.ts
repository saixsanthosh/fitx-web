/**
 * Shared plumbing for the motion drivers (main thread, `three`). OWNER: motion agent.
 *
 * Drivers author everything in MODEL space: the space of the rig root's parent (the
 * character group the director places at a set anchor). `PoseContext` converts to world space
 * only where the IK needs it, so a driver's local rotations never depend on where the group
 * is in the scene.
 */

import * as THREE from "three";
import { pointOf, type BoneName } from "../rig/skeleton";
import type { Rig } from "../rig/three-rig";
import { solveTwoBoneIK, type LimbChain, type TwoBoneIKOptions, type TwoBoneIKResult } from "../rig/ik";
import { clamp01 } from "../math";

const IDENTITY_Q = new THREE.Quaternion();

/** Sets elbow/knee helper bones to half of the lower segment's local rotation. Call last. */
export function updateHelperBones(rig: Rig) {
  const b = rig.bones;
  b.elbowHelper_L.quaternion.copy(IDENTITY_Q).slerp(b.lowerArm_L.quaternion, 0.5);
  b.elbowHelper_R.quaternion.copy(IDENTITY_Q).slerp(b.lowerArm_R.quaternion, 0.5);
  b.kneeHelper_L.quaternion.copy(IDENTITY_Q).slerp(b.lowerLeg_L.quaternion, 0.5);
  b.kneeHelper_R.quaternion.copy(IDENTITY_Q).slerp(b.lowerLeg_R.quaternion, 0.5);
}

// ---------------------------------------------------------------------------------------------
// Rig measurements (bind pose), cached per rig.

export interface FootMetrics {
  /** Bind positions (model space, character standing at the origin). */
  ankle: THREE.Vector3;
  ball: THREE.Vector3;
  toeTip: THREE.Vector3;
  heel: THREE.Vector3;
  /** Ground contact points under heel / ball / toe tip (y = 0). */
  heelGround: THREE.Vector3;
  ballGround: THREE.Vector3;
  tipGround: THREE.Vector3;
}

export interface RigMetrics {
  height: number;
  sole: number;
  thigh: number;
  shin: number;
  leg: number;
  upperArm: number;
  forearm: number;
  /** Wrist → finger tip. */
  handLength: number;
  hipJoint: { L: THREE.Vector3; R: THREE.Vector3 };
  hips: THREE.Vector3;
  shoulder: { L: THREE.Vector3; R: THREE.Vector3 };
  head: THREE.Vector3;
  eyeMid: THREE.Vector3;
  foot: { L: FootMetrics; R: FootMetrics };
  /** Height of the ball (MTP) joint above the ground in bind pose. */
  ballHeight: number;
}

const metricsCache = new WeakMap<Rig, RigMetrics>();

const v3 = (t: [number, number, number]) => new THREE.Vector3(t[0], t[1], t[2]);

export function rigMetrics(rig: Rig): RigMetrics {
  const cached = metricsCache.get(rig);
  if (cached) return cached;
  const bind = rig.bind;
  const p = (name: Parameters<typeof pointOf>[1]) => v3(pointOf(bind, name));
  const foot = (side: "L" | "R"): FootMetrics => {
    const ankle = p(`foot_${side}`);
    const ball = p(`toe_${side}`);
    const toeTip = p(`toeTip_${side}`);
    const heel = p(`heel_${side}`);
    // Heel contact sits slightly behind the heel landmark (rounded heel counter).
    const heelGround = new THREE.Vector3(heel.x, 0, heel.z - 0.004 * bind.proportions.height);
    const ballGround = new THREE.Vector3(ball.x, 0, ball.z);
    const tipGround = new THREE.Vector3(toeTip.x, 0, toeTip.z);
    return { ankle, ball, toeTip, heel, heelGround, ballGround, tipGround };
  };
  const len = (name: BoneName) => rig.bindLocal[name].length();
  const m: RigMetrics = {
    height: bind.proportions.height,
    sole: bind.proportions.soleHeight,
    thigh: len("lowerLeg_L"),
    shin: len("foot_L"),
    leg: len("lowerLeg_L") + len("foot_L"),
    upperArm: len("lowerArm_L"),
    forearm: len("hand_L"),
    handLength: p("handTip_L").distanceTo(p("hand_L")),
    hipJoint: { L: p("upperLeg_L"), R: p("upperLeg_R") },
    hips: p("hips"),
    shoulder: { L: p("upperArm_L"), R: p("upperArm_R") },
    head: p("head"),
    eyeMid: p("eyeMid"),
    foot: { L: foot("L"), R: foot("R") },
    ballHeight: p("toe_L").y,
  };
  metricsCache.set(rig, m);
  return m;
}

// ---------------------------------------------------------------------------------------------
// Model ↔ world conversion and bone access in model space.

const _scale = new THREE.Vector3();
const _tmpV = new THREE.Vector3();
const _tmpV2 = new THREE.Vector3();
const _tmpQ = new THREE.Quaternion();

/**
 * Per-call helper: caches the model → world transform of the rig's group so drivers can
 * author targets in model space. Re-`begin()` it at the start of every driver call.
 */
export class PoseContext {
  rig!: Rig;
  readonly matrix = new THREE.Matrix4();
  readonly inverse = new THREE.Matrix4();
  readonly quat = new THREE.Quaternion();
  readonly invQuat = new THREE.Quaternion();
  private readonly targetW = new THREE.Vector3();
  private readonly poleW = new THREE.Vector3();
  private readonly endW = new THREE.Quaternion();

  begin(rig: Rig) {
    this.rig = rig;
    const parent = rig.root.parent;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      this.matrix.copy(parent.matrixWorld);
    } else {
      this.matrix.identity();
    }
    this.inverse.copy(this.matrix).invert();
    this.matrix.decompose(_tmpV, this.quat, _scale);
    this.invQuat.copy(this.quat).invert();
    return this;
  }

  toWorld(v: THREE.Vector3, out: THREE.Vector3) {
    return out.copy(v).applyMatrix4(this.matrix);
  }

  toModel(v: THREE.Vector3, out: THREE.Vector3) {
    return out.copy(v).applyMatrix4(this.inverse);
  }

  quatToWorld(q: THREE.Quaternion, out: THREE.Quaternion) {
    return out.copy(this.quat).multiply(q);
  }

  quatToModel(q: THREE.Quaternion, out: THREE.Quaternion) {
    return out.copy(this.invQuat).multiply(q);
  }

  /** Model-space joint position of a bone. */
  bonePos(name: BoneName, out: THREE.Vector3) {
    const bone = this.rig.bones[name];
    bone.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(bone.matrixWorld).applyMatrix4(this.inverse);
  }

  /** Model-space rotation of a bone. */
  boneQuat(name: BoneName, out: THREE.Quaternion) {
    const bone = this.rig.bones[name];
    bone.updateWorldMatrix(true, false);
    bone.matrixWorld.decompose(_tmpV2, out, _scale);
    return out.premultiply(this.invQuat);
  }

  /** Sets a bone's local rotation from a desired model-space rotation. */
  setBoneQuat(name: BoneName, qModel: THREE.Quaternion) {
    const bone = this.rig.bones[name];
    const parent = bone.parent;
    if (!parent) {
      bone.quaternion.copy(qModel);
      return;
    }
    parent.updateWorldMatrix(true, false);
    parent.matrixWorld.decompose(_tmpV2, _tmpQ, _scale);
    // local = parentWorld⁻¹ · groupWorld · qModel
    bone.quaternion.copy(_tmpQ).invert().multiply(this.quat).multiply(qModel);
  }

  /** Two-bone IK with model-space target, pole and (optional) end rotation. */
  ik(chain: LimbChain, target: THREE.Vector3, pole: THREE.Vector3, opts: TwoBoneIKOptions = {}, endModel?: THREE.Quaternion): TwoBoneIKResult {
    this.toWorld(target, this.targetW);
    this.toWorld(pole, this.poleW);
    if (endModel) {
      this.quatToWorld(endModel, this.endW);
      return solveTwoBoneIK(this.rig, chain, this.targetW, this.poleW, { ...opts, endRotation: this.endW });
    }
    return solveTwoBoneIK(this.rig, chain, this.targetW, this.poleW, opts);
  }
}

// ---------------------------------------------------------------------------------------------
// Rotation builders. Bind frames are world-aligned, so for any bone: +X = character's left,
// +Y = up, +Z = forward. Positive X rotation pitches a vertical segment forward (spine
// flexion) and swings a hanging segment backward; positive Y turns towards the left; positive
// Z rolls the top of a vertical segment towards the character's right.

const _ex = new THREE.Quaternion();
const _ey = new THREE.Quaternion();
const _ez = new THREE.Quaternion();
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);

/** q = Rx(x) · Ry(y) · Rz(z) (intrinsic X then Y then Z). */
export function quatXYZ(x: number, y: number, z: number, out: THREE.Quaternion) {
  _ex.setFromAxisAngle(AX, x);
  _ey.setFromAxisAngle(AY, y);
  _ez.setFromAxisAngle(AZ, z);
  return out.copy(_ex).multiply(_ey).multiply(_ez);
}

/** q = Ry(y) · Rx(x) · Rz(z): yaw about the parent's vertical, then pitch, then roll. */
export function quatYXZ(x: number, y: number, z: number, out: THREE.Quaternion) {
  _ex.setFromAxisAngle(AX, x);
  _ey.setFromAxisAngle(AY, y);
  _ez.setFromAxisAngle(AZ, z);
  return out.copy(_ey).multiply(_ex).multiply(_ez);
}

/** Sets a bone's local rotation to Rx·Ry·Rz. */
export function setLocalXYZ(rig: Rig, bone: BoneName, x: number, y: number, z: number) {
  quatXYZ(x, y, z, rig.bones[bone].quaternion);
}

const _local = new THREE.Quaternion();
/** Post-multiplies a bone's local rotation by Rx·Ry·Rz (adds a rotation in the bone's own frame). */
export function addLocalXYZ(rig: Rig, bone: BoneName, x: number, y: number, z: number) {
  rig.bones[bone].quaternion.multiply(quatXYZ(x, y, z, _local));
}

// ---------------------------------------------------------------------------------------------
// Curves.

/** Cubic Hermite between p0 and p1 with tangents m0, m1 (in value per unit u), u in [0, 1]. */
export function hermite(p0: number, m0: number, p1: number, m1: number, u: number) {
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1;
}

/**
 * Piecewise cubic Hermite through keys (x ascending). Interior tangents are Catmull-Rom
 * (finite differences); end tangents can be given (value per unit x) or default to one-sided.
 */
export function spline(xs: readonly number[], ys: readonly number[], x: number, m0?: number, m1?: number) {
  const n = xs.length;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let i = 0;
  while (i < n - 2 && x > xs[i + 1]) i += 1;
  const x0 = xs[i];
  const x1 = xs[i + 1];
  const h = x1 - x0;
  const tangent = (k: number) => {
    if (k === 0) return m0 ?? (ys[1] - ys[0]) / (xs[1] - xs[0]);
    if (k === n - 1) return m1 ?? (ys[n - 1] - ys[n - 2]) / (xs[n - 1] - xs[n - 2]);
    return (ys[k + 1] - ys[k - 1]) / (xs[k + 1] - xs[k - 1]);
  };
  return hermite(ys[i], tangent(i) * h, ys[i + 1], tangent(i + 1) * h, (x - x0) / h);
}

/** Smooth 0 → 1 → 0 bump over [a, b] (sin² window). */
export function bump(a: number, b: number, x: number) {
  if (x <= a || x >= b) return 0;
  const s = Math.sin(((x - a) / (b - a)) * Math.PI);
  return s * s;
}

/** Ease that eases in and out over [a, b] (smootherstep). */
export function ramp(a: number, b: number, x: number) {
  const t = clamp01((x - a) / (b - a));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export const lerpAngle = (a: number, b: number, t: number) => a + (b - a) * t;

/** Signed angle of a vector in the sagittal (z forward, y up) plane, measured from straight down, positive forward. */
export function sagittalAngle(dz: number, dy: number) {
  return Math.atan2(dz, -dy);
}

export { AX, AY, AZ };
