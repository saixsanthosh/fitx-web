/**
 * One fixed light rig for the whole film (main thread).
 *
 * The number and kind of lights never changes between shots: changing it would force every
 * lit material to recompile its shader at the cut and stall the frame. Sets and shots only
 * apply *presets* (colour, intensity, position) to this rig. Unused lights get intensity 0.
 */

import * as THREE from "three";
import type { Vec3Tuple } from "./types";

export interface LightingPreset {
  /** Key light; the only shadow caster. Shadow frustum is a square of half-size `shadowExtent` around `target`. */
  sun: { color: number; intensity: number; position: Vec3Tuple; target: Vec3Tuple; shadowExtent: number; shadowRadius?: number; shadowBias?: number; shadowNormalBias?: number };
  sky: { color: number; groundColor: number; intensity: number };
  fill: { color: number; intensity: number; position: Vec3Tuple };
  rim: { color: number; intensity: number; position: Vec3Tuple; target: Vec3Tuple; angle: number; penumbra: number; distance: number };
  practicals: [PointPreset, PointPreset];
  /** Scene environment (image-based lighting) strength. */
  environmentIntensity: number;
  /** Renderer tone-mapping exposure. */
  exposure: number;
  /** Exponential fog; density 0 disables visually but keeps the shader variant stable. */
  fog: { color: number; density: number };
}

export interface PointPreset {
  color: number;
  intensity: number;
  position: Vec3Tuple;
  distance: number;
  decay?: number;
}

export interface LightRig {
  group: THREE.Group;
  sun: THREE.DirectionalLight;
  sky: THREE.HemisphereLight;
  fill: THREE.DirectionalLight;
  rim: THREE.SpotLight;
  practicals: [THREE.PointLight, THREE.PointLight];
}

export function createLightRig(options: { shadowMapSize: number }): LightRig {
  const group = new THREE.Group();
  group.name = "intro-light-rig";

  const sun = new THREE.DirectionalLight(0xffffff, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(options.shadowMapSize, options.shadowMapSize);
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  sun.shadow.camera.near = 0.1;
  sun.shadow.camera.far = 60;
  group.add(sun, sun.target);

  const sky = new THREE.HemisphereLight(0xffffff, 0x444444, 0);
  const fill = new THREE.DirectionalLight(0xffffff, 0);
  const rim = new THREE.SpotLight(0xffffff, 0, 30, 0.5, 0.6, 1.4);
  group.add(sky, fill, rim, rim.target);

  const practicals: [THREE.PointLight, THREE.PointLight] = [
    new THREE.PointLight(0xffffff, 0, 10, 2),
    new THREE.PointLight(0xffffff, 0, 10, 2),
  ];
  group.add(...practicals);

  return { group, sun, sky, fill, rim, practicals };
}

export function applyLightingPreset(rig: LightRig, preset: LightingPreset, scene: THREE.Scene, renderer?: THREE.WebGLRenderer) {
  const { sun, sky, fill, rim, practicals } = rig;
  sun.color.setHex(preset.sun.color);
  sun.intensity = preset.sun.intensity;
  sun.position.fromArray(preset.sun.position);
  sun.target.position.fromArray(preset.sun.target);
  const extent = preset.sun.shadowExtent;
  const shadowCamera = sun.shadow.camera;
  shadowCamera.left = -extent;
  shadowCamera.right = extent;
  shadowCamera.top = extent;
  shadowCamera.bottom = -extent;
  shadowCamera.updateProjectionMatrix();
  sun.shadow.radius = preset.sun.shadowRadius ?? 3;
  sun.shadow.bias = preset.sun.shadowBias ?? -0.00025;
  sun.shadow.normalBias = preset.sun.shadowNormalBias ?? 0.02;

  sky.color.setHex(preset.sky.color);
  sky.groundColor.setHex(preset.sky.groundColor);
  sky.intensity = preset.sky.intensity;

  fill.color.setHex(preset.fill.color);
  fill.intensity = preset.fill.intensity;
  fill.position.fromArray(preset.fill.position);

  rim.color.setHex(preset.rim.color);
  rim.intensity = preset.rim.intensity;
  rim.position.fromArray(preset.rim.position);
  rim.target.position.fromArray(preset.rim.target);
  rim.angle = preset.rim.angle;
  rim.penumbra = preset.rim.penumbra;
  rim.distance = preset.rim.distance;

  preset.practicals.forEach((point, index) => {
    const light = practicals[index];
    light.color.setHex(point.color);
    light.intensity = point.intensity;
    light.position.fromArray(point.position);
    light.distance = point.distance;
    light.decay = point.decay ?? 2;
  });

  scene.environmentIntensity = preset.environmentIntensity;
  if (scene.fog instanceof THREE.FogExp2) {
    scene.fog.color.setHex(preset.fog.color);
    scene.fog.density = preset.fog.density;
  } else {
    scene.fog = new THREE.FogExp2(preset.fog.color, preset.fog.density);
  }
  if (renderer) renderer.toneMappingExposure = preset.exposure;
}

const mixHex = (a: number, b: number, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
const mixVec = (a: Vec3Tuple, b: Vec3Tuple, t: number): Vec3Tuple => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mixNum = (a: number, b: number, t: number) => a + (b - a) * t;

/** Blend two presets (for in-shot light moves such as the brand "light sweep"). */
export function mixLightingPresets(a: LightingPreset, b: LightingPreset, t: number): LightingPreset {
  const point = (p: PointPreset, q: PointPreset): PointPreset => ({
    color: mixHex(p.color, q.color, t),
    intensity: mixNum(p.intensity, q.intensity, t),
    position: mixVec(p.position, q.position, t),
    distance: mixNum(p.distance, q.distance, t),
    decay: mixNum(p.decay ?? 2, q.decay ?? 2, t),
  });
  return {
    sun: {
      color: mixHex(a.sun.color, b.sun.color, t),
      intensity: mixNum(a.sun.intensity, b.sun.intensity, t),
      position: mixVec(a.sun.position, b.sun.position, t),
      target: mixVec(a.sun.target, b.sun.target, t),
      shadowExtent: mixNum(a.sun.shadowExtent, b.sun.shadowExtent, t),
      shadowRadius: mixNum(a.sun.shadowRadius ?? 3, b.sun.shadowRadius ?? 3, t),
      shadowBias: mixNum(a.sun.shadowBias ?? -0.00025, b.sun.shadowBias ?? -0.00025, t),
      shadowNormalBias: mixNum(a.sun.shadowNormalBias ?? 0.02, b.sun.shadowNormalBias ?? 0.02, t),
    },
    sky: { color: mixHex(a.sky.color, b.sky.color, t), groundColor: mixHex(a.sky.groundColor, b.sky.groundColor, t), intensity: mixNum(a.sky.intensity, b.sky.intensity, t) },
    fill: { color: mixHex(a.fill.color, b.fill.color, t), intensity: mixNum(a.fill.intensity, b.fill.intensity, t), position: mixVec(a.fill.position, b.fill.position, t) },
    rim: {
      color: mixHex(a.rim.color, b.rim.color, t),
      intensity: mixNum(a.rim.intensity, b.rim.intensity, t),
      position: mixVec(a.rim.position, b.rim.position, t),
      target: mixVec(a.rim.target, b.rim.target, t),
      angle: mixNum(a.rim.angle, b.rim.angle, t),
      penumbra: mixNum(a.rim.penumbra, b.rim.penumbra, t),
      distance: mixNum(a.rim.distance, b.rim.distance, t),
    },
    practicals: [point(a.practicals[0], b.practicals[0]), point(a.practicals[1], b.practicals[1])],
    environmentIntensity: mixNum(a.environmentIntensity, b.environmentIntensity, t),
    exposure: mixNum(a.exposure, b.exposure, t),
    fog: { color: mixHex(a.fog.color, b.fog.color, t), density: mixNum(a.fog.density, b.fog.density, t) },
  };
}
