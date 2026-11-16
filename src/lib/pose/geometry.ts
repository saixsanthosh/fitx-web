/**
 * 2D geometry for pose landmarks. Inputs are image-normalised points; `aspect` (width / height)
 * turns them into square pixels so that angles are true angles on the image.
 */
import type { PosePoint } from "./landmarks";

export interface Vec {
  x: number;
  y: number;
}

const DEG = 180 / Math.PI;

/** Image-normalised point to square-pixel units where the image height is 1. */
export function toPlane(point: PosePoint, aspect: number): Vec {
  return { x: point.x * aspect, y: point.y };
}

export function distance(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Vec, b: Vec): Vec {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** The angle at `b` between b→a and b→c, in degrees (0..180). NaN when a segment has no length. */
export function angleAt(a: Vec, b: Vec, c: Vec): number {
  const ux = a.x - b.x;
  const uy = a.y - b.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  const lengths = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (lengths === 0) return Number.NaN;
  const cos = Math.min(1, Math.max(-1, (ux * vx + uy * vy) / lengths));
  return Math.acos(cos) * DEG;
}

/** How far the line from → to leans away from vertical, in degrees: 0 upright, 90 lying flat. */
export function tiltFromVertical(from: Vec, to: Vec): number {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  if (dx === 0 && dy === 0) return Number.NaN;
  return Math.atan2(dx, dy) * DEG;
}

/** How far the line from → to leans away from horizontal, in degrees: 0 flat, 90 upright. */
export function tiltFromHorizontal(from: Vec, to: Vec): number {
  const tilt = tiltFromVertical(from, to);
  return Number.isNaN(tilt) ? tilt : 90 - tilt;
}

/**
 * Signed distance of `point` from the line through a and b, as a fraction of |ab|.
 * Positive means the point sits below the line (towards the floor in an upright camera image),
 * negative above it. Used for "hips sagging" (positive) and "hips piked" (negative).
 */
export function offsetFromLine(a: Vec, b: Vec, point: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return Number.NaN;
  // Unit normal, turned so it points down the image (y grows downwards).
  let nx = -dy / length;
  let ny = dx / length;
  if (ny < 0 || (ny === 0 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  return ((point.x - a.x) * nx + (point.y - a.y) * ny) / length;
}

/** How far `upper` sits above `lower`, as a fraction of `scale` (positive when it is above). */
export function riseAbove(lower: Vec, upper: Vec, scale: number): number {
  if (!(scale > 0)) return Number.NaN;
  return (lower.y - upper.y) / scale;
}
