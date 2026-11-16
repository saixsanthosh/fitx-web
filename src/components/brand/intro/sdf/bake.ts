/**
 * Per-vertex bakes and mesh utilities (worker-safe). All functions return new arrays and
 * never mutate their inputs.
 */

import type { AABB, Adjacency, AOOptions, Quat, RawMesh, Sdf, V3 } from "./api";
import { STACK as SHARED_STACK, asNode, release, reserve, tiledAuto } from "./node";
import { quatToMat3 } from "./vec";

/** Module-local alias (cross-module bindings can compile to getter calls in hot loops). */
const STACK = SHARED_STACK;

/**
 * Evaluates `shape` at many scattered points: bucketed per tile and run in batches through the
 * tile's specialised node (reusing tiles a previous `sampleSdf` built for the same shape).
 */
function evalMany(shape: Sdf, tile: number, xs: Float64Array, ys: Float64Array, zs: Float64Array): Float64Array {
  const node = asNode(shape);
  const out = new Float64Array(xs.length);
  const tiled = tiledAuto(node, tile);
  if (tiled) {
    tiled.evalPoints(xs, ys, zs, out, xs.length);
    return out;
  }
  const o = reserve(node.depth);
  for (let i = 0; i < xs.length; i += 1) {
    STACK[o] = xs[i];
    STACK[o + 1] = ys[i];
    STACK[o + 2] = zs[i];
    node.ev(o);
    out[i] = STACK[o + 3];
  }
  release(o);
  return out;
}

/** Unit normal of vertex v (normalised defensively). */
function unitNormal(nrm: Float32Array, v: number, out: Float64Array) {
  const nx = nrm[v * 3], ny = nrm[v * 3 + 1], nz = nrm[v * 3 + 2];
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  out[0] = nx / len;
  out[1] = ny / len;
  out[2] = nz / len;
}

/**
 * Ambient occlusion from the occluder SDF, Quilez style: march `steps` points along each vertex
 * normal at h = stepSize·1, ·2, …; each step contributes clamp((h − d)/h, 0, 1) (the fraction of
 * the expected free distance that is blocked) with weights falling off 0.75× per step.
 * Returns 1 for open surfaces, → 0 in deep creases: ao = clamp(1 − strength·occlusion, 0, 1).
 * Pass the union of every nearby part as `occluder` (e.g. body + head + hair) for contact
 * shadows. Cost: steps × vertices evaluations, bucketed per tile and batched through the tile's
 * specialised copy of the occluder (~12 ms for 18k vertices × 5 steps on an M3).
 */
export function bakeAO(mesh: RawMesh, occluder: Sdf, opts: AOOptions = {}): Float32Array {
  const steps = Math.max(1, Math.floor(opts.steps ?? 5));
  const step = opts.stepSize ?? 0.01;
  const strength = opts.strength ?? 1;
  const weights = new Float64Array(steps);
  let total = 0;
  for (let i = 0; i < steps; i += 1) {
    weights[i] = 0.75 ** i;
    total += weights[i];
  }
  for (let i = 0; i < steps; i += 1) weights[i] /= total;
  const p = mesh.positions;
  const count = p.length / 3;
  const m = count * steps;
  const xs = new Float64Array(m), ys = new Float64Array(m), zs = new Float64Array(m);
  const n = new Float64Array(3);
  for (let v = 0; v < count; v += 1) {
    unitNormal(mesh.normals, v, n);
    for (let i = 0; i < steps; i += 1) {
      const h = step * (i + 1), q = v * steps + i;
      xs[q] = p[v * 3] + n[0] * h;
      ys[q] = p[v * 3 + 1] + n[1] * h;
      zs[q] = p[v * 3 + 2] + n[2] * h;
    }
  }
  const d = evalMany(occluder, Math.min(0.08, Math.max(0.03, step * steps)), xs, ys, zs);
  const out = new Float32Array(count);
  for (let v = 0; v < count; v += 1) {
    let occ = 0;
    for (let i = 0; i < steps; i += 1) {
      const h = step * (i + 1);
      const blocked = (h - d[v * steps + i]) / h;
      occ += weights[i] * (blocked <= 0 ? 0 : blocked >= 1 ? 1 : blocked);
    }
    const ao = 1 - strength * occ;
    out[v] = ao <= 0 ? 0 : ao >= 1 ? 1 : ao;
  }
  return out;
}

export interface CurvatureOptions {
  /** Finite-difference step in meters (default 0.01): larger = curvature of broader forms. */
  h?: number;
  /** Radius that maps to +1 (default 0.035 m): a sphere of this radius reads 1, a cylinder 0.5. */
  scale?: number;
}

/**
 * Mean curvature of the shape's level set at each vertex, H = (κ1 + κ2)/2, times `scale`:
 * positive on convex forms (shoulders, knuckles), negative in creases. Typical body values sit
 * in −1..1 with the defaults. Computed from the SDF as (Δf − f_nn)/|∇f| with 9 evaluations, so
 * it is correct even where the field is only a distance bound.
 */
export function bakeCurvature(mesh: RawMesh, shape: Sdf, opts: CurvatureOptions = {}): Float32Array {
  const h = opts.h ?? 0.01;
  const scale = opts.scale ?? 0.035;
  const p = mesh.positions;
  const count = p.length / 3;
  // Nine probes per vertex: centre, ±x, ±y, ±z, ±normal.
  const xs = new Float64Array(count * 9), ys = new Float64Array(count * 9), zs = new Float64Array(count * 9);
  const n = new Float64Array(3);
  const offsets = [[0, 0, 0], [h, 0, 0], [-h, 0, 0], [0, h, 0], [0, -h, 0], [0, 0, h], [0, 0, -h]];
  for (let v = 0; v < count; v += 1) {
    const x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2], q = v * 9;
    for (let k = 0; k < 7; k += 1) {
      xs[q + k] = x + offsets[k][0];
      ys[q + k] = y + offsets[k][1];
      zs[q + k] = z + offsets[k][2];
    }
    unitNormal(mesh.normals, v, n);
    xs[q + 7] = x + n[0] * h; ys[q + 7] = y + n[1] * h; zs[q + 7] = z + n[2] * h;
    xs[q + 8] = x - n[0] * h; ys[q + 8] = y - n[1] * h; zs[q + 8] = z - n[2] * h;
  }
  const f = evalMany(shape, Math.max(0.03, 4 * h), xs, ys, zs);
  const out = new Float32Array(count);
  const ih2 = 1 / (h * h);
  for (let v = 0; v < count; v += 1) {
    const q = v * 9;
    const f0 = f[q];
    const lap = (f[q + 1] + f[q + 2] + f[q + 3] + f[q + 4] + f[q + 5] + f[q + 6] - 6 * f0) * ih2;
    const fnn = (f[q + 7] + f[q + 8] - 2 * f0) * ih2;
    const gx = (f[q + 1] - f[q + 2]) / (2 * h), gy = (f[q + 3] - f[q + 4]) / (2 * h), gz = (f[q + 5] - f[q + 6]) / (2 * h);
    const g = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    out[v] = 0.5 * ((lap - fnn) / g) * scale;
  }
  return out;
}

/** CSR adjacency from triangle indices. Neighbours are unique and sorted per vertex. */
export function adjacencyFromIndices(vertexCount: number, indices: Uint32Array): Adjacency {
  const degree = new Uint32Array(vertexCount + 1);
  for (let t = 0; t < indices.length; t += 3) {
    degree[indices[t]] += 2;
    degree[indices[t + 1]] += 2;
    degree[indices[t + 2]] += 2;
  }
  const start = new Uint32Array(vertexCount + 1);
  for (let i = 0; i < vertexCount; i += 1) start[i + 1] = start[i] + degree[i];
  const fill = start.slice(0, vertexCount);
  const raw = new Uint32Array(start[vertexCount]);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    raw[fill[a]++] = b; raw[fill[a]++] = c;
    raw[fill[b]++] = a; raw[fill[b]++] = c;
    raw[fill[c]++] = a; raw[fill[c]++] = b;
  }
  // Sort + dedupe each vertex's list in place, then compact.
  const offsets = new Uint32Array(vertexCount + 1);
  let write = 0;
  for (let i = 0; i < vertexCount; i += 1) {
    const s = start[i], e = start[i + 1];
    const list = raw.subarray(s, e);
    list.sort();
    offsets[i] = write;
    let last = -1;
    for (let q = 0; q < list.length; q += 1) {
      const n = list[q];
      if (n !== last) {
        raw[write++] = n;
        last = n;
      }
    }
  }
  offsets[vertexCount] = write;
  return { offsets, neighbors: raw.slice(0, write) };
}

/** CSR vertex adjacency of a mesh (unique neighbours). */
export function vertexAdjacency(mesh: RawMesh): Adjacency {
  return adjacencyFromIndices(mesh.positions.length / 3, mesh.indices);
}

/**
 * Laplacian smoothing of a per-vertex attribute with `stride` components: each iteration moves
 * every value `lambda` (0..1) of the way to its neighbours' average. Returns a new array.
 */
export function smoothAttribute(values: Float32Array, stride: number, adjacency: Adjacency, iterations: number, lambda: number): Float32Array {
  let src = Float32Array.from(values);
  let dst = new Float32Array(values.length);
  const count = adjacency.offsets.length - 1;
  const { offsets, neighbors } = adjacency;
  for (let it = 0; it < iterations; it += 1) {
    for (let i = 0; i < count; i += 1) {
      const s = offsets[i], e = offsets[i + 1];
      const o = i * stride;
      if (e === s) {
        for (let c = 0; c < stride; c += 1) dst[o + c] = src[o + c];
        continue;
      }
      const inv = 1 / (e - s);
      for (let c = 0; c < stride; c += 1) {
        let sum = 0;
        for (let q = s; q < e; q += 1) sum += src[neighbors[q] * stride + c];
        dst[o + c] = src[o + c] + lambda * (sum * inv - src[o + c]);
      }
    }
    const t = src;
    src = dst;
    dst = t;
  }
  return src;
}

/** Concatenates meshes (indices re-based). */
export function mergeMeshes(meshes: RawMesh[]): RawMesh {
  let vertices = 0, indexCount = 0;
  for (const m of meshes) {
    vertices += m.positions.length / 3;
    indexCount += m.indices.length;
  }
  const positions = new Float32Array(vertices * 3);
  const normals = new Float32Array(vertices * 3);
  const indices = new Uint32Array(indexCount);
  let vo = 0, io = 0;
  for (const m of meshes) {
    positions.set(m.positions, vo * 3);
    normals.set(m.normals, vo * 3);
    for (let i = 0; i < m.indices.length; i += 1) indices[io + i] = m.indices[i] + vo;
    vo += m.positions.length / 3;
    io += m.indices.length;
  }
  return { positions, normals, indices };
}

/** Mirror across the YZ plane (x → −x) with normals mirrored and winding flipped (stays outward/CCW). */
export function mirrorMeshX(mesh: RawMesh): RawMesh {
  const positions = Float32Array.from(mesh.positions);
  const normals = Float32Array.from(mesh.normals);
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = -positions[i];
    normals[i] = -normals[i];
  }
  const indices = Uint32Array.from(mesh.indices);
  for (let t = 0; t < indices.length; t += 3) {
    const b = indices[t + 1];
    indices[t + 1] = indices[t + 2];
    indices[t + 2] = b;
  }
  return { positions, normals, indices };
}

/** p ↦ translate + rotate(scale · p); normals rotated (uniform scale > 0 keeps them unit). */
export function transformMesh(mesh: RawMesh, xf: { translate?: V3; rotate?: Quat; scale?: number }): RawMesh {
  const s = xf.scale ?? 1;
  if (!(s > 0)) throw new Error("transformMesh: scale must be > 0");
  const t = xf.translate ?? [0, 0, 0];
  const m = xf.rotate ? quatToMat3(xf.rotate) : new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const positions = new Float32Array(mesh.positions.length);
  const normals = new Float32Array(mesh.normals.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = mesh.positions[i] * s, y = mesh.positions[i + 1] * s, z = mesh.positions[i + 2] * s;
    positions[i] = t[0] + m[0] * x + m[1] * y + m[2] * z;
    positions[i + 1] = t[1] + m[3] * x + m[4] * y + m[5] * z;
    positions[i + 2] = t[2] + m[6] * x + m[7] * y + m[8] * z;
    const nx = mesh.normals[i], ny = mesh.normals[i + 1], nz = mesh.normals[i + 2];
    normals[i] = m[0] * nx + m[1] * ny + m[2] * nz;
    normals[i + 1] = m[3] * nx + m[4] * ny + m[5] * nz;
    normals[i + 2] = m[6] * nx + m[7] * ny + m[8] * nz;
  }
  return { positions, normals, indices: Uint32Array.from(mesh.indices) };
}

/** AABB of packed xyz positions (all zeros for an empty array). */
export function computeBounds(positions: Float32Array): AABB {
  if (positions.length < 3) return { min: [0, 0, 0], max: [0, 0, 0] };
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  return { min: [x0, y0, z0], max: [x1, y1, z1] };
}
