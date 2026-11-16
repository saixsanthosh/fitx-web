/**
 * Analytic limb IK and aim helpers (main thread, `three`). OWNER: motion agent.
 *
 * Every bone has an identity bind rotation (see `rig/skeleton.ts`), so a bone's bind-local
 * offset is also its bind *world* direction. The solvers below therefore express every
 * orientation as "map this bind-space frame onto that world-space frame" and convert to a
 * parent-relative quaternion at the end. All functions read the current pose of the chain's
 * ancestors (call them top-down: hips/spine/chest first, then limbs).
 *
 * Elbows and knees are solved as true hinges: the lower segment rotates about the bind hinge
 * axis only (plus a sub-degree correction for the bind-pose offsets), so skinned knees and
 * elbows fold the way the mesh was sculpted. The bend plane comes from the pole target.
 */

import * as THREE from "three";
import type { BoneName } from "./skeleton";
import type { Rig } from "./three-rig";

export type LimbChain = "arm_L" | "arm_R" | "leg_L" | "leg_R";

export interface LimbChainBones {
  upper: BoneName;
  lower: BoneName;
  end: BoneName;
  kind: "arm" | "leg";
  side: "L" | "R";
}

export const LIMB_CHAINS: Record<LimbChain, LimbChainBones> = {
  arm_L: { upper: "upperArm_L", lower: "lowerArm_L", end: "hand_L", kind: "arm", side: "L" },
  arm_R: { upper: "upperArm_R", lower: "lowerArm_R", end: "hand_R", kind: "arm", side: "R" },
  leg_L: { upper: "upperLeg_L", lower: "lowerLeg_L", end: "foot_L", kind: "leg", side: "L" },
  leg_R: { upper: "upperLeg_R", lower: "lowerLeg_R", end: "foot_R", kind: "leg", side: "R" },
};

export interface TwoBoneIKOptions {
  /**
   * Desired WORLD rotation of the end bone (hand / foot). Identity means "bind orientation in
   * world space". Without it the end bone keeps its current local rotation (usually identity,
   * i.e. it continues the lower segment).
   */
  endRotation?: THREE.Quaternion;
  /** 0..1 blend from the inherited end orientation to `endRotation` (default 1). */
  endWeight?: number;
  /** Largest allowed extension as a fraction of the chain length (default 0.9995). */
  maxExtension?: number;
  /**
   * Fraction (0..1) of the end bone's twist about the lower segment that is moved into the
   * lower bone (forearm pronation/supination). Default 0: pure hinge, all twist in the wrist.
   */
  twistToLower?: number;
}

export interface TwoBoneIKResult {
  /** Flexion at the middle joint in radians (0 = straight). */
  flexion: number;
  /** Distance between the solved end joint and the requested target (0 when reachable). */
  error: number;
  reachable: boolean;
}

interface ChainBind {
  l1: number;
  l2: number;
  u0: THREE.Vector3;
  l0: THREE.Vector3;
  /** Bind hinge axis, orthonormal to u0 (positive rotation = flexion). */
  h0: THREE.Vector3;
  /** Bind hinge axis orthonormalised against l0. */
  h0l: THREE.Vector3;
  /** Bind pole direction (towards which the middle joint protrudes). */
  pole0: THREE.Vector3;
  /** Inverse of the bind frame quaternions (u0,h0) and (l0,h0l). */
  invUpperFrame: THREE.Quaternion;
  invLowerFrame: THREE.Quaternion;
}

const chainCache = new WeakMap<Rig, Partial<Record<LimbChain, ChainBind>>>();

const _m = new THREE.Matrix4();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

/** Quaternion of the orthonormal frame whose columns are (x, y, x × y). */
export function frameQuaternion(x: THREE.Vector3, y: THREE.Vector3, out: THREE.Quaternion) {
  _c.crossVectors(x, y);
  _m.makeBasis(x, y, _c);
  return out.setFromRotationMatrix(_m);
}

function chainBind(rig: Rig, chain: LimbChain): ChainBind {
  let perRig = chainCache.get(rig);
  if (!perRig) {
    perRig = {};
    chainCache.set(rig, perRig);
  }
  const cached = perRig[chain];
  if (cached) return cached;
  const def = LIMB_CHAINS[chain];
  const lowerLocal = rig.bindLocal[def.lower];
  const endLocal = rig.bindLocal[def.end];
  const u0 = lowerLocal.clone().normalize();
  const l0 = endLocal.clone().normalize();
  // Knees protrude forward (+Z), elbows backward (-Z). Hinge = pole × segment, so a positive
  // rotation about it folds the lower segment away from the pole (flexion).
  const pole0 = new THREE.Vector3(0, 0, def.kind === "leg" ? 1 : -1);
  const h0 = new THREE.Vector3().crossVectors(pole0, u0).normalize();
  const h0l = h0.clone().addScaledVector(l0, -h0.dot(l0)).normalize();
  const invUpperFrame = frameQuaternion(u0, h0, new THREE.Quaternion()).invert();
  const invLowerFrame = frameQuaternion(l0, h0l, new THREE.Quaternion()).invert();
  const bind: ChainBind = { l1: lowerLocal.length(), l2: endLocal.length(), u0, l0, h0, h0l, pole0, invUpperFrame, invLowerFrame };
  perRig[chain] = bind;
  return bind;
}

/** Segment lengths of a limb chain (upper, lower) in meters. */
export function limbLengths(rig: Rig, chain: LimbChain) {
  const bind = chainBind(rig, chain);
  return { upper: bind.l1, lower: bind.l2, total: bind.l1 + bind.l2 };
}

const _parentPos = new THREE.Vector3();
const _parentQuat = new THREE.Quaternion();
const _parentScale = new THREE.Vector3();

/** World position and rotation of `bone`'s parent (identity for a parentless bone). */
export function parentWorldTransform(bone: THREE.Object3D, outPos: THREE.Vector3, outQuat: THREE.Quaternion) {
  const parent = bone.parent;
  if (!parent) {
    outPos.set(0, 0, 0);
    outQuat.identity();
    return;
  }
  parent.updateWorldMatrix(true, false);
  parent.matrixWorld.decompose(outPos, outQuat, _parentScale);
}

/** World position of a bone's joint (updates its ancestors' world matrices). */
export function boneWorldPosition(bone: THREE.Object3D, out: THREE.Vector3) {
  bone.updateWorldMatrix(true, false);
  return out.setFromMatrixPosition(bone.matrixWorld);
}

/** World rotation of a bone (updates its ancestors' world matrices). */
export function boneWorldQuaternion(bone: THREE.Object3D, out: THREE.Quaternion) {
  bone.updateWorldMatrix(true, false);
  bone.matrixWorld.decompose(_a, out, _b);
  return out;
}

/** Sets a bone's local rotation so that its world rotation becomes `worldQuat`. */
export function setBoneWorldQuaternion(bone: THREE.Object3D, worldQuat: THREE.Quaternion) {
  parentWorldTransform(bone, _parentPos, _parentQuat);
  bone.quaternion.copy(_parentQuat).invert().multiply(worldQuat);
}

const _from = new THREE.Quaternion();
const _to = new THREE.Quaternion();

/**
 * World rotation that maps a bind-space frame (`bindDir`, `bindRef`) onto a world frame
 * (`dir`, `ref`). Reference vectors are orthogonalised against their directions.
 */
export function mapFrame(
  bindDir: THREE.Vector3,
  bindRef: THREE.Vector3,
  dir: THREE.Vector3,
  ref: THREE.Vector3,
  out: THREE.Quaternion,
) {
  const x0 = _a.copy(bindDir).normalize();
  const y0 = _b.copy(bindRef).addScaledVector(x0, -bindRef.dot(x0)).normalize();
  frameQuaternion(x0, y0, _from);
  const x1 = _a.copy(dir).normalize();
  const y1 = _b.copy(ref).addScaledVector(x1, -ref.dot(x1)).normalize();
  frameQuaternion(x1, y1, _to);
  return out.copy(_to).multiply(_from.invert());
}

const _dir = new THREE.Vector3();
const _cur = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * Swings a bone (shortest arc from its current orientation) so its bind segment, given by
 * the bind-local offset of `segmentEnd`, points along `dirWorld`. Returns the swing angle.
 * `weight` blends the swing (0 = unchanged).
 */
export function aimBone(rig: Rig, bone: BoneName, segmentEnd: BoneName | THREE.Vector3, dirWorld: THREE.Vector3, weight = 1) {
  const b = rig.bones[bone];
  const local = segmentEnd instanceof THREE.Vector3 ? segmentEnd : rig.bindLocal[segmentEnd];
  boneWorldQuaternion(b, _q);
  _cur.copy(local).normalize().applyQuaternion(_q);
  _dir.copy(dirWorld).normalize();
  const angle = Math.acos(THREE.MathUtils.clamp(_cur.dot(_dir), -1, 1));
  if (angle < 1e-6 || weight <= 0) return angle;
  _from.setFromUnitVectors(_cur, _dir);
  if (weight < 1) _from.slerp(_to.identity(), 1 - weight);
  _q.premultiply(_from);
  setBoneWorldQuaternion(b, _q);
  return angle;
}

const _pa = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _uNew = new THREE.Vector3();
const _lNew = new THREE.Vector3();
const _hNew = new THREE.Vector3();
const _elbow = new THREE.Vector3();
const _end = new THREE.Vector3();
const _R1 = new THREE.Quaternion();
const _R2 = new THREE.Quaternion();
const _tmpQ = new THREE.Quaternion();
const _endQ = new THREE.Quaternion();
const _twist = new THREE.Quaternion();

/**
 * Analytic two-bone IK for a limb.
 *
 * - `targetWorld`: where the end joint (wrist / ankle) should be.
 * - `poleWorld`: a point the middle joint (elbow / knee) should point towards; it fixes the
 *   bend plane and the upper segment's twist.
 * - Length preserving; an unreachable target leaves the limb straight (at `maxExtension`) and
 *   pointing at it; a target closer than |upper - lower| folds the limb as far as possible.
 */
export function solveTwoBoneIK(
  rig: Rig,
  chain: LimbChain,
  targetWorld: THREE.Vector3,
  poleWorld: THREE.Vector3,
  opts: TwoBoneIKOptions = {},
): TwoBoneIKResult {
  const def = LIMB_CHAINS[chain];
  const bind = chainBind(rig, chain);
  const upper = rig.bones[def.upper];
  const lower = rig.bones[def.lower];
  const end = rig.bones[def.end];

  parentWorldTransform(upper, _parentPos, _parentQuat);
  _pa.copy(upper.position).applyQuaternion(_parentQuat).add(_parentPos);

  const { l1, l2 } = bind;
  _d.subVectors(targetWorld, _pa);
  const dist = _d.length();
  const maxD = (l1 + l2) * (opts.maxExtension ?? 0.9995);
  const minD = Math.abs(l1 - l2) + 1e-4;
  const D = THREE.MathUtils.clamp(dist, minD, maxD);
  if (dist > 1e-9) _d.divideScalar(dist);
  else _d.set(0, -1, 0);

  // Pole direction orthogonal to the reach direction; fall back to the current bend plane.
  _p.subVectors(poleWorld, _pa);
  _p.addScaledVector(_d, -_p.dot(_d));
  if (_p.lengthSq() < 1e-10) {
    _tmpQ.copy(_parentQuat).multiply(upper.quaternion);
    _p.copy(bind.pole0).applyQuaternion(_tmpQ);
    _p.addScaledVector(_d, -_p.dot(_d));
    if (_p.lengthSq() < 1e-10) _p.set(0, 0, def.kind === "leg" ? 1 : -1).addScaledVector(_d, -_d.z * (def.kind === "leg" ? 1 : -1));
  }
  _p.normalize();

  const cosA = THREE.MathUtils.clamp((l1 * l1 + D * D - l2 * l2) / (2 * l1 * D), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _uNew.copy(_d).multiplyScalar(cosA).addScaledVector(_p, sinA);
  _elbow.copy(_pa).addScaledVector(_uNew, l1);
  _end.copy(_pa).addScaledVector(_d, D);
  _lNew.subVectors(_end, _elbow).normalize();
  _hNew.crossVectors(_p, _d).normalize();

  frameQuaternion(_uNew, _hNew, _R1).multiply(bind.invUpperFrame);
  frameQuaternion(_lNew, _hNew, _R2).multiply(bind.invLowerFrame);

  upper.quaternion.copy(_parentQuat).invert().multiply(_R1);
  lower.quaternion.copy(_R1).invert().multiply(_R2);

  if (opts.endRotation) {
    const w = opts.endWeight ?? 1;
    // Inherited orientation = current local rotation carried by the new lower rotation.
    _endQ.copy(_R2).multiply(end.quaternion);
    if (w >= 1) _endQ.copy(opts.endRotation);
    else if (w > 0) _endQ.slerp(opts.endRotation, w);
    end.quaternion.copy(_R2).invert().multiply(_endQ);
  }

  const twistShare = opts.twistToLower ?? 0;
  if (twistShare > 0) {
    // Swing-twist split of the end's local rotation about the lower segment axis l0.
    const q = end.quaternion;
    const proj = q.x * bind.l0.x + q.y * bind.l0.y + q.z * bind.l0.z;
    _twist.set(bind.l0.x * proj, bind.l0.y * proj, bind.l0.z * proj, q.w);
    const len = Math.hypot(_twist.x, _twist.y, _twist.z, _twist.w);
    if (len > 1e-9) {
      _twist.set(_twist.x / len, _twist.y / len, _twist.z / len, _twist.w / len);
      _tmpQ.identity().slerp(_twist, twistShare);
      lower.quaternion.multiply(_tmpQ);
      end.quaternion.premultiply(_tmpQ.invert());
    }
  }

  // Flexion = angle between the solved segments.
  const flexion = Math.acos(THREE.MathUtils.clamp(_uNew.dot(_lNew), -1, 1));
  return { flexion, error: Math.abs(dist - D), reachable: dist <= maxD + 1e-6 && dist >= minD - 1e-6 };
}

/**
 * Hinge-frame helpers for callers that need to know the bend plane the solver will use:
 * the bind pole direction of a chain (unit, bind/world space).
 */
export function chainBindPole(rig: Rig, chain: LimbChain) {
  return chainBind(rig, chain).pole0.clone();
}

/** Bind hinge axis of a chain (positive rotation about it = flexion). */
export function chainBindHinge(rig: Rig, chain: LimbChain) {
  return chainBind(rig, chain).h0.clone();
}

const _look = new THREE.Vector3();
const _up = new THREE.Vector3();

/**
 * World rotation that turns a bone whose bind "forward" is +Z and "up" is +Y (head, chest,
 * hips, feet) so its forward points along `forwardWorld` with `upWorld` as the up hint.
 */
export function lookRotation(forwardWorld: THREE.Vector3, upWorld: THREE.Vector3, out: THREE.Quaternion) {
  _look.copy(forwardWorld).normalize();
  _up.copy(upWorld).addScaledVector(_look, -upWorld.dot(_look));
  if (_up.lengthSq() < 1e-10) _up.set(0, 1, 0).addScaledVector(_look, -_look.y);
  _up.normalize();
  // Frame columns (x, y, z) = (up × forward, up, forward).
  _c.crossVectors(_up, _look);
  _m.makeBasis(_c, _up, _look);
  return out.setFromRotationMatrix(_m);
}
