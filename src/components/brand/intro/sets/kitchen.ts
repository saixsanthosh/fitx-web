/**
 * Kitchen set: a warm, modern dining nook. Oak table with two walnut chairs (to TABLE), two grain
 * bowls, a carafe, linen and cutlery; a big black-steel window behind the table (morning sun
 * pouring across the food; night: city lights outside, pendants on), open shelves with jars as
 * background bokeh, a counter run, and a large leafy plant for foreground bokeh in the side shot.
 *
 * Set space: origin on the floor under the table centre; diners sit at the ±X ends facing each
 * other; the window wall is at -Z, the side camera looks from +Z.
 *
 * Anchors: `seat0`/`seat1` (TABLE.seats; seat0 faces +X, seat1 faces -X) · `table` (top centre) ·
 * `bowl0`/`bowl1`, `glass0`/`glass1` (TABLE.places; glasses are props from `createSmoothie`).
 */

import * as THREE from "three";
import { TABLE } from "../dimensions";
import type { Theme } from "../types";
import { createFoodBatches, buildBowl } from "./food";
import {
  KROOM,
  KWINDOW,
  buildCentrepiece,
  buildCounter,
  buildFloorPlant,
  buildPendants,
  buildRoom,
  buildShelves,
  buildTableAndChairs,
  buildTableDressing,
  buildWindow,
  type KitchenBatches,
} from "./kitchenParts";
import { KEY_DIRS, KITCHEN_PENDANTS, KITCHEN_VARIANTS, kitchenPreset } from "./presets";
import { KITCHEN_COLORS as K, KITCHEN_THEME } from "./palettes";
import type { IntroSet, SetOptions } from "./types";
import { bakeSurface, getBaker, setTile } from "./util/bake";
import { Disposer, Stopwatch } from "./util/canvas";
import { applyDistant, applyTreeCards, buildSkyline, buildTreeCards, createDistantMaterial, createTreeCardMaterial } from "./util/distant";
import { EnvBaker, envBasic } from "./util/env";
import { GeometryBatch, boxProjectUV, groundQuad } from "./util/geometry";
import { createEmitter, createGlass, setEmitter, vcPhysical, vcStandard } from "./util/materials";
import { applySky, createSkyDome, createSkyMaterial } from "./util/sky";

const v3 = (t: readonly number[]) => new THREE.Vector3(t[0], t[1], t[2]);

/** Shows or hides the toast shot's near foreground plant (no depth of field → no plant). */
export function setKitchenForeground(set: IntroSet, visible: boolean) {
  const plant = set.group.userData.foreground as THREE.Object3D | undefined;
  if (plant) plant.visible = visible;
}

export function createKitchenSet(renderer: THREE.WebGLRenderer, theme: Theme, options: SetOptions = {}): IntroSet {
  void options;
  const clock = new Stopwatch();
  const disposer = new Disposer();
  const group = new THREE.Group();
  group.name = "set-kitchen";
  const baker = getBaker(renderer);
  const aniso = Math.min(8, baker.maxAnisotropy);

  // ------------------------------------------------------------ textures
  const noise = baker.bake("noise", "data", { size: 256, a: [4, 0, 0, 0], seed: 29 }, disposer);
  const oak = bakeSurface(renderer, disposer, "wood", { size: 1024, tileMeters: 1.4, reliefMeters: 0.0005, a: [150, 0, 0.9, 90], colors: [K.oakLight, K.oakDark, K.oakWarm], seed: 101, anisotropy: aniso });
  setTile([oak.map, oak.normalMap, oak.orm], 1.4);
  const floorWood = bakeSurface(renderer, disposer, "wood", { size: 1024, tileMeters: 1.2, reliefMeters: 0.0006, a: [140, 6, 0.8, 90], colors: [0xc6a27a, 0x9c754c, 0xb38c60], seed: 103, anisotropy: aniso });
  setTile([floorWood.map, floorWood.normalMap, floorWood.orm], 1.2);
  const plaster = bakeSurface(renderer, disposer, "plaster", { size: 512, tileMeters: 2.5, reliefMeters: 0.0015, a: [5, 110, 0, 0], colors: [K.plaster, K.plasterShade], seed: 107 });
  setTile([plaster.map, plaster.normalMap], 2.5);
  const speckle = bakeSurface(renderer, disposer, "speckle", { size: 512, tileMeters: 1, reliefMeters: 0.0004, a: [90, 0.18, 0.6, 0.3], colors: [0xffffff, 0x5a4c40, 0xe8e0d2], seed: 109 });
  const quinoa = bakeSurface(renderer, disposer, "quinoa", { size: 512, tileMeters: 0.12, reliefMeters: 0.0018, a: [64, 0.22, 0.14, 0], colors: [K.quinoaCream, K.quinoaRed, K.quinoaBlack], seed: 113, anisotropy: aniso });
  const salmon = bakeSurface(renderer, disposer, "salmon", { size: 512, tileMeters: 0.06, reliefMeters: 0.0005, a: [5, 0.25, 0.08, 0], colors: [K.salmonA, K.salmonB, K.salmonFat], seed: 127 });
  const greens = bakeSurface(renderer, disposer, "leaf", { size: 512, tileMeters: 0.06, reliefMeters: 0.0006, a: [7, 0.03, 0, 0], colors: [K.greenDark, K.greenLight, K.greenVein], seed: 131 });
  const tomatoCut = baker.bake("tomatoCut", "albedo", { size: 256, colors: [K.tomato, K.tomatoGel, K.tomatoSeed], repeat: false, seed: 137 }, disposer);

  // ------------------------------------------------------------ geometry
  const b: KitchenBatches = {
    plaster: new GeometryBatch(),
    wood: new GeometryBatch(),
    walnut: new GeometryBatch(),
    white: new GeometryBatch(),
    metal: new GeometryBatch(),
    linen: new GeometryBatch(),
    glass: new GeometryBatch(),
    contents: new GeometryBatch(),
    ceramic: new GeometryBatch(),
    leaves: new GeometryBatch(),
    pots: new GeometryBatch(),
  };
  buildRoom(b);
  buildWindow(b);
  buildTableAndChairs(b);
  buildTableDressing(b, 211);
  buildCentrepiece(b, 213);
  buildShelves(b, 223);
  buildCounter(b);
  const bulbBatch = new GeometryBatch();
  buildPendants(b, bulbBatch, KITCHEN_PENDANTS.map(([x, y, z]) => [x, y, z] as [number, number, number]));
  buildFloorPlant(b, [-1.6, 0, 1.95], 227, 1.15);
  buildFloorPlant(b, [2.25, 0, 2.6], 229, 0.9);
  // Low plant ~1.4 m in front of the toast lens, in its lower-right corner: soft foreground leaves
  // that drift out of frame as the lens arcs. Its own meshes, so the shot can drop it where there
  // is no depth of field (`setKitchenForeground`).
  const near: KitchenBatches = { ...b, pots: new GeometryBatch(), leaves: new GeometryBatch() };
  buildFloorPlant(near, [0.14, 0, 1.66], 231, 0.55);

  const food = createFoodBatches();
  TABLE.places.forEach((p, i) => buildBowl(food, p.bowl, i === 0 ? 0.4 : Math.PI + 0.4, 300 + i * 17, i === 0 ? 0xf3ede2 : 0xe8dfcf));

  const mesh = (geo: THREE.BufferGeometry, material: THREE.Material, name: string, cast = true, receive = true) => {
    const m = new THREE.Mesh(geo, material);
    m.name = name;
    m.castShadow = cast;
    m.receiveShadow = receive;
    group.add(m);
    disposer.track(geo);
    disposer.track(material);
    return m;
  };
  const plasterGeo = b.plaster.build();
  boxProjectUV(plasterGeo, 1);
  mesh(plasterGeo, new THREE.MeshStandardMaterial({ map: plaster.map, normalMap: plaster.normalMap, roughness: 0.92, metalness: 0 }), "walls");
  const woodGeo = b.wood.build();
  boxProjectUV(woodGeo, 1);
  mesh(woodGeo, new THREE.MeshPhysicalMaterial({ map: oak.map, normalMap: oak.normalMap, roughnessMap: oak.orm, roughness: 0.85, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.35 }), "oak");
  const walnutGeo = b.walnut.build();
  boxProjectUV(walnutGeo, 1.6);
  mesh(walnutGeo, new THREE.MeshStandardMaterial({ map: oak.map, color: 0x7a5236, roughness: 0.5, metalness: 0 }), "walnut");
  mesh(b.white.build(), vcStandard({ roughness: 0.6, metalness: 0 }), "painted");
  mesh(b.metal.build(), vcStandard({ roughness: 0.3, metalness: 0.85 }), "metal");
  mesh(b.linen.build(), vcStandard({ roughness: 0.95, metalness: 0, side: THREE.DoubleSide }), "linen");
  const glassGeo = b.glass.build();
  const glassMesh = mesh(glassGeo, createGlass({ edgeOpacity: 0.45, opacity: 0.08 }), "glassware", false, false);
  glassMesh.renderOrder = 3;
  mesh(b.contents.build(), vcPhysical({ roughness: 0.4, metalness: 0, clearcoat: 0.3 }), "jar-contents");
  const ceramicGeo = b.ceramic.build();
  mesh(ceramicGeo, vcPhysical({ roughness: 0.35, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.2 }), "ceramics");
  const leafMat = vcPhysical({ roughness: 0.45, metalness: 0, sheen: 0.4, sheenColor: new THREE.Color(0x9fd07a), side: THREE.DoubleSide });
  const potMat = vcStandard({ roughness: 0.7, metalness: 0 });
  mesh(b.leaves.build(), leafMat, "plants");
  mesh(b.pots.build(), potMat, "pots");
  const foreground = new THREE.Group();
  foreground.name = "foreground-plant";
  for (const part of [mesh(near.leaves.build(), leafMat, "foreground-leaves", false), mesh(near.pots.build(), potMat, "foreground-pot", false)]) foreground.add(part);
  group.add(foreground);
  group.userData.foreground = foreground;

  // Floor.
  mesh(groundQuad(KROOM.x0, KROOM.x1, KROOM.z0, KROOM.z1), new THREE.MeshPhysicalMaterial({ map: floorWood.map, normalMap: floorWood.normalMap, roughnessMap: floorWood.orm, roughness: 0.9, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.4 }), "floor", false);

  // Food.
  setTile([speckle.map, speckle.normalMap], 1);
  mesh(food.bowl.build(), new THREE.MeshPhysicalMaterial({ vertexColors: true, map: speckle.map, roughness: 0.4, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.18 }), "bowls");
  mesh(food.quinoa.build(), new THREE.MeshStandardMaterial({ map: quinoa.map, normalMap: quinoa.normalMap, roughnessMap: quinoa.orm, roughness: 1, metalness: 0 }), "quinoa");
  mesh(food.salmon.build(), new THREE.MeshPhysicalMaterial({ map: salmon.map, normalMap: salmon.normalMap, roughness: 0.32, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.18, sheen: 0.5, sheenColor: new THREE.Color(0xffb08a) }), "salmon");
  mesh(food.avocado.build(), vcPhysical({ roughness: 0.32, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.2 }), "avocado");
  mesh(food.greens.build(), new THREE.MeshPhysicalMaterial({ map: greens.map, normalMap: greens.normalMap, roughness: 0.42, metalness: 0, sheen: 0.5, sheenColor: new THREE.Color(0x9fd07a), side: THREE.DoubleSide }), "greens");
  mesh(food.tomato.build(), vcPhysical({ roughness: 0.18, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.12 }), "tomatoes");
  mesh(food.tomatoCut.build(), new THREE.MeshPhysicalMaterial({ map: tomatoCut, roughness: 0.25, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.12 }), "tomato-cut");
  mesh(food.bits.build(), vcPhysical({ roughness: 0.38, metalness: 0, clearcoat: 0.35 }), "toppings");
  mesh(food.sauce.build(), new THREE.MeshPhysicalMaterial({ color: K.sauce, roughness: 0.22, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.15 }), "sauce");

  // Pendant bulbs.
  const bulbMat = disposer.track(createEmitter(0xffd2a0, 1));
  const bulbs = new THREE.Mesh(bulbBatch.build(), bulbMat);
  bulbs.name = "pendant-bulbs";
  disposer.track(bulbs.geometry);
  group.add(bulbs);

  // Outside: sky, a near tree line and a distant city through the window.
  const skyMat = disposer.track(createSkyMaterial(noise));
  const sky = createSkyDome(skyMat);
  disposer.track(sky.geometry);
  group.add(sky);
  const treeTex = baker.bake("treeline", "data", { size: [1024, 256], a: [12, 0.35, 0.45, 0.06], seed: 233 }, disposer);
  const treeMat = disposer.track(createTreeCardMaterial(treeTex, 260));
  const trees = new THREE.Mesh(disposer.track(buildTreeCards([[-40, -26], [30, -30]], 14, 90, 0.2, -6)), treeMat);
  trees.renderOrder = -5;
  group.add(trees);
  const skyline = new THREE.Mesh(
    disposer.track(buildSkyline({ seed: 239, center: [0, 0], innerRadius: 160, outerRadius: 700, count: 220, clearDir: v3(KEY_DIRS.kitchenLight), clearDegrees: 8, maxHeight: 90 })),
    disposer.track(createDistantMaterial(420, 30)),
  );
  skyline.position.y = -4;
  group.add(skyline);

  // ------------------------------------------------------------ env
  const envScene = new THREE.Scene();
  const envRoomMat = disposer.track(envBasic(0xffffff, 1, THREE.BackSide));
  envScene.add(new THREE.Mesh(disposer.track(new THREE.BoxGeometry(KROOM.x1 - KROOM.x0, KROOM.height, KROOM.z1 - KROOM.z0).translate(0, KROOM.height / 2, (KROOM.z0 + KROOM.z1) / 2)), envRoomMat));
  const envWinMat = disposer.track(envBasic(0xffffff, 1, THREE.DoubleSide));
  const envWin = new THREE.Mesh(disposer.track(new THREE.PlaneGeometry(KWINDOW.x1 - KWINDOW.x0, KWINDOW.y1 - KWINDOW.y0)), envWinMat);
  envWin.position.set((KWINDOW.x0 + KWINDOW.x1) / 2, (KWINDOW.y0 + KWINDOW.y1) / 2, KROOM.z0 + 0.02);
  envScene.add(envWin);
  const envLampMat = disposer.track(envBasic(0xffffff, 1));
  for (const p of KITCHEN_PENDANTS) {
    const s = new THREE.Mesh(disposer.track(new THREE.SphereGeometry(0.08, 12, 8)), envLampMat);
    s.position.fromArray(p);
    envScene.add(s);
  }
  const envBaker = disposer.track(new EnvBaker(renderer));

  // ------------------------------------------------------------ anchors
  const anchors: Record<string, THREE.Object3D> = {};
  const anchor = (name: string, position: readonly number[], facing = new THREE.Vector3(0, 0, 1)) => {
    const o = new THREE.Object3D();
    o.name = `anchor:${name}`;
    o.position.set(position[0], position[1], position[2]);
    o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), facing);
    group.add(o);
    anchors[name] = o;
  };
  anchor("seat0", TABLE.seats[0], new THREE.Vector3(1, 0, 0));
  anchor("seat1", TABLE.seats[1], new THREE.Vector3(-1, 0, 0));
  anchor("table", [0, TABLE.height, 0]);
  TABLE.places.forEach((p, i) => {
    anchor(`bowl${i}`, p.bowl);
    anchor(`glass${i}`, p.glass);
  });

  let current: Theme = theme;
  const applyTheme = (next: Theme) => {
    current = next;
    const t = KITCHEN_THEME[next];
    const sunDir = v3(KEY_DIRS.kitchenLight);
    applySky(skyMat, { ...t.outside, sunDir, pollutionDir: new THREE.Vector3(0.3, 0, -1) });
    applyTreeCards(treeMat, next === "light" ? { dark: 0x2a3a22, light: 0x5d7a3c, rim: 0xffd29a, haze: 0xc9d2d8, rimAmount: 0.9 } : { dark: 0x050706, light: 0x0c100e, rim: 0, haze: 0x161c2c, rimAmount: 0 }, sunDir);
    applyDistant(
      skyline.material as THREE.ShaderMaterial,
      next === "light"
        ? { base: 0x8a95a6, lit: 0xf2c79a, haze: 0xdce0e6, hazeNear: 0xcfd6de, windows: 0, windowAmount: 0 }
        : { base: 0x0d111a, lit: 0x111622, haze: 0x1a2236, hazeNear: 0x151b2b, windows: 0xffc580, windowAmount: 1.2 },
      sunDir,
    );
    setEmitter(bulbMat, t.pendant.color, t.pendant.intensity);
    envRoomMat.color.setHex(t.envWarm).multiplyScalar(next === "light" ? 0.75 : 0.35);
    envWinMat.color.setHex(next === "light" ? 0xfff1df : 0x1a2236).multiplyScalar(next === "light" ? 4 : 0.6);
    envLampMat.color.setHex(t.pendant.color).multiplyScalar(next === "light" ? 0.5 : t.pendant.intensity * 0.5);
    envBaker.bake(envScene, new THREE.Vector3(0, 1.2, 0.6));
  };
  clock.lap("build");
  applyTheme(theme);
  clock.lap("theme+env-bake");
  const timings = clock.total();

  // Own every geometry/material built above (shared ones are de-duplicated by the disposer).
  disposer.trackObject(group);

  return {
    name: "kitchen",
    group,
    anchors,
    environment: envBaker.texture,
    variants: KITCHEN_VARIANTS,
    timings,
    get theme() {
      return current;
    },
    lighting: (variant?: string) => kitchenPreset(current, variant ?? "base"),
    applyTheme,
    update: (time: number) => {
      skyMat.uniforms.uTime.value = time;
      (skyline.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
    },
    dispose: () => {
      group.removeFromParent();
      disposer.dispose();
    },
  };
}
