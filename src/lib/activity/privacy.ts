import { boundsOf, haversine, interpolate, type Bounds } from "./geo";
import type { LatLng } from "./types";

/**
 * Routes in share images never show where an activity started or finished (often someone's home):
 * every part of the route within this distance of the start or the finish is removed.
 */
export const PRIVACY_RADIUS_M = 200;

/**
 * The route without anything inside `radiusM` of its first or last point. Stretches are cut
 * cleanly at the circle's edge and may split into several; tiny leftovers are dropped.
 * Returns an empty list when nothing is far enough from both ends.
 */
export function trimForPrivacy(segments: readonly (readonly LatLng[])[], radiusM = PRIVACY_RADIUS_M): LatLng[][] {
  const nonEmpty = segments.filter((segment) => segment.length > 0);
  if (!nonEmpty.length) return [];
  const start = nonEmpty[0][0];
  const lastSegment = nonEmpty[nonEmpty.length - 1];
  const end = lastSegment[lastSegment.length - 1];
  const hidden = (p: LatLng) => haversine(p, start) < radiusM || haversine(p, end) < radiusM;

  /** The point on a->b where hidden-ness changes (bisection; a and b differ in hidden-ness). */
  const edge = (a: LatLng, b: LatLng): LatLng => {
    let lo = 0;
    let hi = 1;
    const aHidden = hidden(a);
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (hidden(interpolate(a, b, mid)) === aHidden) lo = mid;
      else hi = mid;
    }
    // Step to the visible side so the cut never lands inside the circle.
    return interpolate(a, b, aHidden ? hi : lo);
  };

  const result: LatLng[][] = [];
  for (const segment of nonEmpty) {
    let current: LatLng[] = [];
    for (let i = 0; i < segment.length; i++) {
      const point = segment[i];
      const pointHidden = hidden(point);
      if (i > 0) {
        const previous = segment[i - 1];
        const previousHidden = hidden(previous);
        if (previousHidden !== pointHidden) {
          const cut = edge(previous, point);
          if (pointHidden) {
            current.push(cut);
            result.push(current);
            current = [];
          } else {
            current.push(cut);
          }
        }
      }
      if (!pointHidden) current.push(point);
    }
    if (current.length) result.push(current);
  }
  // Leftovers shorter than 20 m say nothing about the route and only add specks.
  return result.filter((part) => part.length >= 2 && part.reduce((sum, p, i) => (i ? sum + haversine(part[i - 1], p) : 0), 0) >= 20);
}

/** Grid the stored bounds snap to, degrees (about 1.1 km of latitude). */
export const BOUNDS_GRID_DEG = 0.01;

/**
 * Bounds of the privacy-trimmed route, widened outward to a 0.01-degree grid. Without the grid,
 * a route along straight streets can still put a corner of its box exactly on the start (the
 * route leaves home northwards and returns from the east, say), revealing it.
 */
export function privateBounds(segments: readonly (readonly LatLng[])[], gridDeg = BOUNDS_GRID_DEG): Bounds | null {
  const bounds = boundsOf(segments);
  if (!bounds) return null;
  const snap = (value: number, round: (x: number) => number) => Math.round(round(value / gridDeg) * gridDeg * 1e6) / 1e6;
  return {
    west: Math.max(-180, snap(bounds.west, Math.floor)),
    south: Math.max(-90, snap(bounds.south, Math.floor)),
    east: Math.min(180, snap(bounds.east, Math.ceil)),
    north: Math.min(90, snap(bounds.north, Math.ceil)),
  };
}
