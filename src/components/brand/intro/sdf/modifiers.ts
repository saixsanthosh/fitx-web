/**
 * Unary SDF modifiers (worker-safe): offset, shell, displace, transform, mirrorX. Re-exported
 * from ops.ts. Each wraps one child and specialises by specialising that child.
 */

import type { AABB, Quat, Sdf, V3 } from "./api";
import {
  FRAME as SHARED_FRAME,
  Node,
  RANGE as SHARED_RANGE,
  SP as SHARED_SP,
  STACK as SHARED_STACK,
  aabb,
  asNode,
  boxBoxDist,
  boxOf,
  growBounds,
  regionCenter,
  scratch,
  type BatchEv,
  type Ev,
  type Fn3,
  type Region,
} from "./node";
import { quatToMat3 } from "./vec";

// Module-local aliases: bundlers and CJS loaders turn cross-module bindings into getter calls,
// which would otherwise run on every evaluation in the hot closures below.
const STACK = SHARED_STACK;
const RANGE = SHARED_RANGE;
const SP = SHARED_SP;
const FRAME = SHARED_FRAME;

/** Wrapper spec: specialise the child, rebuild (memoised) only if it changed. */
function wrapSpec(self: Node, child: Node, g: Region, rebuildChild: (c: Node) => Node): Node {
  const c = child.spec(g);
  return c === child ? self : self.memoized(c.id, () => rebuildChild(c), (n) => n.kids?.[0] === c);
}

/** Inflates by `r` meters (negative shrinks). Exact for exact inputs. */
export function offset(s: Sdf, r: number): Sdf {
  const S = asNode(s);
  const ec = S.ev;
  const grow = Math.max(r, 0);
  return new Node({
    kind: "offset",
    kids: [S],
    ev: (o) => {
      ec(o);
      STACK[o + 3] -= r;
    },
    bev: (px, py, pz, out, n, level) => {
      S.bev(px, py, pz, out, n, level + 1);
      for (let i = 0; i < n; i += 1) out[i] -= r;
    },
    depth: S.depth,
    bounds: growBounds(S.bounds, grow),
    box: growBounds(boxOf(S), grow),
    ref: (x, y, z) => S.ref(x, y, z) - r,
    spec: (self, g) => {
      const node = wrapSpec(self, S, g, (c) => offset(c, r) as Node);
      RANGE[0] -= r;
      RANGE[1] -= r;
      return node;
    },
    lip: S.lip,
    slack: S.slack,
  });
}

/**
 * Hollow shell of total wall `thickness` centred on the surface of `s`: |d| − thickness/2
 * (Quilez's "onion" with half the thickness). Bounds grow by thickness/2.
 */
export function shell(s: Sdf, thickness: number): Sdf {
  const S = asNode(s);
  const ec = S.ev;
  const half = Math.max(thickness, 0) / 2;
  return new Node({
    kind: "shell",
    kids: [S],
    ev: (o) => {
      ec(o);
      const v = STACK[o + 3];
      STACK[o + 3] = (v < 0 ? -v : v) - half;
    },
    bev: (px, py, pz, out, n, level) => {
      S.bev(px, py, pz, out, n, level + 1);
      for (let i = 0; i < n; i += 1) {
        const v = out[i];
        out[i] = (v < 0 ? -v : v) - half;
      }
    },
    depth: S.depth,
    bounds: growBounds(S.bounds, half),
    box: growBounds(boxOf(S), half),
    ref: (x, y, z) => Math.abs(S.ref(x, y, z)) - half,
    spec: (self, g) => {
      const node = wrapSpec(self, S, g, (c) => shell(c, thickness) as Node);
      const lo = RANGE[0], hi = RANGE[1];
      if (lo >= 0) { RANGE[0] = lo - half; RANGE[1] = hi - half; }
      else if (hi <= 0) { RANGE[0] = -hi - half; RANGE[1] = -lo - half; }
      else { RANGE[0] = -half; RANGE[1] = Math.max(-lo, hi) - half; }
      return node;
    },
    lip: S.lip,
    slack: S.slack,
  });
}

/**
 * Adds `fn(x, y, z)` (|fn| <= maxAmplitude, meters) to the distance: wrinkles, striations,
 * tread. Bounds grow by maxAmplitude. The result is no longer an exact distance: its Lipschitz
 * constant becomes 1 + max|∇fn|. Without `maxSlope` the sampler widens its narrow band by the
 * amplitude (always safe). With `maxSlope` (an upper bound of |∇fn|) the value is divided by
 * (1 + maxSlope), which keeps it a conservative 1-Lipschitz bound (better for AO and blends)
 * with the same zero set. `fn` is called for every evaluation, so keep it cheap.
 */
export function displace(s: Sdf, fn: (x: number, y: number, z: number) => number, maxAmplitude: number, maxSlope?: number): Sdf {
  const S = asNode(s);
  const ec = S.ev;
  const amp = Math.abs(maxAmplitude);
  const bounds = growBounds(S.bounds, amp);
  const box = growBounds(boxOf(S), amp);
  const slope = maxSlope !== undefined && maxSlope > 0 ? maxSlope : 0;
  const inv = 1 / (1 + slope);
  const b0 = box.min[0], b1 = box.min[1], b2 = box.min[2], b3 = box.max[0], b4 = box.max[1], b5 = box.max[2];
  const call = (x: number, y: number, z: number) => {
    try {
      return fn(x, y, z);
    } catch (error) {
      SP[0] = 0;
      throw error;
    }
  };
  // Dividing breaks "d >= distance to the pruning box" far away, so restore it explicitly.
  const raise = (v: number, x: number, y: number, z: number) => {
    let dx = b0 - x;
    if (dx < 0) { dx = x - b3; if (dx < 0) dx = 0; }
    let dy = b1 - y;
    if (dy < 0) { dy = y - b4; if (dy < 0) dy = 0; }
    let dz = b2 - z;
    if (dz < 0) { dz = z - b5; if (dz < 0) dz = 0; }
    const q = dx * dx + dy * dy + dz * dz;
    return q > 0 && !(v > 0 && v * v >= q) ? Math.sqrt(q) : v;
  };
  const ev: Ev = slope
    ? (o) => {
      const x = STACK[o], y = STACK[o + 1], z = STACK[o + 2];
      ec(o);
      STACK[o + 3] = raise((STACK[o + 3] + call(x, y, z)) * inv, x, y, z);
    }
    : (o) => {
      const x = STACK[o], y = STACK[o + 1], z = STACK[o + 2];
      ec(o);
      STACK[o + 3] += call(x, y, z);
    };
  const bev: BatchEv = (px, py, pz, out, n, level) => {
    S.bev(px, py, pz, out, n, level + 1);
    for (let i = 0; i < n; i += 1) {
      const x = px[i], y = py[i], z = pz[i];
      out[i] = slope ? raise((out[i] + call(x, y, z)) * inv, x, y, z) : out[i] + call(x, y, z);
    }
  };
  return new Node({
    kind: "displace",
    kids: [S],
    ev,
    bev,
    depth: S.depth,
    bounds,
    box,
    ref: slope ? (x, y, z) => raise((S.ref(x, y, z) + fn(x, y, z)) * inv, x, y, z) : (x, y, z) => S.ref(x, y, z) + fn(x, y, z),
    spec: (self, g) => {
      const node = wrapSpec(self, S, g, (c) => displace(c, fn, amp, maxSlope) as Node);
      const lo = RANGE[0], hi = RANGE[1];
      if (!slope) {
        RANGE[0] = lo - amp;
        RANGE[1] = hi + amp;
      } else {
        const [, , , rho] = regionCenter(g);
        const bbd = boxBoxDist(g, node.box, 0);
        RANGE[0] = Math.max((lo - amp) * inv, bbd > 0 ? bbd : -Infinity);
        RANGE[1] = Math.max((hi + amp) * inv, bbd > 0 ? bbd + 2 * rho : 0);
      }
      return node;
    },
    lip: slope ? (S.lip + slope) * inv : S.lip,
    slack: slope ? S.slack * inv : S.slack + amp,
  });
}

export interface TransformOptions {
  /** Applied last (meters). */
  translate?: V3;
  /** Applied after scaling, about the local origin. */
  rotate?: Quat;
  /** Uniform scale > 0, applied first. Distances scale with it, so the result stays exact. */
  scale?: number;
}

const isIdentityQuat = (q?: Quat) => !q || (Math.abs(q[0]) < 1e-12 && Math.abs(q[1]) < 1e-12 && Math.abs(q[2]) < 1e-12);

/** AABB of box `b` under p ↦ t + s · M p (M row-major, null = identity). */
function transformBox(b: AABB, m: Float64Array | null, s: number, t: V3): AABB {
  const out: AABB = { min: [0, 0, 0], max: [0, 0, 0] };
  for (let i = 0; i < 3; i += 1) {
    let ci = 0, ei = 0, infinite = false;
    for (let j = 0; j < 3; j += 1) {
      const mij = m ? m[i * 3 + j] : i === j ? 1 : 0;
      if (mij === 0) continue;
      const c = (b.min[j] + b.max[j]) / 2, e = (b.max[j] - b.min[j]) / 2;
      if (!Number.isFinite(c) || !Number.isFinite(e)) { infinite = true; break; }
      ci += mij * c;
      ei += Math.abs(mij) * e;
    }
    out.min[i] = infinite ? -Infinity : t[i] + s * (ci - ei);
    out.max[i] = infinite ? Infinity : t[i] + s * (ci + ei);
  }
  return out;
}

/** Local-space AABB of a world region under the inverse of p ↦ t + s · M p. */
function inverseRegion(g: Region, m: Float64Array | null, s: number, t: V3): Region {
  const out = new Float64Array(6);
  for (let i = 0; i < 3; i += 1) {
    let ci = 0, ei = 0;
    for (let j = 0; j < 3; j += 1) {
      const mji = m ? m[j * 3 + i] : i === j ? 1 : 0; // row i of Mᵀ
      ci += mji * ((g[j] + g[j + 3]) / 2 - t[j]);
      ei += Math.abs(mji) * ((g[j + 3] - g[j]) / 2);
    }
    out[i] = (ci - ei) / s;
    out[i + 3] = (ci + ei) / s;
  }
  return out;
}

/**
 * Places a shape authored in local space: world p = translate + rotate(scale · local).
 * Exact for exact inputs (uniform scale only). Bounds are the AABB of the transformed bounds.
 */
export function transform(s: Sdf, xf: TransformOptions): Sdf {
  const S = asNode(s);
  const ec = S.ev;
  const sc = xf.scale ?? 1;
  if (!(sc > 0)) throw new Error("sdf transform(): scale must be > 0");
  const t: V3 = xf.translate ? [xf.translate[0], xf.translate[1], xf.translate[2]] : [0, 0, 0];
  const m = isIdentityQuat(xf.rotate) ? null : quatToMat3(xf.rotate as Quat);
  const inv = 1 / sc;
  const tx = t[0], ty = t[1], tz = t[2];
  // Local = Mᵀ (p − t) / s, with the 1/s folded into the matrix.
  const mm = m ?? new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const m0 = mm[0] * inv, m1 = mm[1] * inv, m2 = mm[2] * inv, m3 = mm[3] * inv, m4 = mm[4] * inv;
  const m5 = mm[5] * inv, m6 = mm[6] * inv, m7 = mm[7] * inv, m8 = mm[8] * inv;
  const ev: Ev = (o) => {
    const px = STACK[o] - tx, py = STACK[o + 1] - ty, pz = STACK[o + 2] - tz;
    const c = o + FRAME;
    STACK[c] = m0 * px + m3 * py + m6 * pz;
    STACK[c + 1] = m1 * px + m4 * py + m7 * pz;
    STACK[c + 2] = m2 * px + m5 * py + m8 * pz;
    ec(c);
    STACK[o + 3] = sc * STACK[c + 3];
  };
  const ref: Fn3 = (x, y, z) => {
    const px = x - tx, py = y - ty, pz = z - tz;
    return sc * S.ref(m0 * px + m3 * py + m6 * pz, m1 * px + m4 * py + m7 * pz, m2 * px + m5 * py + m8 * pz);
  };
  const cb = S.bev;
  const bev: BatchEv = (px, py, pz, out, n, level) => {
    const buf = scratch(level);
    const lx = buf[1], ly = buf[2], lz = buf[3];
    for (let i = 0; i < n; i += 1) {
      const x = px[i] - tx, y = py[i] - ty, z = pz[i] - tz;
      lx[i] = m0 * x + m3 * y + m6 * z;
      ly[i] = m1 * x + m4 * y + m7 * z;
      lz[i] = m2 * x + m5 * y + m8 * z;
    }
    cb(lx, ly, lz, out, n, level + 1);
    for (let i = 0; i < n; i += 1) out[i] = sc * out[i];
  };
  return new Node({
    kind: "transform",
    kids: [S],
    ev,
    bev,
    depth: S.depth + 1,
    bounds: transformBox(S.bounds, m, sc, t),
    box: transformBox(boxOf(S), m, sc, t),
    ref,
    spec: (self, g) => {
      const node = wrapSpec(self, S, inverseRegion(g, m, sc, t), (c) => transform(c, xf) as Node);
      RANGE[0] *= sc;
      RANGE[1] *= sc;
      return node;
    },
    lip: S.lip,
    slack: S.slack * sc,
  });
}

/**
 * Left/right symmetric sculpt: evaluates `s` at (|x|, y, z), so only the +X half of `s`
 * matters (the character's LEFT side, see rig/skeleton.ts). Exact where `s` is exact and does
 * not cross x = 0; shapes straddling the midline get a crease there.
 */
export function mirrorX(s: Sdf): Sdf {
  const S = asNode(s);
  const ec = S.ev;
  const mirrorBox = (b: AABB): AABB => {
    const X = Math.max(b.max[0], 0);
    return aabb(-X, b.min[1], b.min[2], X, b.max[1], b.max[2]);
  };
  return new Node({
    kind: "mirrorX",
    kids: [S],
    ev: (o) => {
      const c = o + FRAME;
      const x = STACK[o];
      STACK[c] = x < 0 ? -x : x;
      STACK[c + 1] = STACK[o + 1];
      STACK[c + 2] = STACK[o + 2];
      ec(c);
      STACK[o + 3] = STACK[c + 3];
    },
    bev: (px, py, pz, out, n, level) => {
      const mx = scratch(level)[1];
      for (let i = 0; i < n; i += 1) {
        const x = px[i];
        mx[i] = x < 0 ? -x : x;
      }
      S.bev(mx, py, pz, out, n, level + 1);
    },
    depth: S.depth + 1,
    bounds: mirrorBox(S.bounds),
    box: mirrorBox(boxOf(S)),
    ref: (x, y, z) => S.ref(Math.abs(x), y, z),
    spec: (self, g) => {
      const local = new Float64Array(g);
      if (g[3] <= 0) {
        local[0] = -g[3];
        local[3] = -g[0];
      } else if (g[0] < 0) {
        local[0] = 0;
        local[3] = Math.max(-g[0], g[3]);
      }
      return wrapSpec(self, S, local, (c) => mirrorX(c) as Node);
    },
    lip: S.lip,
    slack: S.slack,
  });
}
