/**
 * Hand frames and grip points (main thread). OWNER: motion agent.
 *
 * Bind hand frame (both sides, world-aligned because bind rotations are identity):
 * - `finger` = wrist → finger tip (down and out along the A-pose arm line),
 * - `palm`   = palm normal, perpendicular to the fingers in the frontal plane, facing the thigh,
 * - `thumb`  = +Z (forward).
 *
 * Grip contract with the hand meshes (`character/hands.ts`): an object held in the `grip`
 * pose has its axis along the hand's thumb axis and passes through
 *   wrist + finger · (along · handLength) + palm · (palm · handLength)
 * with {along, palm} = `GRIP_BAR` for bar-sized (Ø 28–32 mm) handles and `GRIP_GLASS` for a
 * Ø 74 mm glass. `handLength` = |handTip − hand| in the bind pose.
 */

import * as THREE from "three";
import type { Rig } from "../rig/three-rig";
import { mapFrame } from "../rig/ik";
import type { Side } from "./foot";
import { rigMetrics } from "./helpers";
import type { HandPose } from "../character/types";

export const GRIP_BAR = { along: 0.47, palm: 0.15 } as const;
export const GRIP_GLASS = { along: 0.42, palm: 0.3 } as const;

export interface HandFrame {
  finger: THREE.Vector3;
  palm: THREE.Vector3;
  thumb: THREE.Vector3;
}

export interface HandPoses {
  L: HandPose;
  R: HandPose;
}

const frames = new WeakMap<Rig, Record<Side, HandFrame>>();
const Z = new THREE.Vector3(0, 0, 1);

export function handBindFrame(rig: Rig, side: Side): HandFrame {
  let f = frames.get(rig);
  if (!f) {
    const make = (s: Side): HandFrame => {
      const finger = rig.bindLocal[`hand_${s}`].clone().normalize();
      const sx = s === "L" ? 1 : -1;
      const palm = new THREE.Vector3().crossVectors(finger, Z).multiplyScalar(sx).normalize();
      return { finger, palm, thumb: Z.clone() };
    };
    f = { L: make("L"), R: make("R") };
    frames.set(rig, f);
  }
  return f[side];
}

/** Rotation (same space as the inputs) that puts the hand's fingers along `finger` and its palm towards `palm`. */
export function handRotation(rig: Rig, side: Side, finger: THREE.Vector3, palm: THREE.Vector3, out: THREE.Quaternion) {
  const b = handBindFrame(rig, side);
  return mapFrame(b.finger, b.palm, finger, palm, out);
}

const _f = new THREE.Vector3();
const _p = new THREE.Vector3();

/** Offset from the wrist joint to the grip centre for a hand rotated by `q`. */
export function gripOffset(rig: Rig, side: Side, q: THREE.Quaternion, grip: { along: number; palm: number }, out: THREE.Vector3) {
  const b = handBindFrame(rig, side);
  const L = rigMetrics(rig).handLength;
  _f.copy(b.finger).applyQuaternion(q).multiplyScalar(grip.along * L);
  _p.copy(b.palm).applyQuaternion(q).multiplyScalar(grip.palm * L);
  return out.copy(_f).add(_p);
}
