/**
 * Hair coverage maps (worker-safe). OWNER: character-details agent.
 *
 * Every hairstyle is described on the cranium in angular coordinates around a centre C
 * (head-local): azimuth α (0 = front, π = back; |α| is used, hairlines are symmetric) and
 * elevation β. The hairline is an elevation curve β = line(α) (forehead, temples, sideburns,
 * over the ears, nape) and the hair thickness is a function t(α, β) above the scalp. Both are
 * tabulated, so a shell evaluation costs two atan2 and a few lookups. The same maps drive the hair
 * shell sculpt (`hair.ts`), the culling of scalp faces under it and the hairline / fade paint on
 * the skin (`head.ts`).
 */

import type { Sdf, V3 } from "../../sdf/api";
import * as S from "../../sdf/index";
import { pointOf, type BindPose } from "../../rig/skeleton";
import type { CharacterSpec } from "../types";
import { sculptHead, type HeadSculpt } from "./headSculpt";
import { sstep } from "./kit";

const DEG = Math.PI / 180;
const LINE_N = 360;
const TA = 72, TB = 90;
const BETA0 = -80 * DEG, BETA1 = 90 * DEG;

export interface HairMap {
  center: V3;
  /** Hairline elevation (radians) at |azimuth| (radians, 0..π). Table lookup. */
  line: (az: number) => number;
  /** Lower edge of the hair shell (= `line` except for fades). */
  shellLine: (az: number) => number;
  /** 1 / sqrt(1 + shellLine'(az)²): turns (β − line)·ρ into a near-unit-gradient distance. */
  shellNorm: (az: number) => number;
  /** Shell thickness above the scalp (meters) at (|az|, β). Table lookup. */
  thickness: (az: number, beta: number) => number;
  maxThickness: number;
  /** Paint: amount of hair colour on the scalp skin (0..1) at (|az|, β, edge distance). */
  scalpPaint: (az: number, beta: number, edge: number) => number;
  /** Head faces buried deeper than this under the shell are culled. */
  cullDepth: number;
  /** Cranium surface radius from `center` along (|az|, β) (tabulated by ray-marching the sculpt). */
  craniumRadius: (az: number, beta: number) => number;
}

/** Monotone cubic through (azimuth°, elevation°) knots on [0, 180]; returns radians. */
export function knotCurve(knots: Array<[number, number]>) {
  const xs = knots.map((q) => q[0] * DEG);
  const ys = knots.map((q) => q[1] * DEG);
  const n = xs.length;
  const m = ys.map((_, i) => {
    if (i === 0 || i === n - 1) return 0;
    const d0 = (ys[i] - ys[i - 1]) / (xs[i] - xs[i - 1]);
    const d1 = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
    return d0 * d1 <= 0 ? 0 : (2 * d0 * d1) / (d0 + d1);
  });
  return (az: number) => {
    const a = Math.min(Math.PI, Math.max(0, az));
    let i = 0;
    while (i < n - 2 && a > xs[i + 1]) i += 1;
    const h = xs[i + 1] - xs[i];
    const t = (a - xs[i]) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

/** Angular coordinates of a head-local point around `c`: [|azimuth|, elevation, radius]. */
export function hairAngles(c: V3, x: number, y: number, z: number): [number, number, number] {
  const dx = x - c[0], dy = y - c[1], dz = z - c[2];
  const h = Math.sqrt(dx * dx + dz * dz);
  return [Math.atan2(dx < 0 ? -dx : dx, dz), Math.atan2(dy, h), Math.sqrt(h * h + dy * dy)];
}

interface Style {
  line: (az: number) => number;
  /** Lower edge of the hair shell if it differs from the hairline (a fade shows skin below it). */
  shellLine?: (az: number) => number;
  /** Thickness given |az|, β and metres inside the hairline. */
  thick: (az: number, beta: number, edge: number) => number;
  maxThickness: number;
  scalpPaint: (az: number, beta: number, edge: number) => number;
  cullDepth: number;
}

function style(spec: CharacterSpec, bind: BindPose, sculpt: HeadSculpt): Style {
  const k = sculpt.k;
  const center = sculpt.anchors.craniumCenter;
  if (spec.hair.style === "ponytail") {
    // Slicked back into a high ponytail: rounded hairline, soft sideburn, clean nape.
    const line = knotCurve([[0, 32.5], [18, 32], [34, 29.5], [50, 23.5], [62, 14], [70, 4], [76, -6], [81, -3], [87, 9], [97, 11], [108, 3], [117, -20], [130, -35], [152, -45], [180, -50]]);
    const head = pointOf(bind, "head");
    const pony = pointOf(bind, "pony1");
    const [rootAz, rootBeta] = hairAngles(center, pony[0] - head[0], pony[1] - head[1], pony[2] - head[2]);
    return {
      line,
      maxThickness: 0.0105 * k,
      cullDepth: 0.0026 * k,
      // Sleek and flat at the front, gathering (thicker) toward the ponytail root.
      thick: (az, beta, edge) => {
        const toRoot = Math.hypot((az - rootAz) * Math.cos(beta), beta - rootBeta);
        const gather = Math.exp(-((toRoot / 0.55) ** 2));
        const t = 0.0032 + 0.0016 * sstep(20 * DEG, 70 * DEG, beta) + 0.0042 * gather;
        return k * (0.0011 + (t - 0.0011) * sstep(0, 0.008 * k, edge));
      },
      scalpPaint: (_az, _beta, edge) => (edge > 0 ? 1 : 0.85 * Math.exp(edge / (0.0032 * k))),
    };
  }
  if (spec.hair.style === "crop") {
    // Short textured crop: 2–3 cm on top, tight sides, slight temple recession.
    const line = knotCurve([[0, 35], [16, 35.5], [30, 37.5], [42, 35], [54, 26], [64, 15], [71, 3], [76, -9], [81, -8], [87, 6], [97, 9], [108, 1], [117, -21], [130, -33], [152, -44], [180, -49]]);
    return {
      line,
      maxThickness: 0.026 * k,
      cullDepth: 0.003 * k,
      thick: (az, beta, edge) => {
        const top = sstep(18 * DEG, 58 * DEG, beta);
        const front = Math.exp(-((az / (40 * DEG)) ** 2)) * sstep(20 * DEG, 40 * DEG, beta) * (1 - sstep(55 * DEG, 75 * DEG, beta));
        const back = sstep(100 * DEG, 160 * DEG, az) * sstep(-25 * DEG, 20 * DEG, beta);
        const t = 0.0058 + 0.0135 * top + 0.004 * front + 0.003 * back * (1 - top);
        return k * (0.0016 + (t - 0.0016) * sstep(0, 0.013 * k, edge));
      },
      scalpPaint: (_az, _beta, edge) => (edge > 0 ? 1 : 0.7 * Math.exp(edge / (0.003 * k))),
    };
  }
  // Skin fade with a short kinky top and a crisp line-up.
  const line = knotCurve([[0, 33], [30, 33], [37, 31.5], [41, 26], [56, 13], [68, 2], [75, -10], [80, -12], [86, 7], [97, 10], [108, 2], [117, -17], [130, -30], [152, -41], [180, -47]]);
  const fadeTop = knotCurve([[0, 33], [40, 31], [70, 30], [100, 30], [140, 26], [180, 22]]);
  return {
    line,
    shellLine: (az) => Math.max(line(az), fadeTop(az) - 17 * DEG),
    maxThickness: 0.019 * k,
    cullDepth: 0.003 * k,
    thick: (az, beta, edge) => {
      const top = sstep(fadeTop(az) - 14 * DEG, fadeTop(az) + 3 * DEG, beta);
      const t = 0.0011 + 0.0145 * top;
      // Line-up: full thickness right at the front edge (crisp), tapered elsewhere.
      const crisp = Math.exp(-((az / (42 * DEG)) ** 2));
      return k * (0.0009 + (t - 0.0009) * sstep(0, (0.0012 + 0.006 * (1 - crisp)) * k, edge));
    },
    // Fade: scalp darkens from skin at the bottom to hair colour under the top.
    scalpPaint: (az, beta, edge) => {
      if (edge < 0) return 0.9 * Math.exp(edge / (0.0007 * k));
      return 0.35 + 0.65 * sstep(fadeTop(az) - 44 * DEG, fadeTop(az) - 12 * DEG, beta);
    },
  };
}

const mapCache = new Map<string, HairMap>();

export function hairMap(spec: CharacterSpec, bind: BindPose): HairMap {
  const key = `${spec.id}:${spec.seed}:${bind.proportions.height}:${spec.hair.style}`;
  const hit = mapCache.get(key);
  if (hit) return hit;
  const sculpt = sculptHead(spec, bind);
  const st = style(spec, bind, sculpt);
  const r0 = 0.088 * sculpt.k;
  // Tabulate the hairline and the thickness map (edge measured at a typical scalp radius).
  const lineT = new Float32Array(LINE_N + 1);
  const shellT = new Float32Array(LINE_N + 1);
  for (let i = 0; i <= LINE_N; i += 1) {
    lineT[i] = st.line((i / LINE_N) * Math.PI);
    shellT[i] = (st.shellLine ?? st.line)((i / LINE_N) * Math.PI);
  }
  const thickT = new Float32Array((TA + 1) * (TB + 1));
  for (let i = 0; i <= TA; i += 1) {
    const az = (i / TA) * Math.PI;
    for (let j = 0; j <= TB; j += 1) {
      const beta = BETA0 + ((BETA1 - BETA0) * j) / TB;
      thickT[i * (TB + 1) + j] = st.thick(az, beta, (beta - st.line(az)) * r0);
    }
  }
  const curve = (T: Float32Array) => (az: number) => {
    const f = Math.min(LINE_N - 1e-6, Math.max(0, (az / Math.PI) * LINE_N));
    const i = f | 0;
    return T[i] + (T[i + 1] - T[i]) * (f - i);
  };
  const line = curve(lineT);
  const normT = new Float32Array(LINE_N + 1);
  for (let i = 0; i <= LINE_N; i += 1) {
    const a = shellT[Math.max(0, i - 1)], b = shellT[Math.min(LINE_N, i + 1)];
    const slope = (b - a) / (((Math.min(LINE_N, i + 1) - Math.max(0, i - 1)) / LINE_N) * Math.PI);
    normT[i] = 1 / Math.sqrt(1 + slope * slope);
  }
  // Radial height map of the cranium: one sphere-traced ray per table direction.
  const c = sculpt.anchors.craniumCenter;
  const f = sculpt.cranium.d;
  const radT = new Float32Array((TA + 1) * (TB + 1));
  for (let i = 0; i <= TA; i += 1) {
    const az = (i / TA) * Math.PI;
    for (let j = 0; j <= TB; j += 1) {
      const beta = BETA0 + ((BETA1 - BETA0) * j) / TB;
      const dx = Math.sin(az) * Math.cos(beta), dy = Math.sin(beta), dz = Math.cos(az) * Math.cos(beta);
      let r = 0.2 * sculpt.k;
      for (let it = 0; it < 40; it += 1) {
        const d = f(c[0] + dx * r, c[1] + dy * r, c[2] + dz * r);
        if (Math.abs(d) < 2e-5) break;
        r -= d * 0.9;
        if (r < 0.01) break;
      }
      radT[i * (TB + 1) + j] = r;
    }
  }
  const table = (T: Float32Array) => (az: number, beta: number) => {
    const fa = Math.min(TA - 1e-6, Math.max(0, (az / Math.PI) * TA));
    const fb = Math.min(TB - 1e-6, Math.max(0, ((beta - BETA0) / (BETA1 - BETA0)) * TB));
    const i = fa | 0, j = fb | 0, u = fa - i, v = fb - j;
    const o = i * (TB + 1) + j;
    const a = T[o] + (T[o + 1] - T[o]) * v;
    const b = T[o + TB + 1] + (T[o + TB + 2] - T[o + TB + 1]) * v;
    return a + (b - a) * u;
  };
  const map: HairMap = {
    center: c,
    line,
    shellLine: curve(shellT),
    shellNorm: curve(normT),
    thickness: table(thickT),
    maxThickness: st.maxThickness,
    scalpPaint: st.scalpPaint,
    cullDepth: st.cullDepth,
    craniumRadius: table(radT),
  };
  mapCache.set(key, map);
  return map;
}

/** Signed edge distance (meters, positive inside the hairline) at a head-local point. */
export function edgeDistance(map: HairMap, x: number, y: number, z: number) {
  const [az, beta, r] = hairAngles(map.center, x, y, z);
  return (beta - map.line(az)) * r;
}

export interface HairTexture {
  /** Outward displacement (meters) added to the thickness where the hair is thick enough. */
  fn: (x: number, y: number, z: number) => number;
  amplitude: number;
  /** Upper bound of |∇fn|. */
  slope: number;
}

/**
 * Hair shell SDF (head-local): the cranium pushed out by the thickness map (plus optional strand
 * texture), clipped to the hairline region. One fused evaluation (angles once), scaled to stay a
 * conservative 1-Lipschitz bound. Its inside includes the skull, so the caller culls buried faces.
 */
export function hairShell(spec: CharacterSpec, bind: BindPose, texture?: HairTexture): Sdf {
  const sculpt = sculptHead(spec, bind);
  const map = hairMap(spec, bind);
  const k = sculpt.k;
  const [cx, cy, cz] = map.center;
  const { shellLine: line, shellNorm, thickness, craniumRadius } = map;
  const tex = texture?.fn;
  const texAmp = texture ? texture.amplitude : 0;
  const texFull = 0.004 * k;
  // Radial heights over-read the normal distance by up to ~1.3 on the cranium; the hairline term
  // is slope-normalised. Dividing keeps a conservative 1-Lipschitz bound without wasting the
  // sampler's narrow band.
  const inv = 1 / (2.3 + (texture ? texture.slope : 0));
  const amp = map.maxThickness + texAmp;
  const b = sculpt.cranium.bounds;
  const pad = amp + 0.006 * k;
  // Past the hairline the shell does not end in a ~1 mm cliff (Surface Nets stair-stepped it into
  // a sawtooth that crawled in motion): it dives smoothly under the skin over DIVE_W, and the clip
  // sits beyond that. The visible hairline is where two smooth surfaces cross: a clean curve.
  const DIVE_W = 0.0032 * k, DIVE_D = 0.0014 * k;
  return S.custom(
    (x, y, z) => {
      const dx = x - cx, dy = y - cy, dz = z - cz;
      const h = Math.sqrt(dx * dx + dz * dz);
      const az = Math.atan2(dx < 0 ? -dx : dx, dz);
      const beta = Math.atan2(dy, h);
      const rho = Math.sqrt(h * h + dy * dy);
      const edge = (beta - line(az)) * rho * shellNorm(az);
      const outside = -edge - DIVE_W - 0.0012 * k;
      let t = thickness(az, beta);
      if (edge < 0) t -= (t + DIVE_D) * sstep(0, DIVE_W, -edge);
      const d0 = rho - craniumRadius(az, beta) - t;
      let shell = d0;
      if (tex) {
        // Texture only matters near the surface; elsewhere its amplitude bound is enough.
        if (d0 > texAmp + 0.002 * k) shell = d0 - texAmp;
        else if (d0 < -texAmp - 0.002 * k) shell = d0 + texAmp;
        else {
          t = tex(x, y, z) * (t < texFull ? t / texFull : 1);
          shell = d0 - t;
        }
      }
      return (shell > outside ? shell : outside) * inv;
    },
    { min: [b.min[0] - pad, b.min[1] - pad, b.min[2] - pad], max: [b.max[0] + pad, b.max[1] + pad, b.max[2] + pad] },
  );
}

/**
 * Cheap head-local solid of the cranium (+ the smooth hair volume when `withHair`), grown by
 * `extra` meters, from the radial tables (for culling and occlusion bakes).
 */
export function craniumWithHair(spec: CharacterSpec, bind: BindPose, extra = 0, withHair = true): Sdf {
  const sculpt = sculptHead(spec, bind);
  const map = hairMap(spec, bind);
  const [cx, cy, cz] = map.center;
  const { shellLine: line, thickness, craniumRadius } = map;
  const b = sculpt.cranium.bounds;
  const pad = map.maxThickness + extra + 0.004;
  return S.custom(
    (x, y, z) => {
      const dx = x - cx, dy = y - cy, dz = z - cz;
      const h = Math.sqrt(dx * dx + dz * dz);
      const az = Math.atan2(dx < 0 ? -dx : dx, dz);
      const beta = Math.atan2(dy, h);
      const rho = Math.sqrt(h * h + dy * dy);
      const inside = withHair ? (beta - line(az)) * rho : -1;
      const t = inside > 0 ? thickness(az, beta) : 0;
      return (rho - craniumRadius(az, beta) - t - extra) / 1.35;
    },
    { min: [b.min[0] - pad, b.min[1] - pad, b.min[2] - pad], max: [b.max[0] + pad, b.max[1] + pad, b.max[2] + pad] },
  );
}

export interface HairCoverage {
  map: HairMap;
  /** Smooth hair solid (no strand texture) for occlusion; null if bald. */
  solid: Sdf | null;
  cullDepth: number;
  /** True if a head-surface point at (x, y, z) lies buried under the shell (cull it). */
  buried: (x: number, y: number, z: number) => boolean;
  /** Amount of hair colour painted onto the skin at a head-local point (0..1). */
  paint: (x: number, y: number, z: number) => number;
}

const coverCache = new Map<string, HairCoverage>();

export function hairCoverage(spec: CharacterSpec, bind: BindPose): HairCoverage {
  const key = `${spec.id}:${spec.seed}:${bind.proportions.height}`;
  const hit = coverCache.get(key);
  if (hit) return hit;
  const map = hairMap(spec, bind);
  const solid = hairShell(spec, bind);
  const depth = map.cullDepth;
  const cover: HairCoverage = {
    map,
    solid,
    cullDepth: depth,
    buried: (x, y, z) => {
      const [az, beta, r] = hairAngles(map.center, x, y, z);
      const edge = (beta - map.shellLine(az)) * r;
      return edge > depth && map.thickness(az, beta) > depth;
    },
    paint: (x, y, z) => {
      const [az, beta, r] = hairAngles(map.center, x, y, z);
      return map.scalpPaint(az, beta, (beta - map.line(az)) * r);
    },
  };
  coverCache.set(key, cover);
  return cover;
}
