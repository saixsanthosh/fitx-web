import { boundsOf, haversine, interpolate, type Bounds } from "./geo";
import type { LatLng } from "./types";

/**
 * Routes in share images never show where an activity started or finished (often someone's home).
 * Everything within this distance of the start or the finish is always removed.
 */
export const PRIVACY_RADIUS_M = 200;

/**
 * The hidden area is not centred on the start or finish itself: a circle around it would put the
 * centre of the gap (or of any circle through the cut ends) exactly on the home. Instead the start
 * and finish are snapped to a fixed grid of cells this size, and a larger circle around the cell's
 * centre is hidden. The cut then reveals only the cell, and repeated activities from the same home
 * give the same cell, so averaging them reveals nothing more.
 */
export const PRIVACY_GRID_M = 150;

const METRES_PER_DEGREE_LAT = 111_320;
const RAD = Math.PI / 180;
/** Every edge is split into steps no longer than this before trimming, so lines crossing a zone are cut. */
const DENSIFY_STEP_M = 5;

export type PrivacyZone = { center: LatLng; radiusM: number };

/** The centre of the fixed grid cell (about `sizeM` square) that contains `p`. */
export function gridCellCenter(p: LatLng, sizeM = PRIVACY_GRID_M): LatLng {
  const dLat = sizeM / METRES_PER_DEGREE_LAT;
  const row = Math.floor(p.lat / dLat);
  const lat = (row + 0.5) * dLat;
  const dLng = sizeM / (METRES_PER_DEGREE_LAT * Math.max(0.01, Math.cos(lat * RAD)));
  const col = Math.floor(p.lng / dLng);
  return { lat, lng: (col + 0.5) * dLng };
}

/**
 * The areas to hide for a route: one around the start's grid cell and one around the finish's. The
 * radius covers everything within PRIVACY_RADIUS_M of any point of the cell (plus a metre for the
 * flat-earth cell size), so the true start and finish are always well inside.
 */
export function privacyZones(segments: readonly (readonly LatLng[])[]): PrivacyZone[] {
  const nonEmpty = segments.filter((segment) => segment.length > 0);
  if (!nonEmpty.length) return [];
  const start = nonEmpty[0][0];
  const lastSegment = nonEmpty[nonEmpty.length - 1];
  const end = lastSegment[lastSegment.length - 1];
  const radiusM = PRIVACY_RADIUS_M + (PRIVACY_GRID_M * Math.SQRT2) / 2 + 1;
  const zones = [{ center: gridCellCenter(start), radiusM }];
  const finish = gridCellCenter(end);
  if (haversine(finish, zones[0].center) > 0.01) zones.push({ center: finish, radiusM });
  return zones;
}

function densify(segment: readonly LatLng[]): LatLng[] {
  if (segment.length < 2) return segment.slice();
  const out: LatLng[] = [segment[0]];
  for (let i = 1; i < segment.length; i++) {
    const a = segment[i - 1];
    const b = segment[i];
    const steps = Math.ceil(haversine(a, b) / DENSIFY_STEP_M);
    for (let k = 1; k < steps; k++) out.push(interpolate(a, b, k / steps));
    out.push(b);
  }
  return out;
}

/**
 * The route without anything inside the privacy zones of its start and finish. Stretches are cut
 * cleanly at a zone's edge and may split into several; tiny leftovers are dropped. Returns an empty
 * list when nothing is far enough from both ends.
 */
export function trimForPrivacy(segments: readonly (readonly LatLng[])[], zones: readonly PrivacyZone[] = privacyZones(segments)): LatLng[][] {
  const nonEmpty = segments.filter((segment) => segment.length > 0);
  if (!nonEmpty.length) return [];
  const hidden = (p: LatLng) => zones.some((zone) => haversine(p, zone.center) < zone.radiusM);

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
    // Step to the visible side so the cut never lands inside a zone.
    return interpolate(a, b, aHidden ? hi : lo);
  };

  const result: LatLng[][] = [];
  for (const original of nonEmpty) {
    const segment = densify(original);
    let current: LatLng[] = [];
    for (let i = 0; i < segment.length; i++) {
      const point = segment[i];
      const pointHidden = hidden(point);
      if (i > 0) {
        const previous = segment[i - 1];
        if (hidden(previous) !== pointHidden) {
          const cut = edge(previous, point);
          current.push(cut);
          if (pointHidden) {
            result.push(current);
            current = [];
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
