/**
 * Skin weights (worker-safe: no `three`, no DOM). OWNER: character-body.
 *
 * Body: each vertex first gets soft membership in the five sculpt regions (torso, arms, legs)
 * from a soft-min of the regions' primitive distances (σ ≈ 2 cm), so seams follow the anatomy
 * (glute fold, armpit, deltoid insertion) instead of planes. Inside a region, weights follow the
 * bones with smooth axial profiles: hips → spine → chest → neck → head up the torso (traps stay
 * on the chest, the shoulder girdle shares `shoulder_*`), and along the limbs upper → helper →
 * lower around elbows and knees: vertices at the joint ride the helper bone, which motion sets to
 * half the bend, so a 110° knee or 120° elbow keeps its volume instead of pinching. The dense
 * weights are Laplacian-smoothed over the mesh, then reduced to the top four.
 *
 * Clothing and other skinned layers copy weights from the skin underneath (`transferSkin`), so
 * fabric moves exactly with the body it was derived from.
 */

import { smoothAttribute, vertexAdjacency } from "../sdf";
import type { Adjacency, RawMesh, Sdf } from "../sdf";
import { smoothstep } from "../math";
import { BONE_INDEX, type BoneName } from "../rig/skeleton";
import type { BodyModel, BodyRegion } from "./body";
import { v3norm, type LimbFrame, type V3 } from "./frames";
import { PointHash } from "./meshUtil";

export interface SkinWeights {
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
}

/** Bones that can carry body weight, in dense-column order. */
const DENSE: BoneName[] = [
  "hips", "spine", "chest", "neck", "head",
  "shoulder_L", "upperArm_L", "elbowHelper_L", "lowerArm_L", "hand_L",
  "shoulder_R", "upperArm_R", "elbowHelper_R", "lowerArm_R", "hand_R",
  "upperLeg_L", "kneeHelper_L", "lowerLeg_L", "foot_L",
  "upperLeg_R", "kneeHelper_R", "lowerLeg_R", "foot_R",
];
const D = DENSE.length;
const COL = Object.fromEntries(DENSE.map((name, index) => [name, index])) as Record<string, number>;

const REGIONS: BodyRegion[] = ["torso", "armL", "armR", "legL", "legR"];

/** Distance from a point to an AABB (0 inside). */
function boxDistance(x: number, y: number, z: number, sdf: Sdf) {
  const b = sdf.bounds;
  const dx = Math.max(b.min[0] - x, 0, x - b.max[0]);
  const dy = Math.max(b.min[1] - y, 0, y - b.max[1]);
  const dz = Math.max(b.min[2] - z, 0, z - b.max[2]);
  return Math.hypot(dx, dy, dz);
}

interface Profiles {
  torso: (x: number, y: number, z: number, w: Float32Array, scale: number) => void;
  arm: Record<"L" | "R", (x: number, y: number, z: number, w: Float32Array, scale: number) => void>;
  leg: Record<"L" | "R", (x: number, y: number, z: number, w: Float32Array, scale: number) => void>;
}

function profiles(body: BodyModel): Profiles {
  const F = body.frames;
  const s = F.H / (F.female ? 1.68 : 1.8);
  const J = F.joint;
  const spine = J("spine"), chest = J("chest"), neck = J("neck"), head = J("head");

  const torso = (x: number, y: number, z: number, w: Float32Array, k: number) => {
    // Shoulder girdle share around each acromion (traps, top of the pec / back of the armpit).
    let shoulder = 0, side = 0;
    for (const f of [F.arm.L, F.arm.R]) {
      const ax = f.a[0] - 0.02 * s * f.sx, ay = f.a[1] + 0.025 * s, az = f.a[2];
      const d = Math.hypot(x - ax, y - ay, z - az);
      const share = 0.55 * (1 - smoothstep(0.03 * s, 0.12 * s, d));
      if (share > shoulder) {
        shoulder = share;
        side = f.sx;
      }
    }
    // Up the spine: hips → spine → chest, then neck (only near the neck column) → head.
    const toSpine = smoothstep(spine[1] - 0.05 * s, spine[1] + 0.04 * s, y);
    const toChest = smoothstep(chest[1] - 0.07 * s, chest[1] + 0.05 * s, y);
    const nearNeck = 1 - smoothstep(0.065 * s, 0.1 * s, Math.hypot(x, (z - (neck[2] + 0.02 * s)) * 0.85));
    const toNeck = smoothstep(neck[1] - 0.035 * s, neck[1] + 0.03 * s, y) * nearNeck;
    const toHead = smoothstep(head[1] - 0.03 * s, head[1] + 0.02 * s, y) * nearNeck;
    let rest = k * (1 - shoulder);
    if (shoulder > 0) w[COL[side > 0 ? "shoulder_L" : "shoulder_R"]] += k * shoulder;
    const head_ = rest * toHead;
    rest -= head_;
    const neck_ = rest * toNeck;
    rest -= neck_;
    const chest_ = rest * toChest;
    rest -= chest_;
    const spine_ = rest * toSpine;
    rest -= spine_;
    w[COL.head] += head_;
    w[COL.neck] += neck_;
    w[COL.chest] += chest_;
    w[COL.spine] += spine_;
    w[COL.hips] += rest;
  };

  const limbProfile = (f: LimbFrame, kind: "arm" | "leg") => {
    const side = f.side;
    const upper = COL[kind === "arm" ? `upperArm_${side}` : `upperLeg_${side}`];
    const helper = COL[kind === "arm" ? `elbowHelper_${side}` : `kneeHelper_${side}`];
    const lower = COL[kind === "arm" ? `lowerArm_${side}` : `lowerLeg_${side}`];
    const end = COL[kind === "arm" ? `hand_${side}` : `foot_${side}`];
    const top = COL[kind === "arm" ? `shoulder_${side}` : "hips"];
    // Joint plane normal: bisector of the two segments.
    const n: V3 = v3norm([f.dirU[0] + f.dirL[0], f.dirU[1] + f.dirL[1], f.dirU[2] + f.dirL[2]]);
    const half = (kind === "arm" ? 0.034 : 0.042) * s;
    const [ax, ay, az] = f.a, [bx, by, bz] = f.b, [cx, cy, cz] = f.c;
    const [ux, uy, uz] = f.dirU, [lx, ly, lz] = f.dirL, [mx, my, mz] = n;
    return (x: number, y: number, z: number, w: Float32Array, k: number) => {
      const tTop = (x - ax) * ux + (y - ay) * uy + (z - az) * uz;
      const tMid = (x - bx) * mx + (y - by) * my + (z - bz) * mz;
      const tEnd = (x - cx) * lx + (y - cy) * ly + (z - cz) * lz;
      // Upper joint share: deltoid cap rides partly on the clavicle; the very top of the thigh
      // partly on the pelvis.
      const topShare = kind === "arm" ? 0.4 * (1 - smoothstep(-0.01 * s, 0.07 * s, tTop)) : 0.35 * (1 - smoothstep(-0.02 * s, 0.07 * s, tTop));
      // Helper ramps in over [-half, 0] and hands over to the lower bone over [0, half].
      const toHelper = smoothstep(-half, 0, tMid);
      const toLower = smoothstep(0, half, tMid);
      // Wrist / ankle: the limb end inside the hand / shoe follows the end bone.
      const toEnd = kind === "arm" ? smoothstep(-0.022 * s, 0.004 * s, tEnd) : smoothstep(-0.05 * s, -0.005 * s, tEnd);
      let rest = k;
      const wTop = rest * topShare;
      rest -= wTop;
      const wEnd = rest * toEnd;
      rest -= wEnd;
      const wLower = rest * toLower;
      const wHelper = rest * (toHelper - toLower);
      const wUpper = rest * (1 - toHelper);
      w[top] += wTop;
      w[end] += wEnd;
      w[lower] += wLower;
      w[helper] += wHelper;
      w[upper] += wUpper;
    };
  };

  return {
    torso,
    arm: { L: limbProfile(F.arm.L, "arm"), R: limbProfile(F.arm.R, "arm") },
    leg: { L: limbProfile(F.leg.L, "leg"), R: limbProfile(F.leg.R, "leg") },
  };
}

/** Soft region membership per vertex (5 columns, summing to 1). */
function regionMembership(positions: Float32Array, body: BodyModel): Float32Array {
  const n = positions.length / 3;
  const s = body.frames.H / (body.frames.female ? 1.68 : 1.8);
  const sigma = 0.018 * s;
  const R = REGIONS.length;
  const out = new Float32Array(n * R);
  const dist = new Float64Array(R);
  const regionSdf = REGIONS.map((r) => body.regions[r]);
  const cutoff = 6 * sigma;
  const boxD = new Float64Array(R);
  for (let v = 0; v < n; v += 1) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    let near = 0, only = 0;
    for (let r = 0; r < R; r += 1) {
      boxD[r] = boxDistance(x, y, z, regionSdf[r]);
      if (boxD[r] <= cutoff) {
        near += 1;
        only = r;
      }
    }
    // Fast path: a single region's box is within reach (most of each limb, the mid torso).
    if (near === 1) {
      for (let r = 0; r < R; r += 1) out[v * R + r] = r === only ? 1 : 0;
      continue;
    }
    let best = Infinity;
    for (let r = 0; r < R; r += 1) {
      if (boxD[r] > cutoff + Math.min(best, cutoff)) {
        dist[r] = Infinity;
        continue;
      }
      const d = regionSdf[r].d(x, y, z);
      dist[r] = d;
      if (d < best) best = d;
    }
    let total = 0;
    for (let r = 0; r < R; r += 1) {
      const m = dist[r] === Infinity ? 0 : Math.exp(-(dist[r] - best) / sigma);
      dist[r] = m;
      total += m;
    }
    for (let r = 0; r < R; r += 1) out[v * R + r] = dist[r] / total;
  }
  return out;
}

/** Dense bone weights (D columns) from region membership and the axial joint profiles. */
function denseFromMembership(positions: Float32Array, membership: Float32Array, body: BodyModel): Float32Array {
  const n = positions.length / 3;
  const R = REGIONS.length;
  const prof = profiles(body);
  const dense = new Float32Array(n * D);
  const row = new Float32Array(D);
  for (let v = 0; v < n; v += 1) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    row.fill(0);
    let total = 0;
    for (let r = 0; r < R; r += 1) total += membership[v * R + r];
    for (let r = 0; r < R; r += 1) {
      const m = membership[v * R + r] / (total || 1);
      if (m < 1e-4) continue;
      if (r === 0) prof.torso(x, y, z, row, m);
      else if (r === 1) prof.arm.L(x, y, z, row, m);
      else if (r === 2) prof.arm.R(x, y, z, row, m);
      else if (r === 3) prof.leg.L(x, y, z, row, m);
      else prof.leg.R(x, y, z, row, m);
    }
    dense.set(row, v * D);
  }
  return dense;
}

/** Keeps the four largest weights per vertex (renormalised) as three-style skin attributes. */
function topFour(dense: Float32Array, n: number): SkinWeights {
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  const idx = [0, 0, 0, 0];
  const wt = [0, 0, 0, 0];
  for (let v = 0; v < n; v += 1) {
    idx.fill(0);
    wt.fill(-1);
    const o = v * D;
    for (let c = 0; c < D; c += 1) {
      const value = dense[o + c];
      if (value <= wt[3]) continue;
      let slot = 3;
      while (slot > 0 && value > wt[slot - 1]) {
        wt[slot] = wt[slot - 1];
        idx[slot] = idx[slot - 1];
        slot -= 1;
      }
      wt[slot] = value;
      idx[slot] = c;
    }
    let sum = 0;
    for (let i = 0; i < 4; i += 1) if (wt[i] > 0) sum += wt[i];
    for (let i = 0; i < 4; i += 1) {
      const w = wt[i] > 0 && sum > 0 ? wt[i] / sum : 0;
      skinIndex[v * 4 + i] = BONE_INDEX[DENSE[idx[i]]];
      skinWeight[v * 4 + i] = w;
    }
    if (sum <= 0) {
      skinIndex[v * 4] = BONE_INDEX.hips;
      skinWeight[v * 4] = 1;
    }
  }
  return { skinIndex, skinWeight };
}

export interface BodySkin extends SkinWeights {
  /** Dense smoothed weights (D columns), kept for transfers onto clothing. */
  dense: Float32Array;
}

/**
 * Skin weights for the body mesh. Region membership (the only non-smooth input: it changes
 * across seams) is Laplacian-smoothed over the mesh; the joint profiles are smooth functions of
 * position already, so smoothing 5 membership columns instead of 23 bone columns is enough.
 */
export function computeBodySkin(mesh: RawMesh, body: BodyModel, iterations = 4, adjacency?: Adjacency): BodySkin {
  const n = mesh.positions.length / 3;
  let membership = regionMembership(mesh.positions, body);
  if (iterations > 0) membership = smoothAttribute(membership, REGIONS.length, adjacency ?? vertexAdjacency(mesh), iterations, 0.5);
  const dense = denseFromMembership(mesh.positions, membership, body);
  return { ...topFour(dense, n), dense };
}

/**
 * Copies skin weights from a source surface (the body) onto nearby target vertices (clothing):
 * inverse-distance blend of the closest source vertices that face the same way.
 */
export function transferSkin(
  source: { positions: Float32Array; normals: Float32Array; dense: Float32Array; hash?: PointHash; coarse?: PointHash },
  target: { positions: Float32Array; normals: Float32Array; indices?: Uint32Array },
  radius = 0.016,
): SkinWeights {
  const hash = source.hash ?? new PointHash(source.positions, radius);
  let coarse = source.coarse ?? null;
  const n = target.positions.length / 3;
  const dense = new Float32Array(n * D);
  const K = 6;
  const bestI = new Int32Array(K), bestD = new Float64Array(K);
  for (let v = 0; v < n; v += 1) {
    const x = target.positions[v * 3], y = target.positions[v * 3 + 1], z = target.positions[v * 3 + 2];
    const nx = target.normals[v * 3], ny = target.normals[v * 3 + 1], nz = target.normals[v * 3 + 2];
    bestI.fill(-1);
    bestD.fill(Infinity);
    const side = x > 0.012 ? 1 : x < -0.012 ? -1 : 0;
    const visit = (i: number, d2: number) => {
      // Scores are ≥ the distance, so anything past the current K-th best can be skipped early.
      if (d2 >= bestD[K - 1]) return;
      // Never borrow from the other side of the body (left thigh vs right thigh at the crotch).
      const sx = source.positions[i * 3];
      if ((side > 0 && sx < -0.004) || (side < 0 && sx > 0.004)) return;
      // Penalise source vertices facing away (e.g. the other thigh across the crotch).
      const facing = nx * source.normals[i * 3] + ny * source.normals[i * 3 + 1] + nz * source.normals[i * 3 + 2];
      const score = d2 * (facing > 0.2 ? 1 : facing > -0.2 ? 4 : 25);
      if (score >= bestD[K - 1]) return;
      let slot = K - 1;
      while (slot > 0 && score < bestD[slot - 1]) {
        bestD[slot] = bestD[slot - 1];
        bestI[slot] = bestI[slot - 1];
        slot -= 1;
      }
      bestD[slot] = score;
      bestI[slot] = i;
    };
    hash.query(x, y, z, visit);
    // Nothing near (e.g. a hem rim tucked inside the body): widen the search instead of guessing.
    if (bestI[0] < 0) {
      coarse ??= new PointHash(source.positions, 0.06);
      coarse.query(x, y, z, visit);
    }
    let total = 0;
    const o = v * D;
    for (let j = 0; j < K; j += 1) {
      const i = bestI[j];
      if (i < 0) continue;
      const w = 1 / (bestD[j] + 1e-6);
      total += w;
      for (let c = 0; c < D; c += 1) dense[o + c] += w * source.dense[i * D + c];
    }
    if (total > 0) for (let c = 0; c < D; c += 1) dense[o + c] /= total;
    else dense[o + COL.hips] = 1;
  }
  // Smooth over the target surface too: neighbours that picked different skin vertices (crotch,
  // armpits) end up with continuous weights instead of tearing apart in extreme poses.
  if (target.indices) {
    const adjacency = vertexAdjacency({ positions: target.positions, normals: target.normals, indices: target.indices });
    return topFour(smoothAttribute(dense, D, adjacency, 2, 0.5), n);
  }
  return topFour(dense, n);
}

/** Spatial hash over the body vertices for repeated `transferSkin` calls. */
export function skinHash(positions: Float32Array, radius = 0.016): PointHash {
  return new PointHash(positions, radius);
}
