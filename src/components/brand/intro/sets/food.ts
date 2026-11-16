/**
 * Grain bowls for the refuel scene, styled like a food-ad overhead: speckled stoneware bowl, quinoa
 * base, fanned salmon sashimi, avocado fan, spinach, cherry tomatoes (whole and halved), edamame,
 * pickled onion, sesame and a spicy-mayo drizzle. Built into shared per-material batches so both
 * bowls cost one draw call per ingredient type.
 */

import * as THREE from "three";
import { TABLE } from "../dimensions";
import { createRng } from "../math";
import { KITCHEN_COLORS as K } from "./palettes";
import { GeometryBatch, curveThrough, lathe, m4, paint, sweep, type V3 } from "./util/geometry";

export interface FoodBatches {
  bowl: GeometryBatch;
  quinoa: GeometryBatch;
  salmon: GeometryBatch;
  avocado: GeometryBatch;
  greens: GeometryBatch;
  tomato: GeometryBatch;
  tomatoCut: GeometryBatch;
  bits: GeometryBatch;
  sauce: GeometryBatch;
}

export function createFoodBatches(): FoodBatches {
  return {
    bowl: new GeometryBatch(),
    quinoa: new GeometryBatch(),
    salmon: new GeometryBatch(),
    avocado: new GeometryBatch(),
    greens: new GeometryBatch(),
    tomato: new GeometryBatch(),
    tomatoCut: new GeometryBatch(),
    bits: new GeometryBatch(),
    sauce: new GeometryBatch(),
  };
}

/** Stoneware bowl (rim radius TABLE.bowlRadius, height TABLE.bowlHeight) with a foot ring. */
function bowlGeometry(color: number): THREE.BufferGeometry {
  const R = TABLE.bowlRadius;
  const H = TABLE.bowlHeight;
  const t = 0.0055;
  const g = lathe(
    [
      [0, 0.004],
      [0.036, 0.004],
      [0.038, 0],
      [0.043, 0],
      [0.045, 0.006],
      [0.062, 0.016],
      [0.08, 0.034],
      [R - 0.002, H - 0.004],
      [R, H],
      [R - t * 0.6, H + 0.0015],
      [R - t, H - 0.002],
      [0.075, 0.034],
      [0.055, 0.018],
      [0.03, 0.0115],
      [0, 0.0105],
    ],
    72,
    "y",
  );
  // Planar UVs (top view) for the glaze speckle, 1 unit = 0.2 m.
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i += 1) uv.setXY(i, pos.getX(i) * 5 + pos.getY(i) * 2, pos.getZ(i) * 5);
  return paint(g, color);
}

/** Domed quinoa bed filling the bowl, with planar UVs in meters/0.12. */
function quinoaBed(): THREE.BufferGeometry {
  const r = 0.079;
  const g = new THREE.CircleGeometry(r, 48, 0, Math.PI * 2);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const d = Math.hypot(x, z) / r;
    pos.setY(i, 0.04 + (1 - d * d) * 0.012);
    uv.setXY(i, x / 0.12, z / 0.12);
  }
  g.computeVertexNormals();
  return g;
}

/** Sashimi slice: rounded slab with the long axis along X, UVs across the fat lines. */
function salmonSlice(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const L = 0.052;
  const W = 0.026;
  shape.moveTo(-L / 2, -W / 2 + 0.004);
  shape.quadraticCurveTo(-L / 2, -W / 2, -L / 2 + 0.006, -W / 2);
  shape.lineTo(L / 2 - 0.01, -W / 2);
  shape.quadraticCurveTo(L / 2, -W / 2, L / 2, -W / 2 + 0.008);
  shape.lineTo(L / 2 - 0.003, W / 2 - 0.004);
  shape.quadraticCurveTo(L / 2 - 0.004, W / 2, L / 2 - 0.01, W / 2);
  shape.lineTo(-L / 2 + 0.005, W / 2);
  shape.quadraticCurveTo(-L / 2, W / 2, -L / 2, W / 2 - 0.005);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.0025, bevelSize: 0.0025, bevelSegments: 3, curveSegments: 8 });
  g.translate(0, 0, -0.004);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i += 1) uv.setXY(i, pos.getX(i) / 0.06 + 0.5, pos.getZ(i) / 0.06 + pos.getY(i) * 3);
  g.computeVertexNormals();
  return g;
}

/** Avocado slice: crescent, pale yellow-green flesh grading to a dark green skin edge. */
function avocadoSlice(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  // Crescent: outer (skin) arc around the origin, shallower inner (pit) arc through its ends.
  shape.absarc(0, 0, 0.042, -0.95, 0.95, false);
  shape.absarc(-0.0772, 0, 0.1072, 0.3242, -0.3242, true);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.0045, bevelEnabled: true, bevelThickness: 0.0012, bevelSize: 0.0012, bevelSegments: 2, curveSegments: 18 });
  g.rotateX(-Math.PI / 2);
  paint(g, K.avocadoIn);
  const pos = g.attributes.position;
  const col = g.attributes.color as THREE.BufferAttribute;
  const inC = new THREE.Color(K.avocadoIn);
  const mid = new THREE.Color(K.avocadoMid);
  const skin = new THREE.Color(K.avocadoSkin);
  const nor = g.attributes.normal;
  for (let i = 0; i < pos.count; i += 1) {
    // Distance in from the convex (skin) edge: pale yellow at the pit side, green towards the skin.
    const fromSkin = 0.042 - Math.hypot(pos.getX(i), pos.getZ(i));
    const cap = Math.abs(nor.getY(i)) > 0.7;
    const c = mid.clone().lerp(inC, THREE.MathUtils.smoothstep(fromSkin, 0.0, 0.008));
    // The dark skin only shows on the outer wall, never on the cut faces.
    if (!cap && fromSkin < 0.002) c.copy(skin);
    col.setXYZ(i, c.r, c.g, c.b);
  }
  return g;
}

/** Spinach leaf: pointed oval, cupped, with leaf-space UVs (u across, v along). */
function leaf(length: number, width: number, cup: number, seed: number): THREE.BufferGeometry {
  const rng = createRng(seed);
  const nu = 6;
  const nv = 10;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const twist = (rng() - 0.5) * 0.6;
  for (let j = 0; j <= nv; j += 1) {
    const v = j / nv;
    const w = Math.sin(Math.PI * Math.pow(v, 0.8)) * width * 0.5 * (1 - 0.15 * v);
    for (let i = 0; i <= nu; i += 1) {
      const u = i / nu;
      const x = (u - 0.5) * 2 * w;
      const z = v * length;
      const y = cup * (x / (width * 0.5)) ** 2 * width * 0.5 + Math.sin(v * Math.PI) * 0.004 + x * twist * v;
      pos.push(x, y, z);
      uv.push(u, v);
    }
  }
  for (let j = 0; j < nv; j += 1) {
    for (let i = 0; i < nu; i += 1) {
      const a = j * (nu + 1) + i;
      idx.push(a, a + nu + 1, a + 1, a + 1, a + nu + 1, a + nu + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Fills one bowl centred at `at` (bowl base on the table). `turn` rotates the arrangement. */
export function buildBowl(b: FoodBatches, at: V3, turn: number, seed: number, glaze: number) {
  const rng = createRng(seed);
  const [bx, by, bz] = at;
  const place = (x: number, y: number, z: number): V3 => {
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    return [bx + x * c - z * s, by + y, bz + x * s + z * c];
  };
  b.bowl.take(bowlGeometry(glaze), m4([bx, by, bz], [0, turn, 0]));
  b.quinoa.take(quinoaBed(), m4([bx, by, bz], [0, turn, 0]));

  // Sector layout (angles in the bowl's frame): salmon 0..1.4, avocado 1.6..3.0, greens 3.2..4.3,
  // edamame 4.4..5.1, tomatoes 5.1..6.1. Toppings ride on a dome ~4.8 cm above the base.
  const surf = (r: number) => 0.048 + (1 - (r / 0.079) ** 2) * 0.01;
  const slice = salmonSlice();
  for (let i = 0; i < 5; i += 1) {
    const a = 0.15 + i * 0.27;
    const r = 0.045;
    const p = place(Math.cos(a) * r, surf(r) + 0.006 + i * 0.0015, Math.sin(a) * r);
    b.salmon.add(slice, m4(p, [0.0, -(a + turn), 0.22]));
  }
  slice.dispose();
  const avo = avocadoSlice();
  for (let i = 0; i < 6; i += 1) {
    const a = 1.75 + i * 0.2;
    const r = 0.03;
    const p = place(Math.cos(a) * r, surf(r) + 0.004 + i * 0.0012, Math.sin(a) * r);
    b.avocado.add(avo, m4(p, [0.0, -(a + turn), 0.1]));
  }
  avo.dispose();
  for (let i = 0; i < 18; i += 1) {
    const a = 3.2 + rng() * 1.15;
    const r = 0.022 + rng() * 0.05;
    const lf = leaf(0.03 + rng() * 0.014, 0.022 + rng() * 0.01, 0.3 + rng() * 0.3, seed * 7 + i);
    const p = place(Math.cos(a) * r, surf(r) + 0.002 + rng() * 0.006, Math.sin(a) * r);
    b.greens.take(lf, m4(p, [(rng() - 0.5) * 0.5, rng() * Math.PI * 2, (rng() - 0.5) * 0.5]));
  }
  // Edamame pile.
  const bean = new THREE.SphereGeometry(0.0062, 10, 8);
  for (let i = 0; i < 16; i += 1) {
    const a = 4.45 + rng() * 0.6;
    const r = 0.025 + rng() * 0.045;
    const p = place(Math.cos(a) * r, surf(r) + 0.004 + rng() * 0.004, Math.sin(a) * r);
    b.bits.add(bean, m4(p, [rng() * 3, rng() * 3, 0], [1.25, 0.85, 0.95]), rng() > 0.5 ? K.edamame : 0x8fbf4a);
  }
  bean.dispose();
  // Cherry tomatoes: two whole, three halves (cut face up).
  const whole = new THREE.SphereGeometry(0.0125, 20, 14);
  const half = new THREE.SphereGeometry(0.0125, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  half.rotateX(Math.PI);
  const face = new THREE.CircleGeometry(0.0124, 24).rotateX(-Math.PI / 2);
  for (let i = 0; i < 5; i += 1) {
    const a = 5.2 + i * 0.2 + rng() * 0.05;
    const r = 0.052 + rng() * 0.012;
    const y = surf(r);
    if (i < 2) {
      const p = place(Math.cos(a) * r, y + 0.011, Math.sin(a) * r);
      b.tomato.add(whole, m4(p, [rng(), rng(), 0], [1, 0.92, 1]), K.tomato);
      b.tomato.add(new THREE.ConeGeometry(0.004, 0.003, 5), m4([p[0], p[1] + 0.0115, p[2]]), 0x3f6e2a);
    } else {
      const tilt = (rng() - 0.5) * 0.5;
      const p = place(Math.cos(a) * r, y + 0.0105, Math.sin(a) * r);
      b.tomato.add(half, m4(p, [tilt, rng() * 6, 0]), K.tomato);
      b.tomatoCut.add(face, m4(p, [tilt, rng() * 6, 0]));
    }
  }
  whole.dispose();
  half.dispose();
  face.dispose();
  // Pickled onion rings (pink) and sesame.
  for (let i = 0; i < 4; i += 1) {
    const a = rng() * Math.PI * 2;
    const r = 0.03 + rng() * 0.03;
    const ring = new THREE.TorusGeometry(0.0065, 0.0011, 6, 18);
    b.bits.add(ring, m4(place(Math.cos(a) * r, surf(r) + 0.012, Math.sin(a) * r), [Math.PI / 2 + (rng() - 0.5) * 0.6, 0, rng() * 3]), 0xc4547e);
    ring.dispose();
  }
  const seed1 = new THREE.SphereGeometry(0.0011, 6, 4);
  for (let i = 0; i < 48; i += 1) {
    const a = rng() < 0.65 ? 0.1 + rng() * 1.3 : 1.7 + rng() * 1.2;
    const r = 0.02 + rng() * 0.045;
    const p = place(Math.cos(a) * r, surf(r) + (a < 1.5 ? 0.0165 : 0.0115) + rng() * 0.002, Math.sin(a) * r);
    b.bits.add(seed1, m4(p, [0, rng() * 6, 0], [1.6, 0.6, 1]), rng() < 0.75 ? K.sesame : 0x1c1a17);
  }
  seed1.dispose();
  // Spicy mayo drizzle zig-zagging over the salmon.
  const pts: V3[] = [];
  for (let k = 0; k <= 7; k += 1) {
    const a = 0.1 + (k / 7) * 1.25;
    const r = k % 2 ? 0.03 : 0.064;
    pts.push(place(Math.cos(a) * r, surf(r) + 0.02, Math.sin(a) * r));
  }
  b.sauce.take(sweep(curveThrough(pts, false, 0.6), { radius: 0.0014, radius2: 0.0009, tubularSegments: 70, radialSegments: 8, caps: true, reference: new THREE.Vector3(0, 1, 0) }));
}
