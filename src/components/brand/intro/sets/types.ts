/**
 * Public contracts of the sets module (main thread, three.js).
 *
 * A set is a self-contained environment authored around its own origin (meters, +Y up). The
 * director shows one set at a time, applies `lighting(variant)` to the fixed light rig from
 * `lighting.ts`, assigns `environment` to `scene.environment` and calls `update(time)` every
 * frame. Every set keeps its material variants stable across themes and shots: switching theme
 * only changes colours, intensities and uniforms (and re-bakes the environment into the same
 * texture), so no shader recompiles at cuts.
 */

import type * as THREE from "three";
import type { LightingPreset } from "../lighting";
import type { QualityTier, Theme } from "../types";

export type SetName = "track" | "gym" | "kitchen" | "studio";

export interface SetOptions {
  /**
   * "high" (default) uses 2048² near-field textures on the track; "medium" caps every texture at
   * 1024² (phones). Geometry and materials are identical across tiers.
   */
  quality?: QualityTier;
}

export interface IntroSet {
  readonly name: SetName;
  /** Root of the set. Leave it at the scene origin: anchors and presets are authored in set space. */
  readonly group: THREE.Group;
  /**
   * Markers (children of `group`) whose position is the spot and whose local +Z axis is the facing
   * direction, so `character.quaternion.copy(anchor.quaternion)` turns a +Z-facing character to face
   * the right way. `userData` may carry extra data (documented per set).
   */
  readonly anchors: Record<string, THREE.Object3D>;
  /**
   * PMREM environment (cube, 256² faces) for `scene.environment`. Always present, and the same
   * texture object for the whole life of the set: `applyTheme` re-bakes into it.
   */
  readonly environment: THREE.Texture;
  /** Lighting variant names accepted by `lighting()` (the first is the default). */
  readonly variants: readonly string[];
  /** Theme currently applied. */
  readonly theme: Theme;
  /** Main-thread build cost per step in ms (profiling aid). */
  readonly timings: Record<string, number>;
  /** Fresh preset for the current theme; unknown or missing variant → the set's default. */
  lighting(variant?: string): LightingPreset;
  applyTheme(theme: Theme): void;
  /** Ambient animation (dust, haze drift, star twinkle, wind). Pure function of `time` (seconds). */
  update(time: number): void;
  dispose(): void;
}

export interface BikeProp {
  /** Origin on the ground under the bottom bracket; the bike faces +Z (see `BIKE`). */
  group: THREE.Group;
  /** 0 = right (drive-side, -X) crank pointing forward (+Z); increasing angle pedals forward. */
  setCrankAngle(rad: number): void;
  /** Rotation of both wheels about their axles; increasing angle rolls the bike forward (+Z). */
  setWheelAngle(rad: number): void;
  /** 0 = crisp spokes, 1 = spokes fully replaced by a blurred-spoke disc (speed blur). */
  setSpinBlur(amount: number): void;
  /** World positions of the pedal spindle centres, [left (+X), right (-X)]. */
  pedalPositions(): [THREE.Vector3, THREE.Vector3];
  dispose(): void;
}

export interface BarbellPlate {
  /** The plate object; its rest position along the sleeve is `restX` (local X of the sleeve group). */
  object: THREE.Object3D;
  restX: number;
  kind: "coral" | "graphite";
}

export interface BarbellProp {
  /** Origin at the bar centre; the bar runs along X (see `BARBELL`). */
  group: THREE.Group;
  /** 0 = straight, 1 = peak bend at lift-off (sleeves dip ≈ 3.5 cm along a smooth curve). */
  setBend(amount: number): void;
  /** Spin of both sleeves (with their plates) about the bar axis, radians. */
  setSleeveSpin(rad: number): void;
  /**
   * Plates per side, inside → outside. Each plate is a child of its sleeve group, so it follows the
   * bend and spin; animate `object.position.x` (relative to `restX`) and `object.rotation.x` to slide
   * or spin a plate on (e.g. the 3a-plate macro).
   */
  plates: { left: BarbellPlate[]; right: BarbellPlate[] };
  /** Collars [left (+X), right (-X)]; children of the sleeve groups, rest local x in `userData.restX`. */
  collars: [THREE.Object3D, THREE.Object3D];
  /** 0 = collar lever open, 1 = clamped. */
  setCollarClamp(amount: number): void;
  dispose(): void;
}

export interface SmoothieProp {
  /** Origin at the centre of the glass base; +Y up. Safe to re-parent to a hand bone. */
  group: THREE.Group;
  dispose(): void;
}
