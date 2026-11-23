/**
 * The drawn figure behind every Home workout demonstration: a 2D skeleton posed by segment
 * directions (forward kinematics), so limbs keep their length however a pose is blended. Plain
 * maths with no browser APIs, so the demonstrations, the live figure and the tests share it.
 *
 * Coordinates are the figure's own: a 400 × 300 stage, y down, floor at FLOOR_Y. Directions are
 * degrees on screen: 0 points right, 90 down, 180 left, -90 up.
 */

export interface Vec {
  x: number;
  y: number;
}

export const STAGE = { width: 400, height: 300 } as const;
export const FLOOR_Y = 268;

/** Segment lengths, in stage units. A standing figure is about 236 tall. */
export const BONES = {
  headRadius: 14,
  /** Shoulder centre to the centre of the head. */
  neck: 26,
  torso: 72,
  upperArm: 48,
  forearm: 44,
  thigh: 64,
  shin: 60,
  foot: 20,
} as const;

export type Segment = "upperArm" | "forearm" | "thigh" | "shin" | "foot";
export type Part = "shoulder" | "elbow" | "wrist" | "hip" | "knee" | "ankle" | "toe";
export type SideKey = "near" | "far";

/** One side's segment directions; `scale` shortens a segment that points at the camera. */
export interface Limbs {
  upperArm: number;
  forearm: number;
  thigh: number;
  shin: number;
  foot: number;
  scale?: Partial<Record<Segment, number>>;
}

export interface FigurePose {
  /** Direction from the hip centre to the shoulder centre. */
  torso: number;
  /** The head's direction relative to the torso (0 = in line). */
  head?: number;
  /** "near" is the side towards the viewer (side view), or the body's left, shown on the right (front view). */
  near: Limbs;
  far: Limbs;
}

export interface FigurePoints {
  head: Vec;
  near: Record<Part, Vec>;
  far: Record<Part, Vec>;
}

export type FigureView = "side" | "front";

/** Half the shoulder and hip width, in front view (measured across the torso). */
const FRONT_HALF = { shoulder: 24, hip: 15 } as const;
/** Side view: the far side sits a little up and behind, so it reads as depth. */
const SIDE_FAR_OFFSET: Vec = { x: -4, y: -3 };

const rad = (degrees: number) => (degrees * Math.PI) / 180;
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const direction = (degrees: number): Vec => ({ x: Math.cos(rad(degrees)), y: Math.sin(rad(degrees)) });
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Joint positions for a pose, with the hip centre at the origin. */
export function solvePose(pose: FigurePose, view: FigureView): FigurePoints {
  const hipCentre: Vec = { x: 0, y: 0 };
  const along = direction(pose.torso);
  const shoulderCentre = add(hipCentre, scale(along, BONES.torso));
  // Across the torso: turning `along` a quarter turn clockwise on screen.
  const across: Vec = { x: -along.y, y: along.x };
  const side = (key: SideKey): Record<Part, Vec> => {
    const limbs = pose[key];
    const sign = key === "near" ? 1 : -1;
    const offset = (half: number) => (view === "front" ? scale(across, sign * half) : key === "far" ? SIDE_FAR_OFFSET : { x: 0, y: 0 });
    const shoulder = add(shoulderCentre, offset(FRONT_HALF.shoulder));
    const hip = add(hipCentre, offset(FRONT_HALF.hip));
    const seg = (from: Vec, segment: Segment) => add(from, scale(direction(limbs[segment]), BONES[segment] * (limbs.scale?.[segment] ?? 1)));
    const elbow = seg(shoulder, "upperArm");
    const wrist = seg(elbow, "forearm");
    const knee = seg(hip, "thigh");
    const ankle = seg(knee, "shin");
    const toe = seg(ankle, "foot");
    return { shoulder, elbow, wrist, hip, knee, ankle, toe };
  };
  const head = add(shoulderCentre, scale(direction(pose.torso + (pose.head ?? 0)), BONES.neck));
  return { head, near: side("near"), far: side("far") };
}

export function translatePoints(points: FigurePoints, by: Vec): FigurePoints {
  const move = (limb: Record<Part, Vec>) => Object.fromEntries(Object.entries(limb).map(([part, p]) => [part, add(p, by)])) as Record<Part, Vec>;
  return { head: add(points.head, by), near: move(points.near), far: move(points.far) };
}

/** Where a named joint sits: a side's joint, or the hip centre. */
export type AnchorJoint = { side: SideKey; part: Part } | { side: "centre"; part: "hip" };

export function jointOf(points: FigurePoints, anchor: AnchorJoint): Vec {
  if (anchor.side === "centre") return scale(add(points.near.hip, points.far.hip), 0.5);
  return points[anchor.side][anchor.part];
}

/** Blends two poses segment by segment (directions take the short way round). */
export function blendPose(a: FigurePose, b: FigurePose, k: number): FigurePose {
  const angle = (x: number, y: number) => {
    let delta = ((y - x) % 360 + 540) % 360 - 180;
    if (delta === -180) delta = 180;
    return x + delta * k;
  };
  const limbs = (x: Limbs, y: Limbs): Limbs => {
    const scales: Partial<Record<Segment, number>> = {};
    for (const segment of ["upperArm", "forearm", "thigh", "shin", "foot"] as const) {
      const from = x.scale?.[segment] ?? 1;
      const to = y.scale?.[segment] ?? 1;
      if (from !== 1 || to !== 1) scales[segment] = lerp(from, to, k);
    }
    return {
      upperArm: angle(x.upperArm, y.upperArm),
      forearm: angle(x.forearm, y.forearm),
      thigh: angle(x.thigh, y.thigh),
      shin: angle(x.shin, y.shin),
      foot: angle(x.foot, y.foot),
      ...(Object.keys(scales).length ? { scale: scales } : {}),
    };
  };
  return { torso: angle(a.torso, b.torso), head: angle(a.head ?? 0, b.head ?? 0), near: limbs(a.near, b.near), far: limbs(a.far, b.far) };
}

/** A smooth in-and-out curve, so every move eases from rest to rest. */
export function easeInOut(k: number): number {
  const t = Math.min(1, Math.max(0, k));
  return 0.5 - Math.cos(Math.PI * t) / 2;
}

/** One pose in a demonstration: reached `moveMs` after the previous one, then held for `holdMs`. */
export interface Keyframe {
  pose: FigurePose;
  moveMs: number;
  holdMs?: number;
  /** Where the anchor joint sits in this pose (defaults to the demonstration's). */
  at?: Vec;
  /** A one-word caption shown while moving into this pose ("Lower", "Press"). */
  label?: string;
}

export interface Demonstration {
  view: FigureView;
  anchor: AnchorJoint;
  at: Vec;
  /** The loop: the last keyframe blends back into the first. */
  keyframes: readonly Keyframe[];
}

export function loopDuration(demo: Demonstration): number {
  return demo.keyframes.reduce((total, frame) => total + frame.moveMs + (frame.holdMs ?? 0), 0);
}

export interface DemoFrame {
  points: FigurePoints;
  /** Caption of the move under way (or just finished). */
  label: string | null;
  /** Index of the keyframe being moved into or held. */
  index: number;
}

/** The figure at `t` milliseconds into the loop. */
export function sampleDemo(demo: Demonstration, t: number): DemoFrame {
  const frames = demo.keyframes;
  const total = loopDuration(demo);
  let cursor = total > 0 ? ((t % total) + total) % total : 0;
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const previous = frames[(index - 1 + frames.length) % frames.length];
    if (cursor < frame.moveMs) {
      const k = easeInOut(cursor / frame.moveMs);
      return { points: place(demo, blendPose(previous.pose, frame.pose, k), blendAt(demo, previous, frame, k)), label: frame.label ?? null, index };
    }
    cursor -= frame.moveMs;
    const hold = frame.holdMs ?? 0;
    if (cursor < hold) return { points: place(demo, frame.pose, frame.at ?? demo.at), label: frame.label ?? null, index };
    cursor -= hold;
  }
  const last = frames[frames.length - 1];
  return { points: place(demo, last.pose, last.at ?? demo.at), label: last.label ?? null, index: frames.length - 1 };
}

function blendAt(demo: Demonstration, from: Keyframe, to: Keyframe, k: number): Vec {
  const a = from.at ?? demo.at;
  const b = to.at ?? demo.at;
  return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) };
}

/** Solves a pose and moves it so the anchor joint lands on `at`. */
export function place(demo: Pick<Demonstration, "view" | "anchor">, pose: FigurePose, at: Vec): FigurePoints {
  const solved = solvePose(pose, demo.view);
  return translatePoints(solved, sub(at, jointOf(solved, demo.anchor)));
}

/** The angle at `b` between b→a and b→c, in degrees (0..180). */
export function angleAt(a: Vec, b: Vec, c: Vec): number {
  const u = sub(a, b);
  const v = sub(c, b);
  const lengths = Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y);
  if (lengths === 0) return 0;
  return (Math.acos(Math.min(1, Math.max(-1, (u.x * v.x + u.y * v.y) / lengths))) * 180) / Math.PI;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The box a demonstration needs over its whole loop, padded and widened to `aspect`, with the
 * floor kept in view: the drawing's viewBox, so overhead arms are never cut off.
 */
export function demoBounds(demo: Demonstration, aspect = STAGE.width / STAGE.height, padding = 22, minWidth = 0): Box {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = FLOOR_Y + 6;
  const loop = loopDuration(demo);
  for (let step = 0; step < 48; step += 1) {
    const { points } = sampleDemo(demo, (loop * step) / 48);
    const all = [points.head, ...Object.values(points.near), ...Object.values(points.far)];
    for (const p of all) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y - (p === points.head ? BONES.headRadius : 0));
      maxY = Math.max(maxY, p.y);
    }
  }
  let x = minX - padding;
  let y = minY - padding;
  let width = maxX - minX + padding * 2;
  let height = maxY - minY + padding * 2;
  // Never zoom in past `minWidth`, so a small move is not blown up (and every figure keeps its weight).
  if (width < minWidth) {
    x -= (minWidth - width) / 2;
    width = minWidth;
  }
  if (width / height < aspect) {
    const grown = height * aspect;
    x -= (grown - width) / 2;
    width = grown;
  } else {
    const grown = width / aspect;
    // Grow upwards, so the floor stays near the bottom edge.
    y -= grown - height;
    height = grown;
  }
  return { x, y, width, height };
}
