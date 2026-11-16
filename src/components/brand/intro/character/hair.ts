/**
 * Hair, facial hair and the ponytail (worker-safe). OWNER: character-details agent.
 *
 * - `hair` (rigid on `head`): a shell over the scalp from the hairline map in
 *   `details/hairShape.ts`, with style texture sculpted into it — Maya: combed-back strand grooves
 *   converging on the ponytail root; Leo: short forward-swept tufts; Dre: tight coils on top with
 *   a crisp line-up and a skin fade (the fade itself is painted on the scalp by `head.ts`).
 *   Faces buried in the skull are culled.
 * - `ponytail` (Maya, skinned to head/pony1..pony4): a tapered, gently waving tail of twisted
 *   clumps gathered at the tie, weighted along the chain so the spring sim bends it smoothly.
 * - `beard` (Dre, rigid on `head`): full groomed beard + moustache, a radial heightfield over the
 *   face with a thin lip that dips under the skin at the edge (a smooth edge curve), paint fading
 *   the density over the outer millimetres; rides the expression morphs.
 * Paint: base colour with highlight streaks along the flow, darker roots and grooves, baked
 * occlusion against head + hair.
 */
import type { RawMesh, Sdf, V3 } from "../sdf/api";
import * as S from "../sdf/index";
import { BONE_INDEX, pointOf, type BindPose, type BoneName } from "../rig/skeleton";
import { fbm3, noise1, noise3 } from "../math";
import type { CharacterSpec, MeshPart } from "./types";
import { applyOcclusion, cullInside, cutAlongCurve, lin, mix3, paintMesh, resampleCatmull, rigidPart, skinnedPart, sstep, type RGB } from "./details/kit";
import { sculptHead, type HeadSculpt } from "./details/headSculpt";
import { craniumWithHair, hairAngles, hairMap, hairShell } from "./details/hairShape";
import { buildExpressionMorphs } from "./details/expression";
import { decimate } from "./details/decimate";

/** Surface Nets cell for hair shells (meters, at the 1.80 m reference head). */
export const HAIR_CELL = 0.0047;

/**
 * Rigid cap hair on `head` plus, for ponytails, a part skinned to `head`/`pony1..4`. (The beard is
 * built with the head, `buildBeard`, because its edge takes the head's own skin paint.)
 */
export function buildHair(spec: CharacterSpec, bind: BindPose): MeshPart[] {
  const parts: MeshPart[] = [cap(spec, bind)];
  if (spec.hair.style === "ponytail") parts.push(ponytail(spec, bind));
  return parts;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

// ---------------------------------------------------------------------------------------------
// Cap

function capTexture(spec: CharacterSpec, bind: BindPose, sculpt: HeadSculpt) {
  const k = sculpt.k;
  const seed = spec.seed;
  if (spec.hair.style === "ponytail") {
    // Combed-back grooves: angle around the axis from in front of the forehead to the ponytail
    // root, so every groove runs from the hairline back into the tie.
    const headJ = pointOf(bind, "head");
    const root = sub(pointOf(bind, "pony1"), headJ);
    const f0: V3 = [0, 0.165 * k, 0.15 * k];
    const ax = S.normalize(sub(root, f0));
    const e1: V3 = [1, 0, 0];
    const e2 = S.cross(ax, e1);
    const N = 46;
    const amp = 0.00045 * k;
    const fn = (x: number, y: number, z: number) => {
      const wx = x - f0[0], wy = y - f0[1], wz = z - f0[2];
      const along = wx * ax[0] + wy * ax[1] + wz * ax[2];
      const px = wx - ax[0] * along, py = wy - ax[1] * along, pz = wz - ax[2] * along;
      const r = Math.sqrt(px * px + py * py + pz * pz);
      const g = Math.atan2(px * e2[0] + py * e2[1] + pz * e2[2], px);
      const phase = noise1(along * 40, seed) * 0.9;
      const clump = Math.pow(Math.abs(Math.cos(g * N * 0.5 + phase)), 0.7);
      return amp * (clump - 0.55) * sstep(0.012 * k, 0.03 * k, r);
    };
    return { fn, amplitude: amp, slope: 1.3 };
  }
  if (spec.hair.style === "crop") {
    // Short tufts swept forward and up: noise stretched along the flow.
    const amp = 0.0018 * k;
    const fn = (x: number, y: number, z: number) => {
      const n = noise3(x * 190, y * 150, z * 70, seed) * 0.65 + noise3(x * 380, y * 320, z * 160, seed + 5) * 0.35;
      return amp * n;
    };
    return { fn, amplitude: amp, slope: 1.1 };
  }
  // Coils: small round bumps, finer at the sides.
  const amp = 0.0015 * k;
  const fn = (x: number, y: number, z: number) => amp * (noise3(x * 170, y * 170, z * 170, seed) * 0.75 + noise3(x * 330, y * 330, z * 330, seed + 9) * 0.25);
  return { fn, amplitude: amp, slope: 0.9 };
}

function cap(spec: CharacterSpec, bind: BindPose): MeshPart {
  const sculpt = sculptHead(spec, bind);
  const map = hairMap(spec, bind);
  const k = sculpt.k;
  const shell = hairShell(spec, bind, capTexture(spec, bind, sculpt));
  let mesh = S.meshSdf(shell, { cell: HAIR_CELL * Math.min(1, k + 0.04) });
  // The shell's inside includes the skull: drop faces buried in the head.
  mesh = cullInside(mesh, craniumWithHair(spec, bind, 0, false), 0.0016 * k);
  const ao = S.bakeAO(mesh, craniumWithHair(spec, bind), { steps: 4, stepSize: 0.0038 * k });
  const base = lin(spec.hair.color), hi = lin(spec.hair.highlight);
  const seed = spec.seed;
  const fade = spec.hair.style === "fade";
  const colors = paintMesh(mesh, (out, x, y, z, nx, ny) => {
    const [az, beta, r] = hairAngles(map.center, x, y, z);
    const edge = (beta - map.shellLine(az)) * r;
    // Highlight streaks stretched along the flow (front-to-back), plus fine strand variation.
    const streak = fbm3(x * 70, y * 70, z * 18, 3, seed + 21) * 0.5 + 0.5;
    const fine = noise3(x * 420, y * 420, z * 160, seed + 4);
    let c: RGB = mix3(base, hi, Math.min(1, Math.max(0, 0.15 + 0.55 * streak * streak + 0.12 * fine)));
    // Roots darker near the hairline edge; tips catch light where the normal faces up.
    c = mix3(c, [base[0] * 0.75, base[1] * 0.72, base[2] * 0.7], 0.5 * (1 - sstep(0, 0.006 * k, edge)));
    c = mix3(c, hi, 0.12 * Math.max(0, ny) * (fade ? 0.5 : 1));
    void nx;
    out[0] = c[0];
    out[1] = c[1];
    out[2] = c[2];
  });
  applyOcclusion(colors, ao, { strength: 0.9, gamma: 1.15, tint: [0.36, 0.3, 0.27] });
  // Slick hair is glossy; a dry crop and coils are much more matte.
  const roughness = spec.hair.style === "ponytail" ? 0.36 : spec.hair.style === "crop" ? 0.55 : 0.72;
  return rigidPart("hair", "hair", mesh, colors, "head", { roughness });
}

// ---------------------------------------------------------------------------------------------
// Ponytail

const PONY: BoneName[] = ["pony1", "pony2", "pony3", "pony4"];

function ponytail(spec: CharacterSpec, bind: BindPose): MeshPart {
  const sculpt = sculptHead(spec, bind);
  const k = sculpt.k;
  const headJ = pointOf(bind, "head");
  const chain: V3[] = [...PONY.map((n) => pointOf(bind, n)), pointOf(bind, "ponyTip")];
  // Gathered root starts inside the hair cap, aimed at the skull centre.
  const cranium = S.add(headJ, sculpt.anchors.craniumCenter);
  const inward = S.normalize(sub(cranium, chain[0]));
  const rootIn = S.addScaled(chain[0], inward, 0.016 * k);
  const centre = resampleCatmull([rootIn, ...chain], 26);
  // Arc-length parameter of each sample relative to the tie (s = 0 at pony1, 1 at the tip).
  const acc = [0];
  for (let i = 1; i < centre.length; i += 1) acc.push(acc[i - 1] + S.distance(centre[i], centre[i - 1]));
  const tieIndex = centre.reduce((best, p, i) => (S.distance(p, chain[0]) < S.distance(centre[best], chain[0]) ? i : best), 0);
  const total = acc[acc.length - 1] - acc[tieIndex];
  const sOf = (i: number) => (acc[i] - acc[tieIndex]) / total;
  const radius = (s: number) => {
    if (s < 0) return k * (0.0105 + 0.006 * Math.min(1, -s * 6));
    const knots: Array<[number, number]> = [[0, 0.0112], [0.05, 0.016], [0.16, 0.0242], [0.3, 0.0262], [0.5, 0.0236], [0.72, 0.0172], [0.9, 0.0092], [1, 0.003]];
    let j = 0;
    while (j < knots.length - 2 && s > knots[j + 1][0]) j += 1;
    const t = Math.min(1, Math.max(0, (s - knots[j][0]) / (knots[j + 1][0] - knots[j][0])));
    const e = t * t * (3 - 2 * t);
    return k * (knots[j][1] + (knots[j + 1][1] - knots[j][1]) * e);
  };
  // A gentle S-wave sideways and a little fore-aft swell keeps it from looking like a rope.
  const wave = (s: number): V3 => (s <= 0 ? [0, 0, 0] : [0.0055 * k * Math.sin(s * Math.PI * 2.1 + 0.4) * Math.min(1, s * 4), 0, 0.003 * k * Math.sin(s * Math.PI * 1.3)]);
  const pts = centre.map((p, i) => S.add(p, wave(sOf(i))));
  const tubes: Sdf[] = [];
  for (let i = 0; i < pts.length - 1; i += 1) tubes.push(S.roundCone(pts[i], pts[i + 1], radius(sOf(i)) * 0.8, radius(sOf(i + 1)) * 0.8));
  // Three twisted clumps around the core give the tail a hair-like, lumpy cross-section.
  const clumps: Sdf[] = [];
  const CLUMPS = 4;
  for (let c = 0; c < CLUMPS; c += 1) {
    const offs: V3[] = [];
    for (let i = 0; i < pts.length; i += 1) {
      const s = sOf(i);
      if (s < 0) continue;
      const tIdx = Math.min(pts.length - 1, i + 1), tPrev = Math.max(0, i - 1);
      const tan = S.normalize(sub(pts[tIdx], pts[tPrev]));
      const n1 = S.normalize(S.cross(tan, [1, 0, 0]));
      const n2 = S.cross(tan, n1);
      const a = (c / CLUMPS) * Math.PI * 2 + 0.4 + s * Math.PI * 0.35 + noise1(s * 3 + c * 7, spec.seed) * 0.45;
      const r = radius(s) * (0.4 + 0.08 * noise1(s * 5 + c * 3, spec.seed + 1));
      // Wider side to side (n2 ≈ lateral) than front to back (n1): a ponytail spreads flat.
      offs.push(S.add(pts[i], S.add(S.scale(n1, Math.cos(a) * r * 0.75), S.scale(n2, Math.sin(a) * r * 1.25))));
    }
    const seg: Sdf[] = [];
    for (let i = 0; i < offs.length - 1; i += 2) {
      const j = Math.min(offs.length - 1, i + 2);
      const s0 = sOf(tieIndex + i), s1 = sOf(Math.min(pts.length - 1, tieIndex + j));
      seg.push(S.roundCone(offs[i], offs[j], radius(s0) * 0.5, radius(s1) * 0.5));
    }
    clumps.push(S.smoothUnion(0.003 * k, ...seg));
  }
  const tail = S.smoothUnion(0.0042 * k, S.smoothUnion(0.003 * k, ...tubes), ...clumps);

  let mesh = S.meshSdf(tail, { cell: HAIR_CELL * Math.min(1, k + 0.04) });
  // Faces inside the skull or the cap are hidden.
  const headWorld = S.transform(craniumWithHair(spec, bind), { translate: headJ });
  mesh = cullInside(mesh, headWorld, 0.0025 * k);
  const ao = S.bakeAO(mesh, S.union(tail, headWorld), { steps: 4, stepSize: 0.0045 * k });

  // Arc-length position along the bone chain → smooth chain weights.
  const segs = chain.slice(0, -1).map((a, i) => ({ a, b: chain[i + 1] }));
  const count = mesh.positions.length / 3;
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  const uOf = new Float32Array(count);
  const bones: BoneName[] = ["head", ...PONY];
  const centres = [-0.3, 0.5, 1.5, 2.5, 3.5];
  const widths = [0.75, 1, 1, 1, 1];
  for (let v = 0; v < count; v += 1) {
    const p: V3 = [mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]];
    let best = Infinity, u = 0;
    segs.forEach((sg, j) => {
      const ab = sub(sg.b, sg.a);
      const t = Math.min(1, Math.max(0, S.dot(sub(p, sg.a), ab) / S.dot(ab, ab)));
      const q = S.addScaled(sg.a, ab, t);
      const d = S.distance(p, q);
      if (d < best) {
        best = d;
        u = j + t;
      }
    });
    // Points before pony1 (the gathered root) belong to the head.
    if (u === 0) {
      const ab = sub(segs[0].b, segs[0].a);
      u = Math.min(0, S.dot(sub(p, segs[0].a), ab) / S.dot(ab, ab)) * 2;
    }
    uOf[v] = u;
    const w = centres.map((c, i) => Math.max(0, 1 - Math.abs(u - c) / widths[i]));
    if (u >= 3.5) w[4] = 1;
    if (u <= -0.3) w[0] = 1;
    const order = w.map((x, i) => [x, i]).sort((A, B) => B[0] - A[0]);
    const w0 = order[0][0], w1 = order[1][0];
    const sum = w0 + w1 || 1;
    skinIndex[v * 4] = BONE_INDEX[bones[order[0][1]]];
    skinIndex[v * 4 + 1] = BONE_INDEX[bones[order[1][1]]];
    skinIndex[v * 4 + 2] = BONE_INDEX.head;
    skinIndex[v * 4 + 3] = BONE_INDEX.head;
    skinWeight[v * 4] = w0 / sum;
    skinWeight[v * 4 + 1] = w1 / sum;
  }

  const base = lin(spec.hair.color), hi = lin(spec.hair.highlight);
  const seed = spec.seed;
  const colors = paintMesh(mesh, (out, x, y, z, _nx, ny, _nz, i) => {
    const u = uOf[i];
    // Streaks run along the tail: noise sampled across it, stretched along it.
    const streak = fbm3(x * 140, u * 2.2, z * 140, 3, seed + 31) * 0.5 + 0.5;
    let c: RGB = mix3(base, hi, Math.min(1, 0.12 + 0.6 * streak * streak));
    // Ends are a touch lighter and drier; the gathered root darker.
    c = mix3(c, hi, 0.18 * sstep(2.6, 4, u));
    c = mix3(c, [base[0] * 0.7, base[1] * 0.68, base[2] * 0.66], 0.45 * (1 - sstep(-0.2, 0.25, u)));
    c = mix3(c, hi, 0.08 * Math.max(0, ny));
    void y;
    out[0] = c[0];
    out[1] = c[1];
    out[2] = c[2];
  });
  applyOcclusion(colors, ao, { strength: 0.85, gamma: 1.15, tint: [0.36, 0.3, 0.27] });
  return skinnedPart("ponytail", "hair", mesh, colors, { index: skinIndex, weight: skinWeight }, { roughness: 0.4 });
}

// ---------------------------------------------------------------------------------------------
// Beard

/**
 * The beard as a layer over the face (the beard map's radial table, seen from its centre behind
 * the mouth): one grid vertex per table sample, lifted off the skin by the thickness map. The grid
 * is cut exactly along the region's edge (the cut vertices re-projected onto the skin), and the
 * layer melts into the skin there like the brows do: zero thickness, the head's own skin paint
 * and the skin's normal, so no edge of geometry ever shows. The visible beard line is the hair
 * density in the paint: crisp along the lips, a few millimetres soft at the cheek line and
 * neckline, broken up by noise. (An SDF shell meshed by Surface Nets stair-stepped along that
 * edge, and the steps crawled in motion.)
 */
export function buildBeard(
  spec: CharacterSpec,
  bind: BindPose,
  skin: (x: number, y: number, z: number, nx: number, ny: number, nz: number) => RGB,
): { part: MeshPart; mesh: RawMesh } {
  const sculpt = sculptHead(spec, bind);
  const k = sculpt.k;
  const bm = beardMap(spec, bind);
  const seed = spec.seed;
  const { NA, NB, B0, B1, c, radT } = bm;
  const EDGE = bm.edge, REACH = 0.0045 * k;
  const iMax = Math.min(NA - 1, Math.ceil((bm.azMax / Math.PI) * NA));
  const cols = iMax * 2 + 1, rows = NB + 1;
  const idx = new Int32Array(cols * rows).fill(-1);
  // Grid on the skin (table samples are exact surface points), reaching one cell past the edge.
  const pts: number[] = [], insv: number[] = [];
  for (let ci = 0; ci < cols; ci += 1) {
    const i = ci - iMax, ai = Math.abs(i);
    const az = (ai / NA) * Math.PI, sAz = Math.sin(az) * (i < 0 ? -1 : 1), cAz = Math.cos(az);
    for (let j = 0; j < rows; j += 1) {
      const beta = B0 + ((B1 - B0) * j) / NB;
      const rho = radT[ai * (NB + 1) + j];
      const ins = bm.inside(az, beta, rho);
      if (ins < -REACH) continue;
      const cb = Math.cos(beta);
      idx[ci * rows + j] = pts.length / 3;
      pts.push(c[0] + sAz * cb * rho, c[1] + Math.sin(beta) * rho, c[2] + cAz * cb * rho);
      insv.push(ins);
    }
  }
  const tris: number[] = [];
  // Rays under the nose hit the nose or the lip: never span that jump.
  const maxEdge2 = (0.007 * k) ** 2;
  const ok = (a: number, b: number, cc: number) => {
    const e2 = (p: number, q: number) => (pts[p * 3] - pts[q * 3]) ** 2 + (pts[p * 3 + 1] - pts[q * 3 + 1]) ** 2 + (pts[p * 3 + 2] - pts[q * 3 + 2]) ** 2;
    return a >= 0 && b >= 0 && cc >= 0 && e2(a, b) < maxEdge2 && e2(b, cc) < maxEdge2 && e2(a, cc) < maxEdge2;
  };
  for (let ci = 0; ci < cols - 1; ci += 1) {
    for (let j = 0; j < rows - 1; j += 1) {
      const a = idx[ci * rows + j], b = idx[(ci + 1) * rows + j], cc = idx[ci * rows + j + 1], d = idx[(ci + 1) * rows + j + 1];
      // Outward winding: +az columns run toward +x, rows upward.
      if (ok(a, b, d)) tris.push(a, b, d);
      if (ok(a, d, cc)) tris.push(a, d, cc);
    }
  }
  const grid: RawMesh = { positions: Float32Array.from(pts), normals: new Float32Array(pts.length), indices: Uint32Array.from(tris) };
  // The cut puts vertices exactly on the edge, where the layer's height is zero; only the inside
  // is kept (the head mesh under it is culled by vertex, well inside the edge: no gaps).
  const cut = cutAlongCurve(grid, (v) => insv[v], () => true, []);
  const { mesh: inner, kept } = keepSide(cut.mesh, cut.sign);
  const count = inner.positions.length / 3;
  const indices = inner.indices;
  // Per vertex: skin point (cut vertices re-projected along their ray), region depth, lip softness,
  // then the layer lifted by the thickness (zero at the edge).
  const f = sculpt.sdf.d;
  const skinAt = new Float32Array(count * 3), positions = new Float32Array(count * 3);
  const ins = new Float32Array(count), soft = new Float32Array(count);
  const amp = 0.0003 * k;
  for (let v = 0; v < count; v += 1) {
    const src = kept[v];
    let x = inner.positions[v * 3] - c[0], y = inner.positions[v * 3 + 1] - c[1], z = inner.positions[v * 3 + 2] - c[2];
    let rho = Math.hypot(x, y, z);
    x /= rho; y /= rho; z /= rho;
    if (src >= insv.length) {
      for (let it = 0; it < 10; it += 1) {
        const d = f(c[0] + x * rho, c[1] + y * rho, c[2] + z * rho);
        if (Math.abs(d) < 2e-6) break;
        rho -= d * 0.9;
      }
    }
    const az = Math.atan2(Math.abs(x), z), beta = Math.atan2(y, Math.hypot(x, z));
    const e = src >= insv.length ? 0 : Math.max(0, insv[src]);
    ins[v] = e;
    // Along the lips the hair runs right to the border (a soft fade there read as a halo).
    soft[v] = sstep(0.0015 * k, 0.008 * k, bm.lipGap(az, beta, rho));
    const sx = c[0] + x * rho, sy = c[1] + y * rho, sz = c[2] + z * rho;
    skinAt[v * 3] = sx; skinAt[v * 3 + 1] = sy; skinAt[v * 3 + 2] = sz;
    const full = bm.thickness(az, beta);
    // Zero at the edge, ~0.5 mm a millimetre and a half in, full a few millimetres further; groomed
    // clumps combed down the face, a few tenths of a millimetre (larger read as pebbles in rim
    // light), absent at the edge.
    let t = (0.0005 * k + (full - 0.0005 * k) * sstep(0.001 * k, EDGE, e)) * sstep(0, 0.0015 * k, e);
    t += amp * sstep(0, EDGE, e) * (noise3(sx * 150, sy * 55, sz * 150, seed + 2) * 0.75 + noise3(sx * 340, sy * 120, sz * 340, seed + 3) * 0.25);
    positions[v * 3] = sx + x * t; positions[v * 3 + 1] = sy + y * t; positions[v * 3 + 2] = sz + z * t;
  }
  const nHair = vertexNormals(positions, indices), nSkin = vertexNormals(skinAt, indices);
  // Hair density: ~5 mm fade at the cheek line and neckline, ~1.2 mm along the lips, ragged; none
  // at the edge itself.
  const dens = new Float32Array(count);
  for (let v = 0; v < count; v += 1) {
    const x = skinAt[v * 3], y = skinAt[v * 3 + 1], z = skinAt[v * 3 + 2];
    const ragged = noise3(x * 230, y * 160, z * 230, seed + 47) * (0.0005 + 0.0013 * soft[v]) * k;
    dens[v] = sstep(0, (0.0012 + 0.0038 * soft[v]) * k, ins[v] + ragged) * sstep(0, 0.0005 * k, ins[v]);
  }
  // Where the hair thins the layer takes the skin's normal, so it shades exactly like the skin.
  const normals = new Float32Array(count * 3);
  for (let v = 0; v < count; v += 1) {
    const w = sstep(0, 0.7, dens[v]);
    const o = v * 3;
    const nx = nSkin[o] + (nHair[o] - nSkin[o]) * w, ny = nSkin[o + 1] + (nHair[o + 1] - nSkin[o + 1]) * w, nz = nSkin[o + 2] + (nHair[o + 2] - nSkin[o + 2]) * w;
    const l = Math.hypot(nx, ny, nz) || 1;
    normals[o] = nx / l; normals[o + 1] = ny / l; normals[o + 2] = nz / l;
  }
  const mesh: RawMesh = { positions, normals, indices };
  const base = lin(spec.facialHair?.color ?? spec.hair.color), hi = lin(spec.hair.highlight);
  const colors = paintMesh(mesh, (o3, x, y, z, _nx, ny, _nz, i) => {
    // Strand streaks run down the face (stretched noise), with a few lighter flecks.
    const n = fbm3(x * 160, y * 45, z * 160, 3, seed + 41) * 0.5 + 0.5;
    const fleck = Math.max(0, noise3(x * 520, y * 260, z * 520, seed + 43));
    let h = mix3(base, hi, Math.min(1, 0.06 + 0.3 * n * n + 0.25 * fleck));
    h = mix3(h, hi, 0.06 * Math.max(0, ny));
    const o = i * 3;
    const sk = skin(skinAt[o], skinAt[o + 1], skinAt[o + 2], nSkin[o], nSkin[o + 1], nSkin[o + 2]);
    const col = mix3(sk, h, 0.97 * dens[i]);
    o3[0] = col[0];
    o3[1] = col[1];
    o3[2] = col[2];
  });
  // The table grid is denser than the beard's broad, smooth planes need: decimate (the edge, an
  // open boundary, is pinned; colour differences keep the density fade).
  const d = decimate(mesh, { targetTriangles: Math.round(indices.length / 3 * 0.55), colors, colorWeight: 0.05, minNormalDot: 0.985 });
  const reduced: RawMesh = { positions: d.positions, normals: d.normals, indices: d.indices };
  // Matte: a tight beard has little sheen (a glossy one lit its rounded edge as a bright fringe).
  const part = rigidPart("beard", "hair", reduced, d.colors ?? colors, "head", { roughness: 0.86 });
  // The beard rides on the face: same smile/laugh warps as the skin under it.
  part.morphs = buildExpressionMorphs(sculpt, reduced);
  return { part, mesh: reduced };
}

/** The triangles with no vertex on the negative side of a cut, compacted; `kept[v]` = source vertex. */
function keepSide(mesh: RawMesh, sign: Int8Array): { mesh: RawMesh; kept: Int32Array } {
  const n = mesh.positions.length / 3, I = mesh.indices;
  const map = new Int32Array(n).fill(-1);
  const kept = new Int32Array(n);
  const out = new Uint32Array(I.length);
  let count = 0, o = 0;
  for (let t = 0; t < I.length; t += 3) {
    if (sign[I[t]] < 0 || sign[I[t + 1]] < 0 || sign[I[t + 2]] < 0) continue;
    for (let q = 0; q < 3; q += 1) {
      const v = I[t + q];
      if (map[v] < 0) { map[v] = count; kept[count++] = v; }
      out[o++] = map[v];
    }
  }
  const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    positions.set(mesh.positions.subarray(kept[i] * 3, kept[i] * 3 + 3), i * 3);
    normals.set(mesh.normals.subarray(kept[i] * 3, kept[i] * 3 + 3), i * 3);
  }
  return { mesh: { positions, normals, indices: out.slice(0, o) }, kept: kept.slice(0, count) };
}

/** Area-weighted vertex normals. */
function vertexNormals(P: Float32Array, I: Uint32Array): Float32Array {
  const N = new Float32Array(P.length);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    N[a] += nx; N[a + 1] += ny; N[a + 2] += nz;
    N[b] += nx; N[b + 1] += ny; N[b + 2] += nz;
    N[c] += nx; N[c + 1] += ny; N[c + 2] += nz;
  }
  for (let o = 0; o < N.length; o += 3) {
    const l = Math.hypot(N[o], N[o + 1], N[o + 2]) || 1;
    N[o] /= l; N[o + 1] /= l; N[o + 2] /= l;
  }
  return N;
}

const beardCache = new Map<string, ReturnType<typeof buildBeardMap>>();

/**
 * Full beard + moustache described around a centre behind the mouth: a radial table of the face
 * surface, a region (clean cheek line from the sideburns to the mouth corners, a neckline ~2 cm
 * above the Adam's apple, the lips kept clear) and a thickness map (fullest at the chin).
 */
export function beardMap(spec: CharacterSpec, bind: BindPose) {
  const key = `${spec.id}:${spec.seed}:${bind.proportions.height}`;
  let hit = beardCache.get(key);
  if (!hit) {
    hit = buildBeardMap(spec, bind);
    beardCache.set(key, hit);
  }
  return hit;
}

function buildBeardMap(spec: CharacterSpec, bind: BindPose) {
  const sculpt = sculptHead(spec, bind);
  const k = sculpt.k, ik = 1 / k;
  const a = sculpt.anchors;
  const L = sculpt.field.L, M = sculpt.field.mouth;
  const c: V3 = [0, a.mouth[1] - 0.012 * k, a.mouth[2] - 0.07 * k];
  const DEG = Math.PI / 180;
  const NA = 72, NB = 80, B0 = -88 * DEG, B1 = 52 * DEG;
  const f = sculpt.sdf.d;
  const radT = new Float32Array((NA + 1) * (NB + 1));
  for (let i = 0; i <= NA; i += 1) {
    const az = (i / NA) * Math.PI;
    for (let j = 0; j <= NB; j += 1) {
      const beta = B0 + ((B1 - B0) * j) / NB;
      const dx = Math.sin(az) * Math.cos(beta), dy = Math.sin(beta), dz = Math.cos(az) * Math.cos(beta);
      let r = 0.16 * k;
      for (let it = 0; it < 64; it += 1) {
        const d = f(c[0] + dx * r, c[1] + dy * r, c[2] + dz * r);
        if (Math.abs(d) < 2e-5) break;
        r -= d * 0.9;
        if (r < 0.005) break;
      }
      radT[i * (NB + 1) + j] = r;
    }
  }
  const lookup = (az: number, beta: number) => {
    const fa = Math.min(NA - 1e-6, Math.max(0, (az / Math.PI) * NA));
    const fb = Math.min(NB - 1e-6, Math.max(0, ((beta - B0) / (B1 - B0)) * NB));
    const i = fa | 0, j = fb | 0, u = fa - i, v = fb - j;
    const o = i * (NB + 1) + j;
    const p = radT[o] + (radT[o + 1] - radT[o]) * v;
    const q = radT[o + NB + 1] + (radT[o + NB + 2] - radT[o + NB + 1]) * v;
    return p + (q - p) * u;
  };
  // Directions of key landmarks seen from the centre.
  const dirOf = (p: V3): [number, number] => {
    const dx = p[0] - c[0], dy = p[1] - c[1], dz = p[2] - c[2];
    return [Math.atan2(Math.abs(dx), dz), Math.atan2(dy, Math.hypot(dx, dz))];
  };
  const mh = L.mouthHalf;
  const neckD = sculpt.neckColumn.d;
  const [cornerAz, cornerBeta] = dirOf([a.mouthHalfWidth, a.mouth[1], a.mouth[2] - 0.008 * k]);
  const [, noseBeta] = dirOf([0, a.subnasale[1] - 0.0015 * k, a.subnasale[2]]);
  const [earAz, sideTopBeta] = dirOf([a.ear[0] - 0.012 * k, a.eye[1] - 0.012 * k, a.ear[2] + 0.016 * k]);
  // Cheek line: from the sideburn down to just above the mouth corner, a gently convex groomed
  // line that is not ruled straight (a straight one read as a pasted-on chinstrap).
  const seed = spec.seed;
  const cheekLine = (az: number) => {
    const t = Math.min(1, Math.max(0, (az - cornerAz) / (earAz - cornerAz)));
    return cornerBeta + 0.12 + (sideTopBeta - cornerBeta - 0.12) * Math.pow(t, 1.35) + 0.011 * noise1(az * 7, seed + 61) * t * (1 - t) * 4;
  };
  // Neckline: ~2.5 cm above the Adam's apple at the front, rising toward the ear.
  const neckLine = (az: number) => -60 * DEG + 30 * DEG * Math.pow(Math.min(1, az / earAz), 1.5);
  /**
   * Lip clearance (ref metres, positive outside the lips) in the face frame against the sculpted
   * vermilion borders: the moustache stops just above the upper border's white roll and the beard
   * starts just under the lower border, so the layer's edge never sits on the lips' sharp forms.
   */
  const lipGapAt = (s: number, t: number) => {
    const sc = Math.min(s, mh);
    const up = M.upperBorder(sc) + 0.0011, lo = M.lowerBorder(sc) - 0.0017;
    return Math.max(Math.abs(t - 0.5 * (up + lo)) - 0.5 * (up - lo), s - mh - 0.0016);
  };
  const facePoint = (az: number, beta: number, rho: number): V3 => {
    const cb = Math.cos(beta);
    return [rho * cb * Math.sin(az), c[1] + rho * Math.sin(beta), c[2] + rho * cb * Math.cos(az)];
  };
  /** Lip clearance (metres) of the surface point at (|az|, β, ρ). */
  const lipGap = (az: number, beta: number, rho: number) => {
    const [x, y] = facePoint(az, beta, rho);
    return lipGapAt(x * ik, y * ik - L.ye) * k;
  };
  /** Metres inside the beard region (negative outside). */
  const inside = (az: number, beta: number, rho: number) => {
    const top = az < cornerAz ? noseBeta : cheekLine(az);
    const back = earAz + 0.06 - az;
    // Blend the moustache top into the cheek line over the corner (no notch at the corner).
    const blend = sstep(cornerAz * 0.8, cornerAz * 1.25, az);
    const topBeta = noseBeta + (top - noseBeta) * blend;
    let d = Math.min(topBeta - beta, beta - neckLine(az), back) * rho;
    const [x, y, z] = facePoint(az, beta, rho);
    // Under the jaw the beard ends where the skin turns into the body's neck (the head mesh is
    // not drawn inside the neck column): a clean groomed neckline instead of a fringe on the neck.
    d = Math.min(d, neckD(x, y, z) - 0.002 * k);
    // The lips stay clear.
    return Math.min(d, lipGapAt(x * ik, y * ik - L.ye) * k);
  };
  // Thickness: fullest at the chin, lighter on the jaw and cheeks, a trim moustache.
  const fullness = 0.6 + 0.4 * spec.build.muscle;
  const [, lipBotBeta] = dirOf([0, a.mouth[1] - 0.012 * k, a.mouth[2]]);
  const thickness = (az: number, beta: number) => {
    const chin = Math.exp(-((az / (34 * DEG)) ** 2)) * sstep(lipBotBeta, lipBotBeta - 28 * DEG, beta);
    const jaw = sstep(cornerBeta + 0.05, cornerBeta - 0.35, beta);
    const moustache = sstep(cornerBeta - 0.03, cornerBeta + 0.05, beta) * sstep(cornerAz * 1.3, cornerAz * 1.0, az);
    const t = (0.0026 + 0.0036 * jaw + 0.0042 * chin) * fullness;
    return k * (t + (0.0034 - t) * moustache);
  };
  /** Thickness reaches full strength this far (metres) inside the region. */
  const EDGE = 0.0065 * k;
  const polar = (x: number, y: number, z: number): [number, number, number] => {
    const dx = x - c[0], dy = y - c[1], dz = z - c[2];
    const h = Math.sqrt(dx * dx + dz * dz);
    return [Math.atan2(dx < 0 ? -dx : dx, dz), Math.atan2(dy, h), Math.sqrt(h * h + dy * dy)];
  };
  /** Head-surface points buried under the beard (cull from the head mesh). */
  const buried = (x: number, y: number, z: number, depth: number) => {
    const [az, beta, rho] = polar(x, y, z);
    if (beta < B0 || beta > B1) return false;
    return inside(az, beta, rho) > depth && thickness(az, beta) > depth;
  };
  /** Metres inside the beard region at a head-local point (negative outside). */
  const regionDistance = (x: number, y: number, z: number) => {
    const [az, beta, rho] = polar(x, y, z);
    return beta < B0 || beta > B1 ? -1 : inside(az, beta, rho);
  };
  // The region reaches back to the sideburns (a little past the ear-front azimuth).
  return { c, NA, NB, B0, B1, radT, azMax: earAz + 0.08, edge: EDGE, inside, lipGap, thickness, buried, regionDistance, lookup };
}
