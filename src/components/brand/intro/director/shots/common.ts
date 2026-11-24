/**
 * Shared helpers for the act modules: grade/light lookup, subject-relative camera tracks,
 * character staging and per-shot ponytail springs. Everything stays a pure function of time.
 */

import * as THREE from "three";
import type { CharacterInstance } from "../../character/assemble";
import type { CharacterId } from "../../character/types";
import { GRADES, type GradeName, type GradeParams } from "../../fx/post";
import type { LightingPreset } from "../../lighting";
import { applyHeadLook, applyBreath, blinkAmount, PonytailSpring } from "../../motion";
import { shiftPreset } from "../../sets";
import type { Theme } from "../../types";
import { createCameraState, evaluateCameraTrack, type CameraState, type CameraTrack } from "../camera";
import type { FilmContext } from "../shot-types";
import type { SetName } from "../stage-kit";

/** The grade for a theme: `light` name on the light theme, `dark` name on the dark one. */
export function gradeFor(theme: Theme, light: GradeName, dark: GradeName): GradeParams {
  return GRADES[theme === "light" ? light : dark];
}

const presetCache = new Map<string, LightingPreset>();

/**
 * The set's preset for a variant on the current theme. Cached: presets are plain data that
 * `applyLightingPreset` only reads, so one object per (set, variant, theme) is enough.
 */
export function lightingFor(ctx: FilmContext, set: SetName, variant: string): LightingPreset {
  const key = `${set}|${variant}|${ctx.theme}`;
  let preset = presetCache.get(key);
  if (!preset) {
    preset = ctx.sets[set].lighting(variant);
    presetCache.set(key, preset);
  }
  return preset;
}

/** Preset whose sun shadow frustum (and rim) follow a moving subject: `offset` from the variant's own target. */
export function followLighting(ctx: FilmContext, set: SetName, variant: string, offset: THREE.Vector3Like): LightingPreset {
  return shiftPreset(lightingFor(ctx, set, variant), offset);
}

const scratchState = createCameraState();

/**
 * Evaluates a camera track authored relative to `origin` (e.g. a runner's smoothed position)
 * and writes the world-space result into `out`.
 */
export function followTrack(track: CameraTrack, t: number, aspect: number, origin: THREE.Vector3Like, out: CameraState): CameraState {
  evaluateCameraTrack(track, t, aspect, scratchState);
  out.position.copy(scratchState.position).add(origin);
  out.target.copy(scratchState.target).add(origin);
  out.focal = scratchState.focal;
  out.roll = scratchState.roll;
  return out;
}

/** Shows a character at a world position and yaw (radians about +Y; 0 faces +Z). */
export function stage(ctx: FilmContext, id: CharacterId, position: THREE.Vector3Like, yaw = 0): CharacterInstance {
  const instance = ctx.cast[id];
  if (!instance) throw new Error(`character ${id} is not ready`);
  instance.group.position.set(position.x, position.y, position.z);
  instance.group.rotation.set(0, yaw, 0);
  instance.group.visible = true;
  instance.group.updateMatrixWorld(true);
  return instance;
}

/** Shows a character on a set anchor (its +Z is the facing direction). */
export function stageOnAnchor(ctx: FilmContext, id: CharacterId, anchor: THREE.Object3D, offset: THREE.Vector3Like = { x: 0, y: 0, z: 0 }): CharacterInstance {
  anchor.updateWorldMatrix(true, false);
  const position = anchor.getWorldPosition(new THREE.Vector3());
  const quaternion = anchor.getWorldQuaternion(new THREE.Quaternion());
  position.add(new THREE.Vector3(offset.x, offset.y, offset.z).applyQuaternion(quaternion));
  const yaw = new THREE.Euler().setFromQuaternion(quaternion, "YXZ").y;
  return stage(ctx, id, position, yaw);
}

const springs = new WeakMap<CharacterInstance, Map<string, PonytailSpring>>();

/** One ponytail spring per (character, shot): each re-simulates deterministically from its shot's action start. */
export function ponytailFor(instance: CharacterInstance, key: string, startTime: number): PonytailSpring {
  let map = springs.get(instance);
  if (!map) {
    map = new Map();
    springs.set(instance, map);
  }
  let spring = map.get(key);
  if (!spring) {
    spring = new PonytailSpring(instance.rig, { startTime });
    map.set(key, spring);
  }
  return spring;
}

/** Poses a character with `drive` (and Maya's ponytail, if she has one in this shot). */
export function poseWithHair<T>(instance: CharacterInstance, key: string, startTime: number, action: number, drive: (time: number) => T): T {
  instance.group.updateMatrixWorld(true);
  if (instance.id !== "maya") return drive(action);
  let result: T | undefined;
  ponytailFor(instance, key, startTime).simulateTo(instance.rig, action, (time) => {
    result = drive(time);
  });
  return result as T;
}

/** Breath, a soft head look toward `lookAt` and natural blinks on top of a driver's pose. */
export function liveLayers(instance: CharacterInstance, time: number, options: { lookAt?: THREE.Vector3; lookWeight?: number; breath?: number; gaze?: THREE.Vector3 | null; seed: number }) {
  if (options.breath) applyBreath(instance.rig, time, options.breath, { phase: options.seed * 0.37 });
  if (options.lookAt && (options.lookWeight ?? 0) > 0) {
    instance.group.updateMatrixWorld(true);
    applyHeadLook(instance.rig, options.lookAt, options.lookWeight ?? 0);
  }
  instance.face.setBlink(blinkAmount(time, options.seed));
  instance.face.setGaze(options.gaze ?? null);
}

/** Smooth 0→1 between `a` and `b`. */
export function window01(a: number, b: number, x: number) {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
}

/** Camera-to-point distance (for the focus plane). */
export function focusOn(camera: CameraState, point: THREE.Vector3) {
  return camera.position.distanceTo(point);
}

// ---------------------------------------------------------------------------------- lab subjects

// The lab's subject boxes live in a node-safe module the welcome film's shots share (this file is not node-safe).
export { bodyBox, headBox, jointsBox, pointBox } from "../subject-boxes";
