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
}

/** Landmarks this loose still place a shoulder or hip well enough to judge which way the body faces. */
const FACING_VISIBILITY = 0.3;
const SIDES: readonly Side[] = ["left", "right"];
const BODY_JOINTS: readonly Joint[] = ["shoulder", "elbow", "wrist", "hip", "knee", "ankle"];

export function readFrame(rule: ExerciseRule, frame: PoseFrame, preferredSide: Side | null): FrameReading {
  const points = frame.points;
  if (!points || points.length < 33) {
    return { person: false, side: preferredSide, missing: [...rule.required], values: {}, facing: undefined, extent: undefined };
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

  const values: Record<string, number | undefined> = {};
  for (const [id, spec] of Object.entries(rule.metrics)) values[id] = measure(spec, side, seen);

  return { person: true, side, missing, values, facing: facingRatio(points, aspect), extent: bodyExtent(points, aspect, rule.minVisibility) };
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
