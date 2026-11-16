/**
 * Distant silhouettes (city skyline, tree belts) with their own aerial perspective: they fade into
 * the horizon haze colour of the sky with distance and towards their base, and light up windows at
 * night. Unlit and fog-free so they always blend into the sky dome exactly. One program for both
 * buildings and trees (windows off for trees).
 */

import * as THREE from "three";
import { createRng } from "../../math";

const VERT = /* glsl */ `
attribute vec3 aFace;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vFace;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vFace = aFace;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uBase;
uniform vec3 uLit;
uniform vec3 uHaze;
uniform vec3 uHazeNear;
uniform vec3 uWindows;
uniform vec3 uSunDir;
uniform float uWindowAmount;
uniform float uHazeDist;
uniform float uHazeHeight;
uniform float uTime;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vFace;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 n = normalize(vNormalW);
  float dist = length(vWorld - cameraPosition);
  float lit = max(dot(n, uSunDir), 0.0);
  float sky = 0.5 + 0.5 * n.y;
  vec3 col = uBase * (0.75 + 0.25 * sky) + uLit * lit * 0.55;
  float win = 0.0;
  if (uWindowAmount > 0.0 && vFace.z > 0.5) {
    vec2 cell = floor(vFace.xy / vec2(3.1, 3.4));
    vec2 f = fract(vFace.xy / vec2(3.1, 3.4));
    float pane = step(0.2, f.x) * step(f.x, 0.8) * step(0.28, f.y) * step(f.y, 0.82);
    float h = hash12(cell + vFace.z * 17.0);
    float on = step(0.66, h);
    float flick = 0.85 + 0.15 * sin(uTime * (0.5 + h * 2.0) + h * 30.0);
    win = pane * on * (0.35 + 0.65 * hash12(cell * 1.7 + 3.0)) * flick;
  }
  float haze = 1.0 - exp(-dist / uHazeDist);
  float low = 1.0 - smoothstep(0.0, uHazeHeight, vWorld.y);
  haze = clamp(haze + low * 0.35 * (1.0 - haze), 0.0, 0.985);
  vec3 hazeCol = mix(uHazeNear, uHaze, smoothstep(150.0, 700.0, dist));
  col = mix(col, hazeCol, haze);
  col += uWindows * win * uWindowAmount * (1.0 - haze * 0.55);
  gl_FragColor = vec4(col, 1.0);
}
`;

export interface DistantColors {
  base: number;
  lit: number;
  haze: number;
  hazeNear: number;
  windows: number;
  windowAmount: number;
}

export function createDistantMaterial(hazeDistance: number, hazeHeight: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uBase: { value: new THREE.Color() },
      uLit: { value: new THREE.Color() },
      uHaze: { value: new THREE.Color() },
      uHazeNear: { value: new THREE.Color() },
      uWindows: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uWindowAmount: { value: 0 },
      uHazeDist: { value: hazeDistance },
      uHazeHeight: { value: hazeHeight },
      uTime: { value: 0 },
    },
    fog: false,
  });
}

export function applyDistant(material: THREE.ShaderMaterial, colors: DistantColors, sunDir: THREE.Vector3) {
  const u = material.uniforms;
  (u.uBase.value as THREE.Color).setHex(colors.base);
  (u.uLit.value as THREE.Color).setHex(colors.lit);
  (u.uHaze.value as THREE.Color).setHex(colors.haze);
  (u.uHazeNear.value as THREE.Color).setHex(colors.hazeNear);
  (u.uWindows.value as THREE.Color).setHex(colors.windows);
  u.uWindowAmount.value = colors.windowAmount;
  (u.uSunDir.value as THREE.Vector3).copy(sunDir).normalize();
}

interface Building {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  rot: number;
}

/** Box with per-face façade coordinates in `aFace` (u meters along face, v meters up, seed or 0 on roofs). */
function pushBox(b: Building, seed: number, pos: number[], nor: number[], face: number[], yBase = 0) {
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  const corner = (lx: number, lz: number): [number, number] => [b.x + lx * c - lz * s, b.z + lx * s + lz * c];
  const hw = b.w / 2;
  const hd = b.d / 2;
  const corners = [corner(-hw, -hd), corner(hw, -hd), corner(hw, hd), corner(-hw, hd)];
  const y0 = yBase;
  const y1 = yBase + b.h;
  for (let i = 0; i < 4; i += 1) {
    const a = corners[i];
    const bb = corners[(i + 1) % 4];
    const ex = bb[0] - a[0];
    const ez = bb[1] - a[1];
    const len = Math.hypot(ex, ez);
    const nx = ez / len;
    const nz = -ex / len;
    const quad = [
      [a[0], y0, a[1], 0, y0],
      [bb[0], y0, bb[1], len, y0],
      [bb[0], y1, bb[1], len, y1],
      [a[0], y1, a[1], 0, y1],
    ];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const q = quad[k];
      pos.push(q[0], q[1], q[2]);
      nor.push(nx, 0, nz);
      face.push(q[3], q[4], seed + i * 0.13);
    }
  }
  const roof = [corners[0], corners[3], corners[2], corners[0], corners[2], corners[1]];
  for (const r of roof) {
    pos.push(r[0], y1, r[1]);
    nor.push(0, 1, 0);
    face.push(0, 0, 0);
  }
}

/**
 * City skyline ring around `center` between radii, skipping the azimuth window around `clearDir`
 * (keeps the low sun visible) and keeping heights low inside `lowWindow` degrees of it.
 */
export function buildSkyline(options: {
  seed: number;
  center: [number, number];
  innerRadius: number;
  outerRadius: number;
  count: number;
  clearDir: THREE.Vector3;
  clearDegrees: number;
  maxHeight: number;
}): THREE.BufferGeometry {
  const rng = createRng(options.seed);
  const pos: number[] = [];
  const nor: number[] = [];
  const face: number[] = [];
  const clearAz = Math.atan2(options.clearDir.x, options.clearDir.z);
  for (let i = 0; i < options.count; i += 1) {
    const az = rng() * Math.PI * 2;
    let delta = Math.abs(az - clearAz);
    delta = Math.min(delta, Math.PI * 2 - delta);
    const nearSun = delta < (options.clearDegrees * Math.PI) / 180;
    const r = options.innerRadius + (options.outerRadius - options.innerRadius) * Math.pow(rng(), 0.7);
    const cluster = Math.pow(Math.max(0, Math.cos(az * 2.0 + 0.7)), 3);
    let h = 6 + rng() * 16 + cluster * Math.pow(rng(), 1.5) * options.maxHeight;
    if (nearSun) h = Math.min(h, 6 + rng() * 10);
    const w = 10 + rng() * 30;
    const d = 10 + rng() * 24;
    const b: Building = { x: options.center[0] + Math.sin(az) * r, z: options.center[1] + Math.cos(az) * r, w, d, h, rot: az + (rng() - 0.5) * 0.4 };
    pushBox(b, 1 + rng() * 50, pos, nor, face);
    if (h > 40 && rng() < 0.5) {
      // Setback tower on top.
      pushBox({ ...b, w: w * 0.55, d: d * 0.6, h: h * (0.25 + rng() * 0.3) }, 1 + rng() * 50, pos, nor, face, h);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("aFace", new THREE.Float32BufferAttribute(face, 3));
  g.computeBoundingSphere();
  return g;
}

const CARD_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const CARD_FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform vec3 uDark;
uniform vec3 uLight;
uniform vec3 uRim;
uniform vec3 uHaze;
uniform vec3 uSunDir;
uniform float uHazeDist;
uniform float uRimAmount;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vec4 t = texture2D(uTex, vUv);
  if (t.a < 0.004) discard;
  vec3 col = mix(uDark, uLight, t.r);
  vec3 toCam = normalize(cameraPosition - vWorld);
  float back = pow(max(dot(-toCam, uSunDir), 0.0), 4.0);
  col += uRim * t.g * uRimAmount * (0.12 + back);
  float dist = length(vWorld - cameraPosition);
  float haze = clamp(1.0 - exp(-dist / uHazeDist), 0.0, 0.97);
  haze = clamp(haze + (1.0 - smoothstep(0.0, 0.55, vUv.y)) * 0.18 * (1.0 - haze), 0.0, 0.985);
  col = mix(col, uHaze, haze);
  gl_FragColor = vec4(col, t.a);
}
`;

export interface TreeCardColors {
  dark: number;
  light: number;
  rim: number;
  haze: number;
  rimAmount: number;
}

/** Matte-painting style tree line: transparent cards textured with a baked canopy silhouette. */
export function createTreeCardMaterial(texture: THREE.Texture, hazeDistance: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: CARD_VERT,
    fragmentShader: CARD_FRAG,
    uniforms: {
      uTex: { value: texture },
      uDark: { value: new THREE.Color() },
      uLight: { value: new THREE.Color() },
      uRim: { value: new THREE.Color() },
      uHaze: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uHazeDist: { value: hazeDistance },
      uRimAmount: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
}

export function applyTreeCards(material: THREE.ShaderMaterial, colors: TreeCardColors, sunDir: THREE.Vector3) {
  const u = material.uniforms;
  (u.uDark.value as THREE.Color).setHex(colors.dark);
  (u.uLight.value as THREE.Color).setHex(colors.light);
  (u.uRim.value as THREE.Color).setHex(colors.rim);
  (u.uHaze.value as THREE.Color).setHex(colors.haze);
  u.uRimAmount.value = colors.rimAmount;
  (u.uSunDir.value as THREE.Vector3).copy(sunDir).normalize();
}

/** Vertical cards along a closed polyline of [x, z] points; u runs in tiles of `tileMeters`. */
export function buildTreeCards(path: Array<[number, number]>, height: number, tileMeters: number, uOffset = 0, yBase = -1.5): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let u = uOffset;
  for (let i = 0; i < path.length - 1; i += 1) {
    const [ax, az] = path[i];
    const [bx, bz] = path[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const u1 = u + len / tileMeters;
    const base = pos.length / 3;
    pos.push(ax, yBase, az, bx, yBase, bz, bx, yBase + height, bz, ax, yBase + height, az);
    uv.push(u, 0, u1, 0, u1, 1, u, 1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    u = u1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
