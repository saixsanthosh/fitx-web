/**
 * Garment definitions (worker-safe: no `three`, no DOM). OWNER: character-body.
 *
 * A garment is described by cheap analytic functions in bind space:
 * - `clip(x, y, z)`: signed coverage, negative where the garment covers the body (≈ meters),
 *   built from bone-relative planes, cylinders and ellipses (necklines, armholes, hems, splits);
 * - `offset(x, y, z)`: fabric distance from the skin (tight lycra ≈ 3 mm, flared shorts more);
 * - `base` colour plus `accents`: signed masks (positive inside) for panels, trims, grippers and
 *   stripes. `clothing.ts` cuts the mesh exactly along each mask's zero line so graphics stay
 *   crisp at any mesh resolution.
 * `clothing.ts` turns these into shells sampled on the body's own grid.
 */

import { clamp01, mixRGB, smoothstep, srgbHexToLinear } from "../math";
import type { LinearRGB } from "../types";
import type { BodyModel } from "./body";
import type { CharacterSpec, MaterialRole } from "./types";
import type { LimbFrame, V3 } from "./frames";

/** Accent region: `mask(x, y, z, edge) > 0` inside; `edge` is the garment's clip value there. */
export interface Accent {
  mask: (x: number, y: number, z: number, edge: number) => number;
  color: LinearRGB;
}

export interface GarmentDef {
  name: string;
  role: MaterialRole;
  /** Stacking order: higher layers sit outside lower ones (shorts < top < belt). */
  layer: number;
  clip: (x: number, y: number, z: number) => number;
  offset: (x: number, y: number, z: number) => number;
  maxOffset: number;
  /** [1,2,1] blur passes over the body field: stiffer fabric bridges more of the body's dips. */
  blur: number;
  /** Bind-space box containing the garment. */
  box: { min: V3; max: V3 };
  base: LinearRGB;
  /** Knit/weave noise amplitude on the colour (default 0.04). */
  noise?: number;
  accents: Accent[];
  /** Body skin within this distance of a hem stays (hides seams while moving). */
  hemMargin: number;
  /** Extra offset of the hem band along every edge (default 4 mm). */
  hemBoost?: number;
  roughness?: number;
}

// ---------------------------------------------------------------------------------------------
// Small analytic helpers (all ≈ 1-Lipschitz distances, negative inside).

const smax = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
};
const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
/** Approximate signed distance to an axis-aligned ellipse (semi-axes a, b) in a 2D plane. */
const ellipse2 = (u: number, v: number, a: number, b: number) => (Math.hypot(u / a, v / b) - 1) * Math.min(a, b);
/** Distance from p to the infinite line through `o` with unit direction `d`. */
function lineDist(x: number, y: number, z: number, o: V3, d: V3) {
  const px = x - o[0], py = y - o[1], pz = z - o[2];
  const t = px * d[0] + py * d[1] + pz * d[2];
  return Math.hypot(px - d[0] * t, py - d[1] * t, pz - d[2] * t);
}
const along = (x: number, y: number, z: number, o: V3, d: V3) => (x - o[0]) * d[0] + (y - o[1]) * d[1] + (z - o[2]) * d[2];

interface Ctx {
  spec: CharacterSpec;
  body: BodyModel;
  s: number;
}

function sideLimb(x: number, limbs: Record<"L" | "R", LimbFrame>) {
  return x >= 0 ? limbs.L : limbs.R;
}

// ---------------------------------------------------------------------------------------------
// Tops

function topBox(c: Ctx, bottomY: number): { min: V3; max: V3 } {
  const F = c.body.frames;
  const sh = F.joint("upperArm_L");
  return { min: [-sh[0] - 0.16 * c.s, bottomY - 0.06, -0.2 * c.s], max: [sh[0] + 0.16 * c.s, F.joint("head")[1], 0.22 * c.s] };
}

/** Excluded neck opening: above a collar plane that rises toward the back, near the neck. */
function neckOpening(c: Ctx, frontY: number, backY: number, radius: number) {
  const F = c.body.frames;
  const neck = F.joint("neck");
  const zc = neck[2] + 0.03 * c.s;
  const zf = 0.07 * c.s, zb = -0.07 * c.s;
  // Plane through (frontY, zf) and (backY, zb), containing the x axis; normal points up.
  const dy = frontY - backY, dz = zf - zb;
  const len = Math.hypot(dy, dz);
  const ny = dz / len, nz = -dy / len;
  return (x: number, y: number, z: number) => {
    const above = -((y - backY) * ny + (z - zb) * nz);
    const cyl = Math.hypot(x, (z - zc) * 0.9) - radius;
    return smax(above, cyl, 0.01);
  };
}

function cropTank(c: Ctx): GarmentDef {
  const { spec, body, s } = c;
  const F = body.frames;
  const sh = F.joint("upperArm_L");
  const chest = F.joint("chest");
  const sternum = F.mark("sternumTop");
  const hemY = body.marks.navel[1] + 0.04 * s;
  const base = srgbHexToLinear(spec.outfit.top.color);
  const trim = srgbHexToLinear(spec.outfit.top.accent);
  // Scoop neck in front, high round neck at the back.
  const scoopY = sternum[1] - 0.012 * s;
  const neck = neckOpening(c, sternum[1] + 0.02 * s, F.joint("neck")[1] + 0.03 * s, 0.098 * s);
  // Racerback: the back panel narrows from full width under the shoulder blades to a strap band.
  const rbLow = chest[1] - 0.05 * s, rbHigh = chest[1] + 0.07 * s;
  const neckY = F.joint("neck")[1];
  const clip = (x: number, y: number, z: number) => {
    let d = hemY - y;
    const scoop = smax(ellipse2(x, y - scoopY, 0.088 * s, 0.075 * s), -(z - 0.0), 0.01);
    d = smax(d, -smin(scoop, neck(x, y, z), 0.012), 0.008);
    // Armholes: big ovals around each shoulder, the arm beyond.
    for (const sx of [1, -1]) {
      const ax = x * sx;
      const oval = Math.hypot((ax - (sh[0] + 0.018 * s)) / 0.074, (y - (sh[1] - 0.05 * s)) / 0.11, (z - (sh[2] - 0.0 * s)) / 0.13) - 1;
      const hole = smin(oval * 0.075 * s, (sh[0] - 0.004 * s) - ax, 0.02);
      d = smax(d, -hole, 0.008);
    }
    // Racerback: behind the shoulder blades only a central band stays.
    const w = 0.16 * s + (0.04 * s - 0.16 * s) * smoothstep(rbLow, rbHigh, y);
    let back = smax(smax(w - Math.abs(x), z + 0.035 * s, 0.01), rbLow - 0.02 * s - y, 0.01);
    // Two straps fan out from the top of the centre panel over the trapezius to the shoulders.
    const ax = 0, ay = neckY - 0.012 * s;
    const bx = Math.sign(x || 1) * (sh[0] - 0.052 * s), by = sh[1] + 0.05 * s;
    const ux = bx - ax, uy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * ux + (y - ay) * uy) / (ux * ux + uy * uy)));
    const strap = Math.hypot(x - ax - ux * t, y - ay - uy * t) - 0.019 * s;
    back = smax(back, -strap, 0.008);
    d = smax(d, -back, 0.008);
    return d;
  };
  return {
    name: "top",
    role: "fabricSheen",
    layer: 2,
    clip,
    offset: (x, y) => (0.0035 + 0.0015 * smoothstep(hemY + 0.04 * s, hemY, y)) * s,
    maxOffset: 0.006 * s,
    blur: 2,
    box: topBox(c, hemY),
    base,
    // Binding along every edge (neckline, armholes, racerback, hem).
    accents: [{ mask: (x, y, z, edge) => 0.0115 * s + edge, color: mixRGB(base, trim, 0.72) }],
    hemMargin: 0.016 * s,
    roughness: 0.6,
  };
}

function jersey(c: Ctx): GarmentDef {
  const { spec, body, s } = c;
  const F = body.frames;
  const sternum = F.mark("sternumTop");
  const hipY = F.joint("hips")[1];
  const hemY = hipY - 0.03 * s;
  const sleeve = 0.5;
  const base = srgbHexToLinear(spec.outfit.top.color);
  const accent = srgbHexToLinear(spec.outfit.top.accent);
  const neck = neckOpening(c, sternum[1] + 0.022 * s, F.joint("neck")[1] + 0.05 * s, 0.102 * s);
  const arms = F.arm;
  const clip = (x: number, y: number, z: number) => {
    let d = hemY - y;
    d = smax(d, -neck(x, y, z), 0.006);
    const a = sideLimb(x, arms);
    const t = along(x, y, z, a.a, a.dirU) - sleeve * a.lenU;
    const sleeveEnd = smax(-t, lineDist(x, y, z, a.a, a.dirU) - 0.085 * s, 0.01);
    d = smax(d, -sleeveEnd, 0.006);
    return d;
  };
  const collar = (x: number, y: number, z: number) => smoothstep(-0.02 * s, -0.004 * s, -neck(x, y, z));
  const armpitY = body.marks.armpitY;
  // Positive on the sleeve (past the shoulder, close to the arm axis), negative elsewhere.
  const sleeveMask = (x: number, y: number, z: number) => {
    const a = sideLimb(x, arms);
    return Math.min(along(x, y, z, a.a, a.dirU) - 0.04 * s, 0.085 * s - lineDist(x, y, z, a.a, a.dirU));
  };
  const cuffT = (x: number, y: number, z: number) => {
    const a = sideLimb(x, arms);
    return along(x, y, z, a.a, a.dirU) - (sleeve * a.lenU - 0.028 * s);
  };
  return {
    name: "top",
    role: "fabricSheen",
    layer: 2,
    clip,
    // Semi-fitted: 5 mm, the collar band stands 3 mm proud; spans the ab grooves like real fabric.
    offset: (x, y, z) => (0.0055 + 0.003 * collar(x, y, z)) * s,
    maxOffset: 0.0095 * s,
    blur: 4,
    box: topBox(c, hemY),
    base,
    accents: [
      {
        // Coral side panels: a band of directions around the torso, below the armpit, off the sleeves.
        mask: (x, y, z) => Math.min(
          0.16 * Math.min(Math.atan2(Math.abs(x), z + 0.012 * s) - 1.22, 2.02 - Math.atan2(Math.abs(x), z + 0.012 * s)),
          armpitY - 0.015 * s - y,
          -sleeveMask(x, y, z),
        ),
        color: accent,
      },
      // Sleeve cuffs.
      { mask: (x, y, z) => Math.min(sleeveMask(x, y, z), cuffT(x, y, z)), color: accent },
      // Collar band (darker rib) and the half-zip placket down the centre front.
      { mask: (x, y, z, edge) => Math.min(0.021 * s + edge, y - (sternum[1] - 0.03 * s)), color: mixRGB(base, [0, 0, 0], 0.35) },
    ],
    hemMargin: 0.02 * s,
    roughness: 0.55,
  };
}

function tank(c: Ctx): GarmentDef {
  const { spec, body, s } = c;
  const F = body.frames;
  const sh = F.joint("upperArm_L");
  const sternum = F.mark("sternumTop");
  const hipY = F.joint("hips")[1];
  const hemY = hipY - 0.02 * s;
  const base = srgbHexToLinear(spec.outfit.top.color);
  const accent = srgbHexToLinear(spec.outfit.top.accent);
  const scoopY = sternum[1] - 0.02 * s;
  const neck = neckOpening(c, sternum[1] + 0.02 * s, F.joint("neck")[1] + 0.035 * s, 0.11 * s);
  const clip = (x: number, y: number, z: number) => {
    let d = hemY - y;
    const scoop = smax(ellipse2(x, y - scoopY, 0.1 * s, 0.085 * s), -z, 0.01);
    d = smax(d, -smin(scoop, neck(x, y, z), 0.012), 0.008);
    // Deep armholes: down to ~10 cm below the armpit, straps ~6 cm wide on the shoulders.
    for (const sx of [1, -1]) {
      const ax = x * sx;
      const oval = Math.hypot((ax - (sh[0] + 0.006 * s)) / 0.09, (y - (sh[1] - 0.09 * s)) / 0.17, (z - sh[2]) / 0.16) - 1;
      const hole = smin(oval * 0.09 * s, (sh[0] - 0.02 * s) - ax, 0.02);
      d = smax(d, -hole, 0.008);
    }
    return d;
  };
  return {
    name: "top",
    role: "fabric",
    layer: 2,
    clip,
    offset: (x, y) => (0.006 + 0.004 * smoothstep(hemY + 0.15 * s, hemY, y)) * s,
    maxOffset: 0.011 * s,
    blur: 2,
    box: topBox(c, hemY),
    base,
    noise: 0.05,
    // Coral binding round the neckline and armholes (not the hem).
    accents: [{ mask: (x, y, z, edge) => Math.min(0.0135 * s + edge, y - (sh[1] - 0.2 * s)), color: accent }],
    hemMargin: 0.024 * s,
    roughness: 0.9,
  };
}

// ---------------------------------------------------------------------------------------------
// Bottoms

interface ShortsShape {
  waistY: number;
  /** Hem distance down the thigh axis from the hip joint (meters). */
  hem: number;
  offset: number;
  flare: number;
  split: boolean;
}

/** x of the left thigh's inner surface per centimetre of height (measured on the leg SDF). */
function innerThighTable(c: Ctx, top: number, bottom: number) {
  const leg = c.body.regions.legL;
  const z = c.body.frames.leg.L.a[2];
  const ys: number[] = [];
  const xs: number[] = [];
  for (let y = top; y >= bottom; y -= 0.01) {
    let x = 0;
    for (let i = 0; i < 60; i += 1) {
      const d = leg.d(x, y, z);
      if (d < 5e-4) break;
      x += Math.max(d, 1e-3);
    }
    ys.push(y);
    xs.push(x);
  }
  return (y: number) => {
    const t = (top - y) / 0.01;
    const i = Math.max(0, Math.min(xs.length - 2, Math.floor(t)));
    const f = Math.max(0, Math.min(1, t - i));
    return xs[i] + (xs[i + 1] - xs[i]) * f;
  };
}

function shortsClip(c: Ctx, shape: ShortsShape) {
  const legs = c.body.frames.leg;
  const s = c.s;
  const crotch = c.body.marks.crotchY - 0.01 * s;
  const inner = shape.flare > 0 ? innerThighTable(c, crotch, legs.L.a[1] - shape.hem - 0.04) : () => 0;
  return (x: number, y: number, z: number) => {
    const leg = sideLimb(x, legs);
    const t = along(x, y, z, leg.a, leg.dirU);
    let d = smax(y - shape.waistY, t - shape.hem, 0.01);
    if (shape.flare > 0 && y < crotch) {
      // Loose legs: cut the fabric web that would bridge the gap between the inner thighs
      // (only where the thighs actually part; touching thighs keep the crotch seam).
      const wedge = smax(Math.abs(x) - Math.max(0, inner(y) - 0.003 * s), y - crotch, 0.004);
      d = smax(d, -wedge, 0.004);
    }
    if (shape.split) {
      // Inverted-V split on the outer seam, rising 4.5 cm from the hem.
      const fwd = along(x, y, z, leg.a, leg.front);
      const lat = along(x, y, z, leg.a, leg.out);
      const up = shape.hem - t;
      const half = 0.003 * s + 0.014 * s * clamp01(1 - up / (0.045 * s));
      const slot = smax(smax(Math.abs(fwd) - half, up - 0.045 * s, 0.004), -lat, 0.004);
      d = smax(d, -slot, 0.004);
    }
    return Math.max(d, Math.abs(x) - 0.34 * s);
  };
}

function shortsOffset(c: Ctx, shape: ShortsShape) {
  const legs = c.body.frames.leg;
  const s = c.s;
  return (x: number, y: number, z: number) => {
    const leg = sideLimb(x, legs);
    const t = along(x, y, z, leg.a, leg.dirU);
    // Flare grows toward the hem, mostly on the outside of the leg (less web between the thighs).
    const lat = along(x, y, z, leg.a, leg.out);
    const outer = smoothstep(-0.06 * s, 0.04 * s, lat);
    return shape.offset + shape.flare * smoothstep(shape.hem - 0.16 * s, shape.hem, t) * (0.2 + 0.8 * outer);
  };
}

function bottomBox(c: Ctx, shape: ShortsShape): { min: V3; max: V3 } {
  const legs = c.body.frames.leg;
  const lowY = Math.min(legs.L.a[1] - shape.hem, legs.R.a[1] - shape.hem) - 0.06;
  return { min: [-0.36 * c.s, lowY, -0.24 * c.s], max: [0.36 * c.s, shape.waistY + 0.05, 0.22 * c.s] };
}

function runShorts(c: Ctx): GarmentDef {
  const { spec, body, s } = c;
  const leg = body.frames.leg.L;
  const shape: ShortsShape = { waistY: body.marks.navel[1] - 0.004 * s, hem: 0.36 * leg.lenU, offset: 0.004 * s, flare: 0.012 * s, split: true };
  const base = srgbHexToLinear(spec.outfit.bottom.color);
  const accent = srgbHexToLinear(spec.outfit.bottom.accent);
  return {
    name: "bottom",
    role: "fabric",
    layer: 1,
    clip: shortsClip(c, shape),
    offset: shortsOffset(c, shape),
    maxOffset: shape.offset + shape.flare,
    blur: 2,
    box: bottomBox(c, shape),
    base,
    noise: 0.06,
    accents: [
      // Coral stripe below the waistband, coral piping round the hems and splits.
      { mask: (x, y) => Math.min(y - (shape.waistY - 0.044 * s), shape.waistY - 0.028 * s - y), color: accent },
      { mask: (x, y, z, edge) => Math.min(0.0125 * s + edge, shape.waistY - 0.06 * s - y), color: accent },
    ],
    hemMargin: 0.022 * s,
    roughness: 0.82,
  };
}

function bibShorts(c: Ctx): GarmentDef {
  const { spec, body, s } = c;
  const leg = body.frames.leg.L;
  const shape: ShortsShape = { waistY: body.marks.navel[1] + 0.06 * s, hem: 0.8 * leg.lenU, offset: 0.0028 * s, flare: 0, split: false };
  const base = srgbHexToLinear(spec.outfit.bottom.color);
  const accent = srgbHexToLinear(spec.outfit.bottom.accent);
  return {
    name: "bottom",
    role: "fabricSheen",
    layer: 1,
    clip: shortsClip(c, shape),
    // Leg grippers sit a touch proud of the lycra.
    offset: (x, y, z) => {
      const l = sideLimb(x, body.frames.leg);
      const t = along(x, y, z, l.a, l.dirU);
      return shape.offset + 0.0018 * s * smoothstep(shape.hem - 0.04 * s, shape.hem - 0.035 * s, t);
    },
    maxOffset: shape.offset + 0.002 * s,
    blur: 1,
    box: bottomBox(c, shape),
    base,
    accents: [{
      // Coral leg grippers.
      mask: (x, y, z) => {
        const l = sideLimb(x, body.frames.leg);
        return along(x, y, z, l.a, l.dirU) - (shape.hem - 0.036 * s);
      },
      color: accent,
    }],
    hemMargin: 0.016 * s,
    roughness: 0.5,
  };
}

function trainingShorts(c: Ctx): GarmentDef {
  const { spec, body, s } = c;
  const leg = body.frames.leg.L;
  const shape: ShortsShape = { waistY: body.marks.navel[1] - 0.02 * s, hem: 0.7 * leg.lenU, offset: 0.007 * s, flare: 0.014 * s, split: false };
  const base = srgbHexToLinear(spec.outfit.bottom.color);
  const accent = srgbHexToLinear(spec.outfit.bottom.accent);
  return {
    name: "bottom",
    role: "fabric",
    layer: 1,
    clip: shortsClip(c, shape),
    offset: shortsOffset(c, shape),
    maxOffset: shape.offset + shape.flare,
    blur: 2,
    box: bottomBox(c, shape),
    base,
    noise: 0.06,
    accents: [{
      // Coral stripe down the outer seam.
      mask: (x, y, z) => {
        const l = sideLimb(x, body.frames.leg);
        const fwd = along(x, y, z, l.a, l.front);
        const lat = along(x, y, z, l.a, l.out);
        return Math.min(0.0075 * s - Math.abs(fwd + 0.006 * s), lat, shape.waistY - 0.04 * s - y);
      },
      color: accent,
    }],
    hemMargin: 0.03 * s,
    roughness: 0.92,
  };
}

// ---------------------------------------------------------------------------------------------
// Belt (powerlifting belt: thick, stiff, 10 cm)

function belt(c: Ctx): GarmentDef {
  const { body, s } = c;
  const yc = body.marks.navel[1] + 0.012 * s;
  const half = 0.05 * s;
  const leather: LinearRGB = srgbHexToLinear(0x141516);
  return {
    name: "belt",
    role: "leather",
    layer: 3,
    clip: (x, y) => Math.max(Math.abs(y - yc) - half, Math.abs(x) - 0.3 * s),
    offset: () => 0.019 * s,
    maxOffset: 0.019 * s,
    blur: 4,
    box: { min: [-0.3 * s, yc - half - 0.05, -0.24 * s], max: [0.3 * s, yc + half + 0.05, 0.24 * s] },
    base: leather,
    noise: 0.03,
    accents: [],
    hemMargin: 0.012 * s,
    hemBoost: 0,
    roughness: 0.45,
  };
}

/** Garments for a character in stacking order (inner first). */
export function garmentsFor(spec: CharacterSpec, body: BodyModel): GarmentDef[] {
  const s = body.frames.H / (body.frames.female ? 1.68 : 1.8);
  const c: Ctx = { spec, body, s };
  const list: GarmentDef[] = [];
  const bottom = spec.outfit.bottom.style;
  list.push(bottom === "run-shorts" ? runShorts(c) : bottom === "bib-shorts" ? bibShorts(c) : trainingShorts(c));
  const top = spec.outfit.top.style;
  list.push(top === "crop-tank" ? cropTank(c) : top === "jersey" ? jersey(c) : tank(c));
  if (spec.outfit.extras.includes("belt")) list.push(belt(c));
  return list;
}
