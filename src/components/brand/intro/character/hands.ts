/**
 * Hands in several grips (worker-safe). OWNER: character-details agent.
 *
 * One rigid RIGHT-hand part per pose (`hand_relaxed`, `hand_fist`, `hand_grip`, `hand_open`, plus
 * `hand_glass` for the Ø74 mm smoothie glass), on `hand_R`, positions relative to the wrist joint.
 * The sculpt (`details/handSculpt.ts`) is authored in the canonical hand frame and placed with
 * the bind hand frame: fingers along the A-pose arm, palm toward the thigh, thumb forward (+Z).
 * The wrist sleeve ends inside the body's forearm (faces past it are culled). Paint: skin with
 * lighter palms and pads, flushed knuckles, darker finger creases, lighter nails, baked occlusion.
 * Assembly mirrors each part across X for `hand_L`.
 */
import type { V3 } from "../sdf/api";
import * as S from "../sdf/index";
import { pointOf, segmentDirection, type BindPose } from "../rig/skeleton";
import { noise3 } from "../math";
import type { CharacterSpec, HandPose, MeshPart } from "./types";
import { applyOcclusion, cullMesh, frameQuat, lin, mix3, paintMesh, rigidPart, sstep, type RGB } from "./details/kit";
import { poseHand, type FingerChain } from "./details/handSculpt";
import { skinOcclusionTint } from "./head";

export const HAND_POSES: HandPose[] = ["relaxed", "fist", "grip", "open", "glass"];

/** Surface Nets cell for hands at the 0.19 m reference hand length (meters). */
export const HAND_CELL = 0.0054;

/**
 * One RIGHT-hand part per pose, named `hand_${pose}`, rigid on `hand_R` (positions relative to the
 * wrist joint). Assembly mirrors each across X for `hand_L`.
 */
export function buildHands(spec: CharacterSpec, bind: BindPose): MeshPart[] {
  return HAND_POSES.map((pose) => buildHand(spec, bind, pose));
}

/** Bind frame of the right hand: u = fingers, v = palm normal, w = thumb (u × v = w). */
export function handFrame(bind: BindPose) {
  const u = segmentDirection(bind, "hand_R") ?? [0, -1, 0];
  const t0: V3 = [0, 0, 1];
  const w = S.normalize(S.sub(t0, S.scale(u, S.dot(t0, u))));
  const v = S.cross(w, u);
  const length = S.distance(pointOf(bind, "hand_R"), pointOf(bind, "handTip_R"));
  return { u, v, w, length, scale: length / 0.19 };
}

export function buildHand(spec: CharacterSpec, bind: BindPose, pose: HandPose): MeshPart {
  const fem = bind.proportions.sex === "female";
  const f = handFrame(bind);
  const k = f.scale;
  const posed = poseHand(pose, fem);
  const q = frameQuat({ origin: [0, 0, 0], x: f.u, y: f.v, z: f.w });
  const sdf = S.transform(posed.sdf, { rotate: q, scale: k });
  let mesh = S.meshSdf(sdf, { cell: HAND_CELL * k });
  // The wrist sleeve continues ~2 cm into the forearm; everything past 1.6 cm is hidden there.
  const cut = -0.013 * k;
  mesh = cullMesh(mesh, (x, y, z) => x * f.u[0] + y * f.u[1] + z * f.u[2] > cut);
  const ao = S.bakeAO(mesh, sdf, { steps: 3, stepSize: 0.003 * k, strength: 1 });

  const base = lin(spec.skin.base), flush = lin(spec.skin.flush), shade = lin(spec.skin.shade);
  // Palms and pads are lighter and pinker than the back of the hand (strongly so on deep skin).
  const lum = 0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2];
  const palmLift = lum < 0.08 ? 0.3 : lum < 0.2 ? 0.2 : 0.1;
  const palmTone = mix3(mix3(base, flush, 0.35), [Math.min(1, base[0] * 1.9 + 0.06), Math.min(1, base[1] * 1.7 + 0.04), Math.min(1, base[2] * 1.7 + 0.04)], palmLift);
  const nailTone = mix3(mix3(base, [0.62, 0.42, 0.38], 0.5), [0.8, 0.66, 0.62], lum < 0.08 ? 0.18 : 0.22);
  // Flatten the digit segments once (no allocation in the per-vertex loop).
  const digits: FingerChain[] = [...posed.fingers, posed.thumb];
  const segN = digits.length * 3;
  const seg = new Float64Array(segN * 12);
  digits.forEach((dg, di) => {
    for (let s = 0; s < 3; s += 1) {
      const o = (di * 3 + s) * 12;
      const a = dg.joints[s], b = dg.joints[s + 1];
      seg[o] = a[0]; seg[o + 1] = a[1]; seg[o + 2] = a[2];
      seg[o + 3] = b[0] - a[0]; seg[o + 4] = b[1] - a[1]; seg[o + 5] = b[2] - a[2];
      seg[o + 6] = 1 / ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + (b[2] - a[2]) ** 2);
      seg[o + 7] = dg.radii[s]; seg[o + 8] = dg.radii[s + 1];
      seg[o + 9] = dg.pad[0]; seg[o + 10] = dg.pad[1]; seg[o + 11] = dg.pad[2];
    }
  });
  const knuckle = mix3(flush, shade, 0.4);
  const seed = spec.seed;
  const colors = paintMesh(mesh, (out, x, y, z, nx, ny, nz) => {
    const u = (x * f.u[0] + y * f.u[1] + z * f.u[2]) / k;
    const v = (x * f.v[0] + y * f.v[1] + z * f.v[2]) / k;
    const w = (x * f.w[0] + y * f.w[1] + z * f.w[2]) / k;
    const nv = nx * f.v[0] + ny * f.v[1] + nz * f.v[2];
    const mott = 1 + 0.04 * noise3(x * 120, y * 120, z * 120, seed + 7);
    let c: RGB = [base[0] * mott, base[1] * mott, base[2] * mott];
    // Palm side lighter (by normal and depth into the palm side).
    c = mix3(c, palmTone, Math.min(1, sstep(-0.1, 0.55, nv) * sstep(-0.004, 0.006, v)) * 0.9);
    // Per-digit features: knuckle flush, palmar creases at joints, nails on the dorsal tip.
    for (let i = 0; i < segN; i += 1) {
      const o = i * 12;
      const t = Math.min(1, Math.max(0, ((u - seg[o]) * seg[o + 3] + (v - seg[o + 1]) * seg[o + 4] + (w - seg[o + 2]) * seg[o + 5]) * seg[o + 6]));
      const dx = u - seg[o] - seg[o + 3] * t, dy = v - seg[o + 1] - seg[o + 4] * t, dz = w - seg[o + 2] - seg[o + 5] * t;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const rr = seg[o + 7] + (seg[o + 8] - seg[o + 7]) * t;
      if (dist > rr * 1.5) continue;
      const side = (dx * seg[o + 9] + dy * seg[o + 10] + dz * seg[o + 11]) / (dist || 1);
      if (t < 0.18 && side < -0.2) c = mix3(c, knuckle, 0.28 * (1 - t / 0.18));
      if (side > 0.3 && (t < 0.06 || t > 0.94)) c = mix3(c, shade, 0.22);
      if (i % 3 === 2 && t > 0.35 && side < -0.35) c = mix3(c, nailTone, 0.85 * sstep(0.35, 0.5, t) * sstep(-0.35, -0.6, side));
    }
    out[0] = c[0];
    out[1] = c[1];
    out[2] = c[2];
  });
  applyOcclusion(colors, ao, { strength: 0.8, gamma: 1.2, tint: skinOcclusionTint(spec) });
  return rigidPart(`hand_${pose}`, "skin", mesh, colors, "hand_R");
}
