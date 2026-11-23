/**
 * SDF operations (worker-safe). All results are `Sdf` nodes with conservative bounds.
 *
 * Exact pruning: `union`, `smoothUnion`, `subtract` and `smoothSubtract` skip a child whenever a
 * cheap point-to-box distance already proves it cannot change the result (every node satisfies
 * d(p) >= distance to its pruning box). Skipping never changes a value, so the field is
 * identical to the naive evaluation. A 40-primitive body therefore costs about as much as the
 * 1-4 primitives near the query point plus a few box tests.
 *
 * `smoothUnion(k, a, b, c, ...)` is the left fold smin(smin(smin(a, b), c), ...) with Quilez's
 * quadratic polynomial smin; for two shapes it is the classic symmetric blend. Put shapes that
 * must not blend with each other in a hard `union` (e.g. left vs right limbs) and blend that
 * group as one child.
 */

import type { AABB, Sdf } from "./api";
import {
  Node,
  RANGE as SHARED_RANGE,
  STACK as SHARED_STACK,
  asNode,
  batchBox,
  boxBoxDist,
  boxDist2 as sharedBoxDist2,
  boxOf,
  growBounds,
  intersectBounds,
  packBoxes,
  smax,
  smin,
  sortIndices,
  scratch,
  unionBounds,
  type BatchEv,
  type Ev,
  type Region,
} from "./node";

export { custom } from "./node";

// Module-local aliases: bundlers and CJS loaders turn cross-module bindings into getter calls,
// which would otherwise run on every evaluation in the hot closures below.
const STACK = SHARED_STACK;
const RANGE = SHARED_RANGE;
const boxDist2 = sharedBoxDist2;

const maxLip = (kids: Node[]) => kids.reduce((m, k) => Math.max(m, k.lip), 1);
const maxSlack = (kids: Node[]) => kids.reduce((m, k) => Math.max(m, k.slack), 0);
const maxDepth = (kids: Node[]) => kids.reduce((m, k) => Math.max(m, k.depth), 1);
const pairKey = (a: Node, b: Node) => Math.imul(a.id, 0x9e3779b1) ^ b.id;
const volume = (b: AABB) => {
  const v = Math.max(0, b.max[0] - b.min[0]) * Math.max(0, b.max[1] - b.min[1]) * Math.max(0, b.max[2] - b.min[2]);
  return Number.isFinite(v) ? v : Infinity;
};

/**
 * Largest depression of an m-input smin fold below the min of its inputs, in units of k:
 * u1 = 0, u(m+1) = u(m) + (1 − u(m))²/4 (worst case: each new input equals the current min).
 * Always < 1.
 */
const DEPRESSION: number[] = [0, 0];
for (let m = 2; m < 64; m += 1) DEPRESSION.push(DEPRESSION[m - 1] + (1 - DEPRESSION[m - 1]) ** 2 / 4);
const depression = (m: number) => (m < DEPRESSION.length ? DEPRESSION[m] : 1);

/** Per-node scratch for region ranges of the children (no allocation per tile). */
class Ranger {
  readonly lo: Float64Array;
  readonly hi: Float64Array;
  readonly sub: (Node | null)[];
  /** Indices of the children a specialisation keeps, and how many. */
  readonly keep: Int32Array;
  kept = 0;
  private readonly bbd: Float64Array;
  private readonly order: Int32Array;
  private readonly kids: Node[];
  constructor(kids: Node[]) {
    this.kids = kids;
    const n = kids.length;
    this.lo = new Float64Array(n);
    this.hi = new Float64Array(n);
    this.bbd = new Float64Array(n);
    this.order = new Int32Array(n);
    this.keep = new Int32Array(n);
    this.sub = new Array<Node | null>(n).fill(null);
  }

  /** The kept child (specialised if it was evaluated) at position t. */
  keptNode(t: number): Node {
    const i = this.keep[t];
    return this.sub[i] ?? this.kids[i];
  }

  /** 32-bit hash of the kept children's identities (memo key; verified on hit). */
  hash(): number {
    let h = 0x811c9dc5;
    for (let t = 0; t < this.kept; t += 1) h = Math.imul(h ^ this.keptNode(t).id, 0x01000193);
    return h;
  }

  /** True when `node.kids` is exactly the kept list. */
  matches(node: Node): boolean {
    const kids = node.kids;
    if (!kids || kids.length !== this.kept) return false;
    for (let t = 0; t < this.kept; t += 1) if (kids[t] !== this.keptNode(t)) return false;
    return true;
  }

  /** True when every child is kept and unchanged (the specialisation is the node itself). */
  unchanged(): boolean {
    if (this.kept !== this.kids.length) return false;
    for (let t = 0; t < this.kept; t += 1) if (this.keptNode(t) !== this.kids[t]) return false;
    return true;
  }

  keptNodes(): Node[] {
    const out: Node[] = [];
    for (let t = 0; t < this.kept; t += 1) out.push(this.keptNode(t));
    return out;
  }

  /** Children nearest first; those farther than (best upper bound + margin) are left unevaluated. */
  run(g: Region, margin: number) {
    const { kids, lo, hi, sub, bbd, order } = this;
    const n = kids.length;
    for (let i = 0; i < n; i += 1) bbd[i] = boxBoxDist(g, kids[i].box, 0);
    sortIndices(bbd, order, n);
    let best = Infinity;
    for (let o = 0; o < n; o += 1) {
      const i = order[o];
      if (bbd[i] >= best + margin) {
        lo[i] = bbd[i];
        hi[i] = Infinity;
        sub[i] = null;
        continue;
      }
      const node = kids[i].spec(g);
      const l = RANGE[0], h = RANGE[1];
      lo[i] = bbd[i] > 0 && bbd[i] > l ? bbd[i] : l;
      hi[i] = h;
      sub[i] = node;
      if (h < best) best = h;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Union (hard min)

/** Hard union (min) of any number of shapes. Nested unions are flattened (min is associative). */
export function union(...shapes: Sdf[]): Sdf {
  const kids: Node[] = [];
  for (const shape of shapes) {
    const node = asNode(shape);
    if (node.kind === "union" && node.kids) kids.push(...node.kids);
    else kids.push(node);
  }
  if (kids.length === 0) throw new Error("sdf union() needs at least one shape");
  return kids.length === 1 ? kids[0] : makeUnion(kids);
}

function makeUnion(kids: Node[]): Node {
  let ranger: Ranger | null = null;
  return new Node({
    kind: "union",
    kids,
    ev: kids.length === 2 ? union2(kids[0], kids[1]) : unionN(kids),
    bev: unionBatch(kids),
    depth: maxDepth(kids),
    bounds: unionBounds(kids.map((k) => k.bounds)),
    box: unionBounds(kids.map(boxOf)),
    ref: (x, y, z) => {
      let r = Infinity;
      for (const kid of kids) {
        const v = kid.ref(x, y, z);
        if (v < r) r = v;
      }
      return r;
    },
    spec: (self, g) => specUnion(self, kids, (ranger ??= new Ranger(kids)), g),
    lip: maxLip(kids),
    slack: maxSlack(kids),
  });
}

function union2(a: Node, b: Node): Ev {
  const A = a.box, B = b.box, ea = a.ev, eb = b.ev;
  return (o) => {
    const x = STACK[o], y = STACK[o + 1], z = STACK[o + 2];
    const qa = boxDist2(A, 0, x, y, z), qb = boxDist2(B, 0, x, y, z);
    if (qa <= qb) {
      ea(o);
      const va = STACK[o + 3];
      if (qb > 0 && (va <= 0 || qb >= va * va)) return;
      eb(o);
      if (va < STACK[o + 3]) STACK[o + 3] = va;
      return;
    }
    eb(o);
    const vb = STACK[o + 3];
    if (qa > 0 && (vb <= 0 || qa >= vb * vb)) return;
    ea(o);
    if (vb < STACK[o + 3]) STACK[o + 3] = vb;
  };
}

function unionN(kids: Node[]): Ev {
  const n = kids.length;
  const boxes = packBoxes(kids);
  const evs = kids.map((k) => k.ev);
  const q = new Float64Array(n);
  return (o) => {
    const x = STACK[o], y = STACK[o + 1], z = STACK[o + 2];
    let j = 0, qmin = Infinity;
    for (let i = 0; i < n; i += 1) {
      const v = boxDist2(boxes, i * 6, x, y, z);
      q[i] = v;
      if (v < qmin) { qmin = v; j = i; }
    }
    evs[j](o);
    let r = STACK[o + 3];
    for (let i = 0; i < n; i += 1) {
      if (i === j) continue;
      const qi = q[i];
      // d_i >= sqrt(qi) >= r: cannot lower the min.
      if (qi > 0 && (r <= 0 || qi >= r * r)) continue;
      evs[i](o);
      const v = STACK[o + 3];
      if (v < r) r = v;
    }
    STACK[o + 3] = r;
  };
}

/** Max of out[0..n). */
function maxOf(out: Float64Array, n: number) {
  let m = -Infinity;
  for (let i = 0; i < n; i += 1) if (out[i] > m) m = out[i];
  return m;
}

function unionBatch(kids: Node[]): BatchEv {
  const bevs = kids.map((k) => k.bev);
  const boxes = packBoxes(kids);
  return (px, py, pz, out, n, level) => {
    const sc = scratch(level);
    const tmp = sc[0], bb = sc[1];
    bevs[0](px, py, pz, out, n, level + 1);
    batchBox(px, py, pz, n, bb);
    for (let c = 1; c < bevs.length; c += 1) {
      // Skip a child that is farther from the whole batch than every current value.
      const bd = boxBoxDist(bb, boxes, c * 6);
      if (bd > 0 && bd >= maxOf(out, n)) continue;
      bevs[c](px, py, pz, tmp, n, level + 1);
      for (let i = 0; i < n; i += 1) if (tmp[i] < out[i]) out[i] = tmp[i];
    }
  };
}

/** Specialised node for the ranger's kept children: itself, the single child, or a memoised copy. */
function rebuild(self: Node, ranger: Ranger, make: (kids: Node[]) => Node): Node {
  if (ranger.kept === 1) return ranger.keptNode(0);
  if (ranger.unchanged()) return self;
  return self.memoized(ranger.hash(), () => make(ranger.keptNodes()), (candidate) => ranger.matches(candidate));
}

function specUnion(self: Node, kids: Node[], ranger: Ranger, g: Region): Node {
  ranger.run(g, 0);
  const { lo, hi, keep } = ranger;
  const n = kids.length;
  let j1 = 0;
  for (let i = 1; i < n; i += 1) if (hi[i] < hi[j1]) j1 = i;
  const h1 = hi[j1];
  let kept = 0, minLo = Infinity;
  for (let i = 0; i < n; i += 1) {
    // Child i never wins the min inside the region if its lower bound exceeds j1's upper bound.
    if (i !== j1 && lo[i] >= h1) continue;
    keep[kept++] = i;
    if (lo[i] < minLo) minLo = lo[i];
  }
  ranger.kept = kept;
  const node = rebuild(self, ranger, makeUnion);
  RANGE[0] = minLo;
  RANGE[1] = h1;
  return node;
}

// ---------------------------------------------------------------------------------------------
// Smooth union (left fold of the quadratic polynomial smin)

/**
 * Smooth union with blend radius `k` (meters): fillets ~k wide, at most k/4 deep for two shapes
 * and below k for any number (an m-way junction sits ≤ u_m·k under the closest shape, u_2 = 0.25,
 * u_3 ≈ 0.39). Bounds grow by k. `k <= 0` falls back to `union`. Order matters only where three
 * or more shapes are within k of each other; it is deterministic either way. Typical body radii:
 * 3–5 cm between torso masses, 2–3 cm inside a limb, 1–2 cm on faces and hands.
 */
export function smoothUnion(k: number, ...shapes: Sdf[]): Sdf {
  const kids = shapes.map(asNode);
  if (kids.length === 0) throw new Error("sdf smoothUnion() needs at least one shape");
  if (kids.length === 1) return kids[0];
  if (!(k > 0)) return union(...kids);
  return makeSmoothUnion(k, kids);
}

function makeSmoothUnion(k: number, kids: Node[]): Node {
  let ranger: Ranger | null = null;
  return new Node({
    kind: "smoothUnion",
    kids,
    ev: kids.length === 2 ? smoothUnion2(k, kids[0], kids[1]) : smoothUnionN(k, kids),
    bev: smoothUnionBatch(k, kids),
    depth: maxDepth(kids),
    bounds: growBounds(unionBounds(kids.map((c) => c.bounds)), k),
    box: growBounds(unionBounds(kids.map(boxOf)), k),
    ref: (x, y, z) => {
      let r = kids[0].ref(x, y, z);
      for (let i = 1; i < kids.length; i += 1) r = smin(r, kids[i].ref(x, y, z), k);
      return r;
    },
    spec: (self, g) => specSmoothUnion(self, k, kids, (ranger ??= new Ranger(kids)), g),
    lip: maxLip(kids),
    slack: maxSlack(kids),
  });
}

function smoothUnion2(k: number, a: Node, b: Node): Ev {
  const A = a.box, B = b.box, ea = a.ev, eb = b.ev;
  const invK = 1 / k, quarter = k * 0.25;
  return (o) => {
    const x = STACK[o], y = STACK[o + 1], z = STACK[o + 2];
    const qa = boxDist2(A, 0, x, y, z), qb = boxDist2(B, 0, x, y, z);
    let va: number, vb: number;
    if (qa <= qb) {
      ea(o);
      va = STACK[o + 3];
      const t = va + k;
      if (qb > 0 && (t <= 0 || qb >= t * t)) return;
      eb(o);
      vb = STACK[o + 3];
    } else {
      eb(o);
      vb = STACK[o + 3];
      const t = vb + k;
      if (qa > 0 && (t <= 0 || qa >= t * t)) return;
      ea(o);
      va = STACK[o + 3];
    }
    const diff = va - vb;
    const ad = diff < 0 ? -diff : diff;
    const m = va < vb ? va : vb;
    if (ad >= k) {
      STACK[o + 3] = m;
      return;
    }
    const h = (k - ad) * invK;
    STACK[o + 3] = m - h * h * quarter;
  };
}

function smoothUnionN(k: number, kids: Node[]): Ev {
  const n = kids.length;
  const boxes = packBoxes(kids);
  const evs = kids.map((c) => c.ev);
  const q = new Float64Array(n);
  const invK = 1 / k, quarter = k * 0.25;
  // Prefix collapse margin for a prefix of j children: k + (its worst fold depression).
  const margin = new Float64Array(n);
  for (let j = 0; j < n; j += 1) margin[j] = k * (1 + depression(j));
  return (o) => {
    const x = STACK[o], y = STACK[o + 1], z = STACK[o + 2];
    let j = 0, qmin = Infinity;
    for (let i = 0; i < n; i += 1) {
      const v = boxDist2(boxes, i * 6, x, y, z);
      q[i] = v;
      if (v < qmin) { qmin = v; j = i; }
    }
    evs[j](o);
    const dj = STACK[o + 3];
    let r: number, i: number;
    if (j === 0) {
      r = dj;
      i = 1;
    } else {
      // Prefix collapse: if dj sits `margin` below every earlier child's box distance, the
      // running fold value at j is exactly dj whatever came before, so skip the prefix.
      const t = dj + margin[j];
      const t2 = t * t;
      let collapse = true;
      for (let m = 0; m < j; m += 1) {
        const qm = q[m];
        if (qm === 0 || (t > 0 && qm < t2)) { collapse = false; break; }
      }
      if (collapse) {
        r = dj;
        i = j + 1;
      } else {
        evs[0](o);
        r = STACK[o + 3];
        i = 1;
      }
    }
    for (; i < n; i += 1) {
      let di: number;
      if (i === j) di = dj;
      else {
        const qi = q[i];
        // Identity step: d_i >= sqrt(qi) >= r + k leaves smin(r, d_i) == r.
        if (qi > 0) {
          const t = r + k;
          if (t <= 0 || qi >= t * t) continue;
        }
        evs[i](o);
        di = STACK[o + 3];
      }
      const diff = r - di;
      const ad = diff < 0 ? -diff : diff;
      if (ad >= k) {
        if (di < r) r = di;
      } else {
        const h = (k - ad) * invK;
        r = (r < di ? r : di) - h * h * quarter;
      }
    }
    STACK[o + 3] = r;
  };
}

/** The full left fold, elementwise; identity steps for the whole batch are skipped. */
function smoothUnionBatch(k: number, kids: Node[]): BatchEv {
  const bevs = kids.map((c) => c.bev);
  const boxes = packBoxes(kids);
  const invK = 1 / k, quarter = k * 0.25;
  return (px, py, pz, out, n, level) => {
    const sc = scratch(level);
    const tmp = sc[0], bb = sc[1];
    bevs[0](px, py, pz, out, n, level + 1);
    batchBox(px, py, pz, n, bb);
    for (let c = 1; c < bevs.length; c += 1) {
      const bd = boxBoxDist(bb, boxes, c * 6);
      if (bd > 0 && bd >= maxOf(out, n) + k) continue;
      bevs[c](px, py, pz, tmp, n, level + 1);
      for (let i = 0; i < n; i += 1) {
        const r = out[i], di = tmp[i];
        const diff = r - di;
        const ad = diff < 0 ? -diff : diff;
        if (ad >= k) {
          if (di < r) out[i] = di;
        } else {
          const h = (k - ad) * invK;
          out[i] = (r < di ? r : di) - h * h * quarter;
        }
      }
    }
  };
}

function specSmoothUnion(self: Node, k: number, kids: Node[], ranger: Ranger, g: Region): Node {
  ranger.run(g, 2 * k);
  const { lo, hi, keep } = ranger;
  const n = kids.length;
  // Latest exact restart point of the fold inside the region (see smoothUnionN).
  let start = 0;
  let prefixLo = lo[0];
  for (let i = 1; i < n; i += 1) {
    if (hi[i] <= prefixLo - k * (1 + depression(i))) start = i;
    if (lo[i] < prefixLo) prefixLo = lo[i];
  }
  let kept = 0;
  keep[kept++] = start;
  let running = hi[start], minLo = lo[start];
  for (let i = start + 1; i < n; i += 1) {
    if (lo[i] >= running + k) continue; // identity step everywhere in the region
    keep[kept++] = i;
    if (hi[i] < running) running = hi[i];
    if (lo[i] < minLo) minLo = lo[i];
  }
  ranger.kept = kept;
  const node = rebuild(self, ranger, (nodes) => makeSmoothUnion(k, nodes));
  // One kept child: its exact range; several: the fold sits at most depression(m)·k below them.
  RANGE[0] = kept === 1 ? lo[start] : minLo - k * depression(kept);
  RANGE[1] = running;
  return node;
}

// ---------------------------------------------------------------------------------------------
// Intersection and subtraction

function makeIntersect(a: Node, b: Node, k: number): Node {
  const ea = a.ev, eb = b.ev;
  const invK = k > 0 ? 1 / k : 0, quarter = k * 0.25;
  const ev: Ev = (o) => {
    ea(o);
    const va = STACK[o + 3];
    eb(o);
    const vb = STACK[o + 3];
    const m = va > vb ? va : vb;
    if (k > 0) {
      const diff = va - vb;
      const ad = diff < 0 ? -diff : diff;
      if (ad < k) {
        const h = (k - ad) * invK;
        STACK[o + 3] = m + h * h * quarter;
        return;
      }
    }
    STACK[o + 3] = m;
  };
  const ba = a.bev, bb = b.bev;
  const bev: BatchEv = (px, py, pz, out, n, level) => {
    const tmp = scratch(level)[0];
    ba(px, py, pz, out, n, level + 1);
    bb(px, py, pz, tmp, n, level + 1);
    for (let i = 0; i < n; i += 1) {
      const va = out[i], vb = tmp[i];
      const m = va > vb ? va : vb;
      if (k > 0) {
        const diff = va - vb;
        const ad = diff < 0 ? -diff : diff;
        if (ad < k) {
          const h = (k - ad) * invK;
          out[i] = m + h * h * quarter;
          continue;
        }
      }
      out[i] = m;
    }
  };
  const boxA = boxOf(a), boxB = boxOf(b);
  return new Node({
    kind: k > 0 ? "smoothIntersect" : "intersect",
    kids: [a, b],
    ev,
    bev,
    depth: maxDepth([a, b]),
    bounds: intersectBounds(a.bounds, b.bounds),
    // max(a, b) >= a and >= b, so either child's pruning box is valid; take the smaller.
    box: volume(boxA) <= volume(boxB) ? boxA : boxB,
    ref: (x, y, z) => (k > 0 ? smax(a.ref(x, y, z), b.ref(x, y, z), k) : Math.max(a.ref(x, y, z), b.ref(x, y, z))),
    spec: (self, g) => {
      const A = a.spec(g);
      const aLo = RANGE[0], aHi = RANGE[1];
      const B = b.spec(g);
      const bLo = RANGE[0], bHi = RANGE[1];
      if (aHi + k <= bLo) { RANGE[0] = bLo; RANGE[1] = bHi; return B; } // b dominates everywhere
      if (bHi + k <= aLo) { RANGE[0] = aLo; RANGE[1] = aHi; return A; }
      const node = A === a && B === b ? self : self.memoized(pairKey(A, B), () => makeIntersect(A, B, k), (c) => c.kids?.[0] === A && c.kids?.[1] === B);
      RANGE[0] = Math.max(aLo, bLo);
      RANGE[1] = Math.max(aHi, bHi) + quarter;
      return node;
    },
    lip: maxLip([a, b]),
    slack: maxSlack([a, b]),
  });
}

/** Intersection max(a, b). Bounds are the overlap of both bounds. */
export function intersect(a: Sdf, b: Sdf): Sdf {
  return makeIntersect(asNode(a), asNode(b), 0);
}

/** Smooth intersection with blend radius k (rounds the new edge by ~k; never grows the shape). */
export function smoothIntersect(k: number, a: Sdf, b: Sdf): Sdf {
  return makeIntersect(asNode(a), asNode(b), Math.max(0, k));
}

function makeSubtract(a: Node, b: Node, k: number): Node {
  const ea = a.ev, eb = b.ev, B = b.box;
  const invK = k > 0 ? 1 / k : 0, quarter = k * 0.25;
  const ev: Ev = (o) => {
    ea(o);
    const va = STACK[o + 3];
    // Skip b when d_b >= sqrt(qb) >= k - va: then max/smax(va, -d_b) == va.
    const qb = boxDist2(B, 0, STACK[o], STACK[o + 1], STACK[o + 2]);
    const t = k - va;
    if (qb > 0 && (t <= 0 || qb >= t * t)) return;
    eb(o);
    const vb = -STACK[o + 3];
    const m = va > vb ? va : vb;
    if (k > 0) {
      const diff = va - vb;
      const ad = diff < 0 ? -diff : diff;
      if (ad < k) {
        const h = (k - ad) * invK;
        STACK[o + 3] = m + h * h * quarter;
        return;
      }
    }
    STACK[o + 3] = m;
  };
  const ba = a.bev, bbev = b.bev;
  const bev: BatchEv = (px, py, pz, out, n, level) => {
    const sc = scratch(level);
    const tmp = sc[0], box = sc[1];
    ba(px, py, pz, out, n, level + 1);
    batchBox(px, py, pz, n, box);
    const bd = boxBoxDist(box, B, 0);
    if (bd > 0) {
      let mn = Infinity;
      for (let i = 0; i < n; i += 1) if (out[i] < mn) mn = out[i];
      if (bd >= k - mn) return; // b cannot cut into any point of the batch
    }
    bbev(px, py, pz, tmp, n, level + 1);
    for (let i = 0; i < n; i += 1) {
      const va = out[i], vb = -tmp[i];
      const m = va > vb ? va : vb;
      if (k > 0) {
        const diff = va - vb;
        const ad = diff < 0 ? -diff : diff;
        if (ad < k) {
          const h = (k - ad) * invK;
          out[i] = m + h * h * quarter;
          continue;
        }
      }
      out[i] = m;
    }
  };
  return new Node({
    kind: k > 0 ? "smoothSubtract" : "subtract",
    kids: [a, b],
    ev,
    bev,
    depth: maxDepth([a, b]),
    bounds: a.bounds,
    box: boxOf(a),
    ref: (x, y, z) => (k > 0 ? smax(a.ref(x, y, z), -b.ref(x, y, z), k) : Math.max(a.ref(x, y, z), -b.ref(x, y, z))),
    spec: (self, g) => {
      const A = a.spec(g);
      const aLo = RANGE[0], aHi = RANGE[1];
      const bbd = boxBoxDist(g, b.box, 0);
      if (bbd > 0 && bbd >= k - aLo) { RANGE[0] = aLo; RANGE[1] = aHi; return A; }
      const Bn = b.spec(g);
      const bLo = RANGE[0], bHi = RANGE[1];
      if (bLo >= k - aLo) { RANGE[0] = aLo; RANGE[1] = aHi; return A; } // b never cuts into a here
      const node = A === a && Bn === b ? self : self.memoized(pairKey(A, Bn), () => makeSubtract(A, Bn, k), (c) => c.kids?.[0] === A && c.kids?.[1] === Bn);
      RANGE[0] = Math.max(aLo, -bHi);
      RANGE[1] = Math.max(aHi, -bLo) + quarter;
      return node;
    },
    lip: maxLip([a, b]),
    slack: maxSlack([a, b]),
  });
}

/** `a` minus `b`: max(a, −b). Bounds are a's bounds. b is only evaluated inside its box. */
export function subtract(a: Sdf, b: Sdf): Sdf {
  return makeSubtract(asNode(a), asNode(b), 0);
}

/** `a` minus `b` with a rounded rim of radius ~k (eye sockets, navel, muscle grooves). */
export function smoothSubtract(k: number, a: Sdf, b: Sdf): Sdf {
  return makeSubtract(asNode(a), asNode(b), Math.max(0, k));
}

export { displace, mirrorX, offset, shell, transform, type TransformOptions } from "./modifiers";
