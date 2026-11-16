/**
 * UnrealBloomPass tuned for film:
 * - runs at a working size normalised to a 720 px tall frame (half of that for the first
 *   mip), so the glow has the same screen-space size at every DPR / resolution and its cost
 *   stays flat on Retina screens;
 * - replaces the hard luminosity high-pass with a soft-knee threshold over a footprint-aware
 *   4-tap Karis-weighted box, so sub-pixel speculars do not sparkle when the source is
 *   downsampled by more than 2×;
 * - tints the wide mips slightly warm, a gentle nod to film halation around hot highlights;
 * - stops after compositing its mips: the output pass adds `texture × strength` while it
 *   tone-maps, which saves UnrealBloomPass's full-resolution read-modify-write blend.
 */

import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import type { PostFrame } from "./scenePass";

/** Frame height the bloom kernel sizes are tuned against. */
const REFERENCE_HEIGHT = 720;
const BLUR_X = new THREE.Vector2(1, 0);
const BLUR_Y = new THREE.Vector2(0, 1);

const PREFILTER_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const PREFILTER_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float luminosityThreshold;
uniform vec2 sourceTexel;
uniform float footprint;
varying vec2 vUv;

vec3 tap(vec2 uv) {
  vec3 c = texture2D(tDiffuse, uv).rgb;
  // Drop non-finite texels by their exponent bits (fast-math GPUs may fold isnan() away): a
  // single NaN would otherwise spread through every mip into a black block.
  bvec3 bad = equal(floatBitsToUint(c) & uvec3(0x7f800000u), uvec3(0x7f800000u));
  c = mix(c, vec3(0.0), bad);
  // Clamp absurd HDR values (sun disc, emissive cores) so one pixel cannot flood the chain.
  return min(c, vec3(64.0));
}

float karis(vec3 c) {
  return 1.0 / (1.0 + max(c.r, max(c.g, c.b)));
}

void main() {
  // Four bilinear taps cover a (footprint × footprint) block of source texels.
  vec2 o = sourceTexel * max(0.5, footprint * 0.25);
  vec3 a = tap(vUv + vec2(-o.x, -o.y));
  vec3 b = tap(vUv + vec2( o.x, -o.y));
  vec3 c = tap(vUv + vec2(-o.x,  o.y));
  vec3 d = tap(vUv + vec2( o.x,  o.y));
  float wa = karis(a), wb = karis(b), wc = karis(c), wd = karis(d);
  vec3 color = (a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd);

  // Soft knee: quadratic ramp over [threshold - knee, threshold + knee].
  float threshold = luminosityThreshold;
  float knee = max(1e-4, threshold * 0.5);
  float brightness = max(color.r, max(color.g, color.b));
  float soft = clamp(brightness - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee);
  float contribution = max(soft, brightness - threshold) / max(brightness, 1e-4);
  gl_FragColor = vec4(color * contribution, 1.0);
}`;

export class FilmBloomPass extends UnrealBloomPass {
  private readonly prefilter: THREE.ShaderMaterial;
  private readonly quad = new FullScreenQuad();
  private readonly frame: PostFrame;
  private readonly savedClear = new THREE.Color();

  constructor(frame: PostFrame, strength = 0.2, radius = 0.45, threshold = 2) {
    super(new THREE.Vector2(REFERENCE_HEIGHT * (16 / 9), REFERENCE_HEIGHT), strength, radius, threshold);
    this.frame = frame;
    this.needsSwap = false;
    this.prefilter = new THREE.ShaderMaterial({
      name: "IntroPost.bloomPrefilter",
      uniforms: {
        tDiffuse: { value: null },
        luminosityThreshold: { value: threshold },
        sourceTexel: { value: new THREE.Vector2(1, 1) },
        footprint: { value: 2 },
      },
      vertexShader: PREFILTER_VERTEX,
      fragmentShader: PREFILTER_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    this.materialHighPassFilter.dispose();
    this.materialHighPassFilter = this.prefilter;
    this.highPassUniforms = this.prefilter.uniforms;

    const halation = [
      [1, 1, 1],
      [1, 0.985, 0.965],
      [1, 0.955, 0.9],
      [1, 0.92, 0.84],
      [1, 0.89, 0.8],
    ];
    halation.forEach((tint, index) => this.bloomTintColors[index].set(tint[0], tint[1], tint[2]));
  }

  /** Composited bloom (unscaled by strength), valid after `render`. */
  get texture(): THREE.Texture {
    return this.renderTargetsHorizontal[0].texture;
  }

  /** `width` / `height` are the drawing-buffer size of the frame being bloomed. */
  override setSize(width: number, height: number) {
    const scale = REFERENCE_HEIGHT / Math.max(1, height);
    const workWidth = Math.max(8, Math.round(width * scale));
    const workHeight = Math.max(8, Math.round(height * scale));
    super.setSize(workWidth, workHeight);
    const uniforms = this.prefilter.uniforms;
    (uniforms.sourceTexel.value as THREE.Vector2).set(1 / Math.max(1, width), 1 / Math.max(1, height));
    // Source texels covered by one texel of the half-size bright target.
    uniforms.footprint.value = (2 * height) / workHeight;
  }

  override render(renderer: THREE.WebGLRenderer, _writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    renderer.getClearColor(this.savedClear);
    const clearAlpha = renderer.getClearAlpha();
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(this.clearColor, 0);

    const uniforms = this.prefilter.uniforms;
    uniforms.tDiffuse.value = this.frame.source ?? readBuffer.texture;
    uniforms.luminosityThreshold.value = this.threshold;
    this.quad.material = this.prefilter;
    renderer.setRenderTarget(this.renderTargetBright);
    renderer.clear();
    this.quad.render(renderer);

    let input = this.renderTargetBright;
    for (let i = 0; i < this.nMips; i += 1) {
      const blur = this.separableBlurMaterials[i];
      this.quad.material = blur;
      blur.uniforms.colorTexture.value = input.texture;
      blur.uniforms.direction.value = BLUR_X;
      renderer.setRenderTarget(this.renderTargetsHorizontal[i]);
      renderer.clear();
      this.quad.render(renderer);
      blur.uniforms.colorTexture.value = this.renderTargetsHorizontal[i].texture;
      blur.uniforms.direction.value = BLUR_Y;
      renderer.setRenderTarget(this.renderTargetsVertical[i]);
      renderer.clear();
      this.quad.render(renderer);
      input = this.renderTargetsVertical[i];
    }

    // Composite the mips at unit strength; the output pass applies `strength`.
    const composite = this.compositeMaterial.uniforms;
    composite.bloomStrength.value = 1;
    composite.bloomRadius.value = this.radius;
    composite.bloomTintColors.value = this.bloomTintColors;
    this.quad.material = this.compositeMaterial;
    renderer.setRenderTarget(this.renderTargetsHorizontal[0]);
    renderer.clear();
    this.quad.render(renderer);

    renderer.setClearColor(this.savedClear, clearAlpha);
    renderer.autoClear = autoClear;
  }

  override dispose() {
    super.dispose();
    this.prefilter.dispose();
    this.quad.dispose();
  }
}
