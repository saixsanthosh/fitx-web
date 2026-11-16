/**
 * Additive layers applied after a driver (main thread). OWNER: motion agent.
 * Each layer post-multiplies small local rotations, so call them after the driver and before
 * the ponytail spring reads the head. Layers that move the chest also carry the arms; keep
 * `applyBreath` small while hands are locked to props (bar, hoods, glass).
 */

import * as THREE from "three";
import type { Rig } from "../rig/three-rig";
import { clamp, hash1 } from "../math";
import { boneWorldPosition, boneWorldQuaternion } from "../rig/ik";
import { quatXYZ, rigMetrics } from "./helpers";

const _q = new THREE.Quaternion();

/** Breathing phase 0 (exhaled) → 1 (inhaled); inhale ~40 % of the cycle, slower exhale. */
export function breathCycle(t: number, rate = 0.28, phase = 0) {
  const x = (((t * rate + phase) % 1) + 1) % 1;
  return x < 0.4 ? 0.5 - 0.5 * Math.cos((x / 0.4) * Math.PI) : 0.5 + 0.5 * Math.cos(((x - 0.4) / 0.6) * Math.PI);
}

/**
 * Chest rises and expands on the inhale (spine/chest extension, shoulders lift), the neck
 * counters so the gaze stays put. `amount` 1 = calm resting breath, 2–3 = after effort.
 */
export function applyBreath(rig: Rig, t: number, amount: number, opts: { rate?: number; phase?: number } = {}) {
  if (amount <= 0) return;
  const b = breathCycle(t, opts.rate ?? 0.28, opts.phase ?? 0) * amount;
  const bones = rig.bones;
  bones.spine.quaternion.multiply(quatXYZ(-0.008 * b, 0, 0, _q));
  bones.chest.quaternion.multiply(quatXYZ(-0.02 * b, 0, 0, _q));
  bones.neck.quaternion.multiply(quatXYZ(0.024 * b, 0, 0, _q));
  bones.shoulder_L.quaternion.multiply(quatXYZ(0, 0, 0.018 * b, _q));
  bones.shoulder_R.quaternion.multiply(quatXYZ(0, 0, -0.018 * b, _q));
}

export interface HeadLookOptions {
  /** Max yaw / pitch of the head relative to the chest (rad). */
  maxYaw?: number;
  maxPitch?: number;
  /** Share of the turn taken by the neck (rest by the head). */
  neckShare?: number;
}

const _eye = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _chestQ = new THREE.Quaternion();
const _inv = new THREE.Quaternion();
const _cur = new THREE.Quaternion();
const _rel = new THREE.Quaternion();
const _want = new THREE.Quaternion();
const _headQ = new THREE.Quaternion();
const _tmp = new THREE.Vector3();
const _id = new THREE.Quaternion();

/**
 * Turns neck + head towards `targetWorld` (eyes level), limited relative to the chest and
 * blended by `weight` (0..1). The character group's world transform must be current.
 */
export function applyHeadLook(rig: Rig, targetWorld: THREE.Vector3, weight: number, opts: HeadLookOptions = {}) {
  if (weight <= 0) return;
  const m = rigMetrics(rig);
  const head = rig.bones.head;
  boneWorldQuaternion(head, _headQ);
  boneWorldPosition(head, _eye);
  _tmp.subVectors(m.eyeMid, m.head).applyQuaternion(_headQ);
  _eye.add(_tmp);
  _dir.subVectors(targetWorld, _eye);
  if (_dir.lengthSq() < 1e-8) return;
  // Desired direction in the chest frame → limited yaw/pitch.
  boneWorldQuaternion(rig.bones.chest, _chestQ);
  _inv.copy(_chestQ).invert();
  _dir.applyQuaternion(_inv).normalize();
  const yaw = clamp(Math.atan2(_dir.x, _dir.z), -(opts.maxYaw ?? 1.2), opts.maxYaw ?? 1.2);
  const pitch = clamp(Math.asin(clamp(-_dir.y, -1, 1)), -(opts.maxPitch ?? 0.6), opts.maxPitch ?? 0.7);
  quatXYZ(0, yaw, 0, _want).multiply(quatXYZ(pitch, 0, 0, _q));
  // Current head orientation relative to the chest, blended towards the look.
  _cur.copy(rig.bones.neck.quaternion).multiply(head.quaternion);
  _rel.copy(_cur).slerp(_want, clamp(weight, 0, 1));
  const share = opts.neckShare ?? 0.4;
  rig.bones.neck.quaternion.copy(_id).slerp(_rel, share);
  head.quaternion.copy(rig.bones.neck.quaternion).invert().multiply(_rel);
}

/**
 * Natural blink timing: one blink every ~2.5–5.5 s (jittered, occasionally doubled), each a
 * fast close (≈70 ms) and slower open (≈130 ms). Returns lid closure 0..1. Pure function of t.
 */
export function blinkAmount(t: number, seed = 0) {
  const cell = 3.6;
  const i = Math.floor(t / cell);
  let v = 0;
  for (let c = i - 1; c <= i + 1; c += 1) {
    const base = c * cell + 0.3 + hash1(c * 131 + seed * 977) * (cell - 0.6);
    v = Math.max(v, blinkShape(t - base));
    if (hash1(c * 71 + seed * 313 + 9) < 0.18) v = Math.max(v, blinkShape(t - base - 0.32));
  }
  return v;
}

function blinkShape(dt: number) {
  if (dt < 0 || dt > 0.2) return 0;
  if (dt < 0.07) {
    const x = dt / 0.07;
    return x * x * (3 - 2 * x);
  }
  const x = (dt - 0.07) / 0.13;
  return 1 - x * x * (3 - 2 * x);
}
