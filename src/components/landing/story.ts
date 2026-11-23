/**
 * The landing page's scroll story, as pure functions of the scene's scroll progress (0 to 1), so the motion
 * is testable and the reduced-motion render (progress fixed at 1) is a meaningful final frame.
 */

/** The three photographs of the squat, from standing to the bottom. Coordinates are in a 896 × 1152 frame. */
export const POSE_FRAME = { width: 896, height: 1152 } as const;

export type Joint = "head" | "shoulder" | "elbow" | "wrist" | "hip" | "knee" | "ankle" | "toe" | "farKnee" | "farAnkle" | "farToe";
export type Pose = Record<Joint, readonly [number, number]>;

/** Joint positions measured on the generated frames (woman-stand, woman-mid, woman-squat). */
export const SQUAT_POSES: readonly [Pose, Pose, Pose] = [
  { head: [505, 118], shoulder: [538, 238], elbow: [415, 248], wrist: [235, 232], hip: [497, 505], knee: [540, 740], ankle: [560, 940], toe: [520, 1008], farKnee: [440, 735], farAnkle: [450, 930], farToe: [392, 962] },
  { head: [528, 340], shoulder: [535, 445], elbow: [385, 458], wrist: [222, 440], hip: [643, 658], knee: [548, 735], ankle: [612, 985], toe: [582, 1035], farKnee: [385, 738], farAnkle: [450, 935], farToe: [395, 965] },
  { head: [540, 335], shoulder: [552, 440], elbow: [400, 458], wrist: [232, 442], hip: [690, 660], knee: [562, 752], ankle: [632, 985], toe: [602, 1030], farKnee: [392, 745], farAnkle: [470, 935], farToe: [412, 962] },
];

export const BONES: readonly (readonly [Joint, Joint])[] = [
  ["head", "shoulder"], ["shoulder", "elbow"], ["elbow", "wrist"], ["shoulder", "hip"],
  ["hip", "knee"], ["knee", "ankle"], ["ankle", "toe"], ["hip", "farKnee"], ["farKnee", "farAnkle"], ["farAnkle", "farToe"],
];

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/**
 * `from` → `to` as progress runs from `start` to `end`, clamped. Used as a function transform on purpose:
 * framer-motion 12 hands range-based opacity transforms of a useScroll value to a native ScrollTimeline, which
 * resolves the wrong range inside the pinned scene (the plan card stayed invisible).
 */
export function ramp(progress: number, start: number, end: number, from: number, to: number): number {
  const t = clamp01((progress - start) / (end - start || 1));
  return from + (to - from) * t;
}

/** Reps the scene plays while it crosses the screen: down, up, down, so the last frame is the bottom. */
export const SCENE_REPS = 1.5;

/** Squat depth, 0 standing to 1 at the bottom, as a smooth wave over the scene. */
export function squatDepth(progress: number): number {
  const phase = (clamp01(progress) * SCENE_REPS) % 1;
  const reached = clamp01(progress) * SCENE_REPS >= SCENE_REPS - 1e-9;
  const triangle = reached ? 1 : phase < 0.5 ? phase * 2 : 2 - phase * 2;
  // Ease so the figure lingers at the top and bottom, like a real rep.
  return (1 - Math.cos(Math.PI * triangle)) / 2;
}

/** Whether the figure is on the way down at this point of the scene. */
export function goingDown(progress: number): boolean {
  const phase = (clamp01(progress) * SCENE_REPS) % 1;
  return phase < 0.5;
}

/** Reps completed so far: one each time the bottom is reached. */
export function repsAt(progress: number): number {
  return Math.floor(clamp01(progress) * SCENE_REPS + 0.5 + 1e-9);
}

/** The photo to show for a depth: 0 standing, 1 half way, 2 at the bottom. */
export function frameAt(depth: number): 0 | 1 | 2 {
  const d = clamp01(depth);
  return d < 0.34 ? 0 : d < 0.8 ? 1 : 2;
}

function mix(a: readonly [number, number], b: readonly [number, number], t: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** The skeleton for a depth, blended between the measured frames. */
export function poseAt(depth: number): Pose {
  const d = clamp01(depth);
  const [from, to, t] = d <= 0.5 ? [SQUAT_POSES[0], SQUAT_POSES[1], d / 0.5] : [SQUAT_POSES[1], SQUAT_POSES[2], (d - 0.5) / 0.5];
  const out = {} as Record<Joint, [number, number]>;
  for (const joint of Object.keys(from) as Joint[]) out[joint] = mix(from[joint], to[joint], t);
  return out;
}

const r = (n: number) => Math.round(n * 10) / 10;

/** One SVG path for every bone (same commands for every pose, so it morphs smoothly). */
export function bonesPath(pose: Pose): string {
  return BONES.map(([a, b]) => `M${r(pose[a][0])} ${r(pose[a][1])}L${r(pose[b][0])} ${r(pose[b][1])}`).join("");
}

/** One SVG path drawing a small ring at every joint. */
export function jointsPath(pose: Pose, radius = 9): string {
  return (Object.keys(pose) as Joint[]).map((joint) => {
    const [x, y] = pose[joint];
    return `M${r(x - radius)} ${r(y)}a${radius} ${radius} 0 1 0 ${radius * 2} 0a${radius} ${radius} 0 1 0 ${-radius * 2} 0`;
  }).join("");
}

/** The inside angle at `b` between a-b-c, in whole degrees. */
export function angleAt(a: readonly [number, number], b: readonly [number, number], c: readonly [number, number]): number {
  const v1 = [a[0] - b[0], a[1] - b[1]];
  const v2 = [c[0] - b[0], c[1] - b[1]];
  const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1]) || 1);
  return Math.round((Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI);
}

/** The knee angle the overlay reads out, measured on the drawn skeleton. */
export function kneeAngle(pose: Pose): number {
  return angleAt(pose.hip, pose.knee, pose.ankle);
}

/** A short arc at the knee between thigh and shin, drawn with the same commands for every pose. */
export function kneeArcPath(pose: Pose, radius = 48): string {
  const [kx, ky] = pose.knee;
  const unit = (x: number, y: number) => {
    const length = Math.hypot(x - kx, y - ky) || 1;
    return [(x - kx) / length, (y - ky) / length] as const;
  };
  const [ax, ay] = unit(pose.hip[0], pose.hip[1]);
  const [bx, by] = unit(pose.ankle[0], pose.ankle[1]);
  const sweep = ax * by - ay * bx > 0 ? 1 : 0;
  return `M${r(kx + ax * radius)} ${r(ky + ay * radius)}A${radius} ${radius} 0 0 ${sweep} ${r(kx + bx * radius)} ${r(ky + by * radius)}`;
}

/** The spoken and captioned cue for a moment of the rep. */
export function cueAt(progress: number): string {
  const depth = squatDepth(progress);
  if (depth >= 0.9) return "Good depth";
  if (depth < 0.12) return progress < 0.05 ? "Feet shoulder-width" : "Stand tall";
  return goingDown(progress) ? "Sit back, chest up" : "Drive through your heels";
}

/** The man's plan: an example session (labelled as an example on the page). */
export const EXAMPLE_PLAN = [
  { name: "Seated dumbbell press", detail: "3 × 10" },
  { name: "Incline bench press", detail: "3 × 8" },
  { name: "Lateral raise", detail: "3 × 12" },
  { name: "Triceps pushdown", detail: "3 × 12" },
] as const;

/** How many plan rows are ticked off at this point of the scene (all of them at the end). */
export function planDoneAt(progress: number): number {
  const p = clamp01(progress);
  if (p >= 0.999) return EXAMPLE_PLAN.length;
  return Math.min(EXAMPLE_PLAN.length, Math.floor(Math.max(0, p - 0.3) / 0.16));
}

/** The man's photo: reading his plan first, then lifting. */
export function manFrameAt(progress: number): 0 | 1 {
  return clamp01(progress) < 0.36 ? 0 : 1;
}

/** The knee angle the camera would read at this point of the scene (the measured poses, blended by depth). */
export function kneeAngleAt(progress: number): number {
  return kneeAngle(poseAt(squatDepth(progress)));
}

/** The knee angle's range over the scene: standing at the top, the bottom of the squat at the foot. */
const TRACE_SAMPLES = 72;
const traceAngles = Array.from({ length: TRACE_SAMPLES + 1 }, (_, index) => kneeAngleAt(index / TRACE_SAMPLES));
export const TRACE_RANGE = { min: Math.min(...traceAngles), max: Math.max(...traceAngles) } as const;

/** Where the trace is at `progress`, in a `width` × `height` box with `pad` px kept clear top and bottom. */
export function tracePoint(progress: number, width: number, height: number, pad = 8): [number, number] {
  const p = clamp01(progress);
  const span = TRACE_RANGE.max - TRACE_RANGE.min || 1;
  // Clamped: the sampled range can miss a peak between two samples by a degree.
  const y = pad + clamp01((TRACE_RANGE.max - kneeAngleAt(p)) / span) * (height - pad * 2);
  return [r(p * width), r(y)];
}

/** The whole rep as one path (left to right through the scene), drawn under the moving point. */
export function kneeTracePath(width: number, height: number, pad = 8): string {
  return Array.from({ length: TRACE_SAMPLES + 1 }, (_, index) => {
    const [x, y] = tracePoint(index / TRACE_SAMPLES, width, height, pad);
    return `${index === 0 ? "M" : "L"}${x} ${y}`;
  }).join("");
}
