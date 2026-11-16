/**
 * Small mesh utilities for the generators (worker-safe: no `three`, no DOM). OWNER: character-body.
 */

import type { RawMesh } from "../sdf";

/** Same vertices, only the triangles for which `keep(a, b, c)` is true. */
export function filterTriangles(mesh: RawMesh, keep: (a: number, b: number, c: number) => boolean): RawMesh {
  const src = mesh.indices;
  const out = new Uint32Array(src.length);
  let n = 0;
  for (let t = 0; t < src.length; t += 3) {
    const a = src[t], b = src[t + 1], c = src[t + 2];
    if (!keep(a, b, c)) continue;
    out[n] = a;
    out[n + 1] = b;
    out[n + 2] = c;
    n += 3;
  }
  return { positions: mesh.positions, normals: mesh.normals, indices: out.slice(0, n) };
}

/** Drops vertices no triangle uses. `oldIndex[new] = old` maps per-vertex attributes along. */
export function compactMesh(mesh: RawMesh): { mesh: RawMesh; oldIndex: Uint32Array } {
  const count = mesh.positions.length / 3;
  const remap = new Int32Array(count).fill(-1);
  let used = 0;
  for (let i = 0; i < mesh.indices.length; i += 1) {
    const v = mesh.indices[i];
    if (remap[v] < 0) remap[v] = used++;
  }
  const oldIndex = new Uint32Array(used);
  for (let v = 0; v < count; v += 1) if (remap[v] >= 0) oldIndex[remap[v]] = v;
  // Keep the original vertex order (stable, cache friendly): renumber by ascending old index.
  oldIndex.sort();
  const order = new Int32Array(count).fill(-1);
  for (let i = 0; i < used; i += 1) order[oldIndex[i]] = i;
  const positions = new Float32Array(used * 3);
  const normals = new Float32Array(used * 3);
  for (let i = 0; i < used; i += 1) {
    const o = oldIndex[i];
    positions[i * 3] = mesh.positions[o * 3];
    positions[i * 3 + 1] = mesh.positions[o * 3 + 1];
    positions[i * 3 + 2] = mesh.positions[o * 3 + 2];
    normals[i * 3] = mesh.normals[o * 3];
    normals[i * 3 + 1] = mesh.normals[o * 3 + 1];
    normals[i * 3 + 2] = mesh.normals[o * 3 + 2];
  }
  const indices = new Uint32Array(mesh.indices.length);
  for (let i = 0; i < indices.length; i += 1) indices[i] = order[mesh.indices[i]];
  return { mesh: { positions, normals, indices }, oldIndex };
}

/** Gathers per-vertex attribute rows for kept vertices (`oldIndex[new] = old`). */
export function remapAttribute<T extends Float32Array | Uint16Array>(values: T, stride: number, oldIndex: Uint32Array): T {
  const out = new (values.constructor as { new (n: number): T })(oldIndex.length * stride);
  for (let i = 0; i < oldIndex.length; i += 1) {
    const o = oldIndex[i] * stride;
    for (let c = 0; c < stride; c += 1) out[i * stride + c] = values[o + c];
  }
  return out;
}

/**
 * Dense bucket grid over points for nearest-neighbour queries (typed arrays, no hashing):
 * `query` visits the points in the 27 cells around a position.
 */
export class PointHash {
  private readonly cell: number;
  private readonly ox: number;
  private readonly oy: number;
  private readonly oz: number;
  private readonly nx: number;
  private readonly ny: number;
  private readonly nz: number;
  private readonly heads: Int32Array;
  private readonly next: Int32Array;
  readonly positions: Float32Array;

  constructor(positions: Float32Array, cell: number) {
    this.positions = positions;
    this.cell = cell;
    const n = positions.length / 3;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < n; i += 1) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    if (n === 0) x0 = y0 = z0 = x1 = y1 = z1 = 0;
    this.ox = x0 - cell;
    this.oy = y0 - cell;
    this.oz = z0 - cell;
    this.nx = Math.ceil((x1 - x0) / cell) + 3;
    this.ny = Math.ceil((y1 - y0) / cell) + 3;
    this.nz = Math.ceil((z1 - z0) / cell) + 3;
    this.heads = new Int32Array(this.nx * this.ny * this.nz).fill(-1);
    this.next = new Int32Array(n);
    for (let i = 0; i < n; i += 1) {
      const c = this.cellOf(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      this.next[i] = this.heads[c];
      this.heads[c] = i;
    }
  }

  private cellOf(x: number, y: number, z: number) {
    const i = Math.min(this.nx - 1, Math.max(0, Math.floor((x - this.ox) / this.cell)));
    const j = Math.min(this.ny - 1, Math.max(0, Math.floor((y - this.oy) / this.cell)));
    const k = Math.min(this.nz - 1, Math.max(0, Math.floor((z - this.oz) / this.cell)));
    return i + this.nx * (j + this.ny * k);
  }

  /** Calls `visit(index, distanceSquared)` for every point in the neighbouring cells. */
  query(x: number, y: number, z: number, visit: (index: number, d2: number) => void) {
    const c = this.cell;
    const ci = Math.floor((x - this.ox) / c), cj = Math.floor((y - this.oy) / c), ck = Math.floor((z - this.oz) / c);
    const p = this.positions;
    for (let dk = -1; dk <= 1; dk += 1) {
      const k = ck + dk;
      if (k < 0 || k >= this.nz) continue;
      for (let dj = -1; dj <= 1; dj += 1) {
        const j = cj + dj;
        if (j < 0 || j >= this.ny) continue;
        for (let di = -1; di <= 1; di += 1) {
          const i = ci + di;
          if (i < 0 || i >= this.nx) continue;
          let q = this.heads[i + this.nx * (j + this.ny * k)];
          while (q >= 0) {
            const dx = p[q * 3] - x, dy = p[q * 3 + 1] - y, dz = p[q * 3 + 2] - z;
            visit(q, dx * dx + dy * dy + dz * dz);
            q = this.next[q];
          }
        }
      }
    }
  }
}

/**
 * Mean curvature per vertex from the umbrella Laplacian (cheap; resolution-scale detail):
 * H ≈ −2·(L·n)/ℓ², scaled so a sphere of radius `scale` reads 1 (convex positive).
 */
export function meshCurvature(mesh: RawMesh, adjacency: { offsets: Uint32Array; neighbors: Uint32Array }, scale = 0.035): Float32Array {
  const p = mesh.positions, nrm = mesh.normals;
  const n = p.length / 3;
  const out = new Float32Array(n);
  const { offsets, neighbors } = adjacency;
  for (let v = 0; v < n; v += 1) {
    const s = offsets[v], e = offsets[v + 1];
    if (e === s) continue;
    let lx = 0, ly = 0, lz = 0, l2 = 0;
    const x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2];
    for (let q = s; q < e; q += 1) {
      const u = neighbors[q];
      const dx = p[u * 3] - x, dy = p[u * 3 + 1] - y, dz = p[u * 3 + 2] - z;
      lx += dx; ly += dy; lz += dz;
      l2 += dx * dx + dy * dy + dz * dz;
    }
    const inv = 1 / (e - s);
    const dot = (lx * nrm[v * 3] + ly * nrm[v * 3 + 1] + lz * nrm[v * 3 + 2]) * inv;
    out[v] = l2 > 0 ? (-2 * dot) / (l2 * inv) * scale : 0;
  }
  return out;
}

/**
 * Tangential Laplacian relaxation in place: each vertex moves `lambda` of the way toward its
 * neighbours' average, minus the normal component (so the surface neither shrinks nor drifts,
 * to first order). Evens out Surface Nets triangles without any SDF evaluations.
 */
export function tangentialRelax(mesh: RawMesh, adjacency: { offsets: Uint32Array; neighbors: Uint32Array }, passes = 1, lambda = 0.5) {
  const p = mesh.positions, nrm = mesh.normals;
  const n = p.length / 3;
  const next = new Float32Array(p.length);
  const { offsets, neighbors } = adjacency;
  for (let pass = 0; pass < passes; pass += 1) {
    for (let v = 0; v < n; v += 1) {
      const s = offsets[v], e = offsets[v + 1];
      const x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2];
      if (e === s) {
        next[v * 3] = x; next[v * 3 + 1] = y; next[v * 3 + 2] = z;
        continue;
      }
      let ax = 0, ay = 0, az = 0;
      for (let q = s; q < e; q += 1) {
        const u = neighbors[q];
        ax += p[u * 3]; ay += p[u * 3 + 1]; az += p[u * 3 + 2];
      }
      const inv = 1 / (e - s);
      let dx = ax * inv - x, dy = ay * inv - y, dz = az * inv - z;
      const nx = nrm[v * 3], ny = nrm[v * 3 + 1], nz = nrm[v * 3 + 2];
      const along = dx * nx + dy * ny + dz * nz;
      dx -= along * nx; dy -= along * ny; dz -= along * nz;
      next[v * 3] = x + lambda * dx;
      next[v * 3 + 1] = y + lambda * dy;
      next[v * 3 + 2] = z + lambda * dz;
    }
    p.set(next);
  }
}

/** A mesh with extra per-vertex float channels that follow every edit. */
export interface AttributedMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** Extra channels, each `stride` floats per vertex (interpolated on cuts). */
  channels: Array<{ data: Float32Array; stride: number }>;
}

/**
 * Splits every triangle that crosses the zero level of `value` and duplicates the vertices on
 * the cut, so attributes (colour) can change exactly along a smooth line instead of being
 * interpolated across a whole triangle. Returns the new mesh plus, per vertex, +1 / −1 for which
 * side it belongs to (copies on the cut carry the side of the triangles that use them).
 */
export function cutAlongIso(mesh: AttributedMesh, value: (v: number) => number): { mesh: AttributedMesh; side: Int8Array } {
  const n0 = mesh.positions.length / 3;
  const vals = new Float64Array(n0);
  for (let v = 0; v < n0; v += 1) vals[v] = value(v);
  const idx = mesh.indices;
  const triCount = idx.length / 3;
  // Count crossing triangles first so every output array is allocated once at its final size.
  let crossing = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = vals[idx[t]] > 0, b = vals[idx[t + 1]] > 0, c = vals[idx[t + 2]] > 0;
    if (a !== b || b !== c) crossing += 1;
  }
  if (crossing === 0) {
    const side = new Int8Array(n0);
    for (let v = 0; v < n0; v += 1) side[v] = vals[v] > 0 ? 1 : -1;
    return { mesh, side };
  }
  // Each crossing triangle adds at most 4 vertices (2 cut edges × 2 sides; shared edges reuse).
  const cap = n0 + crossing * 4;
  const pos = new Float32Array(cap * 3);
  const nrm = new Float32Array(cap * 3);
  pos.set(mesh.positions);
  nrm.set(mesh.normals);
  const chans = mesh.channels.map((c) => {
    const d = new Float32Array(cap * c.stride);
    d.set(c.data);
    return d;
  });
  const side = new Int8Array(cap);
  for (let v = 0; v < n0; v += 1) side[v] = vals[v] > 0 ? 1 : -1;
  let count = n0;
  const edgeMap = new Map<number, number>();
  const out = new Uint32Array((triCount + crossing * 2) * 3);
  let o = 0;
  /** Vertex pair on edge (a, b) (created once): the copy for side `s` (+1 first, −1 second). */
  const cut = (a: number, b: number, s: number) => {
    const lo = a < b ? a : b, hi = a < b ? b : a;
    const key = lo * n0 + hi;
    let first = edgeMap.get(key);
    if (first === undefined) {
      const t = vals[lo] / (vals[lo] - vals[hi]);
      first = count;
      for (let copy = 0; copy < 2; copy += 1) {
        const v = count++;
        for (let c = 0; c < 3; c += 1) pos[v * 3 + c] = pos[lo * 3 + c] + (pos[hi * 3 + c] - pos[lo * 3 + c]) * t;
        let nx = nrm[lo * 3] + (nrm[hi * 3] - nrm[lo * 3]) * t;
        let ny = nrm[lo * 3 + 1] + (nrm[hi * 3 + 1] - nrm[lo * 3 + 1]) * t;
        let nz = nrm[lo * 3 + 2] + (nrm[hi * 3 + 2] - nrm[lo * 3 + 2]) * t;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
        nrm[v * 3] = nx; nrm[v * 3 + 1] = ny; nrm[v * 3 + 2] = nz;
        for (let ci = 0; ci < chans.length; ci += 1) {
          const d = chans[ci], st = mesh.channels[ci].stride;
          for (let c = 0; c < st; c += 1) d[v * st + c] = d[lo * st + c] + (d[hi * st + c] - d[lo * st + c]) * t;
        }
        side[v] = copy === 0 ? 1 : -1;
      }
      edgeMap.set(key, first);
    }
    return s > 0 ? first : first + 1;
  };
  for (let t = 0; t < idx.length; t += 3) {
    const t0 = idx[t], t1 = idx[t + 1], t2 = idx[t + 2];
    const s0 = side[t0], s1 = side[t1], s2 = side[t2];
    if (s0 === s1 && s1 === s2) {
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
  }
  return {
    mesh: {
      positions: pos.slice(0, count * 3),
      normals: nrm.slice(0, count * 3),
      indices: out.slice(0, o),
      channels: mesh.channels.map((c, i) => ({ data: chans[i].slice(0, count * c.stride), stride: c.stride })),
    },
    side: side.slice(0, count),
  };
}

/**
 * Multi-source shortest-path distance along mesh edges from every vertex flagged in `source`
 * (Dijkstra, binary heap). Grid meshes overestimate true geodesics by a few percent.
 */
export function edgeDistance(mesh: RawMesh, adjacency: { offsets: Uint32Array; neighbors: Uint32Array }, source: Uint8Array, maxDistance = Infinity): Float32Array {
  const p = mesh.positions;
  const n = p.length / 3;
  const dist = new Float32Array(n).fill(Infinity);
  const heapV = new Int32Array(Math.max(16, n * 4));
  const heapD = new Float64Array(heapV.length);
  let size = 0;
  const push = (v: number, d: number) => {
    let i = size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heapD[parent] <= d) break;
      heapV[i] = heapV[parent];
      heapD[i] = heapD[parent];
      i = parent;
    }
    heapV[i] = v;
    heapD[i] = d;
  };
  const pop = () => {
    const v = heapV[0];
    size -= 1;
    const lastV = heapV[size], lastD = heapD[size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= size) break;
      if (c + 1 < size && heapD[c + 1] < heapD[c]) c += 1;
      if (heapD[c] >= lastD) break;
      heapV[i] = heapV[c];
      heapD[i] = heapD[c];
      i = c;
    }
    heapV[i] = lastV;
    heapD[i] = lastD;
    return v;
  };
  for (let v = 0; v < n; v += 1) {
    if (source[v]) {
      dist[v] = 0;
      push(v, 0);
    }
  }
  const { offsets, neighbors } = adjacency;
  while (size > 0) {
    const d0 = heapD[0];
    const v = pop();
    if (d0 > dist[v] || d0 > maxDistance) continue;
    for (let q = offsets[v]; q < offsets[v + 1]; q += 1) {
      const u = neighbors[q];
      const dx = p[u * 3] - p[v * 3], dy = p[u * 3 + 1] - p[v * 3 + 1], dz = p[u * 3 + 2] - p[v * 3 + 2];
      const nd = d0 + Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (nd < dist[u]) {
        dist[u] = nd;
        if (size < heapV.length) push(u, nd);
      }
    }
  }
  // Unreached / far vertices get the cap (finite, so later smoothing never produces NaN).
  const cap = Number.isFinite(maxDistance) ? maxDistance : 1e3;
  for (let v = 0; v < n; v += 1) if (!(dist[v] <= cap)) dist[v] = cap;
  return dist;
}
