/**
 * Contracts between the director core (`director.ts`) and the per-act shot modules
 * (`shots/*.ts`). A shot is a pure function of time: `update` may be called for any
 * frame in any order (seeking), so it must never depend on what happened last frame.
 */

import type * as THREE from "three";
import type { FilmComposition } from "../../films/compositions";
import type { CharacterInstance } from "../character/assemble";
import type { CharacterId } from "../character/types";
import type { GradeParams, IntroPost } from "../fx/post";
import type { QualitySettings } from "../fx/quality";
import type { LightingPreset, LightRig } from "../lighting";
import type { ShotId } from "../timeline";
import type { Theme } from "../types";
import type { CameraState } from "./camera";
import type { FilmFx, FilmProps, FilmSets, SetName } from "./stage-kit";

export interface FilmContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  post: IntroPost;
  quality: QualitySettings;
  lights: LightRig;
  sets: FilmSets;
  props: FilmProps;
  fx: FilmFx;
  /** Assembled characters; a shot only runs once every id in `shot.cast` is present. */
  cast: Partial<Record<CharacterId, CharacterInstance>>;
  theme: Theme;
  /** True on portrait screens; shots keep subjects nearer the optical centre. Derived from `aspect` (< 0.85). */
  portrait: boolean;
  /** The authored composition this frame is rendered for (`pickComposition` of the render size). */
  composition: FilmComposition;
  /** Render aspect ratio (width / height) of this frame. */
  aspect: number;
}

/** The name the film-def contract (BRIEF-2 3.2) uses for the context every shot receives. */
export type ShotContext = FilmContext;

/** A subject's world-space box for the lab's framing checks; `must` subjects stay inside the protected box. */
export interface SubjectBox {
  id: string;
  min: [number, number, number];
  max: [number, number, number];
  must: boolean;
}

export interface ShotFrame {
  /** Film time in seconds. */
  time: number;
  /** Seconds since this shot started. */
  local: number;
  /** Shot length in seconds. */
  duration: number;
  /** `local / duration`, clamped to 0..1. */
  progress: number;
  /** Viewport aspect ratio (width / height). */
  aspect: number;
}

export interface ShotView {
  camera: CameraState;
  /** Light rig preset for this frame (the director applies it). */
  lighting: LightingPreset;
  /** Colour grade for this frame. Return the same object every frame when it does not change. */
  grade: GradeParams;
  /** Distance from the camera to the plane in focus (m) and the f-number (0 disables DOF). */
  focus: { distance: number; aperture: number; maxBlur?: number };
  /** Optional screen-space whip blur for fast pans (frame heights). */
  whip?: { direction: [number, number]; amount: number };
  /** Optional additive flash (0..1) and its colour. */
  flash?: { color: number; amount: number };
  /** Optional cross-fade to a flat colour (0..1), used to clear to the brand background. */
  fade?: { color: number; amount: number };
}

export interface Shot {
  id: ShotId;
  set: SetName;
  /** Characters that must be assembled before this shot can play. */
  cast: CharacterId[];
  /**
   * Called when the shot becomes active (including when seeking into it). Show what the shot
   * needs; the director has already hidden every set, character and prop (`hideStage`).
   */
  enter(ctx: FilmContext, frame: ShotFrame): void;
  /** Pose everything for this exact frame and return the camera, light, grade and effects. */
  update(ctx: FilmContext, frame: ShotFrame): ShotView;
  /**
   * Lab only: the shot's subjects at this frame, as world-space boxes (called after `update`, never at runtime).
   * Optional: a shot without it has no framing check yet.
   */
  subjects?(ctx: ShotContext, frame: ShotFrame): readonly SubjectBox[];
}

/**
 * A shot inside a `FilmDef` (film-def.ts): a `Shot` of any film (its id is the film's own) with its place on the
 * film's clock. The director plays `FilmDef.shots` in order; `start` and `end` are film time in seconds.
 */
export interface ShotModule extends Omit<Shot, "id"> {
  id: string;
  start: number;
  end: number;
}
