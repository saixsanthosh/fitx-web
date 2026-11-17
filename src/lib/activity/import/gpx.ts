import { sportFromLabel } from "./sport";
import { IMPORT_LIMITS, ImportError, type ImportPoint, type ParsedImport } from "./types";
import { scanXml, XmlError } from "./xml";

/*
 * GPX 1.0/1.1 track reader for imports: track segments and points with time, elevation, and the
 * common extensions (Garmin TrackPointExtension heart rate and speed; Apple Health's speed, hAcc and
 * vAcc). Routes and waypoints have no times, so they are not activities and are ignored.
 */

const num = (value: string | undefined | null): number | null => {
  if (value === undefined || value === null) return null;
  const n = Number(value.trim());
  return value.trim() !== "" && Number.isFinite(n) ? n : null;
};

/** GPX times are UTC; a time written without a zone is read as UTC too (not the reader's local time). */
export function parseXmlTime(value: string | null | undefined): number | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  const zoned = /(?:z|[+-]\d\d:?\d\d)$/i.test(text) ? text : `${text}Z`;
  const ms = Date.parse(zoned);
  return Number.isFinite(ms) ? ms : null;
}

/** Tidies the name of the app that wrote a file, without guessing anything it doesn't say. */
export function cleanDeviceName(value: string | null | undefined): string | null {
  let text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (/^stravagpx\b/i.test(text)) text = "Strava";
  return text.slice(0, 120);
}

const POINT_FIELDS = new Set(["ele", "time", "hdop", "hr", "speed", "hAcc", "vAcc"]);

export function readGpx(xml: string): ParsedImport {
  let creator: string | null = null;
  let trackName: string | null = null;
  let trackType: string | null = null;
  let tracks = 0;
  const segments: ImportPoint[][] = [];
  let segment: ImportPoint[] = [];
  let skipped = 0;
  let total = 0;
  let sawTrackPoint = false;

  const stack: string[] = [];
  let point: { lat: number | null; lng: number | null; fields: Record<string, string> } | null = null;
  let capture: string | null = null;
  let buffer = "";

  const endSegment = () => {
    if (segment.length) segments.push(segment);
    segment = [];
  };

  try {
    scanXml(xml, {
      open(name, attrs) {
        const parent = stack[stack.length - 1];
        stack.push(name);
        if (name === "gpx") creator = attrs.creator ?? null;
        else if (name === "trk") tracks++;
        else if (name === "trkseg") endSegment();
        else if (name === "trkpt") {
          sawTrackPoint = true;
          point = { lat: num(attrs.lat), lng: num(attrs.lon), fields: {} };
        } else if (point && POINT_FIELDS.has(name)) {
          capture = name;
          buffer = "";
        } else if (!point && parent === "trk" && tracks === 1 && (name === "name" || name === "type")) {
          capture = name;
          buffer = "";
        }
      },
      text(text) {
        buffer += text;
      },
      wantText: () => capture !== null,
      close(name) {
        stack.pop();
        if (capture === name) {
          if (point) point.fields[name] = buffer;
          else if (name === "name") trackName = buffer.trim() || null;
          else if (name === "type") trackType = buffer.trim() || null;
          capture = null;
          buffer = "";
          return;
        }
        if (name === "trkseg") endSegment();
        if (name !== "trkpt" || !point) return;
        const current = point;
        point = null;
        const t = parseXmlTime(current.fields.time);
        const { lat, lng } = current;
        if (t === null || lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
          skipped++;
          return;
        }
        if (++total > IMPORT_LIMITS.maxPoints) throw new ImportError("too-large", "This file has more points than FITX can import at once.");
        const hdop = num(current.fields.hdop);
        const hAcc = num(current.fields.hAcc);
        const speed = num(current.fields.speed);
        const hr = num(current.fields.hr);
        const vAcc = num(current.fields.vAcc);
        segment.push({
          t,
          lat,
          lng,
          alt: num(current.fields.ele),
          speed: speed !== null && speed >= 0 ? speed : null,
          distanceM: null,
          heartRate: hr !== null && hr > 0 && hr < 255 ? hr : null,
          acc: hAcc !== null && hAcc >= 0 ? hAcc : hdop !== null && hdop > 0 ? hdop * 5 : null,
          altAcc: vAcc !== null && vAcc >= 0 ? vAcc : null,
        });
      },
    });
  } catch (error) {
    if (error instanceof ImportError) throw error;
    if (error instanceof XmlError) throw new ImportError("damaged", "This GPX file is damaged or cut short.");
    throw error;
  }
  endSegment();

  if (!segments.length) {
    if (sawTrackPoint && skipped) throw new ImportError("no-times", "This GPX file’s points have no times, so it’s a planned route rather than a recorded activity.");
    throw new ImportError("no-points", "This GPX file has no recorded track points.");
  }
  const { first, last } = timeRange(segments);
  return {
    format: "gpx",
    device: cleanDeviceName(creator),
    sport: sportFromLabel(trackType),
    name: trackName,
    segments,
    pauses: [],
    segmentsArePauses: true,
    startedAt: first,
    endedAt: last,
    totals: null,
    skippedPoints: skipped,
  };
}

/** The earliest and latest point time (a loop: spreading 250,000 values into Math.min overflows the stack). */
export function timeRange(segments: readonly (readonly ImportPoint[])[]): { first: number; last: number } {
  let first = Infinity;
  let last = -Infinity;
  for (const segment of segments) {
    for (const point of segment) {
      if (point.t < first) first = point.t;
      if (point.t > last) last = point.t;
    }
  }
  return { first, last };
}
