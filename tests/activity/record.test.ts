import { test } from "node:test";
import assert from "node:assert/strict";
import { ActivityEngine } from "@/lib/activity/engine";
import { haversine } from "@/lib/activity/geo";
import { decodeRoute } from "@/lib/activity/polyline";
import { PRIVACY_RADIUS_M } from "@/lib/activity/privacy";
import { buildActivityRecord, chunkFixes, CHUNK_SIZE, encodeRouteWithin, LIMITS } from "@/lib/activity/record";
import { replayStored } from "@/lib/activity/replay";
import { rowFromRecord, viewFromRecord, viewFromRow } from "@/lib/activity/repository";
import type { Fix, LogEntry } from "@/lib/activity/types";
import { ORIGIN, T0, control, fixEntries, gps, legs, moveAlong, pointAt, relativeError, standStill } from "./support/tracks";

function sampleLog(): LogEntry[] {
  const device = gps({ sigmaM: 3, accuracyM: 5, speedSigma: 0.2 }, 70);
  const path = legs(ORIGIN, [[0, 1500], [90, 1500], [180, 1500]]);
  const a = moveAlong(path, { toM: 2000, speedMps: 3, startMs: T0, device });
  const hiddenAt = a.endMs;
  const back = hiddenAt + 90_000;
  const b = moveAlong(path, { fromM: 2270, toM: 3600, speedMps: 3, startMs: back, device });
  const pauseAt = b.endMs;
  const resumeAt = pauseAt + 120_000;
  const stop = standStill(pointAt(path, 3600), { seconds: 30, startMs: resumeAt, device });
  const c = moveAlong(path, { fromM: 3600, speedMps: 3, startMs: stop.endMs, device });
  return [
    control({ type: "start", t: T0, sport: "run" }),
    ...fixEntries(a.fixes),
    control({ type: "hidden", t: hiddenAt }),
    control({ type: "visible", t: back - 200 }),
    ...fixEntries(b.fixes),
    control({ type: "pause", t: pauseAt }),
    control({ type: "resume", t: resumeAt }),
    ...fixEntries([...stop.fixes, ...c.fixes]),
    control({ type: "finish", t: c.endMs }),
  ];
}

test("the saved record matches the engine and stays internally consistent", () => {
  const log = sampleLog();
  const engine = ActivityEngine.replay(log);
  const snap = engine.snapshot(engine.endedAt!);
  const record = buildActivityRecord(engine, { clientId: "6f1c6b1e-0d55-4b1c-9d59-1d2f3c4b5a69", title: "Morning run", weightKg: 68, log });
  assert.equal(record.sport, "run");
  assert.equal(record.distanceM, Math.round(snap.distanceM * 10) / 10);
  assert.ok(record.movingSeconds <= record.elapsedSeconds);
  assert.equal(record.pausedSeconds, 120);
  assert.equal(record.gapCount, 1);
  assert.ok(Math.abs(record.gapSeconds - 90) <= 1);
  assert.equal(record.gaps[0].kind, "hidden");
  assert.ok(record.kcal !== null && record.kcal > 0);
  assert.equal(record.weightKg, 68);
  assert.ok(record.kcalMethod?.includes("2024 Adult Compendium"));
  assert.equal(record.timeline[0][0], "start");
  assert.equal(record.timeline[0][1], 0);
  assert.deepEqual(record.timeline.map(([type]) => type), ["start", "hidden", "visible", "pause", "resume", "finish"]);
  assert.equal(record.pointCount, engine.recordedFixes.length);
  assert.equal(record.chunks.reduce((sum, chunk) => sum + chunk.pointCount, 0), record.pointCount);
  // The simplified route keeps the gap open and stays close to the full route.
  const route = decodeRoute(record.routePolyline);
  assert.equal(route.length, snap.segments.length);
  assert.ok(relativeError(route.reduce((sum, s) => sum + s.slice(1).reduce((x, p, i) => x + haversine(s[i], p), 0), 0), snap.distanceM) < 0.03);
  // The share route never comes near the start or the finish.
  const start = snap.segments[0][0];
  const finish = snap.segments.at(-1)!.at(-1)!;
  for (const segment of decodeRoute(record.sharePolyline)) for (const p of segment) {
    assert.ok(haversine(p, start) >= PRIVACY_RADIUS_M - 2 && haversine(p, finish) >= PRIVACY_RADIUS_M - 2);
  }
  assert.ok(record.shareBbox !== null);
});

test("no weight: no calories and no method claimed", () => {
  const log = sampleLog();
  const record = buildActivityRecord(ActivityEngine.replay(log), { clientId: "c1", title: "Run", weightKg: null, log });
  assert.equal(record.kcal, null);
  assert.equal(record.kcalMethod, null);
  assert.equal(record.weightKg, null);
});

test("an unfinished engine cannot be saved", () => {
  const engine = new ActivityEngine();
  engine.apply(control({ type: "start", t: T0, sport: "walk" }));
  assert.throws(() => buildActivityRecord(engine, { clientId: "c", title: "x", weightKg: 70, log: [] }), /not finished/);
});

test("chunks hold at most CHUNK_SIZE fixes each, in order", () => {
  const device = gps({ sigmaM: 3, accuracyM: 5 }, 71);
  const fixes = moveAlong(legs(ORIGIN, [[0, 7000]]), { speedMps: 3, startMs: T0, device }).fixes;
  const chunks = chunkFixes(fixes);
  assert.equal(chunks.length, Math.ceil(fixes.length / CHUNK_SIZE));
  chunks.forEach((chunk, i) => {
    assert.equal(chunk.seq, i);
    assert.ok(chunk.pointCount <= CHUNK_SIZE);
    assert.ok(chunk.endedAt >= chunk.startedAt);
  });
  assert.deepEqual(chunkFixes([]), []);
});

test("the stored timeline and chunks replay to the same summary", () => {
  const log = sampleLog();
  const engine = ActivityEngine.replay(log);
  const record = buildActivityRecord(engine, { clientId: "c2", title: "Run", weightKg: 70, log });
  const replayed = replayStored(record.sport, record.startedAt, record.timeline, record.chunks);
  const snap = replayed.snapshot(replayed.endedAt!);
  assert.equal(replayed.status, "finished");
  // Stored values are rounded (0.1 s, 1e-6 degrees), so allow a hair of difference.
  assert.ok(Math.abs(snap.distanceM - record.distanceM) < 5, `${snap.distanceM} vs ${record.distanceM}`);
  assert.ok(Math.abs(snap.movingSeconds - record.movingSeconds) < 3);
  assert.equal(snap.gaps.length, record.gapCount);
  assert.ok(replayed.acceptedSegments.length >= 2);
});

test("database rows round-trip through the view the screens use", () => {
  const log = sampleLog();
  const record = buildActivityRecord(ActivityEngine.replay(log), { clientId: "c3", title: "Evening run", weightKg: 70, log });
  const row = rowFromRecord(record, "user-1");
  assert.equal(row.user_id, "user-1");
  assert.equal(row.client_id, "c3");
  assert.equal(row.chunk_count, record.chunks.length);
  // Simulate what PostgREST returns: an id, timestamps as ISO text, numerics possibly as strings.
  const returned = { ...JSON.parse(JSON.stringify(row)), id: "8d1f2c3b-1a2b-4c3d-9e8f-0a1b2c3d4e5f", distance_m: String(row.distance_m) };
  const view = viewFromRow(returned)!;
  const local = viewFromRecord(record);
  assert.equal(view.id, returned.id);
  assert.equal(view.local, false);
  assert.equal(local.local, true);
  for (const key of ["sport", "title", "startedAt", "endedAt", "elapsedSeconds", "movingSeconds", "distanceM", "kcal", "gapCount", "routePolyline", "sharePolyline"] as const) {
    assert.deepEqual(view[key], local[key], key);
  }
  assert.deepEqual(view.splits, local.splits);
  assert.deepEqual(view.gaps, local.gaps);
  assert.deepEqual(view.timeline, local.timeline);
  assert.equal(viewFromRow({ ...returned, sport: "swim" }), null);
});

test("a stored replay keeps a screen-lock gap even when fix times were rounded past the lock", () => {
  // Fix times are stored to 0.1 s; a fix at .051 s rounds to .1 s, after a lock at .080 s.
  const device = gps({ sigmaM: 3, accuracyM: 5, speedSigma: 0.2 }, 72);
  const path = legs(ORIGIN, [[0, 2000]]);
  // Chunk times are relative to the chunk's first fix, so offset the later fixes by 51 ms from it.
  const a = moveAlong(path, { toM: 600, speedMps: 3, startMs: T0, device });
  a.fixes.forEach((fix, i) => { if (i > 0) fix.t += 51; });
  const lastFix = a.fixes[a.fixes.length - 1].t;
  const hiddenAt = lastFix + 29;
  const back = hiddenAt + 20_000;
  const c = moveAlong(path, { fromM: 670, toM: 1300, speedMps: 3, startMs: back + 51, device });
  const log: LogEntry[] = [control({ type: "start", t: T0, sport: "run" }), ...fixEntries(a.fixes), control({ type: "hidden", t: hiddenAt }), control({ type: "visible", t: back }), ...fixEntries(c.fixes), control({ type: "finish", t: c.endMs })];
  const engine = ActivityEngine.replay(log);
  assert.equal(engine.gaps.length, 1);
  const record = buildActivityRecord(engine, { clientId: "c-rounding", title: "Run", weightKg: null, log });
  const replayed = replayStored(record.sport, record.startedAt, record.timeline, record.chunks);
  assert.equal(replayed.gaps.length, 1, "the replay keeps the interruption");
  assert.equal(replayed.acceptedSegments.length, 2, "and the GPX keeps the two stretches apart");
});

test("stored chunks always fit the database limits", () => {
  // Two days of fixes at twice a second: more than 200 chunks of 1,000 would hold.
  const fast: Fix[] = [];
  for (let i = 0; i < 345_600; i++) fast.push({ t: T0 + i * 500, lat: ORIGIN.lat + (i % 500) * 1e-5, lng: ORIGIN.lng, acc: 5, alt: null, altAcc: null, speed: 2 });
  const chunks = chunkFixes(fast);
  assert.ok(chunks.length <= LIMITS.maxChunks, `${chunks.length} chunks`);
  for (const chunk of chunks) {
    assert.ok(chunk.pointCount <= LIMITS.maxChunkPoints);
    assert.ok(chunk.points.length <= LIMITS.maxChunkChars);
  }
  // Wild jumps between fixes take more characters: those chunks hold fewer fixes.
  const jumpy: Fix[] = [];
  for (let i = 0; i < 3_000; i++) jumpy.push({ t: T0 + i * 1000, lat: ORIGIN.lat + (i % 2 ? 0.9 : -0.9), lng: ORIGIN.lng + (i % 3) * 0.7, acc: 5 + (i % 7) * 900, alt: (i % 2) * 4000, altAcc: 3, speed: (i % 5) * 20 });
  for (const chunk of chunkFixes(jumpy)) assert.ok(chunk.points.length <= LIMITS.maxChunkChars);
  assert.equal(chunkFixes(jumpy).reduce((sum, chunk) => sum + chunk.pointCount, 0), jumpy.length, "nothing dropped");
});

test("stored routes are simplified more coarsely when needed to fit", () => {
  // 100 km of winding road sampled every 5 m, against a limit it can't meet point by point.
  const winding = Array.from({ length: 20_000 }, (_, i) => ({ lat: ORIGIN.lat + i * 4.5e-5, lng: ORIGIN.lng + 4.6e-4 * Math.sin(i / 16) }));
  const limit = 10_000;
  assert.ok(encodeRouteWithin([winding], 0, Number.MAX_SAFE_INTEGER).length > limit, "over the limit unsimplified");
  const encoded = encodeRouteWithin([winding], 0, limit);
  assert.ok(encoded.length <= limit, `${encoded.length}`);
  assert.ok(decodeRoute(encoded)[0].length > 300, "the bends are kept");
  assert.ok(encodeRouteWithin([winding], 0).length <= LIMITS.maxPolylineChars);
  const small = [legs(ORIGIN, [[0, 500], [90, 500]])];
  assert.equal(decodeRoute(encodeRouteWithin(small, 0))[0].length, 3, "a small route is not coarsened");
});
