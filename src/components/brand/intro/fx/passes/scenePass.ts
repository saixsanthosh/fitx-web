/**
 * Renders the scene into a dedicated multisampled HDR target with a resolved depth texture
 * (for depth of field and flare occlusion). Later passes read the resolved texture directly
 * through `PostFrame.source`, so no full-resolution copy into the composer buffers is made
 * and MSAA never touches the full-screen passes.
 */

import * as THREE from "three";
import { Pass } from "three/addons/postprocessing/Pass.js";

/** Shared between the passes of one IntroPost: which texture holds the current HDR image. */
export interface PostFrame {
  source: THREE.Texture | null;
}

export class ScenePass extends Pass {
  scene: THREE.Scene;
  camera: THREE.Camera;
  readonly target: THREE.WebGLRenderTarget;
  private readonly frame: PostFrame;

  /**
   * `compact` stores the HDR scene as R11G11B10F (4 bytes per sample instead of 8). The MSAA
   * colour store + resolve is bandwidth-bound, so this roughly halves its cost.
   */
  constructor(scene: THREE.Scene, camera: THREE.Camera, samples: number, frame: PostFrame, compact = true) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.frame = frame;
    this.needsSwap = false;
    const depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    depthTexture.minFilter = THREE.NearestFilter;
    depthTexture.magFilter = THREE.NearestFilter;
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: compact ? THREE.UnsignedInt101111Type : THREE.HalfFloatType,
      format: compact ? THREE.RGBFormat : THREE.RGBAFormat,
      samples,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture,
    });
    this.target.texture.name = "IntroPost.scene";
    this.target.texture.generateMipmaps = false;
  }

  get depthTexture(): THREE.DepthTexture {
    return this.target.depthTexture as THREE.DepthTexture;
  }

  /** Changes the MSAA sample count; the GPU buffers are re-created lazily on the next frame. */
  setSamples(samples: number) {
    if (this.target.samples === samples) return;
    this.target.dispose();
    this.target.samples = samples;
  }

  override setSize(width: number, height: number) {
    this.target.setSize(width, height);
  }

  /** Renders the scene into the HDR target. */
  renderScene(renderer: THREE.WebGLRenderer) {
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.target);
    renderer.clear(true, true, false);
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
  }

  override render(renderer: THREE.WebGLRenderer) {
    this.renderScene(renderer);
    this.frame.source = this.target.texture;
  }

  override dispose() {
    this.target.depthTexture?.dispose();
    this.target.dispose();
  }
}
