/**
 * Character generation pipeline (worker-safe: no `three`, no DOM). OWNER: character-body.
 *
 *   bind pose → body SDF → one sparse grid (narrow band wide enough for the clothes)
 *   → body mesh (Surface Nets + SDF normals) → AO + curvature → skin weights
 *   → garments from the same grid (weights copied from the skin underneath)
 *   → skin triangles hidden under clothing removed → skin paint
 *   → head, hair, hands, shoes, accessories (`head.ts` … `accessories.ts`)
 *
 * Output parts are in the spaces defined by `types.ts`: skinned parts in character bind space,
 * rigid parts bone-local. Deterministic: every random choice derives from `spec.seed`.
 */

import { computeBindPose } from "../rig/skeleton";
import { bakeAO, sampleSdf, smoothAttribute, surfaceNets, vertexAdjacency } from "../sdf";
import { buildBody, type BodyModel } from "./body";
import { paintSkin } from "./bodyPaint";
import { buildClothing, clothingBand, garmentCoverage } from "./clothing";
import { garmentsFor } from "./clothingStyles";
import { computeBodySkin, skinHash, transferSkin } from "./skinning";
import { compactMesh, filterTriangles, meshCurvature, remapAttribute, tangentialRelax } from "./meshUtil";
import { buildHead } from "./head";
import { buildHair } from "./hair";
import { buildHands } from "./hands";
import { buildShoes } from "./shoes";
import { buildAccessories } from "./accessories";
import type { CharacterMeshData, CharacterSpec, MeshPart } from "./types";

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** Tuning overrides for lab comparisons; production uses the defaults. */
export interface GenerateOptions {
  /** Body Surface Nets cell (meters). Default: the sculpt's suggestion. */
  cell?: number;
  /** SDF-projected relax passes on the body mesh (default 0: tangential smoothing only). */
  bodyRelax?: number;
}

interface Collar {
  x: number;
  z: number;
  /** Skin below this height is inside the shoe / sock (bind space). */
  top: number;
  radius: number;
}

/**
 * Sock-collar top per foot, measured on the shoe meshes (robust to whatever collar height the
 * shoe generator chooses): the 90th-percentile height of shoe vertices around the ankle axis.
 */
function shoeCollars(shoes: MeshPart[], body: BodyModel): Collar[] {
  const out: Collar[] = [];
  for (const side of ["L", "R"] as const) {
    const ankle = body.frames.leg[side].c;
    const radius = body.limbGirths.ankle * 2.2;
    const heights: number[] = [];
    for (const part of shoes) {
      if (part.rigidBone) continue;
      const p = part.positions;
      for (let v = 0; v < p.length / 3; v += 1) {
        if (Math.hypot(p[v * 3] - ankle[0], p[v * 3 + 2] - ankle[2]) < radius && p[v * 3 + 1] > ankle[1] - 0.03) heights.push(p[v * 3 + 1]);
      }
    }
    if (heights.length < 16) continue;
    heights.sort((a, b) => a - b);
    out.push({ x: ankle[0], z: ankle[2], top: heights[Math.floor(heights.length * 0.9)], radius });
  }
  return out;
}

/** True for skin safely inside a sock collar (1.4 cm below its top, so motion never gaps it). */
function insideCollar(collars: Collar[], x: number, y: number, z: number): boolean {
  for (const c of collars) if (y < c.top - 0.014 && Math.hypot(x - c.x, z - c.z) < c.radius) return true;
  return false;
}

export function generateCharacter(spec: CharacterSpec, options: GenerateOptions = {}): CharacterMeshData {
  const timings: Record<string, number> = {};
  const t0 = now();
  const step = <T>(name: string, fn: () => T): T => {
    const start = now();
    const result = fn();
    timings[name] = (timings[name] ?? 0) + now() - start;
    return result;
  };
  const bind = computeBindPose(spec.proportions);
  const body = step("body.sculpt", () => buildBody(spec, bind));
  if (options.cell) body.cell = options.cell;
  const grid = step("body.sample", () => sampleSdf(body.sdf, { cell: body.cell, band: clothingBand(spec, body) }));
  const full = step("body.mesh", () => surfaceNets(grid, { gradientFrom: body.sdf, relax: options.bodyRelax ?? 0 }));
  const adjacency = vertexAdjacency(full);
  if (!options.bodyRelax) step("body.mesh", () => tangentialRelax(full, adjacency, 2, 0.5));
  const skin = step("body.skin", () => computeBodySkin(full, body, 4, adjacency));

  // Shoes first: the leg skin inside each sock collar is trimmed to the collar's real height.
  const shoes = step("shoes", () => buildShoes(spec, bind));
  const collars = shoeCollars(shoes, body);

  // Skin fully hidden under clothing goes first (keeping a margin at hems so nothing gaps in
  // motion), so occlusion, curvature and paint only run on skin that can be seen.
  const coverage = garmentCoverage(garmentsFor(spec, body));
  const visible = step("body.trim", () => {
    const n = full.positions.length / 3;
    const hidden = new Uint8Array(n);
    for (let v = 0; v < n; v += 1) {
      const x = full.positions[v * 3], y = full.positions[v * 3 + 1], z = full.positions[v * 3 + 2];
      hidden[v] = coverage.bodyCoverage(x, y, z) < 0 || insideCollar(collars, x, y, z) ? 1 : 0;
    }
    return compactMesh(filterTriangles(full, (a, b, c) => !(hidden[a] && hidden[b] && hidden[c])));
  });
  const vMesh = visible.mesh;
  const vAdj = vertexAdjacency(vMesh);
  const ao = step("body.ao", () => smoothAttribute(bakeAO(vMesh, body.sdf, { steps: 4, stepSize: 0.013, strength: 0.95 }), 1, vAdj, 2, 0.5));
  const curvature = step("body.curvature", () => smoothAttribute(meshCurvature(vMesh, vAdj, 0.04), 1, vAdj, 3, 0.5));
  const colors = step("body.paint", () => {
    const m = vMesh.positions.length / 3;
    const contact = new Float32Array(m);
    for (let i = 0; i < m; i += 1) contact[i] = coverage.hemShadow(vMesh.positions[i * 3], vMesh.positions[i * 3 + 1], vMesh.positions[i * 3 + 2]);
    return paintSkin(spec, body.frames, { positions: vMesh.positions, normals: vMesh.normals, ao, curvature, contact });
  });
  const parts: MeshPart[] = [{
    name: "body",
    role: "skin",
    positions: vMesh.positions,
    normals: vMesh.normals,
    colors,
    indices: vMesh.indices,
    skinIndex: remapAttribute(skin.skinIndex, 4, visible.oldIndex),
    skinWeight: remapAttribute(skin.skinWeight, 4, visible.oldIndex),
  }];

  const clothing = step("clothing.build", () => buildClothing(spec, body, grid));
  step("clothing.skin", () => {
    // Garments copy weights from the full skin (including the parts trimmed away under them).
    const hash = skinHash(full.positions);
    for (const piece of clothing.pieces) {
      const weights = transferSkin({ positions: full.positions, normals: full.normals, dense: skin.dense, hash }, { positions: piece.anchor, normals: piece.mesh.normals, indices: piece.mesh.indices });
      parts.push({
        name: piece.name,
        role: piece.role,
        positions: piece.mesh.positions,
        normals: piece.mesh.normals,
        colors: piece.colors,
        indices: piece.mesh.indices,
        skinIndex: weights.skinIndex,
        skinWeight: weights.skinWeight,
        roughness: piece.roughness,
      });
    }
  });

  // Detail parts from `character-details` (head, hair, hands, shoes, accessories).
  const head = step("head", () => buildHead(spec, bind));
  parts.push(...head.parts);
  parts.push(...step("hair", () => buildHair(spec, bind)));
  parts.push(...step("hands", () => buildHands(spec, bind)));
  parts.push(...shoes);
  parts.push(...step("accessories", () => buildAccessories(spec, bind)));

  step("normals.repair", () => parts.forEach(repairNormals));

  timings.total = now() - t0;
  return { id: spec.id, bind, parts, face: head.face, timings };
}

/**
 * Replaces zero-length or non-finite normals (Surface Nets pinches can leave a few) with the
 * area-weighted normal of the vertex's triangles. A zero normal becomes NaN once the shader
 * normalises it, and bloom smears a single NaN pixel into a black block.
 */
function repairNormals(part: MeshPart) {
  const { normals, positions, indices } = part;
  const bad: number[] = [];
  for (let v = 0; v < normals.length / 3; v += 1) {
    const x = normals[v * 3], y = normals[v * 3 + 1], z = normals[v * 3 + 2];
    const lengthSq = x * x + y * y + z * z;
    if (!(lengthSq > 0.25)) bad.push(v);
  }
  if (!bad.length) return;
  const isBad = new Set(bad);
  const sum = new Map<number, [number, number, number]>(bad.map((v) => [v, [0, 0, 0]]));
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    if (!isBad.has(a) && !isBad.has(b) && !isBad.has(c)) continue;
    const ux = positions[b * 3] - positions[a * 3], uy = positions[b * 3 + 1] - positions[a * 3 + 1], uz = positions[b * 3 + 2] - positions[a * 3 + 2];
    const vx = positions[c * 3] - positions[a * 3], vy = positions[c * 3 + 1] - positions[a * 3 + 1], vz = positions[c * 3 + 2] - positions[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      const acc = sum.get(v);
      if (!acc) continue;
      acc[0] += nx;
      acc[1] += ny;
      acc[2] += nz;
    }
  }
  for (const [v, [x, y, z]] of sum) {
    const length = Math.hypot(x, y, z);
    const ok = length > 1e-12 && Number.isFinite(length);
    normals[v * 3] = ok ? x / length : 0;
    normals[v * 3 + 1] = ok ? y / length : 1;
    normals[v * 3 + 2] = ok ? z / length : 0;
  }
}
