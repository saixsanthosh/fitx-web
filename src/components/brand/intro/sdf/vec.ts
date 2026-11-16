/**
 * Tiny vector / quaternion helpers on plain tuples (worker-safe). Each call allocates its
 * result, which is fine while *building* sculpts; the toolkit's hot loops use scalar math.
 *
 * Quaternions are unit [x, y, z, w] and follow three.js conventions exactly
 * (`quatMultiply(a, b)` = `Quaternion.multiplyQuaternions(a, b)`: apply b, then a).
 */

import type { Quat, V3 } from "./api";

/** Builds a vector (defaults to the origin). */
export const v3 = (x = 0, y = 0, z = 0): V3 => [x, y, z];

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];

/** a + b * s. */
export const addScaled = (a: V3, b: V3, s: number): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Right-handed cross product a × b. */
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const length = (a: V3): number => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);

export const distance = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Unit vector along `a`; the zero vector stays [0, 0, 0]. */
export const normalize = (a: V3): V3 => {
  const len = length(a);
  return len > 0 ? [a[0] / len, a[1] / len, a[2] / len] : [0, 0, 0];
};

/** Component-wise a + (b - a) * t. */
export const lerp = (a: V3, b: V3, t: number): V3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export const quatIdentity = (): Quat => [0, 0, 0, 1];

/** Rotation of `angle` radians about `axis` (normalised internally; right-hand rule). */
export function quatFromAxisAngle(axis: V3, angle: number): Quat {
  const len = length(axis) || 1;
  const s = Math.sin(angle / 2) / len;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

/** Shortest rotation taking direction `from` to direction `to` (both normalised internally). */
export function quatFromUnitVectors(from: V3, to: V3): Quat {
  const f = normalize(from);
  const t = normalize(to);
  let r = dot(f, t) + 1;
  let q: Quat;
  if (r < 1e-8) {
    // Opposite vectors: rotate 180° about any axis perpendicular to `from`.
    r = 0;
    q = Math.abs(f[0]) > Math.abs(f[2]) ? [-f[1], f[0], 0, r] : [0, -f[2], f[1], r];
  } else {
    const c = cross(f, t);
    q = [c[0], c[1], c[2], r];
  }
  const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

/** Euler angles in radians, XYZ order (same as `new THREE.Euler(x, y, z, "XYZ")`). */
export function quatFromEuler(x: number, y: number, z: number): Quat {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

/** Hamilton product a ⊗ b: rotating by the result applies `b` first, then `a`. */
export function quatMultiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    ax * bw + aw * bx + ay * bz - az * by,
    ay * bw + aw * by + az * bx - ax * bz,
    az * bw + aw * bz + ax * by - ay * bx,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Inverse rotation (conjugate divided by |q|², so slightly non-unit inputs still invert). */
export function quatInvert(q: Quat): Quat {
  const n = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3] || 1;
  return [-q[0] / n, -q[1] / n, -q[2] / n, q[3] / n];
}

/** Rotates `v` by unit quaternion `q`. */
export function rotateVec(q: Quat, v: V3): V3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  // t = 2 * cross(q.xyz, v); v' = v + w * t + cross(q.xyz, t)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + qy * tz - qz * ty,
    vy + qw * ty + qz * tx - qx * tz,
    vz + qw * tz + qx * ty - qy * tx,
  ];
}

/**
 * Row-major 3×3 rotation matrix of a unit quaternion: world = M · local. Used by rotated
 * primitives, which evaluate in local space via Mᵀ.
 */
export function quatToMat3(q: Quat): Float64Array {
  const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  const x = q[0] / len, y = q[1] / len, z = q[2] / len, w = q[3] / len;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return new Float64Array([
    1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy),
    2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx),
    2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy),
  ]);
}
