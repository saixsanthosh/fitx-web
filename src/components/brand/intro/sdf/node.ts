/**
 * Internal SDF node core (worker-safe: no `three`, no DOM). The public surface is the `Sdf`
 * interface; everything this toolkit builds is a `Node` carrying the extra data evaluators need
 * to skip work *exactly* (skipping never changes a returned value):
 *
 * - `ev(o)`: the hot evaluation entry. V8 boxes every double passed to or returned from a call
 *   it does not inline (a heap allocation each), which dominated the cost of closure trees. So
 *   nodes read the query point from the shared `STACK` at [o, o+1, o+2] and write the distance
 *   to [o+3]; only a small integer is passed. Nodes that change the point (transform, mirror)
 *   use the next frame at o+4. The public `d(x, y, z)` wraps `ev` for callers.
 * - `box` (pruning box) with the invariant `d(p) >= dist(p, box)` for every p outside it, so a
 *   parent can drop a child from a cheap point-to-box distance alone.
 * - `lip` / `slack`: Lipschitz bound and bounded non-Lipschitz part (displacement amplitude).
 * - `spec(region)`: an equivalent node for points inside `region` with children that cannot
 *   influence the result there removed (memoised, so tiles share nodes), and the field's range
 *   over the region in `RANGE`. Samplers specialise once per tile, then evaluate only the few
 *   primitives that matter there.
 */

import type { AABB, Sdf } from "./api";

export type Fn3 = (x: number, y: number, z: number) => number;
/** Evaluates the node for the point at STACK[o..o+2], writing the distance to STACK[o+3]. */
export type Ev = (o: number) => void;
/**
 * Evaluates the node for `n` points (px[i], py[i], pz[i]) into out[i]. Each primitive runs one
 * tight loop, so call overhead is paid once per batch instead of once per point. `level` picks
 * scratch buffers from the pool (each nesting level uses its own). n <= BATCH.
 */
export type BatchEv = (px: Float64Array, py: Float64Array, pz: Float64Array, out: Float64Array, n: number, level: number) => void;

/** Maximum points per batch call. */
export const BATCH = 256;
const pool: Float64Array[][] = [];
/** Four scratch arrays of BATCH doubles reserved for nesting `level`. */
export function scratch(level: number): Float64Array[] {
  while (pool.length <= level) pool.push([new Float64Array(BATCH), new Float64Array(BATCH), new Float64Array(BATCH), new Float64Array(BATCH)]);
  return pool[level];
}

/** Bounds of a batch of points: [x0, y0, z0, x1, y1, z1] in `out`. */
export function batchBox(px: Float64Array, py: Float64Array, pz: Float64Array, n: number, out: Float64Array) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i += 1) {
    const x = px[i], y = py[i], z = pz[i];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  out[0] = x0; out[1] = y0; out[2] = z0; out[3] = x1; out[4] = y1; out[5] = z1;
}

/** Axis-aligned region [x0, y0, z0, x1, y1, z1] (finite) used by specialization. */
export type Region = Float64Array;

/** Doubles per evaluation frame: x, y, z, result. */
export const FRAME = 4;
export const STACK_SIZE = 1 << 16;
/** Shared evaluation stack (one per module instance, i.e. per worker). */
export const STACK = new Float64Array(STACK_SIZE);
/** SP[0]: first free STACK slot. Evaluations reserve `depth` frames above it. */
export const SP = new Int32Array(1);
/** [lo, hi] field range written by the most recent `spec` call. */
export const RANGE = new Float64Array(2);

let nextId = 1;

export interface NodeInit {
  kind: string;
  ev: Ev;
  /** Batch evaluator; defaults to a loop over `ev`. */
  bev?: BatchEv;
  /** Frames used from its own frame upward (1 + nested point changes). Default 1. */
  depth?: number;
  bounds: AABB;
  /** Pruning box; defaults to `bounds`. */
  box?: AABB;
  kids?: Node[] | null;
  /** Reference evaluation without any pruning (tests compare against it). Defaults to `d`. */
  ref?: Fn3;
  /** Region specialization; must write the range to RANGE. Defaults to a Lipschitz leaf. */
  spec?: (self: Node, region: Region) => Node;
  lip?: number;
  slack?: number;
}

/** Every node shares one hidden class so `child.ev` loads stay monomorphic in hot loops. */
export class Node implements Sdf {
  readonly d: Fn3;
  readonly ev: Ev;
  readonly bev: BatchEv;
  readonly depth: number;
  readonly id: number;
  readonly bounds: AABB;
  readonly box: Float64Array;
  readonly kind: string;
  readonly kids: Node[] | null;
  readonly ref: Fn3;
  readonly lip: number;
  readonly slack: number;
  private memo: Map<number, Node> | null;
  private readonly specFn: ((self: Node, region: Region) => Node) | null;

  constructor(init: NodeInit) {
    const ev = init.ev;
    const depth = init.depth ?? 1;
    const span = depth * FRAME;
    this.ev = ev;
    this.bev = init.bev ?? ((px, py, pz, out, n) => {
      const o = reserve(depth);
      for (let i = 0; i < n; i += 1) {
        STACK[o] = px[i];
        STACK[o + 1] = py[i];
        STACK[o + 2] = pz[i];
        ev(o);
        out[i] = STACK[o + 3];
      }
      release(o);
    });
    this.depth = depth;
    this.id = nextId++;
    this.bounds = init.bounds;
    const b = init.box ?? init.bounds;
    this.box = new Float64Array([b.min[0], b.min[1], b.min[2], b.max[0], b.max[1], b.max[2]]);
    this.kind = init.kind;
    this.kids = init.kids ?? null;
    this.lip = init.lip ?? 1;
    this.slack = init.slack ?? 0;
    this.memo = null;
    this.specFn = init.spec ?? null;
    const d: Fn3 = (x, y, z) => {
      const o = SP[0];
      if (o + span > STACK_SIZE) throw new Error("sdf: evaluation stack overflow");
      STACK[o] = x;
      STACK[o + 1] = y;
      STACK[o + 2] = z;
      SP[0] = o + span;
      ev(o);
      SP[0] = o;
      return STACK[o + 3];
    };
    this.d = d;
    this.ref = init.ref ?? d;
  }

  /** Specialised equivalent for points in `region`; writes the field range to RANGE. */
  spec(region: Region): Node {
    return this.specFn ? this.specFn(this, region) : leafSpec(this, region);
  }

  /**
   * Reuses a specialised node built for an earlier tile. `key` is a hash; `matches` confirms a
   * hit (a collision just builds an uncached node).
   */
  memoized(key: number, make: () => Node, matches: (candidate: Node) => boolean): Node {
    if (!this.memo) this.memo = new Map();
    const hit = this.memo.get(key);
    if (hit && matches(hit)) return hit;
    const node = make();
    if (!hit) this.memo.set(key, node);
    return node;
  }
}

/** Reserves `depth` frames on the stack and returns the base offset; pair with `release`. */
export function reserve(depth: number): number {
  const o = SP[0];
  const end = o + depth * FRAME;
  if (end > STACK_SIZE) throw new Error("sdf: evaluation stack overflow");
  SP[0] = end;
  return o;
}

export function release(o: number) {
  SP[0] = o;
}

// ---------------------------------------------------------------------------------------------
// Boxes

export const aabb = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): AABB => ({
  min: [x0, y0, z0],
  max: [x1, y1, z1],
});

export const boxOf = (node: Node): AABB => {
  const b = node.box;
  return aabb(b[0], b[1], b[2], b[3], b[4], b[5]);
};

export function unionBounds(list: AABB[]): AABB {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const b of list) {
    if (b.min[0] < x0) x0 = b.min[0];
    if (b.min[1] < y0) y0 = b.min[1];
    if (b.min[2] < z0) z0 = b.min[2];
    if (b.max[0] > x1) x1 = b.max[0];
    if (b.max[1] > y1) y1 = b.max[1];
    if (b.max[2] > z1) z1 = b.max[2];
  }
  return aabb(x0, y0, z0, x1, y1, z1);
}

export function intersectBounds(a: AABB, b: AABB): AABB {
  return aabb(
    Math.max(a.min[0], b.min[0]), Math.max(a.min[1], b.min[1]), Math.max(a.min[2], b.min[2]),
    Math.min(a.max[0], b.max[0]), Math.min(a.max[1], b.max[1]), Math.min(a.max[2], b.max[2]),
  );
}

export const growBounds = (b: AABB, r: number): AABB =>
  aabb(b.min[0] - r, b.min[1] - r, b.min[2] - r, b.max[0] + r, b.max[1] + r, b.max[2] + r);

export const isFiniteBounds = (b: AABB) =>
  Number.isFinite(b.min[0]) && Number.isFinite(b.min[1]) && Number.isFinite(b.min[2]) &&
  Number.isFinite(b.max[0]) && Number.isFinite(b.max[1]) && Number.isFinite(b.max[2]);

/** Squared distance from a point to box `b[o..o+6)`; 0 inside. Infinite boxes are fine. */
export function boxDist2(b: Float64Array, o: number, x: number, y: number, z: number): number {
  let dx = b[o] - x;
  if (dx < 0) { dx = x - b[o + 3]; if (dx < 0) dx = 0; }
  let dy = b[o + 1] - y;
  if (dy < 0) { dy = y - b[o + 4]; if (dy < 0) dy = 0; }
  let dz = b[o + 2] - z;
  if (dz < 0) { dz = z - b[o + 5]; if (dz < 0) dz = 0; }
  return dx * dx + dy * dy + dz * dz;
}

/** Distance between region `r` and box `b[o..o+6)`; 0 when they overlap. */
export function boxBoxDist(r: Region, b: Float64Array, o: number): number {
  let dx = r[0] - b[o + 3];
  const ex = b[o] - r[3];
  if (ex > dx) dx = ex;
  if (dx < 0) dx = 0;
  let dy = r[1] - b[o + 4];
  const ey = b[o + 1] - r[4];
  if (ey > dy) dy = ey;
  if (dy < 0) dy = 0;
  let dz = r[2] - b[o + 5];
  const ez = b[o + 2] - r[5];
  if (ez > dz) dz = ez;
  if (dz < 0) dz = 0;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Copies the pruning boxes of `kids` into one flat array (6 floats per child). */
export function packBoxes(kids: Node[]): Float64Array {
  const out = new Float64Array(kids.length * 6);
  kids.forEach((kid, index) => out.set(kid.box, index * 6));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Smooth min / max (quadratic polynomial, Inigo Quilez). Blend depth <= k/4 for two inputs.

// Same operation order as the hot paths (precomputed 1/k and k/4), so results are bit-identical.
export function smin(a: number, b: number, k: number): number {
  const diff = a - b;
  const ad = diff < 0 ? -diff : diff;
  if (ad >= k) return a < b ? a : b;
  const h = (k - ad) * (1 / k);
  return (a < b ? a : b) - h * h * (k * 0.25);
}

export function smax(a: number, b: number, k: number): number {
  const diff = a - b;
  const ad = diff < 0 ? -diff : diff;
  if (ad >= k) return a > b ? a : b;
  const h = (k - ad) * (1 / k);
  return (a > b ? a : b) + h * h * (k * 0.25);
}

// ---------------------------------------------------------------------------------------------
// Specialization helpers

/** Centre and half-diagonal of a region. */
export function regionCenter(r: Region): [number, number, number, number] {
  const hx = (r[3] - r[0]) * 0.5, hy = (r[4] - r[1]) * 0.5, hz = (r[5] - r[2]) * 0.5;
  return [r[0] + hx, r[1] + hy, r[2] + hz, Math.sqrt(hx * hx + hy * hy + hz * hz)];
}

/** Range of a `lip`-Lipschitz leaf over a region from one evaluation at its centre. */
export function leafSpec(node: Node, r: Region): Node {
  const hx = (r[3] - r[0]) * 0.5, hy = (r[4] - r[1]) * 0.5, hz = (r[5] - r[2]) * 0.5;
  const rho = Math.sqrt(hx * hx + hy * hy + hz * hz);
  const v = node.d(r[0] + hx, r[1] + hy, r[2] + hz);
  const e = node.lip * rho + 2 * node.slack;
  let lo = v - e;
  const bd = boxBoxDist(r, node.box, 0);
  if (bd > 0 && bd > lo) lo = bd;
  RANGE[0] = lo;
  RANGE[1] = v + e;
  return node;
}

/** Writes indices 0..n-1 sorted by ascending `keys` into `order` (insertion sort; n is small). */
export function sortIndices(keys: Float64Array, order: Int32Array, n: number) {
  for (let i = 0; i < n; i += 1) {
    const key = keys[i];
    let j = i - 1;
    while (j >= 0 && keys[order[j]] > key) {
      order[j + 1] = order[j];
      j -= 1;
    }
    order[j + 1] = i;
  }
}

// ---------------------------------------------------------------------------------------------
// Custom / foreign shapes

/**
 * Wraps a hand-written distance function. `d` must be negative inside, a conservative distance
 * bound that is 1-Lipschitz (or pass `lipschitz`), and its zero set must lie inside `bounds`.
 * Outside `bounds` the value is raised to at least the distance to the box (still a valid
 * bound) so parents can prune it exactly. Cost: your function plus a box test.
 */
export function custom(d: (x: number, y: number, z: number) => number, bounds: AABB, opts: { lipschitz?: number } = {}): Sdf {
  const b0 = bounds.min[0], b1 = bounds.min[1], b2 = bounds.min[2];
  const b3 = bounds.max[0], b4 = bounds.max[1], b5 = bounds.max[2];
  const ev: Ev = (o) => {
    const x = STACK[o], y = STACK[o + 1], z = STACK[o + 2];
    let v: number;
    try {
      v = d(x, y, z);
    } catch (error) {
      SP[0] = 0;
      throw error;
    }
    let dx = b0 - x;
    if (dx < 0) { dx = x - b3; if (dx < 0) dx = 0; }
    let dy = b1 - y;
    if (dy < 0) { dy = y - b4; if (dy < 0) dy = 0; }
    let dz = b2 - z;
    if (dz < 0) { dz = z - b5; if (dz < 0) dz = 0; }
    const q = dx * dx + dy * dy + dz * dz;
    STACK[o + 3] = q > 0 && !(v > 0 && v * v >= q) ? Math.sqrt(q) : v;
  };
  return new Node({ kind: "custom", ev, bounds: aabb(b0, b1, b2, b3, b4, b5), lip: Math.max(1, opts.lipschitz ?? 1) });
}

/** Our own nodes pass through; foreign `{ d, bounds }` objects are wrapped with `custom`. */
export function asNode(shape: Sdf): Node {
  return shape instanceof Node ? shape : (custom(shape.d, shape.bounds) as Node);
}

// ---------------------------------------------------------------------------------------------
// Tiled evaluation: one specialised node per tile, built lazily and cached per shape.

const MAX_TILES = 1 << 21;

export class Tiled {
  readonly node: Node;
  readonly ox: number;
  readonly oy: number;
  readonly oz: number;
  readonly tile: number;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly tiles: (Node | null)[];
  /** Stack evaluation (point at STACK[o..o+2]) through the tile's specialised node. */
  readonly ev: Ev;
  /** Same values as `node.d`, faster for many scattered queries. */
  readonly eval: Fn3;
  built = 0;
  /**
   * Coarser lattice (2× tile, same origin). Tiles specialise their parent tile's already pruned
   * node instead of the whole tree, which makes building thousands of tiles cheap.
   */
  private readonly parent: Tiled | null;

  constructor(node: Node, ox: number, oy: number, oz: number, tile: number, nx: number, ny: number, nz: number, levels = 3) {
    this.node = node;
    this.ox = ox;
    this.oy = oy;
    this.oz = oz;
    this.tile = tile;
    this.nx = nx;
    this.ny = ny;
    this.nz = nz;
    this.parent = levels > 1 && nx * ny * nz > 64
      ? new Tiled(node, ox, oy, oz, tile * 2, Math.ceil(nx / 2), Math.ceil(ny / 2), Math.ceil(nz / 2), levels - 1)
      : null;
    const tiles: (Node | null)[] = new Array<Node | null>(nx * ny * nz).fill(null);
    this.tiles = tiles;
    const inv = 1 / tile;
    const full = node.ev;
    const ev: Ev = (o) => {
      const fx = (STACK[o] - ox) * inv, fy = (STACK[o + 1] - oy) * inv, fz = (STACK[o + 2] - oz) * inv;
      if (fx >= 0 && fy >= 0 && fz >= 0 && fx < nx && fy < ny && fz < nz) {
        const index = (fx | 0) + nx * ((fy | 0) + ny * (fz | 0));
        const t = tiles[index];
        (t === null ? this.build(index) : t).ev(o);
        return;
      }
      full(o);
    };
    this.ev = ev;
    const span = node.depth * FRAME;
    this.eval = (x, y, z) => {
      const o = SP[0];
      if (o + span > STACK_SIZE) throw new Error("sdf: evaluation stack overflow");
      STACK[o] = x;
      STACK[o + 1] = y;
      STACK[o + 2] = z;
      SP[0] = o + span;
      ev(o);
      SP[0] = o;
      return STACK[o + 3];
    };
  }

  /**
   * Evaluates `count` scattered points into `out`: buckets them by tile, then runs each tile's
   * specialised node over the bucket in batches. Points outside the lattice use the full tree.
   */
  evalPoints(xs: Float64Array, ys: Float64Array, zs: Float64Array, out: Float64Array, count: number) {
    const { nx, ny, nz, ox, oy, oz } = this;
    const nt = nx * ny * nz;
    const inv = 1 / this.tile;
    const tileOf = new Int32Array(count);
    const start = new Int32Array(nt + 2);
    for (let i = 0; i < count; i += 1) {
      const fx = (xs[i] - ox) * inv, fy = (ys[i] - oy) * inv, fz = (zs[i] - oz) * inv;
      const t = fx >= 0 && fy >= 0 && fz >= 0 && fx < nx && fy < ny && fz < nz ? (fx | 0) + nx * ((fy | 0) + ny * (fz | 0)) : nt;
      tileOf[i] = t;
      start[t + 1] += 1;
    }
    for (let t = 1; t <= nt + 1; t += 1) start[t] += start[t - 1];
    const cursor = start.slice(0, nt + 1);
    const order = new Int32Array(count);
    for (let i = 0; i < count; i += 1) order[cursor[tileOf[i]]++] = i;
    const bx = new Float64Array(BATCH), by = new Float64Array(BATCH), bz = new Float64Array(BATCH), bo = new Float64Array(BATCH);
    for (let t = 0; t < nt; t += 1) {
      const s = start[t], e = start[t + 1];
      if (s === e) continue;
      const node = this.tiles[t] ?? this.build(t);
      for (let c = s; c < e; c += BATCH) {
        const m = Math.min(BATCH, e - c);
        for (let j = 0; j < m; j += 1) {
          const i = order[c + j];
          bx[j] = xs[i];
          by[j] = ys[i];
          bz[j] = zs[i];
        }
        node.bev(bx, by, bz, bo, m, 0);
        for (let j = 0; j < m; j += 1) out[order[c + j]] = bo[j];
      }
    }
    const s = start[nt], e = start[nt + 1];
    if (s < e) {
      const o = reserve(this.node.depth);
      const ev = this.node.ev;
      for (let q = s; q < e; q += 1) {
        const i = order[q];
        STACK[o] = xs[i];
        STACK[o + 1] = ys[i];
        STACK[o + 2] = zs[i];
        ev(o);
        out[i] = STACK[o + 3];
      }
      release(o);
    }
  }

  /** Specialised node for tile (ix, iy, iz) (must be inside the tile grid). */
  at(ix: number, iy: number, iz: number): Node {
    const index = ix + this.nx * (iy + this.ny * iz);
    return this.tiles[index] ?? this.build(index);
  }

  build(index: number): Node {
    const ix = index % this.nx;
    const iy = Math.floor(index / this.nx) % this.ny;
    const iz = Math.floor(index / (this.nx * this.ny));
    const t = this.tile;
    const region = new Float64Array([
      this.ox + ix * t, this.oy + iy * t, this.oz + iz * t,
      this.ox + (ix + 1) * t, this.oy + (iy + 1) * t, this.oz + (iz + 1) * t,
    ]);
    // The parent tile contains this tile, so its specialised node is exact here too.
    const source = this.parent ? this.parent.at(ix >> 1, iy >> 1, iz >> 1) : this.node;
    const node = source.spec(region);
    this.tiles[index] = node;
    this.built += 1;
    return node;
  }
}

const tiledCache = new WeakMap<Node, Map<string, Tiled>>();

/** Cached tiled evaluator for an explicit tile lattice (used by the sampler and nets). */
export function tiledFor(node: Node, ox: number, oy: number, oz: number, tile: number, nx: number, ny: number, nz: number): Tiled {
  let byKey = tiledCache.get(node);
  if (!byKey) {
    byKey = new Map();
    tiledCache.set(node, byKey);
  }
  const key = `${tile}|${ox}|${oy}|${oz}|${nx}|${ny}|${nz}`;
  let tiled = byKey.get(key);
  if (!tiled) {
    tiled = new Tiled(node, ox, oy, oz, tile, nx, ny, nz);
    byKey.set(key, tiled);
  }
  return tiled;
}

/**
 * Tiled evaluator for scattered queries on `node`. Reuses an existing lattice of similar tile
 * size (e.g. the one `sampleSdf` built, so AO after meshing costs no new specialisation);
 * otherwise covers the node's bounds (+1 tile) on a lattice aligned to `tile`.
 */
export function tiledAuto(node: Node, tile: number): Tiled | null {
  const existing = tiledCache.get(node);
  if (existing) {
    for (const tiled of existing.values()) if (tiled.tile >= tile * 0.5 && tiled.tile <= tile * 2) return tiled;
  }
  const b = node.bounds;
  if (!isFiniteBounds(b) || !(tile > 0)) return null;
  let t = tile;
  const ext = (axis: number) => b.max[axis] - b.min[axis];
  while (Math.ceil(ext(0) / t + 3) * Math.ceil(ext(1) / t + 3) * Math.ceil(ext(2) / t + 3) > MAX_TILES) t *= 1.5;
  const ox = (Math.floor(b.min[0] / t) - 1) * t;
  const oy = (Math.floor(b.min[1] / t) - 1) * t;
  const oz = (Math.floor(b.min[2] / t) - 1) * t;
  const nx = Math.ceil((b.max[0] - ox) / t) + 1;
  const ny = Math.ceil((b.max[1] - oy) / t) + 1;
  const nz = Math.ceil((b.max[2] - oz) / t) + 1;
  return tiledFor(node, ox, oy, oz, t, nx, ny, nz);
}
