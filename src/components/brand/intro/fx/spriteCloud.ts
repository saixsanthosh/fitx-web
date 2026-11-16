/**
 * Seekable cloud of lit, soft billboard sprites (main thread). Internal engine behind the
 * chalk, dust and grit-dust bursts.
 *
 * Every particle's state is a closed-form function of its age — linear drag toward a
 * per-particle drift velocity, size growth, spin, fade, plus a divergence-free ABC-flow
 * displacement for curl-like turbulence — so `evaluate(age)` can jump to any time with no
 * history. Sprites are sorted back-to-front at render time (premultiplied "over" blending),
 * shaded as soft spheres with wrap lighting, a Henyey-Greenstein forward-scattering lobe
 * (chalk glows when backlit by a shaft), cloud-scale self shadowing, scene fog, and fade
 * against the floor plane and the near camera so nothing shows a hard intersection.
 */

import * as THREE from "three";
import { ATLAS_CELLS } from "./textures";

export interface SpriteLight {
  /** World-space direction *toward* the light. */
  direction: THREE.Vector3;
  /** sRGB hex. */
  color: number;
  /** Same units as the rig's lights (DirectionalLight / SpotLight intensity). */
  intensity: number;
}

export interface SpriteLook {
  light: SpriteLight;
  ambient: { color: number; intensity: number };
  /** Henyey-Greenstein asymmetry: 0 isotropic, 0.4–0.7 strong forward glow when backlit. */
  phaseG: number;
  /** How much the sprites occlude what is behind them (0 = purely additive, 1 = opaque). */
  absorb: number;
  /** World Y of the floor plane for the soft-intersection fade (-Infinity = none). */
  floorY: number;
  floorSoftness: number;
  /** Sprites fade out closer than this to the camera (m). */
  nearFade: number;
  /** Sphere-normal strength of each puff (0 = flat cards, 1 = balls). */
  roundness: number;
}

/** Per-particle constants in world-aligned axes (filled by a burst on trigger). */
export class SpriteDefs {
  readonly capacity: number;
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  /** Terminal drift velocity (buoyancy, settling, wind), m/s. */
  readonly dx: Float32Array;
  readonly dy: Float32Array;
  readonly dz: Float32Array;
  /** Linear drag rate (1/s). */
  readonly drag: Float32Array;
  readonly delay: Float32Array;
  readonly life: Float32Array;
  readonly size0: Float32Array;
  readonly size1: Float32Array;
  /** Size growth rate (1/s). */
  readonly growth: Float32Array;
  readonly rot0: Float32Array;
  readonly spin: Float32Array;
  readonly alpha: Float32Array;
  readonly fadeIn: Float32Array;
  readonly cell: Float32Array;
  readonly tintR: Float32Array;
  readonly tintG: Float32Array;
  readonly tintB: Float32Array;
  /** Turbulent displacement amplitude (m). */
  readonly turb: Float32Array;

  constructor(capacity: number) {
    this.capacity = capacity;
    const make = () => new Float32Array(capacity);
    this.px = make(); this.py = make(); this.pz = make();
    this.vx = make(); this.vy = make(); this.vz = make();
    this.dx = make(); this.dy = make(); this.dz = make();
    this.drag = make(); this.delay = make(); this.life = make();
    this.size0 = make(); this.size1 = make(); this.growth = make();
    this.rot0 = make(); this.spin = make(); this.alpha = make(); this.fadeIn = make();
    this.cell = make(); this.tintR = make(); this.tintG = make(); this.tintB = make();
    this.turb = make();
  }
}

const VERTEX = /* glsl */ `
// Per-sprite state lives in a float texture (rows: centre+size, rotation/alpha/cell/side,
// tint) fetched by instance id. Textures upload when bound inside the draw call, so state
// sorted in onBeforeRender is drawn the same frame (instanced attributes would lag a frame).
uniform highp sampler2D stateTex;

varying vec2 vUv;
varying vec2 vQuad;
varying float vAlpha;
varying vec4 vShade;
varying float vWorldY;
varying vec3 vViewPos;

#include <fog_pars_vertex>

vec2 atlasUv(float cell, vec2 local) {
  float cx = mod(cell, ${ATLAS_CELLS.toFixed(1)});
  float cy = floor(cell / ${ATLAS_CELLS.toFixed(1)} + 0.001);
  return vec2((cx + local.x) / ${ATLAS_CELLS.toFixed(1)}, 1.0 - (cy + 1.0 - local.y) / ${ATLAS_CELLS.toFixed(1)});
}

void main() {
  vec4 s0 = texelFetch(stateTex, ivec2(gl_InstanceID, 0), 0);
  vec4 s1 = texelFetch(stateTex, ivec2(gl_InstanceID, 1), 0);
  vec4 s2 = texelFetch(stateTex, ivec2(gl_InstanceID, 2), 0);
  vec3 aCenter = s0.xyz;
  vec2 corner = position.xy * 2.0;
  float c = cos(s1.x);
  float s = sin(s1.x);
  vec2 rotated = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y);
  float halfSize = s0.w * 0.5;
  vec4 mvPosition = modelViewMatrix * vec4(aCenter, 1.0);
  mvPosition.xy += rotated * halfSize;
  vViewPos = mvPosition.xyz;
  // World height of this corner (camera right/up are the view matrix rows).
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vWorldY = (modelMatrix * vec4(aCenter, 1.0)).y + (right.y * rotated.x + up.y * rotated.y) * halfSize;
  vUv = atlasUv(s1.z, position.xy + 0.5);
  vQuad = rotated;
  vAlpha = s1.y;
  vShade = vec4(s2.rgb, s1.w);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D map;
uniform vec3 lightDirView;
uniform vec3 lightColor;
uniform vec3 ambientColor;
uniform float phaseG;
uniform float absorb;
uniform float floorY;
uniform float floorSoftness;
uniform float nearFade;
uniform float roundness;

varying vec2 vUv;
varying vec2 vQuad;
varying float vAlpha;
varying vec4 vShade;
varying float vWorldY;
varying vec3 vViewPos;

#include <fog_pars_fragment>

void main() {
  float density = texture2D(map, vUv).a * vAlpha;
  density *= smoothstep(floorY, floorY + floorSoftness, vWorldY);
  density *= smoothstep(nearFade * 0.35, nearFade, -vViewPos.z);
  if (density < 0.002) discard;

  float r2 = min(1.0, dot(vQuad, vQuad));
  vec3 normal = normalize(vec3(vQuad * roundness, sqrt(1.0 - r2) + 0.35));
  // Reflected light: wrap lighting on a soft sphere (light leaks round a translucent puff).
  float diffuse = clamp((dot(normal, lightDirView) + 0.6) / 1.6, 0.0, 1.0);
  // Transmitted light: the part of the Henyey-Greenstein lobe above isotropic. It is not
  // gated by N.L (a backlit puff glows through), and thin puff edges transmit the most.
  float cosTheta = dot(normalize(vViewPos), lightDirView);
  float g = phaseG;
  float denom = 1.0 + g * g - 2.0 * g * cosTheta;
  float forward = max(0.0, (1.0 - g * g) / (denom * sqrt(denom)) - 1.0);
  float transmit = forward * mix(0.55, 1.0, r2);
  // Cloud-scale self shadowing: sprites on the far side of the cloud from the light get less.
  float shadow = mix(0.25, 1.0, vShade.w);
  vec3 color = vShade.rgb * (ambientColor + lightColor * (diffuse + transmit) * shadow);

  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    color = mix(color, fogColor, fogFactor);
  #endif

  // Premultiplied: emitted light scales with density, occlusion with density * absorb.
  gl_FragColor = vec4(color * density, density * absorb);
}`;

const _view = new THREE.Vector3();
const _linear = new THREE.Color();

/** Divergence-free ABC flow (Arnold–Beltrami–Childress) at p; writes into out. */
function abc(x: number, y: number, z: number, out: Float32Array, offset: number, scale: number) {
  const A = 1;
  const B = 0.82;
  const C = 0.57;
  out[offset] += scale * (A * Math.sin(z) + C * Math.cos(y));
  out[offset + 1] += scale * (B * Math.sin(x) + A * Math.cos(z));
  out[offset + 2] += scale * (C * Math.sin(y) + B * Math.cos(x));
}

export class SpriteCloud {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  readonly defs: SpriteDefs;
  readonly origin = new THREE.Vector3();
  /** Turbulence field frequency (1/m) and evolution speed. */
  turbulenceFrequency = 9;
  turbulenceSpeed = 0.6;
  private scale = 1;
  private live = 0;
  private readonly look: SpriteLook;
  private readonly lightDirection = new THREE.Vector3();
  // Unsorted per-particle state for the current time.
  private readonly state: Float32Array;
  private readonly alive: Uint8Array;
  private readonly order: Uint32Array;
  private readonly keys: Float32Array;
  private readonly stateTexture: THREE.DataTexture;

  constructor(capacity: number, texture: THREE.Texture, look: SpriteLook, name: string) {
    this.defs = new SpriteDefs(capacity);
    this.look = { ...look, light: { ...look.light, direction: look.light.direction.clone() }, ambient: { ...look.ambient } };
    this.state = new Float32Array(capacity * 11);
    this.alive = new Uint8Array(capacity);
    this.order = new Uint32Array(capacity);
    this.keys = new Float32Array(capacity);

    const geometry = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geometry.index = quad.index;
    geometry.setAttribute("position", quad.getAttribute("position"));
    geometry.setAttribute("uv", quad.getAttribute("uv"));
    geometry.instanceCount = 0;
    quad.dispose();
    this.stateTexture = new THREE.DataTexture(new Float32Array(Math.max(1, capacity) * 3 * 4), Math.max(1, capacity), 3, THREE.RGBAFormat, THREE.FloatType);
    this.stateTexture.minFilter = THREE.NearestFilter;
    this.stateTexture.magFilter = THREE.NearestFilter;
    this.stateTexture.generateMipmaps = false;
    this.stateTexture.name = `${name}.state`;
    this.stateTexture.needsUpdate = true;

    const material = new THREE.ShaderMaterial({
      name,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          map: { value: texture },
          stateTex: { value: null },
          lightDirView: { value: new THREE.Vector3(0, 1, 0) },
          lightColor: { value: new THREE.Color() },
          ambientColor: { value: new THREE.Color() },
          phaseG: { value: 0.4 },
          absorb: { value: 0.5 },
          floorY: { value: -1e6 },
          floorSoftness: { value: 0.05 },
          nearFade: { value: 0.2 },
          roundness: { value: 0.8 },
        },
      ]),
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    // UniformsUtils.merge clones texture uniforms; point them back at the shared instances.
    material.uniforms.map.value = texture;
    material.uniforms.stateTex.value = this.stateTexture;

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
    this.mesh.onBeforeRender = (_renderer, _scene, camera) => this.pack(camera);
    this.applyLook();
  }

  get count() {
    return Math.max(0, Math.min(this.defs.capacity, Math.round(this.defs.capacity * this.scale)));
  }

  setScale(scale: number) {
    this.scale = Math.max(0, Math.min(1, scale));
  }

  setLight(direction: THREE.Vector3, color: number, intensity: number) {
    this.look.light.direction.copy(direction);
    this.look.light.color = color;
    this.look.light.intensity = intensity;
    this.applyLook();
  }

  setAmbient(color: number, intensity: number) {
    this.look.ambient.color = color;
    this.look.ambient.intensity = intensity;
    this.applyLook();
  }

  setFloor(floorY: number, softness = this.look.floorSoftness) {
    this.look.floorY = floorY;
    this.look.floorSoftness = softness;
    this.applyLook();
  }

  private applyLook() {
    const u = this.mesh.material.uniforms;
    const look = this.look;
    this.lightDirection.copy(look.light.direction).normalize();
    // Lambert-matched units: three's diffuse BRDF is albedo / π.
    (u.lightColor.value as THREE.Color).copy(_linear.setHex(look.light.color)).multiplyScalar(look.light.intensity / Math.PI);
    (u.ambientColor.value as THREE.Color).copy(_linear.setHex(look.ambient.color)).multiplyScalar(look.ambient.intensity / Math.PI);
    u.phaseG.value = look.phaseG;
    u.absorb.value = look.absorb;
    u.floorY.value = Number.isFinite(look.floorY) ? look.floorY : -1e6;
    u.floorSoftness.value = Math.max(1e-3, look.floorSoftness);
    u.nearFade.value = look.nearFade;
    u.roundness.value = look.roundness;
  }

  /** Last particle's fade-out time after the trigger. */
  duration() {
    const defs = this.defs;
    let end = 0;
    for (let i = 0; i < this.count; i += 1) end = Math.max(end, defs.delay[i] + defs.life[i]);
    return end;
  }

  /** Computes every particle at `age` seconds after the trigger (negative = not yet). */
  evaluate(age: number) {
    const defs = this.defs;
    const state = this.state;
    const n = this.count;
    const frequency = this.turbulenceFrequency;
    const speed = this.turbulenceSpeed;
    let live = 0;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let weight = 0;
    for (let i = 0; i < n; i += 1) {
      const a = age - defs.delay[i];
      const life = defs.life[i];
      if (a < 0 || a >= life) {
        this.alive[i] = 0;
        continue;
      }
      const k = defs.drag[i];
      const e = Math.exp(-k * a);
      const glide = k > 1e-4 ? (1 - e) / k : a;
      const settle = a - glide;
      let x = defs.px[i] + defs.vx[i] * glide + defs.dx[i] * settle;
      let y = defs.py[i] + defs.vy[i] * glide + defs.dy[i] * settle;
      let z = defs.pz[i] + defs.vz[i] * glide + defs.dz[i] * settle;
      const o = i * 11;
      state[o] = 0;
      state[o + 1] = 0;
      state[o + 2] = 0;
      const amplitude = defs.turb[i] * (1 - Math.exp(-a * 2.2));
      if (amplitude > 0) {
        const phase = a * speed;
        abc(x * frequency + phase, y * frequency + phase * 0.7, z * frequency - phase * 0.4, state, o, amplitude * 0.62);
        abc(z * frequency * 2.3 + 1.7 - phase, x * frequency * 2.3 + 0.4, y * frequency * 2.3 + phase, state, o, amplitude * 0.3);
      }
      x += state[o];
      y += state[o + 1];
      z += state[o + 2];
      const t = a / life;
      const fadeOut = Math.max(0, 1 - t ** 1.6);
      const fadeIn = defs.fadeIn[i] > 0 ? Math.min(1, a / defs.fadeIn[i]) : 1;
      const alpha = defs.alpha[i] * fadeIn * fadeIn * (3 - 2 * fadeIn) * fadeOut * fadeOut;
      const size = defs.size0[i] + (defs.size1[i] - defs.size0[i]) * (1 - Math.exp(-a * defs.growth[i]));
      const rotation = defs.rot0[i] + defs.spin[i] * (1 - Math.exp(-a * 1.4)) / 1.4;
      state[o] = this.origin.x + x;
      state[o + 1] = this.origin.y + y;
      state[o + 2] = this.origin.z + z;
      state[o + 3] = size;
      state[o + 4] = rotation;
      state[o + 5] = alpha;
      state[o + 6] = defs.cell[i];
      state[o + 7] = defs.tintR[i];
      state[o + 8] = defs.tintG[i];
      state[o + 9] = defs.tintB[i];
      this.alive[i] = 1;
      live += 1;
      cx += state[o] * alpha;
      cy += state[o + 1] * alpha;
      cz += state[o + 2] * alpha;
      weight += alpha;
    }
    // Cloud-scale lighting: which side of the cloud each sprite sits on relative to the light.
    if (weight > 0) {
      cx /= weight;
      cy /= weight;
      cz /= weight;
    }
    const L = this.lightDirection;
    let spread = 1e-4;
    for (let i = 0; i < n; i += 1) {
      if (!this.alive[i]) continue;
      const o = i * 11;
      spread = Math.max(spread, Math.hypot(state[o] - cx, state[o + 1] - cy, state[o + 2] - cz));
    }
    for (let i = 0; i < n; i += 1) {
      if (!this.alive[i]) continue;
      const o = i * 11;
      const side = ((state[o] - cx) * L.x + (state[o + 1] - cy) * L.y + (state[o + 2] - cz) * L.z) / spread;
      state[o + 10] = Math.min(1, Math.max(0, 0.55 + 0.6 * side));
    }
    this.live = live;
    this.mesh.visible = live > 0;
    return live;
  }

  /** Sorts live sprites back-to-front for this camera and uploads them. */
  private pack(camera: THREE.Camera) {
    const n = this.count;
    const state = this.state;
    const view = camera.matrixWorldInverse;
    const world = this.mesh.matrixWorld;
    let m = 0;
    for (let i = 0; i < n; i += 1) {
      if (!this.alive[i]) continue;
      const o = i * 11;
      _view.set(state[o], state[o + 1], state[o + 2]).applyMatrix4(world).applyMatrix4(view);
      this.order[m] = i;
      this.keys[i] = _view.z;
      m += 1;
    }
    const keys = this.keys;
    // Most negative view z is farthest: draw it first.
    this.order.subarray(0, m).sort((a, b) => keys[a] - keys[b]);
    const data = this.stateTexture.image.data as Float32Array;
    const row = this.defs.capacity * 4;
    for (let j = 0; j < m; j += 1) {
      const o = this.order[j] * 11;
      const a = j * 4;
      data[a] = state[o];
      data[a + 1] = state[o + 1];
      data[a + 2] = state[o + 2];
      data[a + 3] = state[o + 3];
      data[row + a] = state[o + 4];
      data[row + a + 1] = state[o + 5];
      data[row + a + 2] = state[o + 6];
      data[row + a + 3] = state[o + 10];
      data[2 * row + a] = state[o + 7];
      data[2 * row + a + 1] = state[o + 8];
      data[2 * row + a + 2] = state[o + 9];
      data[2 * row + a + 3] = 1;
    }
    this.stateTexture.needsUpdate = true;
    this.mesh.material.uniformsNeedUpdate = true;
    this.mesh.geometry.instanceCount = m;
    // View-space light direction for the sphere-normal shading.
    const lightView = this.mesh.material.uniforms.lightDirView.value as THREE.Vector3;
    lightView.copy(this.lightDirection).transformDirection(view);
  }

  /** Number of sprites alive at the last `evaluate`. */
  get liveCount() {
    return this.live;
  }

  hide() {
    this.alive.fill(0);
    this.live = 0;
    this.mesh.visible = false;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.stateTexture.dispose();
  }
}
