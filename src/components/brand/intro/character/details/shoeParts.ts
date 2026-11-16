/**
 * Exact shoe parts (worker-safe). OWNER: gear agent.
 *
 * Built directly as triangles (no field sampling), so edges stay crisp in the opening macro and
 * the cost is tiny:
 * - `soleSweeps`: foam midsole (rolled top edge, concave flared base, a sculpted groove) and
 *   rubber outsole (toe wrap) as profile sweeps around the outline, plus chevron tread lugs.
 * - `fittedSock`: a knit tube fitted to the body's own ankle (the same primitives and blend as
 *   `bodyLimbs.ts`), real ribs and a rolled cuff; also returns the collar opening it needs.
 * - `twistedTube`: round laces with a twisted-yarn paint.
 * - `panelize`: cuts the decimated upper along overlay curves (counter, toe cap, eyestays...),
 *   lifts or sinks each panel and stitches the step with a wall, so seams are exact lines.
 * Shoe frame: x = medial (right shoe), y = up from the ground, z = forward from the heel.
 */

import type { RawMesh, Sdf, V3 } from "../../sdf/api";
import * as S from "../../sdf/index";
import type { BindPose } from "../../rig/skeleton";
import { noise3 } from "../../math";
import type { CharacterSpec } from "../types";
import { bodyFrames, frameQuat, v3comb } from "../frames";
import { cutAlongCurve, mix3, sstep, tubeMesh, type ColoredMesh, type RGB } from "./kit";
import { faceNormals, outlineLoop, outlineNormal, sweepMesh, zipperCap, type Outline } from "./shoeShape";

export interface ShoeFrame {
  origin: V3;
  /** Medial (+x for the right shoe) and forward unit vectors in bind space. */
  s: V3;
  f: V3;
  length: number;
  /** Shoe-frame positions of the ankle joint, ball (toe joint) and the leg direction (up the shin). */
  ankle: V3;
  ball: V3;
  legDir: V3;
  toLocal: (p: V3) => V3;
}

/** Shoe frame → character bind space (a rotation about Y plus a translation). */
export const shoeToBind = (fr: ShoeFrame, p: V3): V3 => [fr.origin[0] + fr.s[0] * p[0] + fr.f[0] * p[2], p[1], fr.origin[2] + fr.s[2] * p[0] + fr.f[2] * p[2]];

// ---------------------------------------------------------------------------------------------
// Soles

export interface SoleProfile {
  /** Ground contact (lug bottoms) at z: rocker toe spring and heel bevel. */
  bottom: (z: number) => number;
  /** Midsole top edge at z. */
  top: (z: number) => number;
  /** Outward flare of the midsole's base at z (m). */
  flare: (z: number) => number;
  /** Rubber thickness and tread lug height (m). */
  rubber: number;
  lug: number;
  /** Height of the rubber toe wrap at the tip (m). */
  wrap: number;
  stations: number;
  hero: boolean;
}

/** Midsole sidewall offset at normalised height yn (0 = base, 1 = under the rolled top edge). */
function sidewall(F: number, yn: number, hero: boolean) {
  const flare = F * Math.pow(Math.max(0, 1 - yn / 0.5), 1.7);
  const crown = 0.0007 * Math.sin(Math.PI * Math.min(1, Math.max(0, (yn - 0.5) / 0.5)));
  const groove = hero ? -0.0009 * Math.exp(-(((yn - 0.5) / 0.032) ** 2)) : -0.0006 * Math.exp(-(((yn - 0.5) / 0.06) ** 2));
  return flare + crown + groove;
}

const HERO_WALL = [0.9, 0.79, 0.68, 0.585, 0.535, 0.5, 0.465, 0.41, 0.31, 0.2, 0.1, 0];
const LOW_WALL = [0.8, 0.6, 0.5, 0.35, 0.15, 0];

/**
 * Foam midsole and rubber outsole sweeps around the outline (+ the outsole's bottom face).
 * Colours carry a soft analytic occlusion (under the upper, in the groove, at the rubber seam).
 */
export function soleSweeps(o: Outline, prof: SoleProfile, foamC: RGB, rubberC: RGB, seed: number): { foam: ColoredMesh; rubber: ColoredMesh } {
  const loop = outlineLoop(o, prof.stations);
  const L = o.length;
  const rt = 0.0022;
  const wall = prof.hero ? HERO_WALL : LOW_WALL;
  const arc = prof.hero ? [0, 30, 60, 90] : [0, 45, 90];
  const rows = 2 + arc.length + wall.length + 2;
  const shade = new Float32Array(rows);
  const station = (i: number) => {
    const z = loop.z[i];
    const b = prof.bottom(z), mb = b + prof.lug + prof.rubber, t = prof.top(z);
    return { z, b, mb, t, F: prof.flare(z) };
  };
  const foam = sweepMesh(loop, rows, (i, j, out) => {
    const { mb, t, F } = station(i);
    let s = 0, y = t, k = 1;
    if (j === 0) { s = -0.011; k = 0.62; }
    else if (j === 1) { s = -0.0042; k = 0.8; }
    else if (j < 2 + arc.length) {
      const phi = (arc[j - 2] * Math.PI) / 180;
      s = -rt + rt * Math.sin(phi);
      y = t - rt + rt * Math.cos(phi);
      k = 0.9 + 0.1 * Math.sin(phi);
    } else if (j < 2 + arc.length + wall.length) {
      const yn = wall[j - 2 - arc.length];
      y = mb + yn * (t - rt - mb);
      s = sidewall(F, yn, prof.hero);
      k = 1 - 0.16 * Math.exp(-(((yn - 0.5) / 0.04) ** 2)) - 0.08 * sstep(0.12, 0, yn);
    } else if (j === rows - 2) { s = F - 0.0003; y = mb - 0.0002; k = 0.78; }
    else { s = F - 0.0016; y = mb - 0.0008; k = 0.6; }
    out[0] = s;
    out[1] = y;
    shade[j] = k;
  });
  const foamColors = new Float32Array(foam.positions.length);
  for (let i = 0; i < loop.n; i += 1) {
    for (let j = 0; j < rows; j += 1) {
      profileShade(shade, i, j, rows, station, prof, arc.length, wall);
      const v = i * rows + j, p = v * 3;
      const n = 1 + 0.012 * noise3(foam.positions[p] * 260, foam.positions[p + 1] * 260, foam.positions[p + 2] * 260, seed + 11);
      // Foam reads a touch warmer low down (bounce from the track) and cooler at the rolled top.
      const yn = Math.min(1, Math.max(0, (foam.positions[p + 1] - prof.bottom(loop.z[i])) / 0.04));
      const k = shade[j] * n;
      foamColors[p] = foamC[0] * k * (1.01 - 0.01 * yn);
      foamColors[p + 1] = foamC[1] * k;
      foamColors[p + 2] = foamC[2] * k * (0.985 + 0.015 * yn);
    }
  }

  // Outsole band: hidden lip inside the foam, outer face (rising into the toe wrap and hugging
  // the foam's flare there), a rounded bottom edge and the bottom face ring.
  const rb = 0.0012;
  const rRows = 9;
  const rubber = sweepMesh(loop, rRows, (i, j, out) => {
    const { z, b, mb, t, F } = station(i);
    const front = Math.max(0, loop.nz[i]);
    const wrapH = prof.wrap * sstep(0.86 * L, 1.0 * L, z) * front * front;
    const topY = mb + wrapH;
    const plate = b + prof.lug;
    const sideAt = (y: number) => (y <= mb ? F : sidewall(F, (y - mb) / (t - rt - mb), prof.hero)) + 0.00035;
    let s = 0, y = 0;
    switch (j) {
      case 0: y = topY + 0.0006; s = sideAt(topY) - 0.0012; break;
      case 1: y = topY - 0.0002; s = sideAt(topY) - 0.0001; break;
      case 2: y = topY - 0.0008; s = sideAt(topY - 0.0008); break;
      case 3: y = mb + (topY - mb) * 0.45; s = Math.max(F - 0.0004, sideAt(y)); break;
      case 4: y = mb; s = F - 0.0004; break;
      case 5: y = plate + rb; s = F - 0.0004; break;
      case 6: y = plate + rb * 0.29; s = F - 0.0004 - rb * 0.29; break;
      case 7: y = plate; s = F - 0.0004 - rb; break;
      default: y = plate; s = F - 0.0045; break;
    }
    out[0] = s;
    out[1] = y;
  });
  const cap = zipperCap(loop, rRows, rRows - 1, rubber.positions);
  const idx = new Uint32Array(rubber.indices.length + cap.length);
  idx.set(rubber.indices);
  idx.set(cap, rubber.indices.length);
  // The cap shares the bottom ring: give those vertices a straight-down normal (the ring is flat).
  const rubberNormals = faceNormals(rubber.positions, rubber.indices);
  for (let i = 0; i < loop.n; i += 1) {
    const v = (i * rRows + rRows - 1) * 3;
    rubberNormals[v] = 0;
    rubberNormals[v + 1] = -1;
    rubberNormals[v + 2] = 0;
  }
  const rubberColors = new Float32Array(rubber.positions.length);
  const rShade = [0.7, 0.92, 1, 1, 1, 0.97, 0.88, 0.8, 0.72];
  for (let v = 0; v < rubber.positions.length / 3; v += 1) {
    const k = rShade[v % rRows] * (1 + 0.03 * noise3(rubber.positions[v * 3] * 300, rubber.positions[v * 3 + 1] * 300, rubber.positions[v * 3 + 2] * 300, seed + 12));
    rubberColors[v * 3] = rubberC[0] * k;
    rubberColors[v * 3 + 1] = rubberC[1] * k;
    rubberColors[v * 3 + 2] = rubberC[2] * k;
  }
  return {
    foam: { positions: foam.positions, normals: foam.normals, indices: foam.indices, colors: foamColors },
    rubber: { positions: rubber.positions, normals: rubberNormals, indices: idx, colors: rubberColors },
  };
}

/** (Hook kept trivial: shading per row is fixed; split out so the row table stays readable.) */
function profileShade(_shade: Float32Array, _i: number, _j: number, _rows: number, _station: unknown, _prof: SoleProfile, _arc: number, _wall: number[]) {}

/**
 * Chevron tread lugs under the outsole: rows across the forefoot and heel, each split into
 * `cols` rounded blocks (pointing forward at the centre), clipped to the outline so the outer
 * blocks follow the edge and notch the sole's silhouette. Bottoms sit on `bottom(z)`.
 */
export function treadLugs(o: Outline, bottom: (z: number) => number, lugH: number, zones: Array<{ z0: number; z1: number; cols: number }>, pitch: number, depth: number, color: RGB, seed: number): ColoredMesh {
  const L = o.length;
  const pos: number[] = [], nrm: number[] = [], col: number[] = [], idx: number[] = [];
  const gap = 0.0026, rc = 0.0011, margin = 0.0007, slant = 0.11;
  const clamp = (x: number, z: number): [number, number] => {
    const d = o.d(x, z);
    if (d <= -margin) return [x, z];
    const [gx, gz] = outlineNormal(o, x, z);
    return [x - gx * (d + margin), z - gz * (d + margin)];
  };
  let lug = 0;
  for (const zone of zones) {
    const za = zone.z0 * L, zb = zone.z1 * L;
    const rowsN = Math.max(1, Math.round((zb - za) / pitch));
    for (let r = 0; r < rowsN; r += 1) {
      const zr = za + (r + 0.5) * ((zb - za) / rowsN);
      const xl = -o.lateral(zr) + margin, xm = o.medial(zr) - margin;
      if (xm - xl < 0.02) continue;
      const xc = (xl + xm) / 2;
      const w = (xm - xl - gap * (zone.cols - 1)) / zone.cols;
      for (let c = 0; c < zone.cols; c += 1) {
        const x0 = xl + c * (w + gap), x1 = x0 + w;
        const zf = (x: number) => zr + depth / 2 - slant * Math.abs(x - xc);
        const zbk = (x: number) => zr - depth / 2 - slant * Math.abs(x - xc);
        // Rounded quad: two points per corner, counter-clockwise seen from below.
        const corners: Array<[number, number]> = [[x0, zbk(x0)], [x1, zbk(x1)], [x1, zf(x1)], [x0, zf(x0)]];
        const ring: Array<[number, number]> = [];
        for (let k = 0; k < 4; k += 1) {
          const p = corners[k], prev = corners[(k + 3) % 4], next = corners[(k + 1) % 4];
          const toPrev = [prev[0] - p[0], prev[1] - p[1]], toNext = [next[0] - p[0], next[1] - p[1]];
          const lp = Math.hypot(toPrev[0], toPrev[1]) || 1, ln = Math.hypot(toNext[0], toNext[1]) || 1;
          ring.push(clamp(p[0] + (toPrev[0] / lp) * rc, p[1] + (toPrev[1] / lp) * rc));
          ring.push(clamp(p[0] + (toNext[0] / ln) * rc, p[1] + (toNext[1] / ln) * rc));
        }
        const m = ring.length;
        const base = pos.length / 3;
        const shade = 0.9 + 0.06 * noise3(lug * 1.7, 0.3, 0.9, seed + 13);
        lug += 1;
        // Side wall: top ring (into the plate) and bottom ring, smooth corner normals.
        for (let k = 0; k < m; k += 1) {
          const p = ring[k], a = ring[(k + m - 1) % m], b = ring[(k + 1) % m];
          let nx = b[1] - a[1], nz = -(b[0] - a[0]);
          // Ring is clockwise seen from above (counter-clockwise from below): outward = (dz, -dx).
          const l = Math.hypot(nx, nz) || 1;
          nx /= l;
          nz /= l;
          const yb = bottom(p[1]);
          pos.push(p[0], yb + lugH + 0.0004, p[1], p[0], yb, p[1]);
          nrm.push(nx, 0, nz, nx * 0.8, -0.6, nz * 0.8);
          col.push(color[0] * shade * 0.7, color[1] * shade * 0.7, color[2] * shade * 0.7, color[0] * shade, color[1] * shade, color[2] * shade);
        }
        for (let k = 0; k < m; k += 1) {
          const a = base + k * 2, b = base + ((k + 1) % m) * 2;
          idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
        // Bottom cap (flat, facing down).
        const capBase = pos.length / 3;
        for (let k = 0; k < m; k += 1) {
          const p = ring[k];
          pos.push(p[0], bottom(p[1]), p[1]);
          nrm.push(0, -1, 0);
          col.push(color[0] * shade, color[1] * shade, color[2] * shade);
        }
        for (let k = 1; k < m - 1; k += 1) idx.push(capBase, capBase + k + 1, capBase + k);
      }
    }
  }
  const mesh = { positions: Float32Array.from(pos), normals: Float32Array.from(nrm), indices: Uint32Array.from(idx), colors: Float32Array.from(col) };
  orientToNormals(mesh);
  return mesh;
}

/** Flips triangles whose winding disagrees with their vertex normals. */
export function orientToNormals(mesh: RawMesh) {
  const p = mesh.positions, n = mesh.normals, I = mesh.indices;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    if (gx * (n[a] + n[b] + n[c]) + gy * (n[a + 1] + n[b + 1] + n[c + 1]) + gz * (n[a + 2] + n[b + 2] + n[c + 2]) < 0) {
      const tmp = I[t + 1];
      I[t + 1] = I[t + 2];
      I[t + 2] = tmp;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Sock

/** The body's lower-leg primitives (`bodyLimbs.ts` sculptLeg, right leg, same blend), bind space. */
function legProxy(spec: CharacterSpec, bind: BindPose): Sdf {
  const F = bodyFrames(bind);
  const f = F.leg.R;
  const fem = F.female;
  const s = F.H / (fem ? 1.68 : 1.8);
  const b = spec.build;
  const Ak = s * (fem ? 0.0315 : 0.0345) * (0.84 + 0.16 * b.calves);
  const C = s * (fem ? 0.053 : 0.057) * b.calves * (0.86 + 0.28 * b.muscle);
  const k = 0.016 * s * (0.8 + 1.1 * b.bodyFat) * (fem ? 1.08 : 1);
  const { b: K, c: An, dirL, frontL, outL } = f;
  return S.smoothUnion(
    k,
    S.roundCone(v3comb(K, [dirL, 0.02 * s]), v3comb(An, [dirL, -0.004 * s]), 0.84 * C, 0.9 * Ak),
    S.capsule(v3comb(An, [dirL, -0.085 * s], [frontL, -0.8 * Ak]), v3comb(An, [dirL, -0.006 * s], [frontL, -1.02 * Ak]), 0.33 * Ak),
    S.ellipsoid(v3comb(An, [dirL, -0.002 * s], [frontL, -0.06 * Ak]), [1.0 * Ak, 0.034 * s, 0.96 * Ak], frameQuat(dirL, frontL)),
    S.sphere(v3comb(An, [outL, -0.78 * Ak], [dirL, -0.006 * s]), 0.37 * Ak),
    S.sphere(v3comb(An, [outL, 0.74 * Ak], [dirL, 0.006 * s], [frontL, -0.15 * Ak]), 0.35 * Ak),
  );
}

export interface SockOptions {
  /** Shoe-frame heights (y) of the cuff top and of the lowest ring (inside the shoe). */
  top: number;
  bottom: number;
  /** Shoe-frame height of the collar rim at angle θ (0 = front, π/2 = medial). */
  collar: (theta: number) => number;
  color: RGB;
  cuff: RGB;
  seed: number;
  hero: boolean;
}

export interface FittedSock {
  mesh: ColoredMesh;
  /** Opening radius (sock + gap) at the collar for WELL_N angles θ = 2πk/WELL_N. */
  well: Float32Array;
  /** Axis frame: dir(θ) = e2·cosθ + e1·sinθ around `up` through the ankle. */
  e1: V3;
  e2: V3;
  up: V3;
}

export const WELL_N = 72;

/**
 * Knit sock fitted to the body: each ring marches in onto the leg proxy and keeps a 2 mm
 * clearance, so the skin never shows through it; below the collar it keeps the collar's
 * section (it fills the shoe instead of tapering away). Ribbed body, rolled cuff.
 */
export function fittedSock(spec: CharacterSpec, bind: BindPose, fr: ShoeFrame, opts: SockOptions): FittedSock {
  const proxy = legProxy(spec, bind);
  const up = S.normalize(fr.legDir);
  const e1 = S.normalize(S.sub([1, 0, 0], S.scale(up, up[0])));
  const e2 = S.cross(e1, up);
  const radial = opts.hero ? 60 : 30;
  const ribs = radial / 2;
  const dh = opts.hero ? 0.004 : 0.008;
  const h0 = opts.bottom - fr.ankle[1], h1 = opts.top - fr.ankle[1];
  const nRings = Math.max(3, Math.round((h1 - h0) / dh) + 1);
  const R: Float64Array[] = [];
  const hs: number[] = [];
  for (let j = 0; j < nRings; j += 1) {
    const h = h0 + ((h1 - h0) * j) / (nRings - 1);
    hs.push(h);
    const c = S.addScaled(fr.ankle, up, h);
    const ring = new Float64Array(radial);
    for (let i = 0; i < radial; i += 1) {
      const th = (i / radial) * Math.PI * 2;
      const dir = S.add(S.scale(e2, Math.cos(th)), S.scale(e1, Math.sin(th)));
      let r = 0.075;
      for (let k = 0; k < 48; k += 1) {
        const p = shoeToBind(fr, S.addScaled(c, dir, r));
        const d = proxy.d(p[0], p[1], p[2]);
        if (d < 1.5e-4 || r < 0.012) break;
        r -= d * 0.92;
      }
      ring[i] = Math.max(r, 0.012);
    }
    R.push(ring);
  }
  // Smooth (the smooth-min creases are softer than a ray hit) and add the clearance.
  const blur = (a: Float64Array) => {
    const b = new Float64Array(a.length);
    for (let i = 0; i < a.length; i += 1) b[i] = 0.25 * a[(i + a.length - 1) % a.length] + 0.5 * a[i] + 0.25 * a[(i + 1) % a.length];
    a.set(b);
  };
  for (const ring of R) {
    blur(ring);
    blur(ring);
  }
  // Below the collar the sock keeps the collar section (it fills the heel cup).
  for (let i = 0; i < radial; i += 1) {
    const th = (i / radial) * Math.PI * 2;
    const hc = opts.collar(th) - fr.ankle[1];
    let ref = -1;
    for (let j = nRings - 1; j >= 0; j -= 1) {
      if (hs[j] > hc - 0.002) continue;
      if (ref < 0) ref = R[j][i];
      R[j][i] = Math.max(R[j][i], ref);
    }
  }
  const clear = 0.0021;
  // Collar opening: the widest the sock gets around the rim, plus a little play.
  const well = new Float32Array(WELL_N);
  for (let k = 0; k < WELL_N; k += 1) {
    const th = (k / WELL_N) * Math.PI * 2;
    const fi = (th / (Math.PI * 2)) * radial;
    const i0 = Math.floor(fi) % radial, i1 = (i0 + 1) % radial, u = fi - Math.floor(fi);
    const hc = opts.collar(th) - fr.ankle[1];
    let best = 0;
    for (let j = 0; j < nRings; j += 1) {
      if (hs[j] < hc - 0.008 || hs[j] > hc + 0.006) continue;
      best = Math.max(best, R[j][i0] * (1 - u) + R[j][i1] * u);
    }
    well[k] = (best || 0.03) + clear + 0.0014;
  }

  // Mesh: ribbed knit body, then a rolled cuff (out, over, and a little way down inside).
  const positions: number[] = [], normals: number[] = [], colors: number[] = [], index: number[] = [];
  const ringOut: Array<{ h: number; dr: number; tone: number; cuff: boolean }> = [];
  for (let j = 0; j < nRings; j += 1) ringOut.push({ h: hs[j], dr: j >= nRings - 2 ? 0.0005 : 0, tone: 1, cuff: hs[j] > h1 - 0.011 });
  const roll = [
    { h: h1 + 0.0017, dr: 0.0011, tone: 1.02, cuff: true },
    { h: h1 + 0.0028, dr: -0.0004, tone: 1.03, cuff: true },
    { h: h1 + 0.002, dr: -0.0019, tone: 0.9, cuff: true },
    { h: h1 - 0.003, dr: -0.0024, tone: 0.62, cuff: true },
  ];
  const all = [...ringOut, ...roll];
  const radiusAt = (j: number, i: number) => {
    const jj = Math.min(nRings - 1, j);
    return R[jj][i] + clear;
  };
  all.forEach((ring, j) => {
    const c = S.addScaled(fr.ankle, up, ring.h);
    for (let i = 0; i < radial; i += 1) {
      const th = (i / radial) * Math.PI * 2;
      const dir = S.add(S.scale(e2, Math.cos(th)), S.scale(e1, Math.sin(th)));
      // Knit ribs: alternating 0.3 mm (cuff 0.45 mm) so they catch the light, not just paint.
      const rib = (i % 2 === 0 ? 1 : -1) * (ring.cuff ? 0.00045 : 0.0003);
      const p = S.addScaled(c, dir, radiusAt(j, i) + ring.dr + (j < nRings + 2 ? rib : 0));
      positions.push(p[0], p[1], p[2]);
      normals.push(dir[0], dir[1], dir[2]);
      const knit = 1 + 0.035 * noise3(p[0] * 520, p[1] * 160, p[2] * 520, opts.seed + 8);
      const base = ring.cuff ? opts.cuff : opts.color;
      const k = ring.tone * knit * (i % 2 === 0 ? 1.03 : 0.95);
      colors.push(base[0] * k, base[1] * k, base[2] * k);
    }
    if (j > 0) {
      for (let i = 0; i < radial; i += 1) {
        const a = (j - 1) * radial + i, b = (j - 1) * radial + ((i + 1) % radial), cc = a + radial, d = b + radial;
        index.push(a, cc, b, b, cc, d);
      }
    }
  });
  void ribs;
  const P = Float32Array.from(positions);
  const I = Uint32Array.from(index);
  // Winding: tangent × up points inward for (a, b, c) so (a, c, b) faces out; the rolled rings
  // going back down inside face inward, which is right for the cuff's inner side.
  const N = faceNormals(P, I);
  return { mesh: { positions: P, normals: N, indices: I, colors: Float32Array.from(colors) }, well, e1, e2, up };
}

// ---------------------------------------------------------------------------------------------
// Laces

/**
 * Round lace along `points` (Catmull-Rom) with a twisted-yarn paint (a slow helix of lighter
 * and darker plies); `tip` paints the last fraction as an aglet.
 */
export function twistedTube(points: V3[], r: number, color: RGB, opts: { samples: number; radial: number; tipColor?: RGB; tip?: number; tipStart?: boolean; taper?: number }): ColoredMesh {
  const m = tubeMesh(points, (t) => r * (1 - (opts.taper ?? 0) * t), { samples: opts.samples, radial: opts.radial });
  const colors = new Float32Array(m.positions.length);
  const ringCount = opts.samples;
  const tip = opts.tip ?? 0;
  for (let v = 0; v < m.positions.length / 3; v += 1) {
    const ring = Math.min(ringCount - 1, Math.floor(v / opts.radial));
    const j = v < ringCount * opts.radial ? v % opts.radial : 0;
    const t = ring / (ringCount - 1);
    const twist = 0.5 + 0.5 * Math.sin(((j / opts.radial) * 2 + t * 9) * Math.PI * 2);
    let c: RGB = [color[0] * (0.9 + 0.12 * twist), color[1] * (0.9 + 0.12 * twist), color[2] * (0.9 + 0.12 * twist)];
    const atTip = opts.tipStart ? t < tip : t > 1 - tip;
    if (opts.tipColor && tip > 0 && (atTip || v >= ringCount * opts.radial)) c = opts.tipColor;
    colors[v * 3] = c[0];
    colors[v * 3 + 1] = c[1];
    colors[v * 3 + 2] = c[2];
  }
  return { ...m, colors };
}

// ---------------------------------------------------------------------------------------------
// Panels (exact overlay seams on the decimated upper)

export interface PanelCut {
  /** Boundary level set (sign = side). */
  f: (x: number, y: number, z: number) => number;
  /** Only triangles whose centroid passes are cut (keeps cuts local). */
  near?: (x: number, y: number, z: number) => boolean;
}

/**
 * Cuts `mesh` along each boundary (vertices duplicated on the cut), assigns every vertex a panel
 * from the signs (`assign(signs)` → panel index), moves it along its normal by that panel's
 * `lift`, and closes every step between panels of different lift with a wall strip.
 */
export function panelize(mesh: RawMesh, cuts: PanelCut[], assign: (signs: Int8Array, x: number, y: number, z: number) => number, lifts: number[]): { mesh: RawMesh; panel: Uint8Array } {
  let m = mesh;
  let createdBy = new Int8Array(m.positions.length / 3).fill(-1);
  let sideOf = new Int8Array(m.positions.length / 3);
  const segs: Uint32Array[] = [];
  cuts.forEach((cut, k) => {
    const P = m.positions, I = m.indices;
    const near = cut.near;
    const res = cutAlongCurve(m, (v) => cut.f(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]), (a, b, c) => {
      if (!near) return true;
      return near((P[a * 3] + P[b * 3] + P[c * 3]) / 3, (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3, (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3);
    }, []);
    void I;
    const n = res.mesh.positions.length / 3;
    const cb = new Int8Array(n).fill(-1), sd = new Int8Array(n);
    cb.set(createdBy);
    sd.set(sideOf);
    for (let v = createdBy.length; v < n; v += 1) {
      cb[v] = k;
      sd[v] = res.side[v];
    }
    createdBy = cb;
    sideOf = sd;
    segs.push(res.segments);
    m = res.mesh;
  });
  const P = m.positions, N = m.normals;
  const n = P.length / 3;
  const panel = new Uint8Array(n);
  const signs = new Int8Array(cuts.length);
  for (let v = 0; v < n; v += 1) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    for (let k = 0; k < cuts.length; k += 1) signs[k] = createdBy[v] === k ? sideOf[v] : cuts[k].f(x, y, z) > 0 ? 1 : -1;
    panel[v] = assign(signs, x, y, z);
  }
  const moved = Float32Array.from(P);
  for (let v = 0; v < n; v += 1) {
    const l = lifts[panel[v]] ?? 0;
    if (!l) continue;
    moved[v * 3] += N[v * 3] * l;
    moved[v * 3 + 1] += N[v * 3 + 1] * l;
    moved[v * 3 + 2] += N[v * 3 + 2] * l;
  }
  // Walls between copies on the same cut whose panels sit at different heights.
  const wp: number[] = [], wn: number[] = [], wi: number[] = [], wPanel: number[] = [];
  segs.forEach((sg, k) => {
    const f = cuts[k].f;
    for (let s = 0; s < sg.length; s += 4) {
      const pa = sg[s], pb = sg[s + 1], na = sg[s + 2], nb = sg[s + 3];
      const lp = lifts[panel[pa]] ?? 0, ln = lifts[panel[na]] ?? 0;
      if (Math.abs(lp - ln) < 1e-5) continue;
      const base = n + wp.length / 3;
      for (const v of [pa, pb, nb, na]) wp.push(moved[v * 3], moved[v * 3 + 1], moved[v * 3 + 2]);
      // Face the lower side: along −∇f when the + side is higher.
      const mx = (P[pa * 3] + P[pb * 3]) / 2, my = (P[pa * 3 + 1] + P[pb * 3 + 1]) / 2, mz = (P[pa * 3 + 2] + P[pb * 3 + 2]) / 2;
      const h = 0.0008;
      const g: V3 = [f(mx + h, my, mz) - f(mx - h, my, mz), f(mx, my + h, mz) - f(mx, my - h, mz), f(mx, my, mz + h) - f(mx, my, mz - h)];
      const want = lp > ln ? -1 : 1;
      const o = base * 3 - n * 3;
      const ax = wp[o], ay = wp[o + 1], az = wp[o + 2];
      const ux = wp[o + 3] - ax, uy = wp[o + 4] - ay, uz = wp[o + 5] - az;
      const vx = wp[o + 6] - ax, vy = wp[o + 7] - ay, vz = wp[o + 8] - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const flip = (nx * g[0] + ny * g[1] + nz * g[2]) * want < 0;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      if (flip) { nx = -nx; ny = -ny; nz = -nz; }
      for (let q = 0; q < 4; q += 1) wn.push(nx, ny, nz);
      if (flip) wi.push(base, base + 2, base + 1, base, base + 3, base + 2);
      else wi.push(base, base + 1, base + 2, base, base + 2, base + 3);
      const top = lp > ln ? panel[pa] : panel[na];
      wPanel.push(top, top, top, top);
    }
  });
  const total = n + wp.length / 3;
  const positions = new Float32Array(total * 3), normals = new Float32Array(total * 3);
  positions.set(moved);
  positions.set(wp, n * 3);
  normals.set(N);
  normals.set(wn, n * 3);
  const indices = new Uint32Array(m.indices.length + wi.length);
  indices.set(m.indices);
  indices.set(wi, m.indices.length);
  const panelAll = new Uint8Array(total);
  panelAll.set(panel);
  panelAll.set(wPanel, n);
  return { mesh: { positions, normals, indices }, panel: panelAll };
}

/** Mixes a colour toward a darker shade of itself (stitch lines, rubber depth). */
export const shadeOf = (c: RGB, k: number): RGB => mix3(c, [c[0] * k, c[1] * k, c[2] * k], 1);
