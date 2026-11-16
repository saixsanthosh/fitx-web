/**
 * Expressions (worker-safe: no `three`, no DOM). OWNER: faces agent.
 *
 * Each expression is an analytic warp of head space laid out on the same landmarks and mouth
 * curves as the sculpt (`faceField.ts`), so lips, folds and cheeks move where they are drawn:
 *
 * - `smile` (closed, confident): mouth corners pulled up, out and back along the dental arch —
 *   far enough to read at walking distance, and wide enough past the corners that a moustache
 *   visibly widens and lifts; the cheek apples ride up and forward and stop at the nasolabial
 *   line (the fold deepens); the lower lid and infraorbital skin push up (with the face rig's
 *   lower-lid raise this is the "eye smile"); alae lift a touch; the lower lip stretches; the
 *   medial brows lift a hair while the tails settle. A colour delta flushes the apples and
 *   deepens the fold, the corners and the lower-lid crease (the occlusion a real fold casts).
 * - `laugh` (added on top of `smile`): the jaw opens about the temporomandibular hinge. The head
 *   mesh is cut along the stomion between the corners (`cutLips`), so the lips part for real;
 *   past the corners the opening blends over the cheek toward the hinge. The upper lip lifts,
 *   corners and cheeks go further, the cheeks close the eyes, the brows and forehead lift. Behind
 *   the lips a rigid `faceInterior` part (`buildMouthPart`: a lit cavity, tongue, upper and lower
 *   teeth) shows through the opening; its floor, tongue and lower teeth ride the jaw.
 *
 * Position deltas are the warp; normal deltas rotate the smooth normals the way the deformation
 * rotates the mesh's own faces. Only vertices in the face region are evaluated.
 */

import type { RawMesh, V3 } from "../../sdf/api";
import type { MeshPart, MorphTarget } from "../types";
import type { HeadSculpt } from "./headSculpt";
import { cutAlongCurve, lin, mix3, rigidPart, sstep, type RGB } from "./kit";

/** Writes the displacement (head-local metres) at (x, y, z) into out; `side` = +1/−1 for the
 * upper/lower copy of a vertex on the mouth cut (or a part riding the skull / the jaw), 0 elsewhere. */
type Warp = (x: number, y: number, z: number, out: Float64Array, side: number) => void;
/** Writes the colour delta (linear RGB) for a vertex of colour `c` at (x, y, z) into out. */
type Tint = (x: number, y: number, z: number, c: Float32Array, o: number, out: Float64Array) => void;

const G2 = (u: number) => Math.exp(-u * u);
/** The cut stops this far (ref metres) inside each mouth corner; the commissure stretches. */
const CUT_INSET = 0.0022;
/** Jaw hinge (temporomandibular joint, ref t below the eyes and z) and the laugh's opening angle. */
const HINGE_T = -0.027, HINGE_Z = -0.004, JAW = 0.12;

interface Frame {
  k: number;
  ye: number;
  /** Corner weight along the mouth (0 at the centre, 1 at the corner, decaying past it). */
  along: (s: number) => number;
  /** Signed distance (ref m) across the nasolabial line, positive toward the cheek. */
  nasolabial: (s: number, t: number) => number;
  /** Position (0 → 1) along the nasolabial line from the ala to beside the corner. */
  nlAlong: (s: number, t: number) => number;
}

function frame(sc: HeadSculpt): Frame {
  const L = sc.field.L;
  const mh = L.mouthHalf;
  const [ax, ay] = L.nlA, [bx, by] = L.nlB;
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
  return {
    k: sc.k,
    ye: L.ye,
    // Past the corner the pull reaches ~2.5 cm over the cheek (a moustache's ends must move).
    along: (s) => (s <= mh ? Math.pow(s / mh, 1.3) : G2((s - mh) / 0.023)),
    nasolabial: (s, t) => ((t - ay) * dx - (s - ax) * dy) / len,
    nlAlong: (s, t) => ((s - ax) * dx + (t - ay) * dy) / (len * len),
  };
}

/** Height (ref m) above the mouth line, with copies on the cut pinned to their side. */
function mouthDv(sc: HeadSculpt, s: number, t: number, side: number) {
  if (side !== 0) return side * 1e-5;
  return t - sc.field.mouth.stomion(Math.min(s, sc.field.L.mouthHalf));
}

/** Rotation of (t, z) about the jaw hinge by `w` × the laugh's opening, as a displacement. */
function jawRotate(t: number, zr: number, w: number, out: [number, number]) {
  const c = Math.cos(JAW * w), s = Math.sin(JAW * w);
  const yy = t - HINGE_T, zz = zr - HINGE_Z;
  out[0] = yy * c - zz * s - yy;
  out[1] = yy * s + zz * c - zz;
}

function smileWarp(sc: HeadSculpt): Warp {
  const F = frame(sc);
  const L = sc.field.L;
  const mh = L.mouthHalf, k = F.k, ik = 1 / k;
  const alaS = L.alaS, alaT = L.alaT, tSub = L.tSub;
  return (x, y, z, out, side) => {
    const sx = x < 0 ? -1 : 1;
    const s = (x < 0 ? -x : x) * ik, t = y * ik - F.ye, zr = z * ik;
    let dl = 0, du = 0, df = 0;
    if (zr > L.za + 0.02 && t < 0.045 && t > L.tM - 0.03) {
      if (t < 0.02) {
        // Corners: out and up along the zygomaticus line, back around the teeth; strongest at the
        // corner, fading toward the centre of the lips and over the cheek beyond it.
        const dv = mouthDv(sc, s, t, side);
        const wc = F.along(s) * G2(dv / (dv > 0 ? 0.015 : 0.0095));
        dl += 0.006 * wc; du += 0.0092 * wc; df -= 0.0034 * wc;
        // The whole mouth widens (the centre stays put), lips thin as they stretch over the teeth.
        du += 0.0004 * G2(s / 0.012) * G2((dv - 0.004) / 0.005);
        const lo = G2(s / 0.014) * G2((dv + 0.005) / 0.005);
        du -= 0.0002 * lo; df -= 0.0007 * lo;
        df -= 0.0007 * G2(dv / 0.006) * (1 - sstep(mh - 0.004, mh + 0.004, s));
        // Cheek apples ride up and forward, stopping at the nasolabial line (the fold deepens).
        const ck = G2((s - 0.038) / 0.022) * G2((t - (tSub + 0.003)) / 0.018) * sstep(-0.003, 0.006, F.nasolabial(s, t));
        dl += 0.0012 * ck; du += 0.0062 * ck; df += 0.0042 * ck;
        // Lower lid and infraorbital skin push up under the eye ("eye smile").
        const io = G2((s - L.ex - 0.002) / 0.017) * G2((t + 0.0115) / 0.008) * sstep(0.0, -0.005, t);
        du += 0.0026 * io; df += 0.0008 * io;
        // Alae lift and flare slightly.
        const al = G2(Math.hypot(s - alaS, t - alaT) / 0.007);
        dl += 0.0005 * al; du += 0.0007 * al;
      }
      if (t > 0.002) {
        // Brows: the medial heads lift a hair, the tails settle (the orbicularis' pull).
        const bw = G2((t - 0.015) / 0.009) * sstep(0.002, 0.008, t) * G2((s - 0.033) / 0.03);
        du += bw * (0.0004 - 0.0007 * sstep(0.03, 0.055, s));
      }
    }
    out[0] = sx * dl * k;
    out[1] = du * k;
    out[2] = df * k;
  };
}

function laughWarp(sc: HeadSculpt): Warp {
  const F = frame(sc);
  const L = sc.field.L, M = sc.field.mouth;
  const mh = L.mouthHalf, k = F.k, ik = 1 / k;
  // Past each corner the split rises over the cheek toward the hinge with a widening blend.
  const sEnd = mh - CUT_INSET;
  const stCorner = M.stomion(mh);
  const slope = (-0.03 - stCorner) / (0.062 - mh);
  const tSub = L.tSub;
  const rot: [number, number] = [0, 0];
  return (x, y, z, out, side) => {
    const sx = x < 0 ? -1 : 1;
    const s = (x < 0 ? -x : x) * ik, t = y * ik - F.ye, zr = z * ik;
    let dl = 0, du = 0, df = 0;
    if (zr > L.za - 0.03 && t < 0.045 && t > L.tM - 0.05) {
      if (t < 0.02) {
        const split = s <= mh ? M.stomion(s) : stCorner + (s - mh) * slope;
        const band = 2e-4 + 0.011 * sstep(sEnd, mh + 0.026, s);
        // Inside the cut span every vertex lies wholly above or below the mouth line (the cut
        // split each triangle across it), so the side is hard: a soft weight a hair from the cut
        // left a vertex half a jaw behind its neighbours on the cut, spiking into the opening.
        const w0 = side !== 0 ? (side < 0 ? 1 : 0) : s < sEnd - 0.003 ? (t < split ? 1 : 0) : sstep(split + band, split - band, t);
        // The opening tapers to nothing at the end of the cut: near the corner both lips take half
        // the rotation, so the gap is lens-shaped and no triangles stretch across the corner.
        const taper = sstep(sEnd - 0.012, sEnd, s);
        let wj = 0.5 + (w0 - 0.5) * (1 - taper * G2((t - split) / 0.007));
        // Under the jaw the skin stretches into the neck instead of swinging with the chin.
        wj *= sstep(0.024, 0.0, L.tM + (L.zM - zr) * L.jawSlope - t);
        if (wj > 0) {
          jawRotate(t, zr, 1, rot);
          du += wj * rot[0];
          df += wj * rot[1];
        }
        const dv = mouthDv(sc, s, t, side);
        // Upper lip lifts off the teeth.
        const ul = sstep(-0.0004, 0.0012, dv) * G2(dv / 0.012) * (1 - sstep(mh - 0.002, mh + 0.01, s));
        du += 0.002 * ul; df += 0.0003 * ul;
        // Corners and cheeks go further than in the smile; the cheeks close the eyes.
        const wc = F.along(s) * G2(dv / (dv > 0 ? 0.013 : 0.0085));
        dl += 0.0012 * wc; du += 0.0022 * wc; df -= 0.0014 * wc;
        const ck = G2((s - 0.038) / 0.022) * G2((t - (tSub + 0.003)) / 0.018) * sstep(-0.003, 0.006, F.nasolabial(s, t));
        dl += 0.0004 * ck; du += 0.0018 * ck; df += 0.001 * ck;
        const io = G2((s - L.ex - 0.002) / 0.017) * G2((t + 0.0115) / 0.008) * sstep(0.0, -0.005, t);
        du += 0.0019 * io; df += 0.0006 * io;
        // The lip rims roll in a little as they part.
        df -= 0.0012 * G2(dv / 0.0016) * (1 - sstep(mh - 0.006, mh, s));
      }
      // Brows and forehead lift with the laugh (skin and brow layer alike).
      du += 0.001 * G2((t - 0.016) / 0.012) * sstep(0.0, 0.01, t) * G2((s - 0.03) / 0.04);
    }
    out[0] = sx * dl * k;
    out[1] = du * k;
    out[2] = df * k;
  };
}

/** The jaw alone (mouth interior): side −1 rides the jaw, +1 the skull, 0 blends by height. */
function jawWarp(sc: HeadSculpt): Warp {
  const L = sc.field.L, k = sc.k, ik = 1 / k;
  const st = sc.field.mouth.stomion(0);
  const rot: [number, number] = [0, 0];
  return (_x, y, z, out, side) => {
    const t = y * ik - L.ye, zr = z * ik;
    const w = side < 0 ? 1 : side > 0 ? 0 : sstep(st + 0.002, st - 0.008, t);
    jawRotate(t, zr, 1, rot);
    out[0] = 0;
    out[1] = w * rot[0] * k;
    out[2] = w * rot[1] * k;
  };
}

/** Smile colour: flushed apples, deeper nasolabial fold, mouth corners and lower-lid crease. */
function smileTint(sc: HeadSculpt, flush: RGB, amount: { apple: number; fold: number; corner: number; lid: number }): Tint {
  const F = frame(sc);
  const L = sc.field.L, M = sc.field.mouth;
  const ik = 1 / sc.k, mh = L.mouthHalf, stC = M.stomion(mh);
  return (x, y, _z, c, o, out) => {
    const s = (x < 0 ? -x : x) * ik, t = y * ik - L.ye;
    const apple = G2((s - L.cheekS) / 0.016) * G2((t - (L.cheekT + 0.004)) / 0.013);
    const lam = F.nlAlong(s, t);
    const fold = G2(F.nasolabial(s, t) / 0.0028) * sstep(-0.25, 0.12, lam) * (1 - sstep(0.95, 1.3, lam));
    const corner = G2(Math.hypot(s - mh - 0.0018, t - stC) / 0.0036);
    const lid = G2((s - L.ex - 0.001) / 0.012) * G2((t + 0.0125) / 0.003);
    const dark = amount.fold * fold + amount.corner * corner + amount.lid * lid;
    const a = amount.apple * apple;
    for (let q = 0; q < 3; q += 1) out[q] = a * (flush[q] - c[o + q]) - dark * c[o + q];
  };
}

// ---------------------------------------------------------------------------------------------
// Lip cuts

/** Per-vertex tags of the lip cuts: +1 / −1 for the two copies of a vertex on a cut, 0 elsewhere. */
export interface LipTags {
  /** Mouth line: +1 upper-lip copy, −1 lower-lip copy. */
  mouth: Int8Array;
  /** Upper vermilion border: +1 skin copy (above), −1 lip copy. */
  upper: Int8Array;
  /** Lower vermilion border: +1 lip copy (above), −1 skin copy. */
  lower: Int8Array;
}

/**
 * Cuts the head mesh along the vermilion borders and the mouth line (between the corners, inset
 * by `CUT_INSET` for the mouth line), so the lip colour has crisp, smooth borders and the laugh's
 * jaw rotation opens a real gap between the lips.
 */
export function cutLips(sc: HeadSculpt, mesh: RawMesh): { mesh: RawMesh; tags: LipTags } {
  const L = sc.field.L, M = sc.field.mouth;
  const ik = 1 / sc.k;
  const mh = L.mouthHalf;
  const st = (v: number, P: Float32Array) => {
    const s = Math.min(Math.abs(P[v * 3]) * ik, mh);
    return [s, P[v * 3 + 1] * ik - L.ye, P[v * 3 + 2] * ik] as const;
  };
  // Only triangles near the lips (centroid test) are cut; the borders stop short of the corners,
  // where the lips meet and the colour fades softly instead.
  const near = (P: Float32Array, a: number, b: number, c: number, sMax: number, tLo: number, tHi: number) => {
    const sx = Math.abs(P[a * 3] + P[b * 3] + P[c * 3]) / 3 * ik;
    const ty = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3 * ik - L.ye;
    const tz = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3 * ik;
    return sx < sMax && ty > tLo && ty < tHi && tz > L.za + 0.05;
  };
  const tLo = L.tSt - 0.02, tHi = L.tSub;
  let m = mesh;
  let P = m.positions;
  const up = cutAlongCurve(m, (v) => { const [s, t] = st(v, P); return t - M.upperBorder(s); }, (a, b, c) => near(P, a, b, c, mh - 0.0035, tLo, tHi), []);
  m = up.mesh;
  P = m.positions;
  const lo = cutAlongCurve(m, (v) => { const [s, t] = st(v, P); return t - M.lowerBorder(s); }, (a, b, c) => near(P, a, b, c, mh - 0.0035, tLo, tHi), [up.side]);
  m = lo.mesh;
  P = m.positions;
  const sEnd = mh - CUT_INSET;
  const mo = cutAlongCurve(m, (v) => { const [s, t] = st(v, P); return t - M.stomion(s); }, (a, b, c) => near(P, a, b, c, sEnd, tLo, tHi), [lo.carried[0], lo.side]);
  return { mesh: mo.mesh, tags: { mouth: mo.side, upper: mo.carried[0], lower: mo.carried[1] } };
}

// ---------------------------------------------------------------------------------------------
// Morph targets

/** Area-weighted vertex normals (unnormalised) of a triangle mesh. */
function areaNormals(P: Float32Array, I: Uint32Array, out: Float64Array) {
  out.fill(0);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    out[a] += nx; out[a + 1] += ny; out[a + 2] += nz;
    out[b] += nx; out[b + 1] += ny; out[b + 2] += nz;
    out[c] += nx; out[c + 1] += ny; out[c + 2] += nz;
  }
}

interface TargetOptions {
  side?: Int8Array | null;
  active: (x: number, y: number, z: number, v: number) => boolean;
  colors?: Float32Array;
  tint?: Tint;
}

/**
 * Builds a morph target from a warp: position deltas, normal deltas and (with a tint) colour
 * deltas. Normals: the rotation the deformation applies to the mesh's own face normals is applied
 * to the smooth (SDF) vertex normal, so shading follows the new shape without trading the smooth
 * normals for faceted ones.
 */
function target(name: string, warp: Warp, mesh: RawMesh, opts: TargetOptions): MorphTarget {
  const P = mesh.positions, N = mesh.normals;
  const n = P.length / 3;
  const dp = new Float32Array(n * 3), dn = new Float32Array(n * 3);
  const dc = opts.tint && opts.colors ? new Float32Array(n * 3) : undefined;
  const o0 = new Float64Array(3);
  const moved = new Uint8Array(n);
  for (let v = 0; v < n; v += 1) {
    const o = v * 3;
    const x = P[o], y = P[o + 1], z = P[o + 2];
    if (!opts.active(x, y, z, v)) continue;
    warp(x, y, z, o0, opts.side ? opts.side[v] : 0);
    if (o0[0] !== 0 || o0[1] !== 0 || o0[2] !== 0) {
      dp[o] = o0[0]; dp[o + 1] = o0[1]; dp[o + 2] = o0[2];
      moved[v] = 1;
    }
    if (dc && opts.tint && opts.colors) {
      opts.tint(x, y, z, opts.colors, o, o0);
      dc[o] = o0[0]; dc[o + 1] = o0[1]; dc[o + 2] = o0[2];
    }
  }
  const before = new Float64Array(n * 3), after = new Float64Array(n * 3);
  areaNormals(P, mesh.indices, before);
  const Q = new Float32Array(P.length);
  for (let i = 0; i < P.length; i += 1) Q[i] = P[i] + dp[i];
  areaNormals(Q, mesh.indices, after);
  for (let v = 0; v < n; v += 1) {
    const o = v * 3;
    let ax = before[o], ay = before[o + 1], az = before[o + 2];
    let bx = after[o], by = after[o + 1], bz = after[o + 2];
    const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz);
    if (la < 1e-18 || lb < 1e-18) continue;
    ax /= la; ay /= la; az /= la;
    bx /= lb; by /= lb; bz /= lb;
    if (!moved[v] && Math.abs(ax - bx) + Math.abs(ay - by) + Math.abs(az - bz) < 1e-6) continue;
    // Rotate the smooth normal by the rotation taking face normal a → b (Rodrigues).
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    const c = ax * bx + ay * by + az * bz;
    const nx = N[o], ny = N[o + 1], nz = N[o + 2];
    let mx: number, my: number, mz: number;
    if (c < -0.999) {
      mx = -nx; my = -ny; mz = -nz;
    } else {
      const kx = cy * nz - cz * ny, ky = cz * nx - cx * nz, kz = cx * ny - cy * nx;
      const f = 1 / (1 + c);
      const dot = cx * nx + cy * ny + cz * nz;
      mx = nx * c + kx + cx * dot * f;
      my = ny * c + ky + cy * dot * f;
      mz = nz * c + kz + cz * dot * f;
    }
    const ml = Math.hypot(mx, my, mz) || 1;
    dn[o] = mx / ml - nx;
    dn[o + 1] = my / ml - ny;
    dn[o + 2] = mz / ml - nz;
  }
  return { name, positions: dp, normals: dn, colors: dc };
}

/**
 * Smile and laugh morph targets for a head-local mesh: the head part (with the mouth-line tags
 * from `cutLips`, and its colours for the flush/fold tint) or a part that rides on the face
 * (brows, beard).
 */
export function buildExpressionMorphs(sculpt: HeadSculpt, mesh: RawMesh, side: Int8Array | null = null, tint?: { colors: Float32Array; flush: number }): MorphTarget[] {
  const L = sculpt.field.L, k = sculpt.k;
  const zMin = (L.za - 0.035) * k, yMax = (L.ye + 0.045) * k, yMin = (L.ye + L.tM - 0.06) * k;
  const active = (x: number, y: number, z: number) => z > zMin && y < yMax && y > yMin && Math.abs(x) < 0.075 * k;
  const flush = tint ? lin(tint.flush) : [0, 0, 0] as RGB;
  const smile = tint ? smileTint(sculpt, flush, { apple: 0.22, fold: 0.17, corner: 0.2, lid: 0.1 }) : undefined;
  const laugh = tint ? smileTint(sculpt, flush, { apple: 0.07, fold: 0.06, corner: 0.1, lid: 0.08 }) : undefined;
  return [
    target("smile", smileWarp(sculpt), mesh, { side, active, colors: tint?.colors, tint: smile }),
    target("laugh", laughWarp(sculpt), mesh, { side, active, colors: tint?.colors, tint: laugh }),
  ];
}

// ---------------------------------------------------------------------------------------------
// Mouth interior

/** Face-front depth (head-local metres) at lateral offset x and height y (ray-marched in −z). */
function frontZ(sc: HeadSculpt, x: number, y: number) {
  const f = sc.field.sdf.d;
  let z = 0.16 * sc.k;
  for (let i = 0; i < 48; i += 1) {
    const d = f(x, y, z);
    if (d < 2e-5) break;
    z -= Math.max(d, 1e-4);
  }
  return z;
}

interface InteriorBuilder {
  /** `n` is the shading normal; `facing` (default `n`) the true side the surface faces (winding). */
  push(p: V3, n: V3, c: RGB, side: number, smile: boolean, facing?: V3): number;
  idx: number[];
}

/**
 * The mouth interior, rigid on `head` and entirely inside the head (so it only shows through the
 * parted lips): a cavity facing inward — for any camera outside it only its far wall renders —
 * with a warm, lit value rather than black (a crushed slot read as a puppet mouth), a tongue on
 * its floor, and the upper and lower teeth along the dental arch, shaded off at the sides and
 * behind the lips. It never takes the head's own shadow (it sits inside the head). Morphs: the
 * cavity walls follow the smile's corners back; the floor, tongue and lower teeth ride the jaw.
 */
export function buildMouthPart(sc: HeadSculpt, skinShade: number): MeshPart {
  const L = sc.field.L;
  const k = sc.k;
  const mh = L.mouthHalf;
  const st = (L.ye + L.tSt) * k;
  const lipZ = frontZ(sc, 0, st);
  const pos: number[] = [], nrm: number[] = [], col: number[] = [], idx: number[] = [];
  const sides: number[] = [], smileOn: number[] = [], face: number[] = [];
  const b: InteriorBuilder = {
    push(p, n, c, side, smile, facing = n) {
      pos.push(p[0], p[1], p[2]);
      nrm.push(n[0], n[1], n[2]);
      face.push(facing[0], facing[1], facing[2]);
      col.push(c[0], c[1], c[2]);
      sides.push(side);
      smileOn.push(smile ? 1 : 0);
      return pos.length / 3 - 1;
    },
    idx,
  };
  // Cavity: an ellipsoid around the mouth, normals inward; warm and dark, deepest at the throat.
  const c: V3 = [0, st - 0.005 * k, lipZ - 0.021 * k];
  const r: V3 = [(mh + 0.003) * k, 0.014 * k, 0.022 * k];
  const throat = lin(0x4e221c), wall = lin(0x8a463c);
  // Pull any point that would reach the skin (the face recedes around the arch toward the
  // corners) back toward the centre until it sits 2.5 mm inside the head.
  const head = sc.sdf.d;
  const inside = (p: V3): V3 => {
    let q = p;
    for (let i = 0; i < 12; i += 1) {
      const d = head(q[0], q[1], q[2]) + 0.0025 * k;
      if (d <= 0) break;
      const vx = c[0] - q[0], vy = c[1] - q[1], vz = c[2] - q[2];
      const l = Math.hypot(vx, vy, vz) || 1;
      const step = Math.min(d + 2e-4, l * 0.5);
      q = [q[0] + (vx / l) * step, q[1] + (vy / l) * step, q[2] + (vz / l) * step];
    }
    return q;
  };
  const NU = 18, NV = 12;
  for (let j = 0; j <= NV; j += 1) {
    const v = -Math.PI / 2 + (Math.PI * j) / NV;
    for (let i = 0; i <= NU; i += 1) {
      const u = (2 * Math.PI * i) / NU;
      const d: V3 = [Math.cos(v) * Math.sin(u), Math.sin(v), Math.cos(v) * Math.cos(u)];
      const p = inside([c[0] + r[0] * d[0], c[1] + r[1] * d[1], c[2] + r[2] * d[2]]);
      // Shading normals lean out through the mouth: the light that reaches a mouth's inside comes
      // in through the lips, so it shades like a surface facing out (with the true inward normal
      // only the window or a pendant behind the head would light it, and it crushed to black).
      const inward: V3 = [-d[0] / r[0], -d[1] / r[1], -d[2] / r[2]];
      const il = Math.hypot(inward[0], inward[1], inward[2]) || 1;
      const g: V3 = [0.3 * inward[0] / il, 0.3 * inward[1] / il + 0.35, 0.3 * inward[2] / il + 1];
      const gl = Math.hypot(g[0], g[1], g[2]) || 1;
      // Lighter toward the lips (the opening lets light in), darkest at the back.
      const front = sstep(-0.6, 0.85, d[2]);
      const side = d[1] < -0.2 ? -1 : d[1] > 0.3 ? 1 : 0;
      b.push(p, [g[0] / gl, g[1] / gl, g[2] / gl], mix3(throat, wall, 0.85 * front), side, true, inward);
    }
  }
  for (let j = 0; j < NV; j += 1) {
    for (let i = 0; i < NU; i += 1) {
      const a = j * (NU + 1) + i, bb = a + 1, cc = a + NU + 1, d = cc + 1;
      idx.push(a, bb, cc, bb, d, cc);
    }
  }
  // Tongue: a low dome on the floor of the cavity, riding the jaw.
  const tongue = mix3(lin(0x8a4642), lin(skinShade), 0.25), tongueBack = lin(0x3a1814);
  dome(b, [0, st - 0.0088 * k, lipZ - 0.021 * k], [(mh - 0.005) * k, 0.0048 * k, 0.0145 * k], (u) => mix3(tongueBack, tongue, sstep(-0.5, 0.9, u)), -1);
  // Teeth: the incisal edges are the brightest, the sides and the parts behind the lips recede.
  const enamel = lin(0x9c9284), shadowed = lin(0x3c322c), gum = lin(0x6e3230);
  // The ends of each row melt into the cavity's own tone (a hard-ended white band read as a slab).
  const ends = mix3(wall, shadowed, 0.35);
  teeth(b, sc, st, mh, { top: st + 0.0072 * k, edge: st - 0.0011 * k, back: 0.0068 * k, enamel, shadowed, ends, gum, side: 1, sMax: mh - 0.0035 });
  teeth(b, sc, st, mh, { top: st - 0.0058 * k, edge: st - 0.0016 * k, back: 0.0078 * k, enamel: mix3(enamel, shadowed, 0.18), shadowed, ends, gum, side: -1, sMax: mh - 0.006 });
  // Wound by the true facing (the cavity inward: from outside only its far wall renders).
  const mesh = { positions: Float32Array.from(pos), normals: Float32Array.from(nrm), indices: Uint32Array.from(orient(idx, pos, face)) };
  const part = rigidPart("faceInterior", "rubber", mesh, Float32Array.from(col), "head", { castShadow: false, roughness: 0.62 });
  part.receiveShadow = false;
  const side = Int8Array.from(sides);
  const smileWalls = smileWarp(sc);
  part.morphs = [
    target("smile", smileWalls, mesh, { active: (_x, _y, _z, v) => smileOn[v] === 1 }),
    target("laugh", jawWarp(sc), mesh, { side, active: () => true }),
  ];
  return part;
}

/** Upper half of an ellipsoid (outward normals); `color(u)` by front-back position (−1..1). */
function dome(b: InteriorBuilder, c: V3, r: V3, color: (u: number) => RGB, side: number) {
  const NU = 12, NV = 5;
  let first = -1;
  for (let j = 0; j <= NV; j += 1) {
    const v = (Math.PI / 2) * (j / NV);
    for (let i = 0; i <= NU; i += 1) {
      const u = -Math.PI / 2 + (Math.PI * i) / NU;
      const d: V3 = [Math.cos(v) * Math.sin(u), Math.sin(v), Math.cos(v) * Math.cos(u)];
      // Shading leans out through the mouth like the cavity's (see there); wound by its true outside.
      const out: V3 = [d[0] / r[0], d[1] / r[1], d[2] / r[2]];
      const ol = Math.hypot(out[0], out[1], out[2]) || 1;
      const n: V3 = [0.3 * out[0] / ol, 0.3 * out[1] / ol + 0.5, 0.3 * out[2] / ol + 1];
      const nl = Math.hypot(n[0], n[1], n[2]) || 1;
      const q = b.push([c[0] + r[0] * d[0], c[1] + r[1] * d[1], c[2] + r[2] * d[2]], [n[0] / nl, n[1] / nl, n[2] / nl], color(d[2]), side, false, out);
      if (first < 0) first = q;
    }
  }
  for (let j = 0; j < NV; j += 1) {
    for (let i = 0; i < NU; i += 1) {
      const a = first + j * (NU + 1) + i, bb = a + 1, cc = a + NU + 1, d = cc + 1;
      b.idx.push(a, bb, cc, bb, d, cc);
    }
  }
}

/** A curved band of teeth along the dental arch from `top` (gum line) to `edge` (incisal edge). */
function teeth(
  b: InteriorBuilder,
  sc: HeadSculpt,
  st: number,
  mh: number,
  o: { top: number; edge: number; back: number; enamel: RGB; shadowed: RGB; ends: RGB; gum: RGB; side: number; sMax: number },
) {
  const k = sc.k;
  const TS = 16, TV = 4;
  let first = -1;
  for (let i = 0; i <= TS; i += 1) {
    const u = -1 + (2 * i) / TS;
    const sx = u * o.sMax * k;
    const z0 = frontZ(sc, sx, st) - o.back - 0.004 * k * u * u;
    const dz = (frontZ(sc, sx + 0.001, st) - frontZ(sc, sx - 0.001, st)) / 0.002;
    const nl = Math.hypot(-dz, 1) || 1;
    const n: V3 = [-dz / nl, 0, 1 / nl];
    // Toward the ends the row narrows (rounded, not square-ended) and recedes into the cavity.
    const endW = sstep(0.62, 1, Math.abs(u));
    const mid = 0.5 * (o.top + o.edge);
    for (let j = 0; j <= TV; j += 1) {
      const f = j / TV;
      const y = mid + (o.top + (o.edge - o.top) * f - mid) * (1 - 0.55 * endW);
      // Never closer than 3 mm to the skin at this height (below the lower lip the face falls
      // back into the sulcus, and the gum line poked through it).
      const z = Math.min(z0, frontZ(sc, sx, y) - 0.003 * k);
      // The incisal edge is the brightest; the sides and the root end recede into shade; a dark
      // seam between neighbouring teeth.
      const seam = 1 - 0.35 * Math.pow(Math.abs(Math.cos(u * Math.PI * 3.5)), 24);
      const lit = sstep(0.85, 0.25, Math.abs(u)) * (0.3 + 0.7 * sstep(0.15, 1, f)) * seam;
      const c = mix3(f < 0.12 ? mix3(o.gum, o.shadowed, 0.4) : mix3(o.shadowed, o.enamel, lit), o.ends, endW);
      const q = b.push([sx, y + 0.0004 * k * Math.cos(u * Math.PI * 3.5) * f * (o.side > 0 ? 1 : -1), z], n, c, o.side, false);
      if (first < 0) first = q;
    }
  }
  for (let i = 0; i < TS; i += 1) {
    for (let j = 0; j < TV; j += 1) {
      const a = first + i * (TV + 1) + j, bb = a + 1, cc = a + TV + 1, d = cc + 1;
      b.idx.push(a, bb, cc, bb, d, cc);
    }
  }
}

/** Flips triangles whose winding disagrees with their vertex normals. */
function orient(index: number[], p: number[], n: number[]) {
  const out = index.slice();
  for (let t = 0; t < out.length; t += 3) {
    const a = out[t] * 3, b = out[t + 1] * 3, c = out[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    if (gx * (n[a] + n[b] + n[c]) + gy * (n[a + 1] + n[b + 1] + n[c + 1]) + gz * (n[a + 2] + n[b + 2] + n[c + 2]) < 0) {
      const tmp = out[t + 1];
      out[t + 1] = out[t + 2];
      out[t + 2] = tmp;
    }
  }
  return out;
}
