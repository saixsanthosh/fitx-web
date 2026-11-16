/**
 * Character data contracts (worker-safe: no `three`, no DOM).
 *
 * Pipeline: `CharacterSpec` → (worker) `generateCharacter()` → `CharacterMeshData`
 * (typed arrays, structured-clone/transfer friendly) → (main thread) `assembleCharacter()`
 * → THREE objects bound to a `Rig` from `rig/three-rig.ts`.
 */

import type { BindPose, BoneName, Proportions } from "../rig/skeleton";
import type { Vec3Tuple } from "../types";

export type CharacterId = "maya" | "leo" | "dre";

/** Colours are sRGB hex numbers (e.g. 0xc44933) unless a field says otherwise. */
export type HexColor = number;

export interface BuildSpec {
  /** 0 = untrained, 1 = elite strength athlete. Drives muscle-belly volumes. */
  muscle: number;
  /** 0 = very lean, 1 = soft. Drives blend radii and subcutaneous volume. */
  bodyFat: number;
  /** Extra deltoid/trapezius mass, 0..1. */
  shoulderMass: number;
  /** Chest depth multiplier around 1. */
  chestDepth: number;
  /** Waist width multiplier around 1. */
  waist: number;
  /** Glute volume multiplier around 1. */
  glutes: number;
  /** Thigh girth multiplier around 1. */
  thighs: number;
  /** Calf girth multiplier around 1. */
  calves: number;
  /** Bust volume 0..1 (female characters; covered by the sports top). */
  bust: number;
}

export interface FaceSpec {
  /** Jaw width/squareness, 0 = narrow/soft, 1 = broad/square. */
  jaw: number;
  /** Chin projection, 0..1. */
  chin: number;
  /** Cheekbone prominence, 0..1. */
  cheekbones: number;
  noseWidth: number;
  noseLength: number;
  /** Nose bridge height, 0 = flat, 1 = high. */
  noseBridge: number;
  lipFullness: number;
  browRidge: number;
  /** Eye opening size multiplier around 1. */
  eyeSize: number;
  irisColor: HexColor;
}

export interface SkinSpec {
  base: HexColor;
  /** Warmer/redder tint used for lips, ears, knuckles, cheeks. */
  flush: HexColor;
  /** Darker tone used in creases and for stubble/eyebrow shadow. */
  shade: HexColor;
  /** Surface response of this character's skin material (main thread). (Added by surfaces.) */
  response?: SkinResponse;
}

/** Skin material response; every field optional (defaults suit medium skin). (Added by surfaces.) */
export interface SkinResponse {
  /** Subsurface wrap per channel (R, G, B): how far past the terminator each colour diffuses. */
  wrap?: [number, number, number];
  /** Strength of that wrap glow per channel (1 = full). */
  scatter?: [number, number, number];
  roughness?: number;
  /** Specular intensity (× the dielectric F0 of IOR 1.5). */
  specular?: number;
  /** Fine-hair sheen at grazing angles, and its sRGB colour. */
  sheen?: number;
  sheenColor?: HexColor;
}

export type HairStyle = "ponytail" | "crop" | "fade";
export type FacialHairStyle = "beard" | "stubble";
export type TopStyle = "crop-tank" | "jersey" | "tank";
export type BottomStyle = "run-shorts" | "bib-shorts" | "training-shorts";
export type ShoeStyle = "runner" | "cycling" | "lifter";
export type Extra = "helmet" | "sunglasses" | "belt" | "wristWraps" | "hairTie" | "watch";

export interface OutfitSpec {
  top: { style: TopStyle; color: HexColor; accent: HexColor };
  bottom: { style: BottomStyle; color: HexColor; accent: HexColor };
  shoes: { style: ShoeStyle; upper: HexColor; sole: HexColor; accent: HexColor; laces: HexColor };
  extras: Extra[];
}

export interface CharacterSpec {
  id: CharacterId;
  /** Seed for every random choice in generation (noise phases, small asymmetries). */
  seed: number;
  proportions: Proportions;
  build: BuildSpec;
  skin: SkinSpec;
  face: FaceSpec;
  hair: { style: HairStyle; color: HexColor; highlight: HexColor };
  facialHair?: { style: FacialHairStyle; color: HexColor };
  outfit: OutfitSpec;
}

/** Material slots the main thread maps to THREE materials (`character/materials.ts`). */
export type MaterialRole =
  | "skin"
  | "fabric"
  | "fabricSheen"
  | "hair"
  | "shoe"
  | "rubber"
  | "leather"
  | "plastic"
  | "lens"
  | "metal";

export interface MeshPart {
  /** Unique within a character, e.g. "body", "top", "bottom", "head", "hair", "shoe_L". */
  name: string;
  role: MaterialRole;
  /** Character bind space for skinned parts; bone-local (relative to the joint) when `rigidBone` is set. */
  positions: Float32Array;
  normals: Float32Array;
  /** Linear RGB per vertex: paint colour × baked occlusion. The THREE material colour stays white. */
  colors: Float32Array;
  indices: Uint32Array;
  /** Skinned parts: 4 indices into `BONE_NAMES` per vertex. */
  skinIndex?: Uint16Array;
  /** Skinned parts: 4 weights per vertex, summing to 1. */
  skinWeight?: Float32Array;
  /** Rigid parts follow this bone exactly. */
  rigidBone?: BoneName;
  /** Per-part render hints (defaults: castShadow true, doubleSided false). */
  castShadow?: boolean;
  doubleSided?: boolean;
  /** Optional roughness override for the role's material (0..1). */
  roughness?: number;
  /** Default true. (Added by faces: the mouth interior sits inside the head's own shadow.) */
  receiveShadow?: boolean;
  /**
   * Per-vertex micro-detail weight, 0..255 (= 0..1 of the role's pattern), for parts whose one
   * material covers different surfaces (e.g. a knit upper and a foam sole in one shoe mesh).
   * Omitted = full detail everywhere. (Added by surfaces.)
   */
  detail?: Uint8Array;
  /**
   * Expression morph targets (relative deltas in the part's own space), driven by
   * `FaceRig.setExpression` through `morphTargetInfluences` in this order. (Added by faces.)
   */
  morphs?: MorphTarget[];
}

/** One expression shape: per-vertex deltas added at full influence. (Added by faces.) */
export interface MorphTarget {
  /** "smile" | "laugh". */
  name: string;
  positions: Float32Array;
  normals: Float32Array;
  /** Optional linear RGB deltas (flush); when present, every target of the part carries them. */
  colors?: Float32Array;
}

/** Facial features built on the main thread from simple geometry (head-bone-local, bind pose). */
export interface FaceFeatures {
  eyes: Array<{ side: "L" | "R"; center: Vec3Tuple; radius: number; irisColor: HexColor }>;
  /** Upper-lid pivot data so blinks can rotate a lid shell over each eye. */
  lids: Array<{
    side: "L" | "R";
    center: Vec3Tuple;
    radius: number;
    openAngle: number;
    tilt: number;
    /** Lid skin tone (sRGB hex); defaults to a neutral skin tone. (Added by character-details.) */
    color?: HexColor;
    /**
     * How far (radians) the head's eye window reaches past the upper / lower margin: the lid band
     * that shows, shaded as the fold's crease in the socket frame. (Added by faces.)
     */
    window?: { up: number; down: number };
  }>;
  /** Brow centre-lines (3–6 points each) and thickness. */
  brows: Array<{ side: "L" | "R"; points: Vec3Tuple[]; radius: number; color: HexColor }>;
  /** Lash line centre-lines along each upper lid. */
  lashes: Array<{ side: "L" | "R"; points: Vec3Tuple[]; radius: number; color: HexColor }>;
}

export interface CharacterMeshData {
  id: CharacterId;
  bind: BindPose;
  parts: MeshPart[];
  face: FaceFeatures;
  /** Milliseconds spent per generation step, for profiling. */
  timings: Record<string, number>;
}

/** Hand shapes generated as rigid meshes attached to `hand_L` / `hand_R`. */
/** `glass`: cylindrical grasp around the Ø74 mm smoothie glass (GRIP_GLASS). Added by character-details. */
export type HandPose = "relaxed" | "fist" | "grip" | "open" | "glass";
