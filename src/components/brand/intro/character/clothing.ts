/**
 * Clothing shells from the body's own sampled grid (worker-safe: no `three`, no DOM).
 * OWNER: character-body.
 *
 * Each garment (definitions in `clothingStyles.ts`) is a shell field on a sub-box of the body
 * grid: g = max(min(blur(v), v) − offset, −v − ε, clip). The blurred body field bridges small
 * dips the way fabric spans them (`min` with the raw field keeps convex areas from shrinking
 * into the skin); the −v − ε term closes the shell just under the skin so no surfaces cut through
 * the body interior; the clip (bone-relative necklines, armholes, hems) only needs evaluating in
 * the thin band where the other two terms are near zero, which keeps this cheap. After Surface
 * Nets the hidden inner surface is dropped, leaving the outer surface plus a thin hem rim.
 *
 * Also: the belt buckle and wrist wraps (small dedicated SDF meshes), the body-coverage test
 * used to delete skin triangles hidden under clothing, and inner-layer triangle removal.
 */

import { bakeAO, capsule, custom, ellipsoid, halfSpace, intersect, meshSdf, roundBox, smoothAttribute, smoothIntersect, smoothUnion, subtract, surfaceNets, union, vertexAdjacency } from "../sdf";
import type { FieldGrid, RawMesh, Sdf } from "../sdf";
import { clamp01, fbm3, mixRGB, smoothstep, srgbHexToLinear } from "../math";
import type { LinearRGB } from "../types";
import type { BodyModel } from "./body";
import { garmentsFor, type GarmentDef } from "./clothingStyles";
import { compactMesh, cutAlongIso, edgeDistance, filterTriangles, remapAttribute, tangentialRelax, type AttributedMesh } from "./meshUtil";
import { frameQuat, v3comb, v3scale, type V3 } from "./frames";
import type { CharacterSpec, MaterialRole } from "./types";

export interface ClothingPiece {
  name: string;
  role: MaterialRole;
  mesh: RawMesh;
  colors: Float32Array;
  roughness?: number;
  /** For layering: the garment definition (absent for the buckle and wraps). */
  def?: GarmentDef;
  /** Point on the skin under each vertex (skin-weight transfer queries). */
  anchor: Float32Array;
}

export interface ClothingResult {
  pieces: ClothingPiece[];
  /** Negative where skin is hidden under clothing by more than the garment's hem margin. */
  bodyCoverage: (x: number, y: number, z: number) => number;
  /** Multiplier (≤ 1) darkening skin just past a hem (contact shadow of the fabric edge). */
  hemShadow: (x: number, y: number, z: number) => number;
  /** Largest field offset any garment needs (the body grid must be exact this far out). */
  maxOffset: number;
}

/** Narrow-band width the body grid needs for these garments (pass as `band` to sampleSdf). */
export function clothingBand(spec: CharacterSpec, body: BodyModel): number {
  const max = garmentsFor(spec, body).reduce((m, g) => Math.max(m, g.maxOffset), 0);
  // Exact samples are needed up to offset + 2 cells (blur + nets); the sampler already gives
  // (√3 + 1)·cell for free.
  return Math.max(0, max + 2 * body.cell - (Math.sqrt(3) + 1) * body.cell) + 0.002;
}

interface SubGrid {
  grid: FieldGrid;
  /** Raw body values on the sub-grid (same layout). */
  raw: Float32Array;
}

function subGrid(body: FieldGrid, def: GarmentDef): SubGrid | null {
  const [nx, ny, nz] = body.dims;
  const c = body.cell;
  const [ox, oy, oz] = body.origin;
  const i0 = Math.max(0, Math.floor((def.box.min[0] - ox) / c)), i1 = Math.min(nx - 1, Math.ceil((def.box.max[0] - ox) / c));
  const j0 = Math.max(0, Math.floor((def.box.min[1] - oy) / c)), j1 = Math.min(ny - 1, Math.ceil((def.box.max[1] - oy) / c));
  const k0 = Math.max(0, Math.floor((def.box.min[2] - oz) / c)), k1 = Math.min(nz - 1, Math.ceil((def.box.max[2] - oz) / c));
  if (i1 - i0 < 2 || j1 - j0 < 2 || k1 - k0 < 2) return null;
  const sx = i1 - i0 + 1, sy = j1 - j0 + 1, sz = k1 - k0 + 1;
  const raw = new Float32Array(sx * sy * sz);
  let q = 0;
  for (let k = k0; k <= k1; k += 1) {
    for (let j = j0; j <= j1; j += 1) {
      const row = j * nx + k * nx * ny;
      raw.set(body.values.subarray(row + i0, row + i1 + 1), q);
      q += sx;
    }
  }
  return { grid: { values: new Float32Array(raw.length), dims: [sx, sy, sz], origin: [ox + i0 * c, oy + j0 * c, oz + k0 * c], cell: c }, raw };
}

/** Separable [1, 2, 1] / 4 blur, `passes` times (edges clamped). */
function blur3(src: Float32Array, dims: [number, number, number], passes: number): Float32Array {
  const [nx, ny, nz] = dims;
  let a = Float32Array.from(src);
  let b = new Float32Array(src.length);
  const strides = [1, nx, nx * ny];
  const sizes = [nx, ny, nz];
  for (let p = 0; p < passes; p += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      const st = strides[axis], n = sizes[axis];
      for (let k = 0; k < nz; k += 1) {
        for (let j = 0; j < ny; j += 1) {
          for (let i = 0; i < nx; i += 1) {
            const idx = i + j * nx + k * nx * ny;
            const c = axis === 0 ? i : axis === 1 ? j : k;
            const lo = c > 0 ? a[idx - st] : a[idx];
            const hi = c < n - 1 ? a[idx + st] : a[idx];
            b[idx] = 0.25 * lo + 0.5 * a[idx] + 0.25 * hi;
          }
        }
      }
      const t = a;
      a = b;
      b = t;
    }
  }
  return a;
}

/** Trilinear sample of a grid's values (clamped). */
export function sampleGrid(grid: FieldGrid, values: Float32Array, x: number, y: number, z: number): number {
  const [nx, ny, nz] = grid.dims;
  const c = grid.cell;
  let fx = (x - grid.origin[0]) / c, fy = (y - grid.origin[1]) / c, fz = (z - grid.origin[2]) / c;
  let i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
  i = i < 0 ? 0 : i > nx - 2 ? nx - 2 : i;
  j = j < 0 ? 0 : j > ny - 2 ? ny - 2 : j;
  k = k < 0 ? 0 : k > nz - 2 ? nz - 2 : k;
  fx = clamp01(fx - i); fy = clamp01(fy - j); fz = clamp01(fz - k);
  const sy = nx, sz = nx * ny;
  const o = i + j * sy + k * sz;
  const v00 = values[o] + (values[o + 1] - values[o]) * fx;
  const v10 = values[o + sy] + (values[o + sy + 1] - values[o + sy]) * fx;
  const v01 = values[o + sz] + (values[o + sz + 1] - values[o + sz]) * fx;
  const v11 = values[o + sy + sz] + (values[o + sy + sz + 1] - values[o + sy + sz]) * fx;
  const v0 = v00 + (v10 - v00) * fy, v1 = v01 + (v11 - v01) * fy;
  return v0 + (v1 - v0) * fz;
}

/** SDF view of a sampled grid (trilinear), used as the occluder for a garment's own AO. */
function gridSdf(grid: FieldGrid): Sdf {
  const [nx, ny, nz] = grid.dims;
  const c = grid.cell;
  const o = grid.origin;
  return custom((x, y, z) => sampleGrid(grid, grid.values, x, y, z), { min: [o[0], o[1], o[2]], max: [o[0] + (nx - 1) * c, o[1] + (ny - 1) * c, o[2] + (nz - 1) * c] });
}

function buildGarment(def: GarmentDef, bodyGrid: FieldGrid, seed: number, timings?: Record<string, number>): ClothingPiece | null {
  const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  let tick = clock();
  const lap = (name: string) => {
    const t = clock();
    if (timings) timings[`${def.name}.${name}`] = (timings[`${def.name}.${name}`] ?? 0) + t - tick;
    tick = t;
  };
  const sub = subGrid(bodyGrid, def);
  if (!sub) return null;
  const { grid, raw } = sub;
  const c = grid.cell;
  const eps = 2 * c;
  const blurred = def.blur > 0 ? blur3(raw, grid.dims, def.blur) : raw;
  const [nx, ny, nz] = grid.dims;
  const [ox, oy, oz] = grid.origin;
  const out = grid.values;
  const far = 2 * c;
  const hem = 0.7 * c;
  const boost = def.hemBoost ?? 0.004;
  let index = 0;
  for (let k = 0; k < nz; k += 1) {
    const z = oz + k * c;
    for (let j = 0; j < ny; j += 1) {
      const y = oy + j * c;
      for (let i = 0; i < nx; i += 1, index += 1) {
        const v = raw[index];
        const vb = Math.min(blurred[index], v);
        const outer = vb - def.maxOffset - boost, inner = -v - eps;
        // Far from the shell either term alone decides the sign: skip the clip.
        if (outer > far || inner > far) {
          out[index] = Math.max(outer, inner);
          continue;
        }
        const x = ox + i * c;
        const clip = def.clip(x, y, z);
        // Hem band: the last 2 cm before any edge stands proud (double-folded fabric), which
        // also keeps the rounded edge clear of the skin / inner layer just beneath it.
        const off = def.offset(x, y, z) + boost * (1 - smoothstep(0, 0.02, -clip));
        const shell = Math.max(vb - off, inner);
        // Rounded (rolled) hems: a smooth max instead of a crease the mesher would serrate.
        const k = Math.min(hem, 0.8 * off);
        const h = Math.max(k - Math.abs(shell - clip), 0) / k;
        out[index] = Math.max(shell, clip) + h * h * k * 0.25;
      }
    }
  }
  lap("field");
  // Tangential relax only: sdf-core's projected relax can throw vertices where a garment field
  // is nearly flat (its Newton step is unclamped), so evening out stays in the tangent plane.
  const nets = surfaceNets(grid);
  tangentialRelax(nets, vertexAdjacency(nets), 2, 0.5);
  lap("nets");
  // Drop the hidden inner surface: cut the shell exactly along the contour 4 mm under the skin
  // (a smooth line, unlike whole-triangle removal), keeping the outer surface and hem rims.
  const count = nets.positions.length / 3;
  const skinDist = new Float32Array(count);
  for (let v = 0; v < count; v += 1) skinDist[v] = sampleGrid(grid, raw, nets.positions[v * 3], nets.positions[v * 3 + 1], nets.positions[v * 3 + 2]);
  const tuck = 0.004;
  const trimmed = cutAlongIso({ ...nets, channels: [{ data: skinDist, stride: 1 }] }, (v) => skinDist[v] + tuck);
  const side = trimmed.side;
  const compact = compactMesh(filterTriangles(trimmed.mesh, (a, b, cc) => side[a] > 0 && side[b] > 0 && side[cc] > 0));
  if (compact.mesh.indices.length === 0) return null;
  const keptDist = remapAttribute(trimmed.mesh.channels[0].data, 1, compact.oldIndex);
  lap("trim");
  // Distance from the garment's edge measured along the surface (from the hem-rim vertices),
  // so every binding / piping has the same width whatever the clip function's metric.
  const cDist = keptDist;
  const cAdj = vertexAdjacency(compact.mesh);
  const rimSource = new Uint8Array(cDist.length);
  for (let v = 0; v < cDist.length; v += 1) {
    const q = compact.mesh.positions;
    rimSource[v] = cDist[v] < 0.45 * def.offset(q[v * 3], q[v * 3 + 1], q[v * 3 + 2]) ? 1 : 0;
  }
  const toEdge = smoothAttribute(edgeDistance(compact.mesh, cAdj, rimSource, 0.08), 1, cAdj, 2, 0.5);
  // Iron the edge zone: along necklines and armholes the edge crosses steep, curved slopes the
  // grid resolves as a serrated line; a few Laplacian passes near the edge straighten it.
  smoothNearEdge(compact.mesh, cAdj, toEdge, 0.017, 4);
  // Cut along every accent boundary so graphics change colour on an exact line.
  let am: AttributedMesh = { ...compact.mesh, channels: [{ data: cDist, stride: 1 }, { data: toEdge, stride: 1 }] };
  for (const accent of def.accents) {
    const pos = am.positions;
    const edge = am.channels[1].data;
    const res = cutAlongIso(am, (v) => accent.mask(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2], -edge[v]));
    am = { ...res.mesh, channels: [...res.mesh.channels, { data: Float32Array.from(res.side), stride: 1 }] };
  }
  lap("cut");
  const mesh: RawMesh = { positions: am.positions, normals: am.normals, indices: am.indices };
  const n = mesh.positions.length / 3;
  const dist = am.channels[0].data;
  // Skin anchor under each vertex (for weight transfer): step back along the normal by the
  // vertex's own distance from the skin.
  const anchor = new Float32Array(n * 3);
  const rim = new Float32Array(n);
  for (let v = 0; v < n; v += 1) {
    const d = dist[v];
    const back = Math.max(0, d);
    for (let a = 0; a < 3; a += 1) anchor[v * 3 + a] = mesh.positions[v * 3 + a] - mesh.normals[v * 3 + a] * back;
    // Hem rim faces (fabric edge thickness) sit at or under the skin line: shade them.
    rim[v] = 1 - smoothstep(0.15, 0.7, d / Math.max(def.offset(mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]), 1e-4));
  }
  const adjacency = vertexAdjacency(mesh);
  const ao = smoothAttribute(bakeAO(mesh, gridSdf(grid), { steps: 4, stepSize: 0.012, strength: 0.95 }), 1, adjacency, 2, 0.5);
  lap("ao");
  const sides = am.channels.slice(2).map((c) => c.data);
  const colors = paintGarment(def, mesh, ao, rim, sides, seed);
  lap("paint");
  return { name: def.name, role: def.role, mesh, colors, anchor, roughness: def.roughness, def };
}

/** Full Laplacian smoothing of positions for vertices within `reach` of the edge (fading out). */
function smoothNearEdge(mesh: RawMesh, adjacency: { offsets: Uint32Array; neighbors: Uint32Array }, toEdge: Float32Array, reach: number, passes: number) {
  const p = mesh.positions;
  const n = p.length / 3;
  const next = new Float32Array(p.length);
  for (let pass = 0; pass < passes; pass += 1) {
    next.set(p);
    for (let v = 0; v < n; v += 1) {
      const w = 0.6 * (1 - smoothstep(reach * 0.5, reach, toEdge[v]));
      if (w <= 0) continue;
      const s = adjacency.offsets[v], e = adjacency.offsets[v + 1];
      if (e === s) continue;
      let ax = 0, ay = 0, az = 0;
      for (let q = s; q < e; q += 1) {
        const u = adjacency.neighbors[q];
        ax += p[u * 3]; ay += p[u * 3 + 1]; az += p[u * 3 + 2];
      }
      const inv = 1 / (e - s);
      next[v * 3] = p[v * 3] + w * (ax * inv - p[v * 3]);
      next[v * 3 + 1] = p[v * 3 + 1] + w * (ay * inv - p[v * 3 + 1]);
      next[v * 3 + 2] = p[v * 3 + 2] + w * (az * inv - p[v * 3 + 2]);
    }
    p.set(next);
  }
}

/** Garment paint: base or accent colour (by cut side) × knit noise × folds × AO × rim shading. */
function paintGarment(def: GarmentDef, mesh: RawMesh, ao: Float32Array, rim: Float32Array, sides: Float32Array[], seed: number): Float32Array {
  const n = mesh.positions.length / 3;
  const colors = new Float32Array(n * 3);
  const noise = def.noise ?? 0.04;
  for (let v = 0; v < n; v += 1) {
    const x = mesh.positions[v * 3], y = mesh.positions[v * 3 + 1], z = mesh.positions[v * 3 + 2];
    let col = def.base;
    for (let i = 0; i < sides.length; i += 1) if (sides[i][v] > 0) col = def.accents[i].color;
    const knit = 1 + noise * fbm3(x * 31, y * 31, z * 31, 2, seed);
    // Larger soft folds: low-frequency fbm modulation, then AO toward a deep tone of the fabric.
    const fold = 1 + 0.05 * fbm3(x * 9, y * 9, z * 9, 2, seed + 41);
    const a = Math.pow(clamp01(ao[v]), 1.2);
    const k = knit * (0.32 + 0.68 * a) * fold * (1 - 0.4 * rim[v]);
    colors[v * 3] = col[0] * k;
    colors[v * 3 + 1] = col[1] * k;
    colors[v * 3 + 2] = col[2] * k;
  }
  return colors;
}

// ---------------------------------------------------------------------------------------------
// Buckle and wrist wraps (small dedicated SDF meshes)

function paintFlat(mesh: RawMesh, fn: (x: number, y: number, z: number) => LinearRGB, ao?: Float32Array): Float32Array {
  const n = mesh.positions.length / 3;
  const out = new Float32Array(n * 3);
  for (let v = 0; v < n; v += 1) {
    const c = fn(mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]);
    const a = ao ? 0.35 + 0.65 * ao[v] : 1;
    out[v * 3] = c[0] * a;
    out[v * 3 + 1] = c[1] * a;
    out[v * 3 + 2] = c[2] * a;
  }
  return out;
}

function buckle(beltPiece: ClothingPiece, body: BodyModel): ClothingPiece | null {
  // Front-most belt vertex near the midline at the belt's centre height.
  const p = beltPiece.mesh.positions;
  const yc = body.marks.navel[1] + 0.012 * (body.frames.H / 1.8);
  let best = -Infinity;
  for (let v = 0; v < p.length / 3; v += 1) {
    if (Math.abs(p[v * 3]) < 0.02 && Math.abs(p[v * 3 + 1] - yc) < 0.02 && p[v * 3 + 2] > best) best = p[v * 3 + 2];
  }
  if (!Number.isFinite(best)) return null;
  const s = body.frames.H / 1.8;
  const c: V3 = [0, yc, best + 0.002];
  // Rectangular lever buckle: rounded plate with a recessed window, plus the lever bar.
  const plate = roundBox(c, [0.026 * s, 0.034 * s, 0.006], 0.004);
  const window = roundBox([c[0], c[1], c[2] + 0.006], [0.016 * s, 0.024 * s, 0.006], 0.003);
  const lever = roundBox([c[0] + 0.004 * s, c[1], c[2] + 0.004], [0.006 * s, 0.028 * s, 0.004], 0.003);
  const shape = union(subtract(plate, window), lever);
  const mesh = meshSdf(shape, { cell: 0.0042, relax: 1 });
  const steel = srgbHexToLinear(0x6f7275);
  const colors = paintFlat(mesh, () => steel);
  return { name: "beltBuckle", role: "metal", mesh, colors, roughness: 0.3, anchor: mesh.positions };
}

/** Half-zip down the jersey's centre front: tape + teeth strip and a pull, following the fabric. */
function zipper(top: ClothingPiece, body: BodyModel): ClothingPiece | null {
  const p = top.mesh.positions;
  const sternum = body.marks.sternumTop;
  const s = body.frames.H / 1.8;
  // Highest front point of the jersey near the midline per 1.5 cm slice: the zip's path.
  const pts: V3[] = [];
  for (let y = sternum[1] + 0.012 * s; y > sternum[1] - 0.19 * s; y -= 0.015 * s) {
    let best = -Infinity;
    for (let v = 0; v < p.length / 3; v += 1) {
      if (Math.abs(p[v * 3]) < 0.012 && Math.abs(p[v * 3 + 1] - y) < 0.009 && p[v * 3 + 2] > best) best = p[v * 3 + 2];
    }
    if (Number.isFinite(best) && best > 0) pts.push([0, y, best + 0.0006]);
  }
  if (pts.length < 3) return null;
  // Continuous flattened cord (a capsule chain squashed to ~3 mm thick) plus the slider pull.
  const cord: Sdf[] = [];
  for (let i = 0; i + 1 < pts.length; i += 1) cord.push(capsule(pts[i], pts[i + 1], 0.0045 * s));
  const t = pts[0];
  const shape = smoothUnion(0.002,
    intersect(union(...cord), roundBox([0, (t[1] + pts[pts.length - 1][1]) / 2, (t[2] + pts[pts.length - 1][2]) / 2], [0.006 * s, Math.abs(t[1] - pts[pts.length - 1][1]) / 2 + 0.005, 0.03], 0.001)),
    roundBox([0, t[1] - 0.012 * s, t[2] + 0.003], [0.0042 * s, 0.011 * s, 0.0013], 0.001),
  );
  const mesh = meshSdf(shape, { cell: 0.003, relax: 1 });
  const tape = srgbHexToLinear(0x1d2023);
  const pull = srgbHexToLinear(0x9ea2a6);
  const colors = paintFlat(mesh, (x, y) => (y < t[1] - 0.004 * s && y > t[1] - 0.024 * s && Math.abs(x) < 0.0045 * s ? pull : tape));
  return { name: "zip", role: "plastic", mesh, colors, roughness: 0.35, anchor: mesh.positions };
}

function wristWrap(spec: CharacterSpec, body: BodyModel, side: "L" | "R"): ClothingPiece {
  const f = body.frames.arm[side];
  const s = body.frames.H / 1.8;
  const W = f.c;
  const accent = srgbHexToLinear(spec.outfit.top.accent);
  const deep = mixRGB(accent, [0, 0, 0], 0.45);
  // Snug elliptic tube over the wrist: a long ellipsoid (near-constant cross-section over the
  // wrap) trimmed by two softly rounded caps; the wrap's spiral turns are painted.
  const q = frameQuat(f.dirL, f.frontL);
  const g = body.limbGirths;
  const hx = g.wrist[0] * 1.1 + 0.0034 * s, hz = g.wrist[1] + 0.0034 * s;
  const tube = ellipsoid(v3comb(W, [f.dirL, -0.026 * s]), [hx * 1.03, 0.15 * s, hz * 1.03], q);
  const top = halfSpace(v3comb(W, [f.dirL, -0.068 * s]), v3scale(f.dirL, -1));
  const bottom = halfSpace(v3comb(W, [f.dirL, 0.014 * s]), f.dirL);
  const shape = smoothIntersect(0.004 * s, smoothIntersect(0.004 * s, tube, top), bottom);
  const mesh = meshSdf(shape, { cell: 0.006, relax: 1 });
  const ao = bakeAO(mesh, shape, { steps: 3, stepSize: 0.004 });
  const colors = paintFlat(mesh, (x, y, z) => {
    // Spiral wrap lines: darker diagonal stripes around the wrist.
    const t = (x - W[0]) * f.dirL[0] + (y - W[1]) * f.dirL[1] + (z - W[2]) * f.dirL[2];
    const ang = Math.atan2((x - W[0]) * f.outL[0] + (y - W[1]) * f.outL[1] + (z - W[2]) * f.outL[2], (x - W[0]) * f.frontL[0] + (y - W[1]) * f.frontL[1] + (z - W[2]) * f.frontL[2]);
    const band = Math.sin(t * 260 / s + ang * 1.0);
    const line = smoothstep(0.86, 0.96, band);
    const n = 1 + 0.06 * fbm3(x * 60, y * 60, z * 60, 2, 7);
    const col = mixRGB(accent, deep, 0.55 * line);
    return [col[0] * n, col[1] * n, col[2] * n];
  }, ao);
  return { name: `wristWrap_${side}`, role: "fabric", mesh, colors, roughness: 0.85, anchor: mesh.positions };
}

/** Builds every garment for `spec` from the body grid (sampled with `clothingBand` or wider). */
export function buildClothing(spec: CharacterSpec, body: BodyModel, bodyGrid: FieldGrid, timings?: Record<string, number>): ClothingResult {
  const defs = garmentsFor(spec, body);
  const pieces: ClothingPiece[] = [];
  const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  for (const def of defs) {
    const t0 = clock();
    const piece = buildGarment(def, bodyGrid, spec.seed, timings);
    if (timings) timings[`clothing.${def.name}`] = clock() - t0;
    if (piece) pieces.push(piece);
  }
  // Inner layers lose triangles fully covered by an outer layer (no z-fighting, fewer tris).
  for (const inner of pieces) {
    const outers = pieces.filter((o) => o.def && inner.def && o.def.layer > inner.def.layer);
    if (!outers.length || !inner.def) continue;
    const pos = inner.mesh.positions;
    const hidden = new Uint8Array(pos.length / 3);
    for (let v = 0; v < hidden.length; v += 1) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      hidden[v] = outers.some((o) => (o.def as GarmentDef).clip(x, y, z) < -(o.def as GarmentDef).hemMargin) ? 1 : 0;
    }
    const kept = filterTriangles(inner.mesh, (a, b, c) => !(hidden[a] && hidden[b] && hidden[c]));
    const map = compactMesh(kept);
    inner.mesh = map.mesh;
    inner.colors = remapAttribute(inner.colors, 3, map.oldIndex);
    inner.anchor = remapAttribute(inner.anchor, 3, map.oldIndex);
  }
  const top = pieces.find((p) => p.name === "top");
  if (top && spec.outfit.top.style === "jersey") {
    const z = zipper(top, body);
    if (z) pieces.push(z);
  }
  const belt = pieces.find((p) => p.name === "belt");
  if (belt) {
    const b = buckle(belt, body);
    if (b) pieces.push(b);
  }
  if (spec.outfit.extras.includes("wristWraps")) pieces.push(wristWrap(spec, body, "L"), wristWrap(spec, body, "R"));

  return { pieces, ...garmentCoverage(defs), maxOffset: defs.reduce((m, g) => Math.max(m, g.maxOffset), 0) };
}

/** Skin coverage tests for a set of garments (available before any garment is meshed). */
export function garmentCoverage(defs: GarmentDef[]): Pick<ClothingResult, "bodyCoverage" | "hemShadow"> {
  const bodyCoverage = (x: number, y: number, z: number) => {
    let d = Infinity;
    for (const g of defs) d = Math.min(d, g.clip(x, y, z) + g.hemMargin);
    return d;
  };
  const hemShadow = (x: number, y: number, z: number) => {
    let k = 1;
    for (const g of defs) {
      const e = g.clip(x, y, z);
      if (e > 0 && e < 0.03) k = Math.min(k, 1 - 0.32 * (1 - smoothstep(0, 0.025, e)));
    }
    return k;
  };
  return { bodyCoverage, hemShadow };
}
