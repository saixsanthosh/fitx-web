/**
 * Sampling and polygonisation (worker-safe).
 *
 * `sampleSdf` evaluates a shape on a regular grid with a sparse narrow band: an octree of
 * 4×4×4-sample blocks is probed at region centres, and regions a probe proves far from the
 * surface are filled with a same-sign lower bound of |d| instead of being evaluated. Near blocks
 * are evaluated in one batch call through a copy of the tree specialised to that block, so a
 * sample costs roughly the few primitives that matter there.
 *
 * `surfaceNets` is naive Surface Nets: one vertex per sign-changing cell at the average of its
 * edge crossings, one quad per sign-changing grid edge, split along the shorter diagonal, wound
 * counter-clockwise seen from outside (three.js FrontSide). Closed shapes give closed meshes;
 * where two sheets come within ~1 cell (a narrow groove) they can share an edge (4 faces on it).
 */

import type { AABB, FieldGrid, NetsOptions, RawMesh, SampleOptions, Sdf } from "./api";
import { adjacencyFromIndices } from "./bake";
import { STACK as SHARED_STACK, asNode, isFiniteBounds, release, reserve, tiledFor, type Node, type Tiled } from "./node";

/** Module-local alias (cross-module bindings can compile to getter calls in hot loops). */
const STACK = SHARED_STACK;

const BLOCK = 4;
const SQRT3 = Math.sqrt(3);

/** Diagnostics recorded per sampled grid (see `sampleStats`). */
export interface SampleStats {
  blocks: number;
  activeBlocks: number;
  /** Coarse probes evaluated by the octree pass. */
  probes: number;
  /** Exact evaluations at grid samples (excludes the coarse pass). */
  fineSamples: number;
  totalSamples: number;
  /** Specialised tile nodes built for this grid's lattice so far. */
  tilesBuilt: number;
}

const STATS = new WeakMap<Float32Array, SampleStats>();

/**
 * Blocks the sparse sampler evaluated, keyed by the grid's values array: every corner of a
 * cell straddling an iso level with |iso| <= cell + band lies in one of them, so surfaceNets
 * can scan only these blocks.
 */
const ACTIVE = new WeakMap<Float32Array, { mask: Uint8Array; nbx: number; nby: number; nbz: number; reach: number }>();

/** Sampling diagnostics for a grid returned by `sampleSdf` (undefined for other grids). */
export function sampleStats(grid: FieldGrid): SampleStats | undefined {
  return STATS.get(grid.values);
}

/** Extra tiles around the grid so normal/AO probes just outside it stay on the fast path. */
const PAD_TILES = 2;

/** The tile lattice of a grid: one tile per 4×4×4 sample block (shared by sampler, nets, bakes). */
function gridTiles(node: Node, grid: FieldGrid): Tiled {
  const c = grid.cell;
  const t = BLOCK * c;
  const [nx, ny, nz] = grid.dims;
  return tiledFor(
    node,
    grid.origin[0] - 0.5 * c - PAD_TILES * t, grid.origin[1] - 0.5 * c - PAD_TILES * t, grid.origin[2] - 0.5 * c - PAD_TILES * t,
    t,
    Math.ceil(nx / BLOCK) + 2 * PAD_TILES, Math.ceil(ny / BLOCK) + 2 * PAD_TILES, Math.ceil(nz / BLOCK) + 2 * PAD_TILES,
  );
}

/**
 * Samples `shape` on a grid of spacing `opts.cell` covering `opts.bounds` (default: the shape's
 * bounds) grown by `opts.padding` (default 2 cells). The origin snaps to a multiple of `cell`
 * so grids of different shapes at the same cell size line up.
 *
 * Sparse mode (default) walks an octree of 4×4×4-sample blocks: a region is filled without
 * evaluation when one probe at its centre proves the surface is farther than its half-diagonal
 * + (√3 + 1)·cell + band. Values are therefore exact within (√3 + 1)·cell + band of the zero set
 * (every corner of every sign-changing cell plus its gradient stencil); elsewhere they have the
 * correct sign and |value| >= that distance. This assumes the field never over-estimates the
 * distance to its zero set: true for the exact primitives, the ellipsoid bound and hard
 * unions/intersections of them; smooth blends of ellipsoids are conservative in practice (the lab
 * test checks sparse == dense bit for bit). Displacement widens the band by its amplitude.
 * Near blocks are evaluated with the tree specialised to the block. Cost ≈ 8 point evaluations
 * per output vertex (~25 ms for a 50-primitive body at 12 mm on an M3).
 */
export function sampleSdf(shape: Sdf, opts: SampleOptions): FieldGrid {
  const node = asNode(shape);
  const cell = opts.cell;
  if (!(cell > 0)) throw new Error("sampleSdf: cell must be > 0");
  const pad = opts.padding ?? 2 * cell;
  const b: AABB = opts.bounds ?? node.bounds;
  if (!isFiniteBounds(b)) throw new Error("sampleSdf: shape bounds are infinite (a bare halfSpace?) — pass opts.bounds");
  const ox = Math.floor((b.min[0] - pad) / cell) * cell;
  const oy = Math.floor((b.min[1] - pad) / cell) * cell;
  const oz = Math.floor((b.min[2] - pad) / cell) * cell;
  const nx = Math.max(2, Math.ceil((b.max[0] + pad - ox) / cell) + 1);
  const ny = Math.max(2, Math.ceil((b.max[1] + pad - oy) / cell) + 1);
  const nz = Math.max(2, Math.ceil((b.max[2] + pad - oz) / cell) + 1);
  if (nx * ny * nz > 64e6) throw new Error(`sampleSdf: grid ${nx}×${ny}×${nz} is too large`);
  const values = new Float32Array(nx * ny * nz);
  const grid: FieldGrid = { values, dims: [nx, ny, nz], origin: [ox, oy, oz], cell };

  const sparse = opts.sparse ?? true;
  const band = Math.max(0, opts.band ?? 0);
  const lip = node.lip, slack = node.slack;
  const margin = (SQRT3 + 1) * cell;
  const tiles = gridTiles(node, grid);
  const full = node.ev;
  const sy = nx, sz = nx * ny;
  const nbx = Math.ceil(nx / BLOCK), nby = Math.ceil(ny / BLOCK), nbz = Math.ceil(nz / BLOCK);
  let probes = 0, active = 0, fine = 0;
  const activeMask = new Uint8Array(nbx * nby * nbz);
  const o = reserve(node.depth);
  const bx = new Float64Array(BLOCK ** 3), by = new Float64Array(BLOCK ** 3), bz = new Float64Array(BLOCK ** 3), bo = new Float64Array(BLOCK ** 3);

  const visit = (bx0: number, by0: number, bz0: number, size: number) => {
    const i0 = bx0 * BLOCK, j0 = by0 * BLOCK, k0 = bz0 * BLOCK;
    if (i0 >= nx || j0 >= ny || k0 >= nz) return;
    const i1 = Math.min(i0 + size * BLOCK, nx) - 1, j1 = Math.min(j0 + size * BLOCK, ny) - 1, k1 = Math.min(k0 + size * BLOCK, nz) - 1;
    if (sparse) {
      STACK[o] = ox + (i0 + i1) * 0.5 * cell;
      STACK[o + 1] = oy + (j0 + j1) * 0.5 * cell;
      STACK[o + 2] = oz + (k0 + k1) * 0.5 * cell;
      full(o);
      probes += 1;
      const v = STACK[o + 3];
      const rho = 0.5 * cell * Math.sqrt((i1 - i0) ** 2 + (j1 - j0) ** 2 + (k1 - k0) ** 2);
      const limit = lip * (rho + margin) + band + 4 * slack;
      if (v > limit || v < -limit) {
        // Same-sign lower bound of |d| for every sample of the region.
        const fill = v > 0 ? v - lip * rho - 2 * slack : v + lip * rho + 2 * slack;
        for (let k = k0; k <= k1; k += 1) {
          for (let j = j0; j <= j1; j += 1) {
            const row = j * sy + k * sz;
            values.fill(fill, row + i0, row + i1 + 1);
          }
        }
        return;
      }
    }
    if (size > 1) {
      const h = size >> 1;
      for (let dz = 0; dz < size; dz += h) for (let dy = 0; dy < size; dy += h) for (let dx = 0; dx < size; dx += h) visit(bx0 + dx, by0 + dy, bz0 + dz, h);
      return;
    }
    active += 1;
    activeMask[bx0 + nbx * (by0 + nby * bz0)] = 1;
    // One batch call per block through the block's specialised node.
    let m = 0;
    for (let k = k0; k <= k1; k += 1) {
      for (let j = j0; j <= j1; j += 1) {
        for (let i = i0; i <= i1; i += 1, m += 1) {
          bx[m] = ox + i * cell;
          by[m] = oy + j * cell;
          bz[m] = oz + k * cell;
        }
      }
    }
    tiles.at(bx0 + PAD_TILES, by0 + PAD_TILES, bz0 + PAD_TILES).bev(bx, by, bz, bo, m, 0);
    m = 0;
    for (let k = k0; k <= k1; k += 1) {
      for (let j = j0; j <= j1; j += 1) {
        let index = i0 + j * sy + k * sz;
        for (let i = i0; i <= i1; i += 1, index += 1, m += 1) values[index] = bo[m];
      }
    }
    fine += m;
  };
  let size = 1;
  while (size < Math.max(nbx, nby, nbz)) size <<= 1;
  visit(0, 0, 0, size);
  release(o);
  if (sparse) ACTIVE.set(values, { mask: activeMask, nbx, nby, nbz, reach: cell + band });
  STATS.set(values, { blocks: nbx * nby * nbz, activeBlocks: active, probes, fineSamples: fine, totalSamples: nx * ny * nz, tilesBuilt: tiles.built });
  return grid;
}

/**
 * New grid with `fn(value, x, y, z, index)` applied to every sample (x, y, z = world position).
 * Typical use: clothing from a body field, e.g. `mapGrid(body, (v, x, y, z) =>
 * Math.max(v - 0.005, clip.d(x, y, z)))`. Sample the source with `band` >= the offset. `fn` runs
 * for every sample (dims product), so keep it cheap.
 */
export function mapGrid(grid: FieldGrid, fn: (value: number, x: number, y: number, z: number, index: number) => number): FieldGrid {
  const [nx, ny, nz] = grid.dims;
  const [ox, oy, oz] = grid.origin;
  const c = grid.cell;
  const src = grid.values;
  const out = new Float32Array(src.length);
  let index = 0;
  for (let k = 0; k < nz; k += 1) {
    const z = oz + k * c;
    for (let j = 0; j < ny; j += 1) {
      const y = oy + j * c;
      for (let i = 0; i < nx; i += 1, index += 1) out[index] = fn(src[index], ox + i * c, y, z, index);
    }
  }
  return { values: out, dims: [nx, ny, nz], origin: [ox, oy, oz], cell: c };
}

// ---------------------------------------------------------------------------------------------
// Grid interpolation (used when no `gradientFrom` is given)

/** Trilinear value and interpolated central-difference gradient of a grid at (x, y, z). */
function gridProbe(grid: FieldGrid, x: number, y: number, z: number, out: Float64Array) {
  const [nx, ny, nz] = grid.dims;
  const c = grid.cell;
  const v = grid.values;
  let fx = (x - grid.origin[0]) / c, fy = (y - grid.origin[1]) / c, fz = (z - grid.origin[2]) / c;
  let i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
  i = i < 0 ? 0 : i > nx - 2 ? nx - 2 : i;
  j = j < 0 ? 0 : j > ny - 2 ? ny - 2 : j;
  k = k < 0 ? 0 : k > nz - 2 ? nz - 2 : k;
  fx -= i; fy -= j; fz -= k;
  fx = fx < 0 ? 0 : fx > 1 ? 1 : fx;
  fy = fy < 0 ? 0 : fy > 1 ? 1 : fy;
  fz = fz < 0 ? 0 : fz > 1 ? 1 : fz;
  const sy = nx, sz = nx * ny;
  let val = 0, gx = 0, gy = 0, gz = 0;
  for (let corner = 0; corner < 8; corner += 1) {
    const ci = i + (corner & 1), cj = j + ((corner >> 1) & 1), ck = k + ((corner >> 2) & 1);
    const w = ((corner & 1) ? fx : 1 - fx) * (((corner >> 1) & 1) ? fy : 1 - fy) * (((corner >> 2) & 1) ? fz : 1 - fz);
    if (w === 0) continue;
    const index = ci + cj * sy + ck * sz;
    val += w * v[index];
    // Central differences (one-sided on the grid boundary).
    const xl = ci > 0 ? 1 : 0, xr = ci < nx - 1 ? 1 : 0;
    const yl = cj > 0 ? 1 : 0, yr = cj < ny - 1 ? 1 : 0;
    const zl = ck > 0 ? 1 : 0, zr = ck < nz - 1 ? 1 : 0;
    gx += (w * (v[index + xr] - v[index - xl])) / (xl + xr);
    gy += (w * (v[index + yr * sy] - v[index - yl * sy])) / (yl + yr);
    gz += (w * (v[index + zr * sz] - v[index - zl * sz])) / (zl + zr);
  }
  out[0] = val;
  out[1] = gx / c;
  out[2] = gy / c;
  out[3] = gz / c;
}

// ---------------------------------------------------------------------------------------------
// Surface Nets

/**
 * Extracts the `opts.iso` level set of a grid as an indexed triangle mesh.
 *
 * Normals come from `opts.gradientFrom` (tetrahedral central differences, sample points half a
 * cell from the vertex, batched through the shape's per-tile specialised copy: 4 evaluations
 * per vertex) or, without it, from trilinearly interpolated central-difference grid gradients
 * (no evaluations; ≈2° mean deviation, more in sub-cell creases). `opts.relax` passes move each
 * vertex tangentially toward its neighbours' average, then re-project it onto the iso surface
 * along the gradient (more even triangles, same surface; +9 evaluations per vertex per pass with
 * `gradientFrom`). Grids from `sampleSdf` only scan the blocks that can hold the surface.
 */
export function surfaceNets(grid: FieldGrid, opts: NetsOptions = {}): RawMesh {
  const iso = opts.iso ?? 0;
  const [nx, ny, nz] = grid.dims;
  const v = grid.values;
  const c = grid.cell;
  const ox = grid.origin[0], oy = grid.origin[1], oz = grid.origin[2];
  const sy = nx, sz = nx * ny;
  const cellVert = new Int32Array(nx * ny * nz);
  cellVert.fill(-1);

  // Pass 1: cells whose 8 corners straddle the iso level (corner-0 sample index), raster order.
  let cells = new Int32Array(4096);
  let count = 0;
  const push = (cell: number) => {
    if (count === cells.length) {
      const grown = new Int32Array(cells.length * 2);
      grown.set(cells);
      cells = grown;
    }
    cells[count++] = cell;
  };
  const scanRow = (base: number, from: number, to: number) => {
    let a0 = v[base] - iso, a2 = v[base + sy] - iso, a4 = v[base + sz] - iso, a6 = v[base + sy + sz] - iso;
    for (let i = from; i <= to; i += 1, base += 1) {
      const b1 = v[base + 1] - iso, b3 = v[base + 1 + sy] - iso, b5 = v[base + 1 + sz] - iso, b7 = v[base + 1 + sy + sz] - iso;
      const inside = (a0 < 0 ? 1 : 0) + (b1 < 0 ? 1 : 0) + (a2 < 0 ? 1 : 0) + (b3 < 0 ? 1 : 0) + (a4 < 0 ? 1 : 0) + (b5 < 0 ? 1 : 0) + (a6 < 0 ? 1 : 0) + (b7 < 0 ? 1 : 0);
      if (inside !== 0 && inside !== 8) push(base);
      a0 = b1; a2 = b3; a4 = b5; a6 = b7;
    }
  };
  const active = ACTIVE.get(v);
  if (active && Math.abs(iso) <= active.reach) {
    const { mask, nbx, nby, nbz } = active;
    for (let bz = 0; bz < nbz; bz += 1) {
      for (let by = 0; by < nby; by += 1) {
        for (let bx = 0; bx < nbx; bx += 1) {
          if (!mask[bx + nbx * (by + nby * bz)]) continue;
          const i0 = bx * BLOCK, i1 = Math.min(i0 + BLOCK, nx - 1) - 1;
          const j1 = Math.min(by * BLOCK + BLOCK, ny - 1) - 1, k1 = Math.min(bz * BLOCK + BLOCK, nz - 1) - 1;
          if (i1 < i0) continue;
          for (let k = bz * BLOCK; k <= k1; k += 1) for (let j = by * BLOCK; j <= j1; j += 1) scanRow(i0 + j * sy + k * sz, i0, i1);
        }
      }
    }
    cells = cells.slice(0, count).sort();
  } else {
    for (let k = 0; k < nz - 1; k += 1) for (let j = 0; j < ny - 1; j += 1) scanRow(j * sy + k * sz, 0, nx - 2);
  }

  // Pass 2: one vertex per cell at the average of its edge crossings (cell-local coordinates).
  const pos = new Float32Array(count * 3);
  const vmask = new Uint8Array(count);
  for (let vi = 0; vi < count; vi += 1) {
    const base = cells[vi];
    const i = base % nx, j = Math.floor(base / nx) % ny, k = Math.floor(base / sz);
    const a0 = v[base] - iso, b1 = v[base + 1] - iso, a2 = v[base + sy] - iso, b3 = v[base + 1 + sy] - iso;
    const a4 = v[base + sz] - iso, b5 = v[base + 1 + sz] - iso, a6 = v[base + sy + sz] - iso, b7 = v[base + 1 + sy + sz] - iso;
    const mask = (a0 < 0 ? 1 : 0) | (b1 < 0 ? 2 : 0) | (a2 < 0 ? 4 : 0) | (b3 < 0 ? 8 : 0) |
      (a4 < 0 ? 16 : 0) | (b5 < 0 ? 32 : 0) | (a6 < 0 ? 64 : 0) | (b7 < 0 ? 128 : 0);
    let px = 0, py = 0, pz = 0, n = 0;
    // x edges
    if ((mask & 1) !== ((mask >> 1) & 1)) { px += a0 / (a0 - b1); n += 1; }
    if (((mask >> 2) & 1) !== ((mask >> 3) & 1)) { px += a2 / (a2 - b3); py += 1; n += 1; }
    if (((mask >> 4) & 1) !== ((mask >> 5) & 1)) { px += a4 / (a4 - b5); pz += 1; n += 1; }
    if (((mask >> 6) & 1) !== ((mask >> 7) & 1)) { px += a6 / (a6 - b7); py += 1; pz += 1; n += 1; }
    // y edges
    if ((mask & 1) !== ((mask >> 2) & 1)) { py += a0 / (a0 - a2); n += 1; }
    if (((mask >> 1) & 1) !== ((mask >> 3) & 1)) { py += b1 / (b1 - b3); px += 1; n += 1; }
    if (((mask >> 4) & 1) !== ((mask >> 6) & 1)) { py += a4 / (a4 - a6); pz += 1; n += 1; }
    if (((mask >> 5) & 1) !== ((mask >> 7) & 1)) { py += b5 / (b5 - b7); px += 1; pz += 1; n += 1; }
    // z edges
    if ((mask & 1) !== ((mask >> 4) & 1)) { pz += a0 / (a0 - a4); n += 1; }
    if (((mask >> 1) & 1) !== ((mask >> 5) & 1)) { pz += b1 / (b1 - b5); px += 1; n += 1; }
    if (((mask >> 2) & 1) !== ((mask >> 6) & 1)) { pz += a2 / (a2 - a6); py += 1; n += 1; }
    if (((mask >> 3) & 1) !== ((mask >> 7) & 1)) { pz += b3 / (b3 - b7); px += 1; py += 1; n += 1; }
    const inv = 1 / n;
    pos[vi * 3] = ox + (i + px * inv) * c;
    pos[vi * 3 + 1] = oy + (j + py * inv) * c;
    pos[vi * 3 + 2] = oz + (k + pz * inv) * c;
    vmask[vi] = mask;
    cellVert[base] = vi;
  }

  // One quad per sign-changing grid edge leaving each cell's corner 0.
  let icap = Math.max(16, count * 6);
  let idx = new Uint32Array(icap);
  let tri = 0;
  const quad = (qa: number, qb: number, qc: number, qd: number) => {
    const a = cellVert[qa], b = cellVert[qb], cc = cellVert[qc], d = cellVert[qd];
    if (tri + 6 > icap) {
      icap *= 2;
      const i2 = new Uint32Array(icap); i2.set(idx); idx = i2;
    }
    const ac = dist2(pos, a, cc), bd = dist2(pos, b, d);
    if (ac <= bd) {
      idx[tri] = a; idx[tri + 1] = b; idx[tri + 2] = cc;
      idx[tri + 3] = a; idx[tri + 4] = cc; idx[tri + 5] = d;
    } else {
      idx[tri] = a; idx[tri + 1] = b; idx[tri + 2] = d;
      idx[tri + 3] = b; idx[tri + 4] = cc; idx[tri + 5] = d;
    }
    tri += 6;
  };
  for (let vi = 0; vi < count; vi += 1) {
    const base = cells[vi];
    const mask = vmask[vi];
    const i = base % nx, j = Math.floor(base / nx) % ny, k = Math.floor(base / sz);
    const inside = (mask & 1) === 1;
    if ((mask & 1) !== ((mask >> 1) & 1) && j > 0 && k > 0) {
      if (inside) quad(base, base - sy, base - sy - sz, base - sz);
      else quad(base, base - sz, base - sy - sz, base - sy);
    }
    if ((mask & 1) !== ((mask >> 2) & 1) && k > 0 && i > 0) {
      if (inside) quad(base, base - sz, base - sz - 1, base - 1);
      else quad(base, base - 1, base - sz - 1, base - sz);
    }
    if ((mask & 1) !== ((mask >> 4) & 1) && i > 0 && j > 0) {
      if (inside) quad(base, base - 1, base - 1 - sy, base - sy);
      else quad(base, base - sy, base - 1 - sy, base - 1);
    }
  }

  const positions = pos;
  const indices = idx.slice(0, tri);
  const probe = makeProbe(grid, opts);
  const relax = Math.max(0, Math.floor(opts.relax ?? 0));
  if (relax > 0 && count > 0) relaxPositions(positions, indices, probe, iso, relax);
  const xs = new Float64Array(count), ys = new Float64Array(count), zs = new Float64Array(count);
  for (let vi = 0; vi < count; vi += 1) {
    xs[vi] = positions[vi * 3];
    ys[vi] = positions[vi * 3 + 1];
    zs[vi] = positions[vi * 3 + 2];
  }
  const g = probe(xs, ys, zs, count, false);
  const normals = new Float32Array(count * 3);
  const tmp = new Float64Array(4);
  for (let vi = 0; vi < count; vi += 1) {
    let gx = g[vi * 4 + 1], gy = g[vi * 4 + 2], gz = g[vi * 4 + 3];
    let len = Math.sqrt(gx * gx + gy * gy + gz * gz);
    if (!(len > 1e-12)) {
      gridProbe(grid, xs[vi], ys[vi], zs[vi], tmp);
      gx = tmp[1]; gy = tmp[2]; gz = tmp[3];
      len = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    }
    normals[vi * 3] = gx / len;
    normals[vi * 3 + 1] = gy / len;
    normals[vi * 3 + 2] = gz / len;
  }
  return { positions, normals, indices };
}

function dist2(p: Float32Array, a: number, b: number) {
  const dx = p[a * 3] - p[b * 3], dy = p[a * 3 + 1] - p[b * 3 + 1], dz = p[a * 3 + 2] - p[b * 3 + 2];
  return dx * dx + dy * dy + dz * dz;
}

/** Returns [value, gx, gy, gz] per point (4 floats each). `exactValue` adds a centre sample. */
type Probe = (xs: Float64Array, ys: Float64Array, zs: Float64Array, count: number, exactValue: boolean) => Float64Array;

/** Probe from the SDF (tetrahedral central differences, batched through tiles) or the grid. */
function makeProbe(grid: FieldGrid, opts: NetsOptions): Probe {
  if (!opts.gradientFrom) {
    return (xs, ys, zs, count) => {
      const out = new Float64Array(count * 4);
      const tmp = new Float64Array(4);
      for (let i = 0; i < count; i += 1) {
        gridProbe(grid, xs[i], ys[i], zs[i], tmp);
        out.set(tmp, i * 4);
      }
      return out;
    };
  }
  const tiles = gridTiles(asNode(opts.gradientFrom), grid);
  // Tetrahedral central differences, sample points half a cell from p.
  const e = (0.5 * grid.cell) / SQRT3;
  const inv = 1 / (4 * e);
  return (xs, ys, zs, count, exactValue) => {
    const per = exactValue ? 5 : 4;
    const m = count * per;
    const px = new Float64Array(m), py = new Float64Array(m), pz = new Float64Array(m), v = new Float64Array(m);
    for (let i = 0; i < count; i += 1) {
      const x = xs[i], y = ys[i], z = zs[i], q = i * per;
      px[q] = x + e; py[q] = y - e; pz[q] = z - e;
      px[q + 1] = x - e; py[q + 1] = y - e; pz[q + 1] = z + e;
      px[q + 2] = x - e; py[q + 2] = y + e; pz[q + 2] = z - e;
      px[q + 3] = x + e; py[q + 3] = y + e; pz[q + 3] = z + e;
      if (exactValue) { px[q + 4] = x; py[q + 4] = y; pz[q + 4] = z; }
    }
    tiles.evalPoints(px, py, pz, v, m);
    const out = new Float64Array(count * 4);
    for (let i = 0; i < count; i += 1) {
      const q = i * per;
      const a = v[q], b = v[q + 1], c = v[q + 2], d = v[q + 3];
      out[i * 4] = exactValue ? v[q + 4] : (a + b + c + d) * 0.25;
      out[i * 4 + 1] = (a - b - c + d) * inv;
      out[i * 4 + 2] = (-a - b + c + d) * inv;
      out[i * 4 + 3] = (-a + b - c + d) * inv;
    }
    return out;
  };
}

/** Tangential Laplacian smoothing + one Newton projection back onto the iso surface per pass. */
function relaxPositions(positions: Float32Array, indices: Uint32Array, probe: Probe, iso: number, passes: number) {
  const n = positions.length / 3;
  const adj = adjacencyFromIndices(n, indices);
  const xs = new Float64Array(n), ys = new Float64Array(n), zs = new Float64Array(n);
  for (let pass = 0; pass < passes; pass += 1) {
    for (let i = 0; i < n; i += 1) {
      xs[i] = positions[i * 3];
      ys[i] = positions[i * 3 + 1];
      zs[i] = positions[i * 3 + 2];
    }
    const g0 = probe(xs, ys, zs, n, false);
    const mx = new Float64Array(n), my = new Float64Array(n), mz = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      const px = xs[i], py = ys[i], pz = zs[i];
      const s = adj.offsets[i], e = adj.offsets[i + 1];
      if (e === s) { mx[i] = px; my[i] = py; mz[i] = pz; continue; }
      let ax = 0, ay = 0, az = 0;
      for (let q = s; q < e; q += 1) {
        const nb = adj.neighbors[q];
        ax += xs[nb]; ay += ys[nb]; az += zs[nb];
      }
      const inv = 1 / (e - s);
      let dx = ax * inv - px, dy = ay * inv - py, dz = az * inv - pz;
      const gx = g0[i * 4 + 1], gy = g0[i * 4 + 2], gz = g0[i * 4 + 3];
      const gl = Math.sqrt(gx * gx + gy * gy + gz * gz);
      if (gl > 1e-12) {
        const along = (dx * gx + dy * gy + dz * gz) / gl;
        dx -= (along * gx) / gl; dy -= (along * gy) / gl; dz -= (along * gz) / gl;
      }
      mx[i] = px + 0.5 * dx; my[i] = py + 0.5 * dy; mz[i] = pz + 0.5 * dz;
    }
    const g1 = probe(mx, my, mz, n, true);
    for (let i = 0; i < n; i += 1) {
      const gx = g1[i * 4 + 1], gy = g1[i * 4 + 2], gz = g1[i * 4 + 3];
      const gl = gx * gx + gy * gy + gz * gz;
      const step = gl > 1e-12 ? (g1[i * 4] - iso) / gl : 0;
      positions[i * 3] = mx[i] - gx * step;
      positions[i * 3 + 1] = my[i] - gy * step;
      positions[i * 3 + 2] = mz[i] - gz * step;
    }
  }
}

/**
 * `sampleSdf` + `surfaceNets` in one call. Normals default to the shape's own gradient
 * (`gradientFrom: shape`, reusing the sampler's tiles); the narrow band automatically covers |iso|.
 */
export function meshSdf(shape: Sdf, opts: SampleOptions & NetsOptions): RawMesh {
  const band = Math.max(opts.band ?? 0, Math.abs(opts.iso ?? 0));
  const grid = sampleSdf(shape, { ...opts, band });
  return surfaceNets(grid, { iso: opts.iso, relax: opts.relax, gradientFrom: opts.gradientFrom ?? shape });
}
