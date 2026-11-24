/**
 * Lab framing subjects (BRIEF-2 3.2): world-space boxes round the parts of a character or prop that a shot must keep in
 * frame (`ShotModule.subjects`; the lab's `project()` projects them and `verify.mjs --framing` holds every `must` box
 * inside the protected box). Shared by both films' shots and the node framing tests, so it stays node-safe: three.js
 * and the rig's pure bind pose only (the intro's `shots/common.ts` re-exports the intro's four helpers from here).
 *
 * Every box is computed from the posed rig (bone world positions, and the bind pose's landmarks where the bones carry
 * them now), never from numbers tuned to a frame.
 */

import * as THREE from "three";
import type { CharacterInstance } from "../character/assemble";
import { pointOf, type BoneName, type LandmarkName } from "../rig/skeleton";
import type { SubjectBox } from "./shot-types";

const _subject = new THREE.Vector3();

/** A world-space box around a point (`half` metres each way, or per axis). */
export function pointBox(id: string, point: THREE.Vector3Like, half: number | [number, number, number], must: boolean, clearOfOverlay = true): SubjectBox {
  const [hx, hy, hz] = typeof half === "number" ? [half, half, half] : half;
  return { id, min: [point.x - hx, point.y - hy, point.z - hz], max: [point.x + hx, point.y + hy, point.z + hz], must, clearOfOverlay };
}

/**
 * A box round a character's face: brow to chin and cheek to cheek, above the head joint (the crown and
 * the ears may leave the frame in a close shot; the face may not).
 */
export function headBox(instance: CharacterInstance, id: string, must: boolean): SubjectBox {
  instance.rig.bones.head.getWorldPosition(_subject);
  _subject.y += 0.08;
  return pointBox(id, _subject, [0.075, 0.085, 0.075], must);
}

/** A box round some of a character's joints, padded by `pad` metres (feet and hands carry their own size). */
export function jointsBox(instance: CharacterInstance, id: string, bones: readonly BoneName[], pad: number, must: boolean, clearOfOverlay = true): SubjectBox {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const name of bones) {
    instance.rig.bones[name].getWorldPosition(_subject);
    for (let c = 0; c < 3; c += 1) {
      const value = _subject.getComponent(c);
      min[c] = Math.min(min[c], value - pad);
      max[c] = Math.max(max[c], value + pad);
    }
  }
  return { id, min, max, must, clearOfOverlay };
}

const BODY_JOINTS: readonly BoneName[] = ["hips", "chest", "head", "hand_L", "hand_R", "lowerArm_L", "lowerArm_R", "lowerLeg_L", "lowerLeg_R", "foot_L", "foot_R", "toe_L", "toe_R"];

/** The whole body, head to toes: inside the frame, but a title may cross it (`clearOfOverlay` false). */
export function bodyBox(instance: CharacterInstance, id: string, must: boolean): SubjectBox {
  const box = jointsBox(instance, id, BODY_JOINTS, 0.06, must, false);
  // The crown sits ~0.22 m above the head joint; the soles a few centimetres under the ankles.
  instance.rig.bones.head.getWorldPosition(_subject);
  box.max[1] = Math.max(box.max[1], _subject.y + 0.2);
  box.min[1] = Math.max(0, box.min[1] - 0.03);
  return box;
}

// ------------------------------------------------------------------------------------------------- from the landmarks

const _bone = new THREE.Vector3();

/** Where `bone` carries one of the bind pose's landmarks now (bind rotations are identity, so the bind offset is bone-local). */
export function landmarkWorld(instance: CharacterInstance, bone: BoneName, landmark: LandmarkName, out = new THREE.Vector3()): THREE.Vector3 {
  const at = pointOf(instance.rig.bind, bone);
  const mark = pointOf(instance.rig.bind, landmark);
  out.set(mark[0] - at[0], mark[1] - at[1], mark[2] - at[2]);
  instance.rig.bones[bone].updateWorldMatrix(true, false);
  return instance.rig.bones[bone].localToWorld(out);
}

function expand(box: SubjectBox, point: THREE.Vector3, pad = 0) {
  for (let c = 0; c < 3; c += 1) {
    const value = point.getComponent(c);
    box.min[c] = Math.min(box.min[c], value - pad);
    box.max[c] = Math.max(box.max[c], value + pad);
  }
}

/**
 * The face of a turned head: `headBox` (centred on the head joint, so a frontal face fills it) widened to hold the
 * rig's own face landmarks where the head bone carries them (between the eyes and the chin, at the front of the face),
 * so a face seen in profile or bent towards the floor is inside its box too. Never smaller than `headBox`.
 */
export function faceBox(instance: CharacterInstance, id: string, must: boolean): SubjectBox {
  const box = headBox(instance, id, must);
  expand(box, landmarkWorld(instance, "head", "eyeMid", _bone));
  expand(box, landmarkWorld(instance, "head", "chin", _bone));
  return box;
}

/**
 * Half a palm's width (m): the hand sculpt's knuckles span ±2.6 cm about the middle finger on its 19 cm reference hand,
 * plus a finger's radius, rounded up. Pads the line from wrist to fingertip into the whole hand.
 */
export const PALM_HALF_WIDTH = 0.04;

/**
 * Both hands, palm and fingers: from each wrist joint to its fingertip (the rig's `handTip` landmark, carried by the
 * hand bone), padded by half a palm. Palms flat on a plate point their fingers up and out, which a box round the wrist
 * joints alone would leave out.
 */
export function handsBox(instance: CharacterInstance, id: string, must: boolean): SubjectBox {
  const box: SubjectBox = { id, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], must, clearOfOverlay: true };
  for (const side of ["L", "R"] as const) {
    expand(box, instance.rig.bones[`hand_${side}`].getWorldPosition(_bone), PALM_HALF_WIDTH);
    expand(box, landmarkWorld(instance, `hand_${side}`, `handTip_${side}`, _bone), PALM_HALF_WIDTH);
  }
  return box;
}
