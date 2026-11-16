/**
 * Cheap, camera-stable atmospherics: floodlight cones, window light shafts, dust motes and haze
 * cards. All are world-space geometry with additive shaders whose only time input is `uTime`, so
 * the look is a pure function of time and never swims when the camera moves.
 */

import * as THREE from "three";
import { createRng } from "../../math";

// ---------------------------------------------------------------- floodlight cones

const CONE_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vWorld;
varying float vAlong;
varying float vAround;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vAlong = 1.0 - uv.y;
  vAround = uv.x;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const CONE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
uniform sampler2D uNoise;
varying vec3 vN;
varying vec3 vWorld;
varying float vAlong;
varying float vAround;
void main() {
  vec3 v = normalize(cameraPosition - vWorld);
  float ndv = clamp(abs(dot(normalize(vN), v)), 0.0, 1.0);
  float vol = pow(ndv, 2.2);
  // max(): interpolation can push vAlong past 1, and pow() of a negative base is NaN (fast-math GPUs).
  float fall = smoothstep(0.0, 0.03, vAlong) * pow(max(1.0 - vAlong, 0.0), 2.6);
  float n = texture2D(uNoise, vec2(vAround * 3.0, vAlong * 1.5 - uTime * 0.01)).r;
  float near = smoothstep(0.5, 6.0, length(cameraPosition - vWorld));
  gl_FragColor = vec4(uColor * uIntensity * vol * fall * (0.55 + 0.9 * n) * near, 1.0);
}
`;

export function createConeMaterial(noise: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: CONE_VERT,
    fragmentShader: CONE_FRAG,
    uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uIntensity: { value: 0 }, uTime: { value: 0 }, uNoise: { value: noise } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
}

/** Open cone from `apex` towards `aim`, `length` long with end radius `radius`. */
export function coneGeometry(apex: THREE.Vector3, aim: THREE.Vector3, length: number, radius: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius * 0.02, radius, length, 32, 1, true);
  g.translate(0, -length / 2, 0);
  const dir = new THREE.Vector3().subVectors(aim, apex).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
  g.applyQuaternion(q);
  g.translate(apex.x, apex.y, apex.z);
  return g;
}

// ---------------------------------------------------------------- window shafts

export interface ShaftWindow {
  /** Window rectangle on the wall plane z = `wallZ`: x0..x1, y0..y1. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Pane grid (columns, rows) and mullion half-width in meters. */
  cols: number;
  rows: number;
  mullion: number;
}

export const MAX_SHAFT_WINDOWS = 4;

const SHAFT_VERT = /* glsl */ `
attribute float aWindow;
varying vec3 vWorld;
flat varying int vWin;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vWin = int(aWindow + 0.5);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

// Back faces are rasterised (works with the camera inside a beam, and objects inside the beam
// occlude it). The entry point is found analytically against the beam's planes, then a short
// march accumulates in-scattered light through the pane/mullion mask projected along the light.
const SHAFT_FRAG = /* glsl */ `
uniform vec3 uLightDir;
uniform float uWallZ;
uniform float uFloorY;
uniform vec4 uRect[${MAX_SHAFT_WINDOWS}];
uniform vec4 uGrid[${MAX_SHAFT_WINDOWS}];
uniform vec4 uPlanes[${MAX_SHAFT_WINDOWS * 6}];
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
uniform sampler2D uNoise;
uniform mat4 uSetMatrixInverse;
varying vec3 vWorld;
flat varying int vWin;

float paneMask(vec2 q, int w, float soft) {
  vec4 r = uRect[w];
  vec4 g = uGrid[w];
  vec2 size = vec2(r.y - r.x, r.w - r.z);
  vec2 local = (q - r.xz) / size;
  float inside = smoothstep(0.0, soft / size.x, local.x) * smoothstep(0.0, soft / size.x, 1.0 - local.x)
    * smoothstep(0.0, soft / size.y, local.y) * smoothstep(0.0, soft / size.y, 1.0 - local.y);
  vec2 cell = local * g.xy;
  vec2 f = fract(cell);
  vec2 m = vec2(g.z) / (size / g.xy);
  vec2 sm = vec2(soft) / (size / g.xy);
  float mx = smoothstep(m.x, m.x + sm.x, f.x) * smoothstep(m.x, m.x + sm.x, 1.0 - f.x);
  float my = smoothstep(m.y, m.y + sm.y, f.y) * smoothstep(m.y, m.y + sm.y, 1.0 - f.y);
  vec2 ci = floor(cell);
  float h = fract(sin(dot(ci + float(w) * 7.0, vec2(12.9898, 78.233))) * 43758.5453);
  float dirt = 0.55 + 0.45 * h;
  dirt = h > 0.9 ? 1.35 : dirt;
  return inside * mx * my * dirt;
}

void main() {
  vec3 ro = (uSetMatrixInverse * vec4(cameraPosition, 1.0)).xyz;
  vec3 pe = (uSetMatrixInverse * vec4(vWorld, 1.0)).xyz;
  vec3 rd = pe - ro;
  float tExit = length(rd);
  rd /= tExit;
  float tEnter = 0.0;
  for (int i = 0; i < 6; i++) {
    vec4 pl = uPlanes[vWin * 6 + i];
    float dn = dot(pl.xyz, rd);
    float s = pl.w - dot(pl.xyz, ro);
    if (dn < -1e-5) tEnter = max(tEnter, s / dn);
  }
  float len = max(tExit - tEnter, 0.0);
  if (len <= 0.0) discard;
  const int STEPS = 10;
  float dt = len / float(STEPS);
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float sum = 0.0;
  vec3 L = uLightDir;
  for (int i = 0; i < STEPS; i++) {
    vec3 p = ro + rd * (tEnter + (float(i) + jitter) * dt);
    float back = (p.z - uWallZ) / L.z;
    vec2 q = p.xy - L.xy * back;
    float soft = 0.006 + 0.01 * back;
    float mask = paneMask(q, vWin, soft);
    float n1 = texture2D(uNoise, q * 0.35 + vec2(0.0, uTime * 0.012)).r;
    float n2 = texture2D(uNoise, vec2(dot(p, vec3(0.7, 0.0, 0.7)), p.y) * 0.25 + uTime * 0.006).g;
    // Contrasty, beam-aligned streaks read as rays rather than a uniform fog.
    float density = (0.12 + 1.25 * n1 * n1) * (0.55 + 0.9 * n2);
    float fade = exp(-back * 0.11) * smoothstep(uFloorY, uFloorY + 0.6, p.y);
    // Thin out the beam right in front of the lens so a camera inside a shaft is not veiled.
    float nearCam = smoothstep(0.4, 2.5, tEnter + (float(i) + jitter) * dt);
    sum += mask * density * fade * nearCam;
  }
  sum *= dt;
  float mu = dot(-rd, L);
  float phase = 0.35 + 0.9 * pow(max(mu, 0.0), 6.0) + 0.5 * pow(max(mu, 0.0), 1.5);
  gl_FragColor = vec4(uColor * uIntensity * sum * phase, 1.0);
}
`;

export interface Shafts {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
}

/**
 * Light shafts entering through windows on the wall plane z = wallZ (light travels along `lightDir`,
 * which must have +Z and -Y components). Geometry is each window's beam clipped at the floor.
 */
export function createShafts(windows: ShaftWindow[], wallZ: number, floorY: number, lightDir: THREE.Vector3, noise: THREE.Texture): Shafts {
  const L = lightDir.clone().normalize();
  const pos: number[] = [];
  const win: number[] = [];
  const rects = Array.from({ length: MAX_SHAFT_WINDOWS }, () => new THREE.Vector4());
  const grids = Array.from({ length: MAX_SHAFT_WINDOWS }, () => new THREE.Vector4());
  const planes = Array.from({ length: MAX_SHAFT_WINDOWS * 6 }, () => new THREE.Vector4(0, 0, 0, 1e6));
  const z0 = wallZ + 0.02;
  const fy = floorY + 0.005;
  windows.slice(0, MAX_SHAFT_WINDOWS).forEach((w, index) => {
    rects[index].set(w.x0, w.x1, w.y0, w.y1);
    grids[index].set(w.cols, w.rows, w.mullion, 0);
    const corners = [
      new THREE.Vector3(w.x0, w.y0, z0),
      new THREE.Vector3(w.x1, w.y0, z0),
      new THREE.Vector3(w.x1, w.y1, z0),
      new THREE.Vector3(w.x0, w.y1, z0),
    ];
    const floor = corners.map((c) => c.clone().addScaledVector(L, (c.y - fy) / -L.y));
    const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => {
      for (const p of [a, b, c, a, c, d]) {
        pos.push(p.x, p.y, p.z);
        win.push(index);
      }
    };
    // Faces (winding irrelevant: rendered double-sided with back faces doing the work).
    quad(corners[0], corners[1], corners[2], corners[3]);
    quad(floor[0], floor[3], floor[2], floor[1]);
    quad(corners[0], floor[0], floor[1], corners[1]);
    quad(corners[1], floor[1], floor[2], corners[2]);
    quad(corners[2], floor[2], floor[3], corners[3]);
    quad(corners[3], floor[3], floor[0], corners[0]);
    // Inside test planes (dot(n, p) <= w).
    const P = (n: THREE.Vector3, p: THREE.Vector3, k: number) => planes[index * 6 + k].set(n.x, n.y, n.z, n.dot(p));
    P(new THREE.Vector3(0, 0, -1), corners[0], 0);
    P(new THREE.Vector3(0, -1, 0), floor[0], 1);
    const len = Math.hypot(L.z, L.x);
    P(new THREE.Vector3(-L.z / len, 0, L.x / len), corners[0], 2);
    P(new THREE.Vector3(L.z / len, 0, -L.x / len), corners[1], 3);
    const lenY = Math.hypot(L.z, L.y);
    P(new THREE.Vector3(0, L.z / lenY, -L.y / lenY), corners[3], 4);
    P(new THREE.Vector3(0, -L.z / lenY, L.y / lenY), corners[0], 5);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aWindow", new THREE.Float32BufferAttribute(win, 1));
  g.computeBoundingSphere();
  const material = new THREE.ShaderMaterial({
    vertexShader: SHAFT_VERT,
    fragmentShader: SHAFT_FRAG,
    uniforms: {
      uLightDir: { value: L },
      uWallZ: { value: wallZ },
      uFloorY: { value: floorY },
      uRect: { value: rects },
      uGrid: { value: grids },
      uPlanes: { value: planes },
      uColor: { value: new THREE.Color(1, 1, 1) },
      uIntensity: { value: 1 },
      uTime: { value: 0 },
      uNoise: { value: noise },
      uSetMatrixInverse: { value: new THREE.Matrix4() },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    // Front faces integrate ~zero length (entry == fragment); back faces carry the beam.
    side: THREE.DoubleSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(g, material);
  mesh.name = "light-shafts";
  mesh.renderOrder = 10;
  mesh.frustumCulled = false;
  mesh.onBeforeRender = () => {
    (material.uniforms.uSetMatrixInverse.value as THREE.Matrix4).copy(mesh.matrixWorld).invert();
  };
  return { mesh, material };
}

// ---------------------------------------------------------------- dust motes

const DUST_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uScale;
uniform vec3 uBoxMin;
uniform vec3 uBoxSize;
uniform vec3 uLightDir;
uniform float uWallZ;
uniform vec4 uRect[${MAX_SHAFT_WINDOWS}];
uniform int uWindows;
varying float vLight;
varying float vAlpha;
void main() {
  vec3 p = position;
  float t = uTime;
  // Slow drift + gentle swirl; wrapped inside the box (faded near the walls of the box).
  p += vec3(0.018, 0.006, 0.011) * t * (0.5 + aSeed.x);
  p += 0.06 * vec3(sin(t * (0.21 + aSeed.y * 0.3) + aSeed.z * 6.28), sin(t * (0.17 + aSeed.x * 0.2) + aSeed.w * 6.28) * 0.6, cos(t * (0.19 + aSeed.z * 0.25) + aSeed.y * 6.28));
  vec3 local = mod(p - uBoxMin, uBoxSize);
  vec3 edge = min(local, uBoxSize - local);
  float boxFade = smoothstep(0.0, 0.35, min(min(edge.x, edge.y), edge.z));
  p = uBoxMin + local;
  float back = (p.z - uWallZ) / uLightDir.z;
  vec2 q = p.xy - uLightDir.xy * back;
  float lit = 0.0;
  for (int i = 0; i < ${MAX_SHAFT_WINDOWS}; i++) {
    if (i >= uWindows) break;
    vec4 r = uRect[i];
    float soft = 0.05;
    lit = max(lit, smoothstep(r.x - soft, r.x + soft, q.x) * smoothstep(r.y + soft, r.y - soft, q.x) * smoothstep(r.z - soft, r.z + soft, q.y) * smoothstep(r.w + soft, r.w - soft, q.y));
  }
  lit *= step(0.0, back);
  vLight = lit;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float size = (0.0011 + 0.0016 * aSeed.w) * uScale / max(-mv.z, 0.05);
  float px = max(size, 1.2);
  vAlpha = boxFade * min(1.0, (size * size) / (px * px) + 0.25) * (0.15 + 0.85 * lit);
  gl_PointSize = min(px, 48.0);
  gl_Position = projectionMatrix * mv;
}
`;

const DUST_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
varying float vLight;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float disc = smoothstep(0.5, 0.15, d);
  float a = disc * vAlpha;
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor * uIntensity * a * (0.2 + 2.6 * vLight), 1.0);
}
`;

export interface Dust {
  points: THREE.Points;
  material: THREE.ShaderMaterial;
}

/** Dust motes filling a box, glowing where they cross the window beams. */
export function createDust(seed: number, count: number, boxMin: THREE.Vector3, boxMax: THREE.Vector3, windows: ShaftWindow[], wallZ: number, lightDir: THREE.Vector3): Dust {
  const rng = createRng(seed);
  const size = new THREE.Vector3().subVectors(boxMax, boxMin);
  const pos = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < count; i += 1) {
    pos[i * 3] = boxMin.x + rng() * size.x;
    pos[i * 3 + 1] = boxMin.y + rng() * size.y;
    pos[i * 3 + 2] = boxMin.z + rng() * size.z;
    for (let k = 0; k < 4; k += 1) seeds[i * 4 + k] = rng();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));
  const rects = Array.from({ length: MAX_SHAFT_WINDOWS }, (_, i) => {
    const w = windows[i];
    return w ? new THREE.Vector4(w.x0, w.x1, w.y0, w.y1) : new THREE.Vector4();
  });
  const material = new THREE.ShaderMaterial({
    vertexShader: DUST_VERT,
    fragmentShader: DUST_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uScale: { value: 800 },
      uBoxMin: { value: boxMin.clone() },
      uBoxSize: { value: size },
      uLightDir: { value: lightDir.clone().normalize() },
      uWallZ: { value: wallZ },
      uRect: { value: rects },
      uWindows: { value: Math.min(windows.length, MAX_SHAFT_WINDOWS) },
      uColor: { value: new THREE.Color(1, 1, 1) },
      uIntensity: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const points = new THREE.Points(g, material);
  points.name = "dust";
  points.frustumCulled = false;
  points.renderOrder = 11;
  const drawSize = new THREE.Vector2();
  points.onBeforeRender = (renderer, _scene, camera) => {
    renderer.getDrawingBufferSize(drawSize);
    const proj = (camera as THREE.PerspectiveCamera).projectionMatrix.elements[5];
    material.uniforms.uScale.value = drawSize.y * 0.5 * proj;
  };
  return { points, material };
}

// ---------------------------------------------------------------- haze cards

const HAZE_VERT = /* glsl */ `
attribute vec4 aCard;
uniform float uTime;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vN;
varying float vSeed;
void main() {
  vUv = uv;
  vSeed = aCard.x;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const HAZE_FRAG = /* glsl */ `
uniform sampler2D uHaze;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
uniform float uFloorY;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vN;
varying float vSeed;
void main() {
  vec2 drift = vec2(uTime * (0.006 + vSeed * 0.006), sin(uTime * 0.05 + vSeed * 6.0) * 0.01);
  float a = texture2D(uHaze, vUv * vec2(1.3, 0.8) + vSeed * 3.1 + drift).a;
  float b = texture2D(uHaze, vUv * vec2(0.7, 0.5) + vSeed * 1.7 - drift * 0.7).a;
  // Feathered borders computed from the card UVs so no edge can ever show.
  float edge = smoothstep(0.0, 0.3, vUv.x) * smoothstep(0.0, 0.3, 1.0 - vUv.x) * smoothstep(0.0, 0.35, vUv.y) * smoothstep(0.0, 0.35, 1.0 - vUv.y);
  vec3 v = cameraPosition - vWorld;
  float dist = length(v);
  float facing = abs(dot(normalize(vN), v / dist));
  float near = smoothstep(0.8, 3.0, dist);
  float floorFade = smoothstep(uFloorY, uFloorY + 0.5, vWorld.y);
  float alpha = (a * 0.65 + b * 0.45) * edge * facing * near * floorFade;
  gl_FragColor = vec4(uColor * uIntensity * alpha, 1.0);
}
`;

export interface HazeCards {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
}

/** Vertical haze cards facing +Z (towards a camera looking -Z), placed by the caller. */
export function createHazeCards(seed: number, cards: Array<{ center: [number, number, number]; size: [number, number]; yaw?: number }>, hazeTexture: THREE.Texture, floorY = 0): HazeCards {
  const rng = createRng(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (const card of cards) {
    const g = new THREE.PlaneGeometry(card.size[0], card.size[1]);
    const s = rng();
    const count = g.attributes.position.count;
    g.setAttribute("aCard", new THREE.BufferAttribute(new Float32Array(Array.from({ length: count * 4 }, (_, k) => (k % 4 === 0 ? s : 0))), 4));
    g.rotateY(card.yaw ?? 0);
    g.translate(card.center[0], card.center[1], card.center[2]);
    parts.push(g);
  }
  const merged = new THREE.BufferGeometry();
  // Manual merge (PlaneGeometry parts share layout).
  const position: number[] = [];
  const normal: number[] = [];
  const uv: number[] = [];
  const aCard: number[] = [];
  const index: number[] = [];
  let offset = 0;
  for (const g of parts) {
    position.push(...(g.attributes.position.array as Float32Array));
    normal.push(...(g.attributes.normal.array as Float32Array));
    uv.push(...(g.attributes.uv.array as Float32Array));
    aCard.push(...(g.attributes.aCard.array as Float32Array));
    const idx = g.index ? Array.from(g.index.array) : [];
    index.push(...idx.map((i) => i + offset));
    offset += g.attributes.position.count;
    g.dispose();
  }
  merged.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  merged.setAttribute("normal", new THREE.Float32BufferAttribute(normal, 3));
  merged.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  merged.setAttribute("aCard", new THREE.Float32BufferAttribute(aCard, 4));
  merged.setIndex(index);
  merged.computeBoundingSphere();
  const material = new THREE.ShaderMaterial({
    vertexShader: HAZE_VERT,
    fragmentShader: HAZE_FRAG,
    uniforms: {
      uHaze: { value: hazeTexture },
      uColor: { value: new THREE.Color(1, 1, 1) },
      uIntensity: { value: 0.3 },
      uTime: { value: 0 },
      uFloorY: { value: floorY },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(merged, material);
  mesh.name = "haze-cards";
  mesh.renderOrder = 12;
  return { mesh, material };
}
