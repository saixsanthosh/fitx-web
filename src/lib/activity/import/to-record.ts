import { ActivityEngine } from "../engine";
import { cleanTitle, defaultTitle } from "../format";
import { buildActivityRecord, type ActivityRecord } from "../record";
import { logFromFixes } from "../replay";
import { DEVICE_KCAL_PREFIX } from "../source";
import type { ControlEvent, Fix, ImportFormat, Sport } from "../types";
import { DEFAULT_IMPORT_ACCURACY_M, IMPORT_ENGINE } from "./config";
import { ImportError, type ParsedImport } from "./types";

/*
 * Turns a read file into the activity FITX saves. The file's points are replayed through FITX's own
 * engine, with the same rules as a phone recording: stretches without points, jumps and pauses add
 * no distance or moving time, kilometre splits and climb come from the points, and the top speed
 * only from the device's own speed readings. So every number on an imported activity means what it
 * means on a recorded one. The device's own totals are kept beside it for the preview, and its
 * calorie figure, when the file has one, is saved as the device's estimate (labelled as such).
 */

export const FORMAT_LABEL: Record<ImportFormat, string> = { gpx: "GPX", tcx: "TCX", fit: "FIT" };

/** Detailed GPS points are deleted 90 days after an activity ended; older imports keep their route only. */
export const POINTS_KEPT_DAYS = 90;

export type ImportBuild = {
  record: ActivityRecord;
  /** What the device itself wrote: total distance, or its last distance reading. Null when the file has none. */
  deviceDistanceM: number | null;
  /** Calories saved come from the device (true) or FITX's MET estimate (false). */
  kcalFromDevice: boolean;
  /** Detailed points were left out because the activity ended more than 90 days ago. */
  pointsDropped: boolean;
};

/** The control timeline (ms after the start): the device's pauses, or GPX segment breaks, then the finish. */
export function importTimeline(parsed: ParsedImport): Array<[ControlEvent["type"], number]> {
  const start = parsed.startedAt;
  const pauses = parsed.segmentsArePauses
    ? parsed.segments.slice(1).map((segment, i) => {
        const previous = parsed.segments[i];
        return { start: previous[previous.length - 1].t, end: segment[0].t };
      })
    : parsed.pauses;
  const timeline: Array<[ControlEvent["type"], number]> = [["start", 0]];
  let last = start;
  for (const pause of [...pauses].sort((a, b) => a.start - b.start)) {
    if (pause.start < last || pause.end <= pause.start || pause.end > parsed.endedAt) continue;
    timeline.push(["pause", pause.start - start], ["resume", pause.end - start]);
    last = pause.end;
  }
  timeline.push(["finish", parsed.endedAt - start]);
  return timeline;
}

export function importFixes(parsed: ParsedImport): Fix[] {
  return parsed.segments.flat().map((point) => ({
    t: point.t,
    lat: point.lat,
    lng: point.lng,
    acc: point.acc ?? DEFAULT_IMPORT_ACCURACY_M,
    alt: point.alt,
    altAcc: point.altAcc,
    speed: point.speed,
  }));
}

/** The device's own distance: its session or lap total, else its last cumulative reading. */
export function deviceDistance(parsed: ParsedImport): number | null {
  const total = parsed.totals?.distanceM ?? null;
  if (total !== null && total > 0) return total;
  let last: number | null = null;
  for (const segment of parsed.segments) for (const point of segment) if (point.distanceM !== null) last = point.distanceM;
  return last !== null && last > 0 ? last : null;
}

export function deviceKcal(parsed: ParsedImport): number | null {
  const kcal = parsed.totals?.kcal ?? null;
  return kcal !== null && kcal > 0 && kcal <= 20_000 ? Math.round(kcal) : null;
}

export function deviceKcalMethod(parsed: ParsedImport): string {
  const who = parsed.device ? parsed.device : "the device that recorded it";
  return `${DEVICE_KCAL_PREFIX}${who}, from the imported ${FORMAT_LABEL[parsed.format]} file.`.slice(0, 300);
}

export function buildImportRecord(
  parsed: ParsedImport,
  options: { sport: Sport; clientId: string; weightKg: unknown; importedAt: number; title?: string | null },
): ImportBuild {
  const fixes = importFixes(parsed);
  const log = logFromFixes(options.sport, parsed.startedAt, importTimeline(parsed), fixes);
  const engine = ActivityEngine.replay(log, IMPORT_ENGINE);
  if (engine.status !== "finished") throw new ImportError("damaged", "This file’s times don’t make a complete activity.");
  const fallback = defaultTitle(options.sport, new Date(parsed.startedAt));
  // A name the exporting app stamped on ("Route 2026-11-12 7:02am") says less than FITX's own.
  const named = options.title ?? (parsed.name && !/^route\b.*\d{4}-\d{2}-\d{2}/i.test(parsed.name) ? parsed.name : "");
  const built = buildActivityRecord(engine, { clientId: options.clientId, title: cleanTitle(named, fallback), weightKg: options.weightKg, log });
  if (built.elapsedSeconds > 48 * 3600) throw new ImportError("too-long", "This activity is longer than 48 hours, the most FITX keeps for one activity.");
  if (built.distanceM > 1_000_000) throw new ImportError("too-far", "This activity is longer than 1,000 km, the most FITX keeps for one activity.");
  if (built.avgSpeedMps !== null && built.avgSpeedMps > 50) throw new ImportError("unsupported-sport", "This activity is faster than a walk, run or ride can be.");
  if (!engine.acceptedSegments.some((segment) => segment.length > 1)) {
    throw new ImportError("no-points", "None of this file’s points were precise enough to draw a route.");
  }

  const kcal = deviceKcal(parsed);
  const pointsDropped = parsed.endedAt < options.importedAt - POINTS_KEPT_DAYS * 86_400_000;
  const record: ActivityRecord = {
    ...built,
    ...(kcal !== null ? { kcal, kcalMethod: deviceKcalMethod(parsed), weightKg: null } : {}),
    chunks: pointsDropped ? [] : built.chunks,
    source: "file",
    sourceFormat: parsed.format,
    sourceDevice: parsed.device,
    importedAt: options.importedAt,
  };
  return { record, deviceDistanceM: deviceDistance(parsed), kcalFromDevice: kcal !== null, pointsDropped };
}
