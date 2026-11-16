/**
 * Humanoid skeleton contract (worker-safe: no `three`, no DOM).
 *
 * Conventions — every module relies on these:
 * - Units are meters. +Y is up. A character faces +Z. The character's LEFT side is +X.
 *   Bone suffix `_L` / `_R` is the character's own left / right.
 * - Bind pose is an A-pose standing in shoes: arms hang down-and-out at `armAbduction`
 *   from vertical in the frontal (XY) plane with palms facing the thighs, legs nearly
 *   vertical (`legAbduction`), feet pointing +Z, `root` at the floor under the pelvis.
 * - EVERY bone has an identity bind rotation. A bone's bind world position is its joint
 *   centre; its local bind position is `world - parentWorld`. Animation therefore rotates
 *   bones in their parent's (world-aligned at bind) frame: rotating `lowerLeg_L` about +X
 *   by a positive angle swings the shin backwards (knee flexion), etc. Use the IK helpers
 *   in `rig/ik.ts` rather than hand-deriving axes where possible.
 * - Helper bones (`elbowHelper_*`, `kneeHelper_*`) sit at the elbow/knee, are children of the
 *   upper segment and must be set every frame to half the lower segment's rotation
 *   (`motion/` provides `updateHelperBones`). They keep elbows and knees from collapsing
 *   under linear blend skinning.
 * - `pony1..4` exist on every character; only characters with a ponytail skin to them.
 */

import type { Vec3Tuple } from "../types";

export const BONE_NAMES = [
  "root",
  "hips",
  "spine",
  "chest",
  "neck",
  "head",
  "shoulder_L",
  "upperArm_L",
  "lowerArm_L",
  "hand_L",
  "shoulder_R",
  "upperArm_R",
  "lowerArm_R",
  "hand_R",
  "upperLeg_L",
  "lowerLeg_L",
  "foot_L",
  "toe_L",
  "upperLeg_R",
  "lowerLeg_R",
  "foot_R",
  "toe_R",
  "elbowHelper_L",
  "elbowHelper_R",
  "kneeHelper_L",
  "kneeHelper_R",
  "pony1",
  "pony2",
  "pony3",
  "pony4",
] as const;

export type BoneName = (typeof BONE_NAMES)[number];

export const BONE_COUNT = BONE_NAMES.length;

export const BONE_INDEX = Object.fromEntries(BONE_NAMES.map((name, index) => [name, index])) as Record<BoneName, number>;

export const BONE_PARENT: Record<BoneName, BoneName | null> = {
  root: null,
  hips: "root",
  spine: "hips",
  chest: "spine",
  neck: "chest",
  head: "neck",
  shoulder_L: "chest",
  upperArm_L: "shoulder_L",
  lowerArm_L: "upperArm_L",
  hand_L: "lowerArm_L",
  shoulder_R: "chest",
  upperArm_R: "shoulder_R",
  lowerArm_R: "upperArm_R",
  hand_R: "lowerArm_R",
  upperLeg_L: "hips",
  lowerLeg_L: "upperLeg_L",
  foot_L: "lowerLeg_L",
  toe_L: "foot_L",
  upperLeg_R: "hips",
  lowerLeg_R: "upperLeg_R",
  foot_R: "lowerLeg_R",
  toe_R: "foot_R",
  elbowHelper_L: "upperArm_L",
  elbowHelper_R: "upperArm_R",
  kneeHelper_L: "upperLeg_L",
  kneeHelper_R: "upperLeg_R",
  pony1: "head",
  pony2: "pony1",
  pony3: "pony2",
  pony4: "pony3",
};

/** The child joint each bone's segment points at in bind pose (null for leaf/helper bones). */
export const BONE_SEGMENT_END: Partial<Record<BoneName, BoneName | LandmarkName>> = {
  hips: "spine",
  spine: "chest",
  chest: "neck",
  neck: "head",
  head: "headTop",
  shoulder_L: "upperArm_L",
  upperArm_L: "lowerArm_L",
  lowerArm_L: "hand_L",
  hand_L: "handTip_L",
  shoulder_R: "upperArm_R",
  upperArm_R: "lowerArm_R",
  lowerArm_R: "hand_R",
  hand_R: "handTip_R",
  upperLeg_L: "lowerLeg_L",
  lowerLeg_L: "foot_L",
  foot_L: "toe_L",
  toe_L: "toeTip_L",
  upperLeg_R: "lowerLeg_R",
  lowerLeg_R: "foot_R",
  foot_R: "toe_R",
  toe_R: "toeTip_R",
  pony1: "pony2",
  pony2: "pony3",
  pony3: "pony4",
  pony4: "ponyTip",
};

export const LANDMARK_NAMES = [
  "headTop",
  "chin",
  "eyeMid",
  "sternumTop",
  "navel",
  "pubis",
  "handTip_L",
  "handTip_R",
  "heel_L",
  "heel_R",
  "toeTip_L",
  "toeTip_R",
  "ponyTip",
] as const;

export type LandmarkName = (typeof LANDMARK_NAMES)[number];

export type Sex = "female" | "male";

export interface Proportions {
  /** Barefoot standing height in meters. */
  height: number;
  sex: Sex;
  /** Glenohumeral (shoulder) joint distance from the midline, as a fraction of height. */
  shoulderHalfWidth: number;
  /** Hip joint distance from the midline, as a fraction of height. */
  hipHalfWidth: number;
  /** Upper arm + forearm length as a fraction of height (average ≈ 0.332). */
  armLength: number;
  /** Thigh + shin length as a fraction of height (average ≈ 0.484). */
  legLength: number;
  /** Multiplier on head size (1 = average adult). */
  headSize: number;
  /** Multiplier on neck length (1 = average). */
  neckLength: number;
  /** Meters added under the feet by the shoes' soles. */
  soleHeight: number;
  /** Bind-pose angle of the arms from vertical, radians (A-pose). */
  armAbduction: number;
  /** Bind-pose angle of the legs from vertical, radians. */
  legAbduction: number;
}

export function defaultProportions(sex: Sex, height: number): Proportions {
  return sex === "male"
    ? { height, sex, shoulderHalfWidth: 0.108, hipHalfWidth: 0.05, armLength: 0.332, legLength: 0.484, headSize: 1, neckLength: 1, soleHeight: 0.025, armAbduction: 0.82, legAbduction: 0.055 }
    : { height, sex, shoulderHalfWidth: 0.097, hipHalfWidth: 0.056, armLength: 0.326, legLength: 0.486, headSize: 1, neckLength: 1, soleHeight: 0.025, armAbduction: 0.82, legAbduction: 0.06 };
}

export interface BindPose {
  proportions: Proportions;
  /** World-space bind joint positions, 3 floats per bone in `BONE_NAMES` order. */
  positions: Float32Array;
  /** Parent index per bone in `BONE_NAMES` order (-1 for the root). */
  parents: Int8Array;
  /** Non-bone reference points used by mesh generators (world space, bind pose). */
  landmarks: Record<LandmarkName, Vec3Tuple>;
}

const add = (a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3Tuple, s: number): Vec3Tuple => [a[0] * s, a[1] * s, a[2] * s];

/**
 * Deterministic bind pose from proportions. Shared verbatim by the worker (mesh + skin
 * weights) and the main thread (THREE.Skeleton), so both always agree.
 */
export function computeBindPose(p: Proportions): BindPose {
  const H = p.height;
  const s = p.soleHeight;
  const at = (x: number, y: number, z: number): Vec3Tuple => [x * H, y * H + s, z * H];
  const joints = {} as Record<BoneName, Vec3Tuple>;

  const legScale = p.legLength / 0.484;
  const armScale = p.armLength / 0.332;
  const headScale = p.headSize;
  const neckScale = p.neckLength;

  // Hip joints sit at a fixed fraction of height; the torso is stacked above them.
  const hipJointY = 0.522 * legScale;
  joints.root = [0, 0, 0];
  joints.hips = at(0, hipJointY + 0.018, -0.008);
  joints.spine = at(0, hipJointY + 0.083, -0.016);
  joints.chest = at(0, hipJointY + 0.178, -0.02);
  joints.neck = at(0, hipJointY + 0.293, -0.02);
  joints.head = at(0, hipJointY + 0.293 + 0.057 * neckScale, -0.006);

  const shoulderY = hipJointY + 0.286;
  for (const side of ["L", "R"] as const) {
    const sx = side === "L" ? 1 : -1;
    joints[`shoulder_${side}`] = at(0.012 * sx, shoulderY, 0.03);
    const shoulder = at(p.shoulderHalfWidth * sx, shoulderY, -0.006);
    joints[`upperArm_${side}`] = shoulder;
    const armDir: Vec3Tuple = [Math.sin(p.armAbduction) * sx, -Math.cos(p.armAbduction), 0];
    const elbow = add(shoulder, scale(armDir, 0.186 * armScale * H));
    joints[`lowerArm_${side}`] = elbow;
    joints[`elbowHelper_${side}`] = elbow;
    joints[`hand_${side}`] = add(elbow, scale(armDir, 0.146 * armScale * H));

    const hip = at(p.hipHalfWidth * sx, hipJointY, 0.002);
    joints[`upperLeg_${side}`] = hip;
    const legDir: Vec3Tuple = [Math.sin(p.legAbduction) * sx, -Math.cos(p.legAbduction), 0];
    const knee = add(add(hip, scale(legDir, 0.241 * legScale * H)), [0, 0, 0.004 * H]);
    joints[`lowerLeg_${side}`] = knee;
    joints[`kneeHelper_${side}`] = knee;
    const ankle = add(knee, scale(legDir, 0.243 * legScale * H));
    joints[`foot_${side}`] = ankle;
    // Ball of the foot (MTP joint) sits ~2 cm above the insole, forward of the ankle.
    joints[`toe_${side}`] = [ankle[0] + 0.006 * H * sx, s + 0.012 * H, ankle[2] + 0.075 * H];
  }

  const head = joints.head;
  joints.pony1 = add(head, scale([0, 0.08 * headScale, -0.062 * headScale], H));
  joints.pony2 = add(joints.pony1, scale([0, -0.04 * headScale, -0.022 * headScale], H));
  joints.pony3 = add(joints.pony2, scale([0, -0.045 * headScale, -0.01 * headScale], H));
  joints.pony4 = add(joints.pony3, scale([0, -0.045 * headScale, 0.004 * headScale], H));

  const landmarks = {} as Record<LandmarkName, Vec3Tuple>;
  landmarks.headTop = add(head, scale([0, 0.128 * headScale, 0.01 * headScale], H));
  landmarks.chin = add(head, scale([0, -0.004 * headScale, 0.056 * headScale], H));
  landmarks.eyeMid = add(head, scale([0, 0.062 * headScale, 0.054 * headScale], H));
  landmarks.sternumTop = at(0, shoulderY + 0.004, 0.038);
  landmarks.navel = at(0, hipJointY + 0.078, 0.058);
  landmarks.pubis = at(0, hipJointY - 0.017, 0.042);
  landmarks.ponyTip = add(joints.pony4, scale([0, -0.035 * headScale, 0.006 * headScale], H));
  for (const side of ["L", "R"] as const) {
    const sx = side === "L" ? 1 : -1;
    const armDir: Vec3Tuple = [Math.sin(p.armAbduction) * sx, -Math.cos(p.armAbduction), 0];
    landmarks[`handTip_${side}`] = add(joints[`hand_${side}`], scale(armDir, 0.108 * armScale * H));
    const ankle = joints[`foot_${side}`];
    landmarks[`heel_${side}`] = [ankle[0], s + 0.012 * H, ankle[2] - 0.042 * H];
    landmarks[`toeTip_${side}`] = [ankle[0] + 0.01 * H * sx, s + 0.008 * H, ankle[2] + 0.11 * H];
  }

  const positions = new Float32Array(BONE_COUNT * 3);
  const parents = new Int8Array(BONE_COUNT);
  BONE_NAMES.forEach((name, index) => {
    const position = joints[name];
    positions[index * 3] = position[0];
    positions[index * 3 + 1] = position[1];
    positions[index * 3 + 2] = position[2];
    const parent = BONE_PARENT[name];
    parents[index] = parent === null ? -1 : BONE_INDEX[parent];
  });

  return { proportions: p, positions, parents, landmarks };
}

export function bonePosition(bind: BindPose, name: BoneName): Vec3Tuple {
  const index = BONE_INDEX[name] * 3;
  return [bind.positions[index], bind.positions[index + 1], bind.positions[index + 2]];
}

/** Bind-space point for a bone joint or a landmark. */
export function pointOf(bind: BindPose, name: BoneName | LandmarkName): Vec3Tuple {
  return (name in BONE_INDEX ? bonePosition(bind, name as BoneName) : bind.landmarks[name as LandmarkName]);
}

/** Unit bind-pose direction of a bone's segment (towards `BONE_SEGMENT_END`), or null for helpers/root. */
export function segmentDirection(bind: BindPose, name: BoneName): Vec3Tuple | null {
  const end = BONE_SEGMENT_END[name];
  if (!end) return null;
  const a = bonePosition(bind, name);
  const b = pointOf(bind, end);
  const d: Vec3Tuple = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const length = Math.hypot(d[0], d[1], d[2]) || 1;
  return [d[0] / length, d[1] / length, d[2] / length];
}
