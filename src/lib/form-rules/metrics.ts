/**
 * Turns one pose frame into the measurements an exercise rule asks for. A measurement is only
 * taken from landmarks seen clearly; otherwise it is left undefined, so nothing downstream can
 * count from guessed positions.
 */
import type { Joint, PoseFrame, PosePoint, Side } from "@/lib/pose/landmarks";
import { isConfident, landmarkIndex } from "@/lib/pose/landmarks";
import type { Vec } from "@/lib/pose/geometry";
import { angleAt, distance, midpoint, offsetFromLine, riseAbove, tiltFromHorizontal, tiltFromVertical, toPlane } from "@/lib/pose/geometry";
import type { Condition, ExerciseRule, MetricSpec } from "./types";

export interface FrameReading {
  /** A person was found in the frame. */
  person: boolean;
  /** The body side used for "visible" measurements. */
  side: Side | null;
  /** Required joints not seen clearly (on the side used, or on either side for front-on rules). */
  missing: Joint[];
  /** Measurements by metric id; undefined when a landmark they need was not seen clearly. */
  values: Record<string, number | undefined>;
  /** Shoulder width / torso length: near 0 side-on to the camera, about 0.8 facing it. */
  facing: number | undefined;
  /** Size of the seen body in image heights (the larger of its width and its height). */
  extent: number | undefined;
  /** Some measurement was taken in 3D from world landmarks on this frame. */
  usedWorld: boolean;
}

/** Facing ratios between these are an oblique view: neither side-on nor square to the camera. */
const OBLIQUE_FROM = 0.28;
const OBLIQUE_TO = 0.62;

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Landmarks this loose still place a shoulder or hip well enough to judge which way the body faces. */
const FACING_VISIBILITY = 0.3;
const SIDES: readonly Side[] = ["left", "right"];
const BODY_JOINTS: readonly Joint[] = ["shoulder", "elbow", "wrist", "hip", "knee", "ankle"];

export function readFrame(rule: ExerciseRule, frame: PoseFrame, preferredSide: Side | null): FrameReading {
  const points = frame.points;
  if (!points || points.length < 33) {
    return { person: false, side: preferredSide, missing: [...rule.required], values: {}, facing: undefined, extent: undefined, usedWorld: false };
  }
  const aspect = frame.aspect > 0 ? frame.aspect : 1;
  const seen = (joint: Joint, side: Side) => {
    const point = points[landmarkIndex(joint, side)];
    return isConfident(point, rule.minVisibility) ? toPlane(point, aspect) : null;
  };

  const side = chooseSide(points, rule, preferredSide);
  const missing = rule.view === "front"
    ? rule.required.filter((joint) => SIDES.some((s) => !seen(joint, s)))
    : rule.required.filter((joint) => !seen(joint, side));

  const facing = facingRatio(points, aspect);
  const world = frame.world && frame.world.length >= 33 ? frame.world : null;
  const oblique = facing !== undefined && facing > OBLIQUE_FROM && facing < OBLIQUE_TO;
  /** A world landmark, only for joints the picture also sees clearly (world points are never guessed into use). */
  const seen3d = (joint: Joint, side: Side): Vec3 | null => {
    if (!world || !seen(joint, side)) return null;
    const point = world[landmarkIndex(joint, side)];
    return point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z ?? Number.NaN) ? { x: point.x, y: point.y, z: point.z as number } : null;
  };
  let usedWorld = false;
  const values: Record<string, number | undefined> = {};
  for (const [id, spec] of Object.entries(rule.metrics)) {
    const space = spec.kind === "angle" || spec.kind === "tilt" ? spec.space ?? "auto" : "image";
    const in3d = world !== null && (space === "world" || (space === "auto" && oblique));
    const value = in3d ? measure3d(spec, side, seen, seen3d) : undefined;
    if (value !== undefined) usedWorld = true;
    values[id] = value ?? measure(spec, side, seen);
  }

  return { person: true, side, missing, values, facing, extent: bodyExtent(points, aspect, rule.minVisibility), usedWorld };
}

/**
 * An angle or tilt measured in 3D, or undefined when it can't be (other kinds, or a joint not seen).
 * World landmarks share the picture's axes (x right, y down, z towards or away from the lens), so
 * "vertical" is the picture's up and down, as on the picture itself.
 */
function measure3d(
  spec: MetricSpec,
  side: Side,
  seen: (joint: Joint, side: Side) => Vec | null,
  seen3d: (joint: Joint, side: Side) => Vec3 | null,
): number | undefined {
  const one = (s: Side): number | undefined => {
    if (spec.kind === "angle") {
      const [ja, jb, jc] = spec.joints;
      const a = seen3d(ja, s);
      const b = seen3d(jb, s);
      const c = seen3d(jc, s);
      if (!a || !b || !c) return undefined;
      const angle = angle3d(a, b, c);
      if (angle === undefined) return undefined;
      if (!spec.signed) return angle;
      // Which side of the line the middle joint lies on is read from the picture, as in 2D.
      const pa = seen(ja, s);
      const pb = seen(jb, s);
      const pc = seen(jc, s);
      return pa && pb && pc && offsetFromLine(pa, pc, pb) < 0 ? 360 - angle : angle;
    }
    if (spec.kind === "tilt") {
      const from = seen3d(spec.from, s);
      const to = seen3d(spec.to, s);
      if (!from || !to) return undefined;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dz = to.z - from.z;
      if (dx === 0 && dy === 0 && dz === 0) return undefined;
      const fromVertical = (Math.atan2(Math.hypot(dx, dz), Math.abs(dy)) * 180) / Math.PI;
      return spec.reference === "vertical" ? fromVertical : 90 - fromVertical;
    }
    return undefined;
  };
  if (spec.kind !== "angle" && spec.kind !== "tilt") return undefined;
  if (spec.side === "visible") return one(side);
  const left = one("left");
  const right = one("right");
  if (left === undefined || right === undefined) return undefined;
  return spec.side === "both-min" ? Math.min(left, right) : Math.max(left, right);
}

function angle3d(a: Vec3, b: Vec3, c: Vec3): number | undefined {
  const u = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  const v = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const lengths = Math.hypot(u.x, u.y, u.z) * Math.hypot(v.x, v.y, v.z);
  if (!(lengths > 0)) return undefined;
  const cos = Math.min(1, Math.max(-1, (u.x * v.x + u.y * v.y + u.z * v.z) / lengths));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** True when every condition holds for these values (a missing value fails its condition). */
export function allHold(conditions: readonly Condition[], values: Record<string, number | undefined>): boolean {
  return conditions.every((condition) => holds(condition, values));
}

/** True when at least one condition holds. */
export function anyHolds(conditions: readonly Condition[], values: Record<string, number | undefined>): boolean {
  return conditions.some((condition) => holds(condition, values));
}

function holds(condition: Condition, values: Record<string, number | undefined>): boolean {
  const value = values[condition.metric];
  if (value === undefined || Number.isNaN(value)) return false;
  return condition.op === "<=" ? value <= condition.value : value >= condition.value;
}

/**
 * Picks the body side the camera sees best. A side where every required joint is clear wins;
 * otherwise the side with the higher total visibility. The previous side is kept unless the other
 * is clearly better, so the choice does not flicker frame to frame.
 */
function chooseSide(points: readonly PosePoint[], rule: ExerciseRule, preferred: Side | null): Side {
  const score = (side: Side) => {
    let total = 0;
    let complete = true;
    for (const joint of rule.required) {
      const point = points[landmarkIndex(joint, side)];
      if (isConfident(point, rule.minVisibility)) total += point.visibility ?? 1;
      else complete = false;
    }
    return { total, complete };
  };
  const left = score("left");
  const right = score("right");
  if (left.complete !== right.complete) return left.complete ? "left" : "right";
  if (preferred && Math.abs(left.total - right.total) < 0.15 * rule.required.length) return preferred;
  return left.total >= right.total ? "left" : "right";
}

function measure(spec: MetricSpec, side: Side, seen: (joint: Joint, side: Side) => Vec | null): number | undefined {
  if (spec.kind === "spread") {
    const a = seen(spec.joint, "left");
    const b = seen(spec.joint, "right");
    const ra = seen(spec.reference, "left");
    const rb = seen(spec.reference, "right");
    if (!a || !b || !ra || !rb) return undefined;
    const reference = Math.abs(ra.x - rb.x);
    // Side-on, the two reference points overlap and the ratio means nothing.
    if (reference < 0.02) return undefined;
    return Math.abs(a.x - b.x) / reference;
  }
  const one = (s: Side): number | undefined => {
    switch (spec.kind) {
      case "angle": {
        const [ja, jb, jc] = spec.joints;
        const a = seen(ja, s);
        const b = seen(jb, s);
        const c = seen(jc, s);
        if (!a || !b || !c) return undefined;
        const angle = angleAt(a, b, c);
        return finite(spec.signed && offsetFromLine(a, c, b) < 0 ? 360 - angle : angle);
      }
      case "tilt": {
        const from = seen(spec.from, s);
        const to = seen(spec.to, s);
        if (!from || !to) return undefined;
        return finite(spec.reference === "vertical" ? tiltFromVertical(from, to) : tiltFromHorizontal(from, to));
      }
      case "lineOffset": {
        const from = seen(spec.from, s);
        const to = seen(spec.to, s);
        const point = seen(spec.point, s);
        return from && to && point ? finite(offsetFromLine(from, to, point)) : undefined;
      }
      case "rise": {
        const lower = seen(spec.lower, s);
        const upper = seen(spec.upper, s);
        return lower && upper ? finite(riseAbove(lower, upper, distance(lower, upper))) : undefined;
      }
      case "level": {
        const point = seen(spec.point, s);
        const base = seen(spec.base, s);
        const from = seen(spec.scale[0], s);
        const to = seen(spec.scale[1], s);
        if (!point || !base || !from || !to) return undefined;
        const length = distance(from, to);
        // A scale segment seen end-on says nothing about size.
        return length > 0.01 ? finite(riseAbove(base, point, length)) : undefined;
      }
    }
  };
  if (spec.side === "visible") return one(side);
  const left = one("left");
  const right = one("right");
  if (left === undefined || right === undefined) return undefined;
  return spec.side === "both-min" ? Math.min(left, right) : Math.max(left, right);
}

function finite(value: number): number | undefined {
  return Number.isFinite(value) ? value : undefined;
}

/** Shoulder width relative to torso length, from loosely seen shoulders and hips. */
function facingRatio(points: readonly PosePoint[], aspect: number): number | undefined {
  const get = (joint: Joint, side: Side) => {
    const point = points[landmarkIndex(joint, side)];
    return isConfident(point, FACING_VISIBILITY) ? toPlane(point, aspect) : null;
  };
  const ls = get("shoulder", "left");
  const rs = get("shoulder", "right");
  const lh = get("hip", "left");
  const rh = get("hip", "right");
  if (!ls || !rs || !lh || !rh) return undefined;
  const torso = distance(midpoint(ls, rs), midpoint(lh, rh));
  if (!(torso > 0.01)) return undefined;
  return distance(ls, rs) / torso;
}

/** The larger side of the box around the clearly seen body joints, in image heights. */
function bodyExtent(points: readonly PosePoint[], aspect: number, minVisibility: number): number | undefined {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let count = 0;
  for (const joint of BODY_JOINTS) {
    for (const side of SIDES) {
      const point = points[landmarkIndex(joint, side)];
      if (!isConfident(point, minVisibility)) continue;
      const p = toPlane(point, aspect);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
      count += 1;
    }
  }
  if (count < 3) return undefined;
  return Math.max(maxX - minX, maxY - minY);
}
