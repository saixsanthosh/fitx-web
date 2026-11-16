/**
 * Helpers shared by the shot modules. Everything here is stateless or writes into caller-owned
 * scratch objects, so shots stay pure functions of time.
 */

import * as THREE from "three";
import type { CharacterInstance } from "../character/assemble";
import type { BoneName } from "../rig/skeleton";
import type { Vec3Tuple } from "../types";
import type { CameraState } from "./camera";

/**
 * Piecewise-linear time remap for speed ramps: `points` are [filmLocal, action] pairs in
 * increasing film order. Outside the range it extrapolates with the end slopes, so a shot
 * can safely be sampled a little past its edges.
 */
export function timeRamp(points: ReadonlyArray<readonly [number, number]>) {
  return (film: number) => {
    if (points.length === 1) return points[0][1] + (film - points[0][0]);
    let index = 0;
    while (index < points.length - 2 && film > points[index + 1][0]) index += 1;
    const [f0, a0] = points[index];
    const [f1, a1] = points[index + 1];
    return a0 + ((film - f0) / (f1 - f0)) * (a1 - a0);
  };
}

/** Same as `timeRamp` but with smooth (C1) rate changes between segments, for organic slow-motion. */
export function smoothRamp(points: ReadonlyArray<readonly [number, number]>, blend = 0.12) {
  const linear = timeRamp(points);
  return (film: number) => {
    // Average the linear ramp over a small window: removes the rate kinks without drifting.
    const samples = 5;
    let sum = 0;
    for (let index = 0; index < samples; index += 1) sum += linear(film + ((index / (samples - 1)) - 0.5) * blend);
    return sum / samples;
  };
}

const scratchQuat = new THREE.Quaternion();
const yAxis = new THREE.Vector3(0, 1, 0);

/** Put a character's group on an anchor (position + facing), with an optional local offset and extra yaw. */
export function placeOnAnchor(instance: CharacterInstance, anchor: THREE.Object3D, offset: Vec3Tuple = [0, 0, 0], yaw = 0) {
  anchor.updateWorldMatrix(true, false);
  anchor.getWorldPosition(instance.group.position);
  anchor.getWorldQuaternion(instance.group.quaternion);
  if (yaw) instance.group.quaternion.multiply(scratchQuat.setFromAxisAngle(yAxis, yaw));
  const local = new THREE.Vector3(...offset).applyQuaternion(instance.group.quaternion);
  instance.group.position.add(local);
  instance.group.visible = true;
  instance.group.updateMatrixWorld(true);
}

/** World position of a bone after the current pose (updates matrices along the way). */
export function boneWorld(instance: CharacterInstance, bone: BoneName, out = new THREE.Vector3()) {
  instance.group.updateMatrixWorld(true);
  return instance.rig.bones[bone].getWorldPosition(out);
}

/** World position of a point given in a character's local (group) frame. */
export function localToWorld(instance: CharacterInstance, local: Vec3Tuple, out = new THREE.Vector3()) {
  instance.group.updateMatrixWorld(true);
  return instance.group.localToWorld(out.set(local[0], local[1], local[2]));
}

/** Writes a camera state. */
export function cameraState(out: CameraState, position: THREE.Vector3 | Vec3Tuple, target: THREE.Vector3 | Vec3Tuple, focal: number, roll = 0): CameraState {
  if (Array.isArray(position)) out.position.set(position[0], position[1], position[2]);
  else out.position.copy(position);
  if (Array.isArray(target)) out.target.set(target[0], target[1], target[2]);
  else out.target.copy(target);
  out.focal = focal;
  out.roll = roll;
  return out;
}

export function newCameraState(): CameraState {
  return { position: new THREE.Vector3(), target: new THREE.Vector3(), focal: 35, roll: 0 };
}

/** Deterministic, low-frequency "handheld" offset (meters) for a given time and seed. */
export function handheld(time: number, seed: number, amplitude: number, out = new THREE.Vector3()) {
  const n = (f: number, phase: number) =>
    Math.sin(time * f + phase) * 0.6 + Math.sin(time * f * 2.13 + phase * 1.7) * 0.3 + Math.sin(time * f * 4.37 + phase * 0.3) * 0.1;
  return out.set(n(1.3, seed), n(1.1, seed + 2.1) * 0.7, n(0.9, seed + 4.2) * 0.5).multiplyScalar(amplitude);
}

/** Distance from a camera position to a world point (for the focus plane). */
export const focusDistance = (camera: THREE.Vector3, point: THREE.Vector3) => camera.distanceTo(point);

/** Clamp-free linear interpolation between tuples into a vector. */
export function mixInto(out: THREE.Vector3, a: Vec3Tuple, b: Vec3Tuple, t: number) {
  return out.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
}
