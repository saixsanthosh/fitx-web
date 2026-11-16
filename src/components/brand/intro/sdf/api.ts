/**
 * SDF toolkit API contract (worker-safe: no `three`, no DOM).
 *
 * Implementations live next to this file:
 *   vec.ts         tiny vector/quaternion helpers on tuples
 *   primitives.ts  sphere, ellipsoid, capsule, roundCone, roundBox, torus, cylinder, halfSpace
 *   ops.ts         union, smoothUnion, intersect, smoothIntersect, subtract, smoothSubtract,
 *                  offset, shell, displace, transform, mirrorX, custom
 *   mesher.ts      sampleSdf (sparse narrow-band sampling), mapGrid, surfaceNets, meshSdf
 *   bake.ts        bakeAO, bakeCurvature, vertexAdjacency, smoothAttribute, mergeMeshes
 *   index.ts       re-exports everything above
 *
 * Distances are meters, negative inside. Every node carries conservative bounds so samplers
 * and evaluators can skip far-away work; smooth blends grow bounds by their radius `k`.
 */

import type { Vec3Tuple } from "../types";

export type V3 = Vec3Tuple;
/** Unit quaternion as [x, y, z, w]. */
export type Quat = [number, number, number, number];

export interface AABB {
  min: V3;
  max: V3;
}

export interface Sdf {
  /** Signed distance (or a conservative Lipschitz ≤ 1 bound) at a point. */
  readonly d: (x: number, y: number, z: number) => number;
  /** Axis-aligned bounds containing the zero set, including blend margins. */
  readonly bounds: AABB;
}

/** A sampled scalar field on a regular grid. `values[x + nx * (y + ny * z)]`. */
export interface FieldGrid {
  values: Float32Array;
  dims: [number, number, number];
  /** World position of sample (0,0,0). */
  origin: V3;
  /** Grid spacing in meters. */
  cell: number;
}

export interface RawMesh {
  positions: Float32Array;
  /** Unit normals pointing outward (from the field/SDF gradient). */
  normals: Float32Array;
  indices: Uint32Array;
}

export interface SampleOptions {
  /** Grid spacing in meters. */
  cell: number;
  /** Defaults to the shape's bounds grown by `padding`. */
  bounds?: AABB;
  /** Extra margin around the bounds, meters (default 2 cells). */
  padding?: number;
  /** Skip evaluation far from the surface using a coarse pass (default true). */
  sparse?: boolean;
  /**
   * Also sample exactly every point within this many meters of the zero set (default 0). Set it
   * to the largest |iso| or field offset you will extract from this grid or from grids derived
   * with `mapGrid` (e.g. 0.006 for a shirt 6 mm off the skin). (Added by sdf-core.)
   */
  band?: number;
}

export interface NetsOptions {
  /** Iso level to extract (default 0). Use e.g. +0.004 for a 4 mm offset surface. */
  iso?: number;
  /** If given, normals come from this SDF's central-difference gradient (smoother). */
  gradientFrom?: Sdf;
  /** Laplacian relaxation passes on vertex positions, constrained to the surface (default 0). */
  relax?: number;
}

export interface AOOptions {
  /** Number of march steps along the normal (default 5). */
  steps?: number;
  /** Distance of the first step, meters (default 0.01); steps grow linearly. */
  stepSize?: number;
  /** Darkening strength (default 1). */
  strength?: number;
}

/** CSR adjacency: neighbours of vertex i are `neighbors[offsets[i] .. offsets[i + 1])`. */
export interface Adjacency {
  offsets: Uint32Array;
  neighbors: Uint32Array;
}
