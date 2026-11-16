/**
 * GPU texture baker: renders tileable procedural surfaces (see `bakeGlsl.ts`) into mipmapped render
 * targets. Much faster than per-pixel canvas work on the main thread (a 2048² normal map bakes in a
 * few milliseconds) and deterministic (integer hashes, no Math.random).
 *
 * Albedo bakes go to sRGB8 targets (the GPU encodes on write and decodes on sample), normal/ORM and
 * data bakes to linear RGBA8. One uber-shader is compiled once per renderer and shared by every set.
 */

import * as THREE from "three";
import { BAKE_FRAGMENT, BAKE_MODE, BAKE_VERTEX, type BakeMode } from "./bakeGlsl";

export type BakeOutput = "albedo" | "normal" | "orm" | "data";

export interface BakeParams {
  /** Texture size in pixels: square or [width, height]. */
  size: number | [number, number];
  a?: [number, number, number, number];
  b?: [number, number, number, number];
  /** Up to four sRGB hex colours (uCol0..3), converted to linear. */
  colors?: number[];
  seed?: number;
  /** Normal bakes: height-units → slope factor, see `normalStrength`. */
  strength?: number;
  /** `heightTex` mode: the source height texture (R channel). */
  input?: THREE.Texture;
  /** Anisotropic filtering samples (ground textures seen at grazing angles want 8+). */
  anisotropy?: number;
  /** Repeat wrapping (default true). */
  repeat?: boolean;
}

/** Normal strength so that height 0..1 means `heightMeters` of relief on a tile of `tileMeters`. */
export function normalStrength(heightMeters: number, tileMeters: number, size: number) {
  return heightMeters / (2 * (tileMeters / size));
}

interface Owner {
  track<T extends { dispose(): void }>(item: T): T;
}

class TextureBaker {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.ShaderMaterial;
  readonly maxAnisotropy: number;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.material = new THREE.ShaderMaterial({
      vertexShader: BAKE_VERTEX,
      fragmentShader: BAKE_FRAGMENT,
      uniforms: {
        uRes: { value: new THREE.Vector2(1, 1) },
        uMode: { value: 0 },
        uOut: { value: 0 },
        uSeed: { value: 1 },
        uStrength: { value: 1 },
        uA: { value: new THREE.Vector4() },
        uB: { value: new THREE.Vector4() },
        uCol0: { value: new THREE.Color() },
        uCol1: { value: new THREE.Color() },
        uCol2: { value: new THREE.Color() },
        uCol3: { value: new THREE.Color() },
        uTex: { value: null },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  }

  bake(mode: BakeMode, output: BakeOutput, params: BakeParams, owner: Owner): THREE.Texture {
    const [width, height] = typeof params.size === "number" ? [params.size, params.size] : params.size;
    const target = owner.track(
      new THREE.WebGLRenderTarget(width, height, {
        type: THREE.UnsignedByteType,
        format: THREE.RGBAFormat,
        colorSpace: output === "albedo" ? THREE.SRGBColorSpace : THREE.NoColorSpace,
        generateMipmaps: true,
        minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
      }),
    );
    const texture = target.texture;
    const wrap = params.repeat === false ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    texture.wrapS = wrap;
    texture.wrapT = wrap;
    texture.anisotropy = Math.min(params.anisotropy ?? 4, this.maxAnisotropy);
    texture.name = `bake:${mode}:${output}`;

    const u = this.material.uniforms;
    u.uRes.value.set(width, height);
    u.uMode.value = BAKE_MODE[mode];
    u.uOut.value = output === "albedo" ? 0 : output === "normal" ? 1 : output === "orm" ? 2 : 3;
    u.uSeed.value = params.seed ?? 1;
    u.uStrength.value = params.strength ?? 1;
    (u.uA.value as THREE.Vector4).fromArray(params.a ?? [0, 0, 0, 0]);
    (u.uB.value as THREE.Vector4).fromArray(params.b ?? [0, 0, 0, 0]);
    const colors = params.colors ?? [];
    (["uCol0", "uCol1", "uCol2", "uCol3"] as const).forEach((name, index) => {
      (u[name].value as THREE.Color).setHex(colors[index] ?? 0x808080);
    });
    u.uTex.value = params.input ?? null;

    const renderer = this.renderer;
    const previousTarget = renderer.getRenderTarget();
    const previousXr = renderer.xr.enabled;
    renderer.xr.enabled = false;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(previousTarget);
    renderer.xr.enabled = previousXr;
    u.uTex.value = null;
    return texture;
  }
}

const bakers = new WeakMap<THREE.WebGLRenderer, TextureBaker>();

/** Shared baker for a renderer (the uber-shader compiles once). */
export function getBaker(renderer: THREE.WebGLRenderer): TextureBaker {
  let baker = bakers.get(renderer);
  if (!baker) {
    baker = new TextureBaker(renderer);
    bakers.set(renderer, baker);
  }
  return baker;
}

export interface SurfaceMaps {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  /** AO (R), roughness (G), metalness (B): assign to aoMap/roughnessMap/metalnessMap as needed. */
  orm: THREE.Texture;
}

/** Bakes albedo + normal(+height in A) + ORM for one surface with shared parameters. */
export function bakeSurface(
  renderer: THREE.WebGLRenderer,
  owner: Owner,
  mode: BakeMode,
  params: BakeParams & { tileMeters: number; reliefMeters: number; normalSize?: number },
): SurfaceMaps {
  const baker = getBaker(renderer);
  const size = typeof params.size === "number" ? params.size : params.size[0];
  const normalSize = params.normalSize ?? size;
  const map = baker.bake(mode, "albedo", params, owner);
  const normalMap = baker.bake(mode, "normal", { ...params, size: normalSize, strength: normalStrength(params.reliefMeters, params.tileMeters, normalSize) }, owner);
  const orm = baker.bake(mode, "orm", params, owner);
  return { map, normalMap, orm };
}

/** Applies a world-space tile size: UVs are meters, so repeat = 1 / tile for every map. */
export function setTile(textures: Array<THREE.Texture | null | undefined>, tileMeters: number | [number, number]) {
  const [tu, tv] = typeof tileMeters === "number" ? [tileMeters, tileMeters] : tileMeters;
  for (const texture of textures) {
    if (!texture) continue;
    texture.repeat.set(1 / tu, 1 / tv);
  }
}
