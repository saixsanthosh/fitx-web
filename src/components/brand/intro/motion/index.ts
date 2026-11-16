/**
 * Motion system public API (main thread, `three`). OWNER: motion agent.
 *
 * Every driver is a pure function of action time: it calls `rig.resetPose()`, writes local
 * bone rotations plus the root / hips positions, and finishes with `updateHelperBones`. Root
 * motion (forward travel) lives on the `root` bone; the director places each character group.
 * Typical frame: driver → layers (breath, head look) → `PonytailSpring.simulateTo` (Maya).
 */

export { updateHelperBones, PoseContext, rigMetrics } from "./helpers";
export type { RigMetrics, FootMetrics } from "./helpers";

export { poseSprint, poseRun, sprintFootfalls, sprintStartZ } from "./sprint";
export type { SprintOptions, SprintResult, FootContactState, Footfall } from "./sprint";

export { poseRide, crankAngleAt, pedalSpindle, pedalFootPitch, PEDAL_STACK } from "./ride";
export type { RideOptions, RideResult } from "./ride";

export { poseLift, LIFT_EVENTS } from "./lift";
export type { LiftResult, LiftEvents } from "./lift";

export { poseTable, TABLE_EVENTS, tableLocal } from "./table";
export type { TableResult, GlassTransform } from "./table";

export { poseWalk } from "./walk";
export type { WalkOptions, WalkResult, WalkStyle } from "./walk";

export { applyBreath, applyHeadLook, blinkAmount, breathCycle } from "./layers";
export type { HeadLookOptions } from "./layers";

export { PonytailSpring } from "./secondary";
export type { PonytailOptions } from "./secondary";

export { GRIP_BAR, GRIP_GLASS, gripOffset, handBindFrame, handRotation } from "./hands";
export type { HandFrame, HandPoses } from "./hands";

export { plantFoot, newFootSolution, flatAnkle } from "./foot";
export type { FootRoll, FootSolution, Side } from "./foot";

export {
  solveTwoBoneIK,
  aimBone,
  lookRotation,
  mapFrame,
  setBoneWorldQuaternion,
  boneWorldPosition,
  boneWorldQuaternion,
  limbLengths,
  LIMB_CHAINS,
} from "../rig/ik";
export type { LimbChain, TwoBoneIKOptions, TwoBoneIKResult } from "../rig/ik";
