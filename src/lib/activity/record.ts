import { bestEfforts, type BestEffort } from "./best-efforts";
import { usesPace } from "./config";
import { kcalMethodFor, usableWeight } from "./calories";
import type { ActivityEngine } from "./engine";
import { simplify, type Bounds } from "./geo";
import { encodeRoute, encodeTrackChunk } from "./polyline";
import { privateBounds, trimForPrivacy } from "./privacy";
import type { ActivitySource, ControlEvent, Fix, Gap, ImportFormat, LatLng, LogEntry, Split, Sport } from "./types";

/** Version of the engine rules that produced a summary; stored so old summaries can be recomputed. */
export const ENGINE_VERSION = 1;
/** Fixes per stored chunk: 15 minutes at one fix a second, roughly 17 KB of text. */
export const CHUNK_SIZE = 900;
/** Database limits (activities / activity_track_chunks checks): never send more than these. */
export const LIMITS = { maxChunks: 200, maxChunkPoints: 1000, maxChunkChars: 40_000, maxPolylineChars: 100_000 } as const;

export type TrackChunk = { seq: number; startedAt: number; endedAt: number; pointCount: number; points: string };

/** Everything saved about a finished activity (camelCase; the repository maps it to columns). */
export type ActivityRecord = {
  clientId: string;
  sport: Sport;
  title: string;
  startedAt: number;
  endedAt: number;
  elapsedSeconds: number;
  movingSeconds: number;
  pausedSeconds: number;
  distanceM: number;
  avgSpeedMps: number | null;
  maxSpeedMps: number | null;
  avgPaceSecondsPerKm: number | null;
  elevationGainM: number | null;
  kcal: number | null;
  kcalMethod: string | null;
  weightKg: number | null;
  gapCount: number;
  gapSeconds: number;
  splits: Split[];
  gaps: Gap[];
  /** Control events as [type, milliseconds after the start]. */
  timeline: Array<[ControlEvent["type"], number]>;
  routePolyline: string;
  sharePolyline: string;
  /** [west, south, east, north] of the privacy-trimmed route. */
  shareBbox: [number, number, number, number] | null;
  pointCount: number;
  chunks: TrackChunk[];
  engineVersion: number;
  /**
   * Where the data came from. Absent (older device copies) or "fitx_gps" for the Record screen;
   * those uploads never send the source columns, so they work before migration 20261119100000.
   */
  source?: ActivitySource;
  /**
   * Fastest elapsed time per benchmark distance (best-efforts.ts), from the finished route. Absent on device copies
   * made by an older app version; saved in activities.best_efforts once migration 20261123100050 is applied.
   */
  bestEfforts?: BestEffort[] | null;
  /** For imports: the file's format, the device or app the file names (never guessed) and when it was imported. */
  sourceFormat?: ImportFormat | null;
  sourceDevice?: string | null;
  importedAt?: number | null;
};

const round1 = (value: number) => Math.round(value * 10) / 10;
const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** Route simplification tolerance: about the precision of the stored polyline. */
function toleranceFor(sport: Sport): number {
  return usesPace(sport) ? 2 : 4;
}

export function simplifiedRoute(segments: readonly (readonly LatLng[])[], sport: Sport): LatLng[][] {
  return segments.filter((segment) => segment.length > 0).map((segment) => simplify(segment, toleranceFor(sport)).map(({ lat, lng }) => ({ lat, lng })));
}

/**
 * Splits fixes into encoded chunks within the database limits: at most 1,000 fixes and 40,000
 * characters each, and at most 200 chunks (more fixes than that, from a phone reporting faster
 * than once a second for two days, are thinned evenly).
 */
export function chunkFixes(fixes: readonly Fix[], size = CHUNK_SIZE): TrackChunk[] {
  const capacity = LIMITS.maxChunks * LIMITS.maxChunkPoints;
  const step = Math.ceil(fixes.length / capacity) || 1;
  const kept = step > 1 ? fixes.filter((_, i) => i % step === 0) : fixes;
  const perChunk = Math.min(LIMITS.maxChunkPoints, Math.max(size, Math.ceil(kept.length / LIMITS.maxChunks)));
  const chunks: TrackChunk[] = [];
  let i = 0;
  while (i < kept.length) {
    if (chunks.length === LIMITS.maxChunks) {
      // Only with extreme jumps between fixes (long chunks split below): thin evenly and start again.
      return chunkFixes(kept.filter((_, k) => k % 2 === 0), size);
    }
    let count = Math.min(perChunk, kept.length - i);
    let part = kept.slice(i, i + count);
    let points = encodeTrackChunk(part, part[0].t);
    // Unusually large jumps between fixes take more characters: use fewer fixes in that chunk.
    while (points.length > LIMITS.maxChunkChars && count > 1) {
      count = Math.max(1, Math.floor(count / 2));
      part = kept.slice(i, i + count);
      points = encodeTrackChunk(part, part[0].t);
    }
    chunks.push({ seq: chunks.length, startedAt: part[0].t, endedAt: part[part.length - 1].t, pointCount: part.length, points });
    i += count;
  }
  return chunks;
}

/** An encoded route within `maxChars`: simplified more coarsely until it fits. */
export function encodeRouteWithin(segments: readonly (readonly LatLng[])[], toleranceM: number, maxChars: number = LIMITS.maxPolylineChars): string {
  let tolerance = toleranceM;
  let encoded = encodeRoute(segments.map((segment) => simplify(segment, tolerance)));
  while (encoded.length > maxChars && tolerance < 5_000) {
    tolerance = tolerance > 0 ? tolerance * 2 : 2;
    encoded = encodeRoute(segments.map((segment) => simplify(segment, tolerance)));
  }
  return encoded;
}

function bboxOf(bounds: Bounds | null): [number, number, number, number] | null {
  return bounds ? [round6(bounds.west), round6(bounds.south), round6(bounds.east), round6(bounds.north)] : null;
}
function round6(value: number) {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * The record to save for a finished engine. `log` supplies the control timeline; `weightKg` the
 * body weight for the calorie estimate (no weight: no calories).
 */
export function buildActivityRecord(engine: ActivityEngine, options: { clientId: string; title: string; weightKg: unknown; log: readonly LogEntry[] }): ActivityRecord {
  if (engine.status !== "finished" || engine.startedAt === null || engine.endedAt === null) throw new Error("The activity is not finished");
  const snapshot = engine.snapshot(engine.endedAt);
  const weight = usableWeight(options.weightKg);
  const kcal = weight === null ? null : engine.kcal(weight);
  const elapsedSeconds = Math.round(snapshot.elapsedSeconds);
  const movingSeconds = Math.min(elapsedSeconds, Math.round(snapshot.movingSeconds));
  const route = simplifiedRoute(snapshot.segments, engine.sport);
  const shared = trimForPrivacy(route).map((segment) => simplify(segment, 5));
  const startedAt = engine.startedAt;
  const timeline = options.log
    .filter((entry): entry is Extract<LogEntry, { kind: "control" }> => entry.kind === "control")
    .map((entry): [ControlEvent["type"], number] => [entry.event.type, Math.max(0, entry.event.t - startedAt)]);

  return {
    clientId: options.clientId,
    sport: engine.sport,
    title: options.title,
    startedAt,
    endedAt: engine.endedAt,
    elapsedSeconds,
    movingSeconds,
    pausedSeconds: Math.round(snapshot.pausedSeconds),
    distanceM: round1(snapshot.distanceM),
    avgSpeedMps: snapshot.avgSpeedMps === null ? null : round3(snapshot.avgSpeedMps),
    maxSpeedMps: snapshot.maxSpeedMps === null ? null : round3(snapshot.maxSpeedMps),
    avgPaceSecondsPerKm: snapshot.avgPaceSecondsPerKm === null ? null : Math.round(snapshot.avgPaceSecondsPerKm),
    elevationGainM: snapshot.elevationGainM,
    kcal,
    kcalMethod: kcal === null ? null : kcalMethodFor(snapshot.sport),
    weightKg: weight === null ? null : round1(weight),
    gapCount: snapshot.gaps.length,
    gapSeconds: Math.round(snapshot.gapSeconds),
    splits: snapshot.splits,
    gaps: snapshot.gaps,
    timeline,
    bestEfforts: bestEfforts(snapshot.segments, engine.sport),
    routePolyline: encodeRouteWithin(route, 0),
    sharePolyline: encodeRouteWithin(shared, 0),
    shareBbox: bboxOf(privateBounds(shared)),
    pointCount: engine.recordedFixes.length,
    chunks: chunkFixes(engine.recordedFixes),
    engineVersion: ENGINE_VERSION,
  };
}
