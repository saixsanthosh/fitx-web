/**
 * Track set structures: kerbs, the main grandstand with instanced seats and a cantilever roof,
 * the outer fence, floodlight masts with lamp heads, the far stand and end-zone bits. Everything is
 * batched per material (vertex-coloured) to keep the set inside its draw-call budget.
 */

import * as THREE from "three";
import { createRng } from "../math";
import { TRACK_COLORS as C } from "./palettes";
import { GeometryBatch, box, cylinderBetween, cylinderUp, m4, type V3 } from "./util/geometry";

/** Track layout in set space (see `TRACK` in dimensions.ts for the shared numbers). */
export const LAYOUT = {
  laneEdgeX: -4.27,
  kerb: { x0: -4.36, x1: -4.3, height: 0.05 },
  tartan: { x0: -4.3, x1: 5.62 },
  outerCurb: { x0: 5.62, x1: 5.78, height: 0.1 },
  bikeLane: { x0: 5.78, x1: 7.98 },
  gutter: { x0: 7.98, x1: 8.14, height: 0.06 },
  fenceX: 8.62,
  apron: { x0: 8.14, x1: 12.85 },
  stand: { x0: 12.85, rows: 14, rowDepth: 0.8, rowRise: 0.38, firstRowY: 1.1, z0: -20, z1: 90 },
  z0: -34,
  z1: 134,
  farStraight: { x0: -78.6, x1: -68.6 },
  masts: [
    [-14, -40],
    [21, -40],
    [-14, 140],
    [21, 140],
  ] as Array<[number, number]>,
  mastHeight: 31.5,
} as const;

const standTop = () => LAYOUT.stand.firstRowY + LAYOUT.stand.rows * LAYOUT.stand.rowRise;
const standBackX = () => LAYOUT.stand.x0 + 0.55 + LAYOUT.stand.rows * LAYOUT.stand.rowDepth;

/** Inner aluminium kerb, outer concrete curb and the bike-lane gutter (one batch). */
export function buildKerbs(batch: GeometryBatch) {
  const len = LAYOUT.z1 - LAYOUT.z0;
  const zc = (LAYOUT.z0 + LAYOUT.z1) / 2;
  const k = LAYOUT.kerb;
  batch.add(box(k.x1 - k.x0, k.height, len, 0.012, 2), m4([(k.x0 + k.x1) / 2, k.height / 2, zc]), C.kerb);
  const o = LAYOUT.outerCurb;
  batch.add(box(o.x1 - o.x0, o.height, len, 0.02, 2), m4([(o.x0 + o.x1) / 2, o.height / 2 - 0.005, zc]), C.curb);
  const g = LAYOUT.gutter;
  batch.add(box(g.x1 - g.x0, g.height, len, 0.015, 2), m4([(g.x0 + g.x1) / 2, g.height / 2 - 0.005, zc]), C.curb);
  // Short kerb posts every 4 m keep the inner kerb from reading as a pipe in close-ups.
  for (let z = LAYOUT.z0 + 2; z < LAYOUT.z1; z += 4) {
    batch.add(box(0.07, 0.012, 0.05), m4([(k.x0 + k.x1) / 2, 0.006, z]), 0x9a9893);
  }
}

/** Low steel railing between the bike lane and the apron. */
export function buildFence(batch: GeometryBatch) {
  const x = LAYOUT.fenceX;
  const z0 = LAYOUT.z0;
  const z1 = LAYOUT.z1;
  const post = box(0.05, 1.04, 0.05, 0.008, 1);
  for (let z = z0; z <= z1; z += 2.5) batch.add(post, m4([x, 0.52, z]), C.fence);
  const rail = new THREE.CylinderGeometry(0.024, 0.024, z1 - z0, 10, 1, false);
  rail.rotateX(Math.PI / 2);
  batch.add(rail, m4([x, 1.04, (z0 + z1) / 2]), C.fence);
  batch.add(rail, m4([x, 0.56, (z0 + z1) / 2], [0, 0, 0], [0.7, 1, 0.7]), C.fence);
  // Kick board: graphite with a thin coral top edge (brand accent, no logos).
  batch.add(box(0.02, 0.22, z1 - z0), m4([x + 0.02, 0.13, (z0 + z1) / 2]), C.seatGraphite);
  batch.add(box(0.022, 0.025, z1 - z0), m4([x + 0.02, 0.255, (z0 + z1) / 2]), C.seatCoral);
}

/** Stepped concrete terrace profile extruded along Z, plus front parapet and back wall. */
export function buildStandStructure(concrete: GeometryBatch, steel: GeometryBatch, roof: GeometryBatch) {
  const s = LAYOUT.stand;
  const shape = new THREE.Shape();
  const x0 = s.x0;
  shape.moveTo(x0, 0);
  shape.lineTo(x0, s.firstRowY + 0.28);
  shape.lineTo(x0 + 0.18, s.firstRowY + 0.28);
  shape.lineTo(x0 + 0.18, s.firstRowY);
  let x = x0 + 0.55;
  shape.lineTo(x, s.firstRowY);
  for (let r = 0; r < s.rows; r += 1) {
    const y = s.firstRowY + r * s.rowRise;
    shape.lineTo(x + s.rowDepth, y);
    shape.lineTo(x + s.rowDepth, y + s.rowRise);
    x += s.rowDepth;
  }
  const top = standTop();
  shape.lineTo(x + 0.3, top);
  shape.lineTo(x + 0.3, top + 2.6);
  shape.lineTo(x + 0.6, top + 2.6);
  shape.lineTo(x + 0.6, 0);
  shape.closePath();
  const length = s.z1 - s.z0;
  const terrace = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false, curveSegments: 1 });
  terrace.translate(0, 0, s.z0);
  concrete.take(terrace, undefined, C.standConcrete);
  // End walls (close the extrusion visually) are part of the extrude caps.

  // Coral stripe along the parapet top (brand accent visible from the track).
  concrete.add(box(0.2, 0.06, length), m4([x0 + 0.09, s.firstRowY + 0.31, (s.z0 + s.z1) / 2]), C.seatCoral);

  // Roof: cantilevered slab with fascia, back columns and raking stays.
  const backX = standBackX();
  const roofY = top + 5.2;
  const roofX0 = x0 - 0.8;
  const roofX1 = backX + 0.9;
  roof.add(box(roofX1 - roofX0, 0.28, length + 2), m4([(roofX0 + roofX1) / 2, roofY, (s.z0 + s.z1) / 2], [0, 0, -0.05]), C.roof);
  roof.add(box(0.12, 0.9, length + 2.2), m4([roofX0 - 0.02, roofY - 0.25, (s.z0 + s.z1) / 2]), 0xdedcd6);
  for (let z = s.z0; z <= s.z1 + 0.01; z += 11) {
    steel.add(cylinderBetween(new THREE.Vector3(backX + 0.45, top + 2.6, z), new THREE.Vector3(backX + 0.45, roofY, z), 0.18, 10), undefined, C.steel);
    steel.add(cylinderBetween(new THREE.Vector3(backX + 0.45, roofY + 0.1, z), new THREE.Vector3(roofX0 + 2, roofY + 2.4, z), 0.07, 8), undefined, C.steel);
    steel.add(cylinderBetween(new THREE.Vector3(roofX0 + 2, roofY + 2.4, z), new THREE.Vector3(roofX0 + 0.2, roofY + 0.1, z), 0.06, 8), undefined, C.steel);
  }
}

/** Instanced bucket seats on every terrace row (aisles every 14 m). */
export function buildSeats(seed: number): THREE.InstancedMesh {
  const s = LAYOUT.stand;
  // A folded strip: lip, pan and back — 8 triangles, double-sided.
  const profile: Array<[number, number]> = [
    [-0.06, 0.32],
    [0.0, 0.4],
    [0.3, 0.42],
    [0.36, 0.5],
    [0.4, 0.78],
  ];
  const width = 0.42;
  const pos: number[] = [];
  for (let i = 0; i < profile.length - 1; i += 1) {
    const [x0, y0] = profile[i];
    const [x1, y1] = profile[i + 1];
    pos.push(x0, y0, -width / 2, x1, y1, -width / 2, x1, y1, width / 2, x0, y0, -width / 2, x1, y1, width / 2, x0, y0, width / 2);
  }
  const seatGeo = new THREE.BufferGeometry();
  seatGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  seatGeo.computeVertexNormals();
  const rng = createRng(seed);
  const transforms: THREE.Matrix4[] = [];
  const colours: THREE.Color[] = [];
  const coral = new THREE.Color(C.seatCoral);
  const graphite = new THREE.Color(C.seatGraphite);
  const grey = new THREE.Color(C.seatGrey);
  for (let r = 0; r < s.rows; r += 1) {
    const y = s.firstRowY + r * s.rowRise;
    // Seat faces -X (towards the track); its local +X points back into the stand.
    const xFront = s.x0 + 0.55 + r * s.rowDepth + 0.3;
    for (let z = s.z0 + 0.5; z < s.z1 - 0.4; z += 0.5) {
      const aisle = ((z - s.z0) % 14 + 14) % 14;
      if (aisle < 1.1) continue;
      transforms.push(m4([xFront, y, z]));
      // Coral block in the central sections, graphite elsewhere, grey band at the top rows.
      const central = z > 10 && z < 52;
      const base = r > 11 ? grey : central ? coral : graphite;
      const c = base.clone().multiplyScalar(0.9 + rng() * 0.18);
      colours.push(c);
    }
  }
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(seatGeo, material, transforms.length);
  transforms.forEach((t, i) => mesh.setMatrixAt(i, t));
  colours.forEach((c, i) => mesh.setColorAt(i, c));
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.name = "stand-seats";
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

/** Emissive strip lights under the roof front (lit at night). */
export function buildRoofStrips(batch: GeometryBatch) {
  const s = LAYOUT.stand;
  const roofY = standTop() + 5.2;
  for (let z = s.z0 + 3; z < s.z1 - 2; z += 6) {
    batch.add(box(0.5, 0.05, 2.6), m4([s.x0 + 1.4, roofY - 0.2, z]));
  }
}

export interface MastHeads {
  /** Lamp centre points (set space) and the direction they aim. */
  heads: Array<{ position: THREE.Vector3; aim: THREE.Vector3 }>;
}

/** Floodlight masts: tapered poles, head frames and lamp fronts (emissive batch). */
export function buildMasts(steel: GeometryBatch, lamps: GeometryBatch): MastHeads {
  const heads: MastHeads["heads"] = [];
  const aimTarget = new THREE.Vector3(-8, 0, 40);
  for (const [mx, mz] of LAYOUT.masts) {
    const h = LAYOUT.mastHeight;
    steel.add(cylinderUp(0.62, h - 1.5, 10, 0.32), m4([mx, 0, mz]), C.steel);
    const head = new THREE.Vector3(mx, h, mz);
    const aim = new THREE.Vector3(aimTarget.x * 0.6 + mx * 0.4, 0, mz < 0 ? 28 : 60);
    const dir = new THREE.Vector3().subVectors(aim, head).normalize();
    // Frame faces the aim point: build in a local frame (Z = aim direction).
    const zAxis = dir.clone();
    const xAxis = new THREE.Vector3(0, 1, 0).cross(zAxis).normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
    const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis).setPosition(head);
    const frameW = 6.2;
    const frameH = 4.2;
    steel.add(box(frameW, 0.12, 0.12), basis.clone().multiply(m4([0, frameH / 2, -0.2])), C.steelDark);
    steel.add(box(frameW, 0.12, 0.12), basis.clone().multiply(m4([0, -frameH / 2, -0.2])), C.steelDark);
    for (let i = 0; i <= 4; i += 1) steel.add(box(0.1, frameH, 0.1), basis.clone().multiply(m4([-frameW / 2 + (i * frameW) / 4, 0, -0.2])), C.steelDark);
    steel.add(cylinderBetween(new THREE.Vector3(mx, h - 1.6, mz), head.clone().addScaledVector(yAxis, -frameH / 2), 0.2, 8), undefined, C.steel);
    const housing = box(0.62, 0.48, 0.42, 0.04, 1);
    const front = new THREE.CircleGeometry(0.24, 16);
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 6; col += 1) {
        const lx = -frameW / 2 + 0.55 + col * ((frameW - 1.1) / 5);
        const ly = -frameH / 2 + 0.6 + row * ((frameH - 1.2) / 3);
        steel.add(housing, basis.clone().multiply(m4([lx, ly, 0.05])), 0x2a2d30);
        lamps.add(front, basis.clone().multiply(m4([lx, ly, 0.265])));
      }
    }
    front.dispose();
    heads.push({ position: head.clone().addScaledVector(zAxis, 0.3), aim });
  }
  return { heads };
}

/** Far-side covered stand and clubhouse silhouettes (distance detail; vertex-coloured). */
export function buildFarStructures(concrete: GeometryBatch, roof: GeometryBatch) {
  const x0 = -96;
  // Far stand: simple stepped block with roof, facing +X.
  for (let r = 0; r < 8; r += 1) {
    const h = 0.9 + r * 0.42;
    concrete.add(box(1.0, h, 70), m4([x0 + 9 - r * 1.0, h / 2, 48]), 0xd8d4cc);
    // Seat band on each step: coral centre block, graphite wings.
    concrete.add(box(0.5, 0.36, 26), m4([x0 + 9.1 - r * 1.0, h + 0.18, 48]), C.seatCoral);
    concrete.add(box(0.5, 0.36, 21), m4([x0 + 9.1 - r * 1.0, h + 0.18, 24]), C.seatGraphite);
    concrete.add(box(0.5, 0.36, 21), m4([x0 + 9.1 - r * 1.0, h + 0.18, 72]), C.seatGraphite);
  }
  roof.add(box(10, 0.3, 72), m4([x0 + 5, 7.6, 48], [0, 0, 0.06]), C.roof);
  for (let z = 14; z <= 84; z += 10) roof.add(box(0.25, 7.4, 0.25), m4([x0 + 0.6, 3.7, z]), C.steel);
  // Clubhouse at the start end (off the sun axis), with a glazed band.
  concrete.add(box(18, 6, 10), m4([30, 3, -44]), 0xcac4b8);
  concrete.add(box(18.2, 1.4, 10.2), m4([30, 4.2, -44]), 0x3d4650);
}

/** Field-event silhouettes in the infield (high-jump mats, a throwing cage) for depth cues. */
export function buildInfieldProps(batch: GeometryBatch) {
  batch.add(box(6, 0.7, 4, 0.15, 2), m4([-30, 0.35, 70]), 0x2f4f7a);
  batch.add(box(6, 0.12, 4.2), m4([-30, 0.76, 70]), 0x274264);
  const cage: V3[] = [];
  for (let i = 0; i < 10; i += 1) {
    const a = (i / 9) * Math.PI * 1.4 - Math.PI * 0.2;
    cage.push([-48 + Math.cos(a) * 4, 0, 24 + Math.sin(a) * 4]);
  }
  for (const p of cage) batch.add(cylinderUp(0.05, 6.5, 6), m4(p), 0x9aa0a4);
}

export { standTop, standBackX };
