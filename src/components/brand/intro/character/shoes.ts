/**
 * Shoes (worker-safe). OWNER: character-details agent.
 *
 * `shoe_R` is sculpted in a shoe frame from the bind landmarks (heel_R → toeTip_R, sole bottom
 * on y = 0, insole at `proportions.soleHeight`) out of separate components — sole slab(s), lofted
 * upper with the collar opened along the leg, tongue, pull tab, sock — each meshed on its own
 * so material/colour boundaries are real geometric seams, with faces buried in other components
 * culled. Laces / BOA wires are exact procedural tubes. `shoe_L` is the mirror (bones swapped).
 * Both are skinned to foot / toe (smooth blend across the toe crease so the toe box flexes) and
 * the sock to the lower leg above the ankle.
 *
 * Styles: runner (Maya: knit upper, rockered white midsole, coral heel counter + stripe, laces,
 * pull tab, tread), cycling (Leo: sleek white upper, coral dial + wire, strap, thin black carbon
 * sole, cleat), lifter (Dre: black upper, coral instep strap, raised wood heel with grain, flat
 * rubber outsole). Maya's right shoe is replaced by a hero-resolution variant (shot 0 macro):
 * ~2.6 mm cells, tread grooves, eyelets, stitching paint.
 */
import type { RawMesh, Sdf, V3 } from "../sdf/api";
import * as S from "../sdf/index";
import { BONE_INDEX, pointOf, segmentDirection, type BindPose } from "../rig/skeleton";
import { fbm3, noise3 } from "../math";
import type { CharacterSpec, MeshPart } from "./types";
import { applyOcclusion, cullMesh, flatColor, lin, mergeColored, mirrorPart, mix3, paintMesh, sstep, tubeMesh, type ColoredMesh, type RGB } from "./details/kit";
import { RUNNER_OUTLINE, curve, loftSdf, makeOutline, soleSdf, type Box, type OutlineDef } from "./details/shoeShape";
import { decimate } from "./details/decimate";

/** Surface Nets cells (meters): regular shoes and Maya's hero shoe. */
export const SHOE_CELL = 0.0058;
export const HERO_SHOE_CELL = 0.004;
/** Triangle budgets per shoe (sock included), reached by colour-aware decimation. */
export const SHOE_TRIS = 5800;
export const HERO_SHOE_TRIS = 19500;

/** Sock colours per character (contrast with the shoe). */
const SOCK: Record<string, number> = { maya: 0x2b2e31, leo: 0x17191b, dre: 0xf0eee9 };

/** `shoe_L` and `shoe_R`, skinned to `foot_*` / `toe_*` (bind space), including sock collars. */
export function buildShoes(spec: CharacterSpec, bind: BindPose): MeshPart[] {
  const right = buildShoe(spec, bind, false);
  const left = mirrorPart(right, "shoe_L");
  if (spec.outfit.shoes.style === "runner" && spec.id === "maya") return [left, buildShoe(spec, bind, true)];
  return [left, right];
}

interface ShoeFrame {
  origin: V3;
  /** Medial (+x for the right shoe), up, forward. */
  s: V3;
  f: V3;
  length: number;
  /** Shoe-frame positions of the ankle joint, ball (toe joint) and the leg direction. */
  ankle: V3;
  ball: V3;
  legDir: V3;
  toLocal: (p: V3) => V3;
}

function shoeFrame(bind: BindPose): ShoeFrame {
  const heel = pointOf(bind, "heel_R"), tip = pointOf(bind, "toeTip_R");
  const f = S.normalize([tip[0] - heel[0], 0, tip[2] - heel[2]]);
  const s = S.cross([0, 1, 0], f);
  const origin: V3 = [heel[0], 0, heel[2]];
  const toLocal = (p: V3): V3 => {
    const d = S.sub(p, origin);
    return [S.dot(d, s), d[1], S.dot(d, f)];
  };
  const leg = segmentDirection(bind, "lowerLeg_R") ?? [0, -1, 0];
  const up = S.scale(leg, -1);
  return {
    origin,
    s,
    f,
    length: Math.hypot(tip[0] - heel[0], tip[2] - heel[2]),
    ankle: toLocal(pointOf(bind, "foot_R")),
    ball: toLocal(pointOf(bind, "toe_R")),
    legDir: [S.dot(up, s), up[1], S.dot(up, f)],
    toLocal,
  };
}

/** Body ankle girth (mirrors character-body's limbGirths: keep in sync). */
function ankleRadius(spec: CharacterSpec, bind: BindPose) {
  const fem = bind.proportions.sex === "female";
  const sb = bind.proportions.height / (fem ? 1.68 : 1.8);
  return sb * (fem ? 0.0315 : 0.0345) * (0.84 + 0.16 * spec.build.calves);
}

interface Component {
  name: string;
  sdf: Sdf;
  /** Paint for this component (shoe-frame position + normal). */
  paint: (out: Float64Array, x: number, y: number, z: number, nx: number, ny: number, nz: number) => void;
  /** Cell override (e.g. thin parts). */
  cell?: number;
  /** Bone weights: "foot" (foot/toe blend) or "sock" (leg/foot blend). */
  skin: "foot" | "sock";
}

const smoothstepZ = (z0: number, z1: number) => (z: number) => sstep(z0, z1, z);

function buildShoe(spec: CharacterSpec, bind: BindPose, hero: boolean): MeshPart {
  const fr = shoeFrame(bind);
  const L = fr.length;
  const soleH = bind.proportions.soleHeight;
  const style = spec.outfit.shoes.style;
  const cs = spec.outfit.shoes;
  const cell = hero ? HERO_SHOE_CELL : SHOE_CELL * Math.min(1.05, Math.max(0.9, L / 0.26));
  const Ak = ankleRadius(spec, bind);
  const seed = spec.seed;
  const def: OutlineDef = style === "cycling"
    ? RUNNER_OUTLINE.map(([t, a, b]) => [t, a * 0.93, b * 0.92])
    : style === "lifter" ? RUNNER_OUTLINE.map(([t, a, b]) => [t, a * 1.04, b * 1.05]) : RUNNER_OUTLINE;
  const o = makeOutline(def, L);
  const bounds: Box = { min: [-0.08, -0.01, o.zBack - 0.02], max: [0.08, 0.2, o.zFront + 0.02] };

  const upperC = lin(cs.upper), soleC = lin(cs.sole), accentC = lin(cs.accent), laceC = lin(cs.laces);
  const sockC = lin(SOCK[spec.id] ?? 0x2b2e31);
  const lining: RGB = mix3(upperC, [0.03, 0.03, 0.035], 0.75);

  // ---- leg opening (collar) along the leg axis, and the sock around the ankle.
  const legTop = S.addScaled(fr.ankle, fr.legDir, 0.3);
  const opening = S.capsule(S.addScaled(fr.ankle, fr.legDir, -0.004), legTop, Ak + 0.0065);
  const sockTop = fr.ankle[1] + (style === "cycling" ? 0.062 : style === "lifter" ? 0.05 : 0.036);

  // ---- per-style sole profiles
  const heelZ = 0.1 * L, ballZ = fr.ball[2];
  const toeSpring = style === "runner" ? 0.015 : style === "cycling" ? 0.009 : 0.005;
  const bottom = (z: number) => toeSpring * Math.pow(sstep(0.68 * L, o.zFront, z), 1.7) + (style === "lifter" ? 0.001 : 0.0045) * sstep(0.05 * L, o.zBack, z);
  const comps: Component[] = [];
  const flat = (c: RGB, vary = 0.03) => (out: Float64Array, x: number, y: number, z: number) => {
    const n = 1 + vary * noise3(x * 300, y * 300, z * 300, seed + 1);
    out[0] = c[0] * n;
    out[1] = c[1] * n;
    out[2] = c[2] * n;
  };

  // Upper height profile above the insole (closed loft; the leg opening cuts the collar).
  const vol = style === "cycling" ? 0.9 : style === "lifter" ? 1.04 : 1;
  const height = curve([[o.zBack, 0.06], [0, 0.066], [heelZ, 0.068], [0.3 * L, 0.072], [0.46 * L, 0.066], [0.58 * L, 0.052], [0.7 * L, 0.041], [0.84 * L, 0.032], [0.95 * L, 0.024], [o.zFront, 0.012]].map(([z, h]) => [z, h * vol]));
  const forefootLow = style === "lifter" ? 0.012 : soleH;
  const base = (z: number) => (style === "lifter" ? forefootLow + (soleH - forefootLow) * (1 - sstep(0.4 * L, 0.5 * L, z)) : soleH) - 0.003;
  const insetU = style === "cycling" ? 0.0025 : 0.0045;
  let upper = loftSdf(o, { base, height, inset: () => insetU, p: 2.3, bounds });
  // Tongue: lies on the instep in front of the leg and rises a little above the collar front.
  const tongueTop = soleH + height(fr.ankle[2] + Ak) + 0.002;
  const tongueC: V3 = [fr.ankle[0] * 0.2, tongueTop - 0.012, fr.ankle[2] + Ak + 0.004];
  const tongue = S.ellipsoid(tongueC, [0.019, 0.022, 0.005], S.quatFromAxisAngle([1, 0, 0], -0.6));
  upper = S.smoothSubtract(0.006, upper, opening);
  upper = S.smoothUnion(0.0035, upper, tongue);
  // Heel pull tab (accent).
  const tabY = soleH + height(o.zBack + 0.004);
  const tab = S.roundBox([0, tabY + 0.003, o.zBack + 0.0032], [0.0075, 0.0105, 0.0026], 0.0024);

  /** Raised overlay panel: the upper grown by `t` inside `region` (crisp, real seam edges). */
  const overlay = (region: Sdf, t: number) => S.smoothIntersect(0.0012, S.offset(upper, t), region);
  const knit = (x: number, y: number, z: number) => (hero ? 0.045 * Math.sin(x * 1500 + Math.sin(z * 400) * 2) * Math.sin(y * 1500) : 0) + 0.025 * noise3(x * 300, y * 300, z * 300, seed);
  const paintUpper = (out: Float64Array, x: number, y: number, z: number, nx: number, _ny: number, nz: number) => {
    let c: RGB = mix3(upperC, [upperC[0] * 0.92, upperC[1] * 0.92, upperC[2] * 0.94], 0.5 + 0.5 * fbm3(x * 90, y * 90, z * 90, 2, seed));
    const k = 1 + knit(x, y, z);
    c = [c[0] * k, c[1] * k, c[2] * k];
    // Inside the collar (normals toward the leg axis): dark lining.
    const ax = x - fr.ankle[0], az = z - fr.ankle[2];
    const rad = Math.hypot(ax, az);
    const inward = rad > 1e-4 ? -(nx * ax + nz * az) / rad : 0;
    if (rad < Ak + 0.012 && inward > 0.2 && y > soleH + 0.01) c = mix3(c, lining, 0.85);
    // Toe box a shade greyer (separate knit zone), cycling toe vents darker.
    if (style === "runner" && z > 0.8 * L) c = mix3(c, [c[0] * 0.94, c[1] * 0.94, c[2] * 0.95], sstep(0.8 * L, 0.83 * L, z));
    if (style === "cycling" && z > 0.7 * L && y > soleH + 0.014) c = mix3(c, [c[0] * 0.86, c[1] * 0.86, c[2] * 0.88], sstep(0.7 * L, 0.74 * L, z));
    out[0] = c[0];
    out[1] = c[1];
    out[2] = c[2];
  };
  comps.push({ name: "upper", sdf: upper, paint: paintUpper, skin: "foot" });
  comps.push({ name: "tab", sdf: tab, paint: flat(accentC), skin: "foot" });
  /** Stitch row painted just inside an overlay's edge (hero only). */
  const stitched = (c: RGB, edge: (x: number, y: number, z: number) => number) => (out: Float64Array, x: number, y: number, z: number) => {
    let col: RGB = [c[0], c[1], c[2]];
    if (hero) {
      const e = edge(x, y, z);
      if (e > 0.0012 && e < 0.0024 && Math.sin((x + y * 0.7 + z) * 2200) > 0.1) col = mix3(col, [col[0] * 0.6, col[1] * 0.55, col[2] * 0.55], 0.75);
    }
    const n = 1 + 0.025 * noise3(x * 300, y * 300, z * 300, seed + 2);
    out[0] = col[0] * n;
    out[1] = col[1] * n;
    out[2] = col[2] * n;
  };

  let stripeAt: ((z: number) => number) | null = null;
  if (style === "runner") {
    // ---- sculpted midsole: concave sidewall waist, heel flare, a design groove, coral outsole.
    const top = (z: number) => soleH + 0.002 + 0.009 * sstep(0.34 * L, 0.04 * L, z) + 0.003 * sstep(0.86 * L, 1.0 * L, z);
    const grow = (y: number, z: number) => {
      const yn = Math.min(1, Math.max(0, (y - bottom(z)) / (top(z) - bottom(z))));
      return 0.0042 - 0.0022 * Math.sin(Math.PI * yn) + 0.0045 * (1 - yn) * sstep(0.22 * L, 0, z);
    };
    let mid: Sdf = soleSdf(o, { bottom: (z) => bottom(z) + 0.0035, top, grow, round: 0.004, bounds });
    // Shallow horizontal design groove around the sidewall.
    const grooveY = (z: number) => bottom(z) + 0.0035 + 0.42 * (top(z) - bottom(z) - 0.0035);
    mid = S.smoothSubtract(0.0016, mid, S.custom((x, y, z) => Math.max(Math.abs(y - grooveY(z)) - 0.0012, -(o.d(x, z) - 0.0028)), bounds));
    comps.push({ name: "midsole", sdf: mid, paint: flat(soleC, 0.02), skin: "foot" });
    const outC = mix3(accentC, [0.8, 0.78, 0.76], 0.12);
    const out: Sdf = soleSdf(o, { bottom, top: (z) => bottom(z) + 0.0045, grow: (_y, z) => grow(bottom(z) + 0.004, z) - 0.0004, round: 0.0018, bounds });
    // Tread (hero): flex grooves and a diamond lug field painted on the outsole's bottom face.
    const treadPaint = (outC3: Float64Array, x: number, y: number, z: number) => {
      flat(outC, 0.04)(outC3, x, y, z);
      if (!hero || y > bottom(z) + 0.0012) return;
      const flex = Math.cos(z * 150) > 0.86 ? 0.55 : 1;
      const lug = Math.abs(Math.sin((z + x) * 300)) + Math.abs(Math.sin((z - x) * 300)) > 1.62 ? 0.7 : 1;
      outC3[0] *= flex * lug;
      outC3[1] *= flex * lug;
      outC3[2] *= flex * lug;
    };
    comps.push({ name: "outsole", sdf: out, paint: treadPaint, skin: "foot" });
    // ---- coral heel counter overlay and a lateral speed stripe.
    const counterLine = (z: number) => soleH + 0.044 - 0.018 * sstep(0.05 * L, 0.21 * L, z);
    const counterRegion = S.custom((x, y, z) => Math.max(z - 0.21 * L, y - counterLine(z)), bounds, { lipschitz: 1.3 });
    comps.push({ name: "counter", sdf: overlay(counterRegion, 0.0022), skin: "foot", paint: stitched(accentC, (x, y, z) => -Math.max(z - 0.21 * L, y - counterLine(z))) });
    const stripeLine = (z: number) => soleH + 0.011 + 0.03 * sstep(0.58 * L, 0.22 * L, z);
    stripeAt = stripeLine;
  } else if (style === "cycling") {
    // Thin carbon plate, heel bumper and the cleat under the ball.
    const plate = soleSdf(o, { bottom: (z) => bottom(z) + 0.004, top: () => soleH + 0.0015, grow: () => 0.0015, round: 0.0028, bounds });
    const cleat = S.roundBox([0, 0.004, ballZ - 0.004], [0.026, 0.004, 0.032], 0.003, S.quatFromAxisAngle([0, 1, 0], 0.08));
    const bumper = S.roundBox([0, 0.0035, 0.045 * L], [0.022, 0.0035, 0.02], 0.003);
    comps.push({
      name: "sole",
      sdf: plate,
      skin: "foot",
      paint: (out, x, y, z) => {
        // Carbon weave (diagonal sheen bands).
        const weave = 0.85 + 0.15 * Math.sign(Math.sin((x + z) * 700)) * Math.sign(Math.sin((x - z) * 700));
        out[0] = soleC[0] * weave;
        out[1] = soleC[1] * weave;
        out[2] = soleC[2] * weave;
      },
    });
    comps.push({ name: "cleat", sdf: S.union(cleat, bumper), paint: flat([0.1, 0.105, 0.11]), skin: "foot" });
    // Coral heel cup overlay, forefoot strap overlay with coral tips, dial.
    const heelRegion = S.custom((x, y, z) => Math.max(z - 0.15 * L, soleH + 0.03 - y), bounds);
    comps.push({ name: "heelcup", sdf: overlay(heelRegion, 0.0014), paint: flat(accentC), skin: "foot" });
    const strapZ = 0.64 * L;
    const strapRegion = S.custom((x, y, z) => Math.max(Math.abs(z - strapZ - 0.15 * x) - 0.011, soleH + 0.016 - y), bounds, { lipschitz: 1.2 });
    comps.push({
      name: "strap",
      sdf: overlay(strapRegion, 0.0035),
      skin: "foot",
      paint: (out, x) => {
        const c = x < -0.028 ? accentC : upperC;
        out[0] = c[0];
        out[1] = c[1];
        out[2] = c[2];
      },
    });
    let dy = soleH + 0.08;
    for (let i = 0; i < 80; i += 1) {
      const d = upper.d(-0.03, dy, 0.43 * L);
      if (d < 2e-4) break;
      dy -= Math.max(d * 0.8, 3e-4);
    }
    const dialAt: V3 = [-0.03, dy, 0.43 * L];
    const dialN = S.sdfNormal(upper, dialAt);
    const dial = S.cylinder(S.addScaled(dialAt, dialN, -0.002), S.addScaled(dialAt, dialN, 0.0085), 0.013, 0.0032);
    const hub = S.addScaled(dialAt, dialN, 0.0085);
    comps.push({
      name: "dial",
      sdf: dial,
      skin: "foot",
      paint: (out, x, y, z) => {
        // Knurled rim (ridges) around a dark hub.
        const r = Math.hypot(x - hub[0], y - hub[1], z - hub[2]);
        const ridge = Math.sin(Math.atan2(y - hub[1], z - hub[2]) * 24) > 0 ? 1 : 0.78;
        const c: RGB = r < 0.006 ? [0.06, 0.06, 0.065] : [accentC[0] * ridge, accentC[1] * ridge, accentC[2] * ridge];
        out[0] = c[0];
        out[1] = c[1];
        out[2] = c[2];
      },
    });
  } else {
    // Lifter: flat rubber outsole, raised wood heel block, low dark forefoot midsole.
    const outsole = soleSdf(o, { bottom: () => 0, top: () => 0.0065, grow: () => 0.0028, round: 0.0025, bounds });
    const heelBlock = S.intersect(
      soleSdf(o, { bottom: () => 0.005, top: () => soleH + 0.004, grow: (y) => 0.0026 - 0.002 * (y / soleH), round: 0.0022, bounds }),
      S.halfSpace([0, 0, 0.43 * L], [0, 0, 1]),
    );
    const fore = soleSdf(o, { bottom: () => 0.005, top: () => forefootLow + 0.002, grow: () => 0.0022, round: 0.0025, bounds });
    const wood = lin(cs.sole);
    comps.push({ name: "outsole", sdf: S.union(outsole, fore), paint: flat([0.022, 0.022, 0.024], 0.05), skin: "foot" });
    comps.push({
      name: "heel",
      sdf: heelBlock,
      skin: "foot",
      paint: (out, x, y, z) => {
        // Wood grain: stretched noise rings along the shoe, plus darker growth lines.
        const g = fbm3(x * 40, y * 260, z * 18, 3, seed + 5);
        const ring = 0.5 + 0.5 * Math.sin(y * 900 + g * 6);
        const c = mix3(wood, [wood[0] * 0.62, wood[1] * 0.55, wood[2] * 0.5], 0.25 + 0.35 * ring * ring);
        out[0] = c[0];
        out[1] = c[1];
        out[2] = c[2];
      },
    });
    // Coral instep strap (overlay band across the laces, in front of the leg).
    const strapZ = 0.47 * L;
    // (A real plane distance, not a ±1 step: the sparse sampler needs a lower bound everywhere.)
    const strapRegion = S.custom((x, y, z) => Math.max(Math.abs(z - strapZ - 0.12 * x) - 0.015, soleH + 0.024 - y, fr.ankle[2] + Ak - z), bounds, { lipschitz: 1.2 });
    comps.push({ name: "strap", sdf: overlay(strapRegion, 0.004), paint: stitched(accentC, () => 0), skin: "foot" });
    // Stitched black heel counter (subtle overlay).
    const counterRegion = S.custom((x, y, z) => Math.max(z - 0.22 * L, y - (soleH + 0.045)), bounds);
    comps.push({ name: "counter", sdf: overlay(counterRegion, 0.0012), paint: flat(mix3(upperC, [0.12, 0.12, 0.13], 0.4)), skin: "foot" });
  }

  const all = S.union(...comps.map((c) => c.sdf));
  const meshes: Array<ColoredMesh & { skin: Component["skin"] }> = [];
  for (const comp of comps) {
    let m = S.meshSdf(comp.sdf, { cell: comp.cell ?? cell });
    const others = comps.filter((c) => c !== comp).map((c) => c.sdf);
    if (others.length) {
      const occ = S.tiledSdf(S.union(...others), 0.03).d;
      m = cullMesh(m, (x, y, z) => occ(x, y, z) > -0.0009);
    }
    const ao = S.bakeAO(m, all, { steps: 2, stepSize: hero ? 0.0028 : 0.0035, strength: 1 });
    const colors = paintMesh(m, comp.paint);
    applyOcclusion(colors, ao, { strength: 0.75, gamma: 1.2, tint: [0.3, 0.29, 0.29] });
    meshes.push({ ...m, colors, skin: comp.skin });
  }

  // ---- laces / wires and the runner's speed stripe: exact procedural geometry (never decimated).
  const extras: ColoredMesh[] = [style !== "cycling" ? laces(upper, fr, L, soleH, laceC, hero, style === "lifter") : boaWire(upper, fr, L)];
  if (stripeAt) {
    const line = stripeAt;
    extras.push(surfaceRibbon(upper, (t) => {
      const z = (0.585 - 0.37 * t) * L;
      return [-0.06, line(z), z];
    }, (t) => 0.0012 + 0.0042 * Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.6, 0.0013, accentC, hero));
  }
  const tubes = mergeColored(extras);
  const sockMesh = sockTube(fr, Ak, soleH, sockTop, sockC, seed);

  // ---- decimate the sculpted body of the shoe to budget (colour-aware), then add tubes + sock.
  const shell = mergeColored(meshes);
  const budget = hero ? HERO_SHOE_TRIS : SHOE_TRIS;
  const target = budget - (sockMesh.indices.length + tubes.indices.length) / 3;
  const reduced = shell.indices.length / 3 > target * 1.12 ? decimate(shell, { targetTriangles: target, colors: shell.colors, colorWeight: 60 }) : null;
  const bodyMesh: ColoredMesh = reduced ? { positions: reduced.positions, normals: reduced.normals, indices: reduced.indices, colors: reduced.colors ?? shell.colors } : shell;
  const merged = mergeColored([bodyMesh, tubes, sockMesh]);
  const sockStart = (bodyMesh.positions.length + tubes.positions.length) / 3;
  const skinKind = new Uint8Array(merged.positions.length / 3);
  skinKind.fill(1, sockStart);
  const n = merged.positions.length / 3;
  const index = new Uint16Array(n * 4);
  const weight = new Float32Array(n * 4);
  const foot = BONE_INDEX.foot_R, toe = BONE_INDEX.toe_R, leg = BONE_INDEX.lowerLeg_R;
  const toeW = smoothstepZ(ballZ - 0.016, ballZ + 0.022);
  for (let v = 0; v < n; v += 1) {
    const x = merged.positions[v * 3], y = merged.positions[v * 3 + 1], z = merged.positions[v * 3 + 2];
    let wFoot = 1, wToe = 0, wLeg = 0;
    if (skinKind[v]) {
      wLeg = sstep(fr.ankle[1] - 0.004, fr.ankle[1] + 0.03, y);
      wFoot = 1 - wLeg;
    } else {
      wToe = toeW(z) * sstep(soleH + 0.07, soleH + 0.03, y);
      // The collar top follows the leg a little so the ankle cannot poke through it.
      wLeg = 0.25 * sstep(fr.ankle[1] - 0.005, fr.ankle[1] + 0.02, y) * (z < fr.ankle[2] + Ak ? 1 : 0);
      wFoot = 1 - wToe - wLeg;
    }
    index[v * 4] = foot;
    index[v * 4 + 1] = toe;
    index[v * 4 + 2] = leg;
    index[v * 4 + 3] = foot;
    weight[v * 4] = wFoot;
    weight[v * 4 + 1] = wToe;
    weight[v * 4 + 2] = wLeg;
    void x;
  }
  // Shoe frame → character bind space (rotation about Y + translation keeps winding).
  const p = merged.positions, nr = merged.normals;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    p[i] = fr.origin[0] + fr.s[0] * x + fr.f[0] * z;
    p[i + 1] = y;
    p[i + 2] = fr.origin[2] + fr.s[2] * x + fr.f[2] * z;
    const a = nr[i], b = nr[i + 1], c = nr[i + 2];
    nr[i] = fr.s[0] * a + fr.f[0] * c;
    nr[i + 1] = b;
    nr[i + 2] = fr.s[2] * a + fr.f[2] * c;
  }
  return {
    name: "shoe_R",
    role: "shoe",
    positions: p,
    normals: nr,
    colors: merged.colors,
    indices: merged.indices,
    skinIndex: index,
    skinWeight: weight,
    roughness: style === "lifter" ? 0.42 : style === "cycling" ? 0.3 : 0.62,
  };
}

/** Criss-cross laces between two eyelet rows on the instep (exact tubes), plus a small bow. */
function laces(upper: Sdf, fr: ShoeFrame, L: number, soleH: number, color: RGB, hero: boolean, lifter: boolean): ColoredMesh {
  const rows = lifter ? 6 : 5;
  const z0 = fr.ankle[2] + 0.034, z1 = 0.66 * L;
  const r = hero ? 0.00165 : 0.0019;
  const onTop = (x: number, z: number, lift: number): V3 => {
    // March down from above to the first surface (Newton from far away can land on the wrong sheet).
    let y = soleH + 0.14;
    for (let i = 0; i < 80; i += 1) {
      const d = upper.d(x, y, z);
      if (d < 2e-4) break;
      y -= Math.max(d * 0.8, 3e-4);
    }
    const p = S.projectToSurface(upper, [x, y, z], 0, 4);
    const nrm = S.sdfNormal(upper, p);
    return S.addScaled(p, nrm, lift);
  };
  const eyelets: Array<[V3, V3]> = [];
  for (let i = 0; i < rows; i += 1) {
    const t = i / (rows - 1);
    const z = z1 + (z0 - z1) * t;
    const half = 0.0105 + 0.004 * t;
    eyelets.push([onTop(half, z, r * 0.6), onTop(-half, z, r * 0.6)]);
  }
  const tubes: RawMesh[] = [];
  const seg = (a: V3, b: V3, sag: number) => {
    const mid = S.add(S.lerp(a, b, 0.5), [0, sag, 0]);
    tubes.push(tubeMesh([a, mid, b], () => r, { samples: hero ? 10 : 6, radial: hero ? 7 : 5 }));
  };
  // Toe-most bar, then criss-cross pairs toward the collar.
  seg(eyelets[0][0], eyelets[0][1], 0.0012);
  for (let i = 0; i < rows - 1; i += 1) {
    seg(eyelets[i][0], eyelets[i + 1][1], 0.0022);
    seg(eyelets[i][1], eyelets[i + 1][0], 0.0026);
  }
  // Bow at the top: two loops and two ends.
  const top = S.lerp(eyelets[rows - 1][0], eyelets[rows - 1][1], 0.5);
  const knot = S.add(top, [0, 0.003, 0.002]);
  for (const sx of [1, -1]) {
    const loop: V3[] = [knot, S.add(knot, [0.012 * sx, 0.006, 0.006]), S.add(knot, [0.024 * sx, 0.002, 0.004]), S.add(knot, [0.014 * sx, -0.004, 0.002]), knot];
    tubes.push(tubeMesh(loop, () => r, { samples: hero ? 16 : 10, radial: hero ? 7 : 5 }));
    const end: V3[] = [knot, S.add(knot, [0.006 * sx, -0.01, 0.006]), S.add(knot, [0.01 * sx, -0.026, 0.012])];
    tubes.push(tubeMesh(end, (t) => r * (1 - 0.15 * t), { samples: hero ? 10 : 6, radial: hero ? 7 : 5 }));
  }
  if (hero) {
    // Eyelet rings.
    for (const pair of eyelets) {
      for (const e of pair) {
        const nrm = S.sdfNormal(upper, e);
        const t1 = S.normalize(S.cross(nrm, [0, 0, 1]));
        const t2 = S.cross(nrm, t1);
        const ring: V3[] = [];
        for (let a = 0; a <= 12; a += 1) {
          const ang = (a / 12) * Math.PI * 2;
          ring.push(S.add(S.addScaled(e, nrm, -r * 0.4), S.add(S.scale(t1, Math.cos(ang) * 0.0034), S.scale(t2, Math.sin(ang) * 0.0034))));
        }
        tubes.push(tubeMesh(ring, () => 0.0009, { samples: 24, radial: 5, caps: false }));
      }
    }
  }
  const m = S.mergeMeshes(tubes);
  return flatColor(m, color);
}

/** Thin dark BOA wire zig-zagging across the instep from the dial guides (cycling). */
function boaWire(upper: Sdf, fr: ShoeFrame, L: number): ColoredMesh {
  const pts: V3[] = [];
  const z0 = fr.ankle[2] + 0.03, z1 = 0.6 * L;
  for (let i = 0; i < 5; i += 1) {
    const t = i / 4;
    const x = (i % 2 ? 1 : -1) * 0.014;
    let y = 0.16;
    for (let k = 0; k < 80; k += 1) {
      const d = upper.d(x, y, z0 + (z1 - z0) * t);
      if (d < 2e-4) break;
      y -= Math.max(d * 0.8, 3e-4);
    }
    const p = S.projectToSurface(upper, [x, y, z0 + (z1 - z0) * t], 0, 4);
    pts.push(S.addScaled(p, S.sdfNormal(upper, p), 0.0012));
  }
  return flatColor(tubeMesh(pts, () => 0.0008, { samples: 24, radial: 4 }), [0.04, 0.04, 0.045]);
}

/**
 * Sock as an exact tube around the body's ankle (character-body `bodyLimbs.ts`: ankle ellipsoid
 * of radius Ak plus malleoli, medial 6 mm higher), from inside the shoe to a rolled ribbed cuff.
 */
function sockTube(fr: ShoeFrame, Ak: number, soleH: number, top: number, color: RGB, seed: number): ColoredMesh {
  const up = S.normalize(fr.legDir);
  const e1 = S.normalize(S.sub([1, 0, 0], S.scale(up, up[0])));
  const e2 = S.cross(e1, up);
  const radial = 22;
  const t0 = soleH + 0.012 - fr.ankle[1], t1 = top - fr.ankle[1];
  const rings: Array<{ t: number; inset: number; out: number }> = [];
  const n = 9;
  for (let i = 0; i <= n; i += 1) rings.push({ t: t0 + ((t1 - t0) * i) / n, inset: 0, out: 1 });
  // Rolled cuff: over the top and a little way down the inside.
  rings.push({ t: t1 + 0.0012, inset: 0.0012, out: 0.4 }, { t: t1, inset: 0.0026, out: -1 }, { t: t1 - 0.006, inset: 0.0028, out: -1 });
  const positions: number[] = [], normals: number[] = [], colors: number[] = [], index: number[] = [];
  const radius = (theta: number, t: number) => {
    // e1 points medially (+x for the right shoe); theta = 0 medial, π lateral.
    const med = 0.37 * Ak * Math.pow(Math.max(0, Math.cos(theta)), 3) * Math.exp(-(((t - 0.006) / 0.013) ** 2));
    const lat = 0.35 * Ak * Math.pow(Math.max(0, Math.cos(theta - Math.PI + 0.25)), 3) * Math.exp(-(((t + 0.006) / 0.013) ** 2));
    return Ak + 0.0026 + med + lat;
  };
  rings.forEach((ring, i) => {
    const c = S.addScaled(fr.ankle, up, ring.t);
    for (let j = 0; j < radial; j += 1) {
      const th = (j / radial) * Math.PI * 2;
      const dir = S.add(S.scale(e1, Math.cos(th)), S.scale(e2, Math.sin(th)));
      const r = radius(th, Math.min(ring.t, t1)) - ring.inset;
      const p = S.addScaled(c, dir, r);
      positions.push(p[0], p[1], p[2]);
      const nn = ring.out >= 0 ? S.normalize(S.add(S.scale(dir, ring.out), S.scale(up, 1 - ring.out))) : S.scale(dir, -1);
      normals.push(nn[0], nn[1], nn[2]);
      const rib = ring.t > t1 - 0.012 ? 0.88 + 0.12 * (Math.sin(th * 18) > 0 ? 1 : 0) : 1;
      const k = rib * (1 + 0.03 * noise3(p[0] * 400, p[1] * 400, p[2] * 400, seed + 8)) * (ring.out < 0 ? 0.55 : 1);
      colors.push(color[0] * k, color[1] * k, color[2] * k);
    }
    if (i > 0) {
      for (let j = 0; j < radial; j += 1) {
        const a = (i - 1) * radial + j, b = (i - 1) * radial + ((j + 1) % radial), cc = a + radial, d = b + radial;
        // (b − a) × (c − a) = tangent × up points inward here, so wind (a, c, b) for outward faces.
        index.push(a, cc, b, b, cc, d);
      }
    }
  });
  return { positions: Float32Array.from(positions), normals: Float32Array.from(normals), indices: Uint32Array.from(index), colors: Float32Array.from(colors) };
}

/**
 * A raised band lying on a surface (exact, crisp edges at any resolution): centre points come from
 * `at(t)` marched onto the surface along +x, edges are projected back onto it, the top is lifted
 * by `lift` and closed with side walls. Used for the runner's speed stripe.
 */
function surfaceRibbon(surface: Sdf, at: (t: number) => V3, half: (t: number) => number, lift: number, color: RGB, hero: boolean): ColoredMesh {
  const samples = hero ? 64 : 32;
  const land = (p: V3): V3 => {
    let x = p[0];
    for (let i = 0; i < 80; i += 1) {
      const d = surface.d(x, p[1], p[2]);
      if (d < 2e-4) break;
      x += Math.max(d * 0.8, 3e-4);
    }
    return S.projectToSurface(surface, [x, p[1], p[2]], 0, 3);
  };
  // Keep only samples that truly landed on the surface (a ray can miss through an opening).
  const centre: V3[] = [];
  const ts: number[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const p = land(at(i / samples));
    if (Math.abs(surface.d(p[0], p[1], p[2])) < 5e-4 && Math.abs(p[0]) < 0.09) {
      centre.push(p);
      ts.push(i / samples);
    }
  }
  if (centre.length < 3) return { positions: new Float32Array(0), normals: new Float32Array(0), indices: new Uint32Array(0), colors: new Float32Array(0) };
  const positions: number[] = [], normals: number[] = [], colors: number[] = [], index: number[] = [];
  const add = (p: V3, n: V3, shade: number) => {
    positions.push(p[0], p[1], p[2]);
    normals.push(n[0], n[1], n[2]);
    colors.push(color[0] * shade, color[1] * shade, color[2] * shade);
    return positions.length / 3 - 1;
  };
  const rows: number[][] = [];
  const last = centre.length - 1;
  for (let i = 0; i <= last; i += 1) {
    const t = ts[i];
    const c = centre[i];
    const n = S.sdfNormal(surface, c);
    const tan = S.normalize(S.sub(centre[Math.min(last, i + 1)], centre[Math.max(0, i - 1)]));
    const b = S.normalize(S.cross(n, tan));
    const h = half(t);
    const e0 = S.projectToSurface(surface, S.addScaled(c, b, h), 0, 3), e1 = S.projectToSurface(surface, S.addScaled(c, b, -h), 0, 3);
    const n0 = S.sdfNormal(surface, e0), n1 = S.sdfNormal(surface, e1);
    // Stitch row (hero): darker dashes just inside each edge.
    const stitch = hero && Math.sin(t * samples * 3.1) > 0.2 ? 0.62 : 1;
    rows.push([
      add(S.addScaled(e0, n0, -0.0004), b, 1),
      add(S.addScaled(e0, n0, lift), S.normalize(S.add(n0, S.scale(b, 0.6))), 1),
      add(S.addScaled(S.lerp(e0, c, 0.22), n0, lift), n, stitch),
      add(S.addScaled(c, n, lift), n, 1),
      add(S.addScaled(S.lerp(e1, c, 0.22), n1, lift), n, stitch),
      add(S.addScaled(e1, n1, lift), S.normalize(S.sub(n1, S.scale(b, 0.6))), 1),
      add(S.addScaled(e1, n1, -0.0004), S.scale(b, -1), 1),
    ]);
  }
  for (let i = 0; i < last; i += 1) {
    for (let j = 0; j < 6; j += 1) {
      const a = rows[i][j], bb = rows[i][j + 1], c = rows[i + 1][j], d = rows[i + 1][j + 1];
      index.push(a, bb, c, bb, d, c);
    }
  }
  // Orient every triangle to agree with its vertex normals.
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    if (gx * (normals[a] + normals[b] + normals[c]) + gy * (normals[a + 1] + normals[b + 1] + normals[c + 1]) + gz * (normals[a + 2] + normals[b + 2] + normals[c + 2]) < 0) {
      const tmp = index[t + 1];
      index[t + 1] = index[t + 2];
      index[t + 2] = tmp;
    }
  }
  return { positions: Float32Array.from(positions), normals: Float32Array.from(normals), indices: Uint32Array.from(index), colors: Float32Array.from(colors) };
}
