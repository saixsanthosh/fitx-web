/**
 * Shared helpers for the character detail generators (worker-safe: no `three`, no DOM).
 * OWNER: character-details agent.
 *
 * Head, hair, hands, shoes and accessories are SDF sculpts polygonised with Surface Nets.
 * This module turns those raw meshes into `MeshPart`s: hidden-face culling, per-vertex paint ×
 * baked occlusion, frames for authoring in bone-local axes, procedural tubes (laces, straps,
 * stitching), mirroring and two-bone skin weights.
 */

import type { Quat, RawMesh, Sdf, V3 } from "../../sdf/api";
import { tiledSdf, vertexAdjacency } from "../../sdf/index";
import { BONE_INDEX, type BoneName } from "../../rig/skeleton";
import { srgbHexToLinear } from "../../math";
import type { LinearRGB } from "../../types";
import type { MaterialRole, MeshPart } from "../types";
import { decimate } from "./decimate";

export type RGB = LinearRGB;

/** sRGB hex → linear RGB (vertex colours are linear). */
export const lin = (hex: number): RGB => srgbHexToLinear(hex);

export const mix3 = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const mul3 = (a: RGB, s: number): RGB => [a[0] * s, a[1] * s, a[2] * s];

/** Luminance-preserving saturation change (linear RGB). */
export function saturate3(c: RGB, s: number): RGB {
  const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return [Math.max(0, l + (c[0] - l) * s), Math.max(0, l + (c[1] - l) * s), Math.max(0, l + (c[2] - l) * s)];
}

export const smooth01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
/** Hermite step between two edges (edge0 may be larger than edge1 for a falling step). */
export const sstep = (e0: number, e1: number, x: number) => smooth01((x - e0) / (e1 - e0));
/** Gaussian-ish blob weight of squared distance `d2` with radius `r` (1 at the centre). */
export const blob = (d2: number, r: number) => Math.exp(-d2 / (r * r));

/**
 * Monotone cubic (Fritsch–Carlson) through `knots` [x, y] (any order; sorted by x). Flat beyond
 * the ends. Used for authored profiles (face proportions along the height, lip profiles), where
 * an overshooting spline would add bumps the sculptor never asked for.
 */
export function monotoneCurve(knots: Array<[number, number]>): (x: number) => number {
  const k = knots.slice().sort((a, b) => a[0] - b[0]);
  const n = k.length;
  const xs = k.map((q) => q[0]), ys = k.map((q) => q[1]);
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
    const t = (x - xs[i]) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

/** Polynomial smooth max (Quilez), the mirror of the toolkit's smooth union: rounds a crease of width ~k. */
export function smax(a: number, b: number, k: number) {
  const d = a - b;
  const ad = d < 0 ? -d : d;
  const m = a > b ? a : b;
  if (ad >= k) return m;
  const h = (k - ad) / k;
  return m + h * h * k * 0.25;
}

// ---------------------------------------------------------------------------------------------
// Frames: author in convenient local axes, emit in bone-local (world-aligned) coordinates.

export interface Frame {
  origin: V3;
  /** Orthonormal right-handed axes (x × y = z). */
  x: V3;
  y: V3;
  z: V3;
}

/** origin + a·x + b·y + c·z. */
export const toWorld = (f: Frame, a: number, b: number, c: number): V3 => [
  f.origin[0] + f.x[0] * a + f.y[0] * b + f.z[0] * c,
  f.origin[1] + f.x[1] * a + f.y[1] * b + f.z[1] * c,
  f.origin[2] + f.x[2] * a + f.y[2] * b + f.z[2] * c,
];

/** Unit quaternion whose rotation maps (1,0,0),(0,1,0),(0,0,1) onto the frame axes. */
export function frameQuat(f: Frame): Quat {
  const m00 = f.x[0], m01 = f.y[0], m02 = f.z[0];
  const m10 = f.x[1], m11 = f.y[1], m12 = f.z[1];
  const m20 = f.x[2], m21 = f.y[2], m22 = f.z[2];
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

// ---------------------------------------------------------------------------------------------
// Mesh utilities

/** Keeps the triangles for which `keep(cx, cy, cz)` (centroid) is true and drops unused vertices. */
export function cullMesh(mesh: RawMesh, keep: (cx: number, cy: number, cz: number) => boolean): RawMesh {
  const p = mesh.positions;
  const idx = mesh.indices;
  const triKeep = new Uint8Array(idx.length / 3);
  const used = new Int32Array(p.length / 3).fill(-1);
  let kept = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const cx = (p[a] + p[b] + p[c]) / 3, cy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3, cz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
    if (keep(cx, cy, cz)) {
      triKeep[t / 3] = 1;
      kept += 1;
      used[idx[t]] = 0;
      used[idx[t + 1]] = 0;
      used[idx[t + 2]] = 0;
    }
  }
  let count = 0;
  for (let v = 0; v < used.length; v += 1) if (used[v] === 0) used[v] = count++;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  for (let v = 0; v < used.length; v += 1) {
    const n = used[v];
    if (n < 0) continue;
    positions[n * 3] = p[v * 3];
    positions[n * 3 + 1] = p[v * 3 + 1];
    positions[n * 3 + 2] = p[v * 3 + 2];
    normals[n * 3] = mesh.normals[v * 3];
    normals[n * 3 + 1] = mesh.normals[v * 3 + 1];
    normals[n * 3 + 2] = mesh.normals[v * 3 + 2];
  }
  const indices = new Uint32Array(kept * 3);
  let o = 0;
  for (let t = 0; t < idx.length; t += 3) {
    if (!triKeep[t / 3]) continue;
    indices[o++] = used[idx[t]];
    indices[o++] = used[idx[t + 1]];
    indices[o++] = used[idx[t + 2]];
  }
  return { positions, normals, indices };
}

/**
 * Drops the triangles whose three vertices are all `hidden` (and unused vertices). Conservative
 * where a covering layer must overlap the hole: every removed triangle lies wholly in the hidden
 * region, so the hole never pokes past it (a centroid test can, by up to a cell).
 */
export function cullHiddenVertices(mesh: RawMesh, hidden: (x: number, y: number, z: number) => boolean): RawMesh {
  const p = mesh.positions;
  const n = p.length / 3;
  const hv = new Uint8Array(n);
  for (let v = 0; v < n; v += 1) hv[v] = hidden(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]) ? 1 : 0;
  const I = mesh.indices;
  const keep: number[] = [];
  for (let t = 0; t < I.length; t += 3) if (!(hv[I[t]] && hv[I[t + 1]] && hv[I[t + 2]])) keep.push(I[t], I[t + 1], I[t + 2]);
  return compact(mesh, Uint32Array.from(keep));
}

/**
 * Surface relaxation for an already-culled mesh: each pass moves vertices tangentially toward
 * their neighbours' average, then one Newton step back onto the SDF's zero set; the final
 * gradient becomes the vertex normal. Doing this after culling (instead of inside Surface Nets)
 * spends no evaluations on vertices that are thrown away. 4 evaluations per vertex per pass
 * (tetrahedral differences; their mean stands in for the value).
 */
export function relaxOnSdf(mesh: RawMesh, shape: Sdf, passes: number, lambda = 0.5, h = 0.0006): RawMesh {
  const f = tiledSdf(shape, 0.02).d;
  const p = mesh.positions, nrm = mesh.normals;
  const count = p.length / 3;
  const adj = vertexAdjacency(mesh);
  const nx = new Float32Array(p.length);
  const e = h / Math.sqrt(3), inv4e = 1 / (4 * e);
  for (let pass = 0; pass < Math.max(1, passes); pass += 1) {
    for (let v = 0; v < count; v += 1) {
      const o = v * 3;
      const s = adj.offsets[v], t = adj.offsets[v + 1];
      let x = p[o], y = p[o + 1], z = p[o + 2];
      if (passes > 0 && t > s) {
        let ax = 0, ay = 0, az = 0;
        for (let q = s; q < t; q += 1) {
          const u = adj.neighbors[q] * 3;
          ax += p[u]; ay += p[u + 1]; az += p[u + 2];
        }
        const k = 1 / (t - s);
        let dx = ax * k - x, dy = ay * k - y, dz = az * k - z;
        const gx0 = nrm[o], gy0 = nrm[o + 1], gz0 = nrm[o + 2];
        const along = dx * gx0 + dy * gy0 + dz * gz0;
        dx -= along * gx0; dy -= along * gy0; dz -= along * gz0;
        x += lambda * dx; y += lambda * dy; z += lambda * dz;
      }
      const a = f(x + e, y - e, z - e), b = f(x - e, y - e, z + e), c = f(x - e, y + e, z - e), d = f(x + e, y + e, z + e);
      const gx = (a - b - c + d) * inv4e, gy = (-a - b + c + d) * inv4e, gz = (-a + b - c + d) * inv4e;
      const g2 = gx * gx + gy * gy + gz * gz;
      if (g2 > 1e-12) {
        const step = ((a + b + c + d) * 0.25) / g2;
        x -= gx * step; y -= gy * step; z -= gz * step;
        const gl = 1 / Math.sqrt(g2);
        nrm[o] = gx * gl; nrm[o + 1] = gy * gl; nrm[o + 2] = gz * gl;
      }
      nx[o] = x; nx[o + 1] = y; nx[o + 2] = z;
    }
    p.set(nx);
  }
  return mesh;
}

/**
 * Splits triangles crossing the zero level of `value` (where `cuttable` allows) and duplicates the
 * vertices on the cut, one copy per side, so attributes — or the laugh's jaw motion — can change
 * exactly along a smooth curve instead of across whole triangles. At rest the copies coincide.
 * `carry` arrays (one value per vertex) are extended to the new vertices (copied from the nearer
 * end of the cut edge); the returned `side` is +1 / −1 for the copies and 0 elsewhere.
 */
export function cutAlongCurve(mesh: RawMesh, value: (v: number) => number, cuttable: (a: number, b: number, c: number) => boolean, carry: Int8Array[]) {
  const P = mesh.positions, N = mesh.normals, I = mesh.indices;
  const n0 = P.length / 3;
  const val = new Float64Array(n0);
  for (let v = 0; v < n0; v += 1) {
    const x = value(v);
    // An exact zero would make a vertex its own cut point: nudge it to the positive side.
    val[v] = x === 0 ? 1e-9 : x;
  }
  let crossing = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = val[I[t]] > 0, b = val[I[t + 1]] > 0, c = val[I[t + 2]] > 0;
    if ((a !== b || b !== c) && cuttable(I[t], I[t + 1], I[t + 2])) crossing += 1;
  }
  const cap = n0 + crossing * 4;
  const pos = new Float32Array(cap * 3), nrm = new Float32Array(cap * 3);
  pos.set(P);
  nrm.set(N);
  const side = new Int8Array(cap);
  const carried = carry.map((src) => {
    const d = new Int8Array(cap);
    d.set(src);
    return d;
  });
  let count = n0;
  const edges = new Map<number, number>();
  const cut = (a: number, b: number, sgn: number) => {
    const lo = a < b ? a : b, hi = a < b ? b : a;
    const key = lo * n0 + hi;
    let first = edges.get(key);
    if (first === undefined) {
      const f = val[lo] / (val[lo] - val[hi]);
      first = count;
      for (let copy = 0; copy < 2; copy += 1) {
        const v = count++;
        for (let c = 0; c < 3; c += 1) {
          pos[v * 3 + c] = pos[lo * 3 + c] + (pos[hi * 3 + c] - pos[lo * 3 + c]) * f;
          nrm[v * 3 + c] = nrm[lo * 3 + c] + (nrm[hi * 3 + c] - nrm[lo * 3 + c]) * f;
        }
        const l = Math.hypot(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]) || 1;
        for (let c = 0; c < 3; c += 1) nrm[v * 3 + c] /= l;
        side[v] = copy === 0 ? 1 : -1;
        for (const d of carried) d[v] = d[f < 0.5 ? lo : hi];
      }
      edges.set(key, first);
    }
    return sgn > 0 ? first : first + 1;
  };
  const out = new Uint32Array(I.length + crossing * 6);
  // Per split triangle, the cut segment's two copies: [positive ab, positive ac, negative ab, negative ac].
  const segments = new Uint32Array(crossing * 4);
  let o = 0, sg = 0;
  for (let t = 0; t < I.length; t += 3) {
    const t0 = I[t], t1 = I[t + 1], t2 = I[t + 2];
    const s0 = val[t0] > 0 ? 1 : -1, s1 = val[t1] > 0 ? 1 : -1, s2 = val[t2] > 0 ? 1 : -1;
    if ((s0 === s1 && s1 === s2) || !cuttable(t0, t1, t2)) {
      out[o++] = t0; out[o++] = t1; out[o++] = t2;
      continue;
    }
    // Rotate so `a` is the vertex alone on its side (winding preserved).
    let a = t0, b = t1, c = t2, sa = s0;
    if (s1 !== s0 && s1 !== s2) { a = t1; b = t2; c = t0; sa = s1; }
    else if (s2 !== s0 && s2 !== s1) { a = t2; b = t0; c = t1; sa = s2; }
    const ab1 = cut(a, b, sa), ac1 = cut(a, c, sa);
    const ab2 = cut(a, b, -sa), ac2 = cut(a, c, -sa);
    out[o++] = a; out[o++] = ab1; out[o++] = ac1;
    out[o++] = ab2; out[o++] = b; out[o++] = c;
    out[o++] = ab2; out[o++] = c; out[o++] = ac2;
    if (sa > 0) { segments[sg++] = ab1; segments[sg++] = ac1; segments[sg++] = ab2; segments[sg++] = ac2; }
    else { segments[sg++] = ab2; segments[sg++] = ac2; segments[sg++] = ab1; segments[sg++] = ac1; }
  }
  // Which side every vertex is on (cut copies by their copy), for exact side-based culling.
  const sign = new Int8Array(count);
  for (let v = 0; v < count; v += 1) sign[v] = v < n0 ? (val[v] > 0 ? 1 : -1) : side[v];
  return {
    mesh: { positions: pos.slice(0, count * 3), normals: nrm.slice(0, count * 3), indices: out.slice(0, o) },
    side: side.slice(0, count),
    sign,
    segments: segments.slice(0, sg),
    carried: carried.map((d) => d.slice(0, count)),
  };
}

/**
 * Decimates only the triangles whose three vertices lie in `inRegion` (to `ratio` of their count)
 * and keeps the rest of the mesh untouched. The region's border is an open boundary of the
 * sub-mesh, which the decimator pins, so the result welds back exactly: one mesh, no seam.
 * Surviving vertices keep their exact positions and normals (half-edge collapses).
 */
export function decimateRegion(mesh: RawMesh, inRegion: (x: number, y: number, z: number) => boolean, ratio: number, minNormalDot = 0.97): RawMesh {
  const P = mesh.positions, N = mesh.normals, I = mesh.indices;
  const n = P.length / 3;
  const inside = new Uint8Array(n);
  for (let v = 0; v < n; v += 1) inside[v] = inRegion(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]) ? 1 : 0;
  const subOf = new Int32Array(n).fill(-1);
  const orig = new Int32Array(n);
  const subIdx = new Uint32Array(I.length), keep = new Uint32Array(I.length);
  let nSub = 0, nIdx = 0, nKeep = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    if (!(inside[a] && inside[b] && inside[c])) {
      keep[nKeep++] = a; keep[nKeep++] = b; keep[nKeep++] = c;
      continue;
    }
    for (let q = 0; q < 3; q += 1) {
      const v = I[t + q];
      if (subOf[v] < 0) { subOf[v] = nSub; orig[nSub++] = v; }
      subIdx[nIdx++] = subOf[v];
    }
  }
  // Not worth a pass for a few hundred triangles (Maya's and Leo's hair covers the back).
  if (nIdx < 4500) return mesh;
  const sp = new Float32Array(nSub * 3), sn = new Float32Array(nSub * 3);
  for (let i = 0; i < nSub; i += 1) {
    const o = orig[i] * 3;
    sp[i * 3] = P[o]; sp[i * 3 + 1] = P[o + 1]; sp[i * 3 + 2] = P[o + 2];
    sn[i * 3] = N[o]; sn[i * 3 + 1] = N[o + 1]; sn[i * 3 + 2] = N[o + 2];
  }
  const d = decimate({ positions: sp, normals: sn, indices: subIdx.slice(0, nIdx) }, { targetTriangles: Math.round((nIdx / 3) * ratio), minNormalDot });
  for (let i = 0; i < d.indices.length; i += 1) keep[nKeep++] = orig[d.source[d.indices[i]]];
  return compact(mesh, keep.subarray(0, nKeep));
}

/** Mesh from a triangle list over `mesh`'s vertices, dropping unused vertices. */
function compact(mesh: RawMesh, tris: Uint32Array): RawMesh {
  const n = mesh.positions.length / 3;
  const map = new Int32Array(n).fill(-1);
  let count = 0;
  for (let i = 0; i < tris.length; i += 1) if (map[tris[i]] < 0) map[tris[i]] = count++;
  const P = mesh.positions, N = mesh.normals;
  const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3);
  for (let v = 0; v < n; v += 1) {
    const m = map[v];
    if (m < 0) continue;
    positions[m * 3] = P[v * 3]; positions[m * 3 + 1] = P[v * 3 + 1]; positions[m * 3 + 2] = P[v * 3 + 2];
    normals[m * 3] = N[v * 3]; normals[m * 3 + 1] = N[v * 3 + 1]; normals[m * 3 + 2] = N[v * 3 + 2];
  }
  const indices = new Uint32Array(tris.length);
  for (let i = 0; i < tris.length; i += 1) indices[i] = map[tris[i]];
  return { positions, normals, indices };
}

/**
 * Newton-projects vertices `from`..end onto the SDF's zero set and gives them SDF normals (in
 * place). For the vertices `cutAlongCurve` adds: they are interpolated along edge chords, which
 * lie off a curved surface — across a crease (the mouth line) the chords stand proud of its floor
 * and the crease shades as a row of teeth. Copies of one cut vertex stay coincident.
 */
export function projectVertices(mesh: RawMesh, shape: Sdf, from: number, h = 0.0004) {
  const f = tiledSdf(shape, 0.02).d;
  const P = mesh.positions, N = mesh.normals;
  const e = h / Math.sqrt(3), inv4e = 1 / (4 * e);
  for (let v = from; v < P.length / 3; v += 1) {
    const o = v * 3;
    let x = P[o], y = P[o + 1], z = P[o + 2];
    for (let it = 0; it < 2; it += 1) {
      const a = f(x + e, y - e, z - e), b = f(x - e, y - e, z + e), c = f(x - e, y + e, z - e), d = f(x + e, y + e, z + e);
      const gx = (a - b - c + d) * inv4e, gy = (-a - b + c + d) * inv4e, gz = (-a + b - c + d) * inv4e;
      const g2 = gx * gx + gy * gy + gz * gz;
      if (g2 < 1e-12) break;
      const step = ((a + b + c + d) * 0.25) / g2;
      x -= gx * step; y -= gy * step; z -= gz * step;
      const gl = 1 / Math.sqrt(g2);
      N[o] = gx * gl; N[o + 1] = gy * gl; N[o + 2] = gz * gl;
    }
    P[o] = x; P[o + 1] = y; P[o + 2] = z;
  }
}

/**
 * Removes faces buried more than `depth` inside `occluder` (hidden under hair, inside a sole...).
 * Faces near the occluder's surface are kept, so the two meshes still overlap without holes.
 */
export function cullInside(mesh: RawMesh, occluder: Sdf, depth: number): RawMesh {
  const f = tiledSdf(occluder, 0.03).d;
  return cullMesh(mesh, (x, y, z) => f(x, y, z) > -depth);
}

/** Concatenated mesh plus per-vertex colours (keeps colours aligned with merged vertices). */
export interface ColoredMesh extends RawMesh {
  colors: Float32Array;
}

export function mergeColored(list: ColoredMesh[]): ColoredMesh {
  let vertices = 0, indexCount = 0;
  for (const m of list) {
    vertices += m.positions.length / 3;
    indexCount += m.indices.length;
  }
  const positions = new Float32Array(vertices * 3);
  const normals = new Float32Array(vertices * 3);
  const colors = new Float32Array(vertices * 3);
  const indices = new Uint32Array(indexCount);
  let vo = 0, io = 0;
  for (const m of list) {
    positions.set(m.positions, vo * 3);
    normals.set(m.normals, vo * 3);
    colors.set(m.colors, vo * 3);
    for (let i = 0; i < m.indices.length; i += 1) indices[io + i] = m.indices[i] + vo;
    vo += m.positions.length / 3;
    io += m.indices.length;
  }
  return { positions, normals, colors, indices };
}

/** Translates positions in place (e.g. world bind space → bone-local). */
export function translateMesh<T extends RawMesh>(mesh: T, by: V3): T {
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    p[i] += by[0];
    p[i + 1] += by[1];
    p[i + 2] += by[2];
  }
  return mesh;
}

/**
 * Per-vertex paint. `fn` writes linear RGB into `out` for vertex i at (x, y, z) with unit normal
 * (nx, ny, nz). Returns the colour array (not yet occluded; see `applyOcclusion`).
 */
export function paintMesh(
  mesh: RawMesh,
  fn: (out: Float64Array, x: number, y: number, z: number, nx: number, ny: number, nz: number, i: number) => void,
): Float32Array {
  const p = mesh.positions, n = mesh.normals;
  const count = p.length / 3;
  const colors = new Float32Array(count * 3);
  const out = new Float64Array(3);
  for (let i = 0; i < count; i += 1) {
    const o = i * 3;
    const nx = n[o], ny = n[o + 1], nz = n[o + 2];
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    out[0] = 0.5;
    out[1] = 0.5;
    out[2] = 0.5;
    fn(out, p[o], p[o + 1], p[o + 2], nx / len, ny / len, nz / len, i);
    colors[o] = out[0];
    colors[o + 1] = out[1];
    colors[o + 2] = out[2];
  }
  return colors;
}

/**
 * Multiplies colours by baked occlusion. Occluded areas fall toward `tint × colour` (a warmer,
 * deeper shade for skin, neutral for hard materials) rather than to grey, which reads as bounce
 * light and subsurface scattering instead of dirt.
 */
export function applyOcclusion(colors: Float32Array, ao: Float32Array, opts: { strength?: number; gamma?: number; tint?: RGB } = {}) {
  const strength = opts.strength ?? 1;
  const gamma = opts.gamma ?? 1.4;
  const tint = opts.tint ?? [0.32, 0.3, 0.3];
  for (let i = 0; i < ao.length; i += 1) {
    const a = Math.pow(Math.min(1, Math.max(0, ao[i])), gamma);
    const k = 1 - strength * (1 - a);
    const o = i * 3;
    colors[o] *= tint[0] + (1 - tint[0]) * k;
    colors[o + 1] *= tint[1] + (1 - tint[1]) * k;
    colors[o + 2] *= tint[2] + (1 - tint[2]) * k;
  }
  return colors;
}

export interface PartOptions {
  castShadow?: boolean;
  doubleSided?: boolean;
  roughness?: number;
}

/** Rigid part: positions must already be relative to `bone`'s bind joint. */
export function rigidPart(name: string, role: MaterialRole, mesh: RawMesh, colors: Float32Array, bone: BoneName, opts: PartOptions = {}): MeshPart {
  return {
    name,
    role,
    positions: mesh.positions,
    normals: mesh.normals,
    colors,
    indices: mesh.indices,
    rigidBone: bone,
    ...opts,
  };
}

/** Skinned part in character bind space. */
export function skinnedPart(
  name: string,
  role: MaterialRole,
  mesh: RawMesh,
  colors: Float32Array,
  skin: { index: Uint16Array; weight: Float32Array },
  opts: PartOptions = {},
): MeshPart {
  return {
    name,
    role,
    positions: mesh.positions,
    normals: mesh.normals,
    colors,
    indices: mesh.indices,
    skinIndex: skin.index,
    skinWeight: skin.weight,
    ...opts,
  };
}

/**
 * Two-bone skin weights: `w(x, y, z)` in 0..1 is the weight of `b`. Remaining slots are filled
 * with `a` at weight 0 (three.js ignores zero weights).
 */
export function skinTwoBones(positions: Float32Array, a: BoneName, b: BoneName, w: (x: number, y: number, z: number) => number) {
  const count = positions.length / 3;
  const index = new Uint16Array(count * 4);
  const weight = new Float32Array(count * 4);
  const ia = BONE_INDEX[a], ib = BONE_INDEX[b];
  for (let i = 0; i < count; i += 1) {
    const t = Math.min(1, Math.max(0, w(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])));
    index[i * 4] = ia;
    index[i * 4 + 1] = ib;
    index[i * 4 + 2] = ia;
    index[i * 4 + 3] = ia;
    weight[i * 4] = 1 - t;
    weight[i * 4 + 1] = t;
  }
  return { index, weight };
}

/**
 * Mirrors a part across the YZ plane (x → −x): positions and normals mirrored, winding flipped so
 * faces stay outward, `_L`/`_R` bones swapped in skin indices and `rigidBone`.
 */
export function mirrorPart(part: MeshPart, name: string): MeshPart {
  const positions = Float32Array.from(part.positions);
  const normals = Float32Array.from(part.normals);
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = -positions[i];
    normals[i] = -normals[i];
  }
  const indices = Uint32Array.from(part.indices);
  for (let t = 0; t < indices.length; t += 3) {
    const b = indices[t + 1];
    indices[t + 1] = indices[t + 2];
    indices[t + 2] = b;
  }
  const swap = (bone: BoneName): BoneName => {
    const other = bone.endsWith("_L") ? `${bone.slice(0, -2)}_R` : bone.endsWith("_R") ? `${bone.slice(0, -2)}_L` : bone;
    return (other in BONE_INDEX ? other : bone) as BoneName;
  };
  let skinIndex: Uint16Array | undefined;
  if (part.skinIndex) {
    const names = Object.keys(BONE_INDEX) as BoneName[];
    skinIndex = Uint16Array.from(part.skinIndex, (i) => BONE_INDEX[swap(names[i])]);
  }
  return {
    ...part,
    name,
    positions,
    normals,
    colors: Float32Array.from(part.colors),
    indices,
    skinIndex,
    skinWeight: part.skinWeight ? Float32Array.from(part.skinWeight) : undefined,
    rigidBone: part.rigidBone ? swap(part.rigidBone) : undefined,
  };
}

// ---------------------------------------------------------------------------------------------
// Procedural tubes (exact, resolution-independent geometry for laces, straps, piping)

/**
 * Tube along a polyline (Catmull-Rom resampled to `samples` rings) with per-ring radius
 * `radius(t)` (t = 0..1 along the curve) and optional elliptical squash `aspect(t)` of the
 * cross-section along the frame normal `up`. Ends are capped with small domes.
 */
export function tubeMesh(
  points: V3[],
  radius: (t: number) => number,
  opts: { samples?: number; radial?: number; up?: V3; aspect?: (t: number) => number; caps?: boolean } = {},
): RawMesh {
  const samples = Math.max(2, opts.samples ?? points.length * 4);
  const radial = Math.max(3, opts.radial ?? 8);
  const caps = opts.caps ?? true;
  const pts = resampleCatmull(points, samples);
  const count = pts.length;
  // Parallel-transport frames.
  const tangents: V3[] = pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(count - 1, i + 1)];
    return norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  });
  let n0: V3 = opts.up ?? [0, 1, 0];
  n0 = norm(sub3(n0, scl(tangents[0], dot3(n0, tangents[0]))));
  if (Math.hypot(...n0) < 1e-6) n0 = perpendicular(tangents[0]);
  const normals: V3[] = [n0];
  for (let i = 1; i < count; i += 1) {
    const prev = normals[i - 1];
    const t = tangents[i];
    const n = norm(sub3(prev, scl(t, dot3(prev, t))));
    normals.push(Math.hypot(...n) < 1e-6 ? prev : n);
  }
  const ringVerts = radial;
  const capVerts = caps ? 2 : 0;
  const positions = new Float32Array((count * ringVerts + capVerts) * 3);
  const nrm = new Float32Array(positions.length);
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    const r = radius(t);
    const asp = opts.aspect ? opts.aspect(t) : 1;
    const T = tangents[i], N = normals[i], B = cross3(T, N);
    for (let j = 0; j < radial; j += 1) {
      const a = (j / radial) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const o = (i * ringVerts + j) * 3;
      positions[o] = pts[i][0] + (N[0] * ca * asp + B[0] * sa) * r;
      positions[o + 1] = pts[i][1] + (N[1] * ca * asp + B[1] * sa) * r;
      positions[o + 2] = pts[i][2] + (N[2] * ca * asp + B[2] * sa) * r;
      const nn = norm([N[0] * ca / asp + B[0] * sa, N[1] * ca / asp + B[1] * sa, N[2] * ca / asp + B[2] * sa]);
      nrm[o] = nn[0];
      nrm[o + 1] = nn[1];
      nrm[o + 2] = nn[2];
    }
  }
  const tris: number[] = [];
  for (let i = 0; i < count - 1; i += 1) {
    for (let j = 0; j < radial; j += 1) {
      const a = i * ringVerts + j, b = i * ringVerts + ((j + 1) % radial);
      const c = a + ringVerts, d = b + ringVerts;
      tris.push(a, c, b, b, c, d);
    }
  }
  if (caps) {
    const s = count * ringVerts, e = s + 1;
    const r0 = radius(0) * 0.6, r1 = radius(1) * 0.6;
    const t0 = tangents[0], t1 = tangents[count - 1];
    positions.set([pts[0][0] - t0[0] * r0, pts[0][1] - t0[1] * r0, pts[0][2] - t0[2] * r0], s * 3);
    nrm.set([-t0[0], -t0[1], -t0[2]], s * 3);
    const last = pts[count - 1];
    positions.set([last[0] + t1[0] * r1, last[1] + t1[1] * r1, last[2] + t1[2] * r1], e * 3);
    nrm.set(t1, e * 3);
    for (let j = 0; j < radial; j += 1) {
      const jn = (j + 1) % radial;
      tris.push(s, j, jn);
      const base = (count - 1) * ringVerts;
      tris.push(e, base + jn, base + j);
    }
  }
  return { positions, normals: nrm, indices: Uint32Array.from(tris) };
}

/** Uniformly (by arc length) resampled centripetal-ish Catmull-Rom curve through `points`. */
export function resampleCatmull(points: V3[], samples: number): V3[] {
  if (points.length < 2) return points.slice();
  const dense: V3[] = [];
  const seg = 12;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    for (let s = 0; s < seg; s += 1) dense.push(catmull(p0, p1, p2, p3, s / seg));
  }
  dense.push(points[points.length - 1]);
  const acc = [0];
  for (let i = 1; i < dense.length; i += 1) acc.push(acc[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1], dense[i][2] - dense[i - 1][2]));
  const total = acc[acc.length - 1] || 1;
  const out: V3[] = [];
  let k = 0;
  for (let i = 0; i < samples; i += 1) {
    const target = (i / (samples - 1)) * total;
    while (k < acc.length - 2 && acc[k + 1] < target) k += 1;
    const span = acc[k + 1] - acc[k] || 1;
    const t = Math.min(1, Math.max(0, (target - acc[k]) / span));
    out.push([dense[k][0] + (dense[k + 1][0] - dense[k][0]) * t, dense[k][1] + (dense[k + 1][1] - dense[k][1]) * t, dense[k][2] + (dense[k + 1][2] - dense[k][2]) * t]);
  }
  return out;
}

function catmull(p0: V3, p1: V3, p2: V3, p3: V3, t: number): V3 {
  const t2 = t * t, t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]), f(p0[2], p1[2], p2[2], p3[2])];
}

const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scl = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};
const perpendicular = (t: V3): V3 => norm(Math.abs(t[0]) < 0.9 ? cross3(t, [1, 0, 0]) : cross3(t, [0, 1, 0]));

/** Colours a raw mesh with one flat colour (used for small procedural pieces). */
export function flatColor(mesh: RawMesh, c: RGB): ColoredMesh {
  const colors = new Float32Array(mesh.positions.length);
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = c[0];
    colors[i + 1] = c[1];
    colors[i + 2] = c[2];
  }
  return { ...mesh, colors };
}

/** Wall-clock milliseconds (works in workers and node). */
export const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
