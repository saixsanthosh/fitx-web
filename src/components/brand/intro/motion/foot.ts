/**
 * Planted-foot geometry (main thread, `three`). OWNER: motion agent.
 *
 * A planted shoe rolls about one ground pivot at a time — heel contact (toes up), ball joint
 * (heel up, toe segment flat on the ground) or toe tip (whole forefoot peeling off) — so the
 * contact point never slides. `plantFoot` returns the ankle target for the leg IK plus the
 * foot and toe rotations. When the hip cannot reach the ankle it rolls the foot further about
 * the active pivot (raising the heel, the way a real push-off finishes) instead of letting the
 * IK drag the foot.
 */

import * as THREE from "three";
import type { FootMetrics } from "./helpers";

export type Side = "L" | "R";

/** Roll angles in radians, all ≥ 0. Use `heel` alone, or `ball` (+ optional `tip`). */
export interface FootRoll {
  /** Toes-up rotation about the heel contact (heel strike). */
  heel: number;
  /** Heel-up rotation of the foot about the ball (MTP) joint; the toe segment stays flat. */
  ball: number;
  /** Toes-down rotation of the toe segment about the toe tip (end of push-off). */
  tip: number;
}

export interface FootSolution {
  /** Model-space ankle (foot joint) target. */
  ankle: THREE.Vector3;
  /** Model-space rotations of the foot and toe bones. */
  foot: THREE.Quaternion;
  toe: THREE.Quaternion;
  /** Model-space ball (toe) joint. */
  ball: THREE.Vector3;
  /** Model-space ground pivot in use (heel, ball or tip contact on the floor). */
  pivot: THREE.Vector3;
  /** Final heel-up angle of the foot (after reach adaptation); negative for heel pivots. */
  pitch: number;
  /** World pitch of the toe segment. */
  toePitch: number;
}

export function newFootSolution(): FootSolution {
  return {
    ankle: new THREE.Vector3(),
    foot: new THREE.Quaternion(),
    toe: new THREE.Quaternion(),
    ball: new THREE.Vector3(),
    pivot: new THREE.Vector3(),
    pitch: 0,
    toePitch: 0,
  };
}

export interface ReachLimit {
  /** Model-space hip joint. */
  hip: THREE.Vector3;
  /** Largest hip → ankle distance the leg may use. */
  maxReach: number;
  /** Largest heel-up angle the adaptation may use (default 1.35 rad). */
  maxPitch?: number;
}

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const _yawQ = new THREE.Quaternion();
const _rollQ = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _pivot = new THREE.Vector3();
const _invYaw = new THREE.Quaternion();
const _w2 = new THREE.Vector3();

/** Ground-frame position of a bind point for a flat foot whose ball sits over `ground` with heading `yaw`. */
function flatPoint(fm: FootMetrics, ground: THREE.Vector3, yawQ: THREE.Quaternion, bindPoint: THREE.Vector3, out: THREE.Vector3) {
  return out.subVectors(bindPoint, fm.ballGround).applyQuaternion(yawQ).add(ground);
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Rotation angle `a` (about the foot's lateral axis, + = toes down) closest to `a0` for which
 * pivot + Ry(yaw)·Rx(a)·v stays within `R` of `hip`. Analytic (circle/sphere intersection).
 */
export function reachAngle(
  pivot: THREE.Vector3,
  yaw: number,
  v: THREE.Vector3,
  hip: THREE.Vector3,
  R: number,
  a0: number,
  aMin: number,
  aMax: number,
) {
  _invYaw.setFromAxisAngle(AXIS_Y, -yaw);
  _w.subVectors(hip, pivot).applyQuaternion(_invYaw);
  const A = v.y * _w.y + v.z * _w.z;
  const B = v.y * _w.z - v.z * _w.y;
  const C = (v.lengthSq() + _w.lengthSq() - R * R) / 2 - v.x * _w.x;
  const M = Math.hypot(A, B);
  let a = a0;
  if (M > 1e-9) {
    const k = C / M;
    const beta = Math.atan2(B, A);
    if (k > 1) a = beta;
    else if (k > -1) {
      const half = Math.acos(k);
      const d = wrap(a0 - beta);
      if (d > half) a = beta + half;
      else if (d < -half) a = beta - half;
    }
  }
  return THREE.MathUtils.clamp(a, aMin, aMax);
}

/**
 * Pose of a planted foot. `ground` is the model-space floor point under the ball joint of the
 * FLAT foot, `yaw` its heading (+ turns the toes towards the character's left / +X).
 */
export function plantFoot(
  fm: FootMetrics,
  ground: THREE.Vector3,
  yaw: number,
  roll: FootRoll,
  out: FootSolution,
  reach?: ReachLimit,
): FootSolution {
  _yawQ.setFromAxisAngle(AXIS_Y, yaw);
  if (roll.heel > 1e-6) {
    // Heel strike: the whole shoe rotates toes-up about the heel contact.
    flatPoint(fm, ground, _yawQ, fm.heelGround, _pivot);
    _v.subVectors(fm.ankle, fm.heelGround);
    let a = -roll.heel;
    if (reach) a = reachAngle(_pivot, yaw, _v, reach.hip, reach.maxReach, a, -1.2, 0);
    _rollQ.setFromAxisAngle(AXIS_X, a);
    out.foot.copy(_yawQ).multiply(_rollQ);
    out.toe.copy(out.foot);
    out.ankle.copy(_v).applyQuaternion(out.foot).add(_pivot);
    out.ball.subVectors(fm.ball, fm.heelGround).applyQuaternion(out.foot).add(_pivot);
    out.pivot.copy(_pivot);
    out.pitch = a;
    out.toePitch = a;
    return out;
  }

  if (roll.tip > 1e-6) {
    // Toe-off: the toe segment peels about the toe tip, lifting the ball joint.
    flatPoint(fm, ground, _yawQ, fm.tipGround, _pivot);
    _rollQ.setFromAxisAngle(AXIS_X, roll.tip);
    out.toe.copy(_yawQ).multiply(_rollQ);
    out.ball.subVectors(fm.ball, fm.tipGround).applyQuaternion(out.toe).add(_pivot);
    out.pivot.copy(_pivot);
  } else {
    flatPoint(fm, ground, _yawQ, fm.ball, out.ball);
    out.toe.copy(_yawQ);
    flatPoint(fm, ground, _yawQ, fm.ballGround, out.pivot);
  }
  out.toePitch = roll.tip;

  _v.subVectors(fm.ankle, fm.ball);
  let a = Math.max(roll.ball, roll.tip);
  if (reach) {
    const wanted = a;
    a = reachAngle(out.ball, yaw, _v, reach.hip, reach.maxReach, a, roll.tip, reach.maxPitch ?? 1.35);
    // A flat foot the hip cannot reach from behind keeps rolling on its heel (toes up) until
    // the hip comes over it, instead of snapping heel-up about the ball.
    if (a > wanted + 1e-6 && wanted < 1e-6 && roll.tip <= 1e-6) {
      flatPoint(fm, ground, _yawQ, fm.heelGround, _pivot);
      _w2.subVectors(fm.ankle, fm.heelGround);
      const ah = reachAngle(_pivot, yaw, _w2, reach.hip, reach.maxReach, 0, -1.2, 0);
      if (-ah < a) {
        _rollQ.setFromAxisAngle(AXIS_X, ah);
        out.foot.copy(_yawQ).multiply(_rollQ);
        out.toe.copy(out.foot);
        out.ankle.copy(_w2).applyQuaternion(out.foot).add(_pivot);
        out.ball.subVectors(fm.ball, fm.heelGround).applyQuaternion(out.foot).add(_pivot);
        out.pivot.copy(_pivot);
        out.pitch = ah;
        out.toePitch = ah;
        return out;
      }
    }
  }
  _rollQ.setFromAxisAngle(AXIS_X, a);
  out.foot.copy(_yawQ).multiply(_rollQ);
  out.ankle.copy(_v).applyQuaternion(out.foot).add(out.ball);
  out.pitch = a;
  return out;
}

/** Ankle position of a flat foot (no roll) — handy for setting up stances. */
export function flatAnkle(fm: FootMetrics, ground: THREE.Vector3, yaw: number, out: THREE.Vector3) {
  _yawQ.setFromAxisAngle(AXIS_Y, yaw);
  return flatPoint(fm, ground, _yawQ, fm.ankle, out);
}
