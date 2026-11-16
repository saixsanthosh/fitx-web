/**
 * Gym set builders: the warehouse shell (brick back wall with three tall factory windows, side
 * walls, corrugated deck and steel beams), the lifting platform, and the equipment (power rack,
 * plate tree, dumbbell rack, kettlebells, bench, plyo boxes, climbing rope, chalk stand, lamps).
 * Geometry goes into per-material batches owned by `gym.ts`.
 */

import * as THREE from "three";
import { PLATFORM } from "../dimensions";
import { createRng } from "../math";
import { GYM_COLORS as C } from "./palettes";
import { GeometryBatch, box, cylinderBetween, cylinderUp, lathe, m4, sweep, curveThrough, type V3 } from "./util/geometry";
import type { ShaftWindow } from "./util/volumetrics";

export const ROOM = { x0: -8, x1: 8, z0: -5.5, z1: 7.5, height: 6.8, wall: 0.35 } as const;

/** Window openings on the back wall (inner face z = ROOM.z0). */
export const WINDOWS: ShaftWindow[] = [
  { x0: -5.4, x1: -3.4, y0: 1.5, y1: 5.1, cols: 4, rows: 6, mullion: 0.022 },
  { x0: -2.9, x1: -0.9, y0: 1.5, y1: 5.1, cols: 4, rows: 6, mullion: 0.022 },
  { x0: -0.4, x1: 1.6, y0: 1.5, y1: 5.1, cols: 4, rows: 6, mullion: 0.022 },
];

export interface GymBatches {
  brick: GeometryBatch;
  block: GeometryBatch;
  steel: GeometryBatch;
  black: GeometryBatch;
  chrome: GeometryBatch;
  rubber: GeometryBatch;
  wood: GeometryBatch;
  iron: GeometryBatch;
}

/** Back wall with window openings, left brick wall, right/front block walls, sills and lintels. */
export function buildShell(b: GymBatches) {
  const { x0, x1, z0, z1, height: H, wall: T } = ROOM;
  const backZ = z0 - T / 2;
  // Back wall: piers between windows, sill band below, lintel band above.
  const edges = [x0 - T, ...WINDOWS.flatMap((w) => [w.x0, w.x1]), x1 + T];
  for (let i = 0; i < edges.length; i += 2) {
    const a = edges[i];
    const c = edges[i + 1];
    if (c - a > 0.001) b.brick.add(box(c - a, H, T), m4([(a + c) / 2, H / 2, backZ]));
  }
  for (const w of WINDOWS) {
    b.brick.add(box(w.x1 - w.x0, w.y0, T), m4([(w.x0 + w.x1) / 2, w.y0 / 2, backZ]));
    b.brick.add(box(w.x1 - w.x0, H - w.y1, T), m4([(w.x0 + w.x1) / 2, (H + w.y1) / 2, backZ]));
    // Concrete sill and steel lintel.
    b.block.add(box(w.x1 - w.x0 + 0.12, 0.07, T + 0.08), m4([(w.x0 + w.x1) / 2, w.y0 - 0.035, backZ + 0.02]), 0x9c978e);
    b.steel.add(box(w.x1 - w.x0 + 0.3, 0.16, 0.12), m4([(w.x0 + w.x1) / 2, w.y1 + 0.08, z0 + 0.05]), 0x2c2f31);
  }
  // Left wall brick, right and front walls painted block.
  b.brick.add(box(T, H, z1 - z0 + 2 * T), m4([x0 - T / 2, H / 2, (z0 + z1) / 2]));
  b.block.add(box(T, H, z1 - z0 + 2 * T), m4([x1 + T / 2, H / 2, (z0 + z1) / 2]), 0xb7b2a8);
  b.block.add(box(x1 - x0 + 2 * T, H, T), m4([(x0 + x1) / 2, H / 2, z1 + T / 2]), 0xb7b2a8);
  // Painted dado band on the block walls (coral stripe, a common gym detail).
  b.block.add(box(0.02, 0.12, z1 - z0), m4([x1 - 0.005, 1.1, (z0 + z1) / 2]), 0xb8533c);
  // Roller door (corrugated) on the front wall.
  for (let k = 0; k < 40; k += 1) {
    b.steel.add(box(3.6, 0.08, 0.04), m4([3.4, 0.1 + k * 0.09, z1 - 0.03]), k % 2 ? 0x7f8487 : 0x8e9396);
  }
}

/** Corrugated deck, I-beams, purlins (steel batch) at the ceiling. */
export function buildCeiling(b: GymBatches) {
  const { x0, x1, z0, z1, height: H } = ROOM;
  const w = x1 - x0;
  const d = z1 - z0;
  const deck = new THREE.PlaneGeometry(w + 0.8, d + 0.8, 160, 1);
  const p = deck.attributes.position;
  for (let i = 0; i < p.count; i += 1) p.setZ(i, Math.sin(p.getX(i) * Math.PI * 2 * 4) * 0.025);
  deck.computeVertexNormals();
  deck.rotateX(Math.PI / 2);
  b.steel.take(deck, m4([(x0 + x1) / 2, H, (z0 + z1) / 2]), C.deck);
  for (let z = z0 + 1.5; z < z1; z += 3) {
    // I-beam: web + flanges.
    b.steel.add(box(w, 0.32, 0.012), m4([(x0 + x1) / 2, H - 0.2, z]), 0x2a2d2f);
    b.steel.add(box(w, 0.016, 0.16), m4([(x0 + x1) / 2, H - 0.04, z]), 0x2a2d2f);
    b.steel.add(box(w, 0.016, 0.16), m4([(x0 + x1) / 2, H - 0.36, z]), 0x2a2d2f);
  }
  for (let x = x0 + 2; x < x1; x += 4) b.steel.add(box(0.1, 0.12, d), m4([x, H - 0.08, (z0 + z1) / 2]), 0x33373a);
  // Conduit runs.
  b.steel.add(cylinderBetween(new THREE.Vector3(x0, H - 0.5, 2.0), new THREE.Vector3(x1, H - 0.5, 2.0), 0.025, 8), undefined, 0x8c9194);
}

/** Window frames: perimeter + mullion grid (steel), one per opening. */
export function buildWindowFrames(b: GymBatches) {
  const z = ROOM.z0 - ROOM.wall / 2;
  for (const w of WINDOWS) {
    const cx = (w.x0 + w.x1) / 2;
    const cy = (w.y0 + w.y1) / 2;
    const width = w.x1 - w.x0;
    const height = w.y1 - w.y0;
    for (let i = 0; i <= w.cols; i += 1) {
      const x = w.x0 + (i * width) / w.cols;
      const t = i === 0 || i === w.cols ? 0.06 : w.mullion * 2;
      b.steel.add(box(t, height, 0.06), m4([x, cy, z]), 0x23272a);
    }
    for (let j = 0; j <= w.rows; j += 1) {
      const y = w.y0 + (j * height) / w.rows;
      const t = j === 0 || j === w.rows ? 0.06 : w.mullion * 2;
      b.steel.add(box(width, t, 0.06), m4([cx, y, z]), 0x23272a);
    }
  }
}

/** Lifting platform: wood centre where the lifter stands, rubber sides under the plates, steel frame. */
export function buildPlatform(woodTop: GeometryBatch, rubberTop: GeometryBatch, steel: GeometryBatch) {
  const { width: W, depth: D, height: Hh } = PLATFORM;
  const centre = 1.2;
  woodTop.add(box(centre, Hh, D - 0.06), m4([0, Hh / 2, 0]));
  for (const sx of [-1, 1]) rubberTop.add(box((W - centre) / 2 - 0.03, Hh - 0.002, D - 0.06), m4([sx * (centre / 2 + ((W - centre) / 2 - 0.03) / 2), (Hh - 0.002) / 2, 0]), 0x161718);
  // Frame strips around the platform.
  steel.add(box(W, Hh + 0.004, 0.03), m4([0, (Hh + 0.004) / 2, D / 2 - 0.015]), 0x2a2c2e);
  steel.add(box(W, Hh + 0.004, 0.03), m4([0, (Hh + 0.004) / 2, -D / 2 + 0.015]), 0x2a2c2e);
  steel.add(box(0.03, Hh + 0.004, D), m4([W / 2 - 0.015, (Hh + 0.004) / 2, 0]), 0x2a2c2e);
  steel.add(box(0.03, Hh + 0.004, D), m4([-W / 2 + 0.015, (Hh + 0.004) / 2, 0]), 0x2a2c2e);
}

/** Simple bumper plate shape for storage (no lettering). Axis X, centred. */
export function storagePlate(diameter: number, thickness: number): THREE.BufferGeometry {
  const R = diameter / 2;
  const h = thickness / 2;
  return lathe([[0.026, -h], [R - 0.012, -h], [R, -h + 0.008], [R, h - 0.008], [R - 0.012, h], [0.026, h], [0.026, -h]], 40, "x");
}

/** Power rack with J-hooks, safeties, pull-up bar and a spare bar on the hooks. */
export function buildRack(b: GymBatches, at: V3) {
  const [cx, , cz] = at;
  const w = 1.22;
  const d = 1.2;
  const h = 2.32;
  const up = box(0.075, h, 0.075, 0.006, 1);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.black.add(up, m4([cx + (sx * w) / 2, h / 2, cz + (sz * d) / 2]), C.steelBlack);
  for (const sz of [-1, 1]) {
    b.black.add(box(w, 0.075, 0.075), m4([cx, h - 0.04, cz + (sz * d) / 2]), C.steelBlack);
    b.black.add(box(w + 0.1, 0.075, 0.1), m4([cx, 0.04, cz + (sz * d) / 2]), C.steelBlack);
  }
  for (const sx of [-1, 1]) {
    b.black.add(box(0.075, 0.075, d), m4([cx + (sx * w) / 2, h - 0.04, cz]), C.steelBlack);
    b.black.add(box(0.1, 0.075, d + 0.1), m4([cx + (sx * w) / 2, 0.04, cz]), C.steelBlack);
    // Safety arms and J-hooks (front uprights).
    b.chrome.add(box(0.05, 0.05, d + 0.25), m4([cx + (sx * w) / 2, 0.62, cz]), 0xb9bdc0);
    b.chrome.add(box(0.06, 0.09, 0.09), m4([cx + (sx * w) / 2, 1.38, cz + d / 2 + 0.06]), 0xb9bdc0);
  }
  b.chrome.add(cylinderBetween(new THREE.Vector3(cx - w / 2 - 0.1, h + 0.05, cz + d / 2 + 0.1), new THREE.Vector3(cx + w / 2 + 0.1, h + 0.05, cz + d / 2 + 0.1), 0.016, 12), undefined, 0xc5c8ca);
  // Spare bar on the hooks.
  b.chrome.add(cylinderBetween(new THREE.Vector3(cx - 1.1, 1.45, cz + d / 2 + 0.06), new THREE.Vector3(cx + 1.1, 1.45, cz + d / 2 + 0.06), 0.014, 12), undefined, 0x9fa3a6);
  for (const sx of [-1, 1]) b.chrome.add(cylinderBetween(new THREE.Vector3(cx + sx * 0.66, 1.45, cz + d / 2 + 0.06), new THREE.Vector3(cx + sx * 1.1, 1.45, cz + d / 2 + 0.06), 0.025, 16), undefined, 0xd7d9db);
  // Weight horns at the back with stored plates.
  const plate20 = storagePlate(0.45, 0.066);
  const plate10 = storagePlate(0.45, 0.042);
  for (const sx of [-1, 1]) {
    for (const y of [0.45, 1.05]) {
      const hx = cx + (sx * w) / 2;
      b.chrome.add(cylinderBetween(new THREE.Vector3(hx, y, cz - d / 2), new THREE.Vector3(hx + sx * 0.28, y, cz - d / 2), 0.025, 12), undefined, 0xc5c8ca);
      b.rubber.add(plate20, m4([hx + sx * 0.08, y, cz - d / 2]), y < 1 ? C.plateCoral : C.plateGraphite);
      b.rubber.add(plate10, m4([hx + sx * 0.15, y, cz - d / 2]), C.plateGraphite);
    }
  }
  plate20.dispose();
  plate10.dispose();
}

/** Plate tree with a mix of coral and graphite bumpers. */
export function buildPlateTree(b: GymBatches, at: V3, seed: number) {
  const rng = createRng(seed);
  const [cx, , cz] = at;
  b.black.add(box(0.6, 0.05, 0.6, 0.01, 1), m4([cx, 0.025, cz]), C.steelBlack);
  b.black.add(box(0.07, 1.25, 0.07, 0.006, 1), m4([cx, 0.65, cz]), C.steelBlack);
  const p20 = storagePlate(0.45, 0.066);
  const p10 = storagePlate(0.45, 0.042);
  const p5 = storagePlate(0.32, 0.03);
  const horns: Array<[number, number]> = [[0.35, 1], [0.35, -1], [0.75, 1], [0.75, -1], [1.1, 1], [1.1, -1]];
  for (const [y, s] of horns) {
    b.chrome.add(cylinderBetween(new THREE.Vector3(cx, y, cz), new THREE.Vector3(cx, y, cz + s * 0.25), 0.024, 12), undefined, 0xc5c8ca);
    const n = 2 + Math.floor(rng() * 3);
    for (let k = 0; k < n; k += 1) {
      const g = y < 0.5 ? p20 : y < 1 ? p10 : p5;
      const t = y < 0.5 ? 0.066 : y < 1 ? 0.042 : 0.03;
      const col = rng() < 0.6 ? C.plateCoral : C.plateGraphite;
      b.rubber.add(g, m4([cx, y, cz + s * (0.06 + k * (t + 0.003))], [0, Math.PI / 2, rng() * 6]), col);
    }
  }
  p20.dispose();
  p10.dispose();
  p5.dispose();
}

/** Two-tier dumbbell rack along the right wall with hex dumbbells (rubber heads, chrome handles). */
export function buildDumbbells(b: GymBatches, at: V3) {
  const [cx, , cz] = at;
  const len = 4.4;
  for (const z of [cz - len / 2, cz + len / 2]) {
    b.black.add(box(0.06, 0.9, 0.06), m4([cx, 0.45, z]), C.steelBlack);
    b.black.add(box(0.06, 0.6, 0.06), m4([cx + 0.4, 0.3, z]), C.steelBlack);
  }
  for (const [y, dx] of [[0.86, 0.06], [0.56, 0.42]]) {
    b.black.add(box(0.36, 0.035, len), m4([cx + dx - 0.12, y, cz], [0, 0, 0.18]), C.steelBlack);
  }
  const hex = new THREE.CylinderGeometry(1, 1, 1, 6, 1).rotateZ(Math.PI / 2);
  const n = 10;
  for (let i = 0; i < n; i += 1) {
    const z = cz - len / 2 + 0.25 + (i * (len - 0.5)) / (n - 1);
    for (const [y, dx, k] of [[0.93, -0.06, 0], [0.63, 0.3, 1]] as Array<[number, number, number]>) {
      const r = 0.055 + (i / n) * 0.06 + k * 0.03;
      const hw = 0.045 + (i / n) * 0.04;
      // Handle across X, heads at both ends.
      b.chrome.add(cylinderBetween(new THREE.Vector3(cx + dx - 0.16, y + r, z), new THREE.Vector3(cx + dx + 0.16, y + r, z), 0.016, 10), undefined, 0xc0c3c6);
      for (const s of [-1, 1]) b.rubber.add(hex, m4([cx + dx + s * (0.16 + hw / 2), y + r, z], [0, 0, 0], [hw, r, r]), 0x1a1b1c);
    }
  }
  hex.dispose();
}

/** Kettlebells (cast iron, matte) in a row. */
export function buildKettlebells(b: GymBatches, from: V3, count: number) {
  for (let i = 0; i < count; i += 1) {
    const s = 0.8 + i * 0.09;
    const x = from[0] + i * 0.42;
    const z = from[2];
    const body = new THREE.SphereGeometry(0.11 * s, 20, 14);
    b.iron.add(body, m4([x, 0.1 * s, z], [0, 0, 0], [1, 0.92, 1]), C.iron);
    body.dispose();
    const handle = sweep(curveThrough([[x - 0.075 * s, 0.17 * s, z], [x - 0.08 * s, 0.3 * s, z], [x, 0.36 * s, z], [x + 0.08 * s, 0.3 * s, z], [x + 0.075 * s, 0.17 * s, z]]), { radius: 0.018 * s, tubularSegments: 20, radialSegments: 8 });
    b.iron.take(handle, undefined, C.iron);
    // Coral weight band (painted ring) on alternating bells.
    if (i % 2 === 0) {
      const band = new THREE.TorusGeometry(0.105 * s, 0.006, 6, 28).rotateX(Math.PI / 2);
      b.rubber.add(band, m4([x, 0.12 * s, z]), C.plateCoral);
      band.dispose();
    }
  }
}

export function buildBench(b: GymBatches, at: V3) {
  const [cx, , cz] = at;
  b.black.add(box(0.3, 0.06, 1.15, 0.02, 2), m4([cx, 0.44, cz]), 0x1d1e20);
  b.black.add(box(0.06, 0.4, 0.06), m4([cx, 0.2, cz - 0.45]), C.steelBlack);
  b.black.add(box(0.06, 0.4, 0.06), m4([cx, 0.2, cz + 0.45]), C.steelBlack);
  b.black.add(box(0.45, 0.05, 0.06), m4([cx, 0.025, cz - 0.45]), C.steelBlack);
  b.black.add(box(0.45, 0.05, 0.06), m4([cx, 0.025, cz + 0.45]), C.steelBlack);
}

export function buildPlyo(b: GymBatches, at: V3) {
  const [cx, , cz] = at;
  b.wood.add(box(0.76, 0.6, 0.6, 0.01, 1), m4([cx, 0.3, cz], [0, 0.12, 0]));
  b.wood.add(box(0.76, 0.5, 0.6, 0.01, 1), m4([cx + 0.05, 0.85, cz + 0.02], [0, -0.08, 0]));
  b.wood.add(box(0.6, 0.45, 0.5, 0.01, 1), m4([cx + 0.9, 0.225, cz + 0.1], [0, 0.4, 0]));
}

/** Climbing rope from the ceiling, coiled on the floor. */
export function buildRope(b: GymBatches, at: V3) {
  const [x, , z] = at;
  const pts: V3[] = [[x, ROOM.height - 0.3, z], [x + 0.02, 4.0, z + 0.03], [x - 0.01, 2.0, z - 0.02], [x + 0.03, 0.4, z + 0.05], [x + 0.18, 0.06, z + 0.12], [x + 0.32, 0.05, z - 0.06], [x + 0.12, 0.05, z - 0.22]];
  const rope = sweep(curveThrough(pts), { radius: 0.019, tubularSegments: 90, radialSegments: 8 });
  // Twist pattern in vertex colours.
  const col = new Float32Array(rope.attributes.position.count * 3);
  const uv = rope.attributes.uv;
  const base = new THREE.Color(0xb59a72);
  for (let i = 0; i < uv.count; i += 1) {
    const k = 0.82 + 0.18 * Math.sin(uv.getX(i) * 60 + uv.getY(i) * Math.PI * 2 * 3);
    col[i * 3] = base.r * k;
    col[i * 3 + 1] = base.g * k;
    col[i * 3 + 2] = base.b * k;
  }
  rope.setAttribute("color", new THREE.BufferAttribute(col, 3));
  b.wood.take(rope);
  b.steel.add(box(0.2, 0.1, 0.2), m4([x, ROOM.height - 0.3, z]), 0x2a2d2f);
}

/** Chalk stand: pedestal with a bowl of chalk blocks. Returns the bowl top centre. */
export function buildChalkStand(b: GymBatches, chalk: GeometryBatch, at: V3, seed: number): THREE.Vector3 {
  const [x, , z] = at;
  b.black.add(cylinderUp(0.2, 0.03, 24), m4([x, 0, z]), C.steelBlack);
  b.black.add(cylinderUp(0.025, 0.86, 12), m4([x, 0.03, z]), C.steelBlack);
  const bowl = lathe([[0.04, 0.0], [0.17, 0.02], [0.22, 0.13], [0.225, 0.135], [0.21, 0.13], [0.16, 0.03], [0.04, 0.015]], 36, "y");
  b.black.add(bowl, m4([x, 0.88, z]), 0x2a2c2e);
  const rng = createRng(seed);
  const mound = new THREE.SphereGeometry(0.2, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  chalk.add(mound, m4([x, 0.97, z], [0, 0, 0], [0.98, 0.42, 0.98]), C.chalk);
  mound.dispose();
  for (let i = 0; i < 12; i += 1) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * 0.13;
    chalk.add(box(0.05 + rng() * 0.03, 0.03 + rng() * 0.02, 0.04 + rng() * 0.03, 0.01, 1), m4([x + Math.cos(a) * r, 1.03 + rng() * 0.02, z + Math.sin(a) * r], [rng(), rng() * 3, rng()]), C.chalk);
  }
  bowl.dispose();
  return new THREE.Vector3(x, 1.02, z);
}

/** Hanging industrial dome lamps; returns bulb positions. */
export function buildLamps(b: GymBatches, bulbs: GeometryBatch, positions: V3[]): THREE.Vector3[] {
  const shade = lathe([[0.03, -0.0], [0.05, -0.02], [0.15, -0.13], [0.235, -0.28], [0.245, -0.285], [0.24, -0.27], [0.16, -0.12], [0.06, -0.01], [0.035, 0.0]], 32, "y");
  const out: THREE.Vector3[] = [];
  for (const p of positions) {
    const [x, y, z] = p;
    b.steel.add(cylinderBetween(new THREE.Vector3(x, ROOM.height - 0.35, z), new THREE.Vector3(x, y + 0.25, z), 0.006, 6), undefined, 0x1c1d1e);
    b.steel.add(shade, m4([x, y + 0.25, z]), 0x2e3134);
    const bulb = new THREE.SphereGeometry(0.06, 16, 12);
    bulbs.add(bulb, m4([x, y + 0.08, z]));
    bulb.dispose();
    out.push(new THREE.Vector3(x, y + 0.08, z));
  }
  shade.dispose();
  return out;
}
