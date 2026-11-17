import type { Fix, RoutePoint } from "./types";

/*
 * The elevation profile of an activity: altitude against distance, from the recorded points that
 * carry an altitude. Each stretch of the route is its own line (gaps are never joined), the altitude
 * is smoothed the way the engine smooths it for climb (vertical accuracy worse than 15 m is left
 * out), and the distance of each point is the engine's distance at that moment, so the profile's
 * length matches the activity's. With too few altitude readings there is no profile, never a guess.
 */

export type ProfilePoint = { d: number; alt: number };
export type ElevationProfile = {
  /** One line per continuous stretch, in distance order. */
  lines: ProfilePoint[][];
  minAlt: number;
  maxAlt: number;
  /** Distance covered by the profile's x axis, metres. */
  distanceM: number;
  points: number;
};

/** Fewer altitude readings than this give no profile. */
export const MIN_PROFILE_POINTS = 10;
const MAX_VERTICAL_ACCURACY_M = 15;
const SMOOTHING = 0.25;
/** Points drawn per profile at most (evenly thinned). */
export const MAX_PROFILE_POINTS = 400;

/** The engine's distance at time `t` within a stretch of committed route points. */
export function distanceAt(route: readonly RoutePoint[], t: number): number | null {
  if (!route.length) return null;
  if (t <= route[0].t) return route[0].d;
  const last = route[route.length - 1];
  if (t >= last.t) return last.d;
  let lo = 0;
  let hi = route.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (route[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = route[lo];
  const b = route[hi];
  const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  return a.d + (b.d - a.d) * f;
}

/**
 * `accepted[i]` are the points the engine used for stretch i and `route[i]` the route it committed
 * for it (ActivityEngine.acceptedSegments and .segments, which line up one to one).
 */
export function elevationProfile(accepted: readonly (readonly Fix[])[], route: readonly (readonly RoutePoint[])[]): ElevationProfile | null {
  const lines: ProfilePoint[][] = [];
  let count = 0;
  for (let i = 0; i < accepted.length; i++) {
    const stretch = route[i] ?? [];
    let smoothed: number | null = null;
    const line: ProfilePoint[] = [];
    for (const fix of accepted[i]) {
      if (fix.alt === null || !Number.isFinite(fix.alt)) continue;
      if (fix.altAcc !== null && fix.altAcc > MAX_VERTICAL_ACCURACY_M) continue;
      const d = distanceAt(stretch, fix.t);
      if (d === null) continue;
      smoothed = smoothed === null ? fix.alt : smoothed + SMOOTHING * (fix.alt - smoothed);
      const previous = line[line.length - 1];
      if (previous && d < previous.d) continue;
      line.push({ d, alt: smoothed });
      count++;
    }
    if (line.length > 1) lines.push(line);
  }
  if (count < MIN_PROFILE_POINTS || !lines.length) return null;
  const start = lines[0][0].d;
  const lastLine = lines[lines.length - 1];
  const distanceM = lastLine[lastLine.length - 1].d - start;
  if (!(distanceM > 0)) return null;
  let minAlt = Infinity;
  let maxAlt = -Infinity;
  for (const line of lines) for (const point of line) {
    minAlt = Math.min(minAlt, point.alt);
    maxAlt = Math.max(maxAlt, point.alt);
  }
  const step = Math.max(1, Math.ceil(count / MAX_PROFILE_POINTS));
  const thinned = lines.map((line) => line.filter((_, k) => k % step === 0 || k === line.length - 1).map((p) => ({ d: p.d - start, alt: p.alt })));
  return { lines: thinned, minAlt, maxAlt, distanceM, points: count };
}

/** SVG path data for the profile in a `width` x `height` box (altitude axis padded by 10%, at least 10 m tall). */
export function profilePaths(profile: ElevationProfile, width: number, height: number): { lines: string[]; areas: string[] } {
  const span = Math.max(10, profile.maxAlt - profile.minAlt);
  const bottom = profile.minAlt - span * 0.1;
  const top = bottom + span * 1.2;
  const x = (d: number) => (d / profile.distanceM) * width;
  const y = (alt: number) => height - ((alt - bottom) / (top - bottom)) * height;
  const fmt = (n: number) => (Math.round(n * 10) / 10).toString();
  const lines = profile.lines.map((line) => line.map((p, i) => `${i ? "L" : "M"}${fmt(x(p.d))} ${fmt(y(p.alt))}`).join(" "));
  const areas = profile.lines.map((line, i) => `${lines[i]} L${fmt(x(line[line.length - 1].d))} ${height} L${fmt(x(line[0].d))} ${height} Z`);
  return { lines, areas };
}
