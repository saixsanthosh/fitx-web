/**
 * Point queries for generators (worker-safe): fast repeated evaluation, gradients, normals and
 * projection onto a surface (placing eyes, seams, buttons, skin-weight probes, ...).
 */

import type { AABB, Sdf, V3 } from "./api";
import { asNode, tiledAuto } from "./node";

/**
 * Equivalent shape that answers many scattered queries faster (skin weights, paint masks,
 * custom bakes): the first query in each `tile`-sized cube (default 4 cm) builds an exactly
 * pruned copy of the tree for that cube. Values are identical to `shape.d`. Reuses the tiles a
 * previous `sampleSdf`/`bakeAO` built for the same shape when their size is similar.
 */
export function tiledSdf(shape: Sdf, tile = 0.04): Sdf {
  const node = asNode(shape);
  const tiled = tiledAuto(node, tile);
  return { d: tiled ? tiled.eval : node.d, bounds: node.bounds };
}

/**
 * Exact copy of `shape` for points inside `region`, with every child that cannot change the
 * value there removed. Outside the region the result is undefined (still a valid bound only
 * where the dropped children were far). For hand-written hot loops over one area.
 */
export function restrictSdf(shape: Sdf, region: AABB): Sdf {
  const node = asNode(shape);
  const r = new Float64Array([region.min[0], region.min[1], region.min[2], region.max[0], region.max[1], region.max[2]]);
  return node.spec(r);
}

/** Central-difference gradient (6 evaluations, step h meters; ≈ unit length for exact SDFs). */
export function sdfGradient(shape: Sdf, p: V3, h = 0.0005): V3 {
  const f = shape.d;
  const [x, y, z] = p;
  return [
    (f(x + h, y, z) - f(x - h, y, z)) / (2 * h),
    (f(x, y + h, z) - f(x, y - h, z)) / (2 * h),
    (f(x, y, z + h) - f(x, y, z - h)) / (2 * h),
  ];
}

/** Outward unit normal of the level set through p ([0, 1, 0] where the gradient vanishes). */
export function sdfNormal(shape: Sdf, p: V3, h = 0.0005): V3 {
  const g = sdfGradient(shape, p, h);
  const len = Math.hypot(g[0], g[1], g[2]);
  return len > 1e-12 ? [g[0] / len, g[1] / len, g[2] / len] : [0, 1, 0];
}

/** Moves p onto the `iso` level set with Newton steps along the gradient (meters). */
export function projectToSurface(shape: Sdf, p: V3, iso = 0, iterations = 6): V3 {
  let q: V3 = [p[0], p[1], p[2]];
  for (let i = 0; i < iterations; i += 1) {
    const v = shape.d(q[0], q[1], q[2]) - iso;
    if (Math.abs(v) < 1e-6) break;
    const g = sdfGradient(shape, q);
    const g2 = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
    if (g2 < 1e-12) break;
    q = [q[0] - (v * g[0]) / g2, q[1] - (v * g[1]) / g2, q[2] - (v * g[2]) / g2];
  }
  return q;
}
