/**
 * Seated at the refuel table: reach, lift, clink, sip / laugh (main thread). OWNER: motion agent.
 *
 * Character frame: the group origin is on the floor under the seat centre, facing the table
 * centre along +Z (the director rotates seat 0 by +90° and seat 1 by −90° about Y and puts the
 * groups at TABLE.seats[seat] with y = 0). In that frame both seats see the same layout: the
 * glass on the right at (−0.25, 0.75, 0.50) and the table centre at z = 0.86.
 * Timeline (s): 0–0.7 reach and lift the glass, 0.7–1.1 clink above the table centre at 1.05,
 * 1.1–2.0 seat 0 (Maya) sips, smiles and turns to Dre; seat 1 (Dre) leans back laughing.
 *
 * Glass contract: the glass origin is its base centre with +Y along its axis. While held it is
 * returned in WORLD space (re-parent or copy each frame); `glassLocal` is always in model space.
 */

import * as THREE from "three";
import { TABLE } from "../dimensions";
import type { Rig } from "../rig/three-rig";
import { lerp, smootherstep01 } from "../math";
import { PoseContext, bump, hermite, quatXYZ, ramp, rigMetrics, updateHelperBones } from "./helpers";
import { GRIP_GLASS, gripOffset, handRotation, type HandPoses } from "./hands";
import { flatAnkle, type Side } from "./foot";
import { setShoulderGirdle, stabiliseHead } from "./upper";

export interface GlassTransform {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

export interface TableResult {
  /** World transform of the held glass (null while it rests on the table). */
  glass: GlassTransform | null;
  /** Model-space transform of the glass (resting or held). */
  glassLocal: GlassTransform;
  hands: HandPoses;
  /** Expression cues for the face rig, 0..1. */
  face: { smile: number; laugh: number };
  /** Time of the clink (glasses touch). */
  clinkTime: number;
}

export const TABLE_EVENTS = { graspTime: 0.45, clinkTime: 1.05 } as const;

/** Seat-local layout derived from TABLE (identical for both seats by symmetry). */
export function tableLocal() {
  const seat = TABLE.seats[0];
  const place = TABLE.places[0];
  // Seat 0 faces +X: local = Ry(−90°)·(world − seatFloor) → (x, y, z) = (−wz, wy, wx).
  const toLocal = (p: readonly number[]) => new THREE.Vector3(-(p[2] - seat[2]), p[1], p[0] - seat[0]);
  return {
    glass: toLocal(place.glass),
    bowl: toLocal(place.bowl),
    center: toLocal([0, TABLE.height, 0]),
    edgeZ: -seat[0] - TABLE.width / 2,
  };
}

const LAYOUT = tableLocal();
const GLASS_GRIP_HEIGHT = 0.07;
/** Glasses touch with their centres 2·radius apart; each stops just short of the centre line. */
const CLINK_LOCAL = new THREE.Vector3(-0.015, 0.95, LAYOUT.center.z - TABLE.glassRadius + 0.0015);

const ctx = new PoseContext();
const AY = new THREE.Vector3(0, 1, 0);
const AX = new THREE.Vector3(1, 0, 0);
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _ground = new THREE.Vector3();
const _ankle = new THREE.Vector3();
const _hip = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _sh = new THREE.Vector3();
const _glass = new THREE.Vector3();
const _wrist = new THREE.Vector3();
const _hq = new THREE.Quaternion();
const _f = new THREE.Vector3();
const _n = new THREE.Vector3();
const _off = new THREE.Vector3();
const _mouth = new THREE.Vector3();
const _hqW = new THREE.Quaternion();
const _ctrl = new THREE.Vector3();
const _wW = new THREE.Vector3();
const GLASS_FROM_HAND = new THREE.Quaternion().setFromAxisAngle(AX, Math.PI / 2);

/**
 * Hand orientation for holding an upright glass approached along `dir` (horizontal part):
 * thumb up along the glass, palm facing the glass from its outer side, fingers wrapping the
 * front. `tilt` leans the glass top forward along the fingers (towards the clink partner).
 */
function glassHand(rig: Rig, side: Side, dir: THREE.Vector3, tilt: number, out: THREE.Quaternion) {
  const len = Math.hypot(dir.x, dir.z) || 1;
  const ax = dir.x / len;
  const az = dir.z / len;
  if (side === "R") {
    _n.set(az, 0, -ax);
    _f.crossVectors(_n, AY);
  } else {
    _n.set(-az, 0, ax);
    _f.crossVectors(AY, _n);
  }
  _f.y -= tilt;
  return handRotation(rig, side, _f, _n, out);
}

export function poseTable(rig: Rig, t: number, seat: 0 | 1): TableResult {
  rig.resetPose();
  ctx.begin(rig);
  const b = rig.bones;
  const m = rigMetrics(rig);
  const k = m.height / 1.75;
  const E = TABLE_EVENTS;
  const maya = seat === 0;

  // Torso: lean in for the clink, then sip (Maya) or lean back laughing (Dre).
  const reach = ramp(0.1, 0.55, t) * (1 - ramp(0.55, 0.8, t) * 0.4);
  const leanIn = ramp(0.65, 1.0, t) * (1 - ramp(1.1, 1.45, t));
  const laugh = maya ? 0 : ramp(1.12, 1.4, t);
  const sip = maya ? bump(1.15, 2.05, t) : 0;
  const shake = laugh * Math.sin(t * Math.PI * 2 * 5.2) * (1 - ramp(1.75, 2.0, t) * 0.6);
  // The clink sits 0.86 m from each seat: both lean well in (and slide forward on the seat) so the
  // elbows stay bent at contact instead of locking straight at shoulder height.
  const lean = 0.1 + 0.12 * reach + (maya ? 0.6 : 0.48) * leanIn - 0.32 * laugh + 0.06 * sip;
  const turn = maya ? 0.1 * ramp(1.35, 1.8, t) : -0.06 * laugh;

  // Seated pelvis: hip joints ~10 cm above the seat, sitting forward.
  const pelvisPitch = 0.12 + 0.35 * lean;
  quatXYZ(pelvisPitch, 0.05 * turn, 0, _q);
  _mid.set(0, TABLE.seatHeight + 0.098 * k, -0.035 * k + (maya ? 0.09 : 0.07) * leanIn);
  _v.copy(m.hipJoint.L).add(m.hipJoint.R).multiplyScalar(0.5).sub(m.hips).applyQuaternion(_q);
  b.root.position.set(0, 0, 0);
  b.hips.position.subVectors(_mid, _v);
  b.hips.quaternion.copy(_q);
  quatXYZ(0.3 * lean - 0.02 + 0.03 * shake, 0.4 * turn, 0, b.spine.quaternion);
  quatXYZ(0.35 * lean - 0.02 + 0.04 * shake, 0.6 * turn, 0.02 * shake, b.chest.quaternion);

  // Legs: feet flat under the knees.
  for (const side of ["L", "R"] as const) {
    const sx = side === "L" ? 1 : -1;
    _ground.set(sx * 0.13 * k, 0, 0.47 * k);
    flatAnkle(m.foot[side], _ground, sx * 0.12, _ankle);
    _q.setFromAxisAngle(AY, sx * 0.12);
    ctx.bonePos(`upperLeg_${side}`, _hip);
    _pole.set(sx * 0.15, 0.4, 1).multiplyScalar(2 * m.leg).add(_hip);
    ctx.ik(`leg_${side}`, _ankle, _pole, { maxExtension: 0.9995 }, _q);
  }

  // Glass path (model space, base centre).
  const rest = LAYOUT.glass;
  const grasp = E.graspTime;
  const lifted = _v.copy(rest).add(_off.set(0.03, 0.09, -0.04));
  if (t <= grasp) _glass.copy(rest);
  else if (t <= 0.7) _glass.lerpVectors(rest, lifted, smootherstep01((t - grasp) / (0.7 - grasp)));
  else {
    // Ease into the clink (decelerating), small recoil after contact.
    const toClink = _off.copy(CLINK_LOCAL);
    const u = Math.min(1, (t - 0.7) / (E.clinkTime - 0.7));
    // Leaves the lift at rest, arrives still moving so the clink reads as an impact.
    const e = hermite(0, 0, 1, 0.7, u);
    _glass.lerpVectors(lifted, toClink, e);
    _glass.z -= 0.018 * bump(E.clinkTime, E.clinkTime + 0.22, t);
    if (t > 1.12) {
      // Afterwards: Maya brings the straw to her lips; Dre pulls the glass to his chest.
      const w = smootherstep01((t - 1.12) / 0.38);
      if (maya) {
        // Straw tip at the lips: glass base ≈ head joint + lips offset − straw height.
        ctx.bonePos("head", _mouth);
        _mouth.add(_off.set(-0.004, 0.028 * k - 0.205, 0.108 * k));
        _glass.lerp(_mouth, w * (1 - ramp(1.85, 2.15, t) * 0.5));
      } else {
        _glass.lerp(_off.set(-0.17 * k, 0.92 * k, 0.3 * k), w);
      }
    }
  }
  const tilt = 0.05 * bump(0.95, 1.15, t) + (maya ? 0.08 * sip : 0);

  // Right arm: reach → grasp → hold.
  const handPose: HandPoses = { L: "relaxed", R: "relaxed" };
  ctx.bonePos("upperArm_R", _sh);
  const approach = _f.subVectors(_glass, _sh);
  glassHand(rig, "R", approach, tilt, _hq);
  _glass.y += GLASS_GRIP_HEIGHT;
  gripOffset(rig, "R", _hq, GRIP_GLASS, _off);
  const holdWrist = _wrist.subVectors(_glass, _off);
  _glass.y -= GLASS_GRIP_HEIGHT;
  // Before the grasp the hand comes up from the lap (out of the overhead frame), over the table
  // edge and in to the glass: a quadratic Bezier whose control point sits high over the edge, so
  // the hand clears it instead of passing through.
  const restWrist = _ankle.set(-0.17 * k, TABLE.seatHeight + 0.17 * k, LAYOUT.edgeZ - 0.02 * k);
  const reachU = smootherstep01((t - 0.1) / (grasp - 0.1));
  if (reachU < 1) {
    _ctrl.set((restWrist.x + holdWrist.x) / 2, TABLE.height + 0.4, LAYOUT.edgeZ - 0.1);
    const a = (1 - reachU) * (1 - reachU);
    const b = 2 * reachU * (1 - reachU);
    const c = reachU * reachU;
    holdWrist.set(
      a * restWrist.x + b * _ctrl.x + c * holdWrist.x,
      a * restWrist.y + b * _ctrl.y + c * holdWrist.y,
      a * restWrist.z + b * _ctrl.z + c * holdWrist.z,
    );
  }
  setShoulderGirdle(rig, "R", 0.12 * reach + 0.2 * leanIn, 0.04 * leanIn);
  _pole.copy(_sh).add(_off.set(-0.5, -0.4, -0.3));
  ctx.ik("arm_R", holdWrist, _pole, { maxExtension: 0.9995, twistToLower: 0.5 }, _hq);
  handPose.R = t < grasp - 0.15 ? "relaxed" : t < grasp ? "open" : "grip";

  // Left hand rests on the table edge (Dre: on the table, then on his chest while laughing).
  ctx.bonePos("upperArm_L", _sh);
  _wrist.set(0.16 * k, TABLE.height + 0.03, LAYOUT.edgeZ + 0.1 * k);
  if (!maya) _wrist.lerp(_off.set(0.06 * k, 0.98 * k, 0.2 * k), 0.6 * laugh);
  _f.set(-0.2, -0.25, 1);
  _n.set(0, -1, 0);
  handRotation(rig, "L", _f, _n, _hq);
  _pole.copy(_sh).add(_off.set(0.5, -0.4, -0.3));
  ctx.ik("arm_L", _wrist, _pole, { maxExtension: 0.9995, twistToLower: 0.5 }, _hq);

  // Head: eyes on the glass, then the clink, then Maya turns to Dre with a tilt; Dre throws
  // his head back laughing.
  const lookDown = 0.42 * (1 - ramp(0.6, 1.0, t)) + 0.2;
  const gaze = maya ? lerp(lookDown, 0.02, ramp(1.3, 1.7, t)) + 0.25 * sip : lookDown - 0.55 * laugh;
  stabiliseHead(ctx, rig, gaze, maya ? 0.12 * ramp(1.35, 1.8, t) : 0, 0.45, maya ? 0.12 * ramp(1.4, 1.85, t) : 0.04 * shake);

  updateHelperBones(rig);

  // Glass transform from the posed hand.
  const held = t >= grasp;
  const glassLocal: GlassTransform = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  let glass: GlassTransform | null = null;
  if (held) {
    ctx.boneQuat("hand_R", _hq);
    ctx.bonePos("hand_R", _wrist);
    gripOffset(rig, "R", _hq, GRIP_GLASS, _off);
    glassLocal.quaternion.copy(_hq).multiply(GLASS_FROM_HAND);
    _v.set(0, GLASS_GRIP_HEIGHT, 0).applyQuaternion(glassLocal.quaternion);
    glassLocal.position.copy(_wrist).add(_off).sub(_v);
    ctx.toWorld(glassLocal.position, _wW);
    ctx.quatToWorld(glassLocal.quaternion, _hqW);
    glass = { position: _wW.clone(), quaternion: _hqW.clone() };
  } else {
    glassLocal.position.copy(rest);
  }
  // Maya only opens into a laugh once the straw has left her lips (the mouth would part round it).
  const smile = maya ? 0.35 + 0.65 * ramp(1.2, 1.7, t) : 0.4 + 0.6 * laugh;
  return { glass, glassLocal, hands: handPose, face: { smile, laugh: maya ? 0.3 * ramp(1.5, 1.9, t) * (1 - sip) : laugh }, clinkTime: E.clinkTime };
}
