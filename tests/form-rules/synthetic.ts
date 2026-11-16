/**
 * Synthetic pose sequences for the form-rule tests (test-only, never shipped).
 *
 * A simple 2D skeleton is posed from a joint angle (elbow, knee, hip …) by forward kinematics,
 * then written out as the 33 MediaPipe landmarks with visibility scores, so the rule engine sees
 * exactly what the camera pipeline would give it. Units: square image units where the image
 * height is 1 (x = landmark.x × aspect). Noise and dropouts are seeded, so every run is identical.
 */
import type { PoseFrame, PosePoint } from "@/lib/pose/landmarks";
import { LANDMARK, LANDMARK_COUNT } from "@/lib/pose/landmarks";
import type { CoachEvent, CoachSession, CoachSnapshot } from "@/lib/form-rules/session";

export interface Vec {
  x: number;
  y: number;
}

type Part = "nose" | "ear" | "shoulder" | "elbow" | "wrist" | "hip" | "knee" | "ankle" | "heel" | "foot";
type Limb = Partial<Record<Part, Vec>>;

/** A posed body: the near (camera-facing) side, the far side, and how clearly each is seen. */
export interface Body {
  near: Limb;
  far: Limb;
  nearVisibility: number;
  farVisibility: number;
}

export const LANDSCAPE = 16 / 9;
export const PORTRAIT = 3 / 4;

const rad = (degrees: number) => (degrees * Math.PI) / 180;
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
const len = (a: Vec) => Math.hypot(a.x, a.y);
const lerp = (a: Vec, b: Vec, k: number): Vec => add(a, mul(sub(b, a), k));
function rotate(v: Vec, degrees: number): Vec {
  const c = Math.cos(rad(degrees));
  const s = Math.sin(rad(degrees));
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}
/** The angle at b, in degrees. */
export function angleAt(a: Vec, b: Vec, c: Vec): number {
  const u = sub(a, b);
  const v = sub(c, b);
  return (Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y) / (len(u) * len(v))))) * 180) / Math.PI;
}
/** Point at distance `length` from `joint`, at `angle` degrees from the direction joint → `toward`. */
function bend(joint: Vec, toward: Vec, angle: number, length: number, pick: (a: Vec, b: Vec) => Vec): Vec {
  const u = mul(sub(toward, joint), 1 / len(sub(toward, joint)));
  return pick(add(joint, mul(rotate(u, angle), length)), add(joint, mul(rotate(u, -angle), length)));
}
const byLargerX = (a: Vec, b: Vec) => (a.x >= b.x ? a : b);
const bySmallerX = (a: Vec, b: Vec) => (a.x <= b.x ? a : b);
/** Knee of a two-segment leg from hip to ankle; `up` chooses the upper of the two solutions. */
function twoLink(hip: Vec, ankle: Vec, thigh: number, shin: number, up: boolean): Vec {
  const d = sub(ankle, hip);
  const dist = len(d);
  if (dist >= thigh + shin - 1e-9) return lerp(hip, ankle, thigh / (thigh + shin));
  const along = (thigh * thigh - shin * shin + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, thigh * thigh - along * along));
  const base = add(hip, mul(d, along / dist));
  const normal = { x: -d.y / dist, y: d.x / dist };
  const a = add(base, mul(normal, h));
  const b = sub(base, mul(normal, h));
  return up ? (a.y < b.y ? a : b) : a.y > b.y ? a : b;
}

function sideOn(near: Limb, farOffset: Vec = { x: 0.012, y: -0.008 }): Body {
  const far: Limb = {};
  for (const [part, point] of Object.entries(near) as Array<[Part, Vec]>) far[part] = add(point, farOffset);
  return { near, far, nearVisibility: 0.95, farVisibility: 0.5 };
}

/** Body line from the shoulder down to the ankle on the floor, with the hip pushed off the line by `sag` (fraction of its length, + = down). */
function bodyLine(shoulder: Vec, floorY: number, length: number, sag: number) {
  const dy = floorY - shoulder.y;
  const ankle = { x: shoulder.x - Math.sqrt(Math.max(0, length * length - dy * dy)), y: floorY };
  const d = mul(sub(ankle, shoulder), 1 / len(sub(ankle, shoulder)));
  let n = { x: -d.y, y: d.x };
  if (n.y < 0) n = mul(n, -1);
  const hip = add(add(shoulder, mul(d, length * 0.38)), mul(n, sag * length));
  const knee = lerp(hip, ankle, 0.5);
  return { ankle, hip, knee };
}

/** Push-up seen side-on, head to the right, at the given elbow angle. */
export function pushUp(elbow: number, options: { sag?: number } = {}): Body {
  const wrist = { x: 1.2, y: 0.8 };
  const tilt = (180 - elbow) * 0.3;
  const elbowPoint = add(wrist, { x: -0.15 * Math.sin(rad(tilt)), y: -0.15 * Math.cos(rad(tilt)) });
  const shoulder = bend(elbowPoint, wrist, elbow, 0.16, byLargerX);
  const { ankle, hip, knee } = bodyLine(shoulder, 0.78, 0.8, options.sag ?? 0);
  return sideOn({
    nose: add(shoulder, { x: 0.1, y: -0.02 }), ear: add(shoulder, { x: 0.06, y: -0.04 }),
    shoulder, elbow: elbowPoint, wrist, hip, knee, ankle,
    heel: add(ankle, { x: -0.025, y: -0.005 }), foot: add(ankle, { x: 0.02, y: 0.03 }),
  });
}

/** Forearm plank (or high plank) seen side-on with the hips `sag` off the line (+ = sagging). */
export function plank(options: { sag?: number; kneeAngle?: number } = {}): Body {
  const elbow = { x: 1.2, y: 0.8 };
  const shoulder = add(elbow, { x: 0, y: -0.16 });
  const line = bodyLine(shoulder, 0.78, 0.8, options.sag ?? 0);
  let { knee, ankle } = line;
  if (options.kneeAngle !== undefined) {
    // Kneeling: the knee rests on the floor and the shin folds back up.
    knee = { x: line.hip.x - 0.24, y: 0.8 };
    ankle = bend(knee, line.hip, options.kneeAngle, 0.22, (a, b) => (a.y <= b.y ? a : b));
  }
  return sideOn({
    nose: add(shoulder, { x: 0.1, y: -0.02 }), ear: add(shoulder, { x: 0.06, y: -0.04 }),
    shoulder, elbow, wrist: add(elbow, { x: 0.14, y: 0 }), hip: line.hip, knee, ankle,
    heel: add(ankle, { x: -0.025, y: -0.005 }), foot: add(ankle, { x: 0.02, y: 0.03 }),
  });
}

/** Squat seen side-on, facing right, at the given knee angle; `lean` adds forward torso lean in degrees. */
export function squat(knee: number, options: { lean?: number; facingCamera?: boolean } = {}): Body {
  const ankle = { x: 0.36, y: 0.9 };
  const shinTilt = (180 - knee) * 0.35;
  const kneePoint = add(ankle, { x: 0.22 * Math.sin(rad(shinTilt)), y: -0.22 * Math.cos(rad(shinTilt)) });
  const hip = bend(kneePoint, ankle, knee, 0.23, bySmallerX);
  const lean = (180 - knee) * 0.5 + (options.lean ?? 0);
  const shoulder = add(hip, { x: 0.27 * Math.sin(rad(lean)), y: -0.27 * Math.cos(rad(lean)) });
  const body = sideOn({
    nose: add(shoulder, { x: 0.06, y: -0.09 }), ear: add(shoulder, { x: 0.02, y: -0.09 }),
    shoulder, elbow: add(shoulder, { x: 0.12, y: 0.04 }), wrist: add(shoulder, { x: 0.24, y: 0.05 }),
    hip, knee: kneePoint, ankle, heel: add(ankle, { x: -0.03, y: 0.02 }), foot: add(ankle, { x: 0.07, y: 0.03 }),
  });
  if (options.facingCamera) {
    // Turned to face the camera: the far side swings out to shoulder width and is fully seen.
    return { ...sideOn(body.near, { x: -0.22, y: 0 }), farVisibility: 0.95 };
  }
  return body;
}

/** Split squat seen side-on: the near leg is the front leg at the given knee angle. */
export function splitSquat(knee: number, options: { lean?: number } = {}): Body {
  const ankle = { x: 0.5, y: 0.9 };
  const shinTilt = (180 - knee) * 0.15;
  const kneePoint = add(ankle, { x: 0.22 * Math.sin(rad(shinTilt)), y: -0.22 * Math.cos(rad(shinTilt)) });
  const hip = bend(kneePoint, ankle, knee, 0.23, bySmallerX);
  const lean = (180 - knee) * 0.08 + (options.lean ?? 0);
  const shoulder = add(hip, { x: 0.27 * Math.sin(rad(lean)), y: -0.27 * Math.cos(rad(lean)) });
  const body = sideOn({
    nose: add(shoulder, { x: 0.06, y: -0.09 }), ear: add(shoulder, { x: 0.02, y: -0.09 }),
    shoulder, elbow: add(shoulder, { x: 0.02, y: 0.13 }), wrist: add(shoulder, { x: 0.03, y: 0.25 }),
    hip, knee: kneePoint, ankle, heel: add(ankle, { x: -0.03, y: 0.02 }), foot: add(ankle, { x: 0.07, y: 0.03 }),
  });
  // The far leg is the back leg: its foot stays behind, and the camera sees it less clearly.
  const backAnkle = { x: ankle.x - 0.42, y: 0.88 };
  body.far.ankle = backAnkle;
  body.far.knee = twoLink(hip, backAnkle, 0.23, 0.22, false);
  return body;
}

const BRIDGE = { shoulder: { x: 0.55, y: 0.8 }, ankle: { x: 1.18, y: 0.81 }, torso: 0.3, thigh: 0.25, shin: 0.24 };

function bridgeAt(lift: number) {
  const hip = add(BRIDGE.shoulder, { x: BRIDGE.torso * Math.cos(rad(lift)), y: -BRIDGE.torso * Math.sin(rad(lift)) });
  const knee = twoLink(hip, BRIDGE.ankle, BRIDGE.thigh, BRIDGE.shin, true);
  return { hip, knee, angle: angleAt(BRIDGE.shoulder, hip, knee) };
}

/** Torso lift (degrees) at which shoulders, hips and knees line up: the top of a full bridge. */
export function bridgeStraightLift(): number {
  let best = 0;
  let bestAngle = 0;
  for (let lift = 0; lift <= 60; lift += 0.05) {
    const { angle } = bridgeAt(lift);
    if (angle > bestAngle) {
      bestAngle = angle;
      best = lift;
    }
  }
  return best;
}

/**
 * Glute bridge seen side-on (head left, feet right). `hip` is the shoulder-hip-knee angle; values
 * above 180 mean the hips rise past the straight line (an over-arched back).
 */
export function bridge(hip: number): Body {
  const straight = bridgeStraightLift();
  let lift: number;
  if (hip >= 180) {
    lift = straight + (hip - 180) * 0.6;
  } else {
    let lo = 0;
    let hi = straight;
    for (let i = 0; i < 60; i += 1) {
      const mid = (lo + hi) / 2;
      if (bridgeAt(mid).angle < hip) lo = mid;
      else hi = mid;
    }
    lift = (lo + hi) / 2;
    if (Math.abs(bridgeAt(lift).angle - hip) > 0.5) throw new Error(`bridge: hip angle ${hip} is out of reach`);
  }
  const { hip: hipPoint, knee } = bridgeAt(lift);
  const shoulder = BRIDGE.shoulder;
  return sideOn({
    nose: add(shoulder, { x: -0.1, y: -0.05 }), ear: add(shoulder, { x: -0.08, y: -0.01 }),
    shoulder, elbow: add(shoulder, { x: 0.12, y: 0.01 }), wrist: add(shoulder, { x: 0.24, y: 0.01 }),
    hip: hipPoint, knee, ankle: BRIDGE.ankle, heel: add(BRIDGE.ankle, { x: -0.03, y: 0.01 }), foot: add(BRIDGE.ankle, { x: 0.06, y: 0.0 }),
  });
}

/** Jumping jack facing the camera: 0 = arms down and feet together, 1 = arms overhead and feet wide. */
export function jack(open: number, options: { armReach?: number; legReach?: number } = {}): Body {
  const arms = Math.min(open, options.armReach ?? 1);
  const legs = Math.min(open, options.legReach ?? 1);
  const cx = 0.375;
  const side = (sign: 1 | -1): Limb => {
    const shoulder = { x: cx + sign * 0.085, y: 0.3 };
    const raise = rad(15 + 150 * arms);
    const wrist = add(shoulder, { x: sign * 0.25 * Math.sin(raise), y: 0.25 * Math.cos(raise) });
    const hip = { x: cx + sign * 0.06, y: 0.55 };
    const ankle = { x: cx + sign * (0.07 + 0.16 * legs), y: 0.92 - 0.02 * legs };
    return {
      nose: { x: cx, y: 0.17 }, ear: { x: cx + sign * 0.03, y: 0.16 },
      shoulder, elbow: lerp(shoulder, wrist, 0.5), wrist, hip, knee: lerp(hip, ankle, 0.5), ankle,
      heel: add(ankle, { x: 0, y: 0.015 }), foot: add(ankle, { x: sign * 0.02, y: 0.03 }),
    };
  };
  // Facing the camera, the person's left side appears on the right of the image.
  return { near: side(1), far: side(-1), nearVisibility: 0.95, farVisibility: 0.95 };
}

// ---------------------------------------------------------------------------------------------
// Frames and sequences.

/** Deterministic pseudo-random numbers (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random: () => number): number {
  const u = Math.max(random(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

export interface FrameOptions {
  aspect?: number;
  /** Standard deviation of position noise, in image heights. */
  noise?: number;
  random?: () => number;
  /** Joints (by part name, both sides) the camera can't see clearly in this frame. */
  hidden?: readonly Part[];
  /** Every landmark at this visibility (dim light, motion blur). */
  visibility?: number;
}

const SLOTS: Record<Part, readonly [left: number, right: number]> = {
  nose: [LANDMARK.nose, LANDMARK.nose],
  ear: [LANDMARK.leftEar, LANDMARK.rightEar],
  shoulder: [LANDMARK.leftShoulder, LANDMARK.rightShoulder],
  elbow: [LANDMARK.leftElbow, LANDMARK.rightElbow],
  wrist: [LANDMARK.leftWrist, LANDMARK.rightWrist],
  hip: [LANDMARK.leftHip, LANDMARK.rightHip],
  knee: [LANDMARK.leftKnee, LANDMARK.rightKnee],
  ankle: [LANDMARK.leftAnkle, LANDMARK.rightAnkle],
  heel: [LANDMARK.leftHeel, LANDMARK.rightHeel],
  foot: [LANDMARK.leftFootIndex, LANDMARK.rightFootIndex],
};
/** Landmarks the rules never read, placed on the joint they belong to. */
const ANCHORS: ReadonlyArray<readonly [number, Part, "near" | "far"]> = [
  [LANDMARK.leftEyeInner, "nose", "near"], [LANDMARK.leftEye, "nose", "near"], [LANDMARK.leftEyeOuter, "ear", "near"],
  [LANDMARK.rightEyeInner, "nose", "far"], [LANDMARK.rightEye, "nose", "far"], [LANDMARK.rightEyeOuter, "ear", "far"],
  [LANDMARK.mouthLeft, "nose", "near"], [LANDMARK.mouthRight, "nose", "far"],
  [LANDMARK.leftPinky, "wrist", "near"], [LANDMARK.leftIndex, "wrist", "near"], [LANDMARK.leftThumb, "wrist", "near"],
  [LANDMARK.rightPinky, "wrist", "far"], [LANDMARK.rightIndex, "wrist", "far"], [LANDMARK.rightThumb, "wrist", "far"],
];

/** Writes a body out as one MediaPipe-style frame (near side = left landmarks). */
export function frameOf(body: Body, t: number, options: FrameOptions = {}): PoseFrame {
  const aspect = options.aspect ?? LANDSCAPE;
  const points: PosePoint[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0.5, y: 0.5, visibility: 0.05, presence: 0.05 }));
  const jitter = () => (options.noise && options.random ? gaussian(options.random) * options.noise : 0);
  const write = (index: number, point: Vec | undefined, visibility: number) => {
    if (!point) return;
    const v = options.visibility ?? visibility;
    points[index] = { x: (point.x + jitter()) / aspect, y: point.y + jitter(), z: 0, visibility: v, presence: Math.max(v, 0.9) };
  };
  for (const [part, [left, right]] of Object.entries(SLOTS) as Array<[Part, readonly [number, number]]>) {
    const hidden = options.hidden?.includes(part);
    write(left, body.near[part], hidden ? 0.15 : body.nearVisibility);
    if (right !== left) write(right, body.far[part] ?? body.near[part], hidden ? 0.15 : body.farVisibility);
  }
  for (const [index, part, side] of ANCHORS) {
    const source = side === "near" ? body.near[part] : body.far[part] ?? body.near[part];
    write(index, source, side === "near" ? body.nearVisibility : body.farVisibility);
  }
  return { t, points, aspect };
}

export interface RepPlan {
  /** Joint angle (or other driver) at the start position. */
  from: number;
  /** The turnaround reached on each rep, in order. */
  depths: readonly number[];
  /** Duration of one rep (start → turnaround → start). */
  repMs: number;
  /** Time spent at the start position before the first rep and between reps. */
  restMs?: number;
  /** Time at the start position after the last rep. */
  tailMs?: number;
}

/** The driving value over time: a raised-cosine dip to each rep's depth, with rests at `from`. */
export function repValueAt(plan: RepPlan, t: number): number {
  const rest = plan.restMs ?? 800;
  let cursor = rest;
  for (const depth of plan.depths) {
    if (t < cursor) return plan.from;
    if (t < cursor + plan.repMs) {
      const phase = (t - cursor) / plan.repMs;
      return plan.from + (depth - plan.from) * (1 - Math.cos(2 * Math.PI * phase)) / 2;
    }
    cursor += plan.repMs + rest;
  }
  return plan.from;
}

export function planDuration(plan: RepPlan): number {
  const rest = plan.restMs ?? 800;
  return rest + plan.depths.length * (plan.repMs + rest) + (plan.tailMs ?? 600);
}

export interface SequenceOptions extends Omit<FrameOptions, "random" | "hidden"> {
  fps?: number;
  seed?: number;
  /** Frames inside these windows (ms) hide the listed joints. */
  dropouts?: ReadonlyArray<{ from: number; to: number; parts?: readonly Part[]; nobody?: boolean }>;
}

/** Samples `pose(t)` at `fps` for `durationMs`. */
export function sequence(durationMs: number, pose: (t: number) => Body, options: SequenceOptions = {}): PoseFrame[] {
  const fps = options.fps ?? 30;
  const random = seeded(options.seed ?? 7);
  const frames: PoseFrame[] = [];
  const start = 10_000;
  for (let t = 0; t <= durationMs; t += 1000 / fps) {
    const dropout = options.dropouts?.find((window) => t >= window.from && t < window.to);
    if (dropout?.nobody) {
      frames.push({ t: start + t, points: null, aspect: options.aspect ?? LANDSCAPE });
      continue;
    }
    frames.push(frameOf(pose(t), start + t, { ...options, random, hidden: dropout?.parts }));
  }
  return frames;
}

// ---------------------------------------------------------------------------------------------
// Running a session over frames.


export function play(session: CoachSession, frames: readonly PoseFrame[]) {
  const snapshots: CoachSnapshot[] = [];
  const events: CoachEvent[] = [];
  for (const frame of frames) {
    const snapshot = session.update(frame);
    snapshots.push(snapshot);
    events.push(...snapshot.events);
  }
  return { last: snapshots[snapshots.length - 1], snapshots, events, summary: session.summary() };
}

export const count = (events: readonly CoachEvent[], type: CoachEvent["type"]) => events.filter((event) => event.type === type).length;
export const cueIds = (events: readonly CoachEvent[]) => events.flatMap((event) => (event.type === "cue" ? [event.cue.id] : []));
