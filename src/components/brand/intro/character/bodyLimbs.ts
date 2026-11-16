/**
 * Arm and leg sculpts for `body.ts` (worker-safe: no `three`, no DOM). OWNER: character-body.
 *
 * Each limb is a tapered round-cone "bone core" with muscle bellies (ellipsoids in the limb
 * frame: local Y down the segment, Z forward, X lateral) smooth-unioned on top. Every size is a
 * multiple of a target girth radius per station (upper arm, forearm, thigh, knee, calf, ankle)
 * computed from height, sex and `spec.build`, so builds stay anatomically calibrated
 * (e.g. a 1.80 m athletic man: upper arm ≈ 32 cm, mid thigh ≈ 56 cm, calf ≈ 38 cm around).
 * Left/right limbs are built separately so `body.ts` can keep them in a hard union.
 */

import { capsule, ellipsoid, roundCone, smoothUnion, sphere } from "../sdf";
import type { Sdf } from "../sdf";
import type { BoneName } from "../rig/skeleton";
import { frameQuat, v3comb, v3scale, type LimbFrame, type V3 } from "./frames";
import type { SculptContext } from "./body";

type LimbRegion = "armL" | "armR" | "legL" | "legR";

/** Target girth radii (meters) of one character's limbs. */
export interface LimbGirths {
  upperArm: number;
  forearm: number;
  /** Wrist semi-axes: [lateral (thin), forward (wide)]. */
  wrist: [number, number];
  thigh: number;
  knee: number;
  calf: number;
  ankle: number;
  /** Deltoid size (radius scale). */
  deltoid: number;
}

export function limbGirths(ctx: SculptContext): LimbGirths {
  const { s, mus, fem, build } = ctx;
  const upperArm = s * (fem ? 0.042 : 0.05) * (0.7 + 0.6 * mus);
  return {
    upperArm,
    forearm: s * (fem ? 0.036 : 0.043) * (0.78 + 0.44 * mus),
    wrist: [s * (fem ? 0.0178 : 0.0205) * (0.92 + 0.16 * mus), s * (fem ? 0.0262 : 0.0298) * (0.92 + 0.16 * mus)],
    thigh: s * (fem ? 0.078 : 0.08) * build.thighs * (0.85 + 0.3 * mus),
    knee: s * (fem ? 0.053 : 0.058) * (0.9 + 0.2 * mus) * (0.7 + 0.3 * build.thighs),
    calf: s * (fem ? 0.053 : 0.057) * build.calves * (0.86 + 0.28 * mus),
    ankle: s * (fem ? 0.0315 : 0.0345) * (0.84 + 0.16 * build.calves),
    deltoid: upperArm * (0.92 + 0.34 * build.shoulderMass) * (fem ? 0.94 : 1),
  };
}

export interface ArmSculpt {
  /** Deltoid cap (blended broadly into the trapezius / pecs). */
  shoulder: Sdf;
  /** Upper arm, elbow, forearm and wrist (blended tightly so the armpit stays open). */
  limb: Sdf;
}

export function sculptArm(ctx: SculptContext, f: LimbFrame, g: LimbGirths): ArmSculpt {
  const region: LimbRegion = f.side === "L" ? "armL" : "armR";
  const upper = `upperArm_${f.side}` as BoneName;
  const lower = `lowerArm_${f.side}` as BoneName;
  const hand = `hand_${f.side}` as BoneName;
  const shoulderBone = `shoulder_${f.side}` as BoneName;
  const S = f.a, E = f.b, W = f.c;
  const { dirU, dirL, front, out, frontL, outL, lenU, lenL } = f;
  const E3 = (bone: BoneName, center: V3, radii: V3, dir: V3, fwd: V3) => ctx.add(bone, region, ellipsoid(center, radii, frameQuat(dir, fwd)));

  // ---- shoulder: deltoid cap over the humeral head; front/rear heads lean into pec and back.
  const D = g.deltoid;
  const shoulder = smoothUnion(ctx.k(0.022),
    E3(upper, v3comb(S, [dirU, 1.16 * D], [out, 0.1 * D]), [0.92 * D, 1.72 * D, 1.0 * D], dirU, front),
    E3(upper, v3comb(S, [dirU, 0.8 * D], [front, 0.52 * D], [out, -0.08 * D]), [0.6 * D, 1.24 * D, 0.6 * D], dirU, front),
    E3(upper, v3comb(S, [dirU, 0.84 * D], [front, -0.6 * D], [out, -0.04 * D]), [0.64 * D, 1.28 * D, 0.58 * D], dirU, front),
    // Humeral head under the cap keeps the top of the shoulder round in every pose.
    ctx.add(shoulderBone, region, sphere(v3comb(S, [out, 0.08 * D], [dirU, 0.12 * D]), 0.74 * D)),
  );

  // ---- upper arm: humerus core, biceps (front), triceps long + lateral heads (back horseshoe),
  // brachialis peeking out on the lateral side above the elbow.
  const U = g.upperArm;
  const upperArm = smoothUnion(ctx.k(0.016),
    ctx.add(upper, region, roundCone(v3comb(S, [dirU, 0.02 * ctx.s]), v3comb(E, [dirU, -0.008 * ctx.s]), 0.92 * U, 0.7 * U)),
    E3(upper, v3comb(S, [dirU, 0.57 * lenU], [front, 0.48 * U], [out, -0.06 * U]), [0.64 * U, 1.6 * U, 0.6 * U], dirU, front),
    E3(upper, v3comb(S, [dirU, 0.47 * lenU], [front, -0.5 * U], [out, -0.2 * U]), [0.66 * U, 2.0 * U, 0.6 * U], dirU, front),
    E3(upper, v3comb(S, [dirU, 0.38 * lenU], [front, -0.32 * U], [out, 0.36 * U]), [0.54 * U, 1.4 * U, 0.54 * U], dirU, front),
    E3(upper, v3comb(S, [dirU, 0.76 * lenU], [out, 0.38 * U], [front, 0.08 * U]), [0.4 * U, 1.0 * U, 0.46 * U], dirU, front),
  );

  // ---- elbow: olecranon behind, epicondyles either side.
  const elbow = smoothUnion(ctx.k(0.012),
    E3(lower, v3comb(E, [front, -0.42 * U], [dirU, -0.004 * ctx.s]), [0.34 * U, 0.42 * U, 0.26 * U], dirU, front),
    ctx.add(upper, region, sphere(v3comb(E, [out, -0.52 * U], [front, -0.08 * U]), 0.26 * U)),
    ctx.add(upper, region, sphere(v3comb(E, [out, 0.48 * U], [front, -0.12 * U]), 0.24 * U)),
  );

  // ---- forearm. The A-pose hand is in neutral rotation (palm to thigh, thumb forward), so the
  // radial (thumb) side faces forward and the flexors sit medially.
  const A = g.forearm;
  const [wx, wz] = g.wrist;
  const forearm = smoothUnion(ctx.k(0.016),
    ctx.add(lower, region, roundCone(v3comb(E, [dirL, 0.012 * ctx.s]), v3comb(W, [dirL, -0.03 * ctx.s]), 0.86 * A, 0.9 * wx)),
    // Brachioradialis + extensors: the bulge on the top/outer upper forearm.
    E3(lower, v3comb(E, [dirL, 0.21 * lenL], [frontL, 0.42 * A], [outL, 0.25 * A]), [0.58 * A, 1.8 * A, 0.62 * A], dirL, frontL),
    E3(lower, v3comb(E, [dirL, 0.33 * lenL], [outL, 0.4 * A], [frontL, -0.2 * A]), [0.5 * A, 1.9 * A, 0.55 * A], dirL, frontL),
    // Flexor mass on the palm side, tapering into tendons above the wrist.
    E3(lower, v3comb(E, [dirL, 0.3 * lenL], [outL, -0.4 * A], [frontL, 0.05 * A]), [0.6 * A, 2.1 * A, 0.64 * A], dirL, frontL),
    // Distal forearm + wrist: wider front-to-back; ends ~1 cm past the joint under the hand mesh.
    E3(lower, v3comb(W, [dirL, -0.045 * ctx.s]), [1.06 * wx, 0.042 * ctx.s, 0.96 * wz], dirL, frontL),
    E3(hand, v3comb(W, [dirL, -0.004 * ctx.s]), [wx, 0.014 * ctx.s, wz], dirL, frontL),
  );

  const limb = smoothUnion(ctx.k(0.02), upperArm, elbow, forearm);
  return { shoulder, limb };
}

export function sculptLeg(ctx: SculptContext, f: LimbFrame, g: LimbGirths): Sdf {
  const { fem } = ctx;
  const region: LimbRegion = f.side === "L" ? "legL" : "legR";
  const upper = `upperLeg_${f.side}` as BoneName;
  const lower = `lowerLeg_${f.side}` as BoneName;
  const foot = `foot_${f.side}` as BoneName;
  const Hp = f.a, K = f.b, An = f.c;
  const { dirU, dirL, front, out, frontL, outL, lenU, lenL } = f;
  const up: V3 = v3scale(dirU, -1);
  const E3 = (bone: BoneName, center: V3, radii: V3, dir: V3, fwd: V3) => ctx.add(bone, region, ellipsoid(center, radii, frameQuat(dir, fwd)));
  const s = ctx.s;

  // ---- thigh: femur core + quadriceps (lateralis, rectus, medialis teardrop), adductors, hamstrings.
  const T = g.thigh;
  const thighParts: Sdf[] = [
    ctx.add(upper, region, roundCone(v3comb(Hp, [out, -0.004 * s], [dirU, 0.03 * s]), v3comb(K, [up, 0.035 * s]), 0.96 * T, 0.66 * T)),
    E3(upper, v3comb(Hp, [dirU, 0.53 * lenU], [out, 0.46 * T], [front, 0.07 * T]), [0.5 * T, 1.8 * T, 0.64 * T], dirU, front),
    E3(upper, v3comb(Hp, [dirU, 0.44 * lenU], [front, 0.5 * T], [out, 0.05 * T]), [0.54 * T, 1.8 * T, 0.42 * T], dirU, front),
    E3(upper, v3comb(Hp, [dirU, 0.8 * lenU], [out, -0.4 * T], [front, 0.24 * T]), [0.4 * T, 0.78 * T, 0.4 * T], dirU, front),
    E3(upper, v3comb(Hp, [dirU, 0.27 * lenU], [out, -0.42 * T], [front, -0.05 * T]), [0.54 * T, 1.4 * T, 0.62 * T], dirU, front),
    E3(upper, v3comb(Hp, [dirU, 0.5 * lenU], [front, -0.5 * T], [out, 0.05 * T]), [0.62 * T, 1.9 * T, 0.5 * T], dirU, front),
  ];
  if (fem) {
    // Gluteofemoral fat softens the outer upper thigh (the sweep of a female hip line).
    thighParts.push(E3(upper, v3comb(Hp, [dirU, 0.2 * lenU], [out, 0.44 * T], [front, -0.13 * T]), [0.46 * T, 1.0 * T, 0.6 * T], dirU, front));
  }

  // ---- knee: condyle block, patella, patellar tendon.
  const N = g.knee;
  const knee = smoothUnion(ctx.k(0.014),
    E3(lower, v3comb(K, [up, 0.004 * s], [front, 0.04 * N]), [0.98 * N, 0.8 * N, 0.86 * N], dirL, frontL),
    E3(upper, v3comb(K, [up, 0.014 * s], [front, 0.74 * N]), [0.38 * N, 0.42 * N, 0.2 * N], dirU, front),
    ctx.add(lower, region, capsule(v3comb(K, [frontL, 0.66 * N], [dirL, 0.01 * s]), v3comb(K, [frontL, 0.62 * N], [dirL, 0.052 * s]), 0.2 * N)),
  );

  // ---- shin: tibia core, calf (two gastrocnemius heads, medial lower and fuller), soleus,
  // tibialis anterior, Achilles tendon, ankle with malleoli (medial higher than lateral).
  const C = g.calf;
  const Ak = g.ankle;
  const shin = smoothUnion(ctx.k(0.016),
    ctx.add(lower, region, roundCone(v3comb(K, [dirL, 0.02 * s]), v3comb(An, [dirL, -0.004 * s]), 0.84 * C, 0.9 * Ak)),
    E3(lower, v3comb(K, [dirL, 0.27 * lenL], [outL, -0.42 * C], [frontL, -0.5 * C]), [0.6 * C, 1.5 * C, 0.62 * C], dirL, frontL),
    E3(lower, v3comb(K, [dirL, 0.22 * lenL], [outL, 0.44 * C], [frontL, -0.42 * C]), [0.54 * C, 1.24 * C, 0.56 * C], dirL, frontL),
    E3(lower, v3comb(K, [dirL, 0.5 * lenL], [frontL, -0.3 * C]), [0.72 * C, 1.8 * C, 0.52 * C], dirL, frontL),
    E3(lower, v3comb(K, [dirL, 0.34 * lenL], [frontL, 0.29 * C], [outL, 0.2 * C]), [0.33 * C, 1.7 * C, 0.29 * C], dirL, frontL),
    ctx.add(lower, region, capsule(v3comb(An, [dirL, -0.085 * s], [frontL, -0.8 * Ak]), v3comb(An, [dirL, -0.006 * s], [frontL, -1.02 * Ak]), 0.33 * Ak)),
    E3(foot, v3comb(An, [dirL, -0.002 * s], [frontL, -0.06 * Ak]), [1.0 * Ak, 0.034 * s, 0.96 * Ak], dirL, frontL),
    ctx.add(foot, region, sphere(v3comb(An, [outL, -0.78 * Ak], [dirL, -0.006 * s]), 0.37 * Ak)),
    ctx.add(foot, region, sphere(v3comb(An, [outL, 0.74 * Ak], [dirL, 0.006 * s], [frontL, -0.15 * Ak]), 0.35 * Ak)),
  );

  return smoothUnion(ctx.k(0.022), smoothUnion(ctx.k(0.02), ...thighParts), knee, shin);
}
