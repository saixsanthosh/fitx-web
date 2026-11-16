/**
 * Final display-space pass: the colourist's grade plus the camera/film artefacts.
 * Input is the tone-mapped, sRGB-encoded image from the OutputPass. Order:
 *   whip-pan directional blur | lateral chromatic aberration
 *   → lift/gamma/gain → S-curve contrast → saturation → split tone
 *   → optical vignette → additive flash → film grain → fade to a flat colour → dither.
 * Grain is a pure function of the `time` uniform (24 fps grain frames), so seeking renders
 * identical frames. At fade = 1 the output is exactly the fade colour (no grain or dither),
 * so the canvas can hand over seamlessly to the page background.
 */

import * as THREE from "three";
import { FullScreenQuad, Pass } from "three/addons/postprocessing/Pass.js";
import type { GradeParams } from "../grades";

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float pixelRatio;
uniform float aspect;
uniform float time;

uniform vec3 lift;
uniform vec3 gammaInv;
uniform vec3 gain;
uniform float contrast;
uniform float saturation;
uniform vec3 shadowTint;
uniform vec3 highlightTint;
uniform float vignette;
uniform float grain;
uniform float aberration;

uniform vec2 whip;
uniform float whipTaps;
uniform vec3 flashColor;
uniform float flashAmount;
uniform vec3 fadeColor;
uniform float fadeAmount;

varying vec2 vUv;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}

vec3 rand3(uvec3 v) {
  return vec3(pcg3d(v)) * (1.0 / 4294967296.0);
}

/** Soft value-noise grain, triangular distribution in [-1, 1]; .x luma, .y/.z chroma. */
vec3 grainNoise(vec2 p, uint frame) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  uvec2 c = uvec2(ivec2(i) + 4096);
  vec3 a = rand3(uvec3(c, frame));
  vec3 b = rand3(uvec3(c + uvec2(1u, 0u), frame));
  vec3 d = rand3(uvec3(c + uvec2(0u, 1u), frame));
  vec3 e = rand3(uvec3(c + uvec2(1u, 1u), frame));
  vec3 n = mix(mix(a, b, u.x), mix(d, e, u.x), u.y);
  vec3 m = rand3(uvec3(c.yx + 977u, frame + 31u));
  return vec3(n.x + n.y - 1.0, n.z - 0.5, m.x - 0.5);
}

vec3 contrastCurve(vec3 x, float k) {
  // Power S-curve pivoting at display mid-grey; identity at k = 1, never clips.
  const float p = 0.45;
  x = clamp(x, 0.0, 1.0);
  vec3 lo = p * pow(x / p, vec3(k));
  vec3 hi = 1.0 - (1.0 - p) * pow((1.0 - x) / (1.0 - p), vec3(k));
  return mix(lo, hi, step(p, x));
}

vec3 sampleImage(vec2 uv, float jitter) {
  if (whipTaps > 1.5) {
    vec3 sum = vec3(0.0);
    float weight = 0.0;
    for (int i = 0; i < 64; i++) {
      if (float(i) >= whipTaps) break;
      float f = (float(i) + jitter) / whipTaps - 0.5;
      // Near-box shutter with softened ends, so streaks fade out instead of stopping hard.
      float w = 1.0 - 0.65 * smoothstep(0.2, 0.5, abs(f));
      sum += texture2D(tDiffuse, uv + whip * f).rgb * w;
      weight += w;
    }
    return sum / weight;
  }
  if (aberration > 0.0) {
    vec2 fromCenter = uv - 0.5;
    vec2 h = fromCenter * vec2(aspect, 1.0);
    float r2 = dot(h, h) / (0.25 * (aspect * aspect + 1.0));
    vec2 shift = fromCenter * (aberration * 0.005 * r2);
    return vec3(texture2D(tDiffuse, uv + shift).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - shift).b);
  }
  return texture2D(tDiffuse, uv).rgb;
}

void main() {
  uint frame = uint(max(0.0, floor(time * 24.0 + 0.001)));
  uvec2 pixel = uvec2(gl_FragCoord.xy);
  vec3 dither = rand3(uvec3(pixel, frame + 7919u));

  vec3 c = sampleImage(vUv, dither.z);

  // Lift / gamma / gain (ASC-CDL style, lift fades out toward white).
  c = max(c, 0.0);
  c = gain * (c + lift * (1.0 - c));
  c = pow(max(c, 0.0), gammaInv);
  c = contrastCurve(c, contrast);
  float l = dot(c, LUMA);
  c = vec3(l) + (c - vec3(l)) * saturation;
  float shadows = 1.0 - smoothstep(0.0, 0.55, l);
  float highlights = smoothstep(0.45, 1.0, l);
  c += (shadowTint - dot(shadowTint, LUMA)) * shadows + (highlightTint - dot(highlightTint, LUMA)) * highlights;

  // Optical vignette: cos^4-like falloff that follows the frame shape halfway.
  vec2 v = (vUv - 0.5) * vec2(mix(1.0, aspect, 0.5), 1.0);
  float r2 = dot(v, v) / (0.25 * (pow(mix(1.0, aspect, 0.5), 2.0) + 1.0));
  float falloff = 1.0 / pow(1.0 + 0.75 * r2 * r2 + 0.35 * r2, 2.0);
  c *= mix(1.0, falloff, vignette);

  c += flashColor * flashAmount;

  // Grain sized in CSS pixels so it reads the same at every DPR; strongest in the midtones.
  vec3 n = grainNoise(gl_FragCoord.xy / max(1.0, pixelRatio * 0.9), frame);
  float lum = clamp(dot(c, LUMA), 0.0, 1.0);
  float response = mix(0.45, 1.0, 4.0 * lum * (1.0 - lum));
  float amount = grain * 0.055 * response;
  c += amount * (vec3(n.x) + vec3(n.y, -0.5 * (n.y + n.z), n.z) * 0.35);

  c = clamp(c, 0.0, 1.0);
  c = mix(c, fadeColor, fadeAmount);
  c += (dither.x + dither.y - 1.0) * (1.0 / 255.0) * (1.0 - fadeAmount);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

const displayRGB = (hex: number, out: THREE.Vector3) => out.set(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);

export class FilmPass extends Pass {
  /** Seconds; drives the 24 fps grain. */
  time = 0;
  /** Cap on whip-blur taps per pixel; beyond it, per-pixel jitter turns stepping into fine noise. */
  maxWhipTaps = 32;
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;
  private readonly whipVector = new THREE.Vector2();
  private width = 1;
  private height = 1;
  private pixelRatio = 1;

  constructor() {
    super();
    this.material = new THREE.ShaderMaterial({
      name: "IntroPost.film",
      uniforms: {
        tDiffuse: { value: null },
        pixelRatio: { value: 1 },
        aspect: { value: 1 },
        time: { value: 0 },
        lift: { value: new THREE.Vector3() },
        gammaInv: { value: new THREE.Vector3(1, 1, 1) },
        gain: { value: new THREE.Vector3(1, 1, 1) },
        contrast: { value: 1 },
        saturation: { value: 1 },
        shadowTint: { value: new THREE.Vector3() },
        highlightTint: { value: new THREE.Vector3() },
        vignette: { value: 0 },
        grain: { value: 0 },
        aberration: { value: 0 },
        whip: { value: new THREE.Vector2() },
        whipTaps: { value: 1 },
        flashColor: { value: new THREE.Vector3(1, 1, 1) },
        flashAmount: { value: 0 },
        fadeColor: { value: new THREE.Vector3(1, 1, 1) },
        fadeAmount: { value: 0 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  setGrade(grade: GradeParams) {
    const u = this.material.uniforms;
    (u.lift.value as THREE.Vector3).fromArray(grade.lift);
    (u.gammaInv.value as THREE.Vector3).set(1 / Math.max(0.05, grade.gamma[0]), 1 / Math.max(0.05, grade.gamma[1]), 1 / Math.max(0.05, grade.gamma[2]));
    (u.gain.value as THREE.Vector3).fromArray(grade.gain);
    u.contrast.value = Math.max(0.05, grade.contrast);
    u.saturation.value = Math.max(0, grade.saturation);
    (u.shadowTint.value as THREE.Vector3).fromArray(grade.shadowTint);
    (u.highlightTint.value as THREE.Vector3).fromArray(grade.highlightTint);
    u.vignette.value = Math.max(0, Math.min(1, grade.vignette));
    u.grain.value = Math.max(0, grade.grain);
    u.aberration.value = Math.max(0, grade.aberration);
  }

  /** Blur vector in frame heights (x right, y up). */
  setWhip(x: number, y: number) {
    this.whipVector.set(x, y);
  }

  setFlash(hex: number, amount: number) {
    displayRGB(hex, this.material.uniforms.flashColor.value as THREE.Vector3);
    this.material.uniforms.flashAmount.value = Math.max(0, amount);
  }

  setFade(hex: number, amount: number) {
    displayRGB(hex, this.material.uniforms.fadeColor.value as THREE.Vector3);
    this.material.uniforms.fadeAmount.value = Math.max(0, Math.min(1, amount));
  }

  setPixelRatio(pixelRatio: number) {
    this.pixelRatio = pixelRatio;
  }

  override setSize(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    const u = this.material.uniforms;
    const aspect = this.width / this.height;
    u.tDiffuse.value = readBuffer.texture;
    u.pixelRatio.value = this.pixelRatio;
    u.aspect.value = aspect;
    u.time.value = this.time;
    // Frame heights → UV; taps every ~2.5 px up to the cap (jitter + grain hide wider spacing).
    const whip = u.whip.value as THREE.Vector2;
    whip.set(this.whipVector.x / aspect, this.whipVector.y);
    const lengthPx = Math.hypot(whip.x * this.width, whip.y * this.height);
    u.whipTaps.value = lengthPx < 1.5 ? 1 : Math.min(this.maxWhipTaps, Math.ceil(lengthPx / 2.5) + 1);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  override dispose() {
    this.material.dispose();
    this.quad.dispose();
  }
}
