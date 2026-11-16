/**
 * Head, face and neck-top (worker-safe). OWNER: faces agent (was character-details).
 *
 * One rigid `head` part on the head bone (head-local positions), polygonised in one piece from
 * the sculpt in `details/headSculpt.ts` (no patch seams), with scalp buried under the hair removed,
 * baked occlusion (head + eyeball proxies) and painted skin registered to the face heightfield:
 * base tone with soft mottling, flush on cheeks/nose/ears, vermilion with a defined border and
 * a darker upper lip, mouth line and corners, lid crease and inner corners, brow shadow,
 * nostrils, hairline density and Leo's stubble. Expression morphs (`details/expression.ts`)
 * ride on the same mesh. Eyes, lids, brows and lashes are returned as `FaceFeatures` for the
 * main-thread face rig (`faceRig.ts`).
 */
import type { RawMesh, V3 } from "../sdf/api";
import * as S from "../sdf/index";
import type { BindPose } from "../rig/skeleton";
import { fbm3, noise3 } from "../math";
import type { CharacterSpec, FaceFeatures, MeshPart } from "./types";
import { applyOcclusion, blob, cullHiddenVertices, cutAlongCurve, decimateRegion, lin, mix3, paintMesh, projectVertices, relaxOnSdf, rigidPart, smax, sstep, type RGB } from "./details/kit";
import { sculptHead, type HeadSculpt } from "./details/headSculpt";
import { apertureAngularDistance, eyeAngles, eyeDir, lowerMargin, upperMargin } from "./details/eyeShape";
import { hairCoverage } from "./details/hairShape";
import { buildExpressionMorphs, buildMouthPart, cutLips, type LipTags } from "./details/expression";
import { buildBrows, type BrowShape } from "./details/brows";
import { beardMap, buildBeard } from "./hair";

/** Surface Nets cell for the whole visible head (meters, at the 1.80 m reference head). */
export const FACE_CELL = 0.0037;
/** Kept for callers that size other parts from it (the old coarse scalp cell). */
export const HEAD_CELL = 0.0064;
/**
 * The head part's neck stub ends this far below the head joint (meters at the 1.80 m reference;
 * scaled with the head). The stub sits inside the body's neck column, which provides the visible
 * neck up to where it enters the jaw and skull.
 */
export const NECK_CUT = -0.014;
/** Above this height over the eyes every hairstyle covers the scalp: not meshed at all. */
const TOP_T = 0.079;

/** Returns rigid parts attached to the `head` bone (positions head-bone-local) and face feature anchors. */
export function buildHead(spec: CharacterSpec, bind: BindPose): { parts: MeshPart[]; face: FaceFeatures } {
  const sculpt = sculptHead(spec, bind);
  const k = sculpt.k;
  const cs = Math.min(1, k + 0.04);
  const cover = hairCoverage(spec, bind);
  const beard = spec.facialHair?.style === "beard" ? beardMap(spec, bind) : null;
  const neckCut = NECK_CUT * k;
  // Never visible: scalp buried under the hair shell or beard, and the neck stub's lower end
  // inside the body's neck.
  const beardDepth = 0.003 * k;
  // Inside the body's neck column (with margin) the neck surface covers the head's stub.
  const neckD = sculpt.neckColumn.d, neckMargin = -0.0025 * k;
  const hidden = (x: number, y: number, z: number) =>
    y < neckCut || neckD(x, y, z) < neckMargin || cover.buried(x, y, z) || (beard !== null && beard.buried(x, y, z, beardDepth));
  const b = sculpt.sdf.bounds;
  const top = (sculpt.field.L.ye + TOP_T) * k;
  const bounds = { min: [b.min[0], Math.max(b.min[1], neckCut - 0.01 * k), b.min[2]] as V3, max: [b.max[0], Math.min(b.max[1], top), b.max[2]] as V3 };
  // Grid normals first (free), cull what the hair/beard/neck hide (by vertex, so a hole never pokes
  // past the layer covering it), then relax and take SDF normals on the visible vertices only
  // (most of the cost of a fine mesh is spent there).
  const grid = S.sampleSdf(sculpt.sdf, { cell: FACE_CELL * cs, bounds, padding: 0 });
  // Behind the ears (and below the hair) the skull is a smooth, slowly curving surface meshed at
  // the face's fine cell: decimated there to under half, welded to the rest (one mesh, no seam).
  const backZ = (sculpt.anchors.ear[2] - 0.034) * k;
  const relaxed = decimateRegion(
    relaxOnSdf(cullHiddenVertices(S.surfaceNets(grid), hidden), sculpt.sdf, 1),
    (_x, _y, z) => z < backZ,
    0.42,
    0.985,
  );
  // Lip cuts only append vertices, so the socket mask stays valid for the final mesh.
  const { mesh: windowed, socket } = cutEyeWindows(sculpt, relaxed);
  // The lips are cut along the vermilion borders (crisp lip colour) and apart along the mouth
  // line (so the laugh can open them).
  const { mesh, tags } = cutLips(sculpt, windowed);
  // The cut vertices sit on edge chords: put them on the surface (the mouth-line crease).
  projectVertices(mesh, sculpt.sdf, windowed.positions.length / 3);
  const occluder = S.union(sculpt.sdf, sculpt.eyeProxy);
  const aoOptions = { steps: 3, stepSize: 0.0026 * k, strength: 1 };
  const occlusion = { strength: 0.8, gamma: 1.2, tint: skinOcclusionTint(spec) };
  const ao = S.bakeAO(mesh, occluder, aoOptions);
  const painter = headPainter(spec, sculpt, cover, beard ? beard.regionDistance : null, tags, socket);
  const colors = paintMesh(mesh, painter);
  applyOcclusion(colors, ao, occlusion);
  const part = rigidPart("head", "skin", mesh, colors, "head");
  part.morphs = buildExpressionMorphs(sculpt, mesh, tags.mouth, { colors, flush: spec.skin.flush });
  // Brows and beard: hair layers on the skin whose edges take this same skin paint and occlusion.
  const px = new Float64Array(3);
  const skinPaint = (x: number, y: number, z: number, nx: number, ny: number, nz: number): RGB => {
    painter(px, x, y, z, nx, ny, nz, -1);
    return [px[0], px[1], px[2]];
  };
  const brows = buildBrows(spec, sculpt, browShape(spec, sculpt), skinPaint);
  applyOcclusion(brows.part.colors, S.bakeAO(brows.mesh, occluder, aoOptions), occlusion);
  brows.part.morphs = buildExpressionMorphs(sculpt, brows.mesh);
  const parts = [part, buildMouthPart(sculpt, spec.skin.shade), brows.part];
  if (beard) {
    const layer = buildBeard(spec, bind, skinPaint);
    applyOcclusion(layer.part.colors, S.bakeAO(layer.mesh, S.union(occluder, sculpt.neckColumn), aoOptions), occlusion);
    parts.push(layer.part);
  }
  return { parts, face: faceFeatures(spec, sculpt) };
}

/** Brow line and heights (full height at the head, body and tail): fuller on the men. */
function browShape(spec: CharacterSpec, sculpt: HeadSculpt): BrowShape {
  const br = spec.face.browRidge;
  const height: [number, number, number] = sculpt.female ? [0.0058, 0.0052, 0.0018] : [0.0084 + 0.002 * br, 0.0074 + 0.002 * br, 0.0028];
  return { line: sculpt.anchors.browLine, height };
}

/**
 * Opens the eye windows: the lid mound covers each eye completely in the sculpt; here the mesh is
 * cut exactly along the shared almond grown past the lid margins (a smooth, crisp edge; a step in
 * the field itself aliased into shards at this resolution). The skin inside is pushed straight
 * back into a socket behind the eyeball, joined to the edge by a wall along the cut, so the face
 * rig's lid shells and eyeball sit in a closed, dark pocket: no grazing view ever sees through.
 */
function cutEyeWindows(sculpt: HeadSculpt, mesh: RawMesh): { mesh: RawMesh; socket: Uint8Array } {
  const k = sculpt.k;
  const [ex, ey, ez] = sculpt.anchors.eye;
  const ap = sculpt.anchors.aperture, grow = sculpt.field.windowGrow;
  // Only the lid mound itself (a shell just outside the eyeball) is windowed: further out, the
  // same angles from the eye centre point at the nose, cheek and brow. The window is the grown
  // almond cone clipped by a ball around the mound, joined with a smooth max (a hard max, or a
  // jump at the ball, notched the medial-top corner, where the fold under the brow stands far
  // off the mound and the ball takes over), so its edge is one smooth curve everywhere.
  const lidR = sculpt.field.L.lidR * k;
  const reach = lidR + 0.0032 * k, far2 = (reach + 0.004 * k) ** 2, back = -0.002 * k, round = 0.0016 * k;
  const windowAt = (x: number, y: number, z: number) => {
    const lx = Math.abs(x) - ex, ly = y - ey, lz = z - ez;
    const r2 = lx * lx + ly * ly + lz * lz;
    if (lz < back || r2 > far2) return 1;
    const r = Math.sqrt(r2);
    const [th, ph] = eyeAngles(lx, ly, lz);
    return smax(apertureAngularDistance(ap, th, ph, grow) * r, r - reach, round);
  };
  const P0 = mesh.positions;
  const near = (v: number) => {
    const lx = Math.abs(P0[v * 3]) - ex, ly = P0[v * 3 + 1] - ey, lz = P0[v * 3 + 2] - ez;
    return lz > back && lx * lx + ly * ly + lz * lz < far2;
  };
  const cut = cutAlongCurve(mesh, (v) => windowAt(P0[v * 3], P0[v * 3 + 1], P0[v * 3 + 2]), (a, b, c) => near(a) || near(b) || near(c), []);
  const P = cut.mesh.positions, N = cut.mesh.normals, sign = cut.sign;
  // Inside: straight back to the socket floor, facing out of the socket.
  const floor = ez - SOCKET_DEPTH * k;
  const socket = new Uint8Array(sign.length);
  for (let v = 0; v < sign.length; v += 1) {
    if (sign[v] > 0) continue;
    P[v * 3 + 2] = floor;
    N[v * 3] = 0; N[v * 3 + 1] = 0; N[v * 3 + 2] = 1;
    socket[v] = 1;
  }
  // Walls: one quad per cut segment, wound to face the opening's axis.
  const seg = cut.segments, I0 = cut.mesh.indices;
  const indices = new Uint32Array(I0.length + (seg.length / 4) * 6);
  indices.set(I0);
  let o = I0.length;
  for (let q = 0; q < seg.length; q += 4) {
    const p0 = seg[q], p1 = seg[q + 1], n0 = seg[q + 2], n1 = seg[q + 3];
    const ax = P[p1 * 3] - P[p0 * 3], ay = P[p1 * 3 + 1] - P[p0 * 3 + 1], az = P[p1 * 3 + 2] - P[p0 * 3 + 2];
    const bx = P[n1 * 3] - P[p0 * 3], by = P[n1 * 3 + 1] - P[p0 * 3 + 1], bz = P[n1 * 3 + 2] - P[p0 * 3 + 2];
    const gx = ay * bz - az * by, gy = az * bx - ax * bz;
    const cx = (x: number) => (x < 0 ? -ex : ex);
    const tx = cx(P[p0 * 3]) - P[p0 * 3], ty = ey - P[p0 * 3 + 1];
    if (gx * tx + gy * ty >= 0) {
      indices[o++] = p0; indices[o++] = p1; indices[o++] = n1;
      indices[o++] = p0; indices[o++] = n1; indices[o++] = n0;
    } else {
      indices[o++] = p0; indices[o++] = n1; indices[o++] = p1;
      indices[o++] = p0; indices[o++] = n0; indices[o++] = n1;
    }
  }
  return { mesh: { positions: P, normals: N, indices: indices.slice(0, o) }, socket };
}

/** How far behind the eyeball centre the socket floor sits (metres at the reference head). */
const SOCKET_DEPTH = 0.007;

/** Occluded skin keeps a warm, saturated undertone instead of going grey (subsurface look). */
export function skinOcclusionTint(spec: CharacterSpec): RGB {
  const base = lin(spec.skin.base);
  const l = Math.max(1e-4, 0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2]);
  // Shadows lean to the skin's own hue, deeper for lighter skin.
  return [Math.min(0.62, 0.36 * (base[0] / l) ** 0.5), Math.min(0.5, 0.25 * (base[1] / l) ** 0.5), Math.min(0.46, 0.22 * (base[2] / l) ** 0.5)];
}

type Painter = (out: Float64Array, x: number, y: number, z: number, nx: number, ny: number, nz: number, i: number) => void;

function headPainter(
  spec: CharacterSpec,
  sculpt: HeadSculpt,
  cover: ReturnType<typeof hairCoverage>,
  beardEdge: ((x: number, y: number, z: number) => number) | null,
  tags: LipTags,
  socket: Uint8Array,
): Painter {
  const a = sculpt.anchors;
  const f = sculpt.field;
  const L = f.L, M = f.mouth;
  const k = sculpt.k, ik = 1 / k;
  const base = lin(spec.skin.base);
  const flush = lin(spec.skin.flush);
  const shade = lin(spec.skin.shade);
  const hair = lin(spec.hair.color);
  const female = sculpt.female;
  const dark: RGB = [base[0] * 0.7, base[1] * 0.7, base[2] * 0.7];
  const warm = mix3(base, flush, 0.2);
  // Lips: the flush hue, deeper and a little cooler than the skin; the upper lip (facing down)
  // reads darker than the fuller lower lip. Darker skin keeps more of its own tone.
  const lum = 0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2];
  const deep = lum < 0.08;
  // The men's lips sit much closer to the skin (a saturated, crisp band read as lipstick).
  const lipBase0 = mix3(mix3(flush, shade, 0.42), [flush[0] * 0.92, flush[1] * 0.5, flush[2] * 0.56], female ? 0.6 : 0.3);
  const lipBase = female ? lipBase0 : mix3(lipBase0, warm, 0.4);
  const lipUpper = deep ? mix3(lipBase, shade, 0.35) : mix3(lipBase, shade, 0.18);
  const lipLower = deep ? mix3(lipBase, [flush[0] * 1.15, flush[1] * 0.95, flush[2] * 0.95], 0.35) : mix3(lipBase, flush, 0.18);
  /** Share of the cut's crisp border in the lip paint (the men's borders blur over ~1 mm). */
  const crispShare = female ? 1 : 0.45;
  const lineColor = mix3(shade, [0.02, 0.01, 0.01], 0.6);
  const stubble = spec.facialHair?.style === "stubble" ? lin(spec.facialHair.color) : null;

  const seed = spec.seed;
  const [ex, ey, ez] = a.eye;
  const ap = a.aperture;
  const lidTone = mix3(mix3(base, flush, 0.35), shade, 0.25);
  const mh = L.mouthHalf;
  const noseTipY = L.tTip, nosTipZ = L.zTip;
  const neckD = sculpt.neckColumn.d;

  return (out, x, y, z, _nx, ny, _nz, i) => {
    const ax = Math.abs(x);
    const s = ax * ik, t = y * ik - L.ye, zr = z * ik;
    // Base tone with faint low-frequency mottling (keeps large planes from looking plastic).
    // The same warm base the body paint uses (skin tone ~20% toward flush), so face and neck match.
    const n = fbm3(x * 38, y * 38, z * 38, 3, seed) * 0.045 + noise3(x * 160, y * 160, z * 160, seed + 3) * 0.01;
    let c: RGB = [warm[0] * (1 + n), warm[1] * (1 + n * 0.9), warm[2] * (1 + n * 0.8)];

    // Flush: cheek apples, nose (tip + alae), ears, chin, a hint across the brow.
    const dc = (s - L.cheekS) ** 2 + ((t - L.cheekT) * 0.8) ** 2;
    const dn = (s * 0.8) ** 2 + (t - noseTipY + 0.004) ** 2 + ((zr - nosTipZ) * 0.5) ** 2;
    const de = (ax - a.ear[0]) ** 2 + (y - a.ear[1]) ** 2 + (z - a.ear[2]) ** 2;
    const dch = s * s + (t - L.tCh) ** 2;
    const onEar = sstep(a.ear[0] - 0.008 * k, a.ear[0] + 0.002 * k, ax);
    const fl = 0.32 * blob(dc, 0.019) + 0.34 * blob(dn, 0.012) + 0.45 * blob(de, 0.03 * k) * onEar + 0.12 * blob(dch, 0.014) + 0.06 * blob((t - 0.03) ** 2, 0.01);
    c = mix3(c, flush, Math.min(0.6, fl));

    // Eye region, in the almond's own angular frame: warmer upper-lid skin up to the crease, a
    // dark lash-line shadow on the upper margin, a warm inner corner and a soft under-eye shade.
    const lx = ax - ex, ly = y - ey, lz = z - ez;
    const rho = Math.sqrt(lx * lx + ly * ly + lz * lz);
    // The socket behind the eye opening (pushed back by `cutEyeWindows`): a shadowed skin tone,
    // not black — its walls show a little past the lid shells at the outer corners at grazing
    // angles, where a near-black (or caruncle-red) pocket printed a dot under the eye.
    if (i < socket.length && socket[i]) {
      const medial = sstep(0.004 * k, -0.01 * k, lx);
      const pocket = mix3([shade[0] * 0.3, shade[1] * 0.26, shade[2] * 0.25], [shade[0] * 0.42, shade[1] * 0.3, shade[2] * 0.28], 0.4 * medial);
      out[0] = pocket[0]; out[1] = pocket[1]; out[2] = pocket[2];
      return;
    }
    if (rho < 0.032 * k && lz > -0.004 * k) {
      // The head skin starts where it folds over the shell band (`windowGrow` past the margin).
      const [th, ph] = eyeAngles(lx, ly, lz);
      const ang = apertureAngularDistance(ap, th, ph);
      const g = f.windowGrow;
      // Upper vs lower weight blends smoothly across the eye's mid-line and fades past the
      // corners, so no paint seam runs out of the canthi.
      const mid = 0.5 * (upperMargin(ap, th) + lowerMargin(ap, th));
      const wu = sstep(-0.1, 0.1, ph - mid);
      const sideFade = sstep(0.35, 0.05, Math.max(ap.medial - th, th - ap.lateral));
      c = mix3(c, lidTone, 0.32 * wu * sideFade * sstep(g.up + 0.32, g.up + 0.02, ang));
      c = mix3(c, mix3(shade, flush, 0.2), 0.32 * wu * sideFade * Math.exp(-(((ang - g.up - 0.015) / 0.04) ** 2)));
      c = mix3(c, mix3(shade, flush, 0.3), 0.2 * (1 - wu) * sideFade * Math.exp(-(((ang - g.down - 0.01) / 0.04) ** 2)));
      c = mix3(c, mix3(shade, flush, 0.25), 0.1 * (1 - wu) * sideFade * Math.exp(-(((ang - 0.25) / 0.12) ** 2)));
      const medialDir = eyeDir(ap.medial, ap.cornerMedial);
      const dm = (lx - medialDir[0] * a.eyeRadius) ** 2 + (ly - medialDir[1] * a.eyeRadius) ** 2 + (lz - medialDir[2] * a.eyeRadius) ** 2;
      c = mix3(c, mix3(flush, shade, 0.4), 0.45 * blob(dm, 0.004 * k));
    }

    // Brow-ridge shadow: a soft halo of fine hairs and shade where the brows sit (the brow layer
    // itself is drawn on top, from this same paint).
    const browT = Math.min(1, Math.max(0, (ax - a.browLine[0][0]) / (a.browLine[4][0] - a.browLine[0][0])));
    const browY = browLineY(a.browLine, ax);
    if (ax < a.browLine[4][0] + 0.006 * k && ax > a.browLine[0][0] - 0.006 * k && z > ez) {
      const db = (y - browY) / ((0.0056 - 0.0018 * browT) * k);
      c = mix3(c, mix3(dark, hair, 0.35), 0.2 * Math.exp(-db * db) * (1 - 0.4 * browT));
    }

    // Lips, registered to the sculpt's mouth curves. The mesh is cut along both vermilion borders
    // and the mouth line, so the vertices on them carry which side they belong to and the colour
    // changes exactly there (no sawtooth from per-vertex paint). The corners fade softly.
    if (s < mh + 0.006 && t < L.tSub && t > L.tMl && zr > L.za + 0.06) {
      const sc = Math.min(s, mh);
      const st = M.stomion(sc), ub = M.upperBorder(sc), lb = M.lowerBorder(sc);
      const dU = tags.upper[i] !== 0 ? tags.upper[i] : t > ub ? 1 : -1;
      const dL = tags.lower[i] !== 0 ? tags.lower[i] : t > lb ? 1 : -1;
      const dM = tags.mouth[i] !== 0 ? tags.mouth[i] : t > st ? 1 : -1;
      // Near the corners (past the border cuts) a soft weight takes over.
      const corner = 1 - sstep(mh - 0.0045, mh + 0.001, s);
      const softU = 1 - sstep(ub - 0.0012, ub + 0.0012, t), softL = sstep(lb - 0.0015, lb + 0.0015, t);
      const hardU = dU < 0 ? 1 : 0, hardL = dL > 0 ? 1 : 0;
      const crisp = (1 - sstep(mh - 0.006, mh - 0.0035, s)) * crispShare;
      const inU = (hardU * crisp + softU * (1 - crisp)) * corner;
      const inL = (hardL * crisp + softL * (1 - crisp)) * corner;
      if (dM > 0) c = mix3(c, lipUpper, 0.9 * inU);
      else c = mix3(c, lipLower, 0.88 * inL);
      // White roll: a faint light band on the skin just above the upper border.
      if (dU > 0) c = mix3(c, [c[0] * 1.12, c[1] * 1.1, c[2] * 1.08], 0.6 * Math.exp(-(((t - ub) / 0.0016) ** 2)) * crisp);
      // The parting: darkest on the cut itself, the upper lip shading into it.
      const line = tags.mouth[i] !== 0 ? 1 : Math.exp(-(((t - st) / (t > st ? 0.0022 : 0.0016)) ** 2));
      c = mix3(c, lineColor, 0.5 * line * (1 - sstep(mh - 0.001, mh + 0.004, s)));
      c = mix3(c, shade, 0.3 * Math.exp(-(((s - mh) / 0.0028) ** 2 + ((t - st) / 0.0035) ** 2)));
    }

    // Nostrils: dark in the dimples under the lobule (only where the surface faces down).
    const qn = ((s - (L.alaS * 0.5 + 0.0008)) / 0.0036) ** 2 + ((t - (L.tSub + 0.0032)) / 0.0024) ** 2;
    if (qn < 1.6 && ny < 0.2) c = mix3(c, mix3(shade, [0.03, 0.015, 0.012], 0.55), 0.85 * sstep(1.4, 0.5, qn) * sstep(0.2, -0.35, ny));

    // Distance (ref m) below the under-jaw plane: 0 on the jawline, growing toward the neck.
    const belowJaw = L.tM + (L.zM - zr) * L.jawSlope - t;
    // Leo: stubble shadow over jaw, chin, upper lip and lower cheeks, ending just under the
    // jawline (on the neck it read as dirt from the low walk lens). A fine, low-contrast speckle.
    if (stubble) {
      const cheekLine = L.cheekT - 0.008 - 0.3 * (s - 0.02);
      let w = sstep(cheekLine + 0.004, cheekLine - 0.008, t) * (1 - sstep(0.002, 0.011, belowJaw)) * (zr > -0.02 ? 1 : sstep(-0.045, -0.02, zr));
      // Keep the lips clear (with a soft edge) and thin it on the upper lip skin.
      const inLips = s < mh + 0.002 && t < M.upperBorder(Math.min(s, mh)) + 0.0012 && t > M.lowerBorder(Math.min(s, mh)) - 0.0015;
      if (inLips) w = 0;
      const speck = 0.9 + 0.1 * noise3(x * 420, y * 420, z * 420, seed + 11);
      const shadowTone: RGB = [c[0] * 0.76, c[1] * 0.76, c[2] * 0.81];
      c = mix3(c, mix3(shadowTone, stubble, 0.16), 0.38 * w * speck);
    }

    // Dre: a short-stubble shadow ~1 cm wide just outside the groomed beard edges ties the beard
    // into the skin (no pasted-on look); speckled so it reads as hair, not a painted band.
    if (beardEdge) {
      const d = beardEdge(x, y, z);
      if (d < 0.003 * k && d > -0.011 * k) {
        const speck = 0.8 + 0.2 * noise3(x * 300, y * 300, z * 300, seed + 13);
        c = mix3(c, [c[0] * 0.7, c[1] * 0.68, c[2] * 0.68], 0.55 * speck * sstep(-0.011 * k, 0, d) ** 1.4);
      }
    }

    // Under the jaw the skin sees little sky (the jaw above, the chest below): a soft, warm
    // occlusion just under the jawline that fades out before the junction with the body's neck
    // (a full-strength band read as the edge of a mask from the low walk lens). The studio light
    // shapes the jaw.
    if (t < L.tSt && ny < 0.15) {
      const under = sstep(0.15, -0.75, ny) * sstep(L.tSt, L.tM + 0.004, t) * sstep(-0.002, 0.004, belowJaw) * (1 - sstep(0.008, 0.022, belowJaw)) * sstep(0.001 * k, 0.008 * k, neckD(x, y, z));
      c = mix3(c, [c[0] * 0.7, c[1] * 0.64, c[2] * 0.63], 0.32 * under);
    }

    // Hairline density gradient (and Dre's skin fade) painted onto the scalp skin.
    if (y > -0.01 * k) {
      const h = cover.paint(x, y, z);
      if (h > 0.002) c = mix3(c, mix3(c, hair, 0.82), h);
    }

    out[0] = c[0];
    out[1] = c[1];
    out[2] = c[2];
  };
}

function browLineY(line: V3[], ax: number) {
  for (let i = 0; i < line.length - 1; i += 1) {
    const a = line[i], b = line[i + 1];
    if (ax <= b[0] || i === line.length - 2) {
      const t = Math.min(1, Math.max(0, (ax - a[0]) / (b[0] - a[0])));
      const s = t * t * (3 - 2 * t);
      return a[1] + (b[1] - a[1]) * s;
    }
  }
  return line[0][1];
}

/** Linear RGB → sRGB hex. */
export function linearToHex(c: RGB): number {
  const f = (v: number) => {
    const x = Math.min(1, Math.max(0, v));
    const s = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    return Math.round(s * 255);
  };
  return (f(c[0]) << 16) | (f(c[1]) << 8) | f(c[2]);
}

function faceFeatures(spec: CharacterSpec, sculpt: HeadSculpt): FaceFeatures {
  const a = sculpt.anchors;
  const k = sculpt.k;
  const ap = a.aperture;
  const lidOuter = a.eyeRadius + 0.002 * k;
  const base = lin(spec.skin.base);
  // Lid skin a touch warmer and deeper than the face; the crease occlusion is applied by the face
  // rig's lid material (in the socket frame, so it follows blinks).
  const lid = mix3(mix3(base, lin(spec.skin.flush), 0.25), lin(spec.skin.shade), 0.16);
  const lidHex = linearToHex(lid);
  const lashHex = 0x120d0b;
  const tilt = ap.cornerLateral - ap.cornerMedial;

  // Upper lash line along the open lid margin (lid shell outer radius), medial → lateral.
  const lashPts: V3[] = [];
  const steps = 9;
  for (let i = 0; i < steps; i += 1) {
    const t = i / (steps - 1);
    const theta = ap.medial + 0.05 + (ap.lateral - ap.medial - 0.07) * t;
    const phi = upperMargin(ap, theta) - 0.02;
    const d = eyeDir(theta, phi);
    const r = lidOuter + 0.0002 * k;
    lashPts.push([a.eye[0] + d[0] * r, a.eye[1] + d[1] * r, a.eye[2] + d[2] * r]);
  }
  const mirror = (pts: V3[]): V3[] => pts.map((p) => [-p[0], p[1], p[2]]);
  const eyeR: V3 = [-a.eye[0], a.eye[1], a.eye[2]];
  // The upper lash line defines the eye at a distance; on the men a fine one (a heavy dark line
  // read as eyeliner).
  const lashRadius = (sculpt.female ? 0.00092 : 0.0005) * k;
  const window = { up: sculpt.field.windowGrow.up, down: sculpt.field.windowGrow.down };

  return {
    eyes: [
      { side: "L", center: a.eye, radius: a.eyeRadius, irisColor: spec.face.irisColor },
      { side: "R", center: eyeR, radius: a.eyeRadius, irisColor: spec.face.irisColor },
    ],
    lids: [
      { side: "L", center: a.eye, radius: lidOuter, openAngle: ap.upper, tilt, color: lidHex, window },
      { side: "R", center: eyeR, radius: lidOuter, openAngle: ap.upper, tilt, color: lidHex, window },
    ],
    // Brows are a head part (`details/brows.ts`), not face-rig geometry.
    brows: [],
    lashes: [
      { side: "L", points: lashPts, radius: lashRadius, color: lashHex },
      { side: "R", points: mirror(lashPts), radius: lashRadius, color: lashHex },
    ],
  };
}
