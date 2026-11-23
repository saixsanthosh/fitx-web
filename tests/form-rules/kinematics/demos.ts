/**
 * Reference motions for every camera exercise (test-only), as keyframes for the kinematic figure in
 * ./figure.ts. Each one moves the way its camera rule expects good form to move: tests play these loops
 * through the rule and expect every rep counted (or the hold timed) with no form cue. They were the
 * drawn demonstrations of the old Home workout page; AI Form Check shows photos instead, and the
 * figures live on here as the reference each rule is checked against.
 */
import type { ExerciseId } from "@/lib/form-rules/types";
import type { Demonstration, FigurePose, Limbs } from "./figure";

const limbs = (upperArm: number, forearm: number, thigh: number, shin: number, foot: number, scale?: Limbs["scale"]): Limbs =>
  scale ? { upperArm, forearm, thigh, shin, foot, scale } : { upperArm, forearm, thigh, shin, foot };
const both = (torso: number, side: Limbs, head = 0): FigurePose => ({ torso, head, near: side, far: side });

/** Standing side-on, facing right, arms by the sides. */
const standSide = both(-90, limbs(93, 86, 90, 90, 0));
/** Standing facing the camera; the near side is the body's left, on the right of the picture. */
const standFront: FigurePose = {
  torso: -90,
  near: limbs(84, 89, 88, 90, 30, { foot: 0.45 }),
  far: limbs(96, 91, 92, 90, 150, { foot: 0.45 }),
};

const pushUp: Demonstration = {
  view: "side",
  anchor: { side: "near", part: "wrist" },
  at: { x: 286, y: 266 },
  keyframes: [
    { pose: both(-26, limbs(90, 90, 154, 154, 160)), moveMs: 900, holdMs: 350, label: "Push up" },
    { pose: both(-10, limbs(184, 80, 170, 170, 165)), moveMs: 1000, holdMs: 200, label: "Lower" },
  ],
};

const squat: Demonstration = {
  view: "side",
  anchor: { side: "near", part: "ankle" },
  at: { x: 196, y: 256 },
  keyframes: [
    { pose: standSide, moveMs: 950, holdMs: 400, label: "Stand tall" },
    { pose: both(-52, limbs(-4, -4, 8, 112, 0)), moveMs: 1100, holdMs: 250, label: "Sit back" },
  ],
};

const splitSquat: Demonstration = {
  view: "side",
  anchor: { side: "near", part: "ankle" },
  at: { x: 236, y: 256 },
  keyframes: [
    { pose: { torso: -89, near: limbs(93, 86, 80, 96, 0), far: limbs(93, 86, 116, 126, 55) }, moveMs: 1000, holdMs: 350, label: "Rise" },
    { pose: { torso: -88, near: limbs(93, 86, 4, 94, 0), far: limbs(93, 86, 94, 174, 30) }, moveMs: 1100, holdMs: 250, label: "Lower" },
  ],
};

const gluteBridge: Demonstration = {
  view: "side",
  anchor: { side: "near", part: "ankle" },
  at: { x: 300, y: 255 },
  keyframes: [
    { pose: both(180, limbs(0, 0, -45, 60, 0)), moveMs: 1000, holdMs: 400, label: "Lower" },
    { pose: both(155, limbs(0, 0, -25, 72, 0), 25), moveMs: 1000, holdMs: 500, label: "Drive hips up" },
  ],
};

const plankPose = both(-14, limbs(90, 0, 166, 166, 150));
const plank: Demonstration = {
  view: "side",
  anchor: { side: "near", part: "elbow" },
  at: { x: 300, y: 258 },
  keyframes: [
    { pose: plankPose, moveMs: 1600, holdMs: 400, label: "Hold a straight line" },
    { pose: both(-13, limbs(90, 0, 167, 167, 150)), moveMs: 1600, holdMs: 400, label: "Breathe" },
  ],
};

const jumpingJack: Demonstration = {
  view: "front",
  anchor: { side: "centre", part: "hip" },
  at: { x: 200, y: 132 },
  keyframes: [
    { pose: standFront, moveMs: 380, holdMs: 120, label: "Together", at: { x: 200, y: 132 } },
    {
      pose: { torso: -90, near: limbs(-62, -74, 68, 72, 30, { foot: 0.45 }), far: limbs(-118, -106, 112, 108, 150, { foot: 0.45 }) },
      moveMs: 380,
      holdMs: 120,
      label: "Jump wide",
      at: { x: 200, y: 142 },
    },
  ],
};

const reverseLunge: Demonstration = {
  view: "side",
  anchor: { side: "near", part: "ankle" },
  at: { x: 236, y: 256 },
  keyframes: [
    { pose: standSide, moveMs: 1000, holdMs: 450, label: "Drive up" },
    { pose: { torso: -88, near: limbs(93, 86, 4, 95, 0), far: limbs(93, 86, 100, 175, 25) }, moveMs: 1100, holdMs: 250, label: "Step back" },
  ],
};

const highKneeArms = { near: { upperArm: 88, forearm: -70 }, far: { upperArm: 92, forearm: -110 } };
const highKnees: Demonstration = {
  view: "front",
  anchor: { side: "centre", part: "hip" },
  at: { x: 200, y: 132 },
  keyframes: [
    { pose: { torso: -90, near: { ...standFront.near, ...highKneeArms.near, scale: { foot: 0.45, forearm: 0.55 } }, far: { ...standFront.far, ...highKneeArms.far, scale: { foot: 0.45, forearm: 0.55 } } }, moveMs: 240, label: "Down", at: { x: 200, y: 132 } },
    {
      pose: { torso: -90, near: limbs(80, -80, 90, 90, 90, { thigh: 0.22, foot: 0.3, forearm: 0.55 }), far: limbs(100, -100, 92, 90, 150, { foot: 0.45, forearm: 0.55 }) },
      moveMs: 260,
      label: "Knee up",
      at: { x: 200, y: 126 },
    },
    { pose: { torso: -90, near: { ...standFront.near, ...highKneeArms.near, scale: { foot: 0.45, forearm: 0.55 } }, far: { ...standFront.far, ...highKneeArms.far, scale: { foot: 0.45, forearm: 0.55 } } }, moveMs: 240, label: "Down", at: { x: 200, y: 132 } },
    {
      pose: { torso: -90, near: limbs(80, -80, 88, 90, 30, { foot: 0.45, forearm: 0.55 }), far: limbs(100, -100, 90, 90, 90, { thigh: 0.22, foot: 0.3, forearm: 0.55 }) },
      moveMs: 260,
      label: "Knee up",
      at: { x: 200, y: 126 },
    },
  ],
};

const climberBase = both(-24, limbs(90, 90, 156, 156, 160));
const mountainClimber: Demonstration = {
  view: "side",
  anchor: { side: "near", part: "wrist" },
  at: { x: 296, y: 266 },
  keyframes: [
    { pose: climberBase, moveMs: 320, holdMs: 60, label: "Switch" },
    { pose: { torso: -24, near: limbs(90, 90, 40, 150, 160), far: climberBase.far }, moveMs: 320, holdMs: 60, label: "Drive" },
    { pose: climberBase, moveMs: 320, holdMs: 60, label: "Switch" },
    { pose: { torso: -24, near: climberBase.near, far: limbs(90, 90, 40, 150, 160) }, moveMs: 320, holdMs: 60, label: "Drive" },
  ],
};

const sidePlankPose: FigurePose = {
  torso: -14,
  near: limbs(90, 10, 166, 166, 70, { forearm: 0.6 }),
  far: limbs(-90, -90, 166, 166, 70),
};
const sidePlank: Demonstration = {
  view: "front",
  anchor: { side: "near", part: "elbow" },
  at: { x: 296, y: 258 },
  keyframes: [
    { pose: sidePlankPose, moveMs: 1600, holdMs: 400, label: "Hips up, body straight" },
    { pose: { ...sidePlankPose, torso: -13, far: limbs(-88, -88, 167, 167, 70) }, moveMs: 1600, holdMs: 400, label: "Breathe" },
  ],
};

const wallSit: Demonstration = {
  view: "side",
  anchor: { side: "near", part: "ankle" },
  at: { x: 232, y: 256 },
  keyframes: [
    { pose: both(-90, limbs(93, 86, 59, 59, 0)), moveMs: 900, holdMs: 500, label: "Lean on the wall" },
    { pose: both(-90, limbs(70, 8, 0, 90, 0)), moveMs: 1100, holdMs: 2600, label: "Hold, thighs level" },
  ],
};

const superman: Demonstration = {
  view: "side",
  anchor: { side: "centre", part: "hip" },
  at: { x: 196, y: 252 },
  keyframes: [
    { pose: both(0, limbs(2, 0, 180, 180, 182)), moveMs: 900, holdMs: 350, label: "Lower" },
    { pose: both(-15, limbs(-16, -16, 190, 190, 192)), moveMs: 900, holdMs: 500, label: "Lift and hold" },
  ],
};

const shoulderPress: Demonstration = {
  view: "front",
  anchor: { side: "centre", part: "hip" },
  at: { x: 200, y: 132 },
  keyframes: [
    { pose: { ...standFront, near: { ...standFront.near, upperArm: 5, forearm: -90 }, far: { ...standFront.far, upperArm: 175, forearm: -90 } }, moveMs: 1000, holdMs: 350, label: "Lower to shoulders" },
    { pose: { ...standFront, near: { ...standFront.near, upperArm: -80, forearm: -84 }, far: { ...standFront.far, upperArm: -100, forearm: -96 } }, moveMs: 900, holdMs: 300, label: "Press" },
  ],
};

const bicepsCurl: Demonstration = {
  view: "side",
  anchor: { side: "near", part: "ankle" },
  at: { x: 196, y: 256 },
  keyframes: [
    { pose: standSide, moveMs: 1000, holdMs: 350, label: "Lower slowly" },
    { pose: both(-90, limbs(91, -46, 90, 90, 0)), moveMs: 800, holdMs: 250, label: "Curl" },
  ],
};

const lateralRaise: Demonstration = {
  view: "front",
  anchor: { side: "centre", part: "hip" },
  at: { x: 200, y: 132 },
  keyframes: [
    { pose: standFront, moveMs: 1000, holdMs: 350, label: "Lower" },
    { pose: { ...standFront, near: { ...standFront.near, upperArm: 0, forearm: -2 }, far: { ...standFront.far, upperArm: 180, forearm: 182 } }, moveMs: 900, holdMs: 300, label: "Raise" },
  ],
};

const frontRaise: Demonstration = {
  view: "side",
  anchor: { side: "near", part: "ankle" },
  at: { x: 196, y: 256 },
  keyframes: [
    { pose: standSide, moveMs: 1000, holdMs: 350, label: "Lower" },
    { pose: both(-90, limbs(0, 0, 90, 90, 0)), moveMs: 900, holdMs: 300, label: "Raise" },
  ],
};

const tricepsExtension: Demonstration = {
  view: "side",
  anchor: { side: "near", part: "ankle" },
  at: { x: 196, y: 256 },
  keyframes: [
    { pose: both(-90, limbs(-95, -95, 90, 90, 0)), moveMs: 900, holdMs: 350, label: "Press" },
    { pose: both(-90, limbs(-100, 140, 90, 90, 0)), moveMs: 1000, holdMs: 250, label: "Lower" },
  ],
};

const romanianDeadlift: Demonstration = {
  view: "side",
  anchor: { side: "near", part: "ankle" },
  at: { x: 210, y: 256 },
  keyframes: [
    { pose: both(-90, limbs(90, 90, 92, 88, 0)), moveMs: 1100, holdMs: 400, label: "Stand tall" },
    { pose: both(-10, limbs(90, 90, 98, 80, 0)), moveMs: 1200, holdMs: 300, label: "Hips back" },
  ],
};

const bentOverRow: Demonstration = {
  view: "side",
  anchor: { side: "near", part: "ankle" },
  at: { x: 210, y: 256 },
  keyframes: [
    { pose: both(-40, limbs(90, 90, 100, 85, 0)), moveMs: 900, holdMs: 350, label: "Lower" },
    { pose: both(-40, limbs(180, 85, 100, 85, 0)), moveMs: 800, holdMs: 250, label: "Pull" },
  ],
};

const sitUp: Demonstration = {
  view: "side",
  anchor: { side: "centre", part: "hip" },
  at: { x: 210, y: 262 },
  keyframes: [
    { pose: both(180, limbs(0, 180, -45, 60, 0)), moveMs: 1000, holdMs: 400, label: "Lower" },
    { pose: both(-110, limbs(-30, 160, -45, 60, 0), -10), moveMs: 1000, holdMs: 300, label: "Curl up" },
  ],
};

export const DEMONSTRATIONS: Record<ExerciseId, Demonstration> = {
  push_up: pushUp,
  bodyweight_squat: squat,
  split_squat: splitSquat,
  glute_bridge: gluteBridge,
  plank,
  jumping_jack: jumpingJack,
  reverse_lunge: reverseLunge,
  high_knees: highKnees,
  mountain_climber: mountainClimber,
  side_plank: sidePlank,
  wall_sit: wallSit,
  superman,
  shoulder_press: shoulderPress,
  biceps_curl: bicepsCurl,
  lateral_raise: lateralRaise,
  front_raise: frontRaise,
  triceps_extension: tricepsExtension,
  romanian_deadlift: romanianDeadlift,
  bent_over_row: bentOverRow,
  sit_up: sitUp,
};
