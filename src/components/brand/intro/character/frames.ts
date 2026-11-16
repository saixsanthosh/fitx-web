/**
 * Bind-pose anatomical frames shared by the body sculpt, clothing and skinning (worker-safe:
 * no `three`, no DOM). OWNER: character-body.
 *
 * Every limb gets an orthonormal frame: `dir` runs down the bone, `front` is the character's
 * forward (+Z) made orthogonal to `dir`, and `out` points laterally away from the midline
 * (so formulas written once with `out` work for both sides).
 */

import { bonePosition, type BindPose, type BoneName, type LandmarkName } from "../rig/skeleton";
import type { Vec3Tuple } from "../types";

export type V3 = Vec3Tuple;
export type Quat = [number, number, number, number];
export type Side = "L" | "R";

export const v3add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const v3sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const v3scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const v3dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const v3len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const v3cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const v3norm = (a: V3): V3 => {
  const l = v3len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const v3lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** a + Σ vᵢ·sᵢ for pairs (v, s). */
export function v3comb(a: V3, ...terms: Array<[V3, number]>): V3 {
  let x = a[0], y = a[1], z = a[2];
  for (const [v, s] of terms) {
    x += v[0] * s;
    y += v[1] * s;
    z += v[2] * s;
  }
  return [x, y, z];
}

/** Quaternion [x, y, z, w] of the rotation whose columns are the orthonormal basis (x, y, z). */
export function basisQuat(x: V3, y: V3, z: V3): Quat {
  const m00 = x[0], m01 = y[0], m02 = z[0];
  const m10 = x[1], m11 = y[1], m12 = z[1];
  const m20 = x[2], m21 = y[2], m22 = z[2];
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}

/** Rotation taking local +Y to `up` and local +Z as close as possible to `front`. */
export function frameQuat(up: V3, front: V3 = [0, 0, 1]): Quat {
  const y = v3norm(up);
  let z = v3sub(front, v3scale(y, v3dot(front, y)));
  if (v3len(z) < 1e-6) z = Math.abs(y[0]) < 0.9 ? v3cross([1, 0, 0], y) : v3cross([0, 1, 0], y);
  z = v3norm(z);
  const x = v3cross(y, z);
  return basisQuat(x, y, z);
}

export interface LimbFrame {
  side: Side;
  /** +1 for the character's left (+X), -1 for the right. */
  sx: number;
  /** Upper joint (shoulder / hip), middle joint (elbow / knee), end joint (wrist / ankle). */
  a: V3;
  b: V3;
  c: V3;
  /** Unit directions of the upper and lower segments. */
  dirU: V3;
  dirL: V3;
  lenU: number;
  lenL: number;
  /** Forward (+Z-ish) and lateral (away from the midline) unit vectors, orthogonal to dirU. */
  front: V3;
  out: V3;
  /** Same for the lower segment. */
  frontL: V3;
  outL: V3;
}

function limbFrame(bind: BindPose, side: Side, upper: BoneName, middle: BoneName, end: BoneName): LimbFrame {
  const sx = side === "L" ? 1 : -1;
  const a = bonePosition(bind, upper);
  const b = bonePosition(bind, middle);
  const c = bonePosition(bind, end);
  const u = v3sub(b, a);
  const l = v3sub(c, b);
  const dirU = v3norm(u);
  const dirL = v3norm(l);
  const orth = (dir: V3) => {
    const front = v3norm(v3sub([0, 0, 1], v3scale(dir, dir[2])));
    const out = v3scale(v3norm(v3cross(front, dir)), sx);
    return { front, out };
  };
  const fu = orth(dirU);
  const fl = orth(dirL);
  return { side, sx, a, b, c, dirU, dirL, lenU: v3len(u), lenL: v3len(l), front: fu.front, out: fu.out, frontL: fl.front, outL: fl.out };
}

export interface BodyFrames {
  bind: BindPose;
  H: number;
  female: boolean;
  joint: (name: BoneName) => V3;
  mark: (name: LandmarkName) => V3;
  arm: Record<Side, LimbFrame>;
  leg: Record<Side, LimbFrame>;
}

export function bodyFrames(bind: BindPose): BodyFrames {
  return {
    bind,
    H: bind.proportions.height,
    female: bind.proportions.sex === "female",
    joint: (name) => bonePosition(bind, name),
    mark: (name) => bind.landmarks[name],
    arm: {
      L: limbFrame(bind, "L", "upperArm_L", "lowerArm_L", "hand_L"),
      R: limbFrame(bind, "R", "upperArm_R", "lowerArm_R", "hand_R"),
    },
    leg: {
      L: limbFrame(bind, "L", "upperLeg_L", "lowerLeg_L", "foot_L"),
      R: limbFrame(bind, "R", "upperLeg_R", "lowerLeg_R", "foot_R"),
    },
  };
}
