/**
 * Track set: an athletics stadium at sunrise (light) or under floodlights (dark).
 *
 * Set space = `TRACK` in dimensions.ts: origin at the start line centre of lane 4, running +Z,
 * lanes numbered towards +X, the bike lane outside lane 8. The start line paint occupies
 * z ∈ [0, 0.05]; feet behind the line have z < 0. Lane numerals sit behind the line, readable
 * by a runner looking +Z.
 *
 * Anchors: `startLine` (0,0,0) facing +Z · `bikeLane` (TRACK.bikeLaneOffsetX, 0, 0) facing +Z —
 * the bike lane surface spans x ∈ [5.78, 7.98] · `sun` — the sun (light; 1 km away along the sun
 * direction) or the key floodlight head (dark); `userData.direction` is the unit vector towards it.
 */

import * as THREE from "three";
import { TRACK } from "../dimensions";
import type { Theme } from "../types";
import { KEY_DIRS, TRACK_KEY_MAST, TRACK_VARIANTS, trackPreset } from "./presets";
import { TRACK_COLORS as C, TRACK_THEME } from "./palettes";
import {
  LAYOUT,
  buildFarStructures,
  buildFence,
  buildInfieldProps,
  buildKerbs,
  buildMasts,
  buildRoofStrips,
  buildSeats,
  buildStandStructure,
} from "./trackParts";
import type { IntroSet, SetOptions } from "./types";
import { bakeSurface, getBaker, setTile } from "./util/bake";
import { Disposer, Stopwatch, numeralAtlas } from "./util/canvas";
import { applyDistant, applyTreeCards, buildSkyline, buildTreeCards, createDistantMaterial, createTreeCardMaterial } from "./util/distant";
import { EnvBaker, envBasic } from "./util/env";
import { GeometryBatch, boxProjectUV, groundQuad } from "./util/geometry";
import { createEmitter, createPaintedGround, createStripedGrass, setEmitter, vcStandard, type LineZ } from "./util/materials";
import { applySky, createSkyDome, createSkyMaterial } from "./util/sky";
import { coneGeometry, createConeMaterial } from "./util/volumetrics";

const v3 = (t: readonly number[]) => new THREE.Vector3(t[0], t[1], t[2]);

function laneLines(edgeX: number, sign: number, z0: number, z1: number, color: number): LineZ[] {
  return Array.from({ length: TRACK.lanes + 1 }, (_, i) => ({ x: edgeX + sign * i * TRACK.laneWidth, halfWidth: TRACK.lineWidth / 2, z0, z1, color }));
}

export function createTrackSet(renderer: THREE.WebGLRenderer, theme: Theme, options: SetOptions = {}): IntroSet {
  const quality = options.quality ?? "high";
  const clock = new Stopwatch();
  const disposer = new Disposer();
  const group = new THREE.Group();
  group.name = "set-track";
  const baker = getBaker(renderer);
  const aniso = Math.min(16, baker.maxAnisotropy);

  // ------------------------------------------------------------ textures
  const noise = baker.bake("noise", "data", { size: 256, a: [4, 0, 0, 0], seed: 11 }, disposer);
  const tartanTile = 0.32;
  const tartan = bakeSurface(renderer, disposer, "tartan", {
    // Only the granule normals need macro resolution (shot 0 is 10 cm off the line).
    size: 1024,
    normalSize: quality === "high" ? 2048 : 1024,
    tileMeters: tartanTile,
    reliefMeters: 0.0008,
    a: [158, 331, 0.035, 0.8],
    colors: [C.granule, C.granuleDark, C.binder],
    seed: 3,
    anisotropy: aniso,
  });
  setTile([tartan.map, tartan.normalMap, tartan.orm], tartanTile);
  const asphaltTile = 0.6;
  const asphalt = bakeSurface(renderer, disposer, "asphalt", {
    size: 1024,
    tileMeters: asphaltTile,
    reliefMeters: 0.0022,
    a: [64, 0.55, 150, 0],
    colors: [C.bitumen, C.stoneA, C.stoneB],
    seed: 5,
    anisotropy: aniso,
  });
  setTile([asphalt.map, asphalt.normalMap, asphalt.orm], asphaltTile);
  const grassTile = 1.6;
  const grass = bakeSurface(renderer, disposer, "grass", {
    size: 1024,
    tileMeters: grassTile,
    reliefMeters: 0.006,
    a: [190, 22, 9, 0.18],
    colors: [C.grassDark, C.grassLight, C.grassDry],
    seed: 9,
    anisotropy: aniso,
  });
  setTile([grass.map, grass.normalMap, grass.orm], grassTile);
  const concreteTile = 2.4;
  const concrete = bakeSurface(renderer, disposer, "concrete", {
    size: 512,
    tileMeters: concreteTile,
    reliefMeters: 0.0012,
    a: [3, 0.0, 0.25, 0.6],
    colors: [C.concrete, C.concreteDark, 0xcfc9bd],
    seed: 13,
    anisotropy: aniso,
  });
  setTile([concrete.map, concrete.normalMap, concrete.orm], concreteTile);
  const numerals = disposer.track(numeralAtlas(TRACK.lanes));
  clock.lap("textures");

  // ------------------------------------------------------------ ground surfaces
  const z0 = LAYOUT.z0;
  const z1 = LAYOUT.z1;
  const trackLines = laneLines(LAYOUT.laneEdgeX, 1, z0, z1, C.paint);
  const track = createPaintedGround(
    { map: tartan.map, normalMap: tartan.normalMap, roughnessMap: tartan.orm, aoMap: tartan.orm, aoMapIntensity: 0.6, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(1, 1) },
    {
      linesZ: trackLines,
      linesX: [
        { z: 0.025, halfWidth: 0.025, x0: LAYOUT.laneEdgeX - 0.025, x1: LAYOUT.laneEdgeX + 8 * TRACK.laneWidth + 0.025, color: C.paint },
        { z: -9.975, halfWidth: 0.025, x0: LAYOUT.laneEdgeX - 0.025, x1: LAYOUT.laneEdgeX + 8 * TRACK.laneWidth + 0.025, color: C.paint },
        { z: 100.025, halfWidth: 0.025, x0: LAYOUT.laneEdgeX - 0.025, x1: LAYOUT.laneEdgeX + 8 * TRACK.laneWidth + 0.025, color: C.paint },
      ],
      marks: [
        { z0: 13, spacing: 8.5, count: 10, size: 0.05, color: C.hurdleYellow },
        { z0: 3.72, spacing: 9.14, count: 10, size: 0.05, color: C.hurdleBlue },
      ],
      numerals: { texture: numerals, edgeX: LAYOUT.laneEdgeX, laneWidth: TRACK.laneWidth, lanes: TRACK.lanes, z0: -1.32, z1: -0.42, halfWidth: 0.3, color: C.paint },
      macro: noise,
      macroParams: [0.15, 0.043, 0.2, 0.07],
      paintRoughness: 0.6,
      paintRelief: 0.6,
      edgeNoise: 0.0018,
    },
  );
  disposer.track(track.material);
  const trackMesh = new THREE.Mesh(groundQuad(LAYOUT.tartan.x0, LAYOUT.tartan.x1, z0, z1), track.material);
  trackMesh.name = "track-surface";
  trackMesh.receiveShadow = true;
  group.add(trackMesh);

  const far = createPaintedGround(
    { map: tartan.map, normalMap: tartan.normalMap, roughnessMap: tartan.orm, aoMap: tartan.orm, aoMapIntensity: 0.6, roughness: 1, metalness: 0 },
    { linesZ: laneLines(LAYOUT.farStraight.x0 + 0.13, 1, z0, z1, C.paint), linesX: [], macro: noise, macroParams: [0.15, 0.043, 0.2, 0.07], paintRoughness: 0.6, paintRelief: 0.6, edgeNoise: 0.0018 },
  );
  disposer.track(far.material);
  const farMesh = new THREE.Mesh(groundQuad(LAYOUT.farStraight.x0, LAYOUT.farStraight.x1, z0, z1), far.material);
  farMesh.receiveShadow = true;
  group.add(farMesh);

  const bike = createPaintedGround(
    { map: asphalt.map, normalMap: asphalt.normalMap, roughnessMap: asphalt.orm, aoMap: asphalt.orm, aoMapIntensity: 0.5, roughness: 1, metalness: 0 },
    {
      linesZ: [
        { x: LAYOUT.bikeLane.x0 + 0.1, halfWidth: 0.04, z0, z1, color: C.bikeLine },
        { x: LAYOUT.bikeLane.x1 - 0.12, halfWidth: 0.05, z0, z1, color: C.bikeEdge },
      ],
      linesX: [],
      macro: noise,
      macroParams: [0.12, 0.031, 0.16, 0.06],
      paintRoughness: 0.55,
      paintRelief: 0.45,
      edgeNoise: 0.002,
    },
  );
  disposer.track(bike.material);
  const bikeMesh = new THREE.Mesh(groundQuad(LAYOUT.bikeLane.x0, LAYOUT.bikeLane.x1, z0, z1), bike.material);
  bikeMesh.name = "bike-lane";
  bikeMesh.receiveShadow = true;
  group.add(bikeMesh);

  const turf = createStripedGrass({ map: grass.map, normalMap: grass.normalMap, roughnessMap: grass.orm, roughness: 1, metalness: 0 }, noise, 5.5);
  disposer.track(turf.material);
  const grassGeo = new GeometryBatch()
    .take(groundQuad(LAYOUT.farStraight.x1, LAYOUT.kerb.x0, z0 - 6, z1 + 6))
    .take(groundQuad(-130, LAYOUT.farStraight.x0 - 4, z0 - 30, z1 + 30))
    .take(groundQuad(LAYOUT.farStraight.x0 - 4, LAYOUT.kerb.x0, z1 + 6, z1 + 30))
    .take(groundQuad(LAYOUT.farStraight.x0 - 4, LAYOUT.kerb.x0, z0 - 30, z0 - 6))
    .build();
  const grassMesh = new THREE.Mesh(grassGeo, turf.material);
  grassMesh.name = "infield";
  grassMesh.receiveShadow = true;
  group.add(grassMesh);

  const apronMat = disposer.track(new THREE.MeshStandardMaterial({ map: concrete.map, normalMap: concrete.normalMap, roughnessMap: concrete.orm, roughness: 1, metalness: 0 }));
  const apronGeo = new GeometryBatch()
    .take(groundQuad(LAYOUT.gutter.x1, 60, z0 - 30, z1 + 30))
    .take(groundQuad(LAYOUT.kerb.x0, LAYOUT.gutter.x1, z1, z1 + 30))
    .take(groundQuad(LAYOUT.kerb.x0, LAYOUT.gutter.x1, z0 - 30, z0))
    .take(groundQuad(LAYOUT.farStraight.x0 - 4, LAYOUT.farStraight.x0, z0 - 6, z1 + 6))
    .build();
  const apron = new THREE.Mesh(apronGeo, apronMat);
  apron.name = "apron";
  apron.receiveShadow = true;
  group.add(apron);

  // Distant ground so gaps between structures never show the void.
  const outerMat = disposer.track(new THREE.MeshStandardMaterial({ color: 0x4b5240, roughness: 1, metalness: 0 }));
  const outer = new THREE.Mesh(new THREE.CircleGeometry(1500, 48).rotateX(-Math.PI / 2).translate(-36, -0.05, 50), outerMat);
  outer.name = "outer-ground";
  group.add(outer);

  clock.lap("ground");
  // ------------------------------------------------------------ structures
  const painted = new GeometryBatch();
  buildKerbs(painted);
  buildFence(painted);
  buildInfieldProps(painted);
  const paintedMat = disposer.track(vcStandard({ roughness: 0.48, metalness: 0.05 }));
  const paintedMesh = new THREE.Mesh(painted.build(), paintedMat);
  paintedMesh.name = "kerbs-fence";
  paintedMesh.castShadow = true;
  paintedMesh.receiveShadow = true;
  group.add(paintedMesh);

  const concreteBatch = new GeometryBatch();
  const steelBatch = new GeometryBatch();
  const roofBatch = new GeometryBatch();
  buildStandStructure(concreteBatch, steelBatch, roofBatch);
  buildFarStructures(concreteBatch, roofBatch);
  const lampBatch = new GeometryBatch();
  const masts = buildMasts(steelBatch, lampBatch);
  const concreteGeo = concreteBatch.build();
  boxProjectUV(concreteGeo, 1);
  const standMat = disposer.track(vcStandard({ map: concrete.map, normalMap: concrete.normalMap, roughnessMap: concrete.orm, roughness: 1, metalness: 0 }));
  const standMesh = new THREE.Mesh(concreteGeo, standMat);
  standMesh.name = "stands";
  standMesh.receiveShadow = true;
  group.add(standMesh);
  const steelMat = disposer.track(vcStandard({ roughness: 0.42, metalness: 0.55 }));
  const steelMesh = new THREE.Mesh(steelBatch.build(), steelMat);
  steelMesh.name = "steel";
  group.add(steelMesh);
  const roofMat = disposer.track(vcStandard({ roughness: 0.6, metalness: 0.2 }));
  const roofMesh = new THREE.Mesh(roofBatch.build(), roofMat);
  roofMesh.name = "roofs";
  group.add(roofMesh);
  const seats = buildSeats(31);
  disposer.track(seats.geometry);
  disposer.track(seats.material as THREE.Material);
  group.add(seats);

  const lampMat = disposer.track(createEmitter(0xffffff, 0, { side: THREE.DoubleSide }));
  const lampMesh = new THREE.Mesh(lampBatch.build(), lampMat);
  lampMesh.name = "flood-lamps";
  group.add(lampMesh);
  const stripBatch = new GeometryBatch();
  buildRoofStrips(stripBatch);
  const stripMat = disposer.track(createEmitter(0xffffff, 0));
  const stripMesh = new THREE.Mesh(stripBatch.build(), stripMat);
  stripMesh.name = "roof-strips";
  group.add(stripMesh);

  // Floodlight beams in the night haze.
  const coneMat = disposer.track(createConeMaterial(noise));
  const coneBatch: THREE.BufferGeometry[] = masts.heads.map((h) => coneGeometry(h.position, h.aim, h.position.distanceTo(h.aim) * 0.9, 13));
  const coneGeo = new GeometryBatch();
  for (const g of coneBatch) coneGeo.take(g);
  const cones = new THREE.Mesh(coneGeo.build(), coneMat);
  cones.name = "flood-cones";
  cones.renderOrder = 20;
  cones.frustumCulled = false;
  group.add(cones);

  clock.lap("structures");
  // ------------------------------------------------------------ distance
  const center: [number, number] = [-36, 50];
  const skyline = new THREE.Mesh(
    buildSkyline({ seed: 77, center, innerRadius: 430, outerRadius: 1300, count: 360, clearDir: v3(KEY_DIRS.trackLight), clearDegrees: 18, maxHeight: 75 }),
    disposer.track(createDistantMaterial(640, 40)),
  );
  skyline.name = "skyline";
  group.add(skyline);
  const treeTex = baker.bake("treeline", "data", { size: [1024, 256], a: [16, 0.4, 0.42, 0.07], seed: 21, anisotropy: 4 }, disposer);
  const ringPath = (rx: number, rz: number, n: number): Array<[number, number]> =>
    Array.from({ length: n + 1 }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return [center[0] + Math.sin(a) * rx, center[1] + Math.cos(a) * rz];
    });
  const treeMat = disposer.track(createTreeCardMaterial(treeTex, 950));
  const treeGeo = new GeometryBatch()
    .take(buildTreeCards(ringPath(150, 168, 48), 26, 160, 0, -2))
    .take(buildTreeCards(ringPath(235, 250, 48), 34, 200, 0.37, -3))
    .build();
  const trees = new THREE.Mesh(treeGeo, treeMat);
  trees.name = "tree-line";
  trees.renderOrder = -5;
  group.add(trees);

  const skyMat = disposer.track(createSkyMaterial(noise));
  const sky = createSkyDome(skyMat);
  disposer.track(sky.geometry);
  group.add(sky);

  clock.lap("distance");
  // ------------------------------------------------------------ env scene
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(sky.geometry, skyMat);
  envSky.frustumCulled = false;
  envScene.add(envSky);
  const envGroundMat = disposer.track(envBasic(0xffffff, 1));
  const envGround = new THREE.Mesh(disposer.track(new THREE.CircleGeometry(400, 32).rotateX(-Math.PI / 2)), envGroundMat);
  envScene.add(envGround);
  const envTrackMat = disposer.track(envBasic(0xffffff, 1));
  const envTrack = new THREE.Mesh(disposer.track(groundQuad(-4.4, 5.6, -60, 160, 0.01)), envTrackMat);
  envScene.add(envTrack);
  const envStandMat = disposer.track(envBasic(0xffffff, 1));
  const envStand = new THREE.Mesh(disposer.track(new THREE.BoxGeometry(12, 10, 110).translate(19, 5, 35)), envStandMat);
  envScene.add(envStand);
  const envLampMat = disposer.track(envBasic(0xffffff, 1));
  const envLamps = new THREE.Group();
  for (const h of masts.heads) {
    const lamp = new THREE.Mesh(disposer.track(new THREE.PlaneGeometry(6, 4)), envLampMat);
    lamp.position.copy(h.position);
    lamp.lookAt(h.aim);
    envLamps.add(lamp);
  }
  envScene.add(envLamps);
  const envBaker = new EnvBaker(renderer);
  disposer.track(envBaker);

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
  anchor("startLine", new THREE.Vector3(0, 0, 0));
  anchor("bikeLane", new THREE.Vector3(TRACK.bikeLaneOffsetX, 0, 0));
  const sunAnchor = anchor("sun", new THREE.Vector3(0, 100, 0));

  let current: Theme = theme;
  const applyTheme = (next: Theme) => {
    current = next;
    const t = TRACK_THEME[next];
    const keyDir = v3(next === "light" ? KEY_DIRS.trackLight : KEY_DIRS.trackDark);
    applySky(skyMat, { ...t.sky, sunDir: next === "light" ? keyDir : v3(KEY_DIRS.trackLight), pollutionDir: new THREE.Vector3(-0.7, 0, 0.7) });
    applyDistant(skyline.material as THREE.ShaderMaterial, t.skyline, keyDir);
    applyTreeCards(treeMat, t.trees, keyDir);
    setEmitter(lampMat, t.floodlamp.color, next === "light" ? 0.06 : t.floodlamp.intensity);
    setEmitter(stripMat, t.roofStrip.color, next === "light" ? 0.25 : t.roofStrip.intensity);
    (coneMat.uniforms.uColor.value as THREE.Color).setHex(t.floodlamp.color);
    // Always visible (intensity 0 by day) so the cone program is compiled up front in either theme.
    coneMat.uniforms.uIntensity.value = t.floodlamp.cone * 0.16;
    outerMat.color.setHex(next === "light" ? 0x59603f : 0x2a2e27);
    (turf.uniforms.uBladeDir.value as THREE.Vector3).set(keyDir.x, 0, keyDir.z).normalize();
    turf.uniforms.uBladeTilt.value = next === "light" ? 0.9 : 0.35;
    turf.uniforms.uTranslucency.value = next === "light" ? 0.35 : 0.12;
    if (next === "light") {
      sunAnchor.position.copy(keyDir).multiplyScalar(1000);
    } else {
      sunAnchor.position.fromArray(TRACK_KEY_MAST);
    }
    sunAnchor.userData.direction = keyDir.clone();
    // Env: lit ground tones roughly matching what the camera sees under each theme.
    envGroundMat.color.setHex(next === "light" ? 0x6f6a4e : 0x0e1210).multiplyScalar(next === "light" ? 0.55 : 0.5);
    envTrackMat.color.setHex(next === "light" ? 0xb4583e : 0x5a3328).multiplyScalar(next === "light" ? 0.42 : 0.5);
    envStandMat.color.setHex(next === "light" ? 0xb9b2a5 : 0x2b2f38).multiplyScalar(next === "light" ? 0.5 : 0.6);
    envLampMat.color.setHex(0xeef2ff).multiplyScalar(next === "light" ? 0 : 40);
    envBaker.bake(envScene, new THREE.Vector3(0, 1.2, 6));
  };
  clock.lap("env-scene");
  applyTheme(theme);
  clock.lap("theme+env-bake");
  const timings = clock.total();
  const environment = envBaker.texture;

  // Own every geometry/material built above (shared ones are de-duplicated by the disposer).
  disposer.trackObject(group);

  return {
    name: "track",
    group,
    anchors,
    environment,
    variants: TRACK_VARIANTS,
    timings,
    get theme() {
      return current;
    },
    lighting: (variant?: string) => trackPreset(current, variant ?? "base"),
    applyTheme,
    update: (time: number) => {
      skyMat.uniforms.uTime.value = time;
      (skyline.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
      coneMat.uniforms.uTime.value = time;
    },
    dispose: () => {
      group.removeFromParent();
      disposer.dispose();
    },
  };
}
