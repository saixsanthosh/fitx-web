/**
 * SDF primitives (worker-safe). Meters; negative inside; tight bounds. Rotations are unit
 * quaternions [x, y, z, w] applied about `center`. All primitives are exact, 1-Lipschitz signed
 * distances except `ellipsoid` (a conservative bound, see there).
 *
 * Cost per evaluation inside a tree (Apple M3, V8): ~2-6 ns; rotation adds a 3×3 multiply.
 */

import type { Quat, Sdf, V3 } from "./api";
import { Node, RANGE as SHARED_RANGE, STACK as SHARED_STACK, aabb, boxBoxDist, type BatchEv, type Ev, type Region } from "./node";
import { quatToMat3 } from "./vec";

// Module-local aliases: bundlers and CJS loaders turn cross-module bindings into getter calls,
// which would run on every evaluation in the hot closures below.
const STACK = SHARED_STACK;
const RANGE = SHARED_RANGE;

const isIdentity = (q?: Quat) => !q || (Math.abs(q[0]) < 1e-12 && Math.abs(q[1]) < 1e-12 && Math.abs(q[2]) < 1e-12);

/** World half-extents of a local box with half-extents (hx, hy, hz) rotated by M (row-major). */
function rotatedHalfExtents(m: Float64Array, hx: number, hy: number, hz: number): [number, number, number] {
  return [
    Math.abs(m[0]) * hx + Math.abs(m[1]) * hy + Math.abs(m[2]) * hz,
    Math.abs(m[3]) * hx + Math.abs(m[4]) * hy + Math.abs(m[5]) * hz,
    Math.abs(m[6]) * hx + Math.abs(m[7]) * hy + Math.abs(m[8]) * hz,
  ];
}

const centered = (c: V3, e: [number, number, number]) => aabb(c[0] - e[0], c[1] - e[1], c[2] - e[2], c[0] + e[0], c[1] + e[1], c[2] + e[2]);

/** Sphere. Exact. */
export function sphere(center: V3, r: number): Sdf {
  const cx = center[0], cy = center[1], cz = center[2];
  const ev: Ev = (o) => {
    const dx = STACK[o] - cx, dy = STACK[o + 1] - cy, dz = STACK[o + 2] - cz;
    STACK[o + 3] = Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
  };
  // Exact range over a box: nearest point and farthest corner.
  const spec = (self: Node, g: Region) => {
    const nx = cx < g[0] ? g[0] - cx : cx > g[3] ? cx - g[3] : 0;
    const ny = cy < g[1] ? g[1] - cy : cy > g[4] ? cy - g[4] : 0;
    const nz = cz < g[2] ? g[2] - cz : cz > g[5] ? cz - g[5] : 0;
    const fx = Math.max(Math.abs(cx - g[0]), Math.abs(cx - g[3]));
    const fy = Math.max(Math.abs(cy - g[1]), Math.abs(cy - g[4]));
    const fz = Math.max(Math.abs(cz - g[2]), Math.abs(cz - g[5]));
    RANGE[0] = Math.sqrt(nx * nx + ny * ny + nz * nz) - r;
    RANGE[1] = Math.sqrt(fx * fx + fy * fy + fz * fz) - r;
    return self;
  };
  const bev: BatchEv = (px, py, pz, out, n) => {
    for (let i = 0; i < n; i += 1) {
      const dx = px[i] - cx, dy = py[i] - cy, dz = pz[i] - cz;
      out[i] = Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
    }
  };
  return new Node({ kind: "sphere", ev, bev, bounds: centered(center, [r, r, r]), spec });
}

/**
 * Ellipsoid with semi-axes `radii` (local X, Y, Z before `rotation`).
 *
 * Outside: Quilez's bound-corrected estimate k0·(k0−1)/k1 — unit gradient at the surface, so
 * blends and AO behave — raised to at least the distance to its bounding box. It never
 * over-estimates; for muscle-like 2–3:1 shapes it reads 4–8% short at 1 cm and 12–25% short at
 * 5 cm, and it is steeper than 1-Lipschitz far out for elongated shapes (the toolkit's region
 * ranges use the 1-Lipschitz minorant below, so pruning stays exact).
 * Inside: (k0−1)·minRadius (the bound-corrected form over-estimates depth for elongated shapes):
 * exact at the centre and along the shortest axis, conservative elsewhere.
 */
export function ellipsoid(center: V3, radii: V3, rotation?: Quat): Sdf {
  const cx = center[0], cy = center[1], cz = center[2];
  const rx = Math.max(radii[0], 1e-6), ry = Math.max(radii[1], 1e-6), rz = Math.max(radii[2], 1e-6);
  const ix = 1 / rx, iy = 1 / ry, iz = 1 / rz;
  const rmin = Math.min(rx, ry, rz);
  const rot = isIdentity(rotation) ? null : quatToMat3(rotation as Quat);
  const m = rot ?? new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3], m4 = m[4], m5 = m[5], m6 = m[6], m7 = m[7], m8 = m[8];
  // Exact world AABB of a rotated ellipsoid: sqrt(Σ_j (M_ij r_j)²) per axis.
  const ex = Math.hypot(m0 * rx, m1 * ry, m2 * rz);
  const ey = Math.hypot(m3 * rx, m4 * ry, m5 * rz);
  const ez = Math.hypot(m6 * rx, m7 * ry, m8 * rz);
  const evAxis: Ev = (o) => {
    const lx = STACK[o] - cx, ly = STACK[o + 1] - cy, lz = STACK[o + 2] - cz;
    const ax = lx * ix, ay = ly * iy, az = lz * iz;
    const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
    if (k0 < 1) { STACK[o + 3] = (k0 - 1) * rmin; return; }
    const bx = ax * ix, by = ay * iy, bz = az * iz;
    const v = (k0 * (k0 - 1)) / Math.sqrt(bx * bx + by * by + bz * bz);
    const qx = (lx < 0 ? -lx : lx) - rx, qy = (ly < 0 ? -ly : ly) - ry, qz = (lz < 0 ? -lz : lz) - rz;
    if (qx > 0 || qy > 0 || qz > 0) {
      const mx = qx > 0 ? qx : 0, my = qy > 0 ? qy : 0, mz = qz > 0 ? qz : 0;
      const q = mx * mx + my * my + mz * mz;
      if (!(v > 0 && v * v >= q)) { STACK[o + 3] = Math.sqrt(q); return; }
    }
    STACK[o + 3] = v;
  };
  const evRot: Ev = (o) => {
    const px = STACK[o] - cx, py = STACK[o + 1] - cy, pz = STACK[o + 2] - cz;
    const lx = m0 * px + m3 * py + m6 * pz, ly = m1 * px + m4 * py + m7 * pz, lz = m2 * px + m5 * py + m8 * pz;
    const ax = lx * ix, ay = ly * iy, az = lz * iz;
    const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
    if (k0 < 1) { STACK[o + 3] = (k0 - 1) * rmin; return; }
    const bx = ax * ix, by = ay * iy, bz = az * iz;
    const v = (k0 * (k0 - 1)) / Math.sqrt(bx * bx + by * by + bz * bz);
    // Distance to the (tight) world AABB, which is the node's pruning box.
    const qx = (px < 0 ? -px : px) - ex, qy = (py < 0 ? -py : py) - ey, qz = (pz < 0 ? -pz : pz) - ez;
    if (qx > 0 || qy > 0 || qz > 0) {
      const mx = qx > 0 ? qx : 0, my = qy > 0 ? qy : 0, mz = qz > 0 ? qz : 0;
      const q = mx * mx + my * my + mz * mz;
      if (!(v > 0 && v * v >= q)) { STACK[o + 3] = Math.sqrt(q); return; }
    }
    STACK[o + 3] = v;
  };
  // Rigorous range: the field is >= g1 = (k0−1)·rmin (1-Lipschitz) everywhere and <= the true
  // distance outside, which is <= the distance to the radial surface point |l|·(1 − 1/k0).
  const spec = (self: Node, g: Region) => {
    const hx = (g[3] - g[0]) * 0.5, hy = (g[4] - g[1]) * 0.5, hz = (g[5] - g[2]) * 0.5;
    const rho = Math.sqrt(hx * hx + hy * hy + hz * hz);
    const px = g[0] + hx - cx, py = g[1] + hy - cy, pz = g[2] + hz - cz;
    const lx = m0 * px + m3 * py + m6 * pz, ly = m1 * px + m4 * py + m7 * pz, lz = m2 * px + m5 * py + m8 * pz;
    const ax = lx * ix, ay = ly * iy, az = lz * iz;
    const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
    const g1 = (k0 - 1) * rmin;
    let lo = g1 - rho;
    const bd = boxBoxDist(g, self.box, 0);
    if (bd > 0 && bd > lo) lo = bd;
    RANGE[0] = lo;
    RANGE[1] = (k0 > 1 ? Math.sqrt(lx * lx + ly * ly + lz * lz) * (1 - 1 / k0) : g1) + rho;
    return self;
  };
  const bevAxis: BatchEv = (px, py, pz, out, n) => {
    for (let i = 0; i < n; i += 1) {
      const lx = px[i] - cx, ly = py[i] - cy, lz = pz[i] - cz;
      const ax = lx * ix, ay = ly * iy, az = lz * iz;
      const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
      if (k0 < 1) { out[i] = (k0 - 1) * rmin; continue; }
      const bx = ax * ix, by = ay * iy, bz = az * iz;
      const v = (k0 * (k0 - 1)) / Math.sqrt(bx * bx + by * by + bz * bz);
      const qx = (lx < 0 ? -lx : lx) - rx, qy = (ly < 0 ? -ly : ly) - ry, qz = (lz < 0 ? -lz : lz) - rz;
      if (qx > 0 || qy > 0 || qz > 0) {
        const mx = qx > 0 ? qx : 0, my = qy > 0 ? qy : 0, mz = qz > 0 ? qz : 0;
        const q = mx * mx + my * my + mz * mz;
        if (!(v > 0 && v * v >= q)) { out[i] = Math.sqrt(q); continue; }
      }
      out[i] = v;
    }
  };
  const bevRot: BatchEv = (qxs, qys, qzs, out, n) => {
    for (let i = 0; i < n; i += 1) {
      const px = qxs[i] - cx, py = qys[i] - cy, pz = qzs[i] - cz;
      const lx = m0 * px + m3 * py + m6 * pz, ly = m1 * px + m4 * py + m7 * pz, lz = m2 * px + m5 * py + m8 * pz;
      const ax = lx * ix, ay = ly * iy, az = lz * iz;
      const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
      if (k0 < 1) { out[i] = (k0 - 1) * rmin; continue; }
      const bx = ax * ix, by = ay * iy, bz = az * iz;
      const v = (k0 * (k0 - 1)) / Math.sqrt(bx * bx + by * by + bz * bz);
      const qx = (px < 0 ? -px : px) - ex, qy = (py < 0 ? -py : py) - ey, qz = (pz < 0 ? -pz : pz) - ez;
      if (qx > 0 || qy > 0 || qz > 0) {
        const mx = qx > 0 ? qx : 0, my = qy > 0 ? qy : 0, mz = qz > 0 ? qz : 0;
        const q = mx * mx + my * my + mz * mz;
        if (!(v > 0 && v * v >= q)) { out[i] = Math.sqrt(q); continue; }
      }
      out[i] = v;
    }
  };
  return new Node({ kind: "ellipsoid", ev: rot ? evRot : evAxis, bev: rot ? bevRot : bevAxis, bounds: centered(center, [ex, ey, ez]), spec });
}

/** Capsule: segment a→b inflated by r. Exact. */
export function capsule(a: V3, b: V3, r: number): Sdf {
  const ax = a[0], ay = a[1], az = a[2];
  const bax = b[0] - ax, bay = b[1] - ay, baz = b[2] - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  if (l2 < 1e-16) return sphere(a, r);
  const il2 = 1 / l2;
  const ev: Ev = (o) => {
    const px = STACK[o] - ax, py = STACK[o + 1] - ay, pz = STACK[o + 2] - az;
    let h = (px * bax + py * bay + pz * baz) * il2;
    h = h < 0 ? 0 : h > 1 ? 1 : h;
    const dx = px - bax * h, dy = py - bay * h, dz = pz - baz * h;
    STACK[o + 3] = Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
  };
  const bev: BatchEv = (qx, qy, qz, out, n) => {
    for (let i = 0; i < n; i += 1) {
      const px = qx[i] - ax, py = qy[i] - ay, pz = qz[i] - az;
      let h = (px * bax + py * bay + pz * baz) * il2;
      h = h < 0 ? 0 : h > 1 ? 1 : h;
      const dx = px - bax * h, dy = py - bay * h, dz = pz - baz * h;
      out[i] = Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
    }
  };
  return new Node({
    kind: "capsule",
    ev,
    bev,
    bounds: aabb(
      Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.min(a[2], b[2]) - r,
      Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r, Math.max(a[2], b[2]) + r,
    ),
  });
}

/**
 * Round cone (tapered capsule): convex hull of a sphere of radius `ra` at `a` and `rb` at `b`.
 * Exact (Inigo Quilez). If one sphere contains the other it degenerates to that sphere.
 */
export function roundCone(a: V3, b: V3, ra: number, rb: number): Sdf {
  const ax = a[0], ay = a[1], az = a[2];
  const bax = b[0] - ax, bay = b[1] - ay, baz = b[2] - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = ra - rb;
  const a2 = l2 - rr * rr;
  if (l2 < 1e-16 || a2 <= 1e-12) return ra >= rb ? sphere(a, ra) : sphere(b, rb);
  const il2 = 1 / l2;
  const kc = Math.sign(rr) * rr * rr;
  const ev: Ev = (o) => {
    const px = STACK[o] - ax, py = STACK[o + 1] - ay, pz = STACK[o + 2] - az;
    const yv = px * bax + py * bay + pz * baz;
    const zv = yv - l2;
    const qx = px * l2 - bax * yv, qy = py * l2 - bay * yv, qz = pz * l2 - baz * yv;
    const x2 = qx * qx + qy * qy + qz * qz;
    const k = kc * x2;
    const z2 = zv * zv * l2;
    if ((zv > 0 ? a2 : zv < 0 ? -a2 : 0) * z2 > k) { STACK[o + 3] = Math.sqrt(x2 + z2) * il2 - rb; return; }
    const y2 = yv * yv * l2;
    if ((yv > 0 ? a2 : yv < 0 ? -a2 : 0) * y2 < k) { STACK[o + 3] = Math.sqrt(x2 + y2) * il2 - ra; return; }
    STACK[o + 3] = (Math.sqrt(x2 * a2 * il2) + yv * rr) * il2 - ra;
  };
  const bev: BatchEv = (sx, sy, sz, out, n) => {
    for (let i = 0; i < n; i += 1) {
      const px = sx[i] - ax, py = sy[i] - ay, pz = sz[i] - az;
      const yv = px * bax + py * bay + pz * baz;
      const zv = yv - l2;
      const qx = px * l2 - bax * yv, qy = py * l2 - bay * yv, qz = pz * l2 - baz * yv;
      const x2 = qx * qx + qy * qy + qz * qz;
      const k = kc * x2;
      const z2 = zv * zv * l2;
      if ((zv > 0 ? a2 : zv < 0 ? -a2 : 0) * z2 > k) { out[i] = Math.sqrt(x2 + z2) * il2 - rb; continue; }
      const y2 = yv * yv * l2;
      if ((yv > 0 ? a2 : yv < 0 ? -a2 : 0) * y2 < k) { out[i] = Math.sqrt(x2 + y2) * il2 - ra; continue; }
      out[i] = (Math.sqrt(x2 * a2 * il2) + yv * rr) * il2 - ra;
    }
  };
  return new Node({
    kind: "roundCone",
    ev,
    bev,
    bounds: aabb(
      Math.min(a[0] - ra, b[0] - rb), Math.min(a[1] - ra, b[1] - rb), Math.min(a[2] - ra, b[2] - rb),
      Math.max(a[0] + ra, b[0] + rb), Math.max(a[1] + ra, b[1] + rb), Math.max(a[2] + ra, b[2] + rb),
    ),
  });
}

/**
 * Box with rounded edges. `halfSize` are the OUTER half extents (rounding included); `round`
 * is clamped to [0, min(halfSize)]. Exact.
 */
export function roundBox(center: V3, halfSize: V3, round: number, rotation?: Quat): Sdf {
  const cx = center[0], cy = center[1], cz = center[2];
  const hx = Math.max(halfSize[0], 0), hy = Math.max(halfSize[1], 0), hz = Math.max(halfSize[2], 0);
  const r = Math.min(Math.max(round, 0), hx, hy, hz);
  const bx = hx - r, by = hy - r, bz = hz - r;
  const rot = isIdentity(rotation) ? null : quatToMat3(rotation as Quat);
  const m = rot ?? new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3], m4 = m[4], m5 = m[5], m6 = m[6], m7 = m[7], m8 = m[8];
  const ev: Ev = (o) => {
    const px = STACK[o] - cx, py = STACK[o + 1] - cy, pz = STACK[o + 2] - cz;
    const lx = m0 * px + m3 * py + m6 * pz, ly = m1 * px + m4 * py + m7 * pz, lz = m2 * px + m5 * py + m8 * pz;
    const qx = (lx < 0 ? -lx : lx) - bx, qy = (ly < 0 ? -ly : ly) - by, qz = (lz < 0 ? -lz : lz) - bz;
    const mx = qx > 0 ? qx : 0, my = qy > 0 ? qy : 0, mz = qz > 0 ? qz : 0;
    const inner = qx > qy ? (qx > qz ? qx : qz) : qy > qz ? qy : qz;
    STACK[o + 3] = Math.sqrt(mx * mx + my * my + mz * mz) + (inner < 0 ? inner : 0) - r;
  };
  const bev: BatchEv = (sx, sy, sz, out, n) => {
    for (let i = 0; i < n; i += 1) {
      const px = sx[i] - cx, py = sy[i] - cy, pz = sz[i] - cz;
      const lx = m0 * px + m3 * py + m6 * pz, ly = m1 * px + m4 * py + m7 * pz, lz = m2 * px + m5 * py + m8 * pz;
      const qx = (lx < 0 ? -lx : lx) - bx, qy = (ly < 0 ? -ly : ly) - by, qz = (lz < 0 ? -lz : lz) - bz;
      const mx = qx > 0 ? qx : 0, my = qy > 0 ? qy : 0, mz = qz > 0 ? qz : 0;
      const inner = qx > qy ? (qx > qz ? qx : qz) : qy > qz ? qy : qz;
      out[i] = Math.sqrt(mx * mx + my * my + mz * mz) + (inner < 0 ? inner : 0) - r;
    }
  };
  return new Node({ kind: "roundBox", ev, bev, bounds: centered(center, rot ? rotatedHalfExtents(m, hx, hy, hz) : [hx, hy, hz]) });
}

/**
 * Torus: ring of radius `majorR` in the local XZ plane (axis = local +Y before `rotation`),
 * tube radius `minorR`. Exact.
 */
export function torus(center: V3, majorR: number, minorR: number, rotation?: Quat): Sdf {
  const cx = center[0], cy = center[1], cz = center[2];
  const R = majorR, r = minorR;
  const rot = isIdentity(rotation) ? null : quatToMat3(rotation as Quat);
  const m = rot ?? new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3], m4 = m[4], m5 = m[5], m6 = m[6], m7 = m[7], m8 = m[8];
  const ev: Ev = (o) => {
    const px = STACK[o] - cx, py = STACK[o + 1] - cy, pz = STACK[o + 2] - cz;
    const lx = m0 * px + m3 * py + m6 * pz, ly = m1 * px + m4 * py + m7 * pz, lz = m2 * px + m5 * py + m8 * pz;
    const q = Math.sqrt(lx * lx + lz * lz) - R;
    STACK[o + 3] = Math.sqrt(q * q + ly * ly) - r;
  };
  // The ring axis in world space is column 1 of M; the circle spans R·sqrt(1 − n_i²) per axis.
  const n = [m1, m4, m7];
  const ext = n.map((ni) => R * Math.sqrt(Math.max(0, 1 - ni * ni)) + r) as [number, number, number];
  const bev: BatchEv = (sx, sy, sz, out, n) => {
    for (let i = 0; i < n; i += 1) {
      const px = sx[i] - cx, py = sy[i] - cy, pz = sz[i] - cz;
      const lx = m0 * px + m3 * py + m6 * pz, ly = m1 * px + m4 * py + m7 * pz, lz = m2 * px + m5 * py + m8 * pz;
      const q = Math.sqrt(lx * lx + lz * lz) - R;
      out[i] = Math.sqrt(q * q + ly * ly) - r;
    }
  };
  return new Node({ kind: "torus", ev, bev, bounds: centered(center, ext) });
}

/**
 * Capped cylinder from cap centre `a` to cap centre `b`, radius `r`, with edges rounded by
 * `round` (outer dimensions unchanged; clamped to [0, min(r, |ab|/2)]). Exact.
 */
export function cylinder(a: V3, b: V3, r: number, round = 0): Sdf {
  const dx0 = b[0] - a[0], dy0 = b[1] - a[1], dz0 = b[2] - a[2];
  const len = Math.sqrt(dx0 * dx0 + dy0 * dy0 + dz0 * dz0);
  if (len < 1e-9) return sphere(a, r);
  const ux = dx0 / len, uy = dy0 / len, uz = dz0 / len;
  const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, cz = (a[2] + b[2]) / 2;
  const rr = Math.min(Math.max(round, 0), r, len / 2);
  const R = r - rr;
  const H = len / 2 - rr;
  const ev: Ev = (o) => {
    const px = STACK[o] - cx, py = STACK[o + 1] - cy, pz = STACK[o + 2] - cz;
    const h = px * ux + py * uy + pz * uz;
    const ex = px - ux * h, ey = py - uy * h, ez = pz - uz * h;
    const qx = Math.sqrt(ex * ex + ey * ey + ez * ez) - R;
    const qy = (h < 0 ? -h : h) - H;
    const mx = qx > 0 ? qx : 0, my = qy > 0 ? qy : 0;
    const inner = qx > qy ? qx : qy;
    STACK[o + 3] = Math.sqrt(mx * mx + my * my) + (inner < 0 ? inner : 0) - rr;
  };
  const ext = [ux, uy, uz].map((u) => r * Math.sqrt(Math.max(0, 1 - u * u)));
  const bev: BatchEv = (sx, sy, sz, out, n) => {
    for (let i = 0; i < n; i += 1) {
      const px = sx[i] - cx, py = sy[i] - cy, pz = sz[i] - cz;
      const h = px * ux + py * uy + pz * uz;
      const ex = px - ux * h, ey = py - uy * h, ez = pz - uz * h;
      const qx = Math.sqrt(ex * ex + ey * ey + ez * ez) - R;
      const qy = (h < 0 ? -h : h) - H;
      const mx = qx > 0 ? qx : 0, my = qy > 0 ? qy : 0;
      const inner = qx > qy ? qx : qy;
      out[i] = Math.sqrt(mx * mx + my * my) + (inner < 0 ? inner : 0) - rr;
    }
  };
  return new Node({
    kind: "cylinder",
    ev,
    bev,
    bounds: aabb(
      Math.min(a[0], b[0]) - ext[0], Math.min(a[1], b[1]) - ext[1], Math.min(a[2], b[2]) - ext[2],
      Math.max(a[0], b[0]) + ext[0], Math.max(a[1], b[1]) + ext[1], Math.max(a[2], b[2]) + ext[2],
    ),
  });
}

/**
 * Half-space through `point`: d = n·(p − point), POSITIVE on the side `normal` points to, so the
 * solid is the opposite side. Bounds are infinite (half-infinite when `normal` is axis-aligned):
 * use it only to clip (`intersect`, `subtract`), never on its own in a sampled shape.
 */
export function halfSpace(point: V3, normal: V3): Sdf {
  const len = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  const nx = normal[0] / len, ny = normal[1] / len, nz = normal[2] / len;
  const px = point[0], py = point[1], pz = point[2];
  const lo: V3 = [-Infinity, -Infinity, -Infinity];
  const hi: V3 = [Infinity, Infinity, Infinity];
  const n = [nx, ny, nz];
  const axis = n.findIndex((c) => Math.abs(c) > 1 - 1e-12);
  if (axis >= 0) {
    if (n[axis] > 0) hi[axis] = point[axis];
    else lo[axis] = point[axis];
  }
  const ev: Ev = (o) => {
    STACK[o + 3] = nx * (STACK[o] - px) + ny * (STACK[o + 1] - py) + nz * (STACK[o + 2] - pz);
  };
  // A linear function has an exact range over a box.
  const spec = (self: Node, g: Region) => {
    const hx = (g[3] - g[0]) * 0.5, hy = (g[4] - g[1]) * 0.5, hz = (g[5] - g[2]) * 0.5;
    const v = nx * (g[0] + hx - px) + ny * (g[1] + hy - py) + nz * (g[2] + hz - pz);
    const e = Math.abs(nx) * hx + Math.abs(ny) * hy + Math.abs(nz) * hz;
    RANGE[0] = v - e;
    RANGE[1] = v + e;
    return self;
  };
  const bev: BatchEv = (sx, sy, sz, out, n) => {
    for (let i = 0; i < n; i += 1) out[i] = nx * (sx[i] - px) + ny * (sy[i] - py) + nz * (sz[i] - pz);
  };
  return new Node({ kind: "halfSpace", ev, bev, bounds: { min: lo, max: hi }, spec });
}
