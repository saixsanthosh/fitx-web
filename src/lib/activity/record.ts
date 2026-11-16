import { KCAL_METHOD, usableWeight } from "./calories";
import type { ActivityEngine } from "./engine";
import { simplify, type Bounds } from "./geo";
import { encodeRoute, encodeTrackChunk } from "./polyline";
import { privateBounds, trimForPrivacy } from "./privacy";
import type { ControlEvent, Fix, Gap, LatLng, LogEntry, Split, Sport } from "./types";

/** Version of the engine rules that produced a summary; stored so old summaries can be recomputed. */
export const ENGINE_VERSION = 1;
/** Fixes per stored chunk: 15 minutes at one fix a second, roughly 12 KB of text. */
export const CHUNK_SIZE = 900;

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
};

const round1 = (value: number) => Math.round(value * 10) / 10;
const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** Route simplification tolerance: about the precision of the stored polyline. */
function toleranceFor(sport: Sport): number {
  return sport === "ride" ? 4 : 2;
}

export function simplifiedRoute(segments: readonly (readonly LatLng[])[], sport: Sport): LatLng[][] {
  return segments.filter((segment) => segment.length > 0).map((segment) => simplify(segment, toleranceFor(sport)).map(({ lat, lng }) => ({ lat, lng })));
}

export function chunkFixes(fixes: readonly Fix[], size = CHUNK_SIZE): TrackChunk[] {
  const chunks: TrackChunk[] = [];
  for (let i = 0; i < fixes.length; i += size) {
    const part = fixes.slice(i, i + size);
    const base = part[0].t;
    chunks.push({ seq: chunks.length, startedAt: base, endedAt: part[part.length - 1].t, pointCount: part.length, points: encodeTrackChunk(part, base) });
  }
  return chunks;
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
    kcalMethod: kcal === null ? null : KCAL_METHOD,
    weightKg: weight === null ? null : round1(weight),
    gapCount: snapshot.gaps.length,
    gapSeconds: Math.round(snapshot.gapSeconds),
    splits: snapshot.splits,
    gaps: snapshot.gaps,
    timeline,
    routePolyline: encodeRoute(route),
    sharePolyline: encodeRoute(shared),
    shareBbox: bboxOf(privateBounds(shared)),
    pointCount: engine.recordedFixes.length,
    chunks: chunkFixes(engine.recordedFixes),
    engineVersion: ENGINE_VERSION,
  };
}
