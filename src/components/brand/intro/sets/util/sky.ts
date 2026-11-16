/**
 * Procedural sky dome: gradient, horizon haze, low sun (disc + layered glow), wispy clouds, stars
 * and light-pollution glow. Rendered at the far plane (xyww), so it never depends on the camera's
 * far distance and always sits behind the set. Also used inside env scenes, so reflections and IBL
 * match what the camera sees.
 */

import * as THREE from "three";

export interface SkyParams {
  /** Unit direction towards the sun (or the key "light" at night). */
  sunDir: THREE.Vector3;
  zenith: number;
  horizon: number;
  /** Horizon colour on the sun's azimuth (sunrise warmth). */
  horizonWarm: number;
  ground: number;
  sunColor: number;
  /** HDR multiplier of the sun disc (0 hides it). */
  sunDisc: number;
  /** Angular radius of the disc, radians. */
  sunRadius: number;
  /** Strength of the glow around the sun. */
  glow: number;
  /** Cloud coverage 0..1 and colours (lit side, shadow side). */
  clouds: number;
  cloudLit: number;
  cloudShade: number;
  /** 0..1 star field strength. */
  stars: number;
  /** Light pollution (city / stadium) glow near the horizon. */
  pollutionColor: number;
  pollution: number;
  pollutionDir: THREE.Vector3;
  /** Overall multiplier (keeps the sky in a sensible range against the tone mapper). */
  exposure: number;
}

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * vDir * 10.0, 1.0);
  gl_Position = p.xyww;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uHorizonWarm;
uniform vec3 uGround;
uniform vec3 uSunColor;
uniform float uSunDisc;
uniform float uSunCos;
uniform float uGlow;
uniform float uClouds;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uStars;
uniform vec3 uPollutionColor;
uniform float uPollution;
uniform vec3 uPollutionDir;
uniform float uExposure;
uniform float uTime;
uniform sampler2D uNoise;
varying vec3 vDir;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

vec3 stars(vec3 d) {
  // Cells on a lat/long grid; one candidate star per cell.
  float lon = atan(d.z, d.x);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  vec2 g = vec2(lon * 120.0, lat * 120.0);
  vec2 cell = floor(g);
  vec2 f = fract(g);
  float h = hash13(vec3(cell, 7.0));
  if (h < 0.93) return vec3(0.0);
  vec2 pos = vec2(hash13(vec3(cell, 13.0)), hash13(vec3(cell, 29.0))) * 0.7 + 0.15;
  float dist = length((f - pos) * vec2(cos(lat), 1.0));
  float b = pow(hash13(vec3(cell, 41.0)), 6.0);
  float tw = 0.75 + 0.25 * sin(uTime * (1.5 + 3.0 * h) + h * 40.0);
  float core = exp(-dist * dist * 900.0);
  vec3 tint = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.9, 0.78), hash13(vec3(cell, 3.0)));
  return tint * core * (0.4 + 6.0 * b) * tw;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec2 hz = normalize(d.xz + vec2(1e-5));
  vec2 sz = normalize(uSunDir.xz + vec2(1e-5));
  float az = clamp(dot(hz, sz) * 0.5 + 0.5, 0.0, 1.0);
  float up = clamp(h, 0.0, 1.0);
  // Rayleigh-like blue gradient (pale at the horizon), then a warm low band that is strongest on
  // the sun's azimuth. Additive-style layering avoids the muddy mauve of a straight orange→blue mix.
  vec3 col = mix(uHorizon, uZenith, pow(smoothstep(0.0, 1.0, up), 0.5));
  float warmBand = exp(-up * 7.5) * (0.22 + 0.78 * pow(az, 3.0));
  col = mix(col, uHorizonWarm, clamp(warmBand, 0.0, 1.0) * 0.88);
  col += uHorizonWarm * exp(-up * 40.0) * pow(az, 6.0) * 0.25;

  // Wispy clouds on a virtual plane above the horizon.
  if (uClouds > 0.0 && h > -0.02) {
    vec2 cuv = d.xz / (h + 0.06);
    float n1 = texture2D(uNoise, cuv * vec2(0.022, 0.05) + vec2(uTime * 0.0012, 0.0)).r;
    float n2 = texture2D(uNoise, cuv * vec2(0.012, 0.035) + vec2(0.31, uTime * 0.0008)).g;
    float n3 = texture2D(uNoise, cuv * 0.09 + vec2(0.7, 0.2)).b;
    float c = smoothstep(0.5 - uClouds * 0.16, 0.74, n1 * 0.55 + n2 * 0.55 + (n3 - 0.5) * 0.25);
    c *= smoothstep(-0.01, 0.05, h) * (1.0 - smoothstep(0.18, 0.55, h));
    float lit = pow(az, 4.0);
    vec3 cc = mix(uCloudShade, uCloudLit, lit);
    // Silver lining near the sun.
    cc += uSunColor * pow(max(dot(d, uSunDir), 0.0), 24.0) * uGlow * 0.8;
    col = mix(col, cc, c * 0.8);
  }

  float mu = dot(d, uSunDir);
  float m = max(mu, 0.0);
  float glow = pow(m, 10.0) * 0.07 + pow(m, 90.0) * 0.5 + pow(m, 1400.0) * 3.0;
  // Low sun: extra glow spread along the horizon around its azimuth.
  float horizonGlow = pow(az, 18.0) * exp(-up * 9.0) * 0.25;
  col += uSunColor * (glow + horizonGlow) * uGlow * (0.4 + 0.6 * smoothstep(-0.05, 0.08, h));
  float disc = smoothstep(uSunCos - 0.000015, uSunCos + 0.000015, mu);
  col += uSunColor * disc * uSunDisc * smoothstep(-0.01, 0.004, h);

  if (uStars > 0.0) col += stars(d) * uStars * smoothstep(0.02, 0.25, h);
  vec2 pd = normalize(uPollutionDir.xz + vec2(1e-5));
  col += uPollutionColor * uPollution * exp(-up * 9.0) * (0.45 + 0.55 * pow(max(dot(hz, pd), 0.0), 2.0));

  col = mix(col, uGround, smoothstep(0.0, -0.06, h));
  gl_FragColor = vec4(col * uExposure, 1.0);
}
`;

export function createSkyMaterial(noise: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uHorizonWarm: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() },
      uSunDisc: { value: 0 },
      uSunCos: { value: 0.9999 },
      uGlow: { value: 0 },
      uClouds: { value: 0 },
      uCloudLit: { value: new THREE.Color() },
      uCloudShade: { value: new THREE.Color() },
      uStars: { value: 0 },
      uPollutionColor: { value: new THREE.Color() },
      uPollution: { value: 0 },
      uPollutionDir: { value: new THREE.Vector3(1, 0, 0) },
      uExposure: { value: 1 },
      uTime: { value: 0 },
      uNoise: { value: noise },
    },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: true,
  });
}

export function applySky(material: THREE.ShaderMaterial, p: SkyParams) {
  const u = material.uniforms;
  (u.uSunDir.value as THREE.Vector3).copy(p.sunDir).normalize();
  (u.uZenith.value as THREE.Color).setHex(p.zenith);
  (u.uHorizon.value as THREE.Color).setHex(p.horizon);
  (u.uHorizonWarm.value as THREE.Color).setHex(p.horizonWarm);
  (u.uGround.value as THREE.Color).setHex(p.ground);
  (u.uSunColor.value as THREE.Color).setHex(p.sunColor);
  u.uSunDisc.value = p.sunDisc;
  u.uSunCos.value = Math.cos(p.sunRadius);
  u.uGlow.value = p.glow;
  u.uClouds.value = p.clouds;
  (u.uCloudLit.value as THREE.Color).setHex(p.cloudLit);
  (u.uCloudShade.value as THREE.Color).setHex(p.cloudShade);
  u.uStars.value = p.stars;
  (u.uPollutionColor.value as THREE.Color).setHex(p.pollutionColor);
  u.uPollution.value = p.pollution;
  (u.uPollutionDir.value as THREE.Vector3).copy(p.pollutionDir);
  u.uExposure.value = p.exposure;
}

/** Sky dome mesh (any radius works: the shader projects it to the far plane). */
export function createSkyDome(material: THREE.ShaderMaterial): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), material);
  mesh.name = "sky";
  mesh.frustumCulled = false;
  mesh.renderOrder = 1000;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/** Direction from azimuth (degrees, 0 = +Z, 90 = +X) and elevation (degrees). */
export function dirFromAngles(azimuthDeg: number, elevationDeg: number): THREE.Vector3 {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}
