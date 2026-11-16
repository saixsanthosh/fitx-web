/**
 * Environment baking for image-based lighting. Each set builds a small, unlit "env scene" (sky,
 * bright windows, coloured walls, emissive bars) and bakes it into a PMREM. The PMREM target is
 * allocated once and re-used on every re-bake (theme change), so `IntroSet.environment` is the same
 * texture object for the set's whole life and materials never see a different env map.
 *
 * All sets use 256² faces: three keys shader programs on the PMREM size, so a uniform size keeps
 * cuts between sets free of recompiles.
 */

import * as THREE from "three";

export const ENV_SIZE = 256;

export class EnvBaker {
  private readonly cubeTarget: THREE.WebGLCubeRenderTarget;
  private readonly cubeCamera: THREE.CubeCamera;
  private readonly pmrem: THREE.PMREMGenerator;
  private target: THREE.WebGLCubeRenderTarget | null = null;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.cubeTarget = new THREE.WebGLCubeRenderTarget(ENV_SIZE, { type: THREE.HalfFloatType, generateMipmaps: false, depthBuffer: true });
    this.cubeCamera = new THREE.CubeCamera(0.05, 3000, this.cubeTarget);
    this.pmrem = new THREE.PMREMGenerator(renderer);
  }

  /** Renders `scene` from `position` and (re)fills the PMREM. Returns the stable PMREM texture. */
  bake(scene: THREE.Scene, position: THREE.Vector3Like): THREE.Texture {
    const renderer = this.renderer;
    const previousTarget = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    const shadowAuto = renderer.shadowMap.autoUpdate;
    renderer.autoClear = true;
    // Env scenes are unlit; skip shadow work if the director's rig happens to be in `scene`.
    renderer.shadowMap.autoUpdate = false;
    this.cubeCamera.position.set(position.x, position.y, position.z);
    this.cubeCamera.updateMatrixWorld(true);
    this.cubeCamera.update(renderer, scene);
    this.target = this.pmrem.fromCubemap(this.cubeTarget.texture, this.target) as THREE.WebGLCubeRenderTarget;
    renderer.shadowMap.autoUpdate = shadowAuto;
    renderer.autoClear = autoClear;
    renderer.setRenderTarget(previousTarget);
    return this.target.texture;
  }

  get texture(): THREE.Texture {
    if (!this.target) throw new Error("EnvBaker: bake() first");
    return this.target.texture;
  }

  dispose() {
    this.cubeTarget.dispose();
    this.pmrem.dispose();
    this.target?.dispose();
    this.target = null;
  }
}

/** Unlit material for env-scene geometry (colour in linear HDR via `intensity`). */
export function envBasic(color: THREE.ColorRepresentation, intensity = 1, side: THREE.Side = THREE.FrontSide): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({ color, side, fog: false, toneMapped: false });
  material.color.multiplyScalar(intensity);
  return material;
}
