/**
 * Smoothie in a tall tumbler (TABLE.glassHeight / glassRadius): thick-based glass (Fresnel-weighted
 * transparency, no transmission pass), opaque smoothie with a frothy top, a striped paper straw,
 * and a garnish — blueberries and mint (berry) or a lime wheel and chia (green).
 *
 * Origin at the centre of the glass base, +Y up: re-parent the group to a hand bone freely.
 */

import * as THREE from "three";
import { TABLE } from "../../dimensions";
import { createRng } from "../../math";
import { CORAL } from "../palettes";
import type { SmoothieProp } from "../types";
import { Disposer } from "../util/canvas";
import { GeometryBatch, lathe, m4, paint } from "../util/geometry";
import { createGlass } from "../util/materials";

const KINDS = {
  berry: { liquid: 0xb8344f, froth: 0xd9708a, deep: 0x7a1f35, stripe: CORAL },
  green: { liquid: 0x86ad3f, froth: 0xb9d27a, deep: 0x4f7426, stripe: 0x3f8f4a },
} as const;

export function createSmoothie(kind: "berry" | "green"): SmoothieProp {
  const disposer = new Disposer();
  const group = new THREE.Group();
  group.name = `prop-smoothie-${kind}`;
  const H = TABLE.glassHeight;
  const R = TABLE.glassRadius;
  const rb = R - 0.0055;
  const wall = 0.0024;
  const c = KINDS[kind];
  const rng = createRng(kind === "berry" ? 71 : 73);

  // Glass shell (closed lathe: outside, rim, inside, thick base).
  const glassGeo = lathe(
    [
      [0, 0],
      [rb - 0.002, 0],
      [rb, 0.002],
      [R, H - 0.002],
      [R - 0.0004, H],
      [R - wall + 0.0004, H],
      [R - wall, H - 0.002],
      [rb - wall + 0.0004, 0.016],
      [rb - wall - 0.003, 0.0135],
      [0, 0.0135],
    ],
    64,
    "y",
  );
  const glassMat = disposer.track(createGlass({ edgeOpacity: 0.5, opacity: 0.1 }));
  const glass = new THREE.Mesh(disposer.track(glassGeo), glassMat);
  glass.name = "glass";
  glass.renderOrder = 3;
  glass.castShadow = false;

  // Smoothie body: fills to ~82%, with a gently domed, frothy top.
  const fill = 0.123;
  const inner = (y: number) => rb - wall - 0.0006 + ((R - rb) * (y - 0.0135)) / (H - 0.0135);
  const profile: Array<[number, number]> = [[0, 0.0138], [inner(0.0138) - 0.002, 0.0138], [inner(0.016), 0.016]];
  for (let k = 1; k <= 8; k += 1) {
    const y = 0.016 + ((fill - 0.016) * k) / 8;
    profile.push([inner(y), y]);
  }
  profile.push([inner(fill) - 0.002, fill + 0.0018], [inner(fill) * 0.6, fill + 0.004], [inner(fill) * 0.25, fill + 0.0048], [0, fill + 0.005]);
  const liquidGeo = lathe(profile, 48, "y");
  paint(liquidGeo, c.liquid);
  {
    const p = liquidGeo.attributes.position;
    const col = liquidGeo.attributes.color as THREE.BufferAttribute;
    const deep = new THREE.Color(c.deep);
    const froth = new THREE.Color(c.froth);
    const base = new THREE.Color(c.liquid);
    for (let i = 0; i < p.count; i += 1) {
      const y = p.getY(i);
      const t = (y - 0.0138) / (fill - 0.0138);
      const k = base.clone().lerp(deep, Math.max(0, 0.35 - t) * 1.2).lerp(froth, Math.max(0, (y - fill + 0.002) / 0.007));
      col.setXYZ(i, k.r, k.g, k.b);
    }
  }
  const liquidMat = disposer.track(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.48, metalness: 0, sheen: 0.6, sheenRoughness: 0.5, sheenColor: new THREE.Color(c.froth) }));
  const liquid = new THREE.Mesh(disposer.track(liquidGeo), liquidMat);
  liquid.name = "smoothie";

  // Striped paper straw, leaning out over the rim.
  const strawLen = 0.205;
  const strawGeo = new THREE.CylinderGeometry(0.0036, 0.0036, strawLen, 20, 80, false);
  paint(strawGeo, 0xf4f1ea);
  {
    const p = strawGeo.attributes.position;
    const col = strawGeo.attributes.color as THREE.BufferAttribute;
    const stripe = new THREE.Color(c.stripe);
    for (let i = 0; i < p.count; i += 1) {
      const a = Math.atan2(p.getZ(i), p.getX(i));
      const band = Math.sin(a * 2 + p.getY(i) * 260);
      if (band > 0.25) col.setXYZ(i, stripe.r, stripe.g, stripe.b);
    }
  }
  const strawMat = disposer.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0 }));
  const straw = new THREE.Mesh(disposer.track(strawGeo), strawMat);
  straw.position.set(0.009, 0.02 + strawLen / 2 - 0.004, 0.004);
  straw.rotation.set(0.05, 0, -0.2);
  straw.name = "straw";

  // Garnish.
  const garnish = new GeometryBatch();
  if (kind === "berry") {
    for (let i = 0; i < 3; i += 1) {
      const a = 2.1 + i * 0.9 + rng() * 0.3;
      const r = 0.012 + rng() * 0.01;
      const berry = new THREE.SphereGeometry(0.0062, 16, 12);
      garnish.add(berry, m4([Math.cos(a) * r, fill + 0.008, Math.sin(a) * r], [rng(), rng(), 0], [1, 0.9, 1]), 0x2b3466);
      garnish.add(new THREE.CircleGeometry(0.0022, 5).rotateX(-Math.PI / 2), m4([Math.cos(a) * r, fill + 0.0137, Math.sin(a) * r]), 0x1d2240);
      berry.dispose();
    }
    // Mint sprig: three small leaves.
    for (let i = 0; i < 3; i += 1) {
      const leaf = new THREE.SphereGeometry(0.009, 10, 6);
      garnish.add(leaf, m4([-0.008 + i * 0.006, fill + 0.009 + i * 0.002, -0.006 + i * 0.002], [0.4 + i * 0.5, i * 1.6, 0.3], [1, 0.18, 0.55]), i === 1 ? 0x3d7a35 : 0x2f6a2c);
      leaf.dispose();
    }
  } else {
    // Lime wheel slotted on the rim.
    const wheel = new THREE.CylinderGeometry(0.021, 0.021, 0.004, 28, 1);
    paint(wheel, 0xc9df7a);
    {
      const p = wheel.attributes.position;
      const col = wheel.attributes.color as THREE.BufferAttribute;
      const rind = new THREE.Color(0x4f8a2a);
      const pith = new THREE.Color(0xf0f2d6);
      for (let i = 0; i < p.count; i += 1) {
        const rr = Math.hypot(p.getX(i), p.getZ(i));
        if (rr > 0.0205) col.setXYZ(i, rind.r, rind.g, rind.b);
        else if (rr < 0.003) col.setXYZ(i, pith.r, pith.g, pith.b);
      }
    }
    garnish.take(wheel, m4([-R * 0.92, H - 0.004, 0], [0, 0, Math.PI / 2 - 0.12]));
    for (let i = 0; i < 26; i += 1) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * (R - 0.008);
      const seed = new THREE.SphereGeometry(0.0011, 6, 4);
      garnish.add(seed, m4([Math.cos(a) * r, fill + 0.0045 - r * 0.06, Math.sin(a) * r], [0, a, 0], [1.4, 0.7, 1]), 0x1b1a18);
      seed.dispose();
    }
  }
  const garnishMat = disposer.track(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.35, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.3 }));
  const garnishMesh = new THREE.Mesh(disposer.track(garnish.build()), garnishMat);
  garnishMesh.name = "garnish";

  group.add(liquid, straw, garnishMesh, glass);
  for (const o of [liquid, straw, garnishMesh]) {
    o.castShadow = true;
    o.receiveShadow = true;
  }
  glass.receiveShadow = false;

  return {
    group,
    dispose: () => {
      group.removeFromParent();
      disposer.dispose();
    },
  };
}
