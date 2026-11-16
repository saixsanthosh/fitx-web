/**
 * FITX SDF toolkit (worker-safe: no `three`, no DOM). See `api.ts` for the data contracts.
 *
 *   const torso = smoothUnion(0.04, ellipsoid(...), ellipsoid(...));
 *   const limbs = union(armL, armR, legL, legR);        // left/right never blend
 *   const body = smoothUnion(0.03, torso, limbs);
 *   const mesh = meshSdf(body, { cell: 0.012 });       // sparse sample + surface nets + normals
 *   const ao = bakeAO(mesh, body);                       // 1 = open, → 0 in creases
 *
 * Units are meters, distances negative inside, +Y up, characters face +Z (rig/skeleton.ts).
 */

export type { AABB, Adjacency, AOOptions, FieldGrid, NetsOptions, Quat, RawMesh, SampleOptions, Sdf, V3 } from "./api";
export * from "./vec";
export * from "./primitives";
export * from "./ops";
export * from "./mesher";
export * from "./bake";
export * from "./query";
