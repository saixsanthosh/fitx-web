/**
 * Quadric-error mesh decimation (worker-safe). OWNER: character-details agent.
 *
 * Surface Nets meshes are uniform: flat cheeks and shoe sides carry as many triangles as lids
 * and nostrils. This collapses edges in order of Garland–Heckbert quadric error, always onto an
 * existing vertex (half-edge collapse), so surviving vertices keep their exact SDF positions and
 * normals. Optional per-vertex colours add a colour-difference cost so paint boundaries (stripes,
 * lips, nails) survive. Boundary vertices (patch and cull edges) never move. Collapses that would
 * flip or sliver a triangle, or break manifoldness (link condition), are rejected.
 */

import type { RawMesh } from "../../sdf/api";

export interface DecimateOptions {
  /** Stop when the triangle count reaches this. */
  targetTriangles: number;
  /** Optional linear RGB per vertex (same length as positions); preserved where it changes. */
  colors?: Float32Array;
  /** Weight of colour difference (per unit colour, scaled by edge length²). */
  colorWeight?: number;
  /** Never collapse an edge whose cost exceeds this (squared meters). */
  maxCost?: number;
  /** Minimum dot product between the two vertices' normals for a collapse (default 0.97 ≈ 14°). */
  minNormalDot?: number;
}

export interface DecimatedMesh extends RawMesh {
  colors?: Float32Array;
  /** Original index of each kept vertex. */
  source: Uint32Array;
}

export function decimate(mesh: RawMesh, opts: DecimateOptions): DecimatedMesh {
  const P = mesh.positions;
  const nV = P.length / 3;
  const T = Int32Array.from(mesh.indices);
  const nT = T.length / 3;
  if (nT <= opts.targetTriangles) return finish(mesh, T, new Uint8Array(nT).fill(1), new Uint8Array(nV).fill(1), opts.colors);
  const colors = opts.colors;
  const cw = opts.colorWeight ?? 0;
  const maxCost = opts.maxCost ?? Infinity;
  const minDot = opts.minNormalDot ?? 0.97;
  const N = mesh.normals;

  // Vertex → incident triangles (dynamic lists; collapses append).
  const inc: number[][] = Array.from({ length: nV }, () => []);
  for (let t = 0; t < nT; t += 1) for (let k = 0; k < 3; k += 1) inc[T[t * 3 + k]].push(t);
  const triAlive = new Uint8Array(nT).fill(1);
  const alive = new Uint8Array(nV).fill(1);

  // Quadrics from area-weighted face planes.
  const Q = new Float64Array(nV * 10);
  for (let t = 0; t < nT; t += 1) {
    const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2];
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 1e-20) continue;
    const area = len * 0.5;
    nx /= len; ny /= len; nz /= len;
    const d = -(nx * P[a * 3] + ny * P[a * 3 + 1] + nz * P[a * 3 + 2]);
    const q = [nx * nx, nx * ny, nx * nz, nx * d, ny * ny, ny * nz, ny * d, nz * nz, nz * d, d * d];
    for (const v of [a, b, c]) for (let i = 0; i < 10; i += 1) Q[v * 10 + i] += q[i] * area;
  }

  // Boundary vertices (on an edge used by one triangle) are pinned: a neighbour that appears in
  // only one of a vertex's triangles marks an open edge.
  const pinned = new Uint8Array(nV);
  {
    const seen = new Int32Array(nV).fill(-1);
    const count = new Uint8Array(nV);
    for (let v = 0; v < nV; v += 1) {
      const list = inc[v];
      for (let i = 0; i < list.length; i += 1) {
        const o = list[i] * 3;
        for (let k = 0; k < 3; k += 1) {
          const w = T[o + k];
          if (w === v) continue;
          if (seen[w] !== v) {
            seen[w] = v;
            count[w] = 1;
          } else if (count[w] < 3) count[w] += 1;
        }
      }
      for (let i = 0; i < list.length; i += 1) {
        const o = list[i] * 3;
        for (let k = 0; k < 3; k += 1) {
          const w = T[o + k];
          if (w !== v && count[w] !== 2) {
            pinned[v] = 1;
            pinned[w] = 1;
          }
        }
      }
    }
  }

  const version = new Int32Array(nV);
  // Binary heap of candidate collapses u → v.
  let hCost = new Float64Array(1024), hU = new Int32Array(1024), hV = new Int32Array(1024), hVu = new Int32Array(1024), hVv = new Int32Array(1024);
  let hn = 0;
  const grow = () => {
    const n = hCost.length * 2;
    const c = new Float64Array(n); c.set(hCost); hCost = c;
    const a = new Int32Array(n); a.set(hU); hU = a;
    const b = new Int32Array(n); b.set(hV); hV = b;
    const d = new Int32Array(n); d.set(hVu); hVu = d;
    const e = new Int32Array(n); e.set(hVv); hVv = e;
  };
  const swap = (i: number, j: number) => {
    let t: number;
    t = hCost[i]; hCost[i] = hCost[j]; hCost[j] = t;
    t = hU[i]; hU[i] = hU[j]; hU[j] = t;
    t = hV[i]; hV[i] = hV[j]; hV[j] = t;
    t = hVu[i]; hVu[i] = hVu[j]; hVu[j] = t;
    t = hVv[i]; hVv[i] = hVv[j]; hVv[j] = t;
  };
  const push = (cost: number, u: number, v: number) => {
    if (hn === hCost.length) grow();
    let i = hn++;
    hCost[i] = cost; hU[i] = u; hV[i] = v; hVu[i] = version[u]; hVv[i] = version[v];
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hCost[p] <= hCost[i]) break;
      swap(i, p);
      i = p;
    }
  };
  const pop = () => {
    hn -= 1;
    swap(0, hn);
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let m = i;
      if (l < hn && hCost[l] < hCost[m]) m = l;
      if (r < hn && hCost[r] < hCost[m]) m = r;
      if (m === i) break;
      swap(i, m);
      i = m;
    }
  };

  const cost = (u: number, v: number) => {
    // Error of moving u onto v under the merged quadric.
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    const o1 = u * 10, o2 = v * 10;
    const q = (i: number) => Q[o1 + i] + Q[o2 + i];
    let e = q(0) * x * x + 2 * q(1) * x * y + 2 * q(2) * x * z + 2 * q(3) * x + q(4) * y * y + 2 * q(5) * y * z + 2 * q(6) * y + q(7) * z * z + 2 * q(8) * z + q(9);
    if (colors && cw > 0) {
      const dr = colors[u * 3] - colors[v * 3], dg = colors[u * 3 + 1] - colors[v * 3 + 1], db = colors[u * 3 + 2] - colors[v * 3 + 2];
      const ex = P[u * 3] - x, ey = P[u * 3 + 1] - y, ez = P[u * 3 + 2] - z;
      e += cw * (dr * dr + dg * dg + db * db) * (ex * ex + ey * ey + ez * ez);
    }
    return Math.max(0, e);
  };
  // Collapses only between vertices whose (SDF) normals agree: curved regions keep their density,
  // so per-vertex shading never disagrees with large flat triangles.
  const consider = (a: number, b: number) => {
    if (N[a * 3] * N[b * 3] + N[a * 3 + 1] * N[b * 3 + 1] + N[a * 3 + 2] * N[b * 3 + 2] < minDot) return;
    if (!pinned[a]) push(cost(a, b), a, b);
    if (!pinned[b]) push(cost(b, a), b, a);
  };
  for (let t = 0; t < nT; t += 1) {
    for (let k = 0; k < 3; k += 1) {
      const a = T[t * 3 + k], b = T[t * 3 + ((k + 1) % 3)];
      if (a < b) consider(a, b);
    }
  }

  let triCount = nT;
  const markA = new Int32Array(nV), markB = new Int32Array(nV);
  let stamp = 0;
  while (hn > 0 && triCount > opts.targetTriangles) {
    const c0 = hCost[0], u = hU[0], v = hV[0], vu = hVu[0], vv = hVv[0];
    pop();
    if (c0 > maxCost) break;
    if (!alive[u] || !alive[v] || version[u] !== vu || version[v] !== vv) continue;
    // Edge must still exist and satisfy the link condition: exactly two shared neighbours.
    stamp += 1;
    const lu = inc[u];
    for (let i = 0; i < lu.length; i += 1) {
      const o = lu[i] * 3;
      markA[T[o]] = stamp; markA[T[o + 1]] = stamp; markA[T[o + 2]] = stamp;
    }
    if (markA[v] !== stamp) continue;
    let shares = 0;
    const lv = inc[v];
    for (let i = 0; i < lv.length && shares < 3; i += 1) {
      const o = lv[i] * 3;
      for (let k = 0; k < 3; k += 1) {
        const w = T[o + k];
        if (w !== u && w !== v && markA[w] === stamp && markB[w] !== stamp) {
          markB[w] = stamp;
          shares += 1;
        }
      }
    }
    if (shares !== 2) continue;
    // Reject flips / slivers around u.
    let ok = true;
    const vx = P[v * 3], vy = P[v * 3 + 1], vz = P[v * 3 + 2];
    for (let i = 0; i < lu.length; i += 1) {
      const o = lu[i] * 3;
      const a = T[o], b = T[o + 1], c = T[o + 2];
      if (a === v || b === v || c === v) continue;
      const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
      const bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2];
      const cx = P[c * 3], cy = P[c * 3 + 1], cz = P[c * 3 + 2];
      let ux = bx - ax, uy = by - ay, uz = bz - az, wx = cx - ax, wy = cy - ay, wz = cz - az;
      const n0x = uy * wz - uz * wy, n0y = uz * wx - ux * wz, n0z = ux * wy - uy * wx;
      // Same triangle with u moved onto v.
      const pax = a === u ? vx : ax, pay = a === u ? vy : ay, paz = a === u ? vz : az;
      const pbx = b === u ? vx : bx, pby = b === u ? vy : by, pbz = b === u ? vz : bz;
      const pcx = c === u ? vx : cx, pcy = c === u ? vy : cy, pcz = c === u ? vz : cz;
      ux = pbx - pax; uy = pby - pay; uz = pbz - paz; wx = pcx - pax; wy = pcy - pay; wz = pcz - paz;
      const n1x = uy * wz - uz * wy, n1y = uz * wx - ux * wz, n1z = ux * wy - uy * wx;
      const l0 = Math.sqrt(n0x * n0x + n0y * n0y + n0z * n0z), l1 = Math.sqrt(n1x * n1x + n1y * n1y + n1z * n1z);
      if (l1 < 1e-14 || n0x * n1x + n0y * n1y + n0z * n1z < 0.55 * l0 * l1) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    // Collapse u → v: drop the two shared triangles, re-point the rest of u's fan at v.
    for (let i = 0; i < lu.length; i += 1) {
      const t = lu[i];
      const o = t * 3;
      if (T[o] === v || T[o + 1] === v || T[o + 2] === v) {
        triAlive[t] = 0;
        triCount -= 1;
        continue;
      }
      if (T[o] === u) T[o] = v;
      else if (T[o + 1] === u) T[o + 1] = v;
      else T[o + 2] = v;
      lv.push(t);
    }
    alive[u] = 0;
    inc[u] = [];
    for (let i = 0; i < 10; i += 1) Q[v * 10 + i] += Q[u * 10 + i];
    version[v] += 1;
    let n = 0;
    for (let i = 0; i < lv.length; i += 1) if (triAlive[lv[i]]) lv[n++] = lv[i];
    lv.length = n;
    // Only v's quadric changed: re-cost its edges (old entries are stale by v's version).
    stamp += 1;
    for (let i = 0; i < n; i += 1) {
      const o = lv[i] * 3;
      for (let k = 0; k < 3; k += 1) {
        const w = T[o + k];
        if (w !== v && markA[w] !== stamp) {
          markA[w] = stamp;
          consider(v, w);
        }
      }
    }
  }
  return finish(mesh, T, triAlive, alive, colors);
}

function finish(mesh: RawMesh, T: Int32Array, triAlive: Uint8Array, alive: Uint8Array, colors?: Float32Array): DecimatedMesh {
  const nV = mesh.positions.length / 3;
  const used = new Int32Array(nV).fill(-1);
  let tris = 0;
  for (let t = 0; t < triAlive.length; t += 1) {
    if (!triAlive[t]) continue;
    tris += 1;
    for (let k = 0; k < 3; k += 1) used[T[t * 3 + k]] = 0;
  }
  let count = 0;
  for (let v = 0; v < nV; v += 1) if (used[v] === 0 && alive[v]) used[v] = count++;
  const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3);
  const source = new Uint32Array(count);
  const outColors = colors ? new Float32Array(count * 3) : undefined;
  for (let v = 0; v < nV; v += 1) {
    const n = used[v];
    if (n < 0) continue;
    source[n] = v;
    for (let k = 0; k < 3; k += 1) {
      positions[n * 3 + k] = mesh.positions[v * 3 + k];
      normals[n * 3 + k] = mesh.normals[v * 3 + k];
      if (outColors && colors) outColors[n * 3 + k] = colors[v * 3 + k];
    }
  }
  const indices = new Uint32Array(tris * 3);
  let o = 0;
  for (let t = 0; t < triAlive.length; t += 1) {
    if (!triAlive[t]) continue;
    indices[o++] = used[T[t * 3]];
    indices[o++] = used[T[t * 3 + 1]];
    indices[o++] = used[T[t * 3 + 2]];
  }
  return { positions, normals, indices, colors: outColors, source };
}
