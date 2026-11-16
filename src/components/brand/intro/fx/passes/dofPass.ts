/**
 * Depth of field with real lens behaviour (high tier).
 *
 * Circle of confusion from the thin-lens equation using the camera's actual focal length,
 * film height (36 mm gauge) and an f-number, so a 100 mm macro at f/4 and a 28 mm wide at
 * f/8 behave like the real lenses. Three steps:
 *  1. prefilter: full-res HDR + depth → working-res colour with signed CoC (nearest depth of
 *     each 2×2 block wins, so foreground edges dilate instead of shrinking);
 *  2. gather: golden-angle spiral scatter-as-gather (Gustafsson, "Bokeh depth of field in a
 *     single pass") — round bright bokeh, no background bleeding onto sharper foreground,
 *     blurry foreground spilling over what is behind it;
 *  3. composite at full res: blend sharp ↔ blurred by the per-pixel CoC and the gathered
 *     near-field coverage.
 * The working resolution is half the frame, capped at 540 px tall, so cost stays bounded at
 * high DPR. A tile pass records the largest foreground CoC near each pixel, so in-focus
 * areas stop gathering almost immediately (exact for this gather: background samples can
 * never reach farther than twice the centre's own CoC). Taps are capped (~64) by spacing the
 * spiral for wide blurs.
 */

import * as THREE from "three";
import { FullScreenQuad, Pass } from "three/addons/postprocessing/Pass.js";
import type { PostFrame } from "./scenePass";

const MAX_WORK_HEIGHT = 540;
const SAMPLE_BUDGET = 64;
const TILE = 8;

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const COC_COMMON = /* glsl */ `
#include <packing>
uniform sampler2D tDepth;
uniform float cameraNear;
uniform float cameraFar;
uniform float focusDistance;
uniform float cocScale;
uniform float maxCoc;
uniform float workHeight;

float viewDistance(float depth) {
  return max(1e-4, -perspectiveDepthToViewZ(depth, cameraNear, cameraFar));
}

/** Signed CoC radius in working-resolution pixels: < 0 in front of the focus plane. */
float cocAt(float distance) {
  return clamp(cocScale * (1.0 - focusDistance / distance) * workHeight, -maxCoc, maxCoc);
}`;

const PREFILTER_FRAGMENT = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 sourceTexel;
uniform float footprint;
varying vec2 vUv;
${COC_COMMON}

void main() {
  vec2 o = sourceTexel * footprint * 0.25;
  vec2 uv0 = vUv + vec2(-o.x, -o.y);
  vec2 uv1 = vUv + vec2( o.x, -o.y);
  vec2 uv2 = vUv + vec2(-o.x,  o.y);
  vec2 uv3 = vUv + vec2( o.x,  o.y);
  float z0 = viewDistance(texture2D(tDepth, uv0).x);
  float z1 = viewDistance(texture2D(tDepth, uv1).x);
  float z2 = viewDistance(texture2D(tDepth, uv2).x);
  float z3 = viewDistance(texture2D(tDepth, uv3).x);
  float c0 = cocAt(z0), c1 = cocAt(z1), c2 = cocAt(z2), c3 = cocAt(z3);
  // MSAA resolves colour as an average but depth from one sample, so a silhouette pixel can
  // carry bright foreground colour (rim light) with background depth. Taking the nearest
  // depth over a block dilated by ~1 source pixel files such pixels with the foreground
  // instead of letting the gather smear them across the background as streaks.
  vec2 e = sourceTexel * (footprint * 0.5 + 1.0);
  float zd = min(min(viewDistance(texture2D(tDepth, vUv + vec2(-e.x, -e.y)).x), viewDistance(texture2D(tDepth, vUv + vec2(e.x, -e.y)).x)),
                 min(viewDistance(texture2D(tDepth, vUv + vec2(-e.x, e.y)).x), viewDistance(texture2D(tDepth, vUv + vec2(e.x, e.y)).x)));
  float coc = cocAt(min(min(min(z0, z1), min(z2, z3)), zd));
  // Taps that belong to the representative layer dominate, which limits edge bleeding.
  float w0 = 1.0 / (1.0 + abs(c0 - coc));
  float w1 = 1.0 / (1.0 + abs(c1 - coc));
  float w2 = 1.0 / (1.0 + abs(c2 - coc));
  float w3 = 1.0 / (1.0 + abs(c3 - coc));
  vec3 color = texture2D(tColor, uv0).rgb * w0 + texture2D(tColor, uv1).rgb * w1
    + texture2D(tColor, uv2).rgb * w2 + texture2D(tColor, uv3).rgb * w3;
  color /= (w0 + w1 + w2 + w3);
  // Soft-clamp extreme HDR so one specular pixel cannot smear streaks through the gather;
  // practical lights (≈ 10–30) keep bright bokeh discs.
  float peak = max(color.r, max(color.g, color.b));
  color *= min(1.0, 24.0 / max(peak, 1e-4));
  gl_FragColor = vec4(color, coc);
}`;

const TILE_FRAGMENT = /* glsl */ `
uniform highp sampler2D tPrefilter;
uniform ivec2 workSize;
void main() {
  // Largest foreground (negative) CoC magnitude in this ${TILE}x${TILE} block.
  ivec2 base = ivec2(gl_FragCoord.xy) * ${TILE};
  float nearMax = 0.0;
  for (int j = 0; j < ${TILE}; j++) {
    for (int i = 0; i < ${TILE}; i++) {
      ivec2 p = min(base + ivec2(i, j), workSize - 1);
      nearMax = max(nearMax, -texelFetch(tPrefilter, p, 0).a);
    }
  }
  gl_FragColor = vec4(nearMax, 0.0, 0.0, 1.0);
}`;

const DILATE_FRAGMENT = /* glsl */ `
uniform highp sampler2D tTiles;
uniform ivec2 tileSize;
uniform int reach;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  float nearMax = 0.0;
  for (int j = -4; j <= 4; j++) {
    if (j < -reach || j > reach) continue;
    for (int i = -4; i <= 4; i++) {
      if (i < -reach || i > reach) continue;
      ivec2 p = clamp(c + ivec2(i, j), ivec2(0), tileSize - 1);
      nearMax = max(nearMax, texelFetch(tTiles, p, 0).r);
    }
  }
  gl_FragColor = vec4(nearMax, 0.0, 0.0, 1.0);
}`;

const GATHER_FRAGMENT = /* glsl */ `
uniform sampler2D tPrefilter;
uniform sampler2D tNear;
uniform vec2 texel;
uniform float maxCoc;
uniform float radiusScale;
varying vec2 vUv;

const float GOLDEN_COS = -0.7373688;
const float GOLDEN_SIN = 0.6754903;

void main() {
  vec4 center = texture2D(tPrefilter, vUv);
  float centerCoc = center.a;
  float centerSize = abs(centerCoc);
  // No sample farther than 2x our own CoC can land here, and foreground reach is in the tile.
  float bound = min(maxCoc, max(2.0 * centerSize, texture2D(tNear, vUv).r) + 0.5);
  vec3 color = center.rgb;
  float total = 1.0;
  float cover = centerSize;
  float radius = radiusScale;
  vec2 dir = vec2(1.0, 0.0);
  for (int i = 0; i < 400; i++) {
    if (radius >= bound) break;
    vec4 s = texture2D(tPrefilter, vUv + dir * (radius * texel));
    float sampleSize = abs(s.a);
    // Farther samples may not blur over a sharper centre by more than twice its own CoC.
    if (s.a > centerCoc) sampleSize = min(sampleSize, centerSize * 2.0);
    float m = smoothstep(radius - 0.5, radius + 0.5, sampleSize);
    color += mix(color / total, s.rgb, m);
    total += 1.0;
    // Blurry foreground reaching this pixel: remember how much blur the composite must use.
    if (s.a < centerCoc - 0.5) cover = max(cover, sampleSize * m);
    radius += radiusScale / radius;
    dir = vec2(dir.x * GOLDEN_COS - dir.y * GOLDEN_SIN, dir.x * GOLDEN_SIN + dir.y * GOLDEN_COS);
  }
  gl_FragColor = vec4(color / total, cover);
}`;

const COMPOSITE_FRAGMENT = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tBlur;
uniform vec2 blurTexel;
uniform int debugView;
varying vec2 vUv;
${COC_COMMON}

void main() {
  vec3 sharp = texture2D(tColor, vUv).rgb;
  float coc = abs(cocAt(viewDistance(texture2D(tDepth, vUv).x)));
  // Tent upsample hides the spiral's residual sampling noise.
  vec2 h = blurTexel * 0.5;
  vec4 blur = 0.25 * (texture2D(tBlur, vUv + vec2(-h.x, -h.y)) + texture2D(tBlur, vUv + vec2(h.x, -h.y))
    + texture2D(tBlur, vUv + vec2(-h.x, h.y)) + texture2D(tBlur, vUv + vec2(h.x, h.y)));
  float amount = smoothstep(0.35, 1.25, max(coc, blur.a));
  gl_FragColor = vec4(mix(sharp, blur.rgb, amount), 1.0);
  if (debugView == 1) gl_FragColor = vec4(blur.rgb, 1.0);
  if (debugView == 2) {
    float signedCoc = cocAt(viewDistance(texture2D(tDepth, vUv).x));
    gl_FragColor = vec4(max(signedCoc, 0.0) / maxCoc, amount, max(-signedCoc, 0.0) / maxCoc, 1.0);
  }
}`;

export class DofPass extends Pass {
  camera: THREE.PerspectiveCamera;
  /** Focus distance (m, along the optical axis). */
  focusDistance = 4;
  /** f-number (f/N). */
  fStop = 2.8;
  /** Max CoC radius as a fraction of the frame height. */
  maxBlur = 0.02;
  /** Lab only: 0 = normal, 1 = blurred layer, 2 = CoC (red far, blue near, green blend). */
  debugView = 0;

  private readonly prefilterTarget: THREE.WebGLRenderTarget;
  private readonly tileTarget: THREE.WebGLRenderTarget;
  private readonly nearTarget: THREE.WebGLRenderTarget;
  private readonly gatherTarget: THREE.WebGLRenderTarget;
  private readonly prefilterMaterial: THREE.ShaderMaterial;
  private readonly tileMaterial: THREE.ShaderMaterial;
  private readonly dilateMaterial: THREE.ShaderMaterial;
  private readonly gatherMaterial: THREE.ShaderMaterial;
  private readonly compositeMaterial: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;
  private readonly frame: PostFrame;
  private width = 1;
  private height = 1;
  private workWidth = 1;
  private workHeight = 1;
  private tileWidth = 1;
  private tileHeight = 1;

  constructor(camera: THREE.PerspectiveCamera, depthTexture: THREE.DepthTexture, frame: PostFrame) {
    super();
    this.camera = camera;
    this.frame = frame;
    this.needsSwap = true;
    const options = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter } as const;
    this.prefilterTarget = new THREE.WebGLRenderTarget(1, 1, options);
    this.prefilterTarget.texture.name = "IntroPost.dofPrefilter";
    this.gatherTarget = new THREE.WebGLRenderTarget(1, 1, options);
    this.gatherTarget.texture.name = "IntroPost.dofGather";
    const tileOptions = { type: THREE.HalfFloatType, format: THREE.RedFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter } as const;
    this.tileTarget = new THREE.WebGLRenderTarget(1, 1, tileOptions);
    this.tileTarget.texture.name = "IntroPost.dofTiles";
    this.nearTarget = new THREE.WebGLRenderTarget(1, 1, tileOptions);
    this.nearTarget.texture.name = "IntroPost.dofNear";

    const cocUniforms = () => ({
      tDepth: { value: depthTexture },
      cameraNear: { value: 0.1 },
      cameraFar: { value: 100 },
      focusDistance: { value: 4 },
      cocScale: { value: 0 },
      maxCoc: { value: 8 },
      workHeight: { value: 1 },
    });
    const base = { vertexShader: VERTEX, depthTest: false, depthWrite: false, blending: THREE.NoBlending } as const;
    this.prefilterMaterial = new THREE.ShaderMaterial({
      ...base,
      name: "IntroPost.dofPrefilter",
      uniforms: { ...cocUniforms(), tColor: { value: null }, sourceTexel: { value: new THREE.Vector2() }, footprint: { value: 2 } },
      fragmentShader: PREFILTER_FRAGMENT,
    });
    this.tileMaterial = new THREE.ShaderMaterial({
      ...base,
      name: "IntroPost.dofTiles",
      uniforms: { tPrefilter: { value: this.prefilterTarget.texture }, workSize: { value: new THREE.Vector2() } },
      fragmentShader: TILE_FRAGMENT,
    });
    this.dilateMaterial = new THREE.ShaderMaterial({
      ...base,
      name: "IntroPost.dofDilate",
      uniforms: { tTiles: { value: this.tileTarget.texture }, tileSize: { value: new THREE.Vector2() }, reach: { value: 1 } },
      fragmentShader: DILATE_FRAGMENT,
    });
    this.gatherMaterial = new THREE.ShaderMaterial({
      ...base,
      name: "IntroPost.dofGather",
      uniforms: {
        tPrefilter: { value: this.prefilterTarget.texture },
        tNear: { value: this.nearTarget.texture },
        texel: { value: new THREE.Vector2() },
        maxCoc: { value: 8 },
        radiusScale: { value: 0.5 },
      },
      fragmentShader: GATHER_FRAGMENT,
    });
    this.compositeMaterial = new THREE.ShaderMaterial({
      ...base,
      name: "IntroPost.dofComposite",
      uniforms: { ...cocUniforms(), tColor: { value: null }, tBlur: { value: this.gatherTarget.texture }, blurTexel: { value: new THREE.Vector2() }, debugView: { value: 0 } },
      fragmentShader: COMPOSITE_FRAGMENT,
    });
    this.quad = new FullScreenQuad(this.prefilterMaterial);
  }

  setDepthTexture(depthTexture: THREE.DepthTexture) {
    this.prefilterMaterial.uniforms.tDepth.value = depthTexture;
    this.compositeMaterial.uniforms.tDepth.value = depthTexture;
  }

  override setSize(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    const scale = Math.min(0.5, MAX_WORK_HEIGHT / this.height);
    this.workWidth = Math.max(1, Math.round(this.width * scale));
    this.workHeight = Math.max(1, Math.round(this.height * scale));
    this.prefilterTarget.setSize(this.workWidth, this.workHeight);
    this.gatherTarget.setSize(this.workWidth, this.workHeight);
    this.tileWidth = Math.max(1, Math.ceil(this.workWidth / TILE));
    this.tileHeight = Math.max(1, Math.ceil(this.workHeight / TILE));
    this.tileTarget.setSize(this.tileWidth, this.tileHeight);
    this.nearTarget.setSize(this.tileWidth, this.tileHeight);
  }

  /** Max CoC (working px) for the current settings; the director can skip the pass when it is tiny. */
  maxCocPixels() {
    return Math.max(0.5, this.maxBlur * this.workHeight);
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    const camera = this.camera;
    const focal = camera.getFocalLength();
    const filmHeight = camera.getFilmHeight();
    const focusMm = Math.max(this.focusDistance * 1000, focal * 1.05);
    // Thin lens: CoC diameter on film = f² / (N (S - f)) · |z - S| / z; as a radius in frame heights.
    const cocScale = (focal * focal) / (2 * Math.max(0.5, this.fStop) * (focusMm - focal) * filmHeight);
    const maxCoc = this.maxCocPixels();

    const shared = (material: THREE.ShaderMaterial) => {
      const u = material.uniforms;
      u.cameraNear.value = camera.near;
      u.cameraFar.value = camera.far;
      u.focusDistance.value = focusMm / 1000;
      u.cocScale.value = cocScale;
      u.maxCoc.value = maxCoc;
      u.workHeight.value = this.workHeight;
    };

    const source = this.frame.source ?? readBuffer.texture;
    shared(this.prefilterMaterial);
    const pre = this.prefilterMaterial.uniforms;
    pre.tColor.value = source;
    (pre.sourceTexel.value as THREE.Vector2).set(1 / this.width, 1 / this.height);
    pre.footprint.value = this.height / this.workHeight;
    this.quad.material = this.prefilterMaterial;
    renderer.setRenderTarget(this.prefilterTarget);
    this.quad.render(renderer);

    // ivec2 uniforms: three uploads Vector2 values to ivec2 slots as integers.
    (this.tileMaterial.uniforms.workSize.value as THREE.Vector2).set(this.workWidth, this.workHeight);
    this.quad.material = this.tileMaterial;
    renderer.setRenderTarget(this.tileTarget);
    this.quad.render(renderer);

    const dilate = this.dilateMaterial.uniforms;
    (dilate.tileSize.value as THREE.Vector2).set(this.tileWidth, this.tileHeight);
    dilate.reach.value = Math.min(4, Math.ceil(maxCoc / TILE));
    this.quad.material = this.dilateMaterial;
    renderer.setRenderTarget(this.nearTarget);
    this.quad.render(renderer);

    const gather = this.gatherMaterial.uniforms;
    (gather.texel.value as THREE.Vector2).set(1 / this.workWidth, 1 / this.workHeight);
    gather.maxCoc.value = maxCoc;
    // Spiral spacing so the tap count stays within budget: taps ≈ R² / (2 · spacing).
    gather.radiusScale.value = Math.max(0.5, (maxCoc * maxCoc) / (2 * SAMPLE_BUDGET));
    this.quad.material = this.gatherMaterial;
    renderer.setRenderTarget(this.gatherTarget);
    this.quad.render(renderer);

    shared(this.compositeMaterial);
    const comp = this.compositeMaterial.uniforms;
    comp.tColor.value = source;
    (comp.blurTexel.value as THREE.Vector2).set(1 / this.workWidth, 1 / this.workHeight);
    comp.debugView.value = this.debugView;
    this.quad.material = this.compositeMaterial;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
    this.frame.source = writeBuffer.texture;
  }

  override dispose() {
    this.prefilterTarget.dispose();
    this.tileTarget.dispose();
    this.nearTarget.dispose();
    this.gatherTarget.dispose();
    this.prefilterMaterial.dispose();
    this.tileMaterial.dispose();
    this.dilateMaterial.dispose();
    this.gatherMaterial.dispose();
    this.compositeMaterial.dispose();
    this.quad.dispose();
  }
}
