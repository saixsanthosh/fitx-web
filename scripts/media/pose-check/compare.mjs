// The pose check's judgement (wave 2, brief 3.5): does a generated demonstration hold the same pose as the real
// photo it was made from? Pure, so it is tested with landmark fixtures. It only filters; the eye check is the gate.
//
// MediaPipe Pose landmarks (33, normalised x and y, visibility 0..1). A pair passes when, for both frames:
//  - every primary joint is visible (> MIN_VISIBILITY) in the candidate;
//  - each primary joint angle is within MAX_ANGLE_DIFF degrees of the reference;
//  - left and right are not swapped (shoulders and hips, where they are far enough apart to tell);
// and the candidate moves at least MIN_MOVEMENT of the reference's movement between its start and end.
// Lying poses and poses where the reference itself hides joints get "needs-eye" instead of a verdict; so does a
// demonstration that hides a joint (equipment in the way), unless what is visible already fails.
export const MAX_ANGLE_DIFF = 12;
export const MIN_VISIBILITY = 0.5;
export const MIN_MOVEMENT = 0.7;
/** Reference movement below this (degrees, summed) is a hold: the movement rule does not apply. */
export const HOLD_MOVEMENT = 15;
/** A torso this far from vertical (degrees) is a lying or plank pose: the eye decides. */
export const LYING_TORSO = 60;
/** Left and right closer than this (fraction of the width) cannot be told apart (side-on): no swap check. */
export const SWAP_MIN_GAP = 0.04;

export const LANDMARK = Object.freeze({
  leftShoulder: 11, rightShoulder: 12, leftElbow: 13, rightElbow: 14, leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24, leftKnee: 25, rightKnee: 26, leftAnkle: 27, rightAnkle: 28,
});

/** Joint angles as [name, a, vertex, b]. */
export const JOINTS = Object.freeze({
  leftElbow: ["leftShoulder", "leftElbow", "leftWrist"],
  rightElbow: ["rightShoulder", "rightElbow", "rightWrist"],
  leftShoulder: ["leftHip", "leftShoulder", "leftElbow"],
  rightShoulder: ["rightHip", "rightShoulder", "rightElbow"],
  leftHip: ["leftShoulder", "leftHip", "leftKnee"],
  rightHip: ["rightShoulder", "rightHip", "rightKnee"],
  leftKnee: ["leftHip", "leftKnee", "leftAnkle"],
  rightKnee: ["rightHip", "rightKnee", "rightAnkle"],
});

/** The primary joints for a focus: "upper" (shoulders, elbows), "lower" (hips, knees) or "full" (all eight). */
export function primaryJoints(focus = "full") {
  const upper = ["leftElbow", "rightElbow", "leftShoulder", "rightShoulder"];
  const lower = ["leftHip", "rightHip", "leftKnee", "rightKnee"];
  return focus === "upper" ? upper : focus === "lower" ? lower : [...upper, ...lower];
}

/** The focus from a catalogue muscle group (the pose check's default when a pair names none). */
export function focusFor(muscleGroup) {
  if (["chest", "back", "shoulders", "biceps", "triceps", "forearms"].includes(muscleGroup)) return "upper";
  if (["quadriceps", "hamstrings", "glutes", "calves", "adductors", "abductors"].includes(muscleGroup)) return "lower";
  return "full";
}

const point = (landmarks, name) => landmarks?.[LANDMARK[name]] ?? null;

/** The angle at the vertex, in degrees (0..180), from x and y only (the photos are 2D). */
export function angleAt(a, vertex, b) {
  const v1 = [a.x - vertex.x, a.y - vertex.y];
  const v2 = [b.x - vertex.x, b.y - vertex.y];
  const dot = v1[0] * v2[0] + v1[1] * v2[1];
  const norm = Math.hypot(...v1) * Math.hypot(...v2);
  if (!norm) return 0;
  return (Math.acos(Math.max(-1, Math.min(1, dot / norm))) * 180) / Math.PI;
}

export function jointAngle(landmarks, joint) {
  const [a, v, b] = JOINTS[joint].map((name) => point(landmarks, name));
  return a && v && b ? angleAt(a, v, b) : null;
}

/** Degrees between the torso (mid-shoulder to mid-hip) and vertical. */
export function torsoTilt(landmarks) {
  const ls = point(landmarks, "leftShoulder"), rs = point(landmarks, "rightShoulder"), lh = point(landmarks, "leftHip"), rh = point(landmarks, "rightHip");
  if (!ls || !rs || !lh || !rh) return null;
  const dx = (ls.x + rs.x) / 2 - (lh.x + rh.x) / 2;
  const dy = (ls.y + rs.y) / 2 - (lh.y + rh.y) / 2;
  return (Math.atan2(Math.abs(dx), Math.abs(dy)) * 180) / Math.PI;
}

/** The landmark names a set of joints relies on. */
const namesOf = (joints) => [...new Set(joints.flatMap((joint) => JOINTS[joint]))];

/** True when the candidate's left and right are the other way round from the reference's (shoulders or hips). */
export function swapped(reference, candidate) {
  for (const [left, right] of [["leftShoulder", "rightShoulder"], ["leftHip", "rightHip"]]) {
    const r = point(reference, left).x - point(reference, right).x;
    const c = point(candidate, left).x - point(candidate, right).x;
    if (Math.abs(r) >= SWAP_MIN_GAP && Math.abs(c) >= SWAP_MIN_GAP && Math.sign(r) !== Math.sign(c)) return true;
  }
  return false;
}

/**
 * The verdict for one exercise and model: `reference` and `candidate` are [start, end] landmark lists (null when no
 * person was found). Returns { verdict: "pass" | "fail" | "needs-eye", reasons, maxAngleDiff, movementRatio }.
 */
export function comparePair({ reference, candidate, focus = "full" }) {
  const joints = primaryJoints(focus);
  const reasons = [];
  /** The reference itself cannot be judged (lying, hidden joints): the eye decides whatever the numbers say. */
  let referenceEye = false;
  /** The demonstration hides joints: the eye decides, unless what is visible already fails. */
  let candidateEye = false;
  let maxAngleDiff = 0;
  if (reference.some((frame) => !frame)) return { verdict: "needs-eye", reasons: ["no person found in the reference photo"], maxAngleDiff: null, movementRatio: null };
  if (candidate.some((frame) => !frame)) return { verdict: "fail", reasons: ["no person found in the demonstration"], maxAngleDiff: null, movementRatio: null };
  for (let frame = 0; frame < 2; frame += 1) {
    const ref = reference[frame];
    const cand = candidate[frame];
    const tilt = torsoTilt(ref);
    if (tilt !== null && tilt > LYING_TORSO) { referenceEye = true; reasons.push(`frame ${frame}: lying or plank pose (torso ${Math.round(tilt)}° from vertical)`); }
    const hiddenInReference = namesOf(joints).filter((name) => (point(ref, name)?.visibility ?? 0) <= MIN_VISIBILITY);
    if (hiddenInReference.length) { referenceEye = true; reasons.push(`frame ${frame}: the reference hides ${hiddenInReference.join(", ")}`); }
    const hidden = namesOf(joints).filter((name) => (point(cand, name)?.visibility ?? 0) <= MIN_VISIBILITY);
    if (hidden.length) { candidateEye = true; reasons.push(`frame ${frame}: not clearly visible: ${hidden.join(", ")}`); }
    if (swapped(ref, cand)) reasons.push(`frame ${frame}: left and right are swapped`);
    for (const joint of joints) {
      const a = jointAngle(ref, joint);
      const b = jointAngle(cand, joint);
      if (a === null || b === null) continue;
      const diff = Math.abs(a - b);
      maxAngleDiff = Math.max(maxAngleDiff, diff);
      if (diff > MAX_ANGLE_DIFF && !hiddenInReference.length) reasons.push(`frame ${frame}: ${joint} differs by ${Math.round(diff)}°`);
    }
  }
  const moved = (frames) => joints.reduce((sum, joint) => {
    const a = jointAngle(frames[0], joint);
    const b = jointAngle(frames[1], joint);
    return a === null || b === null ? sum : sum + Math.abs(a - b);
  }, 0);
  const refMove = moved(reference);
  const movementRatio = refMove >= HOLD_MOVEMENT ? moved(candidate) / refMove : null;
  if (movementRatio !== null && movementRatio < MIN_MOVEMENT) reasons.push(`moves ${Math.round(movementRatio * 100)}% of the reference's movement (at least ${MIN_MOVEMENT * 100}%)`);
  const failed = reasons.some((reason) => /differs by|swapped|moves \d+%/.test(reason));
  const verdict = referenceEye ? "needs-eye" : failed ? "fail" : candidateEye ? "needs-eye" : "pass";
  return { verdict, reasons, maxAngleDiff: Math.round(maxAngleDiff * 10) / 10, movementRatio: movementRatio === null ? null : Math.round(movementRatio * 100) / 100 };
}
