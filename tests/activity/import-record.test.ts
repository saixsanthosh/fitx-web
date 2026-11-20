import { test } from "node:test";
import assert from "node:assert/strict";
import { ActivityEngine } from "@/lib/activity/engine";
import { defaultTitle } from "@/lib/activity/format";
import { destination } from "@/lib/activity/geo";
import { IMPORT_ENGINE, importConfig, IMPORT_MAX_FIX_INTERVAL_MS } from "@/lib/activity/import/config";
import { readActivityFile, sniffFormat } from "@/lib/activity/import/detect";
import { fingerprintSecond, importClientId } from "@/lib/activity/import/fingerprint";
import { checkImport, lookupWindow, mergeKnown, OVERLAP_TOLERANCE_MS, refillsSaved, saveFailure, shouldCountPoints, summariseResults, type KnownActivity, type RecordShape } from "@/lib/activity/import/plan";
import { buildImportRecord, deviceDistance, importTimeline, POINTS_KEPT_DAYS } from "@/lib/activity/import/to-record";
import { ImportError, type ImportPoint, type ParsedImport } from "@/lib/activity/import/types";
import { replayStored } from "@/lib/activity/replay";
import { DEVICE_KCAL_PREFIX } from "@/lib/activity/source";
import { FILE_ID_FIELDS, FitWriter, fitTime, MSG, RECORD_FIELDS, recordValues } from "./support/fit-writer";

const START = Date.UTC(2026, 10, 12, 1, 32, 0);
const NOW = Date.UTC(2026, 10, 18, 9, 0, 0);
const ORIGIN = { lat: 12.97634, lng: 77.59287 };
const CLIENT = "6f1c6b1e-0d55-4b1c-9d59-1d2f3c4b5a69";

/** Points along a straight line at `speed` m/s, one every `everyS` seconds. */
function line(options: { seconds: number; everyS?: number; speed?: number; fromS?: number; fromM?: number; alt?: (s: number) => number | null; deviceSpeed?: boolean }): ImportPoint[] {
  const every = options.everyS ?? 1;
  const speed = options.speed ?? 3;
  const points: ImportPoint[] = [];
  for (let s = 0; s <= options.seconds; s += every) {
    const metres = (options.fromM ?? 0) + s * speed;
    const p = destination(ORIGIN, 40, metres);
    const t = (options.fromS ?? 0) + s;
    points.push({ t: START + t * 1000, lat: p.lat, lng: p.lng, alt: options.alt ? options.alt(t) : null, speed: options.deviceSpeed ? speed : null, distanceM: metres, heartRate: null, acc: null, altAcc: null });
  }
  return points;
}

function parsed(segments: ImportPoint[][], extra: Partial<ParsedImport> = {}): ParsedImport {
  const times = segments.flat().map((p) => p.t);
  return {
    format: "gpx", device: "Garmin Connect", sport: { kind: "known", sport: "run", label: "running" }, name: "Lake loop",
    segments, pauses: [], segmentsArePauses: true, startedAt: Math.min(...times), endedAt: Math.max(...times), totals: null, skippedPoints: 0,
    ...extra,
  };
}

test("an imported run is measured by FITX's engine and labelled with where it came from", () => {
  const file = parsed([line({ seconds: 700, alt: (s) => 900 + s * 0.05 })]);
  const { record, deviceDistanceM, kcalFromDevice, pointsDropped } = buildImportRecord(file, { sport: "run", clientId: CLIENT, weightKg: 70, importedAt: NOW });
  assert.ok(Math.abs(record.distanceM - 2100) / 2100 < 0.03, `distance ${record.distanceM}`);
  assert.equal(record.splits.filter((split) => split.distanceM === 1000).length, 2);
  assert.ok(record.movingSeconds >= 690 && record.movingSeconds <= 700, `moving ${record.movingSeconds}`);
  assert.equal(record.elapsedSeconds, 700);
  assert.ok(record.elevationGainM !== null && Math.abs(record.elevationGainM - 35) <= 6, `climb ${record.elevationGainM}`);
  assert.deepEqual([record.source, record.sourceFormat, record.sourceDevice, record.importedAt], ["file", "gpx", "Garmin Connect", NOW]);
  assert.equal(record.clientId, CLIENT);
  assert.equal(record.title, "Lake loop");
  assert.equal(record.gapCount, 0);
  assert.ok(record.chunks.length > 0 && !pointsDropped, "recent imports keep their GPS points");
  assert.ok(record.kcal !== null && record.kcal > 0 && !kcalFromDevice, "FITX's MET estimate with a weight");
  assert.equal(deviceDistanceM, 2100, "the file's own last distance reading");
  // The stored points replay with the import settings to the same route.
  const replayed = replayStored(record.sport, record.startedAt, record.timeline, record.chunks, IMPORT_ENGINE);
  assert.ok(Math.abs(replayed.distanceM - record.distanceM) < 5);
});

test("no weight and no device figure: calories stay unknown, never 0", () => {
  const { record } = buildImportRecord(parsed([line({ seconds: 300 })]), { sport: "walk", clientId: CLIENT, weightKg: null, importedAt: NOW });
  assert.equal(record.kcal, null);
  assert.equal(record.kcalMethod, null);
});

test("titles: the file's own name, except an app's date stamp, which gets FITX's usual title", () => {
  const stamped = buildImportRecord(parsed([line({ seconds: 60 })], { name: "Route 2026-11-12 7:02am" }), { sport: "walk", clientId: CLIENT, weightKg: null, importedAt: NOW });
  assert.equal(stamped.record.title, defaultTitle("walk", new Date(START)));
  const none = buildImportRecord(parsed([line({ seconds: 60 })], { name: null }), { sport: "ride", clientId: CLIENT, weightKg: null, importedAt: NOW });
  assert.equal(none.record.title, defaultTitle("ride", new Date(START)));
});

test("the device's own calorie figure is kept as its estimate, and says so", () => {
  const file = parsed([line({ seconds: 300 })], { format: "fit", device: "Garmin Forerunner 255", totals: { distanceM: 905, timerSeconds: 300, elapsedSeconds: 300, ascentM: null, kcal: 80 } });
  const { record, kcalFromDevice, deviceDistanceM } = buildImportRecord(file, { sport: "run", clientId: CLIENT, weightKg: 70, importedAt: NOW });
  assert.equal(record.kcal, 80);
  assert.equal(kcalFromDevice, true);
  assert.ok(record.kcalMethod?.startsWith(DEVICE_KCAL_PREFIX) && record.kcalMethod.includes("Garmin Forerunner 255") && record.kcalMethod.includes("FIT"));
  assert.equal(record.weightKg, null, "no FITX weight was used");
  assert.equal(deviceDistanceM, 905, "the session total wins over the last reading");
});

test("watch tracks with a point every 10 seconds are not lost signal; a 3-minute hole that moved is", () => {
  const sparse = buildImportRecord(parsed([line({ seconds: 600, everyS: 10 })]), { sport: "run", clientId: CLIENT, weightKg: null, importedAt: NOW }).record;
  assert.equal(sparse.gapCount, 0);
  assert.ok(Math.abs(sparse.distanceM - 1800) / 1800 < 0.03, `distance ${sparse.distanceM}`);
  assert.ok(sparse.movingSeconds > 580, `moving ${sparse.movingSeconds}`);
  assert.ok(importConfig("run").maxFixIntervalMs === IMPORT_MAX_FIX_INTERVAL_MS && importConfig("ride").maxFixIntervalMs === IMPORT_MAX_FIX_INTERVAL_MS);
  // The same file through the phone settings would have called nothing lost either; a real hole is honest in both.
  const holed = [...line({ seconds: 200 }), ...line({ seconds: 200, fromS: 380, fromM: 1140 })];
  const withHole = buildImportRecord(parsed([holed], { segmentsArePauses: false }), { sport: "run", clientId: CLIENT, weightKg: null, importedAt: NOW }).record;
  assert.equal(withHole.gaps.length, 1);
  assert.equal(withHole.gaps[0].kind, "signal");
  assert.ok(withHole.distanceM < 1250, `the 540 m across the hole is not counted (${withHole.distanceM})`);
});

test("pauses: FIT timer stops and GPX segment breaks are paused time, with the route broken there", () => {
  const first = line({ seconds: 120 });
  const second = line({ seconds: 120, fromS: 180, fromM: 360 });
  const gpx = buildImportRecord(parsed([first, second]), { sport: "run", clientId: CLIENT, weightKg: null, importedAt: NOW }).record;
  assert.equal(gpx.pausedSeconds, 60);
  assert.ok(gpx.timeline.some(([type]) => type === "pause") && gpx.timeline.some(([type]) => type === "resume"));
  assert.equal(gpx.routePolyline.split(" ").length, 2, "two stretches, never joined");

  const fitFile = parsed([[...first, ...second]], { format: "fit", segmentsArePauses: false, pauses: [{ start: START + 120_000, end: START + 180_000 }] });
  assert.deepEqual(importTimeline(fitFile), [["start", 0], ["pause", 120_000], ["resume", 180_000], ["finish", 300_000]]);
  const fit = buildImportRecord(fitFile, { sport: "run", clientId: CLIENT, weightKg: null, importedAt: NOW }).record;
  assert.equal(fit.pausedSeconds, 60);
  assert.ok(Math.abs(fit.distanceM - gpx.distanceM) < 10);
});

test("activities that ended more than 90 days ago keep their route but not every point", () => {
  const old = buildImportRecord(parsed([line({ seconds: 200 })]), { sport: "run", clientId: CLIENT, weightKg: null, importedAt: START + (POINTS_KEPT_DAYS + 1) * 86_400_000 });
  assert.equal(old.pointsDropped, true);
  assert.deepEqual(old.record.chunks, []);
  assert.ok(old.record.routePolyline.length > 0 && old.record.pointCount > 0);
});

test("limits: longer than 48 hours, over 1,000 km or faster than a ride can go are refused", () => {
  const codeOf = (fn: () => unknown) => {
    try {
      fn();
      return "ok";
    } catch (error) {
      return error instanceof ImportError ? error.code : String(error);
    }
  };
  const long = parsed([line({ seconds: 49 * 3600, everyS: 60, speed: 1 })]);
  assert.equal(codeOf(() => buildImportRecord(long, { sport: "walk", clientId: CLIENT, weightKg: null, importedAt: NOW })), "too-long");
  const far = parsed([line({ seconds: 34_000, everyS: 60, speed: 30 })]);
  assert.equal(codeOf(() => buildImportRecord(far, { sport: "ride", clientId: CLIENT, weightKg: null, importedAt: NOW })), "too-far");
  const blurred = parsed([line({ seconds: 60 }).map((p) => ({ ...p, acc: 80 }))]);
  assert.equal(codeOf(() => buildImportRecord(blurred, { sport: "walk", clientId: CLIENT, weightKg: null, importedAt: NOW })), "no-points");
});

test("the import settings only widen the wait between points; FITX recordings keep their own", () => {
  const engine = new ActivityEngine(IMPORT_ENGINE);
  engine.control({ type: "start", t: START, sport: "walk" });
  assert.equal(engine.status, "recording");
  assert.equal(new ActivityEngine().status, "idle");
});

test("device ids: the same first second gives the same UUID in every format; another second, another id", async () => {
  const a = await importClientId(START + 400);
  const b = await importClientId(START + 999);
  const c = await importClientId(START + 1000);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(fingerprintSecond(START + 999), START / 1000);
});

test("one session exported as GPX and as FIT gets one device id", async () => {
  const points = line({ seconds: 30, alt: () => 900 });
  const gpx = `<gpx creator="Garmin Connect"><trk><type>running</type><trkseg>${points.map((p) => `<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lng.toFixed(7)}"><ele>900</ele><time>${new Date(p.t).toISOString()}</time></trkpt>`).join("")}</trkseg></trk></gpx>`;
  const w = new FitWriter();
  w.define(0, MSG.fileId, FILE_ID_FIELDS).data(0, [4, 1, 3990, fitTime(START), null]);
  w.define(1, MSG.record, RECORD_FIELDS);
  for (const p of points) w.data(1, recordValues({ t: p.t, lat: p.lat, lng: p.lng, alt: 900, speed: 3, distance: p.distanceM, hr: null }));
  const fromGpx = await readActivityFile(new TextEncoder().encode(gpx));
  const fromFit = await readActivityFile(w.build());
  const idOf = async (file: ParsedImport) => importClientId(file.segments[0][0].t);
  assert.equal(await idOf(fromGpx), await idOf(fromFit));
});

test("formats are recognised from their bytes, gzip is unpacked, zip archives get a plain reason", async () => {
  const gpx = `<?xml version="1.0"?><gpx><trk><trkseg>${line({ seconds: 3 }).map((p) => `<trkpt lat="${p.lat}" lon="${p.lng}"><time>${new Date(p.t).toISOString()}</time></trkpt>`).join("")}</trkseg></trk></gpx>`;
  assert.equal(sniffFormat(new TextEncoder().encode(gpx)), "gpx");
  assert.equal(sniffFormat(new TextEncoder().encode("<?xml version=\"1.0\"?>\n<TrainingCenterDatabase xmlns=\"x\">")), "tcx");
  assert.equal(sniffFormat(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0])), "zip");
  assert.equal(sniffFormat(new TextEncoder().encode("hello")), null);
  const packed = new Uint8Array(await new Response(new Blob([gpx]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
  assert.equal(sniffFormat(packed), "gzip");
  const read = await readActivityFile(packed);
  assert.equal(read.segments[0].length, 4);
  await assert.rejects(readActivityFile(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0])), (error: unknown) => error instanceof ImportError && error.code === "unknown-format" && /zip/.test(error.message));
  await assert.rejects(readActivityFile(Uint8Array.from([0x1f, 0x8b, 1, 2, 3, 4, 5])), (error: unknown) => error instanceof ImportError && error.code === "damaged");
  const twoDays = `<gpx><trk><trkseg><trkpt lat="12" lon="77"><time>2026-11-01T00:00:00Z</time></trkpt><trkpt lat="12.001" lon="77"><time>2026-11-03T01:00:00Z</time></trkpt></trkseg></trk></gpx>`;
  await assert.rejects(readActivityFile(new TextEncoder().encode(twoDays)), (error: unknown) => error instanceof ImportError && error.code === "too-long");
});

const known = (over: Partial<KnownActivity>): KnownActivity => ({
  id: "a1", clientId: "c-existing", sport: "run", title: "Morning run", startedAt: START, endedAt: START + 1800_000, source: "fitx_gps", local: false, ...over,
});

test("checks: a session already in FITX, the same session twice in one import, and overlaps", () => {
  const candidate = { key: "f1", clientId: "c-new", startedAt: START + 600_000, endedAt: START + 2400_000 };
  assert.deepEqual(checkImport(candidate, [], []), { kind: "ready" });
  assert.equal(checkImport({ ...candidate, clientId: "c-existing" }, [known({})], []).kind, "already");
  assert.deepEqual(checkImport(candidate, [], [{ ...candidate, key: "f0" }]), { kind: "same-file", otherKey: "f0" });
  const overlap = checkImport(candidate, [known({})], []);
  assert.equal(overlap.kind === "overlap" && overlap.activity?.title, "Morning run");
  // Touching within the clock tolerance is not an overlap.
  const touching = { ...candidate, startedAt: START + 1800_000 - OVERLAP_TOLERANCE_MS + 1000 };
  assert.deepEqual(checkImport(touching, [known({})], []), { kind: "ready" });
  const sibling = checkImport(candidate, [], [{ key: "f0", clientId: "c-other", startedAt: START, endedAt: START + 1200_000 }]);
  assert.deepEqual(sibling, { kind: "overlap", activity: null, otherKey: "f0" });
  assert.deepEqual(lookupWindow([candidate, { ...candidate, startedAt: START - 5000, endedAt: START }]), { from: START - 5000, to: START + 2400_000 });
  assert.equal(lookupWindow([]), null);
});

test("an earlier import saved without all its GPS points is offered again; a complete or phone one is not", () => {
  const candidate = { key: "f1", clientId: "c-existing", startedAt: START, endedAt: START + 1800_000 };
  const partial = known({ source: "file", missingPoints: true });
  assert.deepEqual(checkImport(candidate, [partial], []), { kind: "incomplete", activity: partial });
  assert.equal(checkImport(candidate, [known({ source: "file", missingPoints: false })], []).kind, "already");
  assert.equal(checkImport(candidate, [known({ source: "file", missingPoints: true, local: true, id: null })], []).kind, "already", "a copy only on this device has nothing to add to");
  // A second file of the same session is still imported once.
  assert.equal(checkImport({ ...candidate, key: "f2" }, [partial], [candidate]).kind, "same-file");
});

test("only the file that made an incomplete import fills in its points; another export of the session does not", () => {
  const shapeOf = (file: ParsedImport): RecordShape => {
    const { record } = buildImportRecord(file, { sport: "run", clientId: CLIENT, weightKg: null, importedAt: NOW });
    return { startedAt: record.startedAt, endedAt: record.endedAt, pointCount: record.pointCount, chunkCount: record.chunks.length, sourceFormat: record.sourceFormat ?? null };
  };
  const gpx = shapeOf(parsed([line({ seconds: 1800 })]));
  // The same session from the watch: same first second (so the same device id), a point every 2 seconds.
  const fit = shapeOf(parsed([line({ seconds: 1800, everyS: 2 })], { format: "fit" }));
  const saved = known({ source: "file", missingPoints: true, startedAt: gpx.startedAt, endedAt: gpx.endedAt, pointCount: gpx.pointCount, chunkCount: gpx.chunkCount, sourceFormat: "gpx" });
  assert.equal(refillsSaved(saved, gpx), true, "the same file again");
  assert.equal(refillsSaved(saved, fit), false, "the FIT of the session the GPX was saved from");
  assert.equal(refillsSaved(saved, { ...gpx, sourceFormat: "tcx" }), false);
  assert.equal(refillsSaved(saved, { ...gpx, pointCount: gpx.pointCount - 1 }), false);
  assert.equal(refillsSaved(saved, { ...gpx, chunkCount: gpx.chunkCount + 1 }), false);
  assert.equal(refillsSaved(saved, { ...gpx, endedAt: gpx.endedAt + 5000 }), false);
  assert.equal(refillsSaved(saved, null), false, "a file that can't be built");
  assert.equal(refillsSaved({ ...saved, pointCount: undefined }, gpx), false, "unknown counts are not a match");
  assert.equal(refillsSaved({ ...saved, sourceFormat: null }, gpx), false, "an unknown format is not a match");
});

test("a later lookup that finds an incomplete import only by time keeps its points count", () => {
  const partial = known({ source: "file", missingPoints: true });
  const byTime = known({ source: "file", title: "Renamed" });
  const merged = mergeKnown([partial], [byTime]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].missingPoints, true, "not erased by a lookup that didn't count");
  assert.equal(merged[0].title, "Renamed", "the newer view is used otherwise");
  assert.equal(mergeKnown([partial], [known({ source: "file", missingPoints: false })])[0].missingPoints, false, "a new count wins");
  assert.equal(mergeKnown([], [byTime])[0].missingPoints, undefined, "never counted stays unknown");
  const device = known({ local: true, id: null });
  assert.equal(mergeKnown([partial], [device]).length, 2, "a copy on this device is kept apart from the saved one");
});

test("only recent imports that should have points are counted (older ones lose them to the 90-day rule)", () => {
  const base = { id: "a1", source: "file" as const, local: false, chunkCount: 3, endedAt: NOW - 86_400_000 };
  assert.equal(shouldCountPoints(base, NOW, POINTS_KEPT_DAYS), true);
  assert.equal(shouldCountPoints({ ...base, chunkCount: 0 }, NOW, POINTS_KEPT_DAYS), false, "saved without points on purpose");
  assert.equal(shouldCountPoints({ ...base, endedAt: NOW - 91 * 86_400_000 }, NOW, POINTS_KEPT_DAYS), false, "points removed by retention");
  assert.equal(shouldCountPoints({ ...base, source: "fitx_gps" }, NOW, POINTS_KEPT_DAYS), false, "phone recordings retry from the device copy");
  assert.equal(shouldCountPoints({ ...base, id: null, local: true }, NOW, POINTS_KEPT_DAYS), false);
});

test("save failures: each daily cap says which one, and stops the files after it", () => {
  const gps = saveFailure({ status: "error", message: "GPS data limit reached: at most 1000 chunks a day", offline: false });
  assert.equal(gps.stop, true);
  assert.match(gps.reason, /GPS points/);
  assert.doesNotMatch(gps.reason, /50 activities/);
  const rows = saveFailure({ status: "error", message: "activity limit reached: at most 50 activities a day", offline: false });
  assert.equal(rows.stop, true);
  assert.match(rows.reason, /50 activities a day/);
  // The member's write budget (20261121100040) is not the 50-a-day cap: an hour, or tomorrow for the daily one.
  const hourly = saveFailure({ status: "error", message: "write limit reached: at most 10000 rows and 50 MB an hour", offline: false });
  assert.equal(hourly.stop, true);
  assert.match(hourly.reason, /in an hour/);
  assert.doesNotMatch(hourly.reason, /50 activities/);
  const daily = saveFailure({ status: "error", message: "write limit reached: at most 50000 rows and 150 MB a day", offline: false });
  assert.equal(daily.stop, true);
  assert.match(daily.reason, /tomorrow/);
  assert.doesNotMatch(daily.reason, /50 activities/);
  assert.deepEqual(saveFailure({ status: "error", message: "Request failed", offline: true }).stop, true);
  assert.deepEqual(saveFailure({ status: "rejected", message: "x" }).stop, false);
  assert.deepEqual(saveFailure({ status: "error", message: "boom", offline: false }), { reason: "It couldn’t be saved just now. Try again.", stop: false });
});

test("the result summary counts each outcome in plain words", () => {
  assert.equal(summariseResults([
    { kind: "imported", id: "1" }, { kind: "imported", id: "2" }, { kind: "already", id: "3" }, { kind: "skipped", reason: "overlap" },
    { kind: "unsupported", label: "Swimming" }, { kind: "failed", reason: "x" },
  ]), "2 imported, 1 already in FITX, 1 skipped, 1 not a walk, run or ride, 1 not imported.");
  assert.equal(summariseResults([]), "Nothing was imported.");
});

test("device distance: the session total, else the last cumulative reading, else unknown", () => {
  assert.equal(deviceDistance(parsed([line({ seconds: 10 })], { totals: { distanceM: 31, timerSeconds: null, elapsedSeconds: null, ascentM: null, kcal: null } })), 31);
  assert.equal(deviceDistance(parsed([line({ seconds: 10 })])), 30);
  assert.equal(deviceDistance(parsed([line({ seconds: 10 }).map((p) => ({ ...p, distanceM: null }))])), null);
});
