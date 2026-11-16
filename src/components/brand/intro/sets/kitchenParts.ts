/**
 * Kitchen set builders: room shell with a big back window, oak table and two chairs (to TABLE),
 * table dressing (linen napkins, cutlery, carafe, herb pot), open shelves with jars and books,
 * a counter run, pendant lamps and instanced-leaf plants for foreground bokeh.
 */

import * as THREE from "three";
import { TABLE } from "../dimensions";
import { createRng } from "../math";
import { KITCHEN_COLORS as K } from "./palettes";
import { GeometryBatch, box, cylinderBetween, cylinderUp, lathe, m4, sweep, curveThrough, type V3 } from "./util/geometry";

export const KROOM = { x0: -2.8, x1: 2.8, z0: -1.9, z1: 3.4, height: 2.75, wall: 0.2 } as const;
export const KWINDOW = { x0: -2.0, x1: 0.35, y0: 0.92, y1: 2.38 } as const;

export interface KitchenBatches {
  plaster: GeometryBatch;
  wood: GeometryBatch;
  walnut: GeometryBatch;
  white: GeometryBatch;
  metal: GeometryBatch;
  linen: GeometryBatch;
  glass: GeometryBatch;
  contents: GeometryBatch;
  ceramic: GeometryBatch;
  leaves: GeometryBatch;
  pots: GeometryBatch;
}

/** Walls (with the window opening), ceiling, skirting. */
export function buildRoom(b: KitchenBatches) {
  const { x0, x1, z0, z1, height: H, wall: T } = KROOM;
  const w = KWINDOW;
  const bz = z0 - T / 2;
  b.plaster.add(box(w.x0 - (x0 - T), H, T), m4([(x0 - T + w.x0) / 2, H / 2, bz]));
  b.plaster.add(box(x1 + T - w.x1, H, T), m4([(w.x1 + x1 + T) / 2, H / 2, bz]));
  b.plaster.add(box(w.x1 - w.x0, w.y0, T), m4([(w.x0 + w.x1) / 2, w.y0 / 2, bz]));
  b.plaster.add(box(w.x1 - w.x0, H - w.y1, T), m4([(w.x0 + w.x1) / 2, (H + w.y1) / 2, bz]));
  b.plaster.add(box(T, H, z1 - z0 + 2 * T), m4([x0 - T / 2, H / 2, (z0 + z1) / 2]));
  b.plaster.add(box(T, H, z1 - z0 + 2 * T), m4([x1 + T / 2, H / 2, (z0 + z1) / 2]));
  b.plaster.add(box(x1 - x0 + 2 * T, H, T), m4([(x0 + x1) / 2, H / 2, z1 + T / 2]));
  b.plaster.add(box(x1 - x0 + 2 * T, T, z1 - z0 + 2 * T), m4([(x0 + x1) / 2, H + T / 2, (z0 + z1) / 2]));
  // Skirting boards.
  b.white.add(box(x1 - x0, 0.08, 0.015), m4([(x0 + x1) / 2, 0.04, z0 + 0.008]), 0xefebe4);
  b.white.add(box(0.015, 0.08, z1 - z0), m4([x0 + 0.008, 0.04, (z0 + z1) / 2]), 0xefebe4);
}

/**
 * Black steel (Crittall-style) window: perimeter, five slim mullions, a transom; deep sill. The
 * mullions are what throw the low morning sun across the table in parallel stripes.
 */
export function buildWindow(b: KitchenBatches) {
  const w = KWINDOW;
  const z = KROOM.z0 - KROOM.wall / 2;
  const cx = (w.x0 + w.x1) / 2;
  const cy = (w.y0 + w.y1) / 2;
  const W = w.x1 - w.x0;
  const Hh = w.y1 - w.y0;
  const t = 0.045;
  const c = 0x1d1f21;
  b.metal.add(box(W, t, 0.05), m4([cx, w.y0 + t / 2, z]), c);
  b.metal.add(box(W, t, 0.05), m4([cx, w.y1 - t / 2, z]), c);
  b.metal.add(box(t, Hh, 0.05), m4([w.x0 + t / 2, cy, z]), c);
  b.metal.add(box(t, Hh, 0.05), m4([w.x1 - t / 2, cy, z]), c);
  const panes = 6;
  for (let k = 1; k < panes; k += 1) b.metal.add(box(0.034, Hh, 0.04), m4([w.x0 + (W * k) / panes, cy, z]), c);
  b.metal.add(box(W, 0.03, 0.04), m4([cx, w.y0 + Hh * 0.72, z]), c);
  b.wood.add(box(W + 0.1, 0.035, 0.32), m4([cx, w.y0 - 0.0175, KROOM.z0 + 0.06]));
}

/** Oak table to TABLE with tapered legs; chairs at TABLE.seats facing the table. */
export function buildTableAndChairs(b: KitchenBatches) {
  const { height: H, width: W, depth: D, topThickness: T } = TABLE;
  b.wood.add(box(W, T, D, 0.008, 3), m4([0, H - T / 2, 0]));
  b.wood.add(box(W - 0.16, 0.06, D - 0.16), m4([0, H - T - 0.03, 0]));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const top = new THREE.Vector3(sx * (W / 2 - 0.09), H - T, sz * (D / 2 - 0.09));
      const foot = new THREE.Vector3(sx * (W / 2 - 0.06), 0, sz * (D / 2 - 0.06));
      b.wood.add(cylinderBetween(foot, top, 0.016, 12, 0.026));
    }
  }
  for (const [index, seat] of TABLE.seats.entries()) {
    const facing = index === 0 ? 1 : -1;
    const [sx, sy, sz] = seat;
    const d = TABLE.seatDepth;
    // Seat pan (seat height = top of the pan), centred on TABLE.seats.
    b.walnut.add(box(d, 0.03, 0.43, 0.012, 3), m4([sx, sy - 0.015, sz]));
    const backX = sx - facing * (d / 2 - 0.02);
    for (const lz of [-0.18, 0.18]) {
      // Back legs rise into the backrest; front legs splay slightly.
      b.walnut.add(cylinderBetween(new THREE.Vector3(backX - facing * 0.04, 0, sz + lz * 1.05), new THREE.Vector3(backX, sy + 0.42, sz + lz), 0.013, 10, 0.016));
      b.walnut.add(cylinderBetween(new THREE.Vector3(sx + facing * (d / 2 - 0.03) + facing * 0.02, 0, sz + lz * 1.05), new THREE.Vector3(sx + facing * (d / 2 - 0.04), sy - 0.03, sz + lz), 0.013, 10, 0.016));
    }
    // Curved back rail.
    const rail: V3[] = [];
    for (let k = 0; k <= 6; k += 1) {
      const lz = -0.2 + (k / 6) * 0.4;
      rail.push([backX - facing * 0.03 * (1 - (lz / 0.2) ** 2), sy + 0.36, sz + lz]);
    }
    b.walnut.take(sweep(curveThrough(rail), { radius: 0.035, radius2: 0.012, tubularSegments: 24, radialSegments: 10, reference: new THREE.Vector3(0, 1, 0), caps: true }));
  }
}

/** Linen napkins, cutlery, a carafe of water (on the sill) and a small herb pot. */
export function buildTableDressing(b: KitchenBatches, seed: number) {
  const rng = createRng(seed);
  const H = TABLE.height;
  for (const [i, p] of TABLE.places.entries()) {
    const side = i === 0 ? -1 : 1;
    const nx = p.bowl[0] + side * 0.13;
    const nz = p.bowl[2] - side * 0.02;
    b.linen.add(box(0.11, 0.004, 0.17, 0.001, 1), m4([nx, H + 0.002, nz], [0, (rng() - 0.5) * 0.08, 0]), K.linen);
    // Fork and knife on the napkin (pointing across the table).
    const fork = box(0.012, 0.003, 0.15, 0.001, 1);
    b.metal.add(fork, m4([nx - 0.02, H + 0.006, nz]), K.steel);
    b.metal.add(fork, m4([nx + 0.022, H + 0.006, nz]), K.steel);
    fork.dispose();
  }
  // Carafe (glass) with water, on the window sill: backlit by the window behind Maya in the toast,
  // and out of the flat-lay (on the table it read as a white blob from above).
  const cx = -1.8;
  const cy = KWINDOW.y0;
  const cz = KROOM.z0 + 0.08;
  b.glass.add(lathe([[0, 0], [0.05, 0], [0.056, 0.01], [0.058, 0.12], [0.04, 0.18], [0.03, 0.24], [0.032, 0.25], [0.028, 0.252], [0.026, 0.24], [0.036, 0.18], [0.054, 0.12], [0.052, 0.012], [0, 0.008]], 40, "y"), m4([cx, cy, cz]));
  b.contents.add(lathe([[0, 0.009], [0.05, 0.011], [0.053, 0.12], [0.04, 0.165], [0, 0.165]], 32, "y"), m4([cx, cy, cz]), 0xcfe2e8);
  // Small ceramic herb pot with basil.
  b.ceramic.add(lathe([[0, 0], [0.04, 0], [0.048, 0.07], [0.05, 0.075], [0.044, 0.075], [0.0, 0.065]], 28, "y"), m4([-0.52, H, -0.3]), K.pot);
  for (let i = 0; i < 18; i += 1) {
    const a = rng() * Math.PI * 2;
    const r = 0.01 + rng() * 0.03;
    const leafGeo = new THREE.SphereGeometry(0.018, 8, 6);
    b.leaves.add(leafGeo, m4([-0.52 + Math.cos(a) * r, H + 0.09 + rng() * 0.05, -0.3 + Math.sin(a) * r], [rng() * 1.2, a, rng()], [1, 0.25, 0.6]), rng() > 0.4 ? 0x3f8a35 : 0x2f6e2a);
    leafGeo.dispose();
  }
}

/** Cut face of a lime half: rind ring, pith ring and nine pale segment membranes (vertex colours). */
function limeFace(radius: number): THREE.BufferGeometry {
  const segments = 36;
  const g = new THREE.RingGeometry(0, radius, segments, 5).rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const flesh = new THREE.Color(0xc4d860);
  const membrane = new THREE.Color(0xeef3c4);
  const pith = new THREE.Color(0xf1f0d4);
  const rind = new THREE.Color(0x467d24);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z) / radius;
    const a = (Math.atan2(z, x) / (Math.PI * 2) + 1) % 1;
    const nearMembrane = Math.abs(((a * 9) % 1) - 0.5) > 0.4 || r < 0.12;
    if (r > 0.95) c.copy(rind);
    else if (r > 0.84) c.copy(pith);
    else c.copy(nearMembrane ? membrane : flesh);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return g;
}

/**
 * Food-styled centre of the table for the overhead flat-lay: a charcoal stoneware plate with two
 * lime halves, a cream ramekin of chilli-sesame and a mint sprig, plus a few strays (blueberries
 * by Maya's berry smoothie, sesame on the wood).
 */
export function buildCentrepiece(b: KitchenBatches, seed: number) {
  const rng = createRng(seed);
  const H = TABLE.height;
  const [bx, bz] = [0.0, -0.07];
  // Shallow plate (lathe: foot, flat well, rolled rim); the well sits 7 mm above the table.
  b.ceramic.add(
    lathe([[0, 0.004], [0.05, 0.004], [0.052, 0], [0.058, 0], [0.06, 0.005], [0.074, 0.008], [0.084, 0.014], [0.087, 0.017], [0.083, 0.018], [0.072, 0.011], [0.06, 0.008], [0, 0.007]], 56, "y"),
    m4([bx, H, bz]),
    0x34383a,
  );
  const plateTop = H + 0.007;
  // Lime halves: rind dome below, cut face up (one tipped toward the light).
  const r = 0.022;
  const dome = new THREE.SphereGeometry(r, 24, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  const face = limeFace(r * 0.99);
  for (const [dx, dz, tilt, turn] of [[-0.032, 0.02, 0.08, 0.3], [0.026, -0.03, 0.3, 2.1]] as const) {
    const at: V3 = [bx + dx, plateTop + r * 0.82, bz + dz];
    b.contents.add(dome, m4(at, [tilt, turn, 0]), 0x4f8a2a);
    b.contents.add(face, m4(at, [tilt, turn, 0]));
  }
  dome.dispose();
  face.dispose();
  // Cream ramekin of chilli-sesame.
  const rx = bx + 0.036;
  const rz = bz + 0.034;
  b.ceramic.add(lathe([[0, 0], [0.022, 0], [0.026, 0.004], [0.027, 0.022], [0.024, 0.023], [0.022, 0.006], [0, 0.005]], 32, "y"), m4([rx, plateTop, rz]), K.ceramic);
  b.contents.add(lathe([[0, 0.017], [0.021, 0.015], [0.022, 0.007], [0, 0.007]], 24, "y"), m4([rx, plateTop, rz]), 0xb4442a);
  const flake = new THREE.SphereGeometry(0.0015, 5, 4);
  for (let i = 0; i < 22; i += 1) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * 0.018;
    b.contents.add(flake, m4([rx + Math.cos(a) * d, plateTop + 0.0175, rz + Math.sin(a) * d], [rng() * 3, rng() * 3, 0], [1.6, 0.5, 1]), rng() < 0.45 ? 0xf1e4c8 : 0x7a1e12);
  }
  flake.dispose();
  // Mint sprig: paired leaves fanning off a short stem at the plate's edge.
  const leaf = new THREE.SphereGeometry(0.012, 10, 6);
  const sx = bx - 0.05;
  const sz = bz - 0.046;
  for (let i = 0; i < 6; i += 1) {
    const pair = Math.floor(i / 2);
    const side = i % 2 ? 1 : -1;
    const along = 0.012 + pair * 0.014;
    const yaw = -0.5 + side * (0.9 - pair * 0.15);
    b.leaves.add(leaf, m4([sx + Math.cos(-0.5) * along + Math.cos(yaw) * 0.008, plateTop + 0.012 + pair * 0.002, sz + Math.sin(-0.5) * along + Math.sin(yaw) * 0.008], [0.2 * side, -yaw, 0], [1 - pair * 0.18, 0.18, 0.55 - pair * 0.08]), pair === 2 ? 0x4c9a3e : 0x2c6a28);
  }
  leaf.dispose();
  // Strays: blueberries by Maya's glass, sesame on the wood.
  const berry = new THREE.SphereGeometry(0.0062, 14, 10);
  const g0 = TABLE.places[0].glass;
  // A loose cluster of three and one stray (not a row, which reads as placed).
  for (const [dx, dz] of [[0.066, -0.036], [0.079, -0.026], [0.071, -0.05], [0.104, -0.071]]) b.contents.add(berry, m4([g0[0] + dx, H + 0.0058, g0[2] + dz]), 0x2b3466);
  berry.dispose();
  const seed1 = new THREE.SphereGeometry(0.0012, 6, 4);
  for (let i = 0; i < 22; i += 1) {
    const a = rng() * Math.PI * 2;
    const d = 0.12 + rng() * 0.1;
    b.contents.add(seed1, m4([bx + Math.cos(a) * d * 1.3, H + 0.0006, bz + Math.sin(a) * d * 0.7], [0, rng() * 6, 0], [1.6, 0.6, 1]), rng() < 0.8 ? 0xf2e7cf : 0x1c1a17);
  }
  seed1.dispose();
}

/** Open shelves with jars (glass + contents), stacked bowls, books, a trailing plant. */
export function buildShelves(b: KitchenBatches, seed: number) {
  const rng = createRng(seed);
  const z = KROOM.z0 + 0.14;
  const x0 = 0.75;
  const x1 = 2.45;
  const levels = [1.18, 1.56, 1.94];
  for (const y of levels) {
    b.wood.add(box(x1 - x0, 0.03, 0.26), m4([(x0 + x1) / 2, y, z]));
    for (const bx of [x0 + 0.12, x1 - 0.12]) b.metal.add(box(0.02, 0.05, 0.2), m4([bx, y - 0.04, z]), 0x1d1f21);
  }
  const jarColors = [0xe6cf9c, 0x8a5a3a, 0xd8b45a, 0x6b7a3a, 0xf0ead8, 0x9a3b2a];
  for (const [li, y] of levels.entries()) {
    let x = x0 + 0.1 + rng() * 0.05;
    while (x < x1 - 0.15) {
      const kind = rng();
      if (kind < 0.5) {
        const r = 0.045 + rng() * 0.02;
        const h = 0.12 + rng() * 0.1;
        b.glass.add(lathe([[0, 0], [r, 0], [r, h], [r * 0.85, h + 0.01], [0, h + 0.01]], 24, "y"), m4([x + r, y + 0.015, z]));
        b.contents.add(cylinderUp(r - 0.004, h * (0.5 + rng() * 0.4), 18), m4([x + r, y + 0.016, z]), jarColors[Math.floor(rng() * jarColors.length)]);
        b.metal.add(cylinderUp(r * 0.88, 0.018, 18), m4([x + r, y + 0.015 + h + 0.008, z]), rng() > 0.5 ? 0x2b2b2b : 0xb08a5a);
        x += r * 2 + 0.04;
      } else if (kind < 0.7) {
        for (let k = 0; k < 3; k += 1) b.ceramic.add(lathe([[0.03, 0], [0.07, 0.03], [0.072, 0.032], [0.066, 0.032], [0.028, 0.006]], 24, "y"), m4([x + 0.075, y + 0.015 + k * 0.024, z]), k === 1 ? 0x2f3233 : K.ceramic);
        x += 0.18;
      } else if (li < 2) {
        const n = 3 + Math.floor(rng() * 4);
        for (let k = 0; k < n; k += 1) {
          const bh = 0.17 + rng() * 0.07;
          b.white.add(box(0.03 + rng() * 0.012, bh, 0.16), m4([x + k * 0.04, y + 0.015 + bh / 2, z - 0.02]), [0x2f4a5a, 0xc44933, 0xe9e2d0, 0x3a3a38, 0x7a8a6a][Math.floor(rng() * 5)]);
        }
        x += n * 0.04 + 0.06;
      } else {
        // Trailing pothos on the top shelf.
        b.pots.add(lathe([[0, 0], [0.05, 0], [0.06, 0.1], [0.055, 0.1], [0, 0.09]], 24, "y"), m4([x + 0.06, y + 0.015, z]), K.pot);
        for (let k = 0; k < 26; k += 1) {
          const t = k / 26;
          const vine = (k % 3) * 0.06 - 0.06;
          const lfx = x + 0.06 + vine + Math.sin(t * 9) * 0.03;
          const lfy = y + 0.12 - t * 0.55;
          const leafGeo = new THREE.SphereGeometry(0.03, 8, 6);
          b.leaves.add(leafGeo, m4([lfx, lfy, z + 0.1 + rng() * 0.04], [rng() * 1.5, rng() * 6, rng()], [1, 0.18, 0.75]), rng() > 0.5 ? 0x4d8f3c : 0x3a7a32);
          leafGeo.dispose();
        }
        x += 0.2;
      }
    }
  }
}

/** Counter run along the right wall: base cabinets, oak top, kettle and a cutting board. */
export function buildCounter(b: KitchenBatches) {
  const x = KROOM.x1 - 0.31;
  const z0 = -1.85;
  const z1 = 1.1;
  b.white.add(box(0.6, 0.86, z1 - z0), m4([x, 0.43, (z0 + z1) / 2]), K.counter);
  for (let z = z0 + 0.3; z < z1; z += 0.6) b.white.add(box(0.012, 0.7, 0.56), m4([x - 0.305, 0.45, z]), 0xf0ece5);
  b.wood.add(box(0.64, 0.04, z1 - z0 + 0.02), m4([x - 0.01, 0.88, (z0 + z1) / 2]));
  b.metal.add(lathe([[0, 0], [0.075, 0], [0.08, 0.02], [0.082, 0.16], [0.06, 0.2], [0.02, 0.21], [0, 0.21]], 28, "y"), m4([x, 0.9, -0.6]), 0x2a2c2e);
  b.wood.add(box(0.3, 0.02, 0.45, 0.006, 2), m4([x, 0.91, 0.4], [0, 0.2, 0]));
}

/** Pendant lamps (shade + cord) over the table; returns the bulb positions for emissive bulbs. */
export function buildPendants(b: KitchenBatches, bulbs: GeometryBatch, positions: V3[]) {
  const shade = lathe([[0.018, -0.015], [0.088, -0.077], [0.148, -0.158], [0.155, -0.16], [0.15, -0.15], [0.09, -0.07], [0.02, -0.01], [0.012, 0.0]], 36, "y");
  for (const [x, y, z] of positions) {
    b.metal.add(cylinderBetween(new THREE.Vector3(x, KROOM.height, z), new THREE.Vector3(x, y + 0.1, z), 0.003, 6), undefined, 0x1a1a1a);
    b.metal.add(shade, m4([x, y + 0.1, z]), 0xc9a36a);
    const bulb = new THREE.SphereGeometry(0.035, 14, 10);
    bulbs.add(bulb, m4([x, y + 0.02, z]));
    bulb.dispose();
  }
  shade.dispose();
}

/** Monstera-like floor plant (instanced leaves on stems) in a pot. */
export function buildFloorPlant(b: KitchenBatches, at: V3, seed: number, scale = 1) {
  const rng = createRng(seed);
  const [x, , z] = at;
  b.pots.add(lathe([[0, 0], [0.16, 0], [0.2, 0.36], [0.205, 0.38], [0.19, 0.38], [0.0, 0.34]], 32, "y"), m4([x, 0, z], [0, 0, 0], scale), K.potDark);
  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, 0);
  leafShape.bezierCurveTo(0.16, 0.05, 0.2, 0.28, 0, 0.42);
  leafShape.bezierCurveTo(-0.2, 0.28, -0.16, 0.05, 0, 0);
  const flat = new THREE.ShapeGeometry(leafShape, 10);
  // Bend the leaf along its length.
  const p = flat.attributes.position;
  for (let i = 0; i < p.count; i += 1) {
    const yy = p.getY(i);
    const xx = p.getX(i);
    p.setZ(i, -yy * yy * 0.6 + xx * xx * 0.8);
  }
  flat.computeVertexNormals();
  for (let i = 0; i < 16; i += 1) {
    const a = rng() * Math.PI * 2;
    const h = (0.55 + rng() * 0.75) * scale;
    const lean = 0.25 + rng() * 0.45;
    const tip = new THREE.Vector3(x + Math.cos(a) * lean * h * 0.6, 0.35 * scale + h, z + Math.sin(a) * lean * h * 0.6);
    b.leaves.add(cylinderBetween(new THREE.Vector3(x, 0.32 * scale, z), tip, 0.006 * scale, 5), undefined, 0x4f7a34);
    const leafM = new THREE.Matrix4().compose(tip, new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.9 - rng() * 0.5, -a + Math.PI / 2, 0, "YXZ")), new THREE.Vector3(scale, scale, scale));
    b.leaves.add(flat, leafM, rng() > 0.5 ? K.leaf : K.leafLight);
  }
  flat.dispose();
}
