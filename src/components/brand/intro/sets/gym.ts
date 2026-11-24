/**
 * Gym set: a brick-and-concrete warehouse gym. Three tall factory windows in the back wall (-Z)
 * pour volumetric light shafts across a wooden lifting platform; dust motes drift through the
 * beams. Night: cool moonlit shafts, tungsten lamps.
 *
 * Set space: origin on the floor under the platform centre; the lifter faces +Z (towards the
 * camera side), the bar runs along X, windows are behind the lifter.
 *
 * Anchors: `platform` (platform surface centre, facing +Z) · `barRest` (bar centre with the plates
 * resting on the rubber, over mid-foot assuming the lifter's root at `platform`) · `plateLoad` (outer
 * end of the +X sleeve, facing +X: plates slide on along -X) · `window` (centre of the middle window;
 * +Z axis = light travel direction, also in `userData.direction`) · `chalk` (top of the chalk bowl).
 */

import * as THREE from "three";
import { BARBELL, PLATFORM } from "../dimensions";
import type { Theme } from "../types";
import {
  ROOM,
  WINDOWS,
  buildBench,
  buildCeiling,
  buildChalkStand,
  buildDumbbells,
  buildKettlebells,
  buildLamps,
  buildPlateTree,
  buildPlatform,
  buildPlyo,
  buildRack,
  buildRope,
  buildShell,
  buildWindowFrames,
  type GymBatches,
} from "./gymParts";
import { GYM_PRACTICALS, GYM_VARIANTS, KEY_DIRS, gymPreset } from "./presets";
import { GYM_COLORS as C, GYM_THEME } from "./palettes";
import type { IntroSet, SetOptions } from "./types";
import { bakeSurface, getBaker, setTile } from "./util/bake";
import { Disposer, Stopwatch, canvas2d, canvasTexture } from "./util/canvas";
import { EnvBaker, envBasic } from "./util/env";
import { GeometryBatch, boxProjectUV, groundQuad } from "./util/geometry";
import { createEmitter, setEmitter, vcStandard } from "./util/materials";
import { createDust, createShafts } from "./util/volumetrics";
import { createRng } from "../math";

/** Window glass: per-pane brightness (frosted, dirty, one open pane) on a canvas. */
function paneTexture(cols: number, rows: number, seed: number) {
  const { canvas, ctx } = canvas2d(cols * 64, rows * 64);
  const rng = createRng(seed);
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const open = rng() > 0.93;
      const v = open ? 255 : Math.round(150 + rng() * 80);
      const g = ctx.createLinearGradient(0, j * 64, 0, j * 64 + 64);
      g.addColorStop(0, `rgb(${v},${v},${v})`);
      g.addColorStop(1, `rgb(${Math.round(v * 0.86)},${Math.round(v * 0.86)},${Math.round(v * 0.86)})`);
      ctx.fillStyle = g;
      ctx.fillRect(i * 64, j * 64, 64, 64);
    }
  }
  // Grime at the bottom of the window.
  const grime = ctx.createLinearGradient(0, canvas.height, 0, canvas.height * 0.6);
  grime.addColorStop(0, "rgba(60,50,40,0.45)");
  grime.addColorStop(1, "rgba(60,50,40,0)");
  ctx.fillStyle = grime;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Shows or hides the hanging lamps' visible bulbs (the `lamp-bulbs` emitter, and with it their bloom). Only the bulbs:
 * the practical lights, the shades and the lamps' place in the environment bake stay as they are. On by default, as
 * the intro shows them; the welcome film turns them off in its shots, and `hideStage` turns them back on before
 * every shot.
 */
export function setGymLampBulbs(set: IntroSet, visible: boolean) {
  const bulbs = set.group.userData.lampBulbs as THREE.Object3D | undefined;
  if (bulbs) bulbs.visible = visible;
}

export function createGymSet(renderer: THREE.WebGLRenderer, theme: Theme, options: SetOptions = {}): IntroSet {
  void options;
  const clock = new Stopwatch();
  const disposer = new Disposer();
  const group = new THREE.Group();
  group.name = "set-gym";
  const baker = getBaker(renderer);
  const aniso = Math.min(8, baker.maxAnisotropy);
  const lightDir = new THREE.Vector3(...KEY_DIRS.gymLight).negate().normalize();

  // ------------------------------------------------------------ textures
  const noise = baker.bake("noise", "data", { size: 256, a: [4, 0, 0, 0], seed: 23 }, disposer);
  const brick = bakeSurface(renderer, disposer, "brick", {
    size: 1024,
    tileMeters: 0.9,
    reliefMeters: 0.012,
    a: [4, 8, 0.045, 0.13],
    b: [0.28, 0, 0, 0],
    colors: [C.brickA, C.brickB, C.brickBurnt, C.mortar],
    seed: 41,
    anisotropy: aniso,
  });
  setTile([brick.map, brick.normalMap, brick.orm], [0.9, 0.6]);
  const floorTex = bakeSurface(renderer, disposer, "concrete", {
    size: 1024,
    tileMeters: 3,
    reliefMeters: 0.0008,
    a: [3, 0.55, 0.2, 0.5],
    colors: [C.concrete, C.concreteDark, C.concreteLight],
    seed: 43,
    anisotropy: aniso,
  });
  setTile([floorTex.map, floorTex.normalMap, floorTex.orm], 3);
  const rubberTex = bakeSurface(renderer, disposer, "rubberTile", {
    size: 1024,
    tileMeters: 1,
    reliefMeters: 0.003,
    a: [260, 0.12, 0.004, 0],
    colors: [C.rubber, C.fleckGrey, C.fleckBlue, C.fleckCoral],
    seed: 47,
    anisotropy: aniso,
  });
  setTile([rubberTex.map, rubberTex.normalMap, rubberTex.orm], 1);
  const ply = bakeSurface(renderer, disposer, "wood", {
    size: 1024,
    tileMeters: 1.2,
    reliefMeters: 0.0006,
    a: [16, 0, 0.6, 60],
    colors: [C.plywood, C.plywoodDark, C.plywoodWarm],
    seed: 53,
    anisotropy: aniso,
  });
  setTile([ply.map, ply.normalMap, ply.orm], 1.2);
  const blockTex = bakeSurface(renderer, disposer, "plaster", {
    size: 512,
    tileMeters: 2,
    reliefMeters: 0.002,
    a: [5, 90, 0, 0],
    colors: [0xffffff, 0xe6e2da],
    seed: 59,
  });
  setTile([blockTex.map, blockTex.normalMap], 2);

  // ------------------------------------------------------------ batches
  const b: GymBatches = {
    brick: new GeometryBatch(),
    block: new GeometryBatch(),
    steel: new GeometryBatch(),
    black: new GeometryBatch(),
    chrome: new GeometryBatch(),
    rubber: new GeometryBatch(),
    wood: new GeometryBatch(),
    iron: new GeometryBatch(),
  };
  buildShell(b);
  buildCeiling(b);
  buildWindowFrames(b);
  // Against the left wall: further back it stood as a hard black "T" beside Dre in the chalk MCU.
  buildRack(b, [-6.2, 0, -0.9]);
  buildPlateTree(b, [-2.6, 0, -4.4], 61);
  buildDumbbells(b, [6.95, 0, 0.6]);
  buildKettlebells(b, [3.3, 0, -4.2], 6);
  buildBench(b, [-4.2, 0, 2.6]);
  buildPlyo(b, [4.6, 0, 5.4]);
  buildRope(b, [4.4, 0, -1.6]);
  const chalkBatch = new GeometryBatch();
  const chalkTop = buildChalkStand(b, chalkBatch, [1.85, 0, -0.95], 67);
  const bulbBatch = new GeometryBatch();
  const lampSpots: Array<[number, number, number]> = [
    [GYM_PRACTICALS[0][0], GYM_PRACTICALS[0][1] - 0.08, GYM_PRACTICALS[0][2]],
    [GYM_PRACTICALS[1][0], GYM_PRACTICALS[1][1] - 0.08, GYM_PRACTICALS[1][2]],
    [-5.0, 3.54, 2.6],
    [4.6, 3.54, 2.8],
    [-5.2, 3.54, -1.4],
    [5.0, 3.54, -2.6],
  ];
  buildLamps(b, bulbBatch, lampSpots);
  const woodTop = new GeometryBatch();
  const rubberTop = new GeometryBatch();
  buildPlatform(woodTop, rubberTop, b.steel);

  const mesh = (geo: THREE.BufferGeometry, material: THREE.Material, name: string, cast = true) => {
    const m = new THREE.Mesh(geo, material);
    m.name = name;
    m.castShadow = cast;
    m.receiveShadow = true;
    group.add(m);
    disposer.track(geo);
    disposer.track(material);
    return m;
  };
  const brickGeo = b.brick.build();
  boxProjectUV(brickGeo, 1);
  mesh(brickGeo, new THREE.MeshStandardMaterial({ map: brick.map, normalMap: brick.normalMap, roughnessMap: brick.orm, aoMap: brick.orm, aoMapIntensity: 0.7, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(1.2, 1.2) }), "brick");
  const blockGeo = b.block.build();
  boxProjectUV(blockGeo, 1);
  mesh(blockGeo, vcStandard({ map: blockTex.map, normalMap: blockTex.normalMap, roughness: 0.88, metalness: 0 }), "block-walls");
  mesh(b.steel.build(), vcStandard({ roughness: 0.55, metalness: 0.55 }), "steel");
  mesh(b.black.build(), vcStandard({ roughness: 0.5, metalness: 0.35 }), "black-steel");
  mesh(b.chrome.build(), vcStandard({ roughness: 0.18, metalness: 1 }), "chrome");
  mesh(b.rubber.build(), vcStandard({ roughness: 0.66, metalness: 0 }), "rubber");
  const woodGeo = b.wood.build();
  boxProjectUV(woodGeo, 1);
  mesh(woodGeo, vcStandard({ map: ply.map, roughness: 0.62, metalness: 0 }), "wood");
  mesh(b.iron.build(), vcStandard({ roughness: 0.55, metalness: 0.45 }), "iron");
  mesh(chalkBatch.build(), vcStandard({ roughness: 0.95, metalness: 0 }), "chalk");
  const platformWood = woodTop.build();
  boxProjectUV(platformWood, 1);
  mesh(platformWood, new THREE.MeshStandardMaterial({ map: ply.map, normalMap: ply.normalMap, roughnessMap: ply.orm, roughness: 1, metalness: 0 }), "platform-wood");
  const platformRubberGeo = rubberTop.build();
  boxProjectUV(platformRubberGeo, 1);
  mesh(platformRubberGeo, new THREE.MeshStandardMaterial({ map: rubberTex.map, normalMap: rubberTex.normalMap, roughnessMap: rubberTex.orm, roughness: 1, metalness: 0 }), "platform-rubber");

  // Floors: polished concrete everywhere, rubber tiles in the training zone (raised 12 mm).
  mesh(
    groundQuad(ROOM.x0, ROOM.x1, ROOM.z0, ROOM.z1),
    new THREE.MeshStandardMaterial({ map: floorTex.map, normalMap: floorTex.normalMap, roughnessMap: floorTex.orm, roughness: 1, metalness: 0 }),
    "floor",
    false,
  );
  const tiles = new GeometryBatch().take(groundQuad(-6.5, 6.5, -4.8, 4.2, 0.012)).take(groundQuad(-6.5, 6.5, 4.2, 4.21, 0.012));
  mesh(tiles.build(), new THREE.MeshStandardMaterial({ map: rubberTex.map, normalMap: rubberTex.normalMap, roughnessMap: rubberTex.orm, roughness: 1, metalness: 0 }), "rubber-tiles", false);

  // Window glass (emissive, per-pane variation) — never casts shadows so the sun passes.
  const paneMat = disposer.track(createEmitter(0xffffff, 1, { map: disposer.track(canvasTexture(paneTexture(4, 6, 71))) }));
  const paneBatch = new GeometryBatch();
  for (const w of WINDOWS) paneBatch.take(new THREE.PlaneGeometry(w.x1 - w.x0, w.y1 - w.y0).translate((w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2, ROOM.z0 - ROOM.wall / 2));
  const panes = new THREE.Mesh(paneBatch.build(), paneMat);
  panes.name = "window-glass";
  group.add(panes);
  disposer.track(panes.geometry);

  const bulbMat = disposer.track(createEmitter(0xffd6a0, 2));
  const bulbs = new THREE.Mesh(bulbBatch.build(), bulbMat);
  bulbs.name = "lamp-bulbs";
  group.add(bulbs);
  group.userData.lampBulbs = bulbs;
  disposer.track(bulbs.geometry);

  // Volumetrics.
  const shafts = createShafts(WINDOWS, ROOM.z0, 0.012, lightDir, noise);
  disposer.track(shafts.mesh.geometry);
  disposer.track(shafts.material);
  group.add(shafts.mesh);
  const dust = createDust(83, 2600, new THREE.Vector3(-6.2, 0.15, -5.2), new THREE.Vector3(4.8, 5.2, 3.6), WINDOWS, ROOM.z0, lightDir);
  disposer.track(dust.points.geometry);
  disposer.track(dust.material);
  group.add(dust.points);

  // ------------------------------------------------------------ env
  const envScene = new THREE.Scene();
  const envWallMat = disposer.track(envBasic(0xffffff, 1, THREE.BackSide));
  envScene.add(new THREE.Mesh(disposer.track(new THREE.BoxGeometry(ROOM.x1 - ROOM.x0, ROOM.height, ROOM.z1 - ROOM.z0).translate(0, ROOM.height / 2, (ROOM.z0 + ROOM.z1) / 2)), envWallMat));
  const envWinMat = disposer.track(envBasic(0xffffff, 1, THREE.DoubleSide));
  for (const w of WINDOWS) {
    const q = new THREE.Mesh(disposer.track(new THREE.PlaneGeometry(w.x1 - w.x0, w.y1 - w.y0)), envWinMat);
    q.position.set((w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2, ROOM.z0 + 0.05);
    envScene.add(q);
  }
  const envLampMat = disposer.track(envBasic(0xffffff, 1));
  for (const p of lampSpots) {
    const s = new THREE.Mesh(disposer.track(new THREE.SphereGeometry(0.12, 12, 8)), envLampMat);
    s.position.set(p[0], p[1] + 0.08, p[2]);
    envScene.add(s);
  }
  const envBaker = disposer.track(new EnvBaker(renderer));

  // ------------------------------------------------------------ anchors
  const anchors: Record<string, THREE.Object3D> = {};
  const anchor = (name: string, position: THREE.Vector3, facing = new THREE.Vector3(0, 0, 1)) => {
    const o = new THREE.Object3D();
    o.name = `anchor:${name}`;
    o.position.copy(position);
    o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), facing.clone().normalize());
    group.add(o);
    anchors[name] = o;
    return o;
  };
  const barY = PLATFORM.height + BARBELL.restHeight;
  anchor("platform", new THREE.Vector3(0, PLATFORM.height, 0));
  anchor("barRest", new THREE.Vector3(0, barY, 0.063));
  anchor("plateLoad", new THREE.Vector3(BARBELL.length / 2, barY, 0.063), new THREE.Vector3(1, 0, 0));
  const w = WINDOWS[1];
  const win = anchor("window", new THREE.Vector3((w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2, ROOM.z0), lightDir);
  win.userData.direction = lightDir.clone();
  anchor("chalk", chalkTop);

  let current: Theme = theme;
  const applyTheme = (next: Theme) => {
    current = next;
    const t = GYM_THEME[next];
    setEmitter(paneMat, t.window.color, t.window.intensity);
    setEmitter(bulbMat, t.lamp.color, t.lamp.intensity);
    (shafts.material.uniforms.uColor.value as THREE.Color).setHex(t.shaft.color);
    shafts.material.uniforms.uIntensity.value = t.shaft.intensity;
    (dust.material.uniforms.uColor.value as THREE.Color).setHex(t.dust.color);
    dust.material.uniforms.uIntensity.value = t.dust.intensity;
    // Moonlight comes in a little steeper; shafts keep the same geometry (same windows).
    envWallMat.color.setHex(t.envWall).multiplyScalar(next === "light" ? 0.55 : 0.4);
    envWinMat.color.setHex(t.window.color).multiplyScalar(t.window.intensity * 0.8);
    envLampMat.color.setHex(t.lamp.color).multiplyScalar(t.lamp.intensity * 0.6);
    envBaker.bake(envScene, new THREE.Vector3(0, 1.4, 0.5));
  };
  clock.lap("build");
  applyTheme(theme);
  clock.lap("theme+env-bake");
  const timings = clock.total();

  // Own every geometry/material built above (shared ones are de-duplicated by the disposer).
  disposer.trackObject(group);

  return {
    name: "gym",
    group,
    anchors,
    environment: envBaker.texture,
    variants: GYM_VARIANTS,
    timings,
    get theme() {
      return current;
    },
    lighting: (variant?: string) => gymPreset(current, variant ?? "base"),
    applyTheme,
    update: (time: number) => {
      shafts.material.uniforms.uTime.value = time;
      dust.material.uniforms.uTime.value = time;
    },
    dispose: () => {
      group.removeFromParent();
      disposer.dispose();
    },
  };
}
