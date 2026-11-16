/**
 * Small, dependency-free math helpers shared by the worker-safe generators and the
 * main-thread director. Keep this file free of `three` and DOM APIs.
 */

import type { LinearRGB } from "./types";

export const clamp = (value: number, min: number, max: number) => (value < min ? min : value > max ? max : value);
export const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, value: number) => (a === b ? 0 : (value - a) / (b - a));
export const remap = (value: number, a0: number, a1: number, b0: number, b1: number) => lerp(b0, b1, invLerp(a0, a1, value));

/** Hermite smoothstep on [edge0, edge1]. */
export const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp01(invLerp(edge0, edge1, value));
  return t * t * (3 - 2 * t);
};

/** Ken Perlin's smootherstep on [0, 1]. */
export const smootherstep01 = (value: number) => {
  const t = clamp01(value);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

export const easeInCubic = (t: number) => clamp01(t) ** 3;
export const easeOutCubic = (t: number) => 1 - (1 - clamp01(t)) ** 3;
export const easeInOutCubic = (t: number) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};
export const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * clamp01(t)));
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * clamp01(t)) - 1) / 2;
/** Overshooting ease-out, `s` ≈ 1.70158 gives the classic back-out. */
export const easeOutBack = (t: number, s = 1.70158) => {
  const x = clamp01(t) - 1;
  return x * x * ((s + 1) * x + s) + 1;
};

/** Frame-rate independent exponential smoothing factor for `lerp(current, target, damp(lambda, dt))`. */
export const damp = (lambda: number, dt: number) => 1 - Math.exp(-lambda * dt);

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** Deterministic 32-bit PRNG (mulberry32). Never use Math.random() for anything that must match between runs. */
export function createRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash → [0, 1). */
export function hash1(n: number) {
  let x = Math.imul(n | 0, 0x27d4eb2d) ^ 0x165667b1;
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function hash3(ix: number, iy: number, iz: number) {
  return hash1(ix * 73856093 ^ iy * 19349663 ^ iz * 83492791);
}

/** Smooth 1D value noise in [-1, 1]. */
export function noise1(x: number, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = hash1(i + seed * 1013) * 2 - 1;
  const b = hash1(i + 1 + seed * 1013) * 2 - 1;
  return a + (b - a) * u;
}

/** Smooth 3D value noise in [-1, 1]. Cheap enough for per-vertex use in generators. */
export function noise3(x: number, y: number, z: number, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const s = seed * 7919;
  const c000 = hash3(ix + s, iy, iz), c100 = hash3(ix + 1 + s, iy, iz);
  const c010 = hash3(ix + s, iy + 1, iz), c110 = hash3(ix + 1 + s, iy + 1, iz);
  const c001 = hash3(ix + s, iy, iz + 1), c101 = hash3(ix + 1 + s, iy, iz + 1);
  const c011 = hash3(ix + s, iy + 1, iz + 1), c111 = hash3(ix + 1 + s, iy + 1, iz + 1);
  const x00 = c000 + (c100 - c000) * ux, x10 = c010 + (c110 - c010) * ux;
  const x01 = c001 + (c101 - c001) * ux, x11 = c011 + (c111 - c011) * ux;
  const y0 = x00 + (x10 - x00) * uy, y1 = x01 + (x11 - x01) * uy;
  return (y0 + (y1 - y0) * uz) * 2 - 1;
}

/** Fractal (fBm) 3D value noise in roughly [-1, 1]. */
export function fbm3(x: number, y: number, z: number, octaves = 4, seed = 0) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o += 1) {
    sum += noise3(x * freq, y * freq, z * freq, seed + o) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

/** sRGB hex (e.g. 0xc44933) → linear RGB, matching three.js `Color.setHex` with ColorManagement enabled. */
export function srgbHexToLinear(hex: number): LinearRGB {
  const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return [toLinear(((hex >> 16) & 255) / 255), toLinear(((hex >> 8) & 255) / 255), toLinear((hex & 255) / 255)];
}

export function mixRGB(a: LinearRGB, b: LinearRGB, t: number): LinearRGB {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
