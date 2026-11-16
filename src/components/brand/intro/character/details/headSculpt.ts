/**
 * Head + face SDF sculpt shared by the head, hair and accessory generators (worker-safe).
 * OWNER: faces agent (was character-details).
 *
 * Coordinates are head-bone-local (bind world − head joint), +Y up, +Z forward, +X = the
 * character's LEFT. Numbers are authored for a reference 1.80 m male (k = 1) and scaled by
 * k = height · headSize / 1.80, matching the rig's head landmarks (headTop, eyeMid, chin).
 *
 *   skull (vault, frontal, occiput, parietal ellipsoids — the hair maps and helmet fit to it;
 *     carved back below the brows so the face field alone shapes the face)
 *   ∪ face front (`faceField.ts`: one clean heightfield for brow, orbits, lid mounds, cheeks,
 *     nose, lips, chin and jaw, cut by the under-jaw plane)
 *   ∪ neck stub ∪ ears.
 * The lid mounds cover the eyes here; `head.ts` cuts the eye windows into the mesh (the face
 * rig's eyeballs and lid shells fill them). Everything is symmetric (`mirrorX`).
 */

import type { Quat, Sdf, V3 } from "../../sdf/api";
import * as S from "../../sdf/index";
import { pointOf, type BindPose } from "../../rig/skeleton";
import type { CharacterSpec } from "../types";
import type { EyeAperture } from "./eyeShape";
import { buildFaceField, type FaceField } from "./faceField";


export interface HeadAnchors {
  /** Left eyeball centre (+X); the right eye mirrors x. */
  eye: V3;
  eyeRadius: number;
  /** The eye almond (also the head's eye window and the face rig's lid margins). */
  aperture: EyeAperture;
  /** Stomion (mouth centre) and mouth half-width. */
  mouth: V3;
  mouthHalfWidth: number;
  noseTip: V3;
  subnasale: V3;
  alaX: number;
  nasion: V3;
  /** Cheek "apple" centre (left). */
  cheek: V3;
  /** Left ear centre (concha). */
  ear: V3;
  chin: V3;
  /** Left jaw angle (gonion). */
  gonion: V3;
  /** Brow centre-line control points (left, medial → lateral), before surface projection. */
  browLine: V3[];
  /** Hair-relevant cranium centre (for angular hairline maps). */
  craniumCenter: V3;
  /** Ear centre (left) and pinna extent for the fine ear patch. */
  earRadius: number;
}

export interface HeadSculpt {
  /** Scale vs the 1.80 m reference head. */
  k: number;
  female: boolean;
  /** Full head + face + neck stub (head-local). */
  sdf: Sdf;
  /** Head + neck without eye openings and ears. */
  scalp: Sdf;
  /** Cranium + face sides + neck: matches the head over the hair region (hair/helmet shells). */
  cranium: Sdf;
  /** Eyeballs + lids proxy for occlusion bakes (both eyes). */
  eyeProxy: Sdf;
  /** The body's neck column (head-local): head surface well inside it is never seen. */
  neckColumn: Sdf;
  anchors: HeadAnchors;
  /** The face heightfield (landmarks and mouth curves for paint, beard and expressions). */
  field: FaceField;
}

const cache = new Map<string, HeadSculpt>();

/** Builds (and memoises per spec) the head sculpt. */
export function sculptHead(spec: CharacterSpec, bind: BindPose): HeadSculpt {
  const p = bind.proportions;
  const key = JSON.stringify([spec.id, spec.seed, spec.face, p.height, p.headSize, p.sex, spec.build.muscle, spec.build.bodyFat]);
  const hit = cache.get(key);
  if (hit) return hit;
  const result = build(spec, bind);
  cache.set(key, result);
  return result;
}

const qx = (a: number): Quat => S.quatFromAxisAngle([1, 0, 0], a);
const qy = (a: number): Quat => S.quatFromAxisAngle([0, 1, 0], a);
const qm = (a: Quat, b: Quat): Quat => S.quatMultiply(a, b);

function build(spec: CharacterSpec, bind: BindPose): HeadSculpt {
  const prop = bind.proportions;
  const female = prop.sex === "female";
  const k = (prop.height * prop.headSize) / 1.8;
  const F = spec.face;
  const head = pointOf(bind, "head");
  const eyeMid = pointOf(bind, "eyeMid");

  const P = (x: number, y: number, z: number): V3 => [x * k, y * k, z * k];
  const R = (r: number) => r * k;
  const E = (c: V3, r: V3, q?: Quat) => S.ellipsoid(P(c[0], c[1], c[2]), [R(r[0]), R(r[1]), R(r[2])], q);
  const RC = (a: V3, b: V3, ra: number, rb: number) => S.roundCone(P(a[0], a[1], a[2]), P(b[0], b[1], b[2]), R(ra), R(rb));

  // Reference-space landmarks (divide by k so authored numbers stay in the 1.80 m frame).
  const eyeY = (eyeMid[1] - head[1]) / k;
  const eyeZ = (eyeMid[2] - head[2]) / k;
  const fem = female ? 1 : 0;

  // ------------------------------------------------------------------ cranium (hair/helmet fit to it)
  const vault = E([0, 0.127, -0.008], [0.0722 - 0.0015 * fem, 0.1035, 0.095]);
  const frontal = E([0, 0.146, 0.021 + 0.003 * fem], [0.0618, 0.072, 0.0725]);
  const occiput = E([0, 0.094, -0.05], [0.056, 0.056, 0.054]);
  const parietal = E([0, 0.152, -0.028], [0.0742 - 0.0015 * fem, 0.062, 0.07]);
  const skull = S.smoothUnion(R(0.03), vault, frontal, occiput, parietal);

  // ------------------------------------------------------------------ neck stub
  // Follows the body's neck column (character-body `body.ts`: a round cone from the sternum notch
  // to just above the head joint) at ~88% of its radius, so the body's neck is what shows below
  // the jaw and this stub only shapes the jaw-to-neck fillet. Cut just under the jaw (`head.ts`).
  const H = prop.height;
  const sb = H / (female ? 1.68 : 1.8);
  const nk = (female ? 0.84 : 1) * (0.92 + 0.16 * spec.build.shoulderMass) * (0.95 + 0.1 * spec.build.muscle);
  const neckBottom: V3 = [0, -0.057 * prop.neckLength * H - 0.025 * sb, 0.044 * H - 0.058 * sb];
  const neckTop: V3 = [0, 0.025 * sb, -0.012 * sb];
  const neckAt = (y: number): [V3, number] => {
    const t = (y - neckBottom[1]) / (neckTop[1] - neckBottom[1]);
    return [[0, y, neckBottom[2] + (neckTop[2] - neckBottom[2]) * t], (0.06 + (0.054 - 0.06) * t) * nk * sb];
  };
  const [n0, r0] = neckAt(-0.05 * k);
  const [n1, r1] = neckAt(0.022 * k);
  const neckShape = S.roundCone(n0, n1, r0 * 0.88, r1 * 0.88);
  const neckColumn = S.roundCone(neckBottom, neckTop, 0.06 * nk * sb, 0.054 * nk * sb);

  // ------------------------------------------------------------------ eyes + face front
  const eyeRadius = 0.0119 * (0.62 + 0.38 * F.eyeSize) * (female ? 0.985 : 1);
  const ex = female ? 0.0306 : 0.0318;
  const ey = eyeY;
  // Seated ~1 mm deeper than the rig's eyeMid landmark suggests: the lids sit in the face, not on it.
  const ez = eyeZ - 0.0184 + 0.001 * fem;
  const field = buildFaceField(spec, k, female, { ye: ey, ex, ez, eyeR: eyeRadius });
  const L = field.L;

  // Below the brows the face heightfield alone shapes the face: the skull's frontal bone is
  // carved back there, or the wide skull–face blend would fill the eye windows and soften the
  // orbits (the forehead and temples still blend over 2 cm).
  const faceCarve = E([0, ey - 0.012, 0.102], [0.061, 0.036, 0.037]);
  let base = S.smoothUnion(R(0.02), S.smoothSubtract(R(0.01), skull, faceCarve), field.sdf);
  base = S.smoothUnion(R(0.016), base, neckShape);
  const scalp = base;
  // Hair and helmet shells are built on this: identical to the head over the hair region.
  const cranium = base;

  // ------------------------------------------------------------------ ear (left, local frame)
  const earO: V3 = [0.0712, 0.0915, -0.0108];
  const earLocal = S.smoothUnion(
    0.002 * k,
    S.smoothSubtract(
      0.0024 * k,
      S.smoothUnion(
        0.003 * k,
        E([0.0132, 0, 0.0004], [0.0152, 0.0292, 0.0062]),
        // Helix: a full rolled rim (a thin one caught the sheen as a dotted bright outline).
        RC([0.003, 0.0255, 0.0032], [0.0175, 0.0285, 0.0036], 0.0041, 0.0044),
        RC([0.0175, 0.0285, 0.0036], [0.0285, 0.0085, 0.0036], 0.0044, 0.0042),
        RC([0.0285, 0.0085, 0.0036], [0.0215, -0.0165, 0.0028], 0.0042, 0.0036),
        E([0.0118, -0.0245, 0.0006], [0.0085, 0.0085, 0.0046]),
        E([0.0004, -0.0008, -0.0062], [0.0088, 0.021, 0.0075]),
      ),
      E([0.0098, -0.003, 0.0085], [0.0085, 0.0112, 0.0055]),
    ),
    E([-0.0012, -0.0042, 0.0034], [0.0042, 0.0058, 0.0036]),
  );
  // Local u = back, v = up, w = out; tilt the top back 14° and flare the rim out 12° (more stood
  // out like cup handles from the front).
  const earQ = qm(qy(-0.21), qm(qx(-0.24), frameToQuat()));
  const ear = S.transform(earLocal, { rotate: earQ, translate: P(earO[0], earO[1], earO[2]) });
  base = S.smoothUnion(R(0.0045), base, ear);

  // ------------------------------------------------------------------ eyes
  // No cavity: the lid mound (only ~2.5 mm thick over the eyeball) would be thinner than a mesh
  // cell and mesh into folds. The head mesh is cut open along the almond instead (`head.ts`),
  // and the face rig's eyeball and lid shells fill the opening.
  const aperture = field.aperture;
  const eW: V3 = P(ex, ey, ez);
  const rEye = R(eyeRadius);

  const sdf = S.mirrorX(base);
  const eyeProxy = S.union(S.sphere(eW, rEye + R(0.0021)), S.sphere([-eW[0], eW[1], eW[2]], rEye + R(0.0021)));

  // A gentle arch peaking over the outer iris, no hook at the tail (a peaked, hooked arch read as
  // surprise from below and as a frown from the front).
  const browArch = female ? 0.0024 : 0.0013;
  const zAt = (s: number, t: number) => L.za + field.radius(Math.atan2(s, 0.09), ey + t) * Math.cos(Math.atan2(s, 0.09));
  const anchors: HeadAnchors = {
    eye: eW,
    eyeRadius: rEye,
    aperture,
    mouth: P(0, ey + L.tSt, zAt(0, L.tSt)),
    mouthHalfWidth: R(L.mouthHalf),
    noseTip: P(0, ey + L.tTip, L.zTip),
    subnasale: P(0, ey + L.tSub, L.zSub),
    alaX: R(L.alaS + 0.005),
    nasion: P(0, ey + L.tNasion, L.zNasion),
    cheek: P(L.cheekS, ey + L.cheekT, zAt(L.cheekS, L.cheekT)),
    ear: P(earO[0] + 0.006, earO[1] - 0.004, earO[2] - 0.004),
    chin: P(0, ey + L.tM + 0.004, L.zM + 0.006),
    gonion: P(L.gonionX + 0.002, ey + L.tG - 0.004, L.za + 0.002),
    // Low and level over the eyes, the heads a touch lower than the arch: calm and focused.
    browLine: [
      P(0.0122, ey + 0.0105, 0.1),
      P(0.0228, ey + 0.0122 + browArch * 0.5, 0.1),
      P(0.0345, ey + 0.0134 + browArch * 0.92, 0.1),
      P(0.0445, ey + 0.0134 + browArch * 0.85, 0.1),
      P(0.0532, ey + 0.0123 + browArch * 0.4, 0.1),
    ],
    craniumCenter: P(0, 0.118, -0.006),
    earRadius: R(0.036),
  };
  return { k, female, sdf, scalp, cranium, eyeProxy, neckColumn, anchors, field };
}

/** Rotation taking ear-local axes (u = back, v = up, w = out) to head axes (−Z, +Y, +X). */
function frameToQuat(): Quat {
  // Columns: u → (0,0,−1), v → (0,1,0), w → (1,0,0): a +90° turn about +Y.
  return S.quatFromAxisAngle([0, 1, 0], Math.PI / 2);
}
