/**
 * The squat the sign-in stage draws: a side-on figure built as a chain of joints (ankle → knee → hip →
 * shoulder → elbow), each a rotation relative to the one before, so the whole figure moves by SVG transforms
 * alone. The readouts on the stage (knee angle, cue) are computed from the same numbers, so they always
 * describe the drawing, never an invented measurement.
 */

/** Segment lengths in SVG units (viewBox 0 0 240 300, ankle at 120,262). */
export const BONES = { shin: 62, thigh: 64, torso: 78, upperArm: 38, forearm: 34, head: 13 } as const;
export const ANKLE = { x: 120, y: 262 } as const;

/** Joint rotations in degrees, clockwise positive, each relative to its parent segment. */
export type SquatPose = { shin: number; knee: number; hip: number; shoulder: number; elbow: number };

const STAND: SquatPose = { shin: 4, knee: -6, hip: 4, shoulder: -17, elbow: -12 };
const BOTTOM: SquatPose = { shin: 35, knee: -110, hip: 115, shoulder: -130, elbow: -8 };

/** A loop phase (any number; 0 and 1 are standing tall) to squat depth 0..1, with a short pause at each end. */
export function squatDepth(phase: number): number {
  const p = ((phase % 1) + 1) % 1;
  const wave = (1 - Math.cos(2 * Math.PI * p)) / 2;
  // Smoothstep flattens the turn at the top and the bottom, which reads as control rather than bouncing.
  return wave * wave * (3 - 2 * wave);
}

export function squatPose(depth: number): SquatPose {
  const d = Math.min(1, Math.max(0, depth));
  const mix = (a: number, b: number) => a + (b - a) * d;
  return {
    shin: mix(STAND.shin, BOTTOM.shin),
    knee: mix(STAND.knee, BOTTOM.knee),
    hip: mix(STAND.hip, BOTTOM.hip),
    shoulder: mix(STAND.shoulder, BOTTOM.shoulder),
    elbow: mix(STAND.elbow, BOTTOM.elbow),
  };
}

/** The inside angle at the knee in whole degrees: about 174 standing tall, 70 at the bottom. */
export function kneeAngle(pose: SquatPose): number {
  return Math.round(180 - Math.abs(pose.knee));
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Where a joint lands in SVG space, for labels that follow the figure. */
export function jointPoints(pose: SquatPose) {
  const step = (from: { x: number; y: number }, absolute: number, length: number) => ({
    x: from.x + length * Math.sin(rad(absolute)),
    y: from.y - length * Math.cos(rad(absolute)),
  });
  const shinAbs = pose.shin;
  const thighAbs = shinAbs + pose.knee;
  const torsoAbs = thighAbs + pose.hip;
  const knee = step(ANKLE, shinAbs, BONES.shin);
  const hip = step(knee, thighAbs, BONES.thigh);
  const shoulder = step(hip, torsoAbs, BONES.torso);
  return { ankle: { ...ANKLE }, knee, hip, shoulder };
}

export type Cue = "Chest up" | "Sit back" | "Knees out" | "Drive up";

/** The coaching line for this moment of the rep: top, lowering, bottom, rising. */
export function cueFor(phase: number): Cue {
  const p = ((phase % 1) + 1) % 1;
  if (p < 0.1 || p >= 0.9) return "Chest up";
  if (p < 0.4) return "Sit back";
  if (p < 0.6) return "Knees out";
  return "Drive up";
}

/** The hip's path over one rep (the dotted guide on the stage), as an SVG path string. */
export function hipPath(samples = 24): string {
  const points: string[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const { hip } = jointPoints(squatPose(i / samples));
    points.push(`${i === 0 ? "M" : "L"}${hip.x.toFixed(1)} ${hip.y.toFixed(1)}`);
  }
  return points.join(" ");
}
