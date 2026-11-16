/**
 * Shared THREE materials for every character part (main thread). OWNER: surfaces.
 *
 * Paint lives in vertex colours (linear RGB, AO baked in), so every material keeps a white base
 * colour and differs only in its surface response. One set is created lazily and shared by all
 * characters; the instances never change variants between shots (no recompiles at cuts).
 *
 * Two shader patches (via `onBeforeCompile`, with a fixed program cache key per variant):
 * - Skin: a per-channel wrap term in the physical direct-light function. Red light diffuses
 *   furthest under skin, so near the terminator and just past it the skin glows warm; the curve
 *   meets Lambert where the surface faces the light, so the lit side keeps its painted colour
 *   (an additive tint everywhere had turned pale skin pink and night skin terracotta).
 * - Micro-detail (high tier): a small procedural tile per pattern (`surfaceDetail.ts`) sampled
 *   triplanar in the part's own bind/bone space — pre-skinning position and normal travel as
 *   varyings with the skin matrix, so pores and knit stick to the moving surface instead of
 *   swimming. It perturbs the normal (surface-gradient blend), breaks up roughness and darkens
 *   cavities, and fades out once a pixel covers the pattern's features (no shimmer or moiré).
 *   Compiled out entirely when `detail: false` (medium tier).
 *
 * `cloneCharacterMaterial` makes per-part / per-character variants (roughness, double-sided,
 * skin response, a different pattern) that keep both patches; plain `clone()` would drop them.
 * If three's chunks no longer match, the patches are skipped (dev warning, standard shading).
 */

import * as THREE from "three";
import type { MaterialRole, SkinResponse } from "./types";
import { detailTile, disposeDetailTiles, type DetailKind } from "./surfaceDetail";

export type { DetailKind } from "./surfaceDetail";

export interface CharacterMaterialOptions {
  /**
   * Compile the triplanar micro-detail in (the high tier). Fixed for the material set's life:
   * it applies on the first call after `disposeCharacterMaterials` (later calls get the cache).
   * Default true.
   */
  detail?: boolean;
}

/** Per-part / per-character overrides for `cloneCharacterMaterial`. */
export interface MaterialVariant {
  roughness?: number;
  doubleSided?: boolean;
  /** The geometry carries a per-vertex `fitxDetailMask` (0..1) scaling the micro-detail. */
  detailMask?: boolean;
  /** Skin response for one character (skin materials only). */
  skin?: SkinResponse;
  /** Another micro-detail pattern (e.g. per shoe style), or null for none. */
  detail?: DetailKind | null;
}

// ---------------------------------------------------------------------------------- shader code

const LIGHT_TARGET = "reflectedLight.directDiffuse += irradiance * diffuseBRDF * ( 1.0 - F );";

const SKIN_CODE = `
	#ifdef FITX_SKIN
	{
		// Per-channel wrap as a soft power curve: equal to Lambert facing the light, warmer and
		// softer toward and just past the terminator (red scatters furthest).
		float fitxX = dot( geometryNormal, directLight.direction );
		vec3 fitxW = fitxSkinWrap;
		vec3 fitxWrapped = pow( saturate( ( vec3( fitxX ) + fitxW ) / ( 1.0 + fitxW ) ), 1.0 + fitxW );
		vec3 fitxExtra = max( fitxWrapped - saturate( fitxX ), 0.0 );
		reflectedLight.directDiffuse += fitxExtra * directLight.color * BRDF_Lambert( material.diffuseContribution ) * fitxSkinScatter;
	}
	#endif`;

const VERTEX_DECL = `
#ifdef FITX_DETAIL
	varying vec3 vFitxPos;
	varying vec3 vFitxNrm;
	varying vec3 vFitxAx0;
	varying vec3 vFitxAx1;
	varying vec3 vFitxAx2;
	#ifdef FITX_DETAIL_MASK
		attribute float fitxDetailMask;
		varying float vFitxMask;
	#endif
#endif`;

// After defaultnormal_vertex: skinMatrix (skinned parts) and normalMatrix map the pre-skinning
// part space to view space; the fragment needs that map for the detail gradient.
const VERTEX_CODE = `
#ifdef FITX_DETAIL
	{
		mat3 fitxM = normalMatrix;
		#ifdef USE_SKINNING
			fitxM = normalMatrix * mat3( skinMatrix );
		#endif
		vFitxAx0 = fitxM[ 0 ];
		vFitxAx1 = fitxM[ 1 ];
		vFitxAx2 = fitxM[ 2 ];
		vFitxNrm = normal;
		vFitxPos = position;
		#ifdef FITX_DETAIL_MASK
			vFitxMask = fitxDetailMask;
		#endif
	}
#endif`;

const FRAGMENT_DECL = `
#ifdef FITX_DETAIL
	uniform sampler2D fitxDetailMap;
	// x: 1 / tile size (1/m), y: normal strength (× tile slope), z: roughness amp, w: cavity amp.
	uniform vec4 fitxDetailA;
	// Footprint (m per pixel) where the normal detail (x→y) and the roughness breakup (z→w) fade.
	uniform vec4 fitxDetailB;
	varying vec3 vFitxPos;
	varying vec3 vFitxNrm;
	varying vec3 vFitxAx0;
	varying vec3 vFitxAx1;
	varying vec3 vFitxAx2;
	#ifdef FITX_DETAIL_MASK
		varying float vFitxMask;
	#endif
#endif
#ifdef FITX_SKIN
	uniform vec3 fitxSkinWrap;
	uniform vec3 fitxSkinScatter;
#endif`;

// After color_fragment: sample the three projections once; albedo cavity applies here, the
// roughness offset and the normal gradient are applied by the next two snippets.
const FRAGMENT_SAMPLE = `
#ifdef FITX_DETAIL
	vec3 fitxGrad = vec3( 0.0 );
	float fitxRough = 0.0;
	{
		vec3 fitxN = normalize( vFitxNrm );
		vec3 fitxBw = pow( abs( fitxN ), vec3( 4.0 ) );
		fitxBw /= max( fitxBw.x + fitxBw.y + fitxBw.z, 1e-5 );
		float fitxFoot = max( length( dFdx( vFitxPos ) ), length( dFdy( vFitxPos ) ) );
		float fitxFadeN = 1.0 - smoothstep( fitxDetailB.x, fitxDetailB.y, fitxFoot );
		float fitxFadeR = 1.0 - smoothstep( fitxDetailB.z, fitxDetailB.w, fitxFoot );
		#ifdef FITX_DETAIL_MASK
			fitxFadeN *= vFitxMask;
			fitxFadeR *= vFitxMask;
		#endif
		vec3 fitxP = vFitxPos * fitxDetailA.x;
		vec4 fitxTx = texture2D( fitxDetailMap, fitxP.zy );
		vec4 fitxTy = texture2D( fitxDetailMap, fitxP.xz );
		vec4 fitxTz = texture2D( fitxDetailMap, fitxP.xy );
		vec2 fitxSx = fitxTx.rg * 2.0 - 1.0;
		vec2 fitxSy = fitxTy.rg * 2.0 - 1.0;
		vec2 fitxSz = fitxTz.rg * 2.0 - 1.0;
		// Each planar projection is a volume height field; blend their gradients, keep the part
		// tangent to the surface (surface-gradient framework: no per-projection sign flips).
		vec3 fitxG = fitxBw.x * vec3( 0.0, fitxSx.y, fitxSx.x ) + fitxBw.y * vec3( fitxSy.x, 0.0, fitxSy.y ) + fitxBw.z * vec3( fitxSz.x, fitxSz.y, 0.0 );
		fitxGrad = ( fitxG - dot( fitxG, fitxN ) * fitxN ) * ( fitxDetailA.y * fitxFadeN );
		vec2 fitxBA = fitxBw.x * fitxTx.ba + fitxBw.y * fitxTy.ba + fitxBw.z * fitxTz.ba;
		fitxRough = ( fitxBA.x * 2.0 - 1.0 ) * fitxDetailA.z * fitxFadeR;
		diffuseColor.rgb *= mix( 1.0, fitxBA.y, fitxDetailA.w * fitxFadeN );
	}
#endif`;

const FRAGMENT_ROUGH = `
#ifdef FITX_DETAIL
	roughnessFactor = clamp( roughnessFactor + fitxRough, 0.04, 1.0 );
#endif`;

const FRAGMENT_NORMAL = `
#ifdef FITX_DETAIL
	normal = normalize( normal - faceDirection * ( mat3( vFitxAx0, vFitxAx1, vFitxAx2 ) * fitxGrad ) );
#endif`;

// ---------------------------------------------------------------------------------- patch state

interface SkinState {
  wrap: { value: THREE.Vector3 };
  scatter: { value: THREE.Vector3 };
}

interface DetailState {
  kind: DetailKind;
  map: { value: THREE.Texture };
  a: { value: THREE.Vector4 };
  b: { value: THREE.Vector4 };
  mask: boolean;
}

interface PatchState {
  skin: SkinState | null;
  detail: DetailState | null;
}

const states = new WeakMap<THREE.Material, PatchState>();

/** Detail strengths per pattern: normal × the tile's physical slopes, roughness ±, cavity mix. */
const KIND_STRENGTH: Record<DetailKind, { normal: number; rough: number; cavity: number }> = {
  skin: { normal: 1, rough: 0.07, cavity: 1 },
  knit: { normal: 1, rough: 0.1, cavity: 0.6 },
  lycra: { normal: 1, rough: 0.08, cavity: 0.5 },
  mesh: { normal: 1, rough: 0.12, cavity: 0.9 },
  grain: { normal: 1, rough: 0.08, cavity: 0.6 },
  leather: { normal: 1, rough: 0.1, cavity: 0.8 },
  microfiber: { normal: 1, rough: 0.06, cavity: 0.7 },
};

const ROLE_DETAIL: Partial<Record<MaterialRole, DetailKind>> = {
  skin: "skin",
  fabric: "knit",
  fabricSheen: "lycra",
  shoe: "mesh",
  rubber: "grain",
  leather: "leather",
};

function detailState(kind: DetailKind, mask = false): DetailState {
  const tile = detailTile(kind);
  const s = KIND_STRENGTH[kind];
  return {
    kind,
    map: { value: tile.texture },
    a: { value: new THREE.Vector4(1 / tile.size, s.normal * tile.slope, s.rough, s.cavity) },
    // Normal detail is gone by ~1 px per feature; the slower roughness breakup lasts longer.
    b: { value: new THREE.Vector4(tile.feature / 3.5, tile.feature * 1.2, tile.roughFeature / 3, tile.roughFeature * 1.5) },
    mask,
  };
}

let patchedLights: string | null = null;
let warned = false;

function warnOnce(message: string) {
  if (warned || typeof process === "undefined" || process.env?.NODE_ENV === "production") return;
  warned = true;
  console.warn(`[fitx] ${message}`);
}

function lightsChunk(): string | null {
  if (patchedLights !== null) return patchedLights || null;
  const chunk = THREE.ShaderChunk.lights_physical_pars_fragment;
  if (!chunk.includes(LIGHT_TARGET)) {
    warnOnce("skin wrap lighting disabled: three's lights_physical_pars_fragment changed");
    patchedLights = "";
    return null;
  }
  patchedLights = chunk.replace(LIGHT_TARGET, LIGHT_TARGET + SKIN_CODE);
  return patchedLights;
}

const FRAGMENT_HOOKS = ["#include <common>", "#include <color_fragment>", "#include <roughnessmap_fragment>", "#include <normal_fragment_maps>", "#include <lights_physical_pars_fragment>"];
const VERTEX_HOOKS = ["#include <common>", "#include <defaultnormal_vertex>"];

function programKey(state: PatchState) {
  return `fitx-v2|${state.skin ? "s" : "-"}|${state.detail ? (state.detail.mask ? "dm" : "d") : "-"}`;
}

/** Installs the skin / detail patches described by `state` on a material (replacing any hook). */
function applyPatch(material: THREE.Material, state: PatchState) {
  states.set(material, state);
  if (!state.skin && !state.detail) return;
  material.onBeforeCompile = (shader) => {
    const lights = state.skin ? lightsChunk() : null;
    if (!FRAGMENT_HOOKS.every((h) => shader.fragmentShader.includes(h)) || !VERTEX_HOOKS.every((h) => shader.vertexShader.includes(h))) {
      warnOnce("character material patches disabled: physical shader layout changed");
      return;
    }
    const defines: string[] = [];
    if (state.skin && lights) {
      defines.push("#define FITX_SKIN");
      shader.uniforms.fitxSkinWrap = state.skin.wrap;
      shader.uniforms.fitxSkinScatter = state.skin.scatter;
      shader.fragmentShader = shader.fragmentShader.replace("#include <lights_physical_pars_fragment>", lights);
    }
    if (state.detail) {
      defines.push("#define FITX_DETAIL");
      if (state.detail.mask) defines.push("#define FITX_DETAIL_MASK");
      shader.uniforms.fitxDetailMap = state.detail.map;
      shader.uniforms.fitxDetailA = state.detail.a;
      shader.uniforms.fitxDetailB = state.detail.b;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${defines.join("\n")}${VERTEX_DECL}`)
        .replace("#include <defaultnormal_vertex>", `#include <defaultnormal_vertex>${VERTEX_CODE}`);
    }
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${defines.join("\n")}${FRAGMENT_DECL}`)
      .replace("#include <color_fragment>", `#include <color_fragment>${FRAGMENT_SAMPLE}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>${FRAGMENT_ROUGH}`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>${FRAGMENT_NORMAL}`);
  };
  const key = programKey(state);
  material.customProgramCacheKey = () => key;
}

// ---------------------------------------------------------------------------------- skin

/** Default skin response (medium-brown skin); characters override it from `SkinSpec.response`. */
const SKIN_DEFAULT: Required<SkinResponse> = {
  wrap: [0.44, 0.2, 0.15],
  scatter: [1, 1, 1],
  roughness: 0.5,
  specular: 0.55,
  sheen: 0.16,
  sheenColor: 0xf3d2bf,
};

function skinState(): SkinState {
  return { wrap: { value: new THREE.Vector3(...SKIN_DEFAULT.wrap) }, scatter: { value: new THREE.Vector3(...SKIN_DEFAULT.scatter) } };
}

function applySkinResponse(material: THREE.MeshPhysicalMaterial, skin: SkinState, response: SkinResponse) {
  const r = { ...SKIN_DEFAULT, ...response };
  skin.wrap.value.set(...r.wrap);
  skin.scatter.value.set(...r.scatter);
  material.roughness = r.roughness;
  material.specularIntensity = r.specular;
  // Sheen stays > 0 so every skin clone shares one program (USE_SHEEN).
  material.sheen = Math.max(0.02, r.sheen);
  material.sheenColor.setHex(r.sheenColor);
}

function skinMaterial(detail: boolean): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    metalness: 0,
    specularColor: new THREE.Color(0xfff4ec),
    sheenRoughness: 0.55,
  });
  material.name = "fitx-skin";
  const skin = skinState();
  applySkinResponse(material, skin, {});
  applyPatch(material, { skin, detail: detail ? detailState("skin") : null });
  return material;
}

function physical(name: string, role: MaterialRole, detail: boolean, params: THREE.MeshPhysicalMaterialParameters): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, metalness: 0, ...params });
  material.name = name;
  const kind = ROLE_DETAIL[role];
  applyPatch(material, { skin: null, detail: detail && kind ? detailState(kind) : null });
  return material;
}

// ---------------------------------------------------------------------------------- public API

let cache: Record<MaterialRole, THREE.Material> | null = null;

/** The shared material set (created on first call, cached until `disposeCharacterMaterials`). */
export function createCharacterMaterials(options: CharacterMaterialOptions = {}): Record<MaterialRole, THREE.Material> {
  if (cache) return cache;
  const detail = options.detail ?? true;
  cache = {
    skin: skinMaterial(detail),
    // Matte knit (cotton/poly blend): broad sheen at grazing angles, almost no specular.
    fabric: physical("fitx-fabric", "fabric", detail, { roughness: 0.88, specularIntensity: 0.16, sheen: 0.28, sheenRoughness: 0.8, sheenColor: new THREE.Color(0xffffff) }),
    // Technical/lycra fabric: tighter, brighter sheen.
    fabricSheen: physical("fitx-fabric-sheen", "fabricSheen", detail, { roughness: 0.58, specularIntensity: 0.3, sheen: 0.38, sheenRoughness: 0.45, sheenColor: new THREE.Color(0xffffff) }),
    // Hair: a soft sheen along the strands; low and near-neutral so dark hair stays dark (a strong
    // warm sheen turned Maya's hair into brown plastic in window light and red under the studio bar).
    hair: physical("fitx-hair", "hair", detail, { roughness: 0.44, specularIntensity: 0.45, sheen: 0.3, sheenRoughness: 0.42, sheenColor: new THREE.Color(0x8c8278) }),
    shoe: physical("fitx-shoe", "shoe", detail, { roughness: 0.55, specularIntensity: 0.4, sheen: 0.35, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffffff) }),
    rubber: physical("fitx-rubber", "rubber", detail, { roughness: 0.82, specularIntensity: 0.25 }),
    leather: physical("fitx-leather", "leather", detail, { roughness: 0.46, specularIntensity: 0.5, clearcoat: 0.18, clearcoatRoughness: 0.5 }),
    plastic: physical("fitx-plastic", "plastic", detail, { roughness: 0.32, specularIntensity: 0.55, clearcoat: 1, clearcoatRoughness: 0.08 }),
    lens: physical("fitx-lens", "lens", detail, { roughness: 0.04, metalness: 0.65, specularIntensity: 1, iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessMinimum: 180, iridescenceThicknessMaximum: 520, envMapIntensity: 1.6 }),
    metal: physical("fitx-metal", "metal", detail, { roughness: 0.28, metalness: 1, specularIntensity: 1 }),
  };
  return cache;
}

/**
 * A variant of a character material that keeps its skin / detail patches (`clone()` alone
 * drops them). Variants share the base's program unless they toggle a define (mask, pattern
 * on/off), so per-character skin and per-part roughness cost no extra compiles.
 */
export function cloneCharacterMaterial(base: THREE.Material, variant: MaterialVariant = {}): THREE.Material {
  const material = base.clone();
  if (variant.doubleSided) material.side = THREE.DoubleSide;
  const baseState = states.get(base);
  if (!baseState) {
    material.onBeforeCompile = base.onBeforeCompile;
    material.customProgramCacheKey = base.customProgramCacheKey;
  } else {
    let skin: SkinState | null = null;
    if (baseState.skin) {
      skin = { wrap: { value: baseState.skin.wrap.value.clone() }, scatter: { value: baseState.skin.scatter.value.clone() } };
      if (variant.skin && material instanceof THREE.MeshPhysicalMaterial) applySkinResponse(material, skin, variant.skin);
    }
    let detail: DetailState | null = null;
    if (baseState.detail && variant.detail !== null) {
      detail = variant.detail && variant.detail !== baseState.detail.kind ? detailState(variant.detail) : { ...baseState.detail, a: { value: baseState.detail.a.value.clone() }, b: { value: baseState.detail.b.value.clone() } };
      detail.mask = variant.detailMask ?? false;
    }
    applyPatch(material, { skin, detail });
  }
  // Last, so a part's own roughness wins over the character's skin response.
  if (variant.roughness !== undefined && "roughness" in material) (material as THREE.MeshStandardMaterial).roughness = variant.roughness;
  return material;
}

/** True when the material samples micro-detail (assembly then uploads `fitxDetailMask`). */
export function hasMicroDetail(material: THREE.Material): boolean {
  return !!states.get(material)?.detail;
}

/** Disposes the shared materials and detail tiles (call when the intro is torn down for good). */
export function disposeCharacterMaterials() {
  if (!cache) return;
  for (const material of Object.values(cache)) material.dispose();
  cache = null;
  disposeDetailTiles();
}
