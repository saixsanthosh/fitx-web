/**
 * Cinematic sun flare (main thread).
 *
 * three/addons `Lensflare` tests occlusion with `copyFramebufferToTexture`, which is invalid
 * on a multisampled framebuffer (our HDR scene target), so this flare keeps the same model —
 * an object you place at the light, elements spaced along the line through the frame centre,
 * canvas-generated textures — but is drawn by `IntroPost` (one instanced draw) into a
 * half-resolution HDR lens buffer that the output pass adds before tone mapping, after depth
 * of field so the ghosts never get defocused. Occlusion is measured from the scene's
 * resolved depth texture: 16 taps over the sun disc give a soft, flickering partial
 * occlusion (spokes, arms, hair). Flares only render through IntroPost.
 * The look is deliberately restrained: warm glow + hot core, a thin anamorphic streak, a few
 * faint tinted aperture ghosts and one spectral halo ring. Element sizes are in frame heights
 * so the flare reads the same on every screen.
 */

import * as THREE from "three";
import { ATLAS_CELLS, FLARE_CELL, getFlareAtlas } from "./textures";

export interface SunFlareOptions {
  /** sRGB hex of the light (default: golden-hour sun). */
  color?: number;
  /** Strength at `setIntensity(1)` (default 1). */
  intensity?: number;
  /** Depth (m) beyond which a pixel counts as open sky for occlusion (default 150). */
  skyDistance?: number;
  /** Anamorphic horizontal streak (default true). */
  streak?: boolean;
  /** Occlusion sample radius in frame heights — about the sun's apparent radius (default 0.012). */
  occlusionRadius?: number;
}

export interface SunFlare {
  /** Place at the sun (in front of the sky dome or beyond it — both work) and add to the scene. */
  object: THREE.Object3D;
  /** 0 = off, 1 = designed strength. */
  setIntensity(intensity: number): void;
  setColor(hex: number): void;
  dispose(): void;
}

interface ElementDef {
  cell: number;
  /** 0 = at the light, 0.5 = frame centre, 1 = mirrored through the centre. */
  distance: number;
  width: number;
  height: number;
  /** Linear RGB multiplier (× light colour). */
  tint: [number, number, number];
  strength: number;
}

const ELEMENTS: ElementDef[] = [
  { cell: FLARE_CELL.glow, distance: 0, width: 0.8, height: 0.8, tint: [1, 0.9, 0.76], strength: 0.11 },
  { cell: FLARE_CELL.glow, distance: 0, width: 0.09, height: 0.09, tint: [1, 0.97, 0.92], strength: 0.9 },
  { cell: FLARE_CELL.streak, distance: 0, width: 2.4, height: 0.032, tint: [0.86, 0.93, 1.1], strength: 0.16 },
  { cell: FLARE_CELL.ghost, distance: 0.3, width: 0.045, height: 0.045, tint: [0.55, 0.8, 1], strength: 0.1 },
  { cell: FLARE_CELL.ghost, distance: 0.58, width: 0.1, height: 0.1, tint: [1, 0.72, 0.42], strength: 0.055 },
  { cell: FLARE_CELL.ghost, distance: 0.74, width: 0.065, height: 0.065, tint: [0.55, 1, 0.82], strength: 0.065 },
  { cell: FLARE_CELL.ghost, distance: 1.06, width: 0.22, height: 0.22, tint: [0.82, 0.66, 1], strength: 0.03 },
  { cell: FLARE_CELL.ghost, distance: 1.32, width: 0.13, height: 0.13, tint: [1, 0.82, 0.56], strength: 0.045 },
  { cell: FLARE_CELL.ring, distance: 0.96, width: 0.62, height: 0.62, tint: [1, 1, 1], strength: 0.045 },
];

const VERTEX = /* glsl */ `
#include <packing>
attribute vec4 aElement;
attribute vec3 aColor;
uniform vec3 sunNdc;
uniform float aspect;
uniform sampler2D tDepth;
uniform float cameraNear;
uniform float cameraFar;
uniform float sunDistance;
uniform float skyDistance;
uniform float occlusionRadius;
uniform vec3 lightColor;
varying vec2 vUv;
varying vec3 vColor;

float openSky(vec2 uv) {
  float depth = texture2D(tDepth, uv).x;
  float z = -perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
  return (depth >= 0.999999 || z >= min(sunDistance * 0.98, skyDistance)) ? 1.0 : 0.0;
}

void main() {
  vec2 sunUv = sunNdc.xy * 0.5 + 0.5;
  float visible = 0.0;
  for (int i = 0; i < 16; i++) {
    float r = sqrt((float(i) + 0.5) / 16.0) * occlusionRadius;
    float a = float(i) * 2.39996323;
    vec2 uv = sunUv + vec2(cos(a) * r / aspect, sin(a) * r);
    visible += openSky(clamp(uv, vec2(0.0005), vec2(0.9995)));
  }
  visible /= 16.0;
  float edge = max(abs(sunNdc.x), abs(sunNdc.y));
  float fade = 1.0 - smoothstep(0.92, 1.3, edge);
  // Ghosts brighten a little as the sun moves off axis, like real internal reflections.
  float offAxis = mix(0.65, 1.0, smoothstep(0.0, 0.8, length(sunNdc.xy)));
  float ghost = aElement.x > 0.01 ? offAxis : 1.0;

  vec2 center = sunNdc.xy - sunNdc.xy * 2.0 * aElement.x;
  vec2 corner = position.xy * 2.0;
  gl_Position = vec4(center + corner * aElement.zw * vec2(1.0 / aspect, 1.0), 0.0, 1.0);

  float cell = aElement.y;
  float cx = mod(cell, ${ATLAS_CELLS.toFixed(1)});
  float cy = floor(cell / ${ATLAS_CELLS.toFixed(1)} + 0.001);
  vec2 local = position.xy + 0.5;
  vUv = vec2((cx + local.x) / ${ATLAS_CELLS.toFixed(1)}, 1.0 - (cy + 1.0 - local.y) / ${ATLAS_CELLS.toFixed(1)});
  vColor = aColor * lightColor * visible * fade * ghost * sunNdc.z;
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D atlas;
varying vec2 vUv;
varying vec3 vColor;
void main() {
  vec4 t = texture2D(atlas, vUv);
  gl_FragColor = vec4(vColor * t.rgb * t.a, 1.0);
}`;

class SunFlareObject extends THREE.Object3D {
  readonly isSunFlare = true;
  intensity: number;
  readonly color = new THREE.Color();
  readonly skyDistance: number;
  readonly occlusionRadius: number;
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;

  constructor(options: SunFlareOptions) {
    super();
    this.name = "fx.sunFlare";
    this.intensity = options.intensity ?? 1;
    this.color.setHex(options.color ?? 0xffd2a0);
    this.skyDistance = options.skyDistance ?? 150;
    this.occlusionRadius = options.occlusionRadius ?? 0.012;
    const elements = ELEMENTS.filter((element) => options.streak !== false || element.cell !== FLARE_CELL.streak);

    const geometry = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geometry.index = quad.index;
    geometry.setAttribute("position", quad.getAttribute("position"));
    const element = new Float32Array(elements.length * 4);
    const color = new Float32Array(elements.length * 3);
    elements.forEach((def, index) => {
      element.set([def.distance, def.cell, def.width, def.height], index * 4);
      color.set([def.tint[0] * def.strength, def.tint[1] * def.strength, def.tint[2] * def.strength], index * 3);
    });
    geometry.setAttribute("aElement", new THREE.InstancedBufferAttribute(element, 4));
    geometry.setAttribute("aColor", new THREE.InstancedBufferAttribute(color, 3));
    geometry.instanceCount = elements.length;

    const material = new THREE.ShaderMaterial({
      name: "fx.sunFlare",
      uniforms: {
        atlas: { value: getFlareAtlas() },
        tDepth: { value: null },
        sunNdc: { value: new THREE.Vector3() },
        aspect: { value: 1 },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 100 },
        sunDistance: { value: 100 },
        skyDistance: { value: this.skyDistance },
        occlusionRadius: { value: this.occlusionRadius },
        lightColor: { value: new THREE.Color() },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
  }
}

const registry = new Set<SunFlareObject>();

export function createSunFlare(options: SunFlareOptions = {}): SunFlare {
  const flare = new SunFlareObject(options);
  registry.add(flare);
  return {
    object: flare,
    setIntensity(intensity) {
      flare.intensity = Math.max(0, intensity);
    },
    setColor(hex) {
      flare.color.setHex(hex);
    },
    dispose() {
      registry.delete(flare);
      flare.removeFromParent();
      flare.mesh.geometry.dispose();
      flare.mesh.material.dispose();
    },
  };
}

function attachedAndVisible(object: THREE.Object3D, scene: THREE.Object3D) {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (!node.visible) return false;
    if (node === scene) return true;
  }
  return false;
}

const _flareScene = new THREE.Scene();
const _position = new THREE.Vector3();

/**
 * Draws every live flare in `scene` additively into `target` (HDR, after DOF). Called by
 * IntroPost; returns the number of flares drawn.
 */
export function renderSunFlares(renderer: THREE.WebGLRenderer, scene: THREE.Object3D, camera: THREE.PerspectiveCamera, depthTexture: THREE.DepthTexture, target: THREE.WebGLRenderTarget | null, aspect: number) {
  let drawn = 0;
  for (const flare of registry) {
    if (flare.intensity <= 0 || !attachedAndVisible(flare, scene)) continue;
    _position.setFromMatrixPosition(flare.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
    if (_position.z >= -camera.near) continue;
    const sunDistance = -_position.z;
    _position.applyMatrix4(camera.projectionMatrix);
    const u = flare.mesh.material.uniforms;
    (u.sunNdc.value as THREE.Vector3).set(_position.x, _position.y, flare.intensity);
    u.aspect.value = aspect;
    u.tDepth.value = depthTexture;
    u.cameraNear.value = camera.near;
    u.cameraFar.value = camera.far;
    u.sunDistance.value = sunDistance;
    (u.lightColor.value as THREE.Color).copy(flare.color);
    _flareScene.add(flare.mesh);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(target);
    renderer.render(_flareScene, camera);
    renderer.autoClear = autoClear;
    _flareScene.remove(flare.mesh);
    drawn += 1;
  }
  return drawn;
}

/** Compiles every registered flare's program (call with the HDR target bound). */
export function compileSunFlares(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
  for (const flare of registry) _flareScene.add(flare.mesh);
  if (_flareScene.children.length > 0) renderer.compile(_flareScene, camera);
  for (const flare of registry) _flareScene.remove(flare.mesh);
}

/** True when any registered flare could draw into this scene (lets the post skip the pass). */
export function hasSunFlares(scene: THREE.Object3D) {
  for (const flare of registry) if (flare.intensity > 0 && attachedAndVisible(flare, scene)) return true;
  return false;
}
