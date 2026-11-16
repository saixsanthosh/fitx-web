/**
 * Skin vertex paint for the body mesh (worker-safe: no `three`, no DOM). OWNER: character-body.
 *
 * Colour = skin tone with low-frequency fbm variation (blotchy warmth like real skin), slight
 * flush on knees / elbows / shoulders, curvature shading (creases toward the shade tone, convex
 * forms a touch lighter, as a sculptor's cavity map) and baked AO tinted warm-dark so occluded
 * skin reads as subsurface-lit instead of grey. Output is linear RGB.
 */

import { clamp01, fbm3, mixRGB, smoothstep, srgbHexToLinear } from "../math";
import type { LinearRGB } from "../types";
import type { CharacterSpec } from "./types";
import type { BodyFrames, V3 } from "./frames";

export interface SkinPaintInput {
  positions: Float32Array;
  normals: Float32Array;
  ao: Float32Array;
  curvature: Float32Array;
  /** Optional extra occlusion (e.g. contact shadow under garment hems), 1 = none. */
  contact?: Float32Array;
}

const dist2 = (x: number, y: number, z: number, p: V3) => (x - p[0]) ** 2 + (y - p[1]) ** 2 + (z - p[2]) ** 2;

export function paintSkin(spec: CharacterSpec, frames: BodyFrames, input: SkinPaintInput): Float32Array {
  const { positions, normals, ao, curvature, contact } = input;
  const n = positions.length / 3;
  const base = srgbHexToLinear(spec.skin.base);
  const flush = srgbHexToLinear(spec.skin.flush);
  const shade = srgbHexToLinear(spec.skin.shade);
  // Deep shadow inside creases: the shade tone pushed darker and redder (blood under skin).
  const deep: LinearRGB = [shade[0] * 0.55, shade[1] * 0.38, shade[2] * 0.34];
  const seed = spec.seed % 997;
  const knees = [frames.leg.L.b, frames.leg.R.b];
  const elbows = [frames.arm.L.b, frames.arm.R.b];
  const shoulders = [frames.arm.L.a, frames.arm.R.a];
  const H = frames.H;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const nz = normals[i * 3 + 2], ny = normals[i * 3 + 1];
    // Low-frequency tone variation (~10–20 cm blotches) plus a finer, weaker layer.
    const blotch = fbm3(x * 5.5, y * 5.5, z * 5.5, 3, seed);
    const fine = fbm3(x * 23, y * 23, z * 23, 2, seed + 11);
    let c: LinearRGB = mixRGB(base, flush, clamp01(0.18 + 0.32 * blotch));
    // Flush where skin is thin or sun-catching: kneecaps, elbows, tops of the shoulders.
    let fl = 0;
    for (const k of knees) fl = Math.max(fl, Math.exp(-dist2(x, y, z, [k[0], k[1] + 0.01 * H, k[2] + 0.035 * H]) / (0.05 * H) ** 2) * clamp01(0.4 + nz));
    for (const e of elbows) fl = Math.max(fl, 0.8 * Math.exp(-dist2(x, y, z, e) / (0.035 * H) ** 2));
    for (const s of shoulders) fl = Math.max(fl, 0.45 * Math.exp(-dist2(x, y, z, [s[0], s[1] + 0.02 * H, s[2]]) / (0.05 * H) ** 2) * clamp01(ny + 0.3));
    c = mixRGB(c, flush, 0.35 * fl);
    // Curvature: creases toward shade, convex forms slightly lifted.
    const k = curvature[i];
    if (k < 0) c = mixRGB(c, shade, clamp01(-k * 0.55));
    else c = mixRGB(c, [c[0] * 1.07, c[1] * 1.06, c[2] * 1.05], clamp01(k * 0.9));
    const tone = 1 + 0.035 * fine;
    // AO with a warm-dark tint (subsurface bounce) and a gamma so only real creases go deep.
    const a = Math.pow(clamp01(ao[i]), 1.35) * (contact ? contact[i] : 1);
    const occ = smoothstep(0, 1, a);
    out[i * 3] = (deep[0] + (c[0] - deep[0]) * (0.25 + 0.75 * occ)) * tone;
    out[i * 3 + 1] = (deep[1] + (c[1] - deep[1]) * (0.2 + 0.8 * occ)) * tone;
    out[i * 3 + 2] = (deep[2] + (c[2] - deep[2]) * (0.2 + 0.8 * occ)) * tone;
  }
  return out;
}
