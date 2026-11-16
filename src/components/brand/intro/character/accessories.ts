/**
 * Helmet, sunglasses, hair tie, watch (worker-safe). OWNER: character-details agent.
 *
 * - `helmet` (Leo, rigid on `head`): aero road shell described radially over the cranium — its
 *   liner clears the scalp by the (compressed) hair thickness, a short tail, five vents, paint:
 *   white shell, graphite rim band, coral centre stripe, dark vent ports and liner.
 *   `helmetStraps` (separate so the director can hide them while the helmet is carried): flat
 *   webbing from the rim around the ears to a buckle under the chin.
 * - `sunglassesLens` (role lens) + `sunglassesFrame` (plastic), rigid on `head`: one wrap shield
 *   (exact parametric surface, 2 mm thick, nose cut-out) clear of brows/lids/nose, top bar,
 *   nose pads and temples that run over the ears outside the hair.
 * - `hairTie` (Maya, rigid on `pony1`): coral band around the ponytail root.
 * - `watch` (Maya, rigid on `lowerArm_L`): band + case on the back of the left wrist, dark glass
 *   with a coral activity ring.
 * All geometry here is exact (parametric tubes/lathes) except the helmet shell (SDF).
 */
import type { RawMesh, Sdf, V3 } from "../sdf/api";
import * as S from "../sdf/index";
import { pointOf, segmentDirection, type BindPose, type BoneName } from "../rig/skeleton";
import { noise3 } from "../math";
import type { CharacterSpec, MeshPart } from "./types";
import { applyOcclusion, flatColor, lin, mergeColored, mix3, paintMesh, rigidPart, sstep, tubeMesh, type ColoredMesh, type RGB } from "./details/kit";
import { sculptHead } from "./details/headSculpt";
import { craniumWithHair, hairAngles, hairMap, knotCurve } from "./details/hairShape";
import { decimate } from "./details/decimate";

const DEG = Math.PI / 180;
/** Triangle budget of the helmet shell. */
export const HELMET_TRIS = 10000;

/** Rigid parts (bone-local). Names: "helmet", "helmetStraps", "sunglassesFrame", "sunglassesLens", "hairTie", "watch". */
export function buildAccessories(spec: CharacterSpec, bind: BindPose): MeshPart[] {
  const parts: MeshPart[] = [];
  const extras = spec.outfit.extras;
  if (extras.includes("helmet")) parts.push(...helmet(spec, bind));
  if (extras.includes("sunglasses")) parts.push(...sunglasses(spec, bind));
  if (extras.includes("hairTie")) parts.push(hairTie(spec, bind));
  if (extras.includes("watch")) parts.push(watch(spec, bind));
  return parts;
}

const toPart = (name: string, role: MeshPart["role"], m: ColoredMesh, bone: BoneName, opts: { roughness?: number; castShadow?: boolean } = {}): MeshPart =>
  rigidPart(name, role, m, m.colors, bone, opts);

// ---------------------------------------------------------------------------------------------
// Helmet

/** Elevation of the helmet rim at |azimuth| (front edge above the brows, low at the occiput). */
const RIM = knotCurve([[0, 17.5], [35, 15.5], [70, 13], [95, 12], [120, 4], [150, -7], [180, -11]]);

function helmet(spec: CharacterSpec, bind: BindPose): MeshPart[] {
  const sculpt = sculptHead(spec, bind);
  const map = hairMap(spec, bind);
  const k = sculpt.k;
  const [cx, cy, cz] = map.center;
  const { craniumRadius, thickness, shellLine } = map;
  // Liner hugs the scalp; the outer surface clears the hair (crop + tufts) by 2 mm with a minimum
  // wall, so the hair sits inside the shell's solid volume and never shows through it.
  const liner = (az: number, beta: number) => craniumRadius(az, beta) + 0.006 * k;
  const outerR = (az: number, beta: number) => {
    const inHair = beta > shellLine(az);
    const hairTop = craniumRadius(az, beta) + (inHair ? thickness(az, beta) + 0.0018 * k : 0) + 0.002 * k;
    const tail = 0.024 * k * Math.exp(-(((az - Math.PI) / 0.42) ** 2)) * Math.exp(-(((beta - 8 * DEG) / (15 * DEG)) ** 2));
    return Math.max(hairTop, liner(az, beta) + 0.0105 * k) + tail;
  };
  const wall = (az: number, beta: number) => outerR(az, beta) - liner(az, beta);
  // Tabulate liner, outer radius and rim over (|az|, β): the shell evaluates with lookups only.
  const NA = 90, NB = 100, B0 = -60 * DEG, B1 = 90 * DEG;
  const linT = new Float32Array((NA + 1) * (NB + 1)), outT = new Float32Array((NA + 1) * (NB + 1)), rimT = new Float32Array(NA + 1);
  for (let i = 0; i <= NA; i += 1) {
    const az = (i / NA) * Math.PI;
    rimT[i] = RIM(az);
    for (let j = 0; j <= NB; j += 1) {
      const beta = B0 + ((B1 - B0) * j) / NB;
      linT[i * (NB + 1) + j] = liner(az, beta);
      outT[i * (NB + 1) + j] = outerR(az, beta);
    }
  }
  const look = (T: Float32Array, az: number, beta: number) => {
    const fa = Math.min(NA - 1e-6, Math.max(0, (az / Math.PI) * NA));
    const fb = Math.min(NB - 1e-6, Math.max(0, ((beta - B0) / (B1 - B0)) * NB));
    const i = fa | 0, j = fb | 0, u = fa - i, v = fb - j;
    const o = i * (NB + 1) + j;
    const a0 = T[o] + (T[o + 1] - T[o]) * v, a1 = T[o + NB + 1] + (T[o + NB + 2] - T[o + NB + 1]) * v;
    return a0 + (a1 - a0) * u;
  };
  const rimAt = (az: number) => {
    const f = Math.min(NA - 1e-6, Math.max(0, (az / Math.PI) * NA));
    const i = f | 0;
    return rimT[i] + (rimT[i + 1] - rimT[i]) * (f - i);
  };
  // Vents cut through the outer wall, placed in angular coordinates on the shell.
  const onShell = (azDeg: number, betaDeg: number, sx: number, depth: number): V3 => {
    const az = azDeg * DEG, beta = betaDeg * DEG;
    const r = liner(az, beta) + wall(az, beta) * depth;
    return [cx + sx * Math.sin(az) * Math.cos(beta) * r, cy + Math.sin(beta) * r, cz + Math.cos(az) * Math.cos(beta) * r];
  };
  const vents: Sdf[] = [];
  for (const sx of [1, -1]) {
    vents.push(S.capsule(onShell(10, 28, sx, 0.9), onShell(14, 58, sx, 0.9), 0.0052 * k));
    vents.push(S.capsule(onShell(30, 24, sx, 0.9), onShell(40, 50, sx, 0.9), 0.0048 * k));
    vents.push(S.capsule(onShell(150, 22, sx, 0.9), onShell(160, 36, sx, 0.9), 0.0045 * k));
  }
  const ventSdf = S.union(...vents);
  const b = sculpt.cranium.bounds;
  const pad = 0.06 * k;
  const shell = S.custom(
    (x, y, z) => {
      const dx = x - cx, dy = y - cy, dz = z - cz;
      const h = Math.sqrt(dx * dx + dz * dz);
      const az = Math.atan2(dx < 0 ? -dx : dx, dz);
      const beta = Math.atan2(dy, h);
      const rho = Math.sqrt(h * h + dy * dy);
      const outer = rho - look(outT, az, beta);
      const inner = look(linT, az, beta) - rho;
      const rim = (rimAt(az) - beta) * rho;
      return Math.max(outer, inner, rim) / 1.6;
    },
    { min: [b.min[0] - pad, b.min[1], b.min[2] - pad], max: [b.max[0] + pad, b.max[1] + pad, b.max[2] + pad] },
  );
  const sdf = S.smoothSubtract(0.003 * k, shell, ventSdf);
  const dense = S.meshSdf(sdf, { cell: 0.0062 * k });
  const ao = S.bakeAO(dense, S.union(sdf, craniumWithHair(spec, bind)), { steps: 3, stepSize: 0.004 * k, strength: 1 });
  const white = lin(0xf2f2ef), graphite = lin(0x2a2d30), coral = lin(spec.outfit.top.accent), liner2: RGB = [0.03, 0.032, 0.035];
  const ventD = S.tiledSdf(ventSdf, 0.03).d;
  const colors = paintMesh(dense, (out, x, y, z, nx, ny, nz) => {
    const [az, beta, rho] = hairAngles(map.center, x, y, z);
    const dx = x - cx, dy = y - cy, dz = z - cz;
    const outward = (nx * dx + ny * dy + nz * dz) / (rho || 1);
    let c: RGB = [white[0], white[1], white[2]];
    // Graphite band above the rim (the exposed foam edge) and the dark liner inside.
    const aboveRim = (beta - rimAt(az)) * rho;
    c = mix3(c, graphite, sstep(0.011 * k, 0.008 * k, aboveRim));
    if (outward < 0.1) c = liner2;
    // Coral centre stripe front to back, and around the tail tip.
    if (Math.abs(x) < 0.0065 * k && outward > 0.3) c = mix3(c, coral, sstep(0.0065 * k, 0.0045 * k, Math.abs(x)));
    // Vent ports darker inside.
    if (ventD(x, y, z) < 0.0035 * k) c = mix3(c, liner2, 0.85);
    const n = 1 + 0.015 * noise3(x * 300, y * 300, z * 300, spec.seed);
    out[0] = c[0] * n;
    out[1] = c[1] * n;
    out[2] = c[2] * n;
  });
  applyOcclusion(colors, ao, { strength: 0.7, gamma: 1.2, tint: [0.3, 0.3, 0.31] });
  // The shell is smooth almost everywhere: thin only flat areas (vents, rim and paint edges keep
  // their density).
  const mesh = dense.indices.length / 3 > HELMET_TRIS * 1.15 ? decimate(dense, { targetTriangles: HELMET_TRIS, colors, colorWeight: 80, minNormalDot: 0.993 }) : { ...dense, colors };
  const shellPart = rigidPart("helmet", "plastic", mesh, mesh.colors ?? colors, "head", { roughness: 0.28 });

  // Straps: flat webbing from the rim in front of / behind the ear to a buckle under the chin.
  const a = sculpt.anchors;
  const head = craniumWithHair(spec, bind, 0.003 * k);
  const hug = (p: V3): V3 => {
    // Push a guide point out to just above the head/hair surface (radially from the cranium centre).
    const d = S.normalize([p[0] - cx, p[1] - cy, p[2] - cz]);
    let r = 0.2 * k;
    for (let i = 0; i < 60; i += 1) {
      const v = head.d(cx + d[0] * r, cy + d[1] * r, cz + d[2] * r);
      if (Math.abs(v) < 2e-4) break;
      r -= v * 0.9;
    }
    return [cx + d[0] * r, cy + d[1] * r, cz + d[2] * r];
  };
  const rimPoint = (azDeg: number, sx: number): V3 => {
    const az = azDeg * DEG, beta = RIM(az) + 1.5 * DEG;
    const rr = liner(az, beta);
    return [cx + sx * Math.sin(az) * Math.cos(beta) * rr, cy + Math.sin(beta) * rr, cz + Math.cos(az) * Math.cos(beta) * rr];
  };
  const strapMeshes: RawMesh[] = [];
  const chin = a.chin;
  const buckle: V3 = [0.0, chin[1] - 0.012 * k, chin[2] - 0.026 * k];
  for (const sx of [1, -1]) {
    const junction = hug([sx * (a.ear[0] - 0.004 * k), a.ear[1] - 0.034 * k, a.ear[2] + 0.004 * k]);
    const fwd = [rimPoint(78, sx), hug([sx * (a.ear[0] - 0.002 * k), a.ear[1] - 0.004 * k, a.ear[2] + 0.024 * k]), junction];
    const back = [rimPoint(118, sx), hug([sx * (a.ear[0] - 0.004 * k), a.ear[1] - 0.006 * k, a.ear[2] - 0.026 * k]), junction];
    const jaw = (p: V3): V3 => {
      // Just under the jawline: march up from below onto the face surface.
      let y = p[1] - 0.03 * k;
      for (let i = 0; i < 60; i += 1) {
        const d = sculpt.sdf.d(p[0], y, p[2]);
        if (d < 0.0035 * k) break;
        y += Math.max(d - 0.0035 * k, 3e-4);
      }
      return [p[0], y, p[2]];
    };
    const down = [junction, jaw([sx * (a.gonion[0] - 0.004 * k), a.gonion[1], a.gonion[2] + 0.012 * k]), jaw([sx * 0.024 * k, chin[1], chin[2] - 0.026 * k]), buckle];
    for (const path of [fwd, back, down]) strapMeshes.push(tubeMesh(path, () => 0.0042 * k, { samples: 18, radial: 6, aspect: () => 0.22 }));
  }
  const buckleMesh = S.meshSdf(S.roundBox(buckle, [0.011 * k, 0.004 * k, 0.007 * k], 0.002 * k), { cell: 0.0018 });
  const straps = mergeColored([flatColor(S.mergeMeshes(strapMeshes), lin(0x1e2022)), flatColor(buckleMesh, lin(0x2d3033))]);
  return [shellPart, toPart("helmetStraps", "plastic", straps, "head", { roughness: 0.7, castShadow: false })];
}

// ---------------------------------------------------------------------------------------------
// Sunglasses

function sunglasses(spec: CharacterSpec, bind: BindPose): MeshPart[] {
  const sculpt = sculptHead(spec, bind);
  const k = sculpt.k;
  const a = sculpt.anchors;
  const ey = a.eye[1];
  // Wrap shield on an ellipsoid around the face: front ~2 cm ahead of the corneas.
  const cz = 0.0;
  const rz = a.nasion[2] + 0.019 * k - cz, rx = 0.084 * k, ry = 0.1 * k;
  const thMax = 60 * DEG;
  const top = (th: number) => ey + 0.019 * k - 0.006 * k * th * th;
  const bot = (th: number) => ey - 0.023 * k + 0.008 * k * th * th + 0.017 * k * Math.exp(-((th / 0.2) ** 2));
  const at = (th: number, y: number, inset: number): V3 => {
    const sy = Math.sqrt(Math.max(0, 1 - ((y - ey) / ry) ** 2));
    return [(rx - inset) * Math.sin(th) * sy, y, cz + (rz - inset) * Math.cos(th) * sy];
  };
  const NU = 40, NV = 10;
  const pos: number[] = [], nrm: number[] = [], col: number[] = [], idx: number[] = [];
  const lensTop = lin(0x5c2a1f), lensBot = lin(0x1a1416);
  const thick = 0.0021 * k;
  // Front and back faces of the shield (back slightly inset), then the rim strip.
  for (const face of [0, 1]) {
    const base = pos.length / 3;
    for (let i = 0; i <= NU; i += 1) {
      const th = -thMax + (2 * thMax * i) / NU;
      for (let j = 0; j <= NV; j += 1) {
        const y = bot(th) + ((top(th) - bot(th)) * j) / NV;
        const p = at(th, y, face ? thick : 0);
        pos.push(p[0], p[1], p[2]);
        const sy = Math.sqrt(Math.max(1e-6, 1 - ((y - ey) / ry) ** 2));
        let n = S.normalize([Math.sin(th) * sy / rx, (y - ey) / (ry * ry) * 0.6, Math.cos(th) * sy / rz]);
        if (face) n = S.scale(n, -1);
        nrm.push(n[0], n[1], n[2]);
        const c = mix3(lensBot, lensTop, j / NV);
        col.push(c[0], c[1], c[2]);
      }
    }
    for (let i = 0; i < NU; i += 1) {
      for (let j = 0; j < NV; j += 1) {
        const p0 = base + i * (NV + 1) + j, p1 = p0 + NV + 1;
        if (face) idx.push(p0, p0 + 1, p1, p1, p0 + 1, p1 + 1);
        else idx.push(p0, p1, p0 + 1, p1, p1 + 1, p0 + 1);
      }
    }
  }
  const lensMesh: ColoredMesh = { positions: Float32Array.from(pos), normals: Float32Array.from(nrm), indices: Uint32Array.from(orient(idx, pos, nrm)), colors: Float32Array.from(col) };

  // Frame: top bar along the shield's upper edge, nose pads, temples over the ears.
  const frame: RawMesh[] = [];
  const topEdge: V3[] = [];
  for (let i = 0; i <= 24; i += 1) {
    const th = -thMax + (2 * thMax * i) / 24;
    topEdge.push(at(th, top(th) + 0.0006 * k, thick * 0.5));
  }
  frame.push(tubeMesh(topEdge, (t) => k * (0.0022 + 0.0008 * Math.sin(Math.PI * t)), { samples: 60, radial: 7, aspect: () => 0.7, up: [0, 1, 0] }));
  const headHair = craniumWithHair(spec, bind, 0.0035 * k);
  const outside = (p: V3, sx: number): V3 => {
    // March inward along x to the head+hair surface, then stay just outside it.
    let x = sx * 0.12 * k;
    for (let i = 0; i < 80; i += 1) {
      const d = Math.min(headHair.d(x, p[1], p[2]), sculpt.sdf.d(x, p[1], p[2]) - 0.003 * k);
      if (d < 2e-4) break;
      x -= sx * Math.max(d * 0.8, 3e-4);
    }
    return [x, p[1], p[2]];
  };
  for (const sx of [1, -1]) {
    const start = at(sx * thMax, top(thMax) - 0.002 * k, thick * 0.5);
    const temple = [
      start,
      outside([0, ey + 0.012 * k, a.eye[2] - 0.035 * k], sx),
      outside([0, ey + 0.009 * k, a.ear[2] + 0.012 * k], sx),
      outside([0, ey + 0.004 * k, a.ear[2] - 0.014 * k], sx),
      outside([0, ey - 0.016 * k, a.ear[2] - 0.03 * k], sx),
    ];
    frame.push(tubeMesh(temple, () => 0.0021 * k, { samples: 40, radial: 6, aspect: () => 0.55, up: [0, 1, 0] }));
    // Nose pad: from the cut-out edge to the side of the bridge.
    const padStart = at(sx * 0.12, bot(0.12) + 0.001 * k, thick);
    const padEnd: V3 = [sx * 0.0085 * k, ey - 0.012 * k, a.nasion[2] - 0.004 * k];
    frame.push(tubeMesh([padStart, S.lerp(padStart, padEnd, 0.5), padEnd], () => 0.0017 * k, { samples: 8, radial: 6 }));
  }
  const frameMesh = flatColor(S.mergeMeshes(frame), lin(0x1b1d20));
  return [
    toPart("sunglassesFrame", "plastic", frameMesh, "head", { roughness: 0.3, castShadow: false }),
    toPart("sunglassesLens", "lens", lensMesh, "head", { castShadow: false }),
  ];
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

// ---------------------------------------------------------------------------------------------
// Hair tie and watch

function hairTie(spec: CharacterSpec, bind: BindPose): MeshPart {
  const k = sculptHead(spec, bind).k;
  const dir = segmentDirection(bind, "pony1") ?? [0, -1, 0];
  const n1 = S.normalize(S.cross(dir, [1, 0, 0]));
  const n2 = S.cross(dir, n1);
  // Around the ponytail just below the gathered root (ponytail radius ≈ 10 mm there).
  const c = S.scale(dir, 0.004 * k);
  const R = 0.0128 * k, r = 0.0036 * k;
  const ring: V3[] = [];
  for (let i = 0; i <= 40; i += 1) {
    const a = (i / 40) * Math.PI * 2;
    ring.push(S.add(c, S.add(S.scale(n1, Math.cos(a) * R), S.scale(n2, Math.sin(a) * R))));
  }
  const m = tubeMesh(ring, () => r, { samples: 48, radial: 8, caps: false, up: dir, aspect: () => 1.35 });
  const coral = lin(spec.outfit.top.color);
  const colors = paintMesh(m, (out, x, y, z) => {
    const n = 0.9 + 0.1 * Math.sin(Math.atan2(S.dot([x, y, z], n2), S.dot([x, y, z], n1)) * 30);
    out[0] = coral[0] * n;
    out[1] = coral[1] * n;
    out[2] = coral[2] * n;
  });
  return rigidPart("hairTie", "fabric", m, colors, "pony1", { castShadow: false });
}

function watch(spec: CharacterSpec, bind: BindPose): MeshPart {
  const fem = bind.proportions.sex === "female";
  const elbow = pointOf(bind, "lowerArm_L"), wrist = pointOf(bind, "hand_L");
  const along = S.normalize(S.sub(wrist, elbow));
  const fwd = S.normalize(S.sub([0, 0, 1], S.scale(along, along[2])));
  // Palm faces the thigh; the dial sits on the back of the wrist (lateral side for A-pose).
  const back = S.normalize(S.cross(fwd, along));
  // Body forearm near the wrist (character-body limbGirths): thin (lateral) and wide (forward).
  const sb = bind.proportions.height / (fem ? 1.68 : 1.8);
  const mus = 0.92 + 0.16 * spec.build.muscle;
  const thin = sb * (fem ? 0.0178 : 0.0205) * mus * 1.07 + 0.0012, wide = sb * (fem ? 0.0262 : 0.0298) * mus * 0.98 + 0.0012;
  const centre = S.addScaled(wrist, along, -0.036);
  const local = (p: V3): V3 => S.sub(p, elbow);
  // Band: flat loop around the wrist.
  const loop: V3[] = [];
  for (let i = 0; i <= 48; i += 1) {
    const a = (i / 48) * Math.PI * 2;
    loop.push(local(S.add(centre, S.add(S.scale(back, Math.cos(a) * (thin + 0.0016)), S.scale(fwd, Math.sin(a) * (wide + 0.0016))))));
  }
  const band = tubeMesh(loop, () => 0.0105, { samples: 64, radial: 8, caps: false, up: along, aspect: () => 0.16 });
  // Case: a short rounded drum on the back of the wrist, glass face up.
  const face = S.addScaled(centre, back, thin + 0.004);
  const caseSdf = S.cylinder(local(S.addScaled(face, back, -0.006)), local(S.addScaled(face, back, 0.0058)), 0.0185, 0.0028);
  const caseMesh = S.meshSdf(caseSdf, { cell: 0.0024 });
  const faceL = local(S.addScaled(face, back, 0.0058));
  const graphite = lin(0x232629), glass: RGB = [0.012, 0.013, 0.016], coral = lin(spec.outfit.top.color);
  const caseC = paintMesh(caseMesh, (out, x, y, z, nx, ny, nz) => {
    const up = nx * back[0] + ny * back[1] + nz * back[2];
    const d = Math.hypot(x - faceL[0], y - faceL[1], z - faceL[2]);
    let c: RGB = up > 0.8 && d < 0.0155 ? glass : graphite;
    // Activity ring on the display.
    if (up > 0.8 && d > 0.0085 && d < 0.0108) c = coral;
    out[0] = c[0];
    out[1] = c[1];
    out[2] = c[2];
  });
  const merged = mergeColored([flatColor(band, lin(0x1c1e20)), { ...caseMesh, colors: caseC }]);
  const ao = S.bakeAO(merged, caseSdf, { steps: 2, stepSize: 0.002, strength: 0.6 });
  applyOcclusion(merged.colors, ao, { strength: 0.6 });
  return rigidPart("watch", "plastic", merged, merged.colors, "lowerArm_L", { roughness: 0.25, castShadow: false });
}
