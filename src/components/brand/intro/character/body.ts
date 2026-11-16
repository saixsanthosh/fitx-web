/**
 * Anatomical body sculpt as a signed distance field in bind space (worker-safe: no `three`,
 * no DOM). OWNER: character-body.
 *
 * Neck to wrists and ankles: torso masses (rib cage, abdomen, pelvis, shoulder girdle) carry
 * muscle layers (pecs or bust, lats, trapezius, scapulae, erectors, obliques, abs, glutes); the
 * limbs (`bodyLimbs.ts`) join with smooth unions while left/right limbs stay in a hard union
 * so nothing webs together in the A-pose. Every primitive is tagged with its bone and region
 * for skinning. The neck rises under the jaw where the head mesh overlaps it, the arms end
 * ~1 cm past the wrist (hands overlap) and the legs end mid-ankle (shoe collars overlap).
 *
 * `spec.build` drives the sculpt: `muscle` scales bellies, `bodyFat` widens blends (softer
 * forms), and the girth multipliers scale their regions.
 */

import { capsule, ellipsoid, roundCone, smoothSubtract, smoothUnion, sphere, union } from "../sdf";
import type { Sdf } from "../sdf";
import type { BindPose, BoneName } from "../rig/skeleton";
import type { BuildSpec, CharacterSpec } from "./types";
import { limbGirths, sculptArm, sculptLeg, type LimbGirths } from "./bodyLimbs";
import { bodyFrames, frameQuat, v3lerp, v3norm, v3sub, type BodyFrames, type Side, type V3 } from "./frames";

export type BodyRegion = "torso" | "armL" | "armR" | "legL" | "legR";

export interface BodyPrimitive {
  bone: BoneName;
  region: BodyRegion;
  sdf: Sdf;
}

/** Bind-space reference levels derived from the sculpt, used by clothing and paint. */
export interface BodyMarks {
  /** Narrowest waist height. */
  waistY: number;
  navel: V3;
  sternumTop: V3;
  /** Height of the armpit hollow. */
  armpitY: number;
  /** Lowest point of the crotch. */
  crotchY: number;
  /** Front surface depth (z) of the chest at nipple height (male) / bust apex (female). */
  chestFrontZ: number;
}

export interface BodyModel {
  /** Skin field, meters, negative inside, bind space. */
  sdf: Sdf;
  primitives: BodyPrimitive[];
  /** Hard union of each region's primitives (skinning membership, clothing masks). */
  regions: Record<BodyRegion, Sdf>;
  /** Each region's own smooth sculpt before the joins (diagnostics, per-region probes). */
  blended: Record<BodyRegion, Sdf>;
  frames: BodyFrames;
  marks: BodyMarks;
  /** Target limb girth radii used by the sculpt (clothing fits against them). */
  limbGirths: LimbGirths;
  /** Suggested Surface Nets cell size (meters). */
  cell: number;
}

/** Shared state for the sculpt functions. */
export interface SculptContext {
  spec: CharacterSpec;
  build: BuildSpec;
  F: BodyFrames;
  /** Height scale against the 1.80 m (male) / 1.68 m (female) reference. */
  s: number;
  fem: boolean;
  mus: number;
  fat: number;
  /** Blend radius scaled by height and softened by body fat. */
  k: (base: number) => number;
  /** Records a primitive with its bone and region and returns it. */
  add: (bone: BoneName, region: BodyRegion, sdf: Sdf) => Sdf;
}

/** z of the surface met by marching from far front (dir = +1) or far back (dir = -1) at x = 0. */
function surfaceZ(shape: Sdf, y: number, dir: 1 | -1): number {
  let z = 0.4 * dir;
  for (let i = 0; i < 200; i += 1) {
    const d = shape.d(0, y, z);
    if (d < 2e-4) break;
    z -= dir * Math.max(d, 1e-3);
  }
  return z;
}

/** Ellipsoid in a frame whose local Y follows `up` and local Z faces `front`. */
const orientedEllipsoid = (center: V3, radii: V3, up: V3, front: V3 = [0, 0, 1]) => ellipsoid(center, radii, frameQuat(up, front));

function sculptTorso(ctx: SculptContext) {
  const { F, s, fem, mus, build } = ctx;
  const J = F.joint;
  const hip = J("hips"), spine = J("spine"), chest = J("chest"), neck = J("neck"), head = J("head");
  const sh = J("upperArm_L");
  const sternum = F.mark("sternumTop");
  const navel = F.mark("navel");
  const mf = (male: number, female: number) => (fem ? female : male);
  const r = (v: number) => v * s;
  // Torso positions: x and z are absolute depths of the reference body (scaled), y is offset from
  // a joint height. (Joints sit near the back of the torso, so depths are not joint-relative.)
  const P = (x: number, y: number, z: number): V3 => [x * s, y, z * s];
  const T = (bone: BoneName, sdf: Sdf) => ctx.add(bone, "torso", sdf);
  const m = 0.82 + 0.36 * mus;
  const cd = build.chestDepth;
  const waist = build.waist;
  const ad = 0.7 + 0.3 * waist;
  const trap = (0.75 + 0.75 * build.shoulderMass) * mf(1, 0.75);

  // ---- skeleton masses: rib cage (egg), abdomen + abdominal wall, pelvis bowl, shoulder girdle.
  const ribs = T("chest", ellipsoid(P(0, chest[1] + r(mf(0.015, 0.012)), -0.014), [r(mf(0.15, 0.128)) * (0.96 + 0.08 * mus), r(mf(0.165, 0.15)), r(mf(0.104, 0.092)) * cd]));
  const abZ = navel[2] - r(0.002);
  const abdomen = T("spine", ellipsoid([0, spine[1] + r(0.002), abZ - r(0.014) - r(mf(0.094, 0.086)) * ad], [r(mf(0.134, 0.108)) * waist, r(mf(0.128, 0.115)), r(mf(0.094, 0.086)) * ad]));
  // The rectus sheath keeps the front plane flat from the ribs to the navel (an ellipsoid
  // abdomen alone recedes too fast above the navel).
  const wall = T("spine", ellipsoid([0, navel[1] + r(0.06), abZ - r(0.068)], [r(mf(0.104, 0.092)) * waist, r(mf(0.2, 0.18)), r(0.056)]));
  const pelvis = T("hips", ellipsoid(P(0, hip[1] - r(mf(0.045, 0.05)), mf(-0.018, -0.02)), [r(mf(0.148, 0.158)), r(mf(0.105, 0.11)), r(mf(0.102, 0.1))]));
  const girdle = T("chest", ellipsoid(P(0, sh[1] - r(0.02), -0.012), [sh[0] * mf(0.86, 0.84), r(mf(0.075, 0.066)), r(mf(0.092, 0.082)) * (0.92 + 0.08 * cd)]));
  const core = smoothUnion(ctx.k(mf(0.06, 0.07)), pelvis, abdomen, wall, ribs, girdle);

  const front: Sdf[] = [];
  const pecs: Sdf[] = [];
  const back: Sdf[] = [];
  const sides: Sdf[] = [];
  for (const side of ["L", "R"] as Side[]) {
    const sx = side === "L" ? 1 : -1;
    const shoulderBone = `shoulder_${side}` as BoneName;
    // Pecs: the sternocostal head is a broad plate, thickest along its lower border (the shelf),
    // its lateral end rising toward the armpit; the thin clavicular head fills up to the clavicle.
    const pm = (0.6 + 0.8 * mus) * (0.9 + 0.1 * cd) * (fem ? 0.6 : 1);
    const pz = 0.09 * (0.8 + 0.2 * cd) - (fem ? 0.014 : 0);
    pecs.push(T("chest", orientedEllipsoid(P(0.078 * sx, chest[1] + r(mf(0.07, 0.074)), pz - r(0.004)), [r(0.082) * Math.sqrt(pm), r(0.068) * Math.sqrt(pm), r(0.026) * pm], v3norm([-0.3 * sx, 1, -0.05]), v3norm([0.32 * sx, 0.05, 1]))));
    pecs.push(T("chest", orientedEllipsoid(P(0.07 * sx, chest[1] + r(0.138), pz - r(0.022)), [r(0.062), r(0.05), r(0.024) * Math.sqrt(pm)], v3norm([-0.3 * sx, 1, -0.3]), v3norm([0.3 * sx, 0.3, 1]))));
    // Anterior armpit fold: pec tendon rolling onto the humerus.
    front.push(T("chest", roundCone(P(0.12 * sx, chest[1] + r(0.09), 0.062 - (fem ? 0.01 : 0)), [sx * (sh[0] - r(0.014)), sh[1] - r(0.055), r(0.0)], r(mf(0.026, 0.02)) * Math.sqrt(pm), r(mf(0.021, 0.017)))));
    if (fem) {
      // Modest bust, compressed by the sports top (always covered).
      const bust = 0.55 + 0.9 * build.bust;
      front.push(T("chest", orientedEllipsoid(P(0.056 * sx, chest[1] + r(0.06), 0.07), [r(0.06), r(0.054), r(0.036) * bust], v3norm([0.1 * sx, 1, 0.12]), v3norm([0.28 * sx, -0.08, 1]))));
    }
    // Clavicle ridge from the sternum to the acromion.
    front.push(T(shoulderBone, capsule([sx * r(0.016), sternum[1] + r(0.004), sternum[2] - r(0.008)], [sx * (sh[0] - r(0.03)), sh[1] + r(0.02), r(0.002)], r(mf(0.0085, 0.0075)))));
    // Flared lower rib cage under the pecs (costal margin).
    front.push(T("chest", ellipsoid(P(0.078 * sx, chest[1] - r(0.03), mf(0.034, 0.03)), [r(0.062), r(0.06), r(0.052) * cd])));
    // Serratus / upper external oblique over the lower ribs.
    sides.push(T("chest", ellipsoid(P(mf(0.118, 0.1) * sx, chest[1] - r(0.075), -0.006), [r(0.03), r(0.07), r(0.068)])));
    // Rectus abdominis segments: four pairs above the navel give subtle definition.
    const ab = m * mf(1, 0.75);
    for (const [dy, ry] of [[0.162, 0.03], [0.112, 0.03], [0.062, 0.03], [0.012, 0.032]] as const) {
      front.push(T("spine", ellipsoid([sx * r(0.035), navel[1] + r(dy), abZ - r(0.026) + r(0.003) * ab], [r(0.033) * ab, r(ry), r(0.026)])));
    }
    // Obliques / flank above the iliac crest.
    sides.push(T("spine", ellipsoid([sx * r(mf(0.104, 0.09)) * waist, hip[1] + r(mf(0.09, 0.08)), r(0.004)], [r(mf(0.034, 0.026)), r(0.08), r(mf(0.07, 0.064))])));
    // Lats: the V-taper wings below the armpit (widest at the top) narrowing into the lower back.
    const lat = m * mf(1, 0.7);
    sides.push(T("chest", orientedEllipsoid(P(mf(0.12, 0.1) * (0.9 + 0.2 * mus) * sx, chest[1] + r(0.04), -0.046), [r(0.042) * lat, r(0.125), r(0.06) * Math.sqrt(lat)], v3norm([0.3 * sx * lat, 1, 0.05]))));
    sides.push(T("spine", roundCone(P(mf(0.1, 0.088) * sx, chest[1] - r(0.02), -0.07), P(0.06 * sx, spine[1] + r(0.02), -0.068), r(0.03) * Math.sqrt(lat), r(0.022))));
    // Upper trapezius: neck side down to the acromion; sets the shoulder slope.
    const trapA = P(0.034 * sx, neck[1] + r(0.036), -0.054);
    const trapB: V3 = [sx * (sh[0] - r(0.016)), sh[1] + r(0.022), r(-0.036)];
    const trapLen = Math.hypot(trapB[0] - trapA[0], trapB[1] - trapA[1], trapB[2] - trapA[2]);
    back.push(T(shoulderBone, orientedEllipsoid(v3lerp(trapA, trapB, 0.45), [r(0.026) * trap, trapLen * 0.62, r(0.05) * Math.sqrt(trap)], v3sub(trapB, trapA), [0, 0.45, -1])));
    // Shoulder blades (infraspinatus / teres) on the upper back.
    back.push(T("chest", orientedEllipsoid(P(mf(0.088, 0.078) * sx, chest[1] + r(mf(0.074, 0.068)), mf(-0.104, -0.096)), [r(0.064), r(0.082), r(0.02) * m], v3norm([0.22 * sx, 1, 0]), v3norm([0.25 * sx, 0, -1]))));
    // Erector spinae columns either side of the spine groove.
    back.push(T("spine", ellipsoid(P(0.035 * sx, spine[1] - r(0.012), mf(-0.074, -0.07)), [r(0.034), r(0.13), r(0.032) * m])));
    // Glutes (rounded, slightly outward-tilted).
    const gl = build.glutes;
    back.push(T("hips", orientedEllipsoid(P(mf(0.068, 0.075) * sx, hip[1] - r(mf(0.064, 0.07)), mf(-0.072, -0.076)), [r(mf(0.07, 0.074)) * gl, r(mf(0.088, 0.09)) * gl, r(mf(0.054, 0.054)) * gl], v3norm([-0.1 * sx, 1, 0]))));
  }
  // Sternum plate: fills between the pecs so the sternal groove stays shallow.
  front.push(T("chest", ellipsoid(P(0, chest[1] + r(0.07), mf(0.07, 0.064)), [r(0.032), r(0.095), r(0.026)])));
  // Mid trapezius diamond between the shoulder blades and the nape.
  back.push(T("chest", ellipsoid(P(0, chest[1] + r(mf(0.13, 0.12)), mf(-0.088, -0.082)), [r(0.11) * Math.sqrt(trap), r(0.12), r(0.03) * trap])));
  // Lower belly between navel and pubis.
  front.push(T("hips", ellipsoid(P(0, hip[1] + r(0.034), mf(0.05, 0.052)), [r(mf(0.086, 0.09)), r(0.07), r(0.04)])));

  let torso = smoothUnion(ctx.k(mf(0.03, 0.04)), core, ...sides);
  torso = smoothUnion(ctx.k(0.028), torso, ...back);
  // Pecs blend softly (no undercut crease the mesher could tear); details stay crisper.
  torso = smoothUnion(ctx.k(0.03), torso, ...pecs);
  torso = smoothUnion(ctx.k(mf(0.016, 0.022)), torso, ...front);

  // ---- neck: column + sternocleidomastoids + nape; rises into the head (which overlaps it).
  const nk = mf(1, 0.84) * (0.92 + 0.16 * build.shoulderMass) * (0.95 + 0.1 * mus);
  const neckParts: Sdf[] = [
    T("neck", roundCone([0, neck[1] - r(0.025), sternum[2] - r(0.058)], [0, head[1] + r(0.025), head[2] - r(0.012)], r(0.06) * nk, r(0.054) * nk)),
    T("neck", ellipsoid(P(0, neck[1] + r(0.035), -0.05), [r(0.046) * nk, r(0.07), r(0.024) * nk])),
  ];
  for (const sx of [1, -1]) {
    neckParts.push(T("neck", capsule([sx * r(0.044), head[1] + r(0.012), head[2] - r(0.022)], [sx * r(0.015), sternum[1] + r(0.014), sternum[2] - r(0.016)], r(mf(0.0125, 0.0105)) * nk)));
  }
  if (!fem) neckParts.push(T("neck", ellipsoid([0, head[1] - r(0.04), r(0.045)], [r(0.012), r(0.017), r(0.011)])));
  const neckShape = smoothUnion(ctx.k(0.014), ...neckParts);
  torso = smoothUnion(ctx.k(mf(0.03, 0.026)), torso, neckShape);

  // ---- carved details: navel and the spine groove. The groove follows the sculpted back surface
  // (found by marching), sinking a fixed depth whatever the build.
  const navelPit = sphere([navel[0], navel[1], navel[2] - r(0.002)], r(0.0062));
  const grooveR = r(0.016);
  const groovePts: V3[] = [chest[1] + r(0.15), chest[1] + r(0.05), chest[1] - r(0.06), spine[1], spine[1] - r(0.06)].map((y) => {
    const back = surfaceZ(torso, y, -1);
    return [0, y, back - grooveR + r(mf(0.0042, 0.0034))];
  });
  const grooves: Sdf[] = [];
  for (let i = 0; i + 1 < groovePts.length; i += 1) grooves.push(capsule(groovePts[i], groovePts[i + 1], grooveR));
  torso = smoothSubtract(ctx.k(0.01), torso, union(navelPit, ...grooves));

  return torso;
}

/** Builds the body SDF and its tagged primitives from the skeleton landmarks and `spec.build`. */
export function buildBody(spec: CharacterSpec, bind: BindPose): BodyModel {
  const F = bodyFrames(bind);
  const fem = F.female;
  const primitives: BodyPrimitive[] = [];
  const fat = spec.build.bodyFat;
  const s = F.H / (fem ? 1.68 : 1.8);
  const ctx: SculptContext = {
    spec,
    build: spec.build,
    F,
    s,
    fem,
    mus: spec.build.muscle,
    fat,
    // Leaner bodies get crisper blends (more definition); women's are softer at the same score.
    k: (base) => base * s * (0.8 + 1.1 * fat) * (fem ? 1.08 : 1),
    add: (bone, region, sdf) => {
      primitives.push({ bone, region, sdf });
      return sdf;
    },
  };

  const torso = sculptTorso(ctx);
  const girths = limbGirths(ctx);
  const armL = sculptArm(ctx, F.arm.L, girths);
  const armR = sculptArm(ctx, F.arm.R, girths);
  const legL = sculptLeg(ctx, F.leg.L, girths);
  const legR = sculptLeg(ctx, F.leg.R, girths);

  // Deltoids blend broadly into traps and pecs; the rest of the arm blends tightly so the armpit
  // stays open; thighs blend into pelvis and glutes. Left/right always meet in hard unions.
  let sdf = smoothUnion(ctx.k(0.03), torso, union(armL.shoulder, armR.shoulder));
  sdf = smoothUnion(ctx.k(0.02), sdf, union(armL.limb, armR.limb));
  sdf = smoothUnion(ctx.k(fem ? 0.04 : 0.034), sdf, union(legL, legR));

  const group = (region: BodyRegion) => union(...primitives.filter((p) => p.region === region).map((p) => p.sdf));
  const regions: Record<BodyRegion, Sdf> = { torso: group("torso"), armL: group("armL"), armR: group("armR"), legL: group("legL"), legR: group("legR") };
  const blended: Record<BodyRegion, Sdf> = { torso, armL: union(armL.shoulder, armL.limb), armR: union(armR.shoulder, armR.limb), legL, legR };

  const J = F.joint;
  const navel = F.mark("navel");
  const marks: BodyMarks = {
    waistY: navel[1] + 0.03 * s,
    navel,
    sternumTop: F.mark("sternumTop"),
    armpitY: J("upperArm_L")[1] - 0.075 * s,
    crotchY: J("upperLeg_L")[1] - (fem ? 0.075 : 0.085) * s,
    chestFrontZ: 0.12 * s,
  };
  // ~1.3 cm for a 1.80 m adult (scaled with height): smooth SDF normals carry the shading, and the
  // triangle budget leaves room for the head, hands and shoes.
  return { sdf, primitives, regions, blended, frames: F, marks, limbGirths: girths, cell: 0.013 * (F.H / 1.8) };
}
