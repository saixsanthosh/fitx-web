/**
 * Shoe geometry primitives (worker-safe). OWNER: gear agent (was character-details).
 *
 * Shoes are authored in a shoe frame (meters): x = medial for the RIGHT shoe (character's left),
 * y = up from the ground, z = forward from the heel landmark. A plan-view outline (separate
 * lateral / medial half-widths per station) is turned into a tabulated 2D signed distance.
 *
 * - Uppers are lofts of superellipse sections whose height follows a top-line profile; the
 *   section exponent can change along the shoe (boxy heel counter, rounder toe box) and the
 *   heel can lean forward with height (the counter curves in toward the Achilles).
 * - Soles are either SDF slabs (`soleSdf`) or exact parametric sweeps (`sweepMesh`): a cross
 *   section profile carried around an arc-length resampled `outlineLoop`, so sidewalls, bevels
 *   and grooves stay crisp at any distance and cost no field sampling.
 * Everything is cheap to evaluate (table lookups + a few roots).
 */

import type { RawMesh, Sdf, V3 } from "../../sdf/api";
import * as S from "../../sdf/index";

/** Outline stations: [t = z / length, lateral half-width, medial half-width] (fractions of length). */
export type OutlineDef = Array<[number, number, number]>;

/** Base last (cycling and lifting shoes scale it). */
export const RUNNER_OUTLINE: OutlineDef = [
  [-0.03, 0.0, 0.0],
  [-0.012, 0.062, 0.062],
  [0.03, 0.112, 0.11],
  [0.12, 0.13, 0.124],
  [0.25, 0.131, 0.112],
  [0.38, 0.134, 0.1],
  [0.52, 0.153, 0.136],
  [0.66, 0.168, 0.172],
  [0.8, 0.16, 0.158],
  [0.92, 0.132, 0.118],
  [0.995, 0.08, 0.065],
  [1.035, 0.0, 0.0],
];

/**
 * Modern trainer last (Maya): a fuller heel so the counter and padded collar can wrap the ankle
 * (the opening must hold the sock, ~6 cm across), a defined arch waist and a rounded toe.
 */
export const TRAINER_OUTLINE: OutlineDef = [
  [-0.036, 0.0, 0.0],
  [-0.016, 0.078, 0.076],
  [0.03, 0.13, 0.126],
  [0.12, 0.152, 0.144],
  [0.25, 0.152, 0.136],
  [0.38, 0.146, 0.118],
  [0.52, 0.158, 0.142],
  [0.66, 0.172, 0.176],
  [0.8, 0.164, 0.16],
  [0.92, 0.134, 0.12],
  [0.995, 0.082, 0.066],
  [1.04, 0.0, 0.0],
];

/** Monotone cubic interpolation over sorted knots (x, y). */
export function curve(knots: Array<[number, number]>) {
  const xs = knots.map((k) => k[0]);
  const ys = knots.map((k) => k[1]);
  const n = xs.length;
  const m = ys.map((_, i) => {
    if (i === 0 || i === n - 1) return 0;
    const d0 = (ys[i] - ys[i - 1]) / (xs[i] - xs[i - 1]);
    const d1 = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
    return d0 * d1 <= 0 ? 0 : (2 * d0 * d1) / (d0 + d1);
  });
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i += 1;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

export interface Outline {
  length: number;
  /** Lateral / medial half-widths (meters) at z (meters from the heel landmark). */
  lateral: (z: number) => number;
  medial: (z: number) => number;
  zBack: number;
  zFront: number;
  /** Signed 2D distance (negative inside) of the outline at (x, z); table lookup. */
  d: (x: number, z: number) => number;
}

/** Builds the outline polygon and tabulates its 2D signed distance on a 2 mm grid. */
export function makeOutline(def: OutlineDef, length: number): Outline {
  const lat = curve(def.map((d) => [d[0], d[1]]));
  const med = curve(def.map((d) => [d[0], d[2]]));
  const t0 = def[0][0], t1 = def[def.length - 1][0];
  // Closed polygon: medial edge front-to-back is x > 0, lateral edge x < 0; ends rounded by
  // elliptical caps (sqrt fall-off) so the heel and toe are round, not pointed.
  const N = 90;
  const pts: Array<[number, number]> = [];
  const cap = (t: number, w: number) => {
    const e0 = Math.min(1, (t - t0) / 0.05), e1 = Math.min(1, (t1 - t) / 0.06);
    return w * Math.sqrt(Math.max(0, Math.min(e0, e1)));
  };
  for (let i = 0; i <= N; i += 1) {
    const t = t0 + ((t1 - t0) * i) / N;
    pts.push([cap(t, med(t)) * length, t * length]);
  }
  for (let i = N; i >= 0; i -= 1) {
    const t = t0 + ((t1 - t0) * i) / N;
    pts.push([-cap(t, lat(t)) * length, t * length]);
  }
  const zBack = t0 * length, zFront = t1 * length;
  const cell = 0.002;
  const x0 = -0.075, x1 = 0.075, z0 = zBack - 0.03, z1 = zFront + 0.03;
  const nx = Math.ceil((x1 - x0) / cell) + 1, nz = Math.ceil((z1 - z0) / cell) + 1;
  const table = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j += 1) {
    const z = z0 + j * cell;
    for (let i = 0; i < nx; i += 1) {
      const x = x0 + i * cell;
      let best = Infinity;
      let inside = false;
      for (let s = 0, p = pts.length - 1; s < pts.length; p = s, s += 1) {
        const ax = pts[p][0], az = pts[p][1], bx = pts[s][0], bz = pts[s][1];
        const ex = bx - ax, ez = bz - az;
        const h = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
        const dx = x - ax - ex * h, dz = z - az - ez * h;
        best = Math.min(best, dx * dx + dz * dz);
        if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
      }
      table[j * nx + i] = inside ? -Math.sqrt(best) : Math.sqrt(best);
    }
  }
  const d = (x: number, z: number) => {
    const fx = (x - x0) / cell, fz = (z - z0) / cell;
    if (fx < 0 || fz < 0 || fx >= nx - 1 || fz >= nz - 1) {
      // Outside the table: distance to the table box plus a margin (conservative).
      const cx = Math.max(x0 - x, 0, x - x1), cz = Math.max(z0 - z, 0, z - z1);
      return Math.hypot(cx, cz) + 0.02;
    }
    const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j;
    const o = j * nx + i;
    const a = table[o] + (table[o + 1] - table[o]) * u;
    const b = table[o + nx] + (table[o + nx + 1] - table[o + nx]) * u;
    return a + (b - a) * v;
  };
  return { length, lateral: (z) => cap(z / length, lat(z / length)) * length, medial: (z) => cap(z / length, med(z / length)) * length, zBack, zFront, d };
}

/** Rounded combination of a 2D distance `a` and a 1D slab distance `b` with edge radius r. */
export function roundedMax(a: number, b: number, r: number) {
  const qa = a + r, qb = b + r;
  const ox = qa > 0 ? qa : 0, oy = qb > 0 ? qb : 0;
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qa, qb), 0) - r;
}

export interface Box {
  min: V3;
  max: V3;
}

/**
 * Sole slab: outline grown by `grow(y, z)` (sidewall flare), between `bottom(z)` and `top(z)`,
 * edges rounded by `round`. Shoe-frame SDF.
 */
export function soleSdf(o: Outline, opts: { bottom: (z: number) => number; top: (z: number) => number; grow?: (y: number, z: number) => number; round: number; bounds: Box }): Sdf {
  const grow = opts.grow ?? (() => 0);
  return S.custom(
    (x, y, z) => {
      const plan = o.d(x, z) - grow(y, z);
      const b = opts.bottom(z), t = opts.top(z);
      const slab = Math.max(b - y, y - t);
      return roundedMax(plan, slab, opts.round) / 1.25;
    },
    opts.bounds,
  );
}

export interface LoftOptions {
  base: (z: number) => number;
  height: (z: number) => number;
  inset: (z: number) => number;
  /** Superellipse exponent: one value, or per station (boxy heel counter, rounder toe box). */
  p: number | ((z: number) => number);
  bounds: Box;
  below?: number;
  /**
   * Heel lean: at height h above the base the section of station z is read from station
   * z − lean(h)·leanWeight(z), so the counter curves forward toward the Achilles as it rises.
   */
  lean?: (h: number) => number;
  leanWeight?: (z: number) => number;
}

/**
 * Upper loft: superellipse sections (exponent `p`) sitting on `base(z)`, half-width from the
 * outline inset by `inset(z)`, height `height(z)`. Shoe-frame SDF (conservative bound).
 */
export function loftSdf(o: Outline, opts: LoftOptions): Sdf {
  const below = opts.below ?? 0.012;
  // Per-millimetre tables of the section parameters along z (lookups instead of curve fits).
  const z0 = o.zBack - 0.004, z1 = o.zFront + 0.004;
  const n = Math.ceil((z1 - z0) / 0.001) + 1;
  const XC = new Float32Array(n), HW = new Float32Array(n), B = new Float32Array(n), HT = new Float32Array(n), IN = new Float32Array(n), PE = new Float32Array(n), LW = new Float32Array(n);
  const pz = typeof opts.p === "number" ? (() => opts.p as number) : opts.p;
  for (let i = 0; i < n; i += 1) {
    const z = z0 + (i * (z1 - z0)) / (n - 1);
    const lat = o.lateral(z), med = o.medial(z);
    XC[i] = (med - lat) / 2;
    HW[i] = Math.max(1e-4, (lat + med) / 2 - opts.inset(z));
    B[i] = opts.base(z);
    HT[i] = Math.max(1e-4, opts.height(z));
    IN[i] = opts.inset(z);
    PE[i] = pz(z);
    LW[i] = opts.leanWeight ? opts.leanWeight(z) : 0;
  }
  const lean = opts.lean;
  const at = (T: Float32Array, f: number, i: number) => T[i] + (T[i + 1] - T[i]) * f;
  const slot = (z: number) => Math.min(n - 1.000001, Math.max(0, ((z - z0) / (z1 - z0)) * (n - 1)));
  return S.custom(
    (x, y, zIn) => {
      let z = zIn;
      if (lean) {
        const s0 = slot(zIn), i0 = s0 | 0;
        const w = at(LW, s0 - i0, i0);
        if (w > 0) z = zIn - lean(y - at(B, s0 - i0, i0)) * w;
      }
      const fz = slot(z);
      const i = fz | 0, f = fz - i;
      const hw = at(HW, f, i), xc = at(XC, f, i), b = at(B, f, i), p = at(PE, f, i);
      const h = y >= b ? at(HT, f, i) : below;
      const u = Math.abs(x - xc) / hw, v = Math.abs(y - b) / h;
      const g = p === 2 ? Math.sqrt(u * u + v * v) : Math.pow(Math.pow(u, p) + Math.pow(v, p), 1 / p);
      // The superellipse estimate degenerates where the section is tiny (heel and toe ends); the
      // distance to its bounding rectangle is always a valid lower bound outside it.
      const box = Math.max(Math.abs(x - xc) - hw, Math.abs(y - b) - h);
      const sec = Math.max((g - 1) * Math.min(hw, h), box);
      // The plan outline keeps the toe/heel ends round and closed.
      return Math.max(sec, o.d(x, z) + at(IN, f, i) * 0.5) / 1.6;
    },
    opts.bounds,
  );
}

// ---------------------------------------------------------------------------------------------
// Parametric sweeps (exact sole geometry)

/** Closed plan loop around an outline, resampled to equal arc lengths. */
export interface PlanLoop {
  n: number;
  x: Float64Array;
  z: Float64Array;
  /** Outward unit normal in plan. */
  nx: Float64Array;
  nz: Float64Array;
  /** Index of the toe point (largest z); index 0 is the heel point. */
  toe: number;
}

/**
 * `n` points around the outline at equal arc length: index 0 at the heel, along the medial
 * edge (x > 0) to the toe, back along the lateral edge. Normals point away from the outline.
 */
export function outlineLoop(o: Outline, n: number): PlanLoop {
  const M = 260;
  const px: number[] = [], pz: number[] = [];
  // Cosine spacing in z keeps the round heel and toe caps well sampled.
  for (let i = 0; i <= M; i += 1) {
    const z = o.zBack + (o.zFront - o.zBack) * (0.5 - 0.5 * Math.cos((Math.PI * i) / M));
    px.push(o.medial(z));
    pz.push(z);
  }
  for (let i = M - 1; i >= 1; i -= 1) {
    const z = o.zBack + (o.zFront - o.zBack) * (0.5 - 0.5 * Math.cos((Math.PI * i) / M));
    px.push(-o.lateral(z));
    pz.push(z);
  }
  const m = px.length;
  const acc = new Float64Array(m + 1);
  for (let i = 0; i < m; i += 1) acc[i + 1] = acc[i] + Math.hypot(px[(i + 1) % m] - px[i], pz[(i + 1) % m] - pz[i]);
  const total = acc[m];
  const x = new Float64Array(n), z = new Float64Array(n), nx = new Float64Array(n), nz = new Float64Array(n);
  let k = 0;
  for (let i = 0; i < n; i += 1) {
    const target = (i / n) * total;
    while (k < m - 1 && acc[k + 1] < target) k += 1;
    const t = (target - acc[k]) / (acc[k + 1] - acc[k] || 1);
    const a = k, b = (k + 1) % m;
    x[i] = px[a] + (px[b] - px[a]) * t;
    z[i] = pz[a] + (pz[b] - pz[a]) * t;
  }
  let toe = 0;
  for (let i = 0; i < n; i += 1) {
    const a = (i + n - 1) % n, b = (i + 1) % n;
    const tx = x[b] - x[a], tz = z[b] - z[a];
    const l = Math.hypot(tx, tz) || 1;
    nx[i] = tz / l;
    nz[i] = -tx / l;
    if (z[i] > z[toe]) toe = i;
  }
  return { n, x, z, nx, nz, toe };
}

/**
 * Sweeps a cross-section around a closed plan loop: row j of station i sits at loop[i] + n_i·s
 * at height y, with `profile(i, j, out)` writing out[0] = s, out[1] = y. Rows must go round the
 * section clockwise in (s right, y up) — top face outward, down the side, under — so faces wind
 * outward. Normals are area-weighted and smooth (the loop closes in u).
 */
export function sweepMesh(loop: PlanLoop, rows: number, profile: (i: number, j: number, out: Float64Array) => void): RawMesh {
  const n = loop.n;
  const positions = new Float32Array(n * rows * 3);
  const out = new Float64Array(2);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < rows; j += 1) {
      profile(i, j, out);
      const o = (i * rows + j) * 3;
      positions[o] = loop.x[i] + loop.nx[i] * out[0];
      positions[o + 1] = out[1];
      positions[o + 2] = loop.z[i] + loop.nz[i] * out[0];
    }
  }
  const indices = new Uint32Array(n * (rows - 1) * 6);
  let t = 0;
  for (let i = 0; i < n; i += 1) {
    const i1 = (i + 1) % n;
    for (let j = 0; j < rows - 1; j += 1) {
      const a = i * rows + j, b = i1 * rows + j, c = i * rows + j + 1, d = i1 * rows + j + 1;
      indices[t++] = a; indices[t++] = b; indices[t++] = c;
      indices[t++] = b; indices[t++] = d; indices[t++] = c;
    }
  }
  return { positions, normals: faceNormals(positions, indices), indices };
}

/** Area-weighted vertex normals of an indexed mesh. */
export function faceNormals(p: Float32Array, idx: Uint32Array): Float32Array {
  const nrm = new Float32Array(p.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      nrm[v] += gx;
      nrm[v + 1] += gy;
      nrm[v + 2] += gz;
    }
  }
  for (let i = 0; i < nrm.length; i += 3) {
    const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
    nrm[i] /= l;
    nrm[i + 1] /= l;
    nrm[i + 2] /= l;
  }
  return nrm;
}

/**
 * Closes the bottom ring of a sweep (row `row` of every station) with a zipper strip between
 * the medial and lateral chains (heel → toe). The faces are flipped to face down.
 */
export function zipperCap(loop: PlanLoop, rows: number, row: number, positions: Float32Array): Uint32Array {
  const n = loop.n, m = loop.toe;
  const med: number[] = [], lat: number[] = [];
  for (let i = 0; i <= m; i += 1) med.push(i * rows + row);
  lat.push(row);
  for (let i = n - 1; i >= m; i -= 1) lat.push(i * rows + row);
  const zOf = (v: number) => positions[v * 3 + 2];
  const tris: number[] = [];
  let a = 0, b = 0;
  while (a < med.length - 1 || b < lat.length - 1) {
    const advanceMed = b >= lat.length - 1 || (a < med.length - 1 && zOf(med[a + 1]) <= zOf(lat[b + 1]));
    if (advanceMed) {
      tris.push(med[a], lat[b], med[a + 1]);
      a += 1;
    } else {
      tris.push(med[a], lat[b], lat[b + 1]);
      b += 1;
    }
  }
  // Orient every face downward.
  for (let t = 0; t < tris.length; t += 3) {
    const p0 = tris[t] * 3, p1 = tris[t + 1] * 3, p2 = tris[t + 2] * 3;
    const ux = positions[p1] - positions[p0], uz = positions[p1 + 2] - positions[p0 + 2];
    const vx = positions[p2] - positions[p0], vz = positions[p2 + 2] - positions[p0 + 2];
    if (uz * vx - ux * vz > 0) {
      const tmp = tris[t + 1];
      tris[t + 1] = tris[t + 2];
      tris[t + 2] = tmp;
    }
  }
  return Uint32Array.from(tris);
}

/** Plan gradient of the outline distance (unit, pointing outward). */
export function outlineNormal(o: Outline, x: number, z: number): [number, number] {
  const h = 0.0015;
  const gx = o.d(x + h, z) - o.d(x - h, z), gz = o.d(x, z + h) - o.d(x, z - h);
  const l = Math.hypot(gx, gz) || 1;
  return [gx / l, gz / l];
}
