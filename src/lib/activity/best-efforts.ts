import { SPORT_CONFIG, usesPace } from "./config";
import type { RoutePoint, Sport } from "./types";

/*
 * Best efforts: the fastest time for each benchmark distance inside one activity, the way Strava counts them for
 * runs (support article "How Do Best Efforts Work for Running on Strava?", read 2026-11-23): elapsed time, like a
 * race clock, so pauses and stops inside the stretch count. Worked out from the engine's committed route (each
 * point carries its time and the distance so far). Distance across an interruption is never added (engine.ts), so
 * a stretch over a gap only gets slower, never faster. Nothing is interpolated beyond the recorded points except
 * the start of the stretch, which is placed on the line between the two points around it.
 */

export type BestEffort = {
  /** Benchmark distance, metres. */
  d: number;
  /** Elapsed seconds for it, whole. */
  s: number;
  /** Where in the activity the stretch started, metres from the start. */
  startM: number;
};

/** Running benchmarks (Strava's list, the metric and mile ones FITX shows); walks and hikes use the shorter ones. */
const RUN_DISTANCES = [400, 1000, 1609.344, 5000, 10_000, 21_097.5, 42_195];
const WALK_DISTANCES = [1000, 1609.344, 5000, 10_000, 21_097.5];
/** Speed sports: whole-kilometre benchmarks. */
const RIDE_DISTANCES = [5000, 10_000, 20_000, 40_000, 100_000];

export function effortDistances(sport: Sport): readonly number[] {
  if (!usesPace(sport)) return RIDE_DISTANCES;
  return sport === "run" || sport === "trail_run" ? RUN_DISTANCES : WALK_DISTANCES;
}

const NAMES: Record<string, string> = {
  "400": "400 m", "1000": "1 km", "1609.344": "1 mile", "5000": "5 km", "10000": "10 km", "20000": "20 km", "21097.5": "Half marathon",
  "40000": "40 km", "42195": "Marathon", "100000": "100 km",
};
export function effortName(distanceM: number): string {
  return NAMES[String(distanceM)] ?? `${Math.round(distanceM / 100) / 10} km`;
}

/** The fastest elapsed time over `distance` within the points, or null when the points do not cover it. */
function fastest(points: readonly RoutePoint[], distance: number): { s: number; startM: number } | null {
  let best: { s: number; startM: number } | null = null;
  let i = 0;
  for (let j = 1; j < points.length; j += 1) {
    const end = points[j];
    if (end.d - points[0].d < distance) continue;
    while (i + 1 < j && end.d - points[i + 1].d >= distance) i += 1;
    const a = points[i];
    const b = points[i + 1];
    const startD = end.d - distance;
    const span = b.d - a.d;
    const startT = span > 0 ? a.t + ((startD - a.d) / span) * (b.t - a.t) : a.t;
    const seconds = (end.t - startT) / 1000;
    if (seconds > 0 && (!best || seconds < best.s)) best = { s: seconds, startM: startD };
  }
  return best;
}

/**
 * Best efforts for a finished activity's route (engine.segments: one array per continuous stretch, in time order).
 * An effort faster than the sport's top plausible speed is dropped as a GPS error rather than shown.
 */
export function bestEfforts(segments: readonly (readonly RoutePoint[])[], sport: Sport): BestEffort[] {
  const points = segments.flat().filter((point, index, all) => index === 0 || (point.t >= all[index - 1].t && point.d >= all[index - 1].d));
  if (points.length < 2) return [];
  const limit = SPORT_CONFIG[sport].maxSpeedMps;
  const efforts: BestEffort[] = [];
  for (const distance of effortDistances(sport)) {
    const found = fastest(points, distance);
    if (!found) break;
    const seconds = Math.round(found.s);
    if (seconds <= 0 || distance / seconds > limit) continue;
    efforts.push({ d: distance, s: seconds, startM: Math.round(found.startM) });
  }
  return efforts;
}

/** Efforts as stored in activities.best_efforts. */
export function effortsToJson(efforts: readonly BestEffort[]): Array<{ d: number; s: number; start_m: number }> {
  return efforts.map((effort) => ({ d: effort.d, s: effort.s, start_m: effort.startM }));
}

/** Stored efforts read back; anything malformed is left out. */
export function effortsFromJson(value: unknown): BestEffort[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { d, s, start_m: startM } = item as Record<string, unknown>;
    return typeof d === "number" && typeof s === "number" && d > 0 && s > 0 ? [{ d, s, startM: typeof startM === "number" ? startM : 0 }] : [];
  });
}

export type RankedEffort = BestEffort & { activityId: string; startedAt: number; sport: Sport };

/**
 * The top three for each distance across activities, fastest first; on a tie the earlier activity ranks higher
 * (it got there first). Running sports (run, trail run) share one table, as do walks and hikes; each speed sport
 * keeps its own, since a ride and an e-bike ride are not comparable.
 */
export function effortTable(sport: Sport): string {
  if (sport === "run" || sport === "trail_run") return "run";
  if (sport === "walk" || sport === "hike") return "walk";
  return sport;
}

export function topEfforts(rows: ReadonlyArray<{ id: string; sport: Sport; startedAt: number; efforts: readonly BestEffort[] }>, table: string, count = 3): Map<number, RankedEffort[]> {
  const byDistance = new Map<number, RankedEffort[]>();
  for (const row of rows) {
    if (effortTable(row.sport) !== table) continue;
    for (const effort of row.efforts) {
      const list = byDistance.get(effort.d) ?? [];
      list.push({ ...effort, activityId: row.id, startedAt: row.startedAt, sport: row.sport });
      byDistance.set(effort.d, list);
    }
  }
  for (const [distance, list] of byDistance) {
    list.sort((a, b) => a.s - b.s || a.startedAt - b.startedAt);
    byDistance.set(distance, list.slice(0, count));
  }
  return new Map([...byDistance].sort((a, b) => a[0] - b[0]));
}

/** 1 for a personal record, 2 or 3 for the second and third best, null otherwise. */
export function effortRank(top: Map<number, RankedEffort[]>, activityId: string, distance: number): 1 | 2 | 3 | null {
  const index = (top.get(distance) ?? []).findIndex((effort) => effort.activityId === activityId);
  return index === 0 ? 1 : index === 1 ? 2 : index === 2 ? 3 : null;
}
