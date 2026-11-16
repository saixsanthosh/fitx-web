/**
 * Face heightfield (worker-safe: no `three`, no DOM). OWNER: faces agent.
 *
 * The face front — brow, orbits, cheeks, nose, lips, chin and the sides of the jaw — is one
 * cylindrical heightfield ρ = R(θ, y) around a vertical axis behind the mouth (θ = 0 straight
 * ahead; |x| mirrored), cut underneath by the tilted under-jaw plane. Primitive blends gave the
 * old face its "clay" lumps; here the large forms come from one superellipse slice per height
 * (front depth, half-width, squareness), so cheeks, jaw sides and the under-jaw meet as clean
 * planes with soft edges by construction. Nose, lips, chin, brow, cheekbones and the nasolabial
 * transition are smooth radial offsets laid on that base, and the eyelid mound is the exact front
 * of a sphere around each eye merged with a smooth max (the seam is the upper-lid crease).
 *
 * Authored in the reference frame of a 1.80 m male (multiply by k), with t = y − eye height.
 * Tabulated once per character; evaluation is two bilinear lookups. The same mouth curves
 * (stomion, cupid's bow, lower border, philtrum) drive the skin paint and the expression warps,
 * so colour, form and motion stay registered.
 */

import type { Sdf } from "../../sdf/api";
import * as S from "../../sdf/index";
import type { CharacterSpec } from "../types";
import { defaultAperture, type EyeAperture } from "./eyeShape";
import { monotoneCurve, smax, sstep } from "./kit";

/** Reference-frame landmarks (1.80 m male frame; t = y − eye height above the head joint). */
export interface FaceLandmarks {
  ye: number;
  /** Left eyeball centre (x, z), eyeball radius and the lid mound radius over it. */
  ex: number;
  ez: number;
  eyeR: number;
  lidR: number;
  /** Heightfield axis z (x = 0). */
  za: number;
  tBrow: number;
  tNasion: number;
  zNasion: number;
  tTip: number;
  zTip: number;
  tSub: number;
  zSub: number;
  /** Ala centre: lateral offset and height. */
  alaS: number;
  alaT: number;
  /** Stomion at the centre and mouth half-width. */
  tSt: number;
  mouthHalf: number;
  /** Mentolabial sulcus, chin (pogonion) and menton heights; menton depth. */
  tMl: number;
  tCh: number;
  tM: number;
  zM: number;
  /** Gonion height and half-width. */
  tG: number;
  gonionX: number;
  /** Under-jaw plane: t = tM + (zM − z)·jawSlope. */
  jawSlope: number;
  /** Cheek "apple" centre (s, t) and lip protrusion at the centre (radial metres). */
  cheekS: number;
  cheekT: number;
  upperLip: number;
  lowerLip: number;
  /** Nasolabial line (s, t) from beside the ala to beside the mouth corner. */
  nlA: [number, number];
  nlB: [number, number];
}

export interface MouthCurves {
  /** Mouth-line height t at lateral offset s (ref metres). */
  stomion(s: number): number;
  /** Upper vermilion border (cupid's bow) height at s. */
  upperBorder(s: number): number;
  /** Lower vermilion border height at s. */
  lowerBorder(s: number): number;
  /** Lateral position of the philtral column at height t. */
  philtrum(t: number): number;
}

export interface FaceField {
  k: number;
  L: FaceLandmarks;
  mouth: MouthCurves;
  /** The eye almond shared with the face rig's lid shells (the head's eye window follows it). */
  aperture: EyeAperture;
  /** How far (radians) the head's eye window reaches past the almond: the shell band that shows. */
  windowGrow: { up: number; down: number; side: number };
  /** Head-local solid of the face front (actual metres), symmetric in x. */
  sdf: Sdf;
  /** Face surface radius (ref metres) from the axis at azimuth θ (radians, 0 = forward) and ref height y. */
  radius(theta: number, yRef: number): number;
}

const DEG = Math.PI / 180;
/** Table extent: azimuth (finer near the midline) and height range relative to the eyes. */
const TH = 135 * DEG;
const NU = 150;
const T0 = -0.142, T1 = 0.078, DY = 0.0007;
/** Back depth of the slices behind the axis (buried in the skull and neck). */
const BACK = 0.035;

const G = (u: number) => Math.exp(-u * u);
/** C1 compact bump of a squared normalised radius (1 at the centre, 0 at q² ≥ 1). */
const bump2 = (q2: number) => (q2 >= 1 ? 0 : (1 - q2) * (1 - q2));
const cos2 = (u: number) => (u >= 1 ? 0 : Math.cos(u * Math.PI * 0.5) ** 2);
/** Smooth max that stays exact when both inputs are ~0 (no k/4 offset over the bare base). */
const smax0 = (a: number, b: number, k: number) => smax(a, b, Math.min(k, Math.max(a, b, 0)));
/** Column azimuth for u ∈ [0, 1]: steps ~0.24° near the midline, ~1.1° at the sides. */
const thetaOf = (u: number) => TH * u * (0.35 + 0.65 * u);
const uOf = (theta: number) => (-0.35 + Math.sqrt(0.1225 + 2.6 * Math.min(1, theta / TH))) / 1.3;

/** Gaussian blur (σ ≈ 1.6 samples ≈ 1.2 mm) of the mound table in place, over rows r0..r1 ± the kernel. */
function blurMound(M: Float32Array, nc: number, ny: number, r0: number, r1: number) {
  if (r1 < r0) return;
  const RAD = 4, SIG = 1.6;
  const w = new Float64Array(RAD * 2 + 1);
  let sum = 0;
  for (let i = -RAD; i <= RAD; i += 1) sum += w[i + RAD] = Math.exp(-(i * i) / (2 * SIG * SIG));
  for (let i = 0; i < w.length; i += 1) w[i] /= sum;
  const j0 = Math.max(0, r0 - RAD), j1 = Math.min(ny - 1, r1 + RAD);
  const tmp = new Float32Array(M.length);
  for (let j = j0; j <= j1; j += 1) {
    for (let i = 0; i < nc; i += 1) {
      let a = 0;
      for (let q = -RAD; q <= RAD; q += 1) a += w[q + RAD] * M[j * nc + Math.min(nc - 1, Math.max(0, i + q))];
      tmp[j * nc + i] = a;
    }
  }
  for (let j = j0; j <= j1; j += 1) {
    for (let i = 0; i < nc; i += 1) {
      let a = 0;
      for (let q = -RAD; q <= RAD; q += 1) a += w[q + RAD] * tmp[Math.min(j1, Math.max(j0, j + q)) * nc + i];
      M[j * nc + i] = a;
    }
  }
}

export function buildFaceField(spec: CharacterSpec, k: number, female: boolean, eye: { ye: number; ex: number; ez: number; eyeR: number }): FaceField {
  const F = spec.face;
  const fem = female ? 1 : 0;
  const jaw = F.jaw, chin = F.chin, cb = F.cheekbones;
  const nw = F.noseWidth, nl = F.noseLength, nb = F.noseBridge, lf = F.lipFullness;
  const brow = F.browRidge * (female ? 0.55 : 1);
  const lean = Math.max(0, Math.min(1, 1.35 - 2.2 * spec.build.bodyFat));

  // ------------------------------------------------------------------ landmarks (ref metres)
  const { ye, ex, ez, eyeR } = eye;
  const za = 0.01;
  const tNasion = 0.0015;
  const Ln = (0.0505 + 0.008 * (nl - 0.5)) * (1 - 0.06 * fem);
  const tSub = tNasion - Ln;
  const tTip = tSub + 0.0098 + 0.002 * (nl - 0.5);
  const Hul = 0.0205 - 0.0022 * fem + 0.0012 * (lf - 0.5);
  const tSt = tSub - Hul;
  // Stomion → menton: equal thirds for Maya (her lower face read long), a touch longer for men.
  const Hlc = 0.0442 - 0.0047 * fem + 0.002 * (jaw - 0.5);
  const tM = tSt - Hlc;
  const tCh = tSt - 0.68 * Hlc;
  const tMl = tSt - 0.37 * Hlc;
  const tG = tM + 0.027 + 0.004 * jaw - 0.002 * fem;
  const tBrow = 0.0135 - 0.001 * fem;
  const zNasion = 0.0957 + 0.004 * (nb - 0.5) - 0.0015 * fem;
  const zTip = 0.1228 + 0.007 * (nb - 0.5) + 0.004 * (nl - 0.5) - 0.0035 * fem;
  const zSub = 0.1036 - 0.0018 * fem;
  const mouthHalf = (female ? 0.0229 : 0.0238) + 0.0016 * (nw - 0.5);
  const lowF = -0.0012 * fem;
  const nwf = 0.86 + 0.28 * nw;
  const alaS = (0.0122 + 0.0042 * (nw - 0.5)) * (1 - 0.05 * fem);
  const alaT = tSub + 0.0058;
  const upperLip = 0.0106 + 0.0022 * (lf - 0.5) - 0.0005 * fem;
  const lowerLip = 0.0091 + 0.0026 * (lf - 0.5) - 0.0003 * fem;

  // ------------------------------------------------------------------ base slices along the height
  const Zf = monotoneCurve([
    [T1, 0.072], [0.06, 0.0845], [0.045, 0.0915], [0.03, 0.0948], [tBrow + 0.004, 0.0962], [0.0, 0.095], [-0.025, 0.0934],
    [tSub, 0.0953 + lowF], [(tSub + tSt) / 2, 0.0969 + lowF], [tSt, 0.0973 + lowF], [tMl, 0.096 + lowF],
    [tCh, 0.0966 + lowF + 0.003 * (chin - 0.5)], [tM, 0.0862 + lowF], [tM - 0.012, 0.062], [T0, 0.04],
  ]);
  const gonionX = 0.0545 + 0.007 * (jaw - 0.5) - 0.0055 * fem;
  // Above the brows the slice tucks inside the skull (the frontal bone carries the forehead).
  const Wd = monotoneCurve([
    [T1, 0.05], [0.06, 0.058], [0.045, 0.0635], [0.02, 0.0655], [0.0, 0.0665], [-0.025, 0.069 + 0.002 * (cb - 0.5) - 0.001 * fem], [tSub, 0.0655 - 0.001 * fem],
    [tSt, 0.0605 + 0.003 * (jaw - 0.5) - 0.0045 * fem], [tG, gonionX], [tM, 0.0405 + 0.004 * jaw - 0.0035 * fem], [tM - 0.015, 0.034], [T0, 0.03],
  ]);
  // Squareness of each slice: the front rounds back toward the temples and cheekbones (a flatter
  // slice read as a mask from the front), squarer at the jaw for men.
  const Nexp = monotoneCurve([
    [0.06, 2.35], [0.015, 2.5], [0.0, 2.55], [-0.025, 2.45], [tSub, 2.25], [tSt, 2.1], [tCh, 2.15 + 0.4 * jaw * (1 - fem)], [tM, 2.1],
  ]);
  const zM = Zf(tM) - 0.0025;
  const zG = za + 0.003;
  const jawSlope = (tG - tM) / (zM - zG);

  // ------------------------------------------------------------------ mouth curves
  const mh = mouthHalf;
  const sp = 0.0052;
  const hv0 = (female ? 0.0074 : 0.0068) + 0.0028 * (lf - 0.5);
  const hl0 = (female ? 0.0099 : 0.0094) + 0.0032 * (lf - 0.5);
  const stomion = (s: number) => tSt - 0.00035 * G(s / 0.006) + 0.0005 * Math.min(1, (s / mh) ** 2);
  const upperH = (s: number) => (s < sp ? hv0 + 0.0009 * (s / sp) ** 2 : (hv0 + 0.0009) * Math.pow(Math.max(0, 1 - ((s - sp) / (mh - sp)) ** 1.6), 0.75));
  const lowerH = (s: number) => hl0 * Math.pow(Math.max(0, 1 - (s / (mh * 1.03)) ** 2), 0.55);
  const mouth: MouthCurves = {
    stomion,
    upperBorder: (s) => stomion(s) + upperH(s),
    lowerBorder: (s) => stomion(s) - lowerH(s),
    philtrum: (t) => {
      const b = stomion(0) + upperH(0);
      const u = Math.min(1, Math.max(0, (t - b) / (tSub - b)));
      return sp * 0.92 + (0.0034 - sp * 0.92) * u;
    },
  };

  // ------------------------------------------------------------------ nose profile
  const noseProfile = monotoneCurve([
    [tNasion + 0.009, zNasion - 0.004], [tNasion + 0.004, zNasion - 0.0008], [tNasion, zNasion],
    [tNasion - 0.01, zNasion + (zTip - zNasion) * 0.24], [tNasion - 0.02, zNasion + (zTip - zNasion) * 0.5],
    [tTip + 0.0075, zTip - 0.0042], [tTip + 0.003, zTip - 0.0008], [tTip, zTip], [tTip - 0.0032, zTip - 0.0016],
    [tTip - 0.0062, zTip - 0.0058], [tSub + 0.0018, zSub + 0.0042], [tSub, zSub], [tSub - 0.004, zSub - 0.0025],
  ]);
  // A low bridge is also broader and flatter (no knife-edge highlight down the dorsum).
  const bw = 1 + 0.36 * Math.max(0, 0.5 - nb);
  const noseW = monotoneCurve([
    [tNasion + 0.008, 0.0108 * bw], [tNasion, 0.0081 * bw], [tNasion - 0.015, 0.0084 * bw], [tNasion - 0.03, 0.0092 * nwf * (0.5 + 0.5 * bw)],
    [tTip + 0.004, 0.0102 * nwf], [tTip, 0.0112 * nwf], [tSub + 0.003, 0.0114 * nwf], [tSub, 0.0086 * nwf],
  ]);
  // Cross-section (1 − |u|^q)^p: a flat-topped, softly boxed dorsum (a peaked one lit as a
  // knife-edge highlight down every nose), a rounder lobule.
  const noseExp = monotoneCurve([[tNasion, 1.05 + 0.3 * nb], [tTip + 0.006, 1.1 + 0.25 * nb], [tTip, 1.15], [tSub, 1.3]]);
  const noseQ = monotoneCurve([[tNasion + 0.004, 2.6], [tNasion - 0.02, 2.5], [tTip + 0.006, 2.25], [tTip, 2.0], [tSub, 2.0]]);

  // Upper/lower lip profiles over the normalised height (0 = mouth line).
  const ulProf = monotoneCurve([[-0.12, 0.0], [-0.04, 0.5], [0, 0.78], [0.12, 0.96], [0.3, 1.0], [0.45, 0.97], [0.7, 0.86], [1.0, 0.6], [1.15, 0.38], [1.45, 0.0]]);
  const llProf = monotoneCurve([[-0.18, 0.0], [-0.05, 0.5], [0, 0.72], [0.2, 0.95], [0.45, 1.0], [0.7, 0.9], [1.0, 0.6], [1.3, 0.25], [1.75, 0.0]]);

  // Nasolabial line (from above the ala to beside the mouth corner).
  const nlA: [number, number] = [alaS + 0.0068, alaT + 0.003];
  const nlB: [number, number] = [mh + 0.0058, tSt - 0.0048];
  const nlDx = nlB[0] - nlA[0], nlDy = nlB[1] - nlA[1];
  const nlLen = Math.hypot(nlDx, nlDy);
  const cheekS = 0.036, cheekT = tSub + 0.006;

  /** Radial offset (ref metres) of every feature at base lateral offset s and height t. */
  // Height-only terms of the features, cached per table row.
  const NY = Math.round((T1 - T0) / DY) + 1;
  const rowNoseH = new Float64Array(NY), rowNoseW = new Float64Array(NY), rowNoseExp = new Float64Array(NY), rowNoseQ = new Float64Array(NY);
  for (let j = 0; j < NY; j += 1) {
    const t = T0 + j * DY;
    if (t < tNasion + 0.012 && t > tSub - 0.006) {
      rowNoseH[j] = (noseProfile(t) - Zf(t)) * sstep(tNasion + 0.011, tNasion + 0.002, t) * sstep(tSub - 0.006, tSub, t);
      rowNoseW[j] = noseW(t);
      rowNoseExp[j] = noseExp(t);
      rowNoseQ[j] = noseQ(t);
    }
  }
  // Mouth curves sampled finely across the mouth (looked up per table entry).
  const MS = 0.00025, MN = Math.ceil((mh + 0.002) / MS) + 2;
  const stT = new Float64Array(MN), uhT = new Float64Array(MN), lhT = new Float64Array(MN);
  for (let i = 0; i < MN; i += 1) {
    const x = Math.min(i * MS, mh);
    stT[i] = stomion(x);
    uhT[i] = upperH(x);
    lhT[i] = lowerH(x);
  }
  const at = (T: Float64Array, x: number) => {
    const f = Math.min(MN - 1.001, Math.max(0, x / MS));
    const i = f | 0;
    return T[i] + (T[i + 1] - T[i]) * (f - i);
  };
  const stMh = stomion(mh);

  const features = (s: number, t: number, j: number): number => {
    // ---------------- masses (combined with a smooth max so overlapping ones never stack)
    let mass = 0;
    // Nose: midline profile above the base with a rounded cross-section (per-row terms cached).
    const h = rowNoseH[j];
    if (h > 0 && s < 0.016) {
      const u = s / rowNoseW[j];
      if (u < 1) mass = h * Math.pow(1 - Math.pow(u, rowNoseQ[j]), rowNoseExp[j]);
    }
    // Alae: soft wings beside the lobule (C2 falloff: no ring at the edge).
    const qa = ((s - alaS) / (0.0062 + 0.001 * nw)) ** 2 + ((t - alaT) / 0.006) ** 2;
    if (qa < 1) mass = smax0(mass, (0.0064 + 0.0015 * nw) * (1 - qa) ** 3 * (1 - 0.15 * fem), 0.0015);
    // Upper lip (skin + vermilion), lower lip, chin.
    // (The block reaches above the subnasale to where the upper-lip profile ends: cut lower, its
    // mass stepped by up to a millimetre in a line beside the alae.)
    if (s < mh + 0.012 && t < tSub + 0.5 * Hul + 0.002 && t > tM - 0.01) {
      const st = at(stT, s);
      const tauU = (t - st) / (tSub - st);
      const latU = cos2(s / (mh + 0.0075));
      if (latU > 0 && tauU > -0.12 && tauU < 1.45) mass = smax0(mass, upperLip * ulProf(tauU) * latU, 0.002);
      const hl = Math.max(0.0015, at(lhT, s));
      const tauL = (st - t) / hl;
      const latL = cos2(s / (mh + 0.0035));
      if (latL > 0 && tauL > -0.18 && tauL < 1.75) mass = smax0(mass, lowerLip * llProf(tauL) * latL, 0.002);
    }
    if (t < tCh + 0.016 && t > tCh - 0.016 && s < 0.024) {
      const v = (t - tCh) / 0.0145;
      const lat = female ? bump2((s / 0.0185) ** 2) : Math.max(0, 1 - (s / 0.0215) ** 4);
      mass = smax0(mass, (0.0038 + 0.004 * (chin - 0.5) - 0.0006 * fem) * bump2(v * v) * lat, 0.003);
    }
    let dR = mass;
    // Chin pad: a small rounded fat pad on the chin's front (catches a soft highlight).
    if (t < tCh + 0.012 && t > tCh - 0.014 && s < 0.02) dR += 0.0006 * bump2(((s / 0.011) ** 2) + ((t - tCh + 0.0015) / 0.0085) ** 2);

    // ---------------- lip details
    if (s < mh + 0.01 && t < tSub + 0.004 && t > tM) {
      const st = at(stT, s);
      // Mouth line: a soft crease along the stomion, fading out past the corners. Wider than a
      // mesh cell (a narrower one aliases into serrations); the lips are cut apart along it for
      // the laugh and paint darkens the line itself.
      dR -= 0.0019 * G((t - st) / 0.0027) * (1 - sstep(mh - 0.004, mh + 0.005, s));
      // Commissure: a small dimple just outside each corner.
      dR -= 0.0011 * G(Math.hypot(s - mh - 0.0016, t - stMh) / 0.003);
      // Vermilion borders: the "white roll" ridge on the upper lip, a softer edge on the lower.
      const ub = st + at(uhT, s);
      dR += 0.0003 * G((t - ub) / 0.001) * (1 - sstep(mh - 0.008, mh - 0.001, s));
      const lb = st - at(lhT, s);
      dR += 0.0002 * G((t - lb) / 0.0013) * (1 - sstep(mh - 0.01, mh - 0.002, s));
      // Philtrum: two soft columns with a shallow groove between, border to nose.
      if (t > ub - 0.001 && s < 0.009) {
        const fade = sstep(ub - 0.001, ub + 0.0025, t) * sstep(tSub + 0.0005, tSub - 0.003, t);
        dR += fade * (0.00055 * G((s - mouth.philtrum(t)) / 0.0016) - 0.00035 * G(s / 0.0021));
      }
      // Mentolabial sulcus (deeper on the men: it sets the lower lip off the chin).
      dR -= (0.0024 + 0.0008 * (1 - fem)) * G((t - tMl) / 0.0042) * cos2(s / 0.026);
    }
    // Shallow nostril dimples under the lobule (paint does the dark) and the alar crease around
    // the upper and outer edge of each wing.
    const qn = ((s - 0.0058 * nwf) / 0.0036) ** 2 + ((t - (tSub + 0.0032)) / 0.0024) ** 2;
    if (qn < 1) dR -= 0.0009 * (1 - qn) ** 3;
    if (qa < 4.5) dR -= 0.0009 * G((Math.sqrt(qa) - 1.02) / 0.28) * sstep(alaT - 0.0065, alaT - 0.0015, t);

    // ---------------- upper face
    // Brow ridge: a band along the upper orbital rim, softer at the glabella, fading laterally.
    if (t > -0.03 && t < 0.06 && s < 0.068) {
      const tb = tBrow + 0.0035 * bump2(((s - 0.028) / 0.03) ** 2);
      dR += (0.0012 + 0.0032 * brow) * G((t - tb) / 0.0075) * sstep(0.065, 0.044, s) * (1 - 0.25 * G(s / 0.007));
    }
    // Orbit: an almond depression around the eye, shallower below so the lower lid melts into
    // the cheek (no ring); the lid mound fills its centre.
    {
      const tc = 0.0015;
      const q = ((s - ex - 0.0008) / 0.0205) ** 2 + ((t - tc) / (t > tc ? 0.0135 : 0.0115)) ** 2;
      if (q < 1) dR -= (female ? 0.0085 : 0.0095) * bump2(q) * (0.58 + 0.42 * sstep(tc - 0.005, tc + 0.004, t));
    }
    // Infraorbital fill: the cheek rises to meet the lower lid, so the lid flows into it.
    {
      const q = ((s - ex - 0.002) / 0.018) ** 2 + ((t + 0.0135) / 0.0085) ** 2;
      if (q < 1) dR += (female ? 0.0019 : 0.0016) * bump2(q);
    }
    // Temple plane behind the lateral orbital rim.
    if (s > 0.032 && t > -0.03 && t < 0.07) dR -= 0.0016 * G(Math.hypot((s - 0.059) / 0.009, (t - 0.021) / 0.016));
    // Cheekbone: a broad, low swell along the zygomatic arch (lateral, slightly up). Kept soft so
    // it lifts the light on the cheek without printing a bar.
    {
      const ds = s - 0.0472, dt = t + 0.0235;
      const ua = ds * 0.966 + dt * 0.259, va = -ds * 0.259 + dt * 0.966;
      // Its lower side falls off slowly on the women (a quick falloff printed a diagonal dark band
      // from the ear to the mouth corner under a high key).
      const vr = va < 0 ? 0.0145 + 0.0055 * fem : 0.0145;
      dR += (0.0012 + 0.0022 * cb) * bump2((ua / 0.021) ** 2 + (va / vr) ** 2);
    }
    // Zygomatic prominence: a smaller, firmer swell on the cheekbone's high point that catches
    // the light between eye and jaw (the broad swell alone left a flat plane).
    {
      const q = ((s - 0.052) / 0.0085) ** 2 + ((t + 0.019) / 0.0075) ** 2;
      if (q < 1) dR += (0.0005 + 0.0006 * cb) * bump2(q);
    }
    // Lower-lateral orbital rim: a soft crescent ridge where the lid–cheek junction meets the
    // bone, lateral to the eye.
    {
      const dx = s - ex, dy = t;
      const rr = Math.hypot(dx * 0.9, dy), ang = Math.atan2(dy, dx);
      if (rr < 0.026 && ang < 0.3 && ang > -1.6) dR += 0.0005 * G((rr - 0.0195) / 0.0035) * sstep(-1.6, -1.1, ang) * sstep(0.3, -0.1, ang);
    }
    // Soft hollow under the cheekbone (lean faces); broad and shallow on the women, where a narrow
    // one printed a diagonal smudge under a high key.
    if (s > 0.012 && t > -0.1 && t < -0.012) {
      const sig = female ? 0.018 : 0.013;
      dR -= (0.0004 + 0.0016 * lean) * (female ? 0.3 : 1) * G(Math.hypot((s - 0.051) / sig, (t + 0.056) / sig));
    }
    // Nasolabial transition: the cheek sits a hair forward of the upper lip beside the fold — a
    // soft roll on the cheek side of the line that eases back into the cheek a couple of
    // centimetres out (raising the whole cheek printed its window's ends as ridges across it).
    {
      const ax = s - nlA[0], ay = t - nlA[1];
      const lam = (ax * nlDx + ay * nlDy) / (nlLen * nlLen);
      if (lam > -0.4 && lam < 1.3) {
        const dn = (ay * nlDx - ax * nlDy) / nlLen; // positive toward the cheek (lateral, up)
        const along = sstep(-0.3, 0.08, lam) * (1 - sstep(0.8, 1.2, lam));
        const roll = sstep(-0.003, 0.007, dn) * (1 - sstep(0.009, 0.026, dn));
        dR += along * (0.0011 * roll - (0.0004 + 0.00035 * (1 - fem)) * G(dn / 0.0022));
      }
    }
    return dR;
  };

  // ------------------------------------------------------------------ tabulate R(θ, y) (ref metres)
  const NC = NU + 1;
  const Rt = new Float32Array(NC * NY);
  const sinT = new Float64Array(NC), cosT = new Float64Array(NC);
  for (let i = 0; i < NC; i += 1) {
    const th = thetaOf(i / NU);
    sinT[i] = Math.sin(th);
    cosT[i] = Math.cos(th);
  }
  const lidR = eyeR + 0.0028;
  const dzE = ez - za;
  const kEye = female ? 0.0032 : 0.0038;
  const tilt = (female ? 6 : 4) * DEG;
  const openAngle = (female ? 22 : 19.5) * DEG * (0.75 + 0.25 * F.eyeSize);
  // The rig's lid shells (exact, smooth geometry) form the visible margins. The head mesh gets a
  // window cut out along this almond grown past the margins (`head.ts`), so a band of shell shows
  // above (pretarsal) and below each margin; the lid mound sits just outside the shells, so the
  // window's edge reads as the lid crease.
  const aperture = defaultAperture(openAngle, tilt);
  // A narrow band: calm, slightly hooded lids (a wide one showed as a bright outline in rim light).
  const grow = { up: female ? 0.105 : 0.09, down: 0.05, side: 0.04 };
  // The lid mound is tabulated apart from the face (`Mt`) and blurred before it is added: seen
  // from the heightfield axis the sphere turns vertical near its top, bottom and sides, which the
  // table stored as 0.7 mm stair-steps (they meshed into shards that glittered in rim light).
  const Mt = new Float32Array(NC * NY);
  let mRow0 = NY, mRow1 = -1;
  for (let j = 0; j < NY; j += 1) {
    const t = T0 + j * DY;
    const zf = Zf(t), w = Wd(t), n = Nexp(t);
    const Fd = zf - za;
    const iw = 1 / w, iF = 1 / Fd, iB = 1 / BACK, inv = -1 / n;
    // Eye mound: the horizontal circle of the lid sphere at this height.
    const dyE = t;
    // The lower lid hugs the eyeball more closely than the upper (no bag under the eye).
    const lr = dyE < 0 ? lidR - 0.0006 * sstep(0, -0.006, dyE) : lidR;
    const rc2 = lr * lr - dyE * dyE;
    for (let i = 0; i < NC; i += 1) {
      const sn = sinT[i], cs = cosT[i];
      const r = Math.pow(Math.pow(sn * iw, n) + Math.pow(Math.abs(cs) * (cs >= 0 ? iF : iB), n), inv);
      let R = r;
      const s = r * sn;
      // Features fade out before the side of the slice (θ → 90°) so nothing steps at the seam.
      if (cs > 0) R += features(s, t, j) * sstep(0, 0.3, cs);
      Rt[j * NC + i] = R;
      if (rc2 > 0) {
        const b = ex * sn + dzE * cs;
        const disc = b * b - (ex * ex + dzE * dzE - rc2);
        if (disc > 0) {
          // Fade the mound out beyond the eye corners: seen from the axis, the sphere's silhouette
          // would otherwise leave a cliff line running from each corner.
          const lam = b + Math.sqrt(disc);
          const thm = Math.atan2(lam * sn - ex, za + lam * cs - ez);
          const side = Math.max(aperture.medial - thm, thm - aperture.lateral);
          const w = sstep(0.42, 0.12, side);
          if (w > 0 && lam > R) {
            Mt[j * NC + i] = smax(R, R + (lam - R) * w, kEye) - R;
            if (j < mRow0) mRow0 = j;
            if (j > mRow1) mRow1 = j;
          }
        }
      }
    }
  }
  blurMound(Mt, NC, NY, mRow0, mRow1);
  for (let o = 0; o < Rt.length; o += 1) Rt[o] += Mt[o];
  // Gradient norm of (ρ − R) for the distance estimate.
  const Gt = new Float32Array(NC * NY);
  for (let j = 0; j < NY; j += 1) {
    for (let i = 0; i < NC; i += 1) {
      const o = j * NC + i;
      const R = Rt[o];
      const j0 = Math.max(0, j - 1), j1 = Math.min(NY - 1, j + 1);
      const dRy = (Rt[j1 * NC + i] - Rt[j0 * NC + i]) / ((j1 - j0) * DY);
      const i0 = Math.max(0, i - 1), i1 = Math.min(NC - 1, i + 1);
      const dTh = thetaOf(i1 / NU) - thetaOf(i0 / NU);
      const dRt = (Rt[j * NC + i1] - Rt[j * NC + i0]) / dTh / Math.max(0.02, R);
      Gt[o] = Math.sqrt(1 + dRy * dRy + dRt * dRt);
    }
  }

  const lookup = (T: Float32Array, u: number, v: number) => {
    const i = u | 0, j = v | 0, fu = u - i, fv = v - j;
    const o = j * NC + i;
    const a = T[o] + (T[o + 1] - T[o]) * fu;
    const b = T[o + NC] + (T[o + NC + 1] - T[o + NC]) * fu;
    return a + (b - a) * fv;
  };
  const colOf = (theta: number) => Math.min(NU - 1e-6, uOf(theta) * NU);
  const rowOf = (yRef: number) => Math.min(NY - 1 - 1e-6, Math.max(0, (yRef - ye - T0) / DY));

  // ------------------------------------------------------------------ SDF (actual metres)
  const ik = 1 / k;
  const yTop = ye + T1 - 0.004, yBot = ye + T0 + 0.004;
  const jawN = 1 / Math.sqrt(1 + jawSlope * jawSlope);
  // A soft jawline (seen from below in the walk, a crisp one read as the edge of a mask).
  const kJaw = female ? 0.0135 : 0.011;
  const d = (x: number, y: number, z: number) => {
    const xr = (x < 0 ? -x : x) * ik, yr = y * ik, dz = z * ik - za;
    const rho = Math.sqrt(xr * xr + dz * dz);
    const th = Math.atan2(xr, dz);
    const u = colOf(th), v = rowOf(yr);
    const R = lookup(Rt, u, v);
    let e = (rho - R) / lookup(Gt, u, v);
    // Far from the surface the radial estimate can overshoot (thin forms like the nose, the back
    // of the slice near the axis): saturate it smoothly (tanh: no kink for the skull blend to
    // print as a crease) so the sparse sampler never skips a block that holds surface. Near the
    // surface it is the accurate estimate.
    e = e < 0 ? 0.014 * Math.tanh(e / 0.014) : 0.03 * Math.tanh(e / 0.03);
    // Under-jaw plane and the top/bottom caps of the table.
    const jawPlane = (ye + tM + (zM - (z * ik)) * jawSlope - yr) * jawN;
    e = smax(e, jawPlane, kJaw);
    e = smax(e, yr - yTop, 0.008);
    e = Math.max(e, yBot - yr);
    return e * k;
  };
  const bounds = {
    min: [-0.078 * k, (ye + T0) * k, (za - BACK - 0.004) * k] as [number, number, number],
    max: [0.078 * k, (ye + T1) * k, 0.14 * k] as [number, number, number],
  };
  const sdf = S.custom(d, bounds);

  const L: FaceLandmarks = {
    ye, ex, ez, eyeR, lidR, za, tBrow, tNasion, zNasion, tTip, zTip, tSub, zSub, alaS, alaT,
    tSt, mouthHalf, tMl, tCh, tM, zM, tG, gonionX, jawSlope, cheekS, cheekT, upperLip, lowerLip, nlA, nlB,
  };
  return {
    k,
    L,
    mouth,
    aperture,
    windowGrow: grow,
    sdf,
    radius: (theta, yRef) => lookup(Rt, colOf(theta), rowOf(yRef)),
  };
}
