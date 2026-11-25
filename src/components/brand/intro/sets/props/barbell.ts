/**
 * Olympic barbell to `BARBELL` (dimensions.ts): knurled shaft (centre knurl, IPF/IWF rings),
 * chrome sleeves with coral end caps, coral 20 kg and graphite 10 kg bumpers with raised rims, steel
 * hub inserts and embossed "20 KG"/"10 KG" lettering, and competition collars with a clamp lever.
 *
 * Local space: origin at the bar centre, bar along X. Left = +X (the lifter's left), right = -X.
 * `setBend` deforms the shaft outside the grip on the CPU and tilts each rigid sleeve assembly, so
 * plates follow the bend; the shadow pass sees the same geometry.
 */

import * as THREE from "three";
import { BARBELL } from "../../dimensions";
import { clamp01 } from "../../math";
import { CORAL } from "../palettes";
import type { BarbellPlate, BarbellProp } from "../types";
import { Disposer, canvas2d, canvasTexture, plateArtwork } from "../util/canvas";
import { GeometryBatch, box, lathe, m4 } from "../util/geometry";

/**
 * Sleeve-end dip below the bar centre at bend 1 (m). A 200 kg bar visibly bows at the break; the
 * lift driver (`motion/lift.ts`, BAR_END_DIP) mirrors this to keep the plates on the platform.
 */
const PEAK_DIP = 0.1;
const KNURL_TILE = 0.0128;
const SHAFT_SEGMENTS_PER_M = 90;

/**
 * The bumpers' face artwork (`plateArtwork`): the coral 20 kg and the graphite 10 kg plate. The welcome film's 5 kg
 * plate wears the coral face with its own weight (`films/welcome/props.ts`).
 */
export const PLATE_FACES = {
  coral: { base: "#c44933", ink: "#f4efe8", text: "20 KG", small: "OLYMPIC BUMPER", ringInk: "#a83c29" },
  graphite: { base: "#34383b", ink: "#cfcdc8", text: "10 KG", small: "OLYMPIC BUMPER", ringInk: "#2a2d30" },
} as const;

/** Name of each plate's rubber body mesh, the one that wears the face artwork (the hub insert is steel). */
export const PLATE_BODY = "plate-body";

/** Diamond knurl height pattern (8 × 8 diamonds per tile) for a bump map. */
function knurlCanvas(size = 256) {
  const { canvas, ctx } = canvas2d(size, size);
  const img = ctx.createImageData(size, size);
  const n = 8;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x / size) * n;
      const v = (y / size) * n;
      const a = (u + v) % 1;
      const b = (((u - v) % 1) + 1) % 1;
      const h = Math.min(1 - Math.abs(2 * a - 1), 1 - Math.abs(2 * b - 1));
      const k = Math.min(1, h * 1.25) * 255;
      const o = (y * size + x) * 4;
      img.data[o] = k;
      img.data[o + 1] = k;
      img.data[o + 2] = k;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Shaft piece along X from x0 to x1 with metric UVs (u around × 7 diamonds tiles, v along). */
function shaftPiece(x0: number, x1: number, radius: number): THREE.BufferGeometry {
  const len = x1 - x0;
  const segs = Math.max(2, Math.ceil(len * SHAFT_SEGMENTS_PER_M));
  const g = new THREE.CylinderGeometry(radius, radius, len, 20, segs, true);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * 7, (uv.getY(i) * len) / KNURL_TILE);
  g.rotateZ(-Math.PI / 2);
  g.translate((x0 + x1) / 2, 0, 0);
  return g;
}

/** Bumper plate body (rubber) as a lathe around X, centred at 0, with planar face UVs. */
function plateBody(diameter: number, thickness: number): THREE.BufferGeometry {
  const R = diameter / 2;
  const h = thickness / 2;
  // The side wall's two rings are doubled (rows 7–8) so the wall gets UVs of its own: shared with
  // the faces it would interpolate between the two mirrored face mappings and smear a squeezed,
  // reversed copy of the lettering round the rim.
  const profile: Array<[number, number]> = [
    [0.067, -h + 0.007],
    [0.07, -h + 0.0058],
    [R - 0.026, -h + 0.0058],
    [R - 0.022, -h + 0.0005],
    [R - 0.009, -h],
    [R - 0.002, -h + 0.002],
    [R, -h + 0.007],
    [R, -h + 0.007],
    [R, h - 0.007],
    [R, h - 0.007],
    [R - 0.002, h - 0.002],
    [R - 0.009, h],
    [R - 0.022, h - 0.0005],
    [R - 0.026, h - 0.0058],
    [0.07, h - 0.0058],
    [0.067, h - 0.007],
  ];
  const rows = profile.length;
  const g = lathe(profile, 72, "x");
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i += 1) {
    const row = i % rows;
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (row === 7 || row === 8) {
      // Side wall: plain rubber from just inside the artwork's edge (one mapping, no flip).
      uv.setXY(i, 0.5 + (z / R) * 0.47, 0.5 + (y / R) * 0.47);
    } else {
      // Each face reads correctly from its own side.
      uv.setXY(i, 0.5 + (row < 7 ? z : -z) / diameter, 0.5 + y / diameter);
    }
  }
  return g;
}

/** Steel hub insert ring. */
function plateHub(thickness: number): THREE.BufferGeometry {
  const h = thickness / 2;
  return lathe([[0.0256, -h + 0.003], [0.064, -h + 0.003], [0.068, -h + 0.006], [0.068, h - 0.006], [0.064, h - 0.003], [0.0256, h - 0.003], [0.0256, -h + 0.003]], 40, "x");
}

export function createBarbell(): BarbellProp {
  const disposer = new Disposer();
  const group = new THREE.Group();
  group.name = "prop-barbell";
  const half = BARBELL.length / 2;
  const g = BARBELL.gripHalfWidth;

  // ------------------------------------------------------------ materials
  const knurlTex = disposer.track(canvasTexture(knurlCanvas(), { srgb: false, repeat: true, anisotropy: 8 }));
  const knurlMat = disposer.track(new THREE.MeshStandardMaterial({ color: 0xc2c6c9, metalness: 1, roughness: 0.36, bumpMap: knurlTex, bumpScale: 1.4 }));
  const smoothMat = disposer.track(new THREE.MeshStandardMaterial({ color: 0xcfd2d5, metalness: 1, roughness: 0.22 }));
  const chromeMat = disposer.track(new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 1, roughness: 0.12 }));
  const coralArt = plateArtwork(512, PLATE_FACES.coral);
  const graphiteArt = plateArtwork(512, PLATE_FACES.graphite);
  const coralMat = disposer.track(
    new THREE.MeshStandardMaterial({
      map: disposer.track(canvasTexture(coralArt.colour, { anisotropy: 8 })),
      bumpMap: disposer.track(canvasTexture(coralArt.height, { srgb: false, anisotropy: 8 })),
      bumpScale: 2.2,
      roughness: 0.62,
      metalness: 0,
    }),
  );
  const graphiteMat = disposer.track(
    new THREE.MeshStandardMaterial({
      map: disposer.track(canvasTexture(graphiteArt.colour, { anisotropy: 8 })),
      bumpMap: disposer.track(canvasTexture(graphiteArt.height, { srgb: false, anisotropy: 8 })),
      bumpScale: 2.2,
      roughness: 0.6,
      metalness: 0,
    }),
  );
  const hubMat = disposer.track(new THREE.MeshStandardMaterial({ color: 0xc9ccce, metalness: 1, roughness: 0.22 }));
  const collarMat = disposer.track(new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.3, roughness: 0.45 }));

  // ------------------------------------------------------------ shaft (deformable)
  const knurl = new GeometryBatch();
  const smooth = new GeometryBatch();
  const r = BARBELL.shaftRadius;
  const inner = BARBELL.sleeveStart - 0.01;
  const marks = [0.405, 0.41, 0.455, 0.46];
  for (const sx of [-1, 1]) {
    const piece = (a: number, b: number, knurled: boolean) => {
      const geo = shaftPiece(Math.min(a * sx, b * sx), Math.max(a * sx, b * sx), r);
      (knurled ? knurl : smooth).take(geo);
    };
    piece(0, 0.085, true);
    piece(0.085, 0.21, false);
    piece(0.21, marks[0], true);
    piece(marks[0], marks[1], false);
    piece(marks[1], marks[2], true);
    piece(marks[2], marks[3], false);
    piece(marks[3], inner - 0.01, true);
    piece(inner - 0.01, inner, false);
  }
  const knurlGeo = knurl.build();
  const smoothGeo = smooth.build();
  const knurlMesh = new THREE.Mesh(knurlGeo, knurlMat);
  const smoothMesh = new THREE.Mesh(smoothGeo, smoothMat);
  knurlMesh.name = "bar-knurl";
  group.add(knurlMesh, smoothMesh);
  const restKnurl = Float32Array.from(knurlGeo.attributes.position.array as Float32Array);
  const restSmooth = Float32Array.from(smoothGeo.attributes.position.array as Float32Array);
  const restKnurlN = Float32Array.from(knurlGeo.attributes.normal.array as Float32Array);
  const restSmoothN = Float32Array.from(smoothGeo.attributes.normal.array as Float32Array);

  // ------------------------------------------------------------ sleeves, plates, collars
  const plates: { left: BarbellPlate[]; right: BarbellPlate[] } = { left: [], right: [] };
  const pivots: THREE.Group[] = [];
  const spins: THREE.Group[] = [];
  const collars: THREE.Object3D[] = [];
  const levers: THREE.Object3D[] = [];
  const pivotX = BARBELL.sleeveStart;
  const sleeveGeo = (() => {
    const b = new GeometryBatch();
    const len = half - pivotX;
    // Inner collar flange, sleeve tube with a groove, coral end cap.
    b.add(lathe([[0.014, -0.012], [0.036, -0.012], [0.038, -0.009], [0.038, -0.002], [0.026, 0], [0.014, 0]], 40, "x"), undefined, 0xd4d6d8);
    const sleeve = lathe([[0.0245, 0], [0.025, 0.002], [0.025, len - 0.03], [0.0238, len - 0.028], [0.0238, len - 0.024], [0.025, len - 0.022], [0.025, len - 0.004], [0.0242, len]], 48, "x");
    b.take(sleeve, undefined, 0xdcdee0);
    b.add(lathe([[0.0215, len - 0.002], [0.0215, len], [0.016, len + 0.0012], [0, len + 0.0015]], 40, "x"), undefined, CORAL);
    return b.build();
  })();
  disposer.track(sleeveGeo);
  const bodyCache = new Map<string, THREE.BufferGeometry>();
  const hubCache = new Map<number, THREE.BufferGeometry>();
  const collarGeo = (() => {
    const b = new GeometryBatch();
    b.add(lathe([[0.0252, -0.022], [0.042, -0.022], [0.044, -0.019], [0.044, 0.019], [0.042, 0.022], [0.0252, 0.022], [0.0252, -0.022]], 40, "x"), undefined, 0x2a2d30);
    b.add(box(0.03, 0.018, 0.024, 0.004, 1), m4([0, 0.048, 0]), 0x2a2d30);
    return b.build();
  })();
  const leverGeo = (() => {
    const b = new GeometryBatch();
    b.add(box(0.012, 0.012, 0.075, 0.005, 2), m4([0, 0, 0.034]), CORAL);
    return b.build();
  })();
  disposer.track(collarGeo);
  disposer.track(leverGeo);

  for (const side of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.name = side > 0 ? "sleeve-left" : "sleeve-right";
    pivot.position.x = pivotX * side;
    const spin = new THREE.Group();
    pivot.add(spin);
    group.add(pivot);
    pivots.push(pivot);
    spins.push(spin);
    const sleeve = new THREE.Mesh(sleeveGeo, chromeMat);
    sleeve.scale.x = side;
    spin.add(sleeve);
    let x = 0.002;
    for (const spec of BARBELL.plates) {
      const key = `${spec.diameter}:${spec.thickness}`;
      let body = bodyCache.get(key);
      if (!body) {
        body = plateBody(spec.diameter, spec.thickness);
        bodyCache.set(key, body);
        disposer.track(body);
      }
      let hub = hubCache.get(spec.thickness);
      if (!hub) {
        hub = plateHub(spec.thickness);
        hubCache.set(spec.thickness, hub);
        disposer.track(hub);
      }
      const plate = new THREE.Group();
      plate.name = `plate-${spec.color}`;
      const restX = (x + spec.thickness / 2) * side;
      plate.position.x = restX;
      const bodyMesh = new THREE.Mesh(body, spec.color === "coral" ? coralMat : graphiteMat);
      bodyMesh.name = PLATE_BODY;
      const hubMesh = new THREE.Mesh(hub, hubMat);
      plate.add(bodyMesh, hubMesh);
      spin.add(plate);
      (side > 0 ? plates.left : plates.right).push({ object: plate, restX, kind: spec.color === "coral" ? "coral" : "graphite" });
      x += spec.thickness + 0.0015;
    }
    const collar = new THREE.Group();
    collar.name = "collar";
    const collarX = (x + 0.024) * side;
    collar.position.x = collarX;
    collar.userData.restX = collarX;
    const collarMesh = new THREE.Mesh(collarGeo, collarMat);
    const lever = new THREE.Group();
    lever.position.set(0, 0.052, 0);
    lever.add(new THREE.Mesh(leverGeo, collarMat));
    collar.add(collarMesh, lever);
    spin.add(collar);
    collars.push(collar);
    levers.push(lever);
  }
  for (const geo of [knurlGeo, smoothGeo]) disposer.track(geo);

  // ------------------------------------------------------------ deformation
  const span = half - g;
  const deflect = (u: number, bend: number) => (u <= g ? 0 : -bend * PEAK_DIP * ((u - g) / span) ** 2);
  const slopeAt = (u: number, bend: number) => (u <= g ? 0 : (-2 * bend * PEAK_DIP * (u - g)) / (span * span));
  const deform = (geo: THREE.BufferGeometry, rest: Float32Array, restN: Float32Array, bend: number) => {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const nor = geo.attributes.normal as THREE.BufferAttribute;
    const p = pos.array as Float32Array;
    const n = nor.array as Float32Array;
    for (let i = 0; i < p.length; i += 3) {
      const x = rest[i];
      const u = Math.abs(x);
      p[i] = x;
      p[i + 1] = rest[i + 1] + deflect(u, bend);
      p[i + 2] = rest[i + 2];
      // Rotate the normal by the local slope (small-angle tilt in XY).
      const s = slopeAt(u, bend) * Math.sign(x);
      const nx = restN[i];
      const ny = restN[i + 1];
      n[i] = nx - ny * s;
      n[i + 1] = ny + nx * s;
      n[i + 2] = restN[i + 2];
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
  };
  let bendAmount = Number.NaN;
  // Negative bends whip the centre below the sleeves (the plates landing after a drop).
  const setBend = (amount: number) => {
    const bend = Math.max(-1, Math.min(1, amount));
    if (bend === bendAmount) return;
    bendAmount = bend;
    deform(knurlGeo, restKnurl, restKnurlN, bend);
    deform(smoothGeo, restSmooth, restSmoothN, bend);
    pivots.forEach((pivot, i) => {
      const side = i === 0 ? 1 : -1;
      pivot.position.y = deflect(pivotX, bend);
      pivot.rotation.z = Math.atan(slopeAt(pivotX, bend)) * side;
    });
  };
  const setCollarClamp = (amount: number) => {
    const a = clamp01(amount);
    levers.forEach((lever, i) => {
      const side = i === 0 ? 1 : -1;
      lever.rotation.y = (1 - a) * 0.9 * side;
    });
  };
  setBend(0);
  setCollarClamp(1);

  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });

  return {
    group,
    setBend,
    setSleeveSpin: (rad: number) => {
      spins.forEach((spin) => {
        spin.rotation.x = rad;
      });
    },
    plates,
    collars: [collars[0], collars[1]],
    setCollarClamp,
    dispose: () => {
      group.removeFromParent();
      disposer.dispose();
    },
  };
}
