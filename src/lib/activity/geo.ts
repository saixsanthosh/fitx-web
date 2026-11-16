import type { LatLng } from "./types";

/** Mean Earth radius (IUGG), metres. */
export const EARTH_RADIUS_M = 6371008.8;
const RAD = Math.PI / 180;

/** Great-circle distance between two points, metres (haversine formula). */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Total length of a polyline, metres. */
export function pathLength(points: readonly LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversine(points[i - 1], points[i]);
  return total;
}

/** The point a fraction `f` (0..1) of the way from `a` to `b` (linear in degrees; fine for short spans). */
export function interpolate(a: LatLng, b: LatLng, f: number): LatLng {
  return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
}

/** The point `metres` from `origin` towards `bearingDeg` (0 = north, 90 = east). */
export function destination(origin: LatLng, bearingDeg: number, metres: number): LatLng {
  const delta = metres / EARTH_RADIUS_M;
  const theta = bearingDeg * RAD;
  const phi1 = origin.lat * RAD;
  const lambda1 = origin.lng * RAD;
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta));
  const lambda2 = lambda1 + Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(phi1), Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2));
  return { lat: phi2 / RAD, lng: ((((lambda2 / RAD) + 540) % 360) - 180) };
}

/** Local flat projection around `origin` (equirectangular): x east, y north, metres. */
export function projector(origin: LatLng) {
  const kx = Math.cos(origin.lat * RAD) * EARTH_RADIUS_M * RAD;
  const ky = EARTH_RADIUS_M * RAD;
  return {
    toXY: (p: LatLng) => ({ x: (p.lng - origin.lng) * kx, y: (p.lat - origin.lat) * ky }),
    toLatLng: (x: number, y: number): LatLng => ({ lat: origin.lat + y / ky, lng: origin.lng + x / kx }),
  };
}

export type Bounds = { west: number; south: number; east: number; north: number };

/** Bounding box of every point in every segment, or null when there are none. */
export function boundsOf(segments: readonly (readonly LatLng[])[]): Bounds | null {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const segment of segments) {
    for (const p of segment) {
      if (p.lng < west) west = p.lng;
      if (p.lng > east) east = p.lng;
      if (p.lat < south) south = p.lat;
      if (p.lat > north) north = p.lat;
    }
  }
  return Number.isFinite(west) ? { west, south, east, north } : null;
}

/**
 * Douglas–Peucker simplification: keeps the fewest points that stay within `toleranceM` of the
 * original line. The first and last points are always kept. Iterative, so long tracks cannot
 * overflow the stack.
 */
export function simplify<T extends LatLng>(points: readonly T[], toleranceM: number): T[] {
  if (points.length <= 2 || toleranceM <= 0) return points.slice();
  const { toXY } = projector(points[0]);
  const xy = points.map(toXY);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  const tolerance2 = toleranceM * toleranceM;
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxDistance2 = 0;
    let index = -1;
    const a = xy[first];
    const b = xy[last];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    for (let i = first + 1; i < last; i++) {
      const p = xy[i];
      let distance2: number;
      if (length2 === 0) {
        distance2 = (p.x - a.x) ** 2 + (p.y - a.y) ** 2;
      } else {
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
        distance2 = (p.x - (a.x + t * dx)) ** 2 + (p.y - (a.y + t * dy)) ** 2;
      }
      if (distance2 > maxDistance2) {
        maxDistance2 = distance2;
        index = i;
      }
    }
    if (index !== -1 && maxDistance2 > tolerance2) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}
