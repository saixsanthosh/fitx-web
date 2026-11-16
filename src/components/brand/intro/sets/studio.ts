/**
 * Studio set — the light hall (main thread, three.js).
 *
 * A deep, quiet room whose back wall opens on one tall doorway of light. The rig's key (`sun`, the
 * only shadow caster) shines through that doorway from behind: the wall gates it into a carpet of
 * light down the glossy floor, the squad walking out of it gets hard rims, and their long shadows
 * run down the floor towards the lens. A ray-marched beam, dust and drifting haze give the light
 * its shape; the floor mirrors the doorway analytically, occluded by the same shadow map, so the
 * walkers' legs cut dark reflections into it, and it darkens under each planted foot.
 *
 * Light theme: a warm-white morning hall, the doorway full of low sun. Dark theme: a charcoal hall,
 * the doorway a coral glow.
 *
 * Anchors: `walkStart` (0, 0, -3.2) facing +Z (the squad walks towards the lens) · `door` (the
 * doorway's centre on the floor, room side, facing +Z).
 */

import * as THREE from "three";
import type { Theme } from "../types";
import { STUDIO_DOOR, STUDIO_SUN, STUDIO_VARIANTS, studioPreset } from "./presets";
import type { IntroSet, SetOptions } from "./types";
import { getBaker } from "./util/bake";
import { Disposer, Stopwatch } from "./util/canvas";
import { EnvBaker, envBasic } from "./util/env";
import { createDust, createHazeCards, type ShaftWindow } from "./util/volumetrics";

/** Planted feet the floor darkens under (contact shadows), set per frame by the shots. */
export const STUDIO_CONTACTS = 6;

const ROOM = { halfWidth: 14, height: 10, front: 13, back: -17 } as const;
const DOOR = STUDIO_DOOR;
/** The light box behind the doorway (what the lens sees through it). */
const BOX_Z = DOOR.wallZ - DOOR.depth - 2.6;

/** Per-theme look: sRGB colours and linear light levels. */
interface HallLook {
  wall: number;
  floor: number;
  /** Floor gloss: base roughness and specular level under a clear coat of `coatRoughness`. */
  roughness: number;
  specular: number;
  coatRoughness: number;
  /** The doorway's light: hot core, coloured surround (× `level`). */
  core: number;
  edge: number;
  level: number;
  /** The doorway's mirror image on the floor (× level): the sharp image and its glow. */
  mirror: number;
  mirrorGlow: number;
  /** Light spilling round the doorway onto the wall and its reveal (scattered by the haze). */
  spill: number;
  spillRadius: number;
  dust: { color: number; intensity: number };
  haze: { color: number; intensity: number };
  /** Env bake: room shell, doorway, sunlit carpet and the big soft source right of the lens. */
  envWall: number;
  envDoor: number;
  envCarpet: number;
  envSoft: number;
}

const LOOK: Record<Theme, HallLook> = {
  light: {
    wall: 0xeceae6,
    floor: 0x9c968e,
    roughness: 0.62,
    specular: 0.6,
    coatRoughness: 0.1,
    core: 0xfff4e2,
    edge: 0xffc994,
    level: 3.6,
    mirror: 0.42,
    mirrorGlow: 0.012,
    spill: 0.9,
    spillRadius: 2.2,
    dust: { color: 0xffe8c8, intensity: 0.6 },
    haze: { color: 0xffd9b0, intensity: 0.008 },
    envWall: 0.85,
    envDoor: 2.2,
    envCarpet: 1.4,
    envSoft: 2.2,
  },
  dark: {
    wall: 0x1c1d1f,
    floor: 0x0c0d0e,
    roughness: 0.55,
    specular: 0.35,
    coatRoughness: 0.11,
    core: 0xffc4a4,
    edge: 0xff4a2a,
    level: 2.2,
    mirror: 0.55,
    mirrorGlow: 0.012,
    spill: 7,
    spillRadius: 1.4,
    dust: { color: 0xffa080, intensity: 0.9 },
    haze: { color: 0xff6e4a, intensity: 0.035 },
    envWall: 0.3,
    envDoor: 1.8,
    envCarpet: 0.6,
    envSoft: 0.9,
  },
};

// ------------------------------------------------------------------------------- shaders

/** Soft-edged light box seen through the doorway: a hot core over a coloured surround. */
function lightBoxMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uCore: { value: new THREE.Color() }, uEdge: { value: new THREE.Color() }, uLevel: { value: 1 }, uTop: { value: DOOR.height } },
    vertexShader: /* glsl */ `
      varying vec3 vBoxWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vBoxWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uCore;
      uniform vec3 uEdge;
      uniform float uLevel;
      uniform float uTop;
      varying vec3 vBoxWorld;
      void main() {
        // The core sits behind the upper doorway (where the low sun stands), the surround falls
        // off slowly so the opening reads as a volume of light, never as a flat card.
        vec2 d = (vBoxWorld.xy - vec2(0.0, uTop * 0.62)) / vec2(2.2, 2.6);
        float core = exp(-dot(d, d) * 2.0);
        vec3 c = mix(uEdge, uCore, core) * (0.62 + 0.58 * core);
        gl_FragColor = vec4(c * uLevel, 1.0);
      }
    `,
    fog: false,
  });
}

/**
 * Wall: light from the doorway spilling onto the wall and the reveal (the haze scatters it round
 * the opening), added as emissive light that falls off with the distance to the opening.
 */
function addDoorSpill(material: THREE.MeshStandardMaterial, uniforms: Record<string, THREE.IUniform>) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vHallWorld;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvHallWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "void main() {",
        `uniform vec3 uSpillColor;
        uniform vec3 uSpillDoor;
        uniform vec2 uSpill;
        varying vec3 vHallWorld;
        void main() {`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        {
          vec2 out2 = vec2(max(abs(vHallWorld.x) - uSpillDoor.x, 0.0), max(vHallWorld.y - uSpillDoor.y, 0.0));
          float d = length(out2) + max(uSpillDoor.z - vHallWorld.z, 0.0) * 0.6;
          float spill = uSpill.x / (1.0 + pow(d / uSpill.y, 2.2));
          totalEmissiveRadiance += uSpillColor * spill * diffuseColor.rgb;
        }`,
      );
  };
  material.customProgramCacheKey = () => "fitx-hall-wall";
}

/**
 * Floor: an analytic mirror of the doorway (the reflected view ray against the doorway's
 * rectangle, blurred with the distance it travels, Fresnel-weighted), occluded by the key's shadow
 * map: the key comes through the same doorway from nearly the same angle, so whatever blocks the
 * light also blocks its reflection, and the walkers' legs cut dark reflections into the glow. Plus
 * a soft occlusion disc under every planted foot (contact shadows).
 */
function addFloorMirror(material: THREE.MeshPhysicalMaterial, uniforms: Record<string, THREE.IUniform>) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vHallWorld;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvHallWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "void main() {",
        `uniform vec3 uMirrorColor;
        uniform vec4 uMirrorDoor;
        uniform vec3 uMirror;
        uniform vec3 uContacts[${STUDIO_CONTACTS}];
        uniform float uContactRadius;
        varying vec3 vHallWorld;
        void main() {`,
      )
      .replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>
        {
          float contact = 1.0;
          for (int i = 0; i < ${STUDIO_CONTACTS}; i++) {
            vec2 dc = (vHallWorld.xz - uContacts[i].xy) * vec2(1.0, 0.62);
            contact *= 1.0 - uContacts[i].z * exp(-dot(dc, dc) / (uContactRadius * uContactRadius));
          }
          reflectedLight.indirectDiffuse *= contact;
          reflectedLight.indirectSpecular *= contact;
          #ifdef USE_CLEARCOAT
            clearcoatSpecularIndirect *= contact;
          #endif
          float sunVis = 1.0;
          #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
            if (receiveShadow) sunVis = getShadow(directionalShadowMap[0], directionalLightShadows[0].shadowMapSize, directionalLightShadows[0].shadowIntensity, directionalLightShadows[0].shadowBias, directionalLightShadows[0].shadowRadius, vDirectionalShadowCoord[0]);
          #endif
          vec3 V = normalize(cameraPosition - vHallWorld);
          // Reflected view ray (floor normal +Y) towards the doorway plane.
          vec3 R = vec3(-V.x, V.y, -V.z);
          if (R.z < -1e-4) {
            float t = (uMirrorDoor.z - vHallWorld.z) / R.z;
            if (t > 0.0) {
              vec2 h = vec2(vHallWorld.x + R.x * t - uMirrorDoor.w, R.y * t);
              float soft = 0.03 + uMirror.z * t;
              float inside = (1.0 - smoothstep(uMirrorDoor.x - soft, uMirrorDoor.x + soft, abs(h.x))) * (1.0 - smoothstep(uMirrorDoor.y - soft, uMirrorDoor.y + soft, h.y));
              float wide = soft * 5.0 + 0.6;
              float glow = (1.0 - smoothstep(uMirrorDoor.x - wide, uMirrorDoor.x + wide, abs(h.x))) * (1.0 - smoothstep(uMirrorDoor.y - wide, uMirrorDoor.y + wide, h.y));
              float fresnel = 0.04 + 0.96 * pow(1.0 - clamp(V.y, 0.0, 1.0), 5.0);
              float mirror = (uMirror.x * inside + uMirror.y * glow) * fresnel * mix(1.0, sunVis, 0.94) * contact;
              totalEmissiveRadiance += uMirrorColor * mirror;
            }
          }
        }`,
      );
  };
  material.customProgramCacheKey = () => "fitx-hall-floor";
}

// ------------------------------------------------------------------------------- public API

/**
 * Sets the doorway light's level (1 = as built, 0 = off) — light box, beam, haze, dust, spill and
 * the floor's mirror image together — and how far its glow spreads round the opening (0 = the
 * walk's tight halo, 1 = a wide bloom of scattered light). Shots drive it every frame (5a opens on
 * a flare, 5b swells it into the flash); `hideStage` resets it to (1, 0). The name is the old light
 * bar's, kept for the stage kit.
 */
export function setStudioBarLevel(set: IntroSet, level: number, spread = 0) {
  (set.group.userData.setBarLevel as ((level: number, spread: number) => void) | undefined)?.(level, spread);
}

/**
 * Contact shadows: up to `STUDIO_CONTACTS` planted feet as (x, z, strength 0..1) triples in set
 * space (missing entries are cleared). Shots set them every frame from the walkers' feet.
 */
export function setStudioContacts(set: IntroSet, contacts: ArrayLike<number>) {
  (set.group.userData.setContacts as ((contacts: ArrayLike<number>) => void) | undefined)?.(contacts);
}

export function createStudioSet(renderer: THREE.WebGLRenderer, theme: Theme, options: SetOptions = {}): IntroSet {
  const clock = new Stopwatch();
  const disposer = new Disposer();
  const group = new THREE.Group();
  group.name = "set-studio";
  const baker = getBaker(renderer);
  const medium = options.quality === "medium";
  const noise = baker.bake("noise", "data", { size: 256, a: [4, 0, 0, 0], seed: 31 }, disposer);
  const hazeTex = baker.bake("haze", "data", { size: 512, a: [4, 1.6, 0, 0], seed: 8, repeat: true }, disposer);
  const halfW = DOOR.width / 2;

  // ------------------------------------------------------------ floor
  // Polished floor: a clear coat over a matte base whose roughness wanders a little (large, soft
  // patches) so the reflections breathe instead of reading as a perfect CG mirror.
  const floorMat = disposer.track(
    new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 1, roughnessMap: noise, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 0.55 }),
  );
  const mirror: Record<string, THREE.IUniform> = {
    uMirrorColor: { value: new THREE.Color() },
    uMirrorDoor: { value: new THREE.Vector4(halfW, DOOR.height, DOOR.wallZ, 0) },
    uMirror: { value: new THREE.Vector3(0.6, 0.06, 0.035) },
    uContacts: { value: Array.from({ length: STUDIO_CONTACTS }, () => new THREE.Vector3()) },
    uContactRadius: { value: 0.16 },
  };
  addFloorMirror(floorMat, mirror);
  const floorGeo = new THREE.PlaneGeometry(2 * ROOM.halfWidth, ROOM.front - ROOM.back, 1, 1);
  // UVs in metres / 7: the noise patches are a few metres across.
  const uv = floorGeo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i += 1) uv.setXY(i, (uv.getX(i) * 2 * ROOM.halfWidth) / 7, (uv.getY(i) * (ROOM.front - ROOM.back)) / 7);
  floorGeo.rotateX(-Math.PI / 2).translate(0, 0, (ROOM.front + ROOM.back) / 2);
  const floor = new THREE.Mesh(disposer.track(floorGeo), floorMat);
  floor.name = "hall-floor";
  floor.receiveShadow = true;
  group.add(floor);

  // ------------------------------------------------------------ back wall with the doorway
  const spill: Record<string, THREE.IUniform> = {
    uSpillColor: { value: new THREE.Color() },
    uSpillDoor: { value: new THREE.Vector3(halfW, DOOR.height, DOOR.wallZ) },
    uSpill: { value: new THREE.Vector2(1, 1) },
  };
  const wallMat = disposer.track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 }));
  addDoorSpill(wallMat, spill);
  const wallZ = DOOR.wallZ - DOOR.depth / 2;
  const sideWidth = ROOM.halfWidth - halfW;
  const parts: THREE.BufferGeometry[] = [
    new THREE.BoxGeometry(sideWidth, ROOM.height, DOOR.depth).translate(-(halfW + sideWidth / 2), ROOM.height / 2, wallZ),
    new THREE.BoxGeometry(sideWidth, ROOM.height, DOOR.depth).translate(halfW + sideWidth / 2, ROOM.height / 2, wallZ),
    new THREE.BoxGeometry(DOOR.width, ROOM.height - DOOR.height, DOOR.depth).translate(0, (ROOM.height + DOOR.height) / 2, wallZ),
  ];
  for (const part of parts) {
    const wall = new THREE.Mesh(disposer.track(part), wallMat);
    wall.name = "hall-wall";
    // The wall gates the key into the doorway's carpet of light.
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
  }

  // ------------------------------------------------------------ the light beyond the doorway
  const boxMat = disposer.track(lightBoxMaterial());
  const box = new THREE.Mesh(disposer.track(new THREE.PlaneGeometry(18, 15).translate(0, 6.5, BOX_Z)), boxMat);
  box.name = "hall-light";
  group.add(box);

  // ------------------------------------------------------------ atmosphere
  const lightDir = new THREE.Vector3(...STUDIO_SUN).negate().normalize();
  const doorway: ShaftWindow = { x0: -halfW, x1: halfW, y0: 0, y1: DOOR.height, cols: 1, rows: 1, mullion: 0 };
  const dust = createDust(57, medium ? 900 : 1600, new THREE.Vector3(-3.4, 0.08, DOOR.wallZ + 0.3), new THREE.Vector3(3.4, 4.6, 3.5), [doorway], DOOR.wallZ, lightDir);
  disposer.track(dust.points.geometry);
  disposer.track(dust.material);
  group.add(dust.points);
  // Haze: a glow of scattered light hugging the doorway, layers drifting through the beam and a
  // low mist the walkers wade out of. The air in front of the lens stays clear.
  const haze = createHazeCards(
    5,
    [
      { center: [0, 2.5, DOOR.wallZ + 0.35], size: [6, 6.4] },
      { center: [-0.4, 1.8, DOOR.wallZ + 2.6], size: [5.5, 3.8] },
      { center: [0.6, 1.4, -6.4], size: [6, 2.8] },
      { center: [-0.2, 0.45, -4.6], size: [8, 1.2] },
    ],
    hazeTex,
  );
  disposer.track(haze.mesh.geometry);
  disposer.track(haze.material);
  group.add(haze.mesh);

  // ------------------------------------------------------------ env (IBL)
  const envScene = new THREE.Scene();
  const envWallMat = disposer.track(envBasic(0xffffff, 1, THREE.BackSide));
  envScene.add(new THREE.Mesh(disposer.track(new THREE.BoxGeometry(2 * ROOM.halfWidth, ROOM.height, ROOM.front - DOOR.wallZ).translate(0, ROOM.height / 2, (ROOM.front + DOOR.wallZ) / 2)), envWallMat));
  const envDoorMat = disposer.track(envBasic(0xffffff, 1, THREE.DoubleSide));
  const envDoor = new THREE.Mesh(disposer.track(new THREE.PlaneGeometry(DOOR.width, DOOR.height).translate(0, DOOR.height / 2, DOOR.wallZ + 0.05)), envDoorMat);
  envScene.add(envDoor);
  const envCarpetMat = disposer.track(envBasic(0xffffff, 1));
  envScene.add(new THREE.Mesh(disposer.track(new THREE.PlaneGeometry(DOOR.width, 13).rotateX(-Math.PI / 2).translate(0.5, 0.02, DOOR.wallZ + 6.5)), envCarpetMat));
  const envSoftMat = disposer.track(envBasic(0xffffff, 1, THREE.DoubleSide));
  const envSoft = new THREE.Mesh(disposer.track(new THREE.PlaneGeometry(3.5, 2.6)), envSoftMat);
  envSoft.position.set(4.2, 3.2, 1.6);
  envSoft.lookAt(0, 1.4, -2.4);
  envScene.add(envSoft);
  const envBaker = disposer.track(new EnvBaker(renderer));

  // TEMP-DEBUG
  const dbg = typeof location !== "undefined" ? new URLSearchParams(location.search).get("hallDebug") ?? "" : "";
  if (dbg.includes("h")) haze.mesh.visible = false;
  if (dbg.includes("d")) dust.points.visible = false;
  if (dbg.includes("b")) box.visible = false;
  if (dbg.includes("w")) wallMat.onBeforeCompile = () => {};
  // ------------------------------------------------------------ anchors
  const anchors: Record<string, THREE.Object3D> = {};
  const anchor = (name: string, position: THREE.Vector3) => {
    const o = new THREE.Object3D();
    o.name = `anchor:${name}`;
    o.position.copy(position);
    group.add(o);
    anchors[name] = o;
  };
  anchor("walkStart", new THREE.Vector3(0, 0, -3.2));
  anchor("door", new THREE.Vector3(0, 0, DOOR.wallZ));

  // ------------------------------------------------------------ theme + light level
  let current: Theme = theme;
  const base = { box: 1, mirror: 0.6, glow: 0.06, spill: 1, dust: 1, haze: 0.1, spillRadius: 1 };
  const contactScratch = new Float32Array(STUDIO_CONTACTS * 3);
  const setContacts = (contacts: ArrayLike<number>) => {
    const slots = mirror.uContacts.value as THREE.Vector3[];
    for (let i = 0; i < STUDIO_CONTACTS; i += 1) {
      const k = i * 3;
      slots[i].set(contacts[k] ?? 0, contacts[k + 1] ?? 0, k + 2 < contacts.length ? contacts[k + 2] : 0);
    }
  };
  const setBarLevel = (level: number, spread = 0) => {
    const s = Math.min(1, Math.max(0, spread));
    boxMat.uniforms.uLevel.value = base.box * level;
    (mirror.uMirror.value as THREE.Vector3).set(base.mirror * level, base.glow * level * (1 + 3 * s), 0.035);
    // The scattered glow round the opening widens and brightens as the light swells.
    (spill.uSpill.value as THREE.Vector2).set(base.spill * level * (1 + 1.5 * s), base.spillRadius * (1 + 1.6 * s));
    dust.material.uniforms.uIntensity.value = base.dust * Math.min(level, 1.6);
    haze.material.uniforms.uIntensity.value = base.haze * level * (1 + 2.2 * s);
  };
  group.userData.setBarLevel = setBarLevel;
  group.userData.setContacts = setContacts;

  const applyTheme = (next: Theme) => {
    current = next;
    const look = LOOK[next];
    wallMat.color.setHex(look.wall);
    floorMat.color.setHex(look.floor);
    floorMat.roughness = look.roughness;
    floorMat.specularIntensity = look.specular;
    floorMat.clearcoatRoughness = look.coatRoughness;
    (boxMat.uniforms.uCore.value as THREE.Color).setHex(look.core);
    (boxMat.uniforms.uEdge.value as THREE.Color).setHex(look.edge);
    base.box = look.level;
    // The mirror carries the doorway's mean colour (core and surround) at the light box's level.
    (mirror.uMirrorColor.value as THREE.Color).setHex(look.core).lerp(new THREE.Color(look.edge), 0.45).multiplyScalar(look.level);
    base.mirror = look.mirror;
    base.glow = look.mirrorGlow;
    (spill.uSpillColor.value as THREE.Color).setHex(look.edge);
    base.spill = look.spill;
    base.spillRadius = look.spillRadius;
    (dust.material.uniforms.uColor.value as THREE.Color).setHex(look.dust.color);
    base.dust = look.dust.intensity;
    (haze.material.uniforms.uColor.value as THREE.Color).setHex(look.haze.color);
    base.haze = look.haze.intensity;
    envWallMat.color.setHex(look.wall).multiplyScalar(look.envWall);
    envDoorMat.color.setHex(look.core).lerp(new THREE.Color(look.edge), 0.5).multiplyScalar(look.level * look.envDoor);
    envCarpetMat.color.setHex(look.edge).lerp(new THREE.Color(look.floor), 0.5).multiplyScalar(look.envCarpet);
    envSoftMat.color.setHex(next === "light" ? 0xfff2e4 : 0xdfe6f2).multiplyScalar(look.envSoft);
    envBaker.bake(envScene, new THREE.Vector3(0, 1.3, -2.6));
    setBarLevel(1, 0);
    setContacts(contactScratch);
  };
  clock.lap("build");
  applyTheme(theme);
  clock.lap("theme+env-bake");
  const timings = clock.total();

  // Own every geometry/material built above (shared ones are de-duplicated by the disposer).
  disposer.trackObject(group);

  return {
    name: "studio",
    group,
    anchors,
    environment: envBaker.texture,
    variants: STUDIO_VARIANTS,
    timings,
    get theme() {
      return current;
    },
    lighting: (variant?: string) => studioPreset(current, variant ?? "walk"),
    applyTheme,
    update: (time: number) => {
      dust.material.uniforms.uTime.value = time;
      haze.material.uniforms.uTime.value = time;
    },
    dispose: () => {
      group.removeFromParent();
      disposer.dispose();
    },
  };
}
