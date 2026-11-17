import { cleanDeviceName, parseXmlTime, timeRange } from "./gpx";
import { sportFromTcx } from "./sport";
import { IMPORT_LIMITS, ImportError, sumIfAllKnown, type DeviceTotals, type ImportPoint, type ParsedImport } from "./types";
import { scanXml, XmlError } from "./xml";

/*
 * Garmin Training Center (TCX) reader for imports: the first activity's sport, the device that
 * created it (<Creator><Name>), lap totals and track points (time, position, altitude, the device's
 * distance so far, heart rate and the TPX speed extension). Laps are not pauses: their tracks are
 * read as one stream, and FITX's engine finds stops and lost signal from the times themselves.
 */

const num = (value: string | undefined | null): number | null => {
  if (value === undefined || value === null || value.trim() === "") return null;
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : null;
};

type PointFields = { time?: string; lat?: string; lng?: string; alt?: string; distance?: string; hr?: string; speed?: string };

export function readTcx(xml: string): ParsedImport {
  let activities = 0;
  let sportAttr: string | null = null;
  let activityId: string | null = null;
  let firstLapStart: string | null = null;
  let creatorName: string | null = null;
  let authorName: string | null = null;
  const laps: Array<{ seconds: number | null; distance: number | null; kcal: number | null }> = [];
  let lap: { seconds: number | null; distance: number | null; kcal: number | null } | null = null;
  const segments: ImportPoint[][] = [];
  let segment: ImportPoint[] = [];
  let skipped = 0;
  let total = 0;

  const stack: string[] = [];
  let point: PointFields | null = null;
  let capture: { field: string; into: "point" | "lap" | "activity" } | null = null;
  let buffer = "";

  const endSegment = () => {
    if (segment.length) segments.push(segment);
    segment = [];
  };
  const inFirstActivity = () => activities === 1 && stack.includes("Activity");

  try {
    scanXml(xml, {
      open(name, attrs) {
        const parent = stack[stack.length - 1];
        stack.push(name);
        if (name === "Activity") {
          activities++;
          if (activities === 1) sportAttr = attrs.Sport ?? null;
          return;
        }
        if (!inFirstActivity() && name !== "Name") return;
        if (name === "Lap" && parent === "Activity") {
          lap = { seconds: null, distance: null, kcal: null };
          firstLapStart ??= attrs.StartTime ?? null;
        } else if (name === "Track") endSegment();
        else if (name === "Trackpoint") point = {};
        else if (point) {
          const field =
            name === "Time" ? "time"
            : name === "LatitudeDegrees" ? "lat"
            : name === "LongitudeDegrees" ? "lng"
            : name === "AltitudeMeters" ? "alt"
            : name === "DistanceMeters" && parent === "Trackpoint" ? "distance"
            : name === "Value" && parent === "HeartRateBpm" ? "hr"
            : name === "Speed" && parent === "TPX" ? "speed"
            : null;
          if (field) { capture = { field, into: "point" }; buffer = ""; }
        } else if (lap && parent === "Lap" && (name === "TotalTimeSeconds" || name === "DistanceMeters" || name === "Calories")) {
          capture = { field: name, into: "lap" };
          buffer = "";
        } else if (name === "Id" && parent === "Activity") {
          capture = { field: "Id", into: "activity" };
          buffer = "";
        } else if (name === "Name" && (parent === "Creator" || parent === "Author")) {
          capture = { field: parent, into: "activity" };
          buffer = "";
        }
      },
      text(text) {
        buffer += text;
      },
      wantText: () => capture !== null,
      close(name) {
        stack.pop();
        if (capture) {
          const { field, into } = capture;
          capture = null;
          const value = buffer.trim();
          buffer = "";
          if (into === "point" && point) (point as Record<string, string>)[field] = value;
          else if (into === "lap" && lap) {
            if (field === "TotalTimeSeconds") lap.seconds = num(value);
            else if (field === "DistanceMeters") lap.distance = num(value);
            else lap.kcal = num(value);
          } else if (field === "Id") activityId = value || null;
          else if (field === "Creator") creatorName ??= value || null;
          else if (field === "Author") authorName ??= value || null;
          return;
        }
        if (name === "Lap" && lap) {
          laps.push(lap);
          lap = null;
        } else if (name === "Track") endSegment();
        else if (name === "Trackpoint" && point) {
          const fields = point;
          point = null;
          const t = parseXmlTime(fields.time);
          const lat = num(fields.lat);
          const lng = num(fields.lng);
          // Points without a position (indoors, before GPS was found) carry nothing to map.
          if (t === null || lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            skipped++;
            return;
          }
          if (++total > IMPORT_LIMITS.maxPoints) throw new ImportError("too-large", "This file has more points than FITX can import at once.");
          const speed = num(fields.speed);
          const hr = num(fields.hr);
          const distance = num(fields.distance);
          segment.push({
            t, lat, lng,
            alt: num(fields.alt),
            speed: speed !== null && speed >= 0 ? speed : null,
            distanceM: distance !== null && distance >= 0 ? distance : null,
            heartRate: hr !== null && hr > 0 && hr < 255 ? hr : null,
            acc: null,
            altAcc: null,
          });
        }
      },
    });
  } catch (error) {
    if (error instanceof ImportError) throw error;
    if (error instanceof XmlError) throw new ImportError("damaged", "This TCX file is damaged or cut short.");
    throw error;
  }
  endSegment();

  if (!activities) throw new ImportError("not-activity", "This TCX file has no recorded activity (it may be a course or a workout plan).");
  if (!segments.length) throw new ImportError("no-points", "This TCX file has no GPS points (an indoor or treadmill session?). FITX imports walks, runs and rides with a recorded route.");

  // Lap totals count only when every lap has the value (a lap without one is unknown, not 0).
  const totals: DeviceTotals | null = laps.length
    ? { distanceM: sumIfAllKnown(laps.map((l) => l.distance)), timerSeconds: sumIfAllKnown(laps.map((l) => l.seconds)), elapsedSeconds: null, ascentM: null, kcal: sumIfAllKnown(laps.map((l) => l.kcal)) }
    : null;
  const { first, last } = timeRange(segments);
  const declaredStart = parseXmlTime(activityId) ?? parseXmlTime(firstLapStart);
  return {
    format: "tcx",
    device: cleanDeviceName(creatorName ?? authorName),
    sport: sportFromTcx(sportAttr),
    name: null,
    segments,
    pauses: [],
    segmentsArePauses: false,
    // The device's start (its timer start) when it is shortly before the first point.
    startedAt: declaredStart !== null && declaredStart <= first && first - declaredStart <= 15 * 60_000 ? declaredStart : first,
    endedAt: last,
    totals,
    skippedPoints: skipped,
  };
}
