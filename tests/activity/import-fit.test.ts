import { test } from "node:test";
import assert from "node:assert/strict";
import { fitCrc, looksLikeFit, readFit, timerPauses } from "@/lib/activity/import/fit";
import { ImportError } from "@/lib/activity/import/types";
import { destination } from "@/lib/activity/geo";
import {
  BASE, crc16, DEVICE_INFO_FIELDS, EVENT_FIELDS, FILE_ID_FIELDS, FitWriter, fitTime, LAP_FIELDS, MSG, RECORD_FIELDS, RECORD_FIELDS_NO_TIME,
  recordValues, semicircles, SESSION_FIELDS, sessionValues, type RecordPoint,
} from "./support/fit-writer";

const START = Date.UTC(2026, 10, 12, 1, 32, 0);
const ORIGIN = { lat: 12.97634, lng: 77.59287 };

/** A run north-east at 3 m/s, one point a second, climbing 0.1 m a second. */
function runPoints(count: number, fromS = 0, fromM = 0): RecordPoint[] {
  return Array.from({ length: count }, (_, i) => {
    const metres = fromM + (i * 3);
    const p = destination(ORIGIN, 40, metres);
    return { t: START + (fromS + i) * 1000, lat: p.lat, lng: p.lng, alt: 900 + (fromS + i) * 0.1, speed: 3, distance: metres, hr: 140 };
  });
}

function activityFile(options: { pause?: boolean; sport?: number; productName?: string | null; fileType?: number; sessions?: number } = {}): Uint8Array {
  const w = new FitWriter();
  w.define(0, MSG.fileId, FILE_ID_FIELDS).data(0, [options.fileType ?? 4, 1, 3990, fitTime(START), null]);
  w.define(1, MSG.deviceInfo, DEVICE_INFO_FIELDS).data(1, [fitTime(START), 0, 1, 3990, options.productName === undefined ? "Forerunner 255" : options.productName]);
  // A sensor (device index 1) must not name the device.
  w.data(1, [fitTime(START), 1, 123, 7, "H10"]);
  w.define(2, MSG.event, EVENT_FIELDS).data(2, [fitTime(START), 0, 0]);
  w.define(3, MSG.record, RECORD_FIELDS);
  for (const p of runPoints(60)) w.data(3, recordValues(p));
  if (options.pause) {
    // Timer stopped for 30 s, then running again from where it stopped.
    w.data(2, [fitTime(START + 60_000), 0, 1]).data(2, [fitTime(START + 90_000), 0, 0]);
    for (const p of runPoints(60, 90, 180)) w.data(3, recordValues(p));
  }
  const end = options.pause ? START + 149_000 : START + 59_000;
  w.data(2, [fitTime(end), 0, 4]);
  w.define(4, MSG.lap, LAP_FIELDS).data(4, [fitTime(end), fitTime(START), Math.round((end - START)), Math.round((end - START) - (options.pause ? 30_000 : 0)), options.pause ? 35_700 : 17_700, 30, 12]);
  w.define(5, MSG.session, SESSION_FIELDS);
  for (let i = 0; i < (options.sessions ?? 1); i++) {
    w.data(5, sessionValues({ t: end, start: START, sport: options.sport ?? 1, elapsedS: (end - START) / 1000, timerS: (end - START) / 1000 - (options.pause ? 30 : 0), distanceM: options.pause ? 357 : 177, kcal: 30, ascentM: 12 }));
  }
  return w.build();
}

test("the writer's CRC matches the decoder's, and FIT files are recognised by their header", () => {
  const bytes = activityFile();
  assert.equal(looksLikeFit(bytes), true);
  assert.equal(looksLikeFit(new TextEncoder().encode("<gpx></gpx>               ")), false);
  assert.equal(fitCrc(bytes, 0, bytes.length - 2), crc16(bytes, 0, bytes.length - 2));
});

test("a FIT activity: device, sport, points, timer pauses and the device's totals", () => {
  const parsed = readFit(activityFile({ pause: true }));
  assert.equal(parsed.format, "fit");
  assert.equal(parsed.device, "Garmin Forerunner 255");
  assert.deepEqual(parsed.sport, { kind: "known", sport: "run", label: "Running" });
  assert.equal(parsed.segments.length, 1);
  const points = parsed.segments[0];
  assert.equal(points.length, 120);
  const first = points[0];
  assert.equal(first.t, START);
  assert.ok(Math.abs(first.lat - ORIGIN.lat) < 1e-6 && Math.abs(first.lng - ORIGIN.lng) < 1e-6, "semicircles become degrees");
  assert.ok(Math.abs((first.alt ?? 0) - 900) < 0.21, "enhanced altitude: scale 5, offset 500");
  assert.equal(first.speed, 3);
  assert.equal(first.heartRate, 140);
  assert.equal(points[10].distanceM, 30);
  assert.deepEqual(parsed.pauses, [{ start: START + 60_000, end: START + 90_000 }]);
  assert.equal(parsed.startedAt, START);
  assert.equal(parsed.endedAt, START + 149_000);
  assert.deepEqual(parsed.totals, { distanceM: 357, timerSeconds: 119, elapsedSeconds: 149, ascentM: 12, kcal: 30 });
  assert.equal(parsed.skippedPoints, 0);
});

test("without a product name only the maker is named, and an unknown maker is not named at all", () => {
  assert.equal(readFit(activityFile({ productName: null })).device, "Garmin");
  const w = new FitWriter();
  w.define(0, MSG.fileId, FILE_ID_FIELDS).data(0, [4, 9999, 1, fitTime(START), null]);
  w.define(1, MSG.record, RECORD_FIELDS);
  for (const p of runPoints(5)) w.data(1, recordValues(p));
  assert.equal(readFit(w.build()).device, null);
});

test("sports: walking and hiking are walks, cycling a ride, generic for the person to choose, swimming not supported", () => {
  assert.deepEqual(readFit(activityFile({ sport: 11 })).sport, { kind: "known", sport: "walk", label: "Walking" });
  assert.deepEqual(readFit(activityFile({ sport: 17 })).sport, { kind: "known", sport: "walk", label: "Hiking" });
  assert.deepEqual(readFit(activityFile({ sport: 2 })).sport, { kind: "known", sport: "ride", label: "Cycling" });
  assert.deepEqual(readFit(activityFile({ sport: 0 })).sport, { kind: "unknown", label: "Generic activity" });
  assert.deepEqual(readFit(activityFile({ sport: 5 })).sport, { kind: "unsupported", label: "Swimming" });
});

test("compressed timestamps, big-endian definitions, developer fields and unknown messages are read safely", () => {
  const w = new FitWriter();
  w.define(0, MSG.fileId, FILE_ID_FIELDS, { bigEndian: true }).data(0, [4, 1, 3990, fitTime(START), "Edge 540"]);
  // An unknown message (global 65000) with a developer field: skipped by size.
  w.define(5, 65000, [[0, BASE.uint32], [1, BASE.uint16]], { developer: [3] }).data(5, [123456, 7]);
  // One full timestamp first, then records with 5-bit offsets (across the 32-second rollover).
  w.define(1, MSG.record, RECORD_FIELDS, { bigEndian: true }).data(1, recordValues(runPoints(1)[0]));
  w.define(2, MSG.record, RECORD_FIELDS_NO_TIME);
  const base = fitTime(START);
  const points = runPoints(40);
  for (let i = 1; i < 40; i++) {
    const p = points[i];
    const offset = (base + i) % 32;
    w.data(2, [semicircles(p.lat), semicircles(p.lng), Math.round((900 + 500) * 5), 3000, Math.round(i * 300), 150], { compressedOffset: offset });
  }
  const parsed = readFit(w.build({ headerSize: 12 }));
  assert.equal(parsed.device, "Garmin Edge 540");
  const read = parsed.segments[0];
  assert.equal(read.length, 40);
  assert.deepEqual(read.map((p) => p.t), points.map((p) => p.t), "every compressed timestamp decodes to its second, rollover included");
  assert.equal(read[5].alt, 900, "plain altitude (field 2) when there is no enhanced altitude");
  assert.equal(read[5].speed, 3);
});

test("invalid values stay unknown, never 0", () => {
  const w = new FitWriter();
  w.define(0, MSG.fileId, FILE_ID_FIELDS).data(0, [4, 1, 3990, fitTime(START), null]);
  w.define(1, MSG.record, RECORD_FIELDS);
  for (const p of runPoints(3)) w.data(1, recordValues({ ...p, alt: null, speed: null, distance: null, hr: null }));
  // A record without a position is skipped (counted), not placed at 0,0.
  w.data(1, [fitTime(START + 5000), null, null, null, null, null, 120]);
  const parsed = readFit(w.build());
  const point = parsed.segments[0][0];
  assert.deepEqual([point.alt, point.speed, point.distanceM, point.heartRate], [null, null, null, null]);
  assert.equal(parsed.skippedPoints, 1);
  assert.equal(parsed.totals?.distanceM ?? null, null);
});

test("damaged, cut-short or wrong files fail with a reason instead of importing part of them", () => {
  const good = activityFile();
  const code = (bytes: Uint8Array) => {
    try {
      readFit(bytes);
      return "ok";
    } catch (error) {
      assert.ok(error instanceof ImportError, `expected an ImportError, got ${error}`);
      return error.code;
    }
  };
  assert.equal(code(good), "ok");
  const w = new FitWriter();
  w.define(0, MSG.fileId, FILE_ID_FIELDS).data(0, [4, 1, 1, fitTime(START), null]);
  assert.equal(code(w.build({ badCrc: true })), "damaged", "checksum");
  assert.equal(code(good.slice(0, good.length - 40)), "damaged", "cut short");
  const header = good.slice();
  header[12] ^= 0xff;
  assert.equal(code(header), "damaged", "header checksum");
  assert.equal(code(new FitWriter().raw([0x03, 1, 2, 3]).build()), "damaged", "data before its definition");
  assert.equal(code(new TextEncoder().encode("not a fit file at all")), "unknown-format");
  assert.equal(code(activityFile({ fileType: 6 })), "not-activity", "a course file");
  assert.equal(code(activityFile({ sessions: 2 })), "not-activity", "a multisport file");
  const noPoints = new FitWriter();
  noPoints.define(0, MSG.fileId, FILE_ID_FIELDS).data(0, [4, 1, 1, fitTime(START), null]);
  noPoints.define(1, MSG.record, RECORD_FIELDS).data(1, [fitTime(START), null, null, null, null, 0, 120]);
  assert.equal(code(noPoints.build()), "no-points", "an indoor session");
  const declaresTooMuch = activityFile();
  declaresTooMuch[4] = 0xff;
  declaresTooMuch[5] = 0xff;
  assert.equal(code(declaresTooMuch), "damaged", "a data size beyond the file");
});

test("a header CRC of zero is allowed (it means not computed)", () => {
  const w = new FitWriter();
  w.define(0, MSG.fileId, FILE_ID_FIELDS).data(0, [4, 1, 3990, fitTime(START), null]);
  w.define(1, MSG.record, RECORD_FIELDS);
  for (const p of runPoints(3)) w.data(1, recordValues(p));
  assert.equal(readFit(w.build({ headerCrc: false })).segments[0].length, 3);
});

test("timer pauses: stops and starts pair up inside the activity; a final stop is not a pause", () => {
  const t = (s: number) => START + s * 1000;
  assert.deepEqual(timerPauses([{ t: t(0), running: true }, { t: t(60), running: false }, { t: t(90), running: true }, { t: t(120), running: false }], t(0), t(120)), [{ start: t(60), end: t(90) }]);
  // Repeated stops count from the first; pauses are clipped to the activity.
  assert.deepEqual(timerPauses([{ t: t(10), running: false }, { t: t(12), running: false }, { t: t(20), running: true }], t(0), t(15)), [{ start: t(10), end: t(15) }]);
  assert.deepEqual(timerPauses([], t(0), t(10)), []);
});
