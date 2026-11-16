/**
 * Geometry helpers for the sets: batching many parts into one draw call (vertex-coloured),
 * swept tubes with variable/elliptical sections, lathes around any axis and projected UVs.
 * Everything here is static CPU work done once at set build time.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const KEEP = ["position", "normal", "uv", "color"] as const;
const _color = new THREE.Color();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

export type V3 = [number, number, number];

/** Matrix from position, Euler rotation (radians, XYZ) and scale. */
export function m4(position: V3 = [0, 0, 0], rotation: V3 = [0, 0, 0], scale: V3 | number = 1): THREE.Matrix4 {
  _e.set(rotation[0], rotation[1], rotation[2]);
  _q.setFromEuler(_e);
  const s = typeof scale === "number" ? _s.set(scale, scale, scale) : _s.set(scale[0], scale[1], scale[2]);
  return new THREE.Matrix4().compose(_v.set(position[0], position[1], position[2]), _q, s);
}

/** Matrix that maps the +Y axis onto the segment a → b (for cylinders built along Y, centred). */
export function alongMatrix(a: THREE.Vector3, b: THREE.Vector3): { matrix: THREE.Matrix4; length: number } {
  const dir = new THREE.Vector3().subVectors(b, a);
  const length = dir.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  return { matrix: new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)), length };
}

/** Fills (or replaces) a linear-RGB vertex colour attribute from an sRGB colour. */
export function paint(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  _color.set(color);
  const count = geometry.attributes.position.count;
  const array = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    array[i * 3] = _color.r;
    array[i * 3 + 1] = _color.g;
    array[i * 3 + 2] = _color.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(array, 3));
  return geometry;
}

/** Multiplies existing vertex colours by a per-vertex function (e.g. baked gradients/AO). */
export function shadeVertices(geometry: THREE.BufferGeometry, fn: (x: number, y: number, z: number) => number) {
  const pos = geometry.attributes.position;
  const col = geometry.attributes.color as THREE.BufferAttribute | undefined;
  if (!col) return;
  for (let i = 0; i < pos.count; i += 1) {
    const k = fn(pos.getX(i), pos.getY(i), pos.getZ(i));
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
  }
  col.needsUpdate = true;
}

/** Normalises a geometry for merging: indexed, exactly position/normal/uv/color, Float32. */
export function normalize(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation = 0xffffff): THREE.BufferGeometry {
  const g = geometry;
  for (const name of Object.keys(g.attributes)) {
    if (!(KEEP as readonly string[]).includes(name)) g.deleteAttribute(name);
  }
  const count = g.attributes.position.count;
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  if (!g.attributes.color) paint(g, color);
  if (!g.index) {
    const index = new Uint32Array(count);
    for (let i = 0; i < count; i += 1) index[i] = i;
    g.setIndex(new THREE.BufferAttribute(index, 1));
  }
  g.morphAttributes = {};
  g.clearGroups();
  return g;
}

/**
 * Collects transformed, vertex-coloured copies of geometries and merges them into one geometry,
 * so a whole family of props shares one material and one draw call.
 */
export class GeometryBatch {
  private readonly parts: THREE.BufferGeometry[] = [];

  /** Adds a clone of `geometry` transformed by `matrix` and painted `color` (unless it already has colours and color is undefined). */
  add(geometry: THREE.BufferGeometry, matrix?: THREE.Matrix4, color?: THREE.ColorRepresentation): this {
    const clone = geometry.clone();
    if (color !== undefined) paint(clone, color);
    normalize(clone);
    if (matrix) clone.applyMatrix4(matrix);
    this.parts.push(clone);
    return this;
  }

  /** Adds an already-owned geometry without cloning (it is consumed). */
  take(geometry: THREE.BufferGeometry, matrix?: THREE.Matrix4, color?: THREE.ColorRepresentation): this {
    if (color !== undefined) paint(geometry, color);
    normalize(geometry);
    if (matrix) geometry.applyMatrix4(matrix);
    this.parts.push(geometry);
    return this;
  }

  get size() {
    return this.parts.length;
  }

  build(): THREE.BufferGeometry {
    if (this.parts.length === 0) return normalize(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3)));
    const merged = this.parts.length === 1 ? this.parts[0].clone() : mergeGeometries(this.parts, false);
    for (const part of this.parts) part.dispose();
    this.parts.length = 0;
    if (!merged) throw new Error("GeometryBatch: merge failed");
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }
}

/** Box with optional rounded edges. */
export function box(w: number, h: number, d: number, radius = 0, segments = 2): THREE.BufferGeometry {
  if (radius <= 0) return new THREE.BoxGeometry(w, h, d);
  return new RoundedBoxGeometry(w, h, d, segments, radius);
}

/** Cylinder along Y from y=0 to y=h (not centred), optional different top radius. */
export function cylinderUp(radius: number, h: number, segments = 16, radiusTop = radius, open = false): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radiusTop, radius, h, segments, 1, open);
  g.translate(0, h / 2, 0);
  return g;
}

/** Cylinder spanning a → b. */
export function cylinderBetween(a: THREE.Vector3, b: THREE.Vector3, radius: number, segments = 12, radiusB = radius, open = false): THREE.BufferGeometry {
  const { matrix, length } = alongMatrix(a, b);
  const g = new THREE.CylinderGeometry(radiusB, radius, length, segments, 1, open);
  g.applyMatrix4(matrix);
  return g;
}

export type Axis = "x" | "y" | "z";

/**
 * Lathe of a profile of [radius, height] pairs around `axis` (profile height runs along the axis).
 * `planar` replaces UVs by a planar projection across the disc (for faces with lettering).
 */
export function lathe(profile: Array<[number, number]>, segments = 48, axis: Axis = "y", planar?: { diameter: number }): THREE.BufferGeometry {
  const points = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0), y));
  const g = new THREE.LatheGeometry(points, segments);
  if (planar) {
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i += 1) {
      // Lathe is around Y: the disc lies in XZ. Mirror U on the -Y side faces is handled by the caller.
      uv.setXY(i, 0.5 + pos.getX(i) / planar.diameter, 0.5 - pos.getZ(i) / planar.diameter);
    }
  }
  if (axis === "x") g.rotateZ(-Math.PI / 2);
  else if (axis === "z") g.rotateX(Math.PI / 2);
  return g;
}

export interface SweepOptions {
  /** Section radius (along the section normal), constant or a function of t ∈ [0, 1]. */
  radius: number | ((t: number) => number);
  /** Second radius (along the binormal) for elliptical sections. Defaults to `radius`. */
  radius2?: number | ((t: number) => number);
  tubularSegments?: number;
  radialSegments?: number;
  closed?: boolean;
  caps?: boolean;
  /**
   * Keeps sections aligned: the section normal is the component of `reference` orthogonal to the
   * tangent (e.g. +X for tubes in a bike's YZ plane). Without it, frames are parallel-transported.
   */
  reference?: THREE.Vector3;
  /** U scale of the generated UVs along the tube (meters → u); default 1. */
  uvScale?: number;
}

/** Tube along a curve with a variable, optionally elliptical cross-section. */
export function sweep(curve: THREE.Curve<THREE.Vector3>, options: SweepOptions): THREE.BufferGeometry {
  const tubular = options.tubularSegments ?? 32;
  const radial = options.radialSegments ?? 12;
  const closed = options.closed ?? false;
  const r1 = typeof options.radius === "number" ? (() => options.radius as number) : options.radius;
  const r2src = options.radius2 ?? options.radius;
  const r2 = typeof r2src === "number" ? () => r2src : r2src;
  const length = curve.getLength();
  const uvScale = options.uvScale ?? 1;

  const points: THREE.Vector3[] = [];
  const tangents: THREE.Vector3[] = [];
  for (let i = 0; i <= tubular; i += 1) {
    const t = i / tubular;
    points.push(curve.getPointAt(t));
    tangents.push(curve.getTangentAt(t).normalize());
  }
  const normals: THREE.Vector3[] = [];
  const binormals: THREE.Vector3[] = [];
  if (options.reference) {
    for (let i = 0; i <= tubular; i += 1) {
      const T = tangents[i];
      const N = options.reference.clone().addScaledVector(T, -options.reference.dot(T));
      if (N.lengthSq() < 1e-8) N.copy(Math.abs(T.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).addScaledVector(T, -T.y);
      N.normalize();
      normals.push(N);
      binormals.push(new THREE.Vector3().crossVectors(T, N).normalize());
    }
  } else {
    const T0 = tangents[0];
    const seed = Math.abs(T0.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    let N = seed.addScaledVector(T0, -seed.dot(T0)).normalize();
    for (let i = 0; i <= tubular; i += 1) {
      if (i > 0) {
        const axis = new THREE.Vector3().crossVectors(tangents[i - 1], tangents[i]);
        const sin = axis.length();
        if (sin > 1e-6) {
          const angle = Math.atan2(sin, tangents[i - 1].dot(tangents[i]));
          N = N.clone().applyAxisAngle(axis.normalize(), angle);
        }
      }
      normals.push(N.clone());
      binormals.push(new THREE.Vector3().crossVectors(tangents[i], N).normalize());
    }
  }

  const positions: number[] = [];
  const norms: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= tubular; i += 1) {
    const t = i / tubular;
    const a = r1(t);
    const b = r2(t);
    const P = points[i];
    const N = normals[i];
    const B = binormals[i];
    for (let j = 0; j <= radial; j += 1) {
      const angle = (j / radial) * Math.PI * 2;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      positions.push(P.x + (N.x * c * a + B.x * s * b), P.y + (N.y * c * a + B.y * s * b), P.z + (N.z * c * a + B.z * s * b));
      const nx = (N.x * c) / Math.max(a, 1e-5) + (B.x * s) / Math.max(b, 1e-5);
      const ny = (N.y * c) / Math.max(a, 1e-5) + (B.y * s) / Math.max(b, 1e-5);
      const nz = (N.z * c) / Math.max(a, 1e-5) + (B.z * s) / Math.max(b, 1e-5);
      const nl = Math.hypot(nx, ny, nz) || 1;
      norms.push(nx / nl, ny / nl, nz / nl);
      uvs.push(t * length * uvScale, j / radial);
    }
  }
  const ring = radial + 1;
  for (let i = 0; i < tubular; i += 1) {
    for (let j = 0; j < radial; j += 1) {
      const a = i * ring + j;
      const b = (i + 1) * ring + j;
      // Ring angle runs N→B and rings advance along T; (N, B, T) is right-handed, so this winding
      // faces outward.
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  if (options.caps && !closed) {
    for (const end of [0, tubular]) {
      const P = points[end];
      const T = tangents[end].clone().multiplyScalar(end === 0 ? -1 : 1);
      const centre = positions.length / 3;
      positions.push(P.x, P.y, P.z);
      norms.push(T.x, T.y, T.z);
      uvs.push(0.5, 0.5);
      const start = positions.length / 3;
      for (let j = 0; j <= radial; j += 1) {
        const src = (end * ring + j) * 3;
        positions.push(positions[src], positions[src + 1], positions[src + 2]);
        norms.push(T.x, T.y, T.z);
        uvs.push(0.5 + 0.5 * Math.cos((j / radial) * Math.PI * 2), 0.5 + 0.5 * Math.sin((j / radial) * Math.PI * 2));
      }
      for (let j = 0; j < radial; j += 1) {
        if (end === 0) indices.push(centre, start + j + 1, start + j);
        else indices.push(centre, start + j, start + j + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(norms, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  return g;
}

/** Polyline → smooth centripetal Catmull-Rom curve. */
export function curveThrough(points: V3[], closed = false, tension = 0.5): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), closed, "catmullrom", tension);
}

/**
 * Box-projected UVs in meters / `tile`: each vertex uses the plane most aligned with its normal.
 * Apply after transforming into set space so textures line up across merged parts.
 */
export function boxProjectUV(geometry: THREE.BufferGeometry, tile = 1, offset: [number, number] = [0, 0]) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  const uv = geometry.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 1) {
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const nz = Math.abs(nor.getZ(i));
    let u: number;
    let v: number;
    if (ny >= nx && ny >= nz) {
      u = pos.getX(i);
      v = pos.getZ(i);
    } else if (nx >= nz) {
      u = pos.getZ(i);
      v = pos.getY(i);
    } else {
      u = pos.getX(i);
      v = pos.getY(i);
    }
    uv.setXY(i, u / tile + offset[0], v / tile + offset[1]);
  }
  uv.needsUpdate = true;
  return geometry;
}

/** Flat ground quad in XZ (normal +Y) with UVs equal to local x/z in meters (× `uvScale`). */
export function groundQuad(x0: number, x1: number, z0: number, z1: number, y = 0, uvScale = 1): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1], 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute([x0 * uvScale, z0 * uvScale, x1 * uvScale, z0 * uvScale, x1 * uvScale, z1 * uvScale, x0 * uvScale, z1 * uvScale], 2));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  return g;
}

/** Regular extruded 2D shape (in XY) with a small bevel, extruded along +Z by `depth` then centred. */
export function extrude(shape: THREE.Shape, depth: number, bevel = 0, curveSegments = 16): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(depth - bevel * 2, 1e-4),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: bevel > 0 ? 2 : 0,
    curveSegments,
  });
  g.translate(0, 0, -depth / 2 + bevel);
  return g;
}

/** Applies `matrix` to a clone of `geometry` (helper for one-off placements). */
export function placed(geometry: THREE.BufferGeometry, position: V3, rotation: V3 = [0, 0, 0], scale: V3 | number = 1) {
  return geometry.clone().applyMatrix4(m4(position, rotation, scale));
}

/** Counts triangles of a geometry (indexed or not). */
export function triangleCount(geometry: THREE.BufferGeometry) {
  return (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
}

