// Bug 39: an empty file is called empty (not "not a GPX file"), and a one-point file is refused at once for having
// one point (never "Choose the sport", then "not precise enough"). A file whose points draw no route is told why.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ActivityEngine } from "@/lib/activity/engine";
import { destination } from "@/lib/activity/geo";
import { IMPORT_ENGINE } from "@/lib/activity/import/config";
import { isBlank, readActivityFile } from "@/lib/activity/import/detect";
import { buildImportRecord, importTimeline, importFixes, noRouteReason } from "@/lib/activity/import/to-record";
import { ImportError, type ImportPoint, type ParsedImport } from "@/lib/activity/import/types";
import { logFromFixes } from "@/lib/activity/replay";

const bytes = (text: string) => new TextEncoder().encode(text);

async function reason(input: Uint8Array): Promise<{ code: string; message: string } | "read"> {
  try {
    await readActivityFile(input);
    return "read";
  } catch (error) {
    assert.ok(error instanceof ImportError, String(error));
    return { code: error.code, message: error.message };
  }
}

test("an empty .gpx (0 bytes, or only line breaks) is called empty", async () => {
  const empty = { code: "empty", message: "This file is empty. Export the activity again, then choose the new file." };
  assert.deepEqual(await reason(new Uint8Array(0)), empty);
  assert.deepEqual(await reason(bytes("\n\n  \r\n")), empty);
  assert.deepEqual(await reason(bytes("﻿ \n")), empty, "a byte-order mark alone is still empty");
  assert.equal(isBlank(bytes("<gpx>")), false);
  // Something that isn't blank and isn't an activity file keeps its own reason.
  assert.deepEqual(await reason(bytes("hello")), { code: "unknown-format", message: "FITX can read GPX, TCX and FIT files. This file isn’t one of them." });
});

const ONE_POINT = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Garmin Connect" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><time>2026-11-22T01:00:00Z</time></metadata>
<trk><name>One point</name><trkseg>
<trkpt lat="12.9716000" lon="77.5946000"><ele>900.0</ele><time>2026-11-22T01:00:00Z</time></trkpt>
</trkseg></trk></gpx>`;

test("a GPX with a single timed point is refused when it is read, for having one point", async () => {
  assert.deepEqual(await reason(bytes(ONE_POINT)), { code: "no-points", message: "This file has only one GPS point, so there’s no route to import." });
  const two = ONE_POINT.replace("</trkseg>", `<trkpt lat="12.9717000" lon="77.5946000"><time>2026-11-22T01:00:10Z</time></trkpt></trkseg>`);
  assert.equal(await reason(bytes(two)), "read", "two points are a route");
});

const ORIGIN = { lat: 12.97634, lng: 77.59287 };
const START = Date.UTC(2026, 10, 12, 1, 32, 0);
const NOW = Date.UTC(2026, 10, 18, 9, 0, 0);
const point = (s: number, metres: number, acc: number | null = null): ImportPoint => {
  const p = destination(ORIGIN, 40, metres);
  return { t: START + s * 1000, lat: p.lat, lng: p.lng, alt: null, speed: null, distanceM: null, heartRate: null, acc, altAcc: null };
};
const parsed = (segments: ImportPoint[][]): ParsedImport => {
  const times = segments.flat().map((p) => p.t);
  return { format: "gpx", device: null, sport: { kind: "unknown", label: null }, name: null, segments, pauses: [], segmentsArePauses: true, startedAt: Math.min(...times), endedAt: Math.max(...times), totals: null, skippedPoints: 0 };
};
const message = (file: ParsedImport) => {
  try {
    buildImportRecord(file, { sport: "walk", clientId: "c", weightKg: null, importedAt: NOW });
    return "built";
  } catch (error) {
    return error instanceof ImportError ? `${error.code}: ${error.message}` : String(error);
  }
};

test("no route: the reason says what is wrong (one point per stretch, imprecise points, or points too far apart)", () => {
  // Points with the default accuracy (5 m), one per GPX segment: nothing to join.
  assert.equal(message(parsed([[point(0, 0)], [point(60, 80)], [point(120, 160)]])), "no-points: This file doesn’t have two GPS points in a row, so there’s no route to import.");
  // Every point blurred past what a walk accepts: the precision reason is the true one.
  assert.equal(message(parsed([Array.from({ length: 30 }, (_, i) => point(i, i * 1.4, 80))])), "no-points: None of this file’s points were precise enough to draw a route.");
  // Precise points that jump hundreds of metres a second never join.
  const jumps = parsed([Array.from({ length: 6 }, (_, i) => point(i, i * 900))]);
  const engine = ActivityEngine.replay(logFromFixes("walk", jumps.startedAt, importTimeline(jumps), importFixes(jumps)), IMPORT_ENGINE);
  assert.equal(engine.acceptedSegments.some((segment) => segment.length > 1), false, "the jumps draw no route");
  assert.equal(noRouteReason(jumps, engine), "This file’s points are too far apart to draw a route.");
  assert.equal(message(jumps), "no-points: This file’s points are too far apart to draw a route.");
  // An ordinary walk builds.
  assert.equal(message(parsed([Array.from({ length: 60 }, (_, i) => point(i, i * 1.4))])), "built");
});
