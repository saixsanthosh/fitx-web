/**
 * Road bike built to `BIKE` (dimensions.ts): carbon frame with oval tube sections, drop bars with
 * coral tape, hoods and levers, deep carbon rims with tan-wall tyres, bladed spokes (and a blurred
 * spoke disc for speed), disc rotors and calipers, 50/34 chainrings, an 11-speed cassette, a moving
 * chain wrapped through the rear derailleur, crank arms and clipless pedals.
 *
 * Local space: origin on the ground under the bottom bracket, bike faces +Z, drive side is the
 * bike's right = -X. Crank angle 0 = right crank forward; positive angles pedal forward.
 */

import * as THREE from "three";
import { BIKE } from "../../dimensions";
import { clamp01, smoothstep } from "../../math";
import { CORAL } from "../palettes";
import type { BikeProp } from "../types";
import { Disposer, canvasTexture, spokeBlurCanvas } from "../util/canvas";
import { GeometryBatch, box, curveThrough, cylinderBetween, extrude, lathe, m4, paint, sweep, type V3 } from "../util/geometry";
import { beltPath, gearShape, pitchRadius, sampleBelt, type BeltCircle } from "./mechanics";

const PITCH = 0.0127;
const CHAIN_X_FRONT = -0.047;
const CHAIN_X_REAR = -0.06;
const COLORS = {
  frame: 0x14171b,
  frameAccent: CORAL,
  carbon: 0x161819,
  decal: 0x6b6e71,
  tyre: 0x1b1c1d,
  tanwall: 0x9c7a55,
  alloy: 0x2b2d30,
  silver: 0xbfc3c6,
  chain: 0x8f9499,
  rotor: 0xb9bdc0,
  tape: CORAL,
  saddle: 0x1c1e20,
  bottle: 0xf2f0ea,
} as const;

const X = new THREE.Vector3(1, 0, 0);
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Pedal spindle centres in bike space for a crank angle: [left (+X), right (-X)]. */
export function bikePedalLocal(crankAngle: number): [V3, V3] {
  const [, cy, cz] = BIKE.crankCenter;
  const L = BIKE.crankLength;
  const right: V3 = [-BIKE.pedalOffsetX, cy - Math.sin(crankAngle) * L, cz + Math.cos(crankAngle) * L];
  const left: V3 = [BIKE.pedalOffsetX, cy + Math.sin(crankAngle) * L, cz - Math.cos(crankAngle) * L];
  return [left, right];
}

function tube(points: V3[], r1: number | ((t: number) => number), r2?: number | ((t: number) => number), segs = 24, radial = 14) {
  return sweep(curveThrough(points), { radius: r1, radius2: r2 ?? r1, tubularSegments: segs, radialSegments: radial, reference: X, caps: true });
}

function buildFrame(paintBatch: GeometryBatch) {
  const accent = (g: THREE.BufferGeometry, from: number, to: number) => {
    // Coral band on part of a tube (uses the sweep's u = meters along the tube).
    const uv = g.attributes.uv;
    const col = g.attributes.color as THREE.BufferAttribute;
    const c = new THREE.Color(COLORS.frameAccent);
    for (let i = 0; i < uv.count; i += 1) {
      const u = uv.getX(i);
      if (u >= from && u <= to) col.setXYZ(i, c.r, c.g, c.b);
    }
    return g;
  };
  const add = (g: THREE.BufferGeometry, band?: [number, number]) => {
    paint(g, COLORS.frame);
    if (band) accent(g, band[0], band[1]);
    paintBatch.take(g);
  };
  const ht = BIKE.headTubeTop;
  const axis = v(0, -0.956, 0.292).normalize();
  const htTop = v(ht[0], ht[1], ht[2]);
  const htBot = htTop.clone().addScaledVector(axis, 0.145);
  // Head tube (tapered), top tube, down tube, seat tube.
  add(sweep(new THREE.LineCurve3(htTop.clone().addScaledVector(axis, -0.012), htBot.clone().addScaledVector(axis, 0.014)), { radius: (t) => 0.024 + t * 0.009, radius2: (t) => 0.029 + t * 0.009, tubularSegments: 8, radialSegments: 20, reference: X, caps: true }), [0.0, 0.03]);
  add(tube([[0, 0.816, 0.39], [0, 0.79, 0.19], [0, 0.74, -0.13]], (t) => 0.018 - t * 0.003, (t) => 0.027 - t * 0.006, 24, 18));
  add(tube([[0, 0.71, 0.428], [0, 0.52, 0.245], [0, 0.3, 0.04]], (t) => 0.026 + t * 0.003, (t) => 0.035 + t * 0.007, 24, 20));
  add(tube([[0, 0.262, 0.004], [0, 0.5, -0.066], [0, 0.765, -0.145]], (t) => 0.021 - t * 0.003, (t) => 0.03 - t * 0.005, 24, 18));
  // Bottom bracket shell.
  const bb = new THREE.CylinderGeometry(0.024, 0.024, 0.088, 20, 1, false).rotateZ(Math.PI / 2).translate(0, BIKE.crankCenter[1], 0);
  add(bb);
  // Seat stays and chain stays (both sides).
  const [, ry, rz] = BIKE.rearAxle;
  for (const sx of [-1, 1]) {
    add(tube([[0.02 * sx, 0.69, -0.12], [0.045 * sx, 0.52, -0.27], [0.062 * sx, ry + 0.016, rz + 0.012]], (t) => 0.0125 - t * 0.0035, (t) => 0.016 - t * 0.005, 18, 12), [0.04, 0.1]);
    add(tube([[0.032 * sx, BIKE.crankCenter[1] - 0.004, -0.04], [0.061 * sx, 0.29, -0.22], [0.063 * sx, ry - 0.008, rz + 0.016]], (t) => 0.016 - t * 0.0055, (t) => 0.02 - t * 0.007, 18, 12));
    // Dropout plates.
    paintBatch.add(box(0.008, 0.04, 0.04, 0.004, 1), m4([0.064 * sx, ry, rz + 0.004]), COLORS.frame);
  }
  // Fork: crown + curved blades to the front dropouts.
  const crown = htBot.clone().addScaledVector(axis, 0.018);
  paintBatch.add(box(0.11, 0.034, 0.058, 0.014, 2), m4([crown.x, crown.y, crown.z], [-0.3, 0, 0]), COLORS.frame);
  const [, fy, fz] = BIKE.frontAxle;
  for (const sx of [-1, 1]) {
    add(tube([[0.042 * sx, crown.y - 0.005, crown.z + 0.004], [0.048 * sx, 0.52, 0.5], [0.051 * sx, fy + 0.05, fz - 0.012], [0.052 * sx, fy, fz]], (t) => 0.0165 - t * 0.0065, (t) => 0.025 - t * 0.011, 20, 12), [0.16, 0.3]);
  }
  // Steerer above the head tube, spacers and top cap.
  const steererTop = htTop.clone().addScaledVector(axis, -0.032);
  paintBatch.add(cylinderBetween(htTop.clone().addScaledVector(axis, -0.012), steererTop, 0.0175, 16), undefined, COLORS.alloy);
  return { htTop, steererTop, crown };
}

function buildCockpit(paintBatch: GeometryBatch, tapeBatch: GeometryBatch, rubberBatch: GeometryBatch, steererTop: THREE.Vector3) {
  const bar = v(...BIKE.barCenter);
  // Stem: from steerer clamp to the bar clamp, slightly negative rise.
  const stem = sweep(new THREE.LineCurve3(steererTop.clone().add(v(0, 0, -0.012)), bar.clone().add(v(0, 0.001, 0.006))), { radius: 0.0155, radius2: 0.019, tubularSegments: 6, radialSegments: 12, reference: X, caps: true });
  paintBatch.take(stem, undefined, COLORS.frame);
  paintBatch.add(box(0.045, 0.034, 0.04, 0.01, 2), m4([steererTop.x, steererTop.y - 0.002, steererTop.z]), COLORS.frame);
  paintBatch.add(box(0.06, 0.036, 0.034, 0.01, 2), m4([bar.x, bar.y, bar.z]), COLORS.frame);
  // Bar centre (bare carbon), then taped tops → bend → hoods → drops on each side.
  paintBatch.take(new THREE.CylinderGeometry(0.0158, 0.0158, 0.12, 16).rotateZ(Math.PI / 2).translate(bar.x, bar.y, bar.z), undefined, COLORS.carbon);
  const half = BIKE.barHalfWidth;
  for (const sx of [-1, 1]) {
    const o = (x: number, y: number, z: number): V3 => [x * sx, bar.y + y, bar.z + z];
    const pts: V3[] = [
      o(0.05, 0, 0),
      o(0.14, 0, 0),
      o(0.183, 0.001, 0.012),
      o(half - 0.008, 0.004, 0.045),
      o(half - 0.007, 0.002, 0.076),
      o(half - 0.005, -0.024, 0.099),
      o(half - 0.004, -0.075, 0.1),
      o(half - 0.003, -0.112, 0.072),
      o(half - 0.003, -0.124, 0.022),
      o(half - 0.003, -0.124, -0.035),
    ];
    tapeBatch.take(sweep(curveThrough(pts, false, 0.5), { radius: 0.0152, tubularSegments: 64, radialSegments: 12, caps: true }), undefined, COLORS.tape);
    tapeBatch.add(new THREE.SphereGeometry(0.0153, 12, 8), m4(o(half - 0.003, -0.124, -0.036)), COLORS.alloy);
    // Hood: sculpted rubber body on the front of the bend, its top where the palm rests (BIKE.hoods).
    const hood = BIKE.hoods[sx > 0 ? 0 : 1];
    const hx = hood[0];
    const hoodGeo = sweep(curveThrough([[hx, bar.y + 0.006, bar.z + 0.038], [hx, bar.y + 0.012, bar.z + 0.07], [hx, bar.y + 0.02, bar.z + 0.098], [hx, bar.y + 0.034, bar.z + 0.114]]), {
      radius: (t) => 0.0145 - t * 0.004,
      radius2: (t) => 0.02 - t * t * 0.009,
      tubularSegments: 18,
      radialSegments: 14,
      reference: X,
      caps: true,
    });
    rubberBatch.take(hoodGeo, undefined, 0x111213);
    // Brake/shift lever blade hanging in front of the drop curve.
    const lever = sweep(curveThrough([[hx, bar.y + 0.004, bar.z + 0.106], [hx, bar.y - 0.04, bar.z + 0.118], [hx - 0.002 * sx, bar.y - 0.088, bar.z + 0.108], [hx - 0.005 * sx, bar.y - 0.122, bar.z + 0.088]]), {
      radius: (t) => 0.0055 - t * 0.0015,
      radius2: (t) => 0.012 - t * 0.003,
      tubularSegments: 16,
      radialSegments: 10,
      reference: X,
      caps: true,
    });
    paintBatch.take(lever, undefined, COLORS.carbon);
  }
}

function buildSaddle(paintBatch: GeometryBatch, rubberBatch: GeometryBatch, seatTubeTop: THREE.Vector3) {
  const top = v(...BIKE.saddleTop);
  // Seatpost (aero) from the seat tube top to the saddle clamp.
  const clamp = v(0, top.y - 0.048, top.z + 0.03);
  paintBatch.take(sweep(new THREE.LineCurve3(seatTubeTop.clone().add(v(0, -0.03, 0.009)), clamp), { radius: 0.0125, radius2: 0.018, tubularSegments: 4, radialSegments: 12, reference: X, caps: true }), undefined, COLORS.frame);
  paintBatch.add(box(0.03, 0.02, 0.05, 0.006, 1), m4([clamp.x, clamp.y + 0.006, clamp.z]), COLORS.alloy);
  // Rails.
  for (const sx of [-1, 1]) {
    paintBatch.take(sweep(curveThrough([[0.02 * sx, top.y - 0.02, top.z - 0.1], [0.022 * sx, top.y - 0.04, top.z - 0.02], [0.02 * sx, top.y - 0.04, top.z + 0.06], [0.012 * sx, top.y - 0.02, top.z + 0.11]]), { radius: 0.0035, tubularSegments: 16, radialSegments: 6 }), undefined, COLORS.alloy);
  }
  // Shell: lofted superellipse sections from tail to nose.
  const tail = top.z - 0.125;
  const nose = top.z + 0.145;
  const nz = 28;
  const nr = 18;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= nz; i += 1) {
    const t = i / nz;
    const z = tail + (nose - tail) * t;
    const width = t < 0.45 ? 0.142 - Math.pow(t / 0.45, 2) * 0.04 : 0.102 - Math.pow((t - 0.45) / 0.55, 0.85) * 0.07;
    const yTop = top.y + (t < 0.15 ? (0.15 - t) * 0.04 : 0) - Math.max(0, t - 0.75) * 0.03;
    const thick = 0.022 + (t < 0.1 ? (0.1 - t) * 0.1 : 0);
    for (let j = 0; j < nr; j += 1) {
      const a = (j / nr) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const x = (width / 2) * Math.sign(c) * Math.pow(Math.abs(c), 0.55);
      const yy = s > 0 ? yTop - thick * 0.5 + (thick * 0.5) * Math.pow(s, 0.45) : yTop - thick * 0.5 - thick * 0.5 * Math.pow(-s, 1.6);
      // Centre channel on top.
      const channel = s > 0.6 ? Math.exp(-((x / 0.012) ** 2)) * 0.004 * smoothstep(0.1, 0.4, t) * (1 - smoothstep(0.7, 0.9, t)) : 0;
      pos.push(x, yy - channel, z);
    }
  }
  for (let i = 0; i < nz; i += 1) {
    for (let j = 0; j < nr; j += 1) {
      const a = i * nr + j;
      const b = i * nr + ((j + 1) % nr);
      const c = (i + 1) * nr + j;
      const d = (i + 1) * nr + ((j + 1) % nr);
      idx.push(a, c, b, b, c, d);
    }
  }
  const capTail = pos.length / 3;
  pos.push(0, top.y - 0.01, tail);
  const capNose = pos.length / 3;
  pos.push(0, top.y - 0.012, nose);
  for (let j = 0; j < nr; j += 1) {
    idx.push(capTail, j, (j + 1) % nr);
    idx.push(capNose, nz * nr + ((j + 1) % nr), nz * nr + j);
  }
  const shell = new THREE.BufferGeometry();
  shell.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  shell.setIndex(idx);
  shell.computeVertexNormals();
  rubberBatch.take(shell, undefined, COLORS.saddle);
}

interface Wheel {
  group: THREE.Group;
  spokes: THREE.Mesh;
  blur: THREE.Mesh;
}

function buildWheel(rear: boolean, materials: Record<"carbon" | "rubber" | "metal" | "spoke" | "blur", THREE.Material>): Wheel {
  const group = new THREE.Group();
  group.name = rear ? "wheel-rear" : "wheel-front";
  const R = BIKE.wheelRadius;
  const tr = BIKE.tireRadius;
  // Tyre: torus around X with tan sidewalls.
  const tyre = new THREE.TorusGeometry(R - tr, tr, 16, 96).rotateY(Math.PI / 2);
  paint(tyre, COLORS.tyre);
  {
    const n = tyre.attributes.normal;
    const col = tyre.attributes.color as THREE.BufferAttribute;
    const tan = new THREE.Color(COLORS.tanwall);
    const blk = new THREE.Color(COLORS.tyre);
    const p = tyre.attributes.position;
    for (let i = 0; i < n.count; i += 1) {
      const side = Math.abs(n.getX(i));
      const r = Math.hypot(p.getY(i), p.getZ(i));
      const k = smoothstep(0.7, 0.85, side) * (1 - smoothstep(R - tr * 1.25, R - tr * 0.95, r)) * smoothstep(R - tr * 2.0, R - tr * 1.8, r);
      const c = blk.clone().lerp(tan, k);
      col.setXYZ(i, c.r, c.g, c.b);
    }
  }
  const tyreMesh = new THREE.Mesh(tyre, materials.rubber);
  // Rim: deep carbon section, lathe around X, with grey decals and a coral pinstripe.
  const rimOuter = R - tr * 1.75;
  // Sidewall stations (depth below the bead → half width): extra stations host the thin decals.
  const side: Array<[number, number]> = [[0.004, 0.0122], [0.01, 0.0131], [0.016, 0.0135], [0.0215, 0.0134], [0.027, 0.0129], [0.0298, 0.0125], [0.0312, 0.0123], [0.0345, 0.0114], [0.0395, 0.0088], [0.0425, 0.005]];
  const rimProfile: Array<[number, number]> = [
    [rimOuter + 0.0005, -0.0125],
    [rimOuter + 0.0006, -0.0105],
    [rimOuter - 0.002, -0.0095],
    [rimOuter - 0.002, 0.0095],
    [rimOuter + 0.0006, 0.0105],
    [rimOuter + 0.0005, 0.0125],
    ...side.map(([d, w]) => [rimOuter - d, w] as [number, number]),
    [rimOuter - 0.0438, 0],
    ...side.slice().reverse().map(([d, w]) => [rimOuter - d, -w] as [number, number]),
    [rimOuter + 0.0005, -0.0125],
  ];
  // Lathe expects [radius, height]: height runs along the axis (X after rotation).
  const rim = lathe(rimProfile.map(([r, x]) => [r, x] as [number, number]), 96, "x");
  paint(rim, COLORS.carbon);
  {
    const p = rim.attributes.position;
    const col = rim.attributes.color as THREE.BufferAttribute;
    const decal = new THREE.Color(COLORS.decal);
    const coral = new THREE.Color(CORAL);
    for (let i = 0; i < p.count; i += 1) {
      const r = Math.hypot(p.getY(i), p.getZ(i));
      const ang = Math.atan2(p.getY(i), p.getZ(i));
      const onSide = Math.abs(p.getX(i)) > 0.0105;
      if (!onSide) continue;
      const sector = ((ang / (Math.PI * 2)) * 3 + 3) % 1;
      if (r > rimOuter - 0.0275 && r < rimOuter - 0.0155 && sector > 0.05 && sector < 0.24) col.setXYZ(i, decal.r, decal.g, decal.b);
      if (r > rimOuter - 0.0313 && r < rimOuter - 0.0297) col.setXYZ(i, coral.r, coral.g, coral.b);
    }
  }
  const rimMesh = new THREE.Mesh(rim, materials.carbon);
  // Hub + rotor + (rear) cassette in one metal batch.
  const metal = new GeometryBatch();
  const hubLen = rear ? 0.066 : 0.05;
  metal.add(lathe([[0.0055, -hubLen], [0.012, -hubLen], [0.012, -hubLen + 0.004], [0.017, -hubLen + 0.01], [0.016, 0], [0.017, hubLen - 0.01], [0.012, hubLen - 0.004], [0.012, hubLen], [0.0055, hubLen]], 24, "x"), undefined, COLORS.alloy);
  const flangeL = rear ? 0.035 : 0.03;
  const flangeR = rear ? -0.022 : -0.03;
  for (const fx of [flangeL, flangeR]) metal.add(new THREE.CylinderGeometry(0.025, 0.025, 0.004, 24).rotateZ(Math.PI / 2), m4([fx, 0, 0]), COLORS.alloy);
  // Disc rotor on the non-drive side (+X) with cut-outs and a six-arm spider.
  const rotorR = rear ? 0.07 : 0.08;
  const rotorShape = new THREE.Shape();
  rotorShape.absarc(0, 0, rotorR, 0, Math.PI * 2, false);
  const inner = new THREE.Path();
  inner.absarc(0, 0, rotorR - 0.022, 0, Math.PI * 2, true);
  rotorShape.holes.push(inner);
  for (let i = 0; i < 18; i += 1) {
    const a = (i / 18) * Math.PI * 2;
    const h = new THREE.Path();
    h.absarc(Math.cos(a) * (rotorR - 0.011), Math.sin(a) * (rotorR - 0.011), 0.0028, 0, Math.PI * 2, true);
    rotorShape.holes.push(h);
  }
  const rotor = extrude(rotorShape, 0.0018, 0, 20).rotateY(Math.PI / 2);
  metal.add(rotor, m4([0.056, 0, 0]), COLORS.rotor);
  rotor.dispose();
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    const a0 = new THREE.Vector3(0.055, Math.sin(a) * 0.016, Math.cos(a) * 0.016);
    const a1 = new THREE.Vector3(0.056, Math.sin(a + 0.25) * (rotorR - 0.02), Math.cos(a + 0.25) * (rotorR - 0.02));
    metal.add(cylinderBetween(a0, a1, 0.0032, 6), undefined, COLORS.alloy);
  }
  if (rear) {
    const teeth = [30, 27, 24, 21, 19, 17, 15, 14, 13, 12, 11];
    teeth.forEach((n, i) => {
      const cog = extrude(gearShape(n, PITCH, { hole: 0.0165 }), 0.0018, 0, 6).rotateY(Math.PI / 2);
      metal.add(cog, m4([-0.032 - i * 0.004, 0, 0]), i % 2 ? COLORS.silver : 0x9da2a6);
      cog.dispose();
    });
  }
  const metalMesh = new THREE.Mesh(metal.build(), materials.metal);
  // Spokes: front 20 radial; rear 24 two-cross.
  const spokeBatch = new GeometryBatch();
  const rimSpokeR = rimOuter - 0.042;
  const count = rear ? 24 : 20;
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2;
    const left = i % 2 === 0;
    const fx = left ? flangeL : flangeR;
    const hubA = rear ? a + (i % 4 < 2 ? 0.52 : -0.52) : a;
    const p0 = new THREE.Vector3(fx, Math.sin(hubA) * 0.023, Math.cos(hubA) * 0.023);
    const p1 = new THREE.Vector3(left ? 0.003 : -0.003, Math.sin(a) * rimSpokeR, Math.cos(a) * rimSpokeR);
    spokeBatch.add(cylinderBetween(p0, p1, 0.00115, 5, 0.00115, true), undefined, 0x1c1d1f);
  }
  const spokes = new THREE.Mesh(spokeBatch.build(), materials.spoke);
  spokes.name = "spokes";
  // Valve stem (shows rotation at low speed).
  const valve = new THREE.Mesh(cylinderBetween(new THREE.Vector3(0, 0, rimOuter - 0.04), new THREE.Vector3(0, 0, rimOuter - 0.058), 0.003, 8), materials.metal);
  paint(valve.geometry, COLORS.silver);
  // Blur disc (alpha from the baked spoke-blur texture).
  const blurGeo = new THREE.RingGeometry(0.018, rimSpokeR + 0.002, 64, 1).rotateY(Math.PI / 2);
  const blur = new THREE.Mesh(blurGeo, materials.blur);
  blur.name = "spoke-blur";
  blur.renderOrder = 2;
  blur.castShadow = false;
  group.add(tyreMesh, rimMesh, metalMesh, spokes, valve, blur);
  return { group, spokes, blur };
}

function buildCrank(metalBatch: GeometryBatch, armBatch: GeometryBatch) {
  // Chainrings 50/34 on the drive side, rotating with the crank (local to the crank pivot).
  const outer = extrude(gearShape(50, PITCH, { hole: pitchRadius(50, PITCH) - 0.016, boltHoles: { count: 4, radius: 0.055, size: 0.0035 } }), 0.0024, 0, 4).rotateY(Math.PI / 2);
  metalBatch.add(outer, m4([CHAIN_X_FRONT, 0, 0]), 0x2d3033);
  outer.dispose();
  const inner = extrude(gearShape(34, PITCH, { hole: pitchRadius(34, PITCH) - 0.014 }), 0.0022, 0, 4).rotateY(Math.PI / 2);
  metalBatch.add(inner, m4([CHAIN_X_FRONT + 0.0065, 0, 0]), 0x9ea3a7);
  inner.dispose();
  // Four-arm spider joining the rings to the right crank.
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const p1 = new THREE.Vector3(CHAIN_X_FRONT + 0.002, Math.sin(a) * 0.088, Math.cos(a) * 0.088);
    armBatch.add(cylinderBetween(new THREE.Vector3(CHAIN_X_FRONT - 0.004, 0, 0), p1, 0.0055, 8, 0.0035), undefined, COLORS.alloy);
  }
  // Crank arms: right points +Z at angle 0, left points -Z. Tapered flat profile.
  const L = BIKE.crankLength;
  for (const sx of [-1, 1]) {
    const dir = sx < 0 ? 1 : -1;
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.019);
    shape.quadraticCurveTo(L * 0.5, -0.0135, L, -0.0115);
    shape.absarc(L, 0, 0.0115, -Math.PI / 2, Math.PI / 2, false);
    shape.quadraticCurveTo(L * 0.5, 0.0135, 0, 0.019);
    shape.absarc(0, 0, 0.019, Math.PI / 2, Math.PI * 1.5, false);
    const arm = extrude(shape, 0.014, 0.003, 12);
    // Shape is in XY with length along +X → map to the bike: length along ±Z, width along Y, thickness along X.
    arm.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, dir), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-dir, 0, 0)));
    // Arms splay outward towards the pedal eye.
    const pos = arm.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      const along = Math.abs(pos.getZ(i)) / L;
      pos.setX(i, pos.getX(i) + sx * (0.06 + along * 0.022));
    }
    arm.computeVertexNormals();
    armBatch.take(arm, undefined, COLORS.alloy);
  }
  // Spindle.
  armBatch.add(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 16).rotateZ(Math.PI / 2), undefined, COLORS.silver);
}

function pedalGeometry(sx: number): THREE.BufferGeometry {
  const batch = new GeometryBatch();
  // Clipless body (wedge) + spindle stub; centred on the spindle, platform level.
  batch.add(box(0.062, 0.017, 0.084, 0.008, 2), m4([sx * 0.012, -0.002, 0.004]), 0x1d1f21);
  batch.add(box(0.05, 0.004, 0.06, 0.002, 1), m4([sx * 0.012, 0.0075, 0.006]), CORAL);
  batch.add(new THREE.CylinderGeometry(0.0065, 0.0065, 0.04, 10).rotateZ(Math.PI / 2), m4([-sx * 0.012, 0, 0]), COLORS.silver);
  return batch.build();
}

export function createBike(): BikeProp {
  const disposer = new Disposer();
  const group = new THREE.Group();
  group.name = "prop-bike";

  const materials = {
    // Low env weight keeps glossy black reading black (sharp highlights, not a silver sheen).
    paint: disposer.track(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.2, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 0.55 })),
    carbon: disposer.track(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.1, clearcoat: 0.8, clearcoatRoughness: 0.12, envMapIntensity: 0.5 })),
    rubber: disposer.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 })),
    tape: disposer.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 })),
    metal: disposer.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.9 })),
    spoke: disposer.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.6, transparent: true })),
    blur: disposer.track(new THREE.MeshStandardMaterial({ color: 0x141516, roughness: 0.5, metalness: 0.4, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0 })),
  };
  materials.blur.map = disposer.track(canvasTexture(spokeBlurCanvas(512, 0.07, 4), { srgb: true }));

  const paintBatch = new GeometryBatch();
  const tapeBatch = new GeometryBatch();
  const rubberBatch = new GeometryBatch();
  const frame = buildFrame(paintBatch);
  buildCockpit(paintBatch, tapeBatch, rubberBatch, frame.steererTop);
  const seatTubeTop = new THREE.Vector3(0, 0.765, -0.145);
  buildSaddle(paintBatch, rubberBatch, seatTubeTop);
  // Bottle + cage on the down tube (white bottle, coral cap).
  const bottle = lathe([[0, -0.11], [0.033, -0.108], [0.036, -0.09], [0.035, 0.05], [0.031, 0.085], [0.017, 0.105], [0.012, 0.118], [0, 0.12]], 24, "y");
  paint(bottle, COLORS.bottle);
  {
    const p = bottle.attributes.position;
    const col = bottle.attributes.color as THREE.BufferAttribute;
    const c = new THREE.Color(CORAL);
    for (let i = 0; i < p.count; i += 1) if (p.getY(i) > 0.09 || Math.abs(p.getY(i) + 0.02) < 0.012) col.setXYZ(i, c.r, c.g, c.b);
  }
  const dtDir = new THREE.Vector3(0, 0.712 - 0.296, 0.428 - 0.038).normalize();
  const bottleMat = new THREE.Matrix4().compose(new THREE.Vector3(0, 0.505, 0.235).addScaledVector(new THREE.Vector3(0, dtDir.z, -dtDir.y), 0.062), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dtDir), new THREE.Vector3(1, 1, 1));
  rubberBatch.take(bottle, bottleMat);

  const paintMesh = new THREE.Mesh(paintBatch.build(), materials.paint);
  paintMesh.name = "bike-frame";
  const tapeMesh = new THREE.Mesh(tapeBatch.build(), materials.tape);
  const rubberMesh = new THREE.Mesh(rubberBatch.build(), materials.rubber);
  group.add(paintMesh, tapeMesh, rubberMesh);

  // Wheels.
  const front = buildWheel(false, materials);
  front.group.position.fromArray(BIKE.frontAxle);
  const rear = buildWheel(true, materials);
  rear.group.position.fromArray(BIKE.rearAxle);
  group.add(front.group, rear.group);

  // Front & rear calipers, rear derailleur body, front derailleur (static metal).
  const staticMetal = new GeometryBatch();
  staticMetal.add(box(0.024, 0.05, 0.06, 0.008, 2), m4([0.066, BIKE.frontAxle[1] + 0.052, BIKE.frontAxle[2] - 0.052], [0.75, 0, 0]), 0x26292c);
  staticMetal.add(box(0.024, 0.045, 0.056, 0.008, 2), m4([0.07, BIKE.rearAxle[1] + 0.045, BIKE.rearAxle[2] + 0.04], [-0.6, 0, 0]), 0x26292c);
  const rdUpper: [number, number] = [BIKE.rearAxle[1] - 0.07, BIKE.rearAxle[2] + 0.02];
  const rdLower: [number, number] = [BIKE.rearAxle[1] - 0.135, BIKE.rearAxle[2] + 0.045];
  staticMetal.add(box(0.018, 0.05, 0.03, 0.006, 2), m4([-0.074, BIKE.rearAxle[1] - 0.025, BIKE.rearAxle[2] - 0.008], [0.4, 0, 0]), 0x2b2e31);
  const cageC = [(rdUpper[0] + rdLower[0]) / 2, (rdUpper[1] + rdLower[1]) / 2];
  staticMetal.add(box(0.003, 0.11, 0.032, 0.0015, 1), m4([CHAIN_X_REAR - 0.009, cageC[0], cageC[1]], [Math.atan2(rdLower[1] - rdUpper[1], rdUpper[0] - rdLower[0]), 0, 0]), 0x1f2224);
  for (const [py, pz] of [rdUpper, rdLower]) {
    const pulley = extrude(gearShape(11, PITCH, { hole: 0.004 }), 0.004, 0, 4).rotateY(Math.PI / 2);
    staticMetal.add(pulley, m4([CHAIN_X_REAR, py, pz]), 0x2a2d30);
    pulley.dispose();
  }
  staticMetal.add(box(0.022, 0.03, 0.06, 0.006, 2), m4([-0.04, 0.39, -0.07], [-0.28, 0, 0]), 0x9ea3a7);
  const staticMesh = new THREE.Mesh(staticMetal.build(), materials.metal);
  group.add(staticMesh);

  // Crank assembly (rotates about X at the crank centre).
  const crank = new THREE.Group();
  crank.name = "crank";
  crank.position.fromArray(BIKE.crankCenter);
  const ringBatch = new GeometryBatch();
  const armBatch = new GeometryBatch();
  buildCrank(ringBatch, armBatch);
  crank.add(new THREE.Mesh(ringBatch.build(), materials.metal), new THREE.Mesh(armBatch.build(), materials.paint));
  group.add(crank);

  // Pedals stay level; positioned from the crank angle.
  const pedals: [THREE.Mesh, THREE.Mesh] = [new THREE.Mesh(pedalGeometry(1), materials.rubber), new THREE.Mesh(pedalGeometry(-1), materials.rubber)];
  group.add(...pedals);

  // Chain: instanced links along a belt path (chainring 50T → lower jockey → upper jockey → 14T cog).
  const circles: BeltCircle[] = [
    { c: [BIKE.crankCenter[2], BIKE.crankCenter[1]], r: pitchRadius(50, PITCH), cw: true },
    { c: [rdLower[1], rdLower[0]], r: pitchRadius(11, PITCH), cw: true },
    { c: [rdUpper[1], rdUpper[0]], r: pitchRadius(11, PITCH), cw: false },
    { c: [BIKE.rearAxle[2], BIKE.rearAxle[1]], r: pitchRadius(14, PITCH), cw: true },
  ];
  const path = beltPath(circles);
  const linkCount = Math.round(path.length / PITCH);
  const linkPitch = path.length / linkCount;
  const linkBatch = new GeometryBatch();
  for (const side of [-1, 1]) linkBatch.add(box(0.0008, 0.0068, linkPitch + 0.004), m4([side * 0.0036, 0, 0]), COLORS.chain);
  linkBatch.add(new THREE.CylinderGeometry(0.0034, 0.0034, 0.0072, 6, 1, true).rotateZ(Math.PI / 2), m4([0, 0, linkPitch / 2]), 0x6d7277);
  const linkGeo = linkBatch.build();
  const chain = new THREE.InstancedMesh(linkGeo, materials.metal, linkCount);
  chain.name = "chain";
  chain.frustumCulled = false;
  group.add(chain);

  const tmp = { p: [0, 0] as [number, number], t: [0, 0] as [number, number] };
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  const pv = new THREE.Vector3();
  let crankAngle = 0;
  let blurAmount = 0;
  const setCrankAngle = (rad: number) => {
    crankAngle = rad;
    crank.rotation.x = rad;
    const [l, r] = bikePedalLocal(rad);
    pedals[0].position.fromArray(l);
    pedals[1].position.fromArray(r);
    // Chain advances by the arc the chainring has turned.
    const s0 = rad * circles[0].r;
    for (let i = 0; i < linkCount; i += 1) {
      sampleBelt(path, s0 + i * linkPitch, tmp);
      const zFrac = clamp01(-tmp.p[0] / Math.abs(BIKE.rearAxle[2]));
      const x = CHAIN_X_FRONT + (CHAIN_X_REAR - CHAIN_X_FRONT) * zFrac;
      // Link local +Z follows the path tangent (in the YZ plane: u=z, v=y).
      e.set(-Math.atan2(tmp.t[1], tmp.t[0]), 0, 0);
      q.setFromEuler(e);
      pv.set(x, tmp.p[1], tmp.p[0]);
      m.compose(pv, q, one);
      chain.setMatrixAt(i, m);
    }
    chain.instanceMatrix.needsUpdate = true;
  };
  const setWheelAngle = (rad: number) => {
    front.group.rotation.x = rad;
    rear.group.rotation.x = rad;
  };
  const setSpinBlur = (amount: number) => {
    blurAmount = clamp01(amount);
    const spokeOpacity = 1 - smoothstep(0.35, 0.85, blurAmount);
    materials.spoke.opacity = spokeOpacity;
    // Both layers stay in the scene (opacity only), so their programs compile with the bike and
    // ramping the blur mid-shot never triggers a shader compile.
    materials.blur.opacity = smoothstep(0.1, 0.8, blurAmount) * 0.9;
  };
  setCrankAngle(0);
  setSpinBlur(0);

  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = mesh.name !== "spoke-blur";
    mesh.receiveShadow = true;
  });
  disposer.trackObject(group);
  void crankAngle;
  void blurAmount;

  return {
    group,
    setCrankAngle,
    setWheelAngle,
    setSpinBlur,
    pedalPositions: () => {
      group.updateWorldMatrix(true, true);
      return [pedals[0].getWorldPosition(new THREE.Vector3()), pedals[1].getWorldPosition(new THREE.Vector3())];
    },
    dispose: () => {
      group.removeFromParent();
      disposer.dispose();
    },
  };
}
