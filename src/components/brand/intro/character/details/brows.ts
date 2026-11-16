/**
 * Brows (worker-safe: no `three`, no DOM). OWNER: faces agent.
 *
 * A thin hair layer conforming to the skin, rigid on `head` like the head itself: a grid along
 * the brow line (u: medial head → lateral tail, v: across), every vertex projected onto the head
 * SDF and lifted a fraction of a millimetre (thicker in the body), with SDF normals. Its colour
 * is the head's own skin paint × occlusion at that point, blended toward the hair colour by a
 * density map — a soft, sparse head, a dense body, a fine tail, a feathered upper edge and a
 * crisper lower one, faint strand streaks — so the layer's border is the skin's own colour: no
 * outline, no glint, no floating ribbon (a glossy tube read as a pencilled line at film size).
 * The smile/laugh morphs are the same warps the skin under it gets, so it never floats or sinks.
 */

import type { RawMesh, V3 } from "../../sdf/api";
import * as S from "../../sdf/index";
import { noise3 } from "../../math";
import type { CharacterSpec, MeshPart } from "../types";
import type { HeadSculpt } from "./headSculpt";
import { lin, mix3, resampleCatmull, rigidPart, sstep, type RGB } from "./kit";

/** Grid resolution along / across one brow. */
const NU = 30, NV = 10;

export interface BrowShape {
  /** Centre line (head-local, left side, medial → lateral) before projection. */
  line: V3[];
  /** Full height of the brow (metres) at the head, body and tail. */
  height: [number, number, number];
}

/** Brow layer for both sides. `skin(x, y, z, nx, ny, nz)` is the head's paint at a surface point. */
export function buildBrows(
  spec: CharacterSpec,
  sculpt: HeadSculpt,
  shape: BrowShape,
  skin: (x: number, y: number, z: number, nx: number, ny: number, nz: number) => RGB,
): { part: MeshPart; mesh: RawMesh } {
  const k = sculpt.k;
  const f = S.tiledSdf(sculpt.sdf, 0.03).d;
  const hair = lin(spec.hair.style === "ponytail" ? spec.hair.color : spec.facialHair?.color ?? spec.hair.color);
  // Brows read a little lighter and warmer than the scalp hair (finer hairs, skin through them).
  const browHair: RGB = mix3(hair, lin(spec.hair.highlight), 0.18);
  // Every point is placed by a ray straight back (−z) onto the skin: the brow is drawn as seen
  // from the front. (A nearest-surface projection pulled the lateral tail onto the lid mound,
  // which read as a downward hook.)
  const castZ = (x: number, y: number) => {
    let z = 0.16 * k;
    for (let i = 0; i < 80; i += 1) {
      const d = f(x, y, z);
      if (d < 2e-5) break;
      z -= Math.max(d, 1e-4);
    }
    return z;
  };
  const line = resampleCatmull(shape.line.map((p): V3 => [p[0], p[1], castZ(p[0], p[1])]), NU + 1);
  const [hHead, hBody, hTail] = shape.height;
  // Height profile along u: a broad, soft head, the body, a fine tail.
  const heightAt = (u: number) => (u < 0.4 ? hHead + (hBody - hHead) * sstep(0.05, 0.4, u) : hBody + (hTail - hBody) * sstep(0.4, 1, u) ** 0.9);
  // Density along u (sparse at the medial head), across v (soft top, crisper bottom).
  const alongD = (u: number) => (0.5 + 0.5 * sstep(0, 0.18, u)) * (1 - 0.4 * sstep(0.78, 1, u));
  const acrossD = (v: number) => (v >= 0 ? sstep(1, 0.36, v) : sstep(1, 0.58, -v));
  const seed = spec.seed;

  const count = (NU + 1) * (NV + 1);
  const P = new Float32Array(count * 6), N = new Float32Array(count * 6), C = new Float32Array(count * 6);
  const e = 0.0003 / Math.sqrt(3), inv4e = 1 / (4 * e);
  const grad = (x: number, y: number, z: number, out: Float64Array) => {
    const a = f(x + e, y - e, z - e), b = f(x - e, y - e, z + e), c = f(x - e, y + e, z - e), d = f(x + e, y + e, z + e);
    out[0] = (a - b - c + d) * inv4e; out[1] = (-a - b + c + d) * inv4e; out[2] = (-a + b - c + d) * inv4e;
    return (a + b + c + d) * 0.25;
  };
  const g = new Float64Array(3);
  for (let i = 0; i <= NU; i += 1) {
    const u = i / NU;
    const p = line[i], q = line[Math.min(NU, i + 1)], r = line[Math.max(0, i - 1)];
    // Across direction: perpendicular to the line in the frontal plane (roughly up).
    let tx = q[0] - r[0], ty = q[1] - r[1];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    const half = heightAt(u) * 0.5 * k;
    for (let j = 0; j <= NV; j += 1) {
      // The grid reaches a little past the density's support, so its border is pure skin.
      const v = -1.12 + (2.24 * j) / NV;
      const x = p[0] - ty * v * half, y = p[1] + tx * v * half, z = castZ(x, y);
      grad(x, y, z, g);
      const gl = 1 / (Math.hypot(g[0], g[1], g[2]) || 1);
      const nx = g[0] * gl, ny = g[1] * gl, nz = g[2] * gl;
      // Density: hair streaks run up-and-out at the head, flat along the body, down at the tail.
      const streak = noise3((u * 26 + v * (0.9 - 1.6 * u)) * 1.0, v * 2.2, seed * 0.01, seed + 51);
      const dens = Math.max(0, Math.min(1, alongD(u) * acrossD(v) * (1.08 + 0.2 * streak)));
      // Lifted by a fraction of a millimetre (more where the hair is dense) above the skin, which
      // the head mesh's flat triangles only ever undercut on this convex ridge.
      const lift = (0.00022 + 0.00045 * dens) * k;
      const o = (i * (NV + 1) + j) * 3;
      P[o] = x + nx * lift; P[o + 1] = y + ny * lift; P[o + 2] = z + nz * lift;
      N[o] = nx; N[o + 1] = ny; N[o + 2] = nz;
      const sk = skin(x, y, z, nx, ny, nz);
      const c = mix3(sk, browHair, 0.95 * dens);
      C[o] = c[0]; C[o + 1] = c[1]; C[o + 2] = c[2];
    }
  }
  // Mirror for the right brow.
  const half = count * 3;
  for (let o = 0; o < half; o += 3) {
    P[half + o] = -P[o]; P[half + o + 1] = P[o + 1]; P[half + o + 2] = P[o + 2];
    N[half + o] = -N[o]; N[half + o + 1] = N[o + 1]; N[half + o + 2] = N[o + 2];
    C[half + o] = C[o]; C[half + o + 1] = C[o + 1]; C[half + o + 2] = C[o + 2];
  }
  const idx: number[] = [];
  for (let side = 0; side < 2; side += 1) {
    const base = side * count;
    for (let i = 0; i < NU; i += 1) {
      for (let j = 0; j < NV; j += 1) {
        const a = base + i * (NV + 1) + j, b = a + 1, c = a + NV + 1, d = c + 1;
        // Wound so the left brow faces out (+normal); the mirrored copy flips.
        if (side === 0) idx.push(a, c, b, b, c, d);
        else idx.push(a, b, c, b, d, c);
      }
    }
  }
  const mesh: RawMesh = { positions: P, normals: N, indices: orientToNormals(Uint32Array.from(idx), P, N) };
  // Skin material (rougher): its edges must shade exactly like the skin they melt into.
  const part = rigidPart("brows", "skin", mesh, C, "head", { castShadow: false, roughness: 0.66 });
  return { part, mesh };
}

/** Flips triangles whose winding disagrees with their vertex normals. */
function orientToNormals(I: Uint32Array, P: Float32Array, N: Float32Array): Uint32Array {
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    if (gx * (N[a] + N[b] + N[c]) + gy * (N[a + 1] + N[b + 1] + N[c + 1]) + gz * (N[a + 2] + N[b + 2] + N[c + 2]) < 0) {
      const tmp = I[t + 1];
      I[t + 1] = I[t + 2];
      I[t + 2] = tmp;
    }
  }
  return I;
}
