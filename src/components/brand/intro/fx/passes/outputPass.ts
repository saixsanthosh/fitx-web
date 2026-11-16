/**
 * Output transform: current HDR image + bloom × strength + lens (flares) → exposure → tone
 * mapping → sRGB. Same tone-mapping and colour-space code path as three's OutputPass
 * (`tonemapping_pars_fragment`, `colorspace_pars_fragment`, defines from the renderer), with
 * the bloom and lens layers folded in so neither needs its own full-resolution blend.
 */

import * as THREE from "three";
import { FullScreenQuad, Pass } from "three/addons/postprocessing/Pass.js";
import type { PostFrame } from "./scenePass";

const VERTEX = /* glsl */ `
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
attribute vec3 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D tSource;
uniform sampler2D tBloom;
uniform sampler2D tLens;
uniform float bloomStrength;
uniform float lensOn;

#include <tonemapping_pars_fragment>
#include <colorspace_pars_fragment>

varying vec2 vUv;

void main() {
  vec3 color = texture2D(tSource, vUv).rgb + texture2D(tBloom, vUv).rgb * bloomStrength;
  if (lensOn > 0.5) color += texture2D(tLens, vUv).rgb;
  gl_FragColor = vec4(color, 1.0);

  #ifdef LINEAR_TONE_MAPPING
    gl_FragColor.rgb = LinearToneMapping(gl_FragColor.rgb);
  #elif defined(REINHARD_TONE_MAPPING)
    gl_FragColor.rgb = ReinhardToneMapping(gl_FragColor.rgb);
  #elif defined(CINEON_TONE_MAPPING)
    gl_FragColor.rgb = CineonToneMapping(gl_FragColor.rgb);
  #elif defined(ACES_FILMIC_TONE_MAPPING)
    gl_FragColor.rgb = ACESFilmicToneMapping(gl_FragColor.rgb);
  #elif defined(AGX_TONE_MAPPING)
    gl_FragColor.rgb = AgXToneMapping(gl_FragColor.rgb);
  #elif defined(NEUTRAL_TONE_MAPPING)
    gl_FragColor.rgb = NeutralToneMapping(gl_FragColor.rgb);
  #elif defined(CUSTOM_TONE_MAPPING)
    gl_FragColor.rgb = CustomToneMapping(gl_FragColor.rgb);
  #endif

  #ifdef SRGB_TRANSFER
    gl_FragColor = sRGBTransferOETF(gl_FragColor);
  #endif
}`;

const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
black.needsUpdate = true;

export class FilmOutputPass extends Pass {
  /** Extra exposure factor from the grade, applied before the tone curve. */
  exposureScale = 1;
  bloomStrength = 0;
  bloomTexture: THREE.Texture | null = null;
  lensTexture: THREE.Texture | null = null;
  /** Whether the lens buffer holds anything this frame (set by the post). */
  lensActive: () => boolean = () => false;
  private readonly material: THREE.RawShaderMaterial;
  private readonly quad: FullScreenQuad;
  private readonly frame: PostFrame;
  private outputColorSpace: string | null = null;
  private toneMapping: THREE.ToneMapping | null = null;

  constructor(frame: PostFrame) {
    super();
    this.frame = frame;
    this.material = new THREE.RawShaderMaterial({
      name: "IntroPost.output",
      uniforms: {
        tSource: { value: null },
        tBloom: { value: black },
        tLens: { value: black },
        bloomStrength: { value: 0 },
        lensOn: { value: 0 },
        toneMappingExposure: { value: 1 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    const u = this.material.uniforms;
    u.tSource.value = this.frame.source ?? readBuffer.texture;
    u.tBloom.value = this.bloomTexture && this.bloomStrength > 0 ? this.bloomTexture : black;
    u.bloomStrength.value = this.bloomStrength;
    const lensOn = this.lensTexture !== null && this.lensActive();
    u.tLens.value = lensOn ? this.lensTexture : black;
    u.lensOn.value = lensOn ? 1 : 0;
    u.toneMappingExposure.value = renderer.toneMappingExposure * this.exposureScale;

    // Rebuild defines when the renderer's tone mapping / output colour space change (as OutputPass does).
    if (this.outputColorSpace !== renderer.outputColorSpace || this.toneMapping !== renderer.toneMapping) {
      this.outputColorSpace = renderer.outputColorSpace;
      this.toneMapping = renderer.toneMapping;
      const defines: Record<string, string> = {};
      if (THREE.ColorManagement.getTransfer(renderer.outputColorSpace) === THREE.SRGBTransfer) defines.SRGB_TRANSFER = "";
      const toneDefine: Partial<Record<THREE.ToneMapping, string>> = {
        [THREE.LinearToneMapping]: "LINEAR_TONE_MAPPING",
        [THREE.ReinhardToneMapping]: "REINHARD_TONE_MAPPING",
        [THREE.CineonToneMapping]: "CINEON_TONE_MAPPING",
        [THREE.ACESFilmicToneMapping]: "ACES_FILMIC_TONE_MAPPING",
        [THREE.AgXToneMapping]: "AGX_TONE_MAPPING",
        [THREE.NeutralToneMapping]: "NEUTRAL_TONE_MAPPING",
        [THREE.CustomToneMapping]: "CUSTOM_TONE_MAPPING",
      };
      const define = toneDefine[this.toneMapping];
      if (define) defines[define] = "";
      this.material.defines = defines;
      this.material.needsUpdate = true;
    }

    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
    this.frame.source = null;
  }

  override dispose() {
    this.material.dispose();
    this.quad.dispose();
  }
}
