// Bug 36: the complete export of a run, chosen after a cut-short export of it was imported, is offered as a
// replacement for the saved one ("A shorter copy of this run is in FITX…"), not refused as "Already in FITX".
// Replacing changes the saved row in place, its points first, so two files' points are never mixed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { destination } from "@/lib/activity/geo";
import { checkImport, fullestOfEachSession, holdsMore, isFullerExport, refillsSaved, settleRepeat, summariseResults, type KnownActivity, type RecordShape } from "@/lib/activity/import/plan";
import { importClientId } from "@/lib/activity/import/fingerprint";
import { buildImportRecord } from "@/lib/activity/import/to-record";
import type { ImportPoint, ParsedImport } from "@/lib/activity/import/types";
import { countTrackChunks, getActivity, getTrackChunks, replaceImportedActivity, saveImportedActivity, viewFromRow, type ActivityView } from "@/lib/activity/repository";
import { FakeDb } from "./support/fake-db";

const ORIGIN = { lat: 12.9716, lng: 77.5946 };
const START = Date.UTC(2026, 10, 21, 1, 0, 0); // Sat 21 Nov 2026, 6:30 am IST
const NOW = Date.UTC(2026, 10, 25, 9, 0, 0);
const USER = "aaaaaaaa-0000-4000-8000-000000000001";

/** A run at 3 m/s, one point a second, for `seconds`: the cut-short export stops early, the complete one doesn't. */
function runFile(seconds: number): ParsedImport {
  const points: ImportPoint[] = [];
  for (let s = 0; s <= seconds; s++) {
    const p = destination(ORIGIN, 70, s * 3);
    points.push({ t: START + s * 1000, lat: p.lat, lng: p.lng, alt: null, speed: null, distanceM: null, heartRate: null, acc: null, altAcc: null });
  }
  return { format: "gpx", device: "Garmin Connect", sport: { kind: "unknown", label: null }, name: null, segments: [points], pauses: [], segmentsArePauses: true, startedAt: START, endedAt: START + seconds * 1000, totals: null, skippedPoints: 0 };
}

const shapeOf = (file: ParsedImport, title?: string) => {
  const { record } = buildImportRecord(file, { sport: "run", clientId: "00000000-0000-4000-8000-000000000000", weightKg: null, importedAt: NOW, title });
  return { record, shape: { startedAt: record.startedAt, endedAt: record.endedAt, pointCount: record.pointCount, chunkCount: record.chunks.length, sourceFormat: record.sourceFormat ?? null, distanceM: record.distanceM, movingSeconds: record.movingSeconds } satisfies RecordShape };
};

const known = (view: ActivityView): KnownActivity => ({
  id: view.id, clientId: view.clientId, sport: view.sport, title: view.title, startedAt: view.startedAt, endedAt: view.endedAt, source: view.source, local: view.local,
  pointCount: view.pointCount, chunkCount: view.chunkCount, sourceFormat: view.sourceFormat, distanceM: view.distanceM, movingSeconds: view.movingSeconds,
});

test("the complete export shares the cut-short one's device id (same first point)", async () => {
  assert.equal(await importClientId(runFile(144).segments[0][0].t), await importClientId(runFile(296).segments[0][0].t));
});

test("a fuller export of a saved import is offered as a replacement; the same file, or a shorter one, is already in FITX", () => {
  const short = shapeOf(runFile(144));
  const full = shapeOf(runFile(296));
  const saved: KnownActivity = { id: "a1", clientId: "c1", sport: "run", title: "Morning run", startedAt: short.shape.startedAt, endedAt: short.shape.endedAt, source: "file", local: false, pointCount: short.shape.pointCount, chunkCount: short.shape.chunkCount, sourceFormat: "gpx", distanceM: short.shape.distanceM, movingSeconds: short.shape.movingSeconds };
  const check = checkImport({ key: "f", clientId: "c1", startedAt: START, endedAt: full.shape.endedAt }, [saved], []);
  assert.equal(check.kind, "already", "the plain check finds the session");
  assert.deepEqual(settleRepeat(check, full.shape), { kind: "fuller", activity: saved });
  assert.equal(settleRepeat(check, short.shape).kind, "already", "the same file again is a repeat");
  const savedFull = { ...saved, endedAt: full.shape.endedAt, pointCount: full.shape.pointCount };
  assert.equal(settleRepeat({ kind: "already", activity: savedFull }, short.shape).kind, "already", "a cut-short file after the complete one is a repeat");
  // Only a saved import can be replaced: never a FITX recording or a copy that is only on this device.
  assert.equal(isFullerExport({ ...saved, source: "fitx_gps" }, full.shape), false);
  assert.equal(isFullerExport({ ...saved, local: true, id: null }, full.shape), false);
  assert.equal(isFullerExport({ ...saved, pointCount: undefined }, full.shape), false, "unknown is not called shorter");
  // An incomplete import that this file can't fill in (another export) is offered for replacement when it holds more.
  assert.equal(settleRepeat({ kind: "incomplete", activity: saved }, full.shape).kind, "fuller");
  assert.equal(settleRepeat({ kind: "incomplete", activity: saved }, short.shape).kind, "incomplete", "the file that made it fills it in");
});

test("two files of one session chosen together: the one with more of it is the one imported", () => {
  const files = [
    { key: "short", clientId: "c1", endedAt: START + 144_000, pointCount: 145 },
    { key: "other", clientId: "c2", endedAt: START + 50_000, pointCount: 51 },
    { key: "full", clientId: "c1", endedAt: START + 296_000, pointCount: 297 },
  ];
  assert.deepEqual([...fullestOfEachSession(files)].sort(), ["full", "other"]);
  assert.deepEqual([...fullestOfEachSession([files[2], files[0]])], ["full"], "whatever the order");
  assert.equal(holdsMore({ endedAt: START + 1000, pointCount: 10 }, { endedAt: START, pointCount: 20 }), false, "ends together: more points wins");
  assert.equal(holdsMore({ endedAt: START + 1000, pointCount: 30 }, { endedAt: START, pointCount: 20 }), true);
  assert.deepEqual([...fullestOfEachSession([{ key: "a", clientId: "c", endedAt: START, pointCount: 5 }, { key: "b", clientId: "c", endedAt: START, pointCount: 5 }])], ["a"], "the first of equals");
});

test("results: a replacement says so; a declined one counts as already in FITX", () => {
  assert.equal(summariseResults([{ kind: "replaced", id: "a1" }, { kind: "imported", id: "a2" }, { kind: "kept", id: "a3" }]), "1 imported, 1 replaced, 1 already in FITX.");
});

test("replacing in place: the same id, the new file's numbers and points, the member's name and sport kept", async () => {
  const db = new FakeDb();
  const clientId = await importClientId(START);
  const { record: short } = buildImportRecord(runFile(144), { sport: "run", clientId, weightKg: null, importedAt: NOW });
  const created = await saveImportedActivity(db, USER, short);
  assert.equal(created.status, "ok");
  const id = created.status === "ok" ? created.data.id : "";
  // Another member's activity must be untouched.
  db.tables.activities.push({ id: "someone-else", user_id: "bbbbbbbb-0000-4000-8000-000000000002", client_id: clientId, sport: "run", title: "Theirs", started_at: new Date(START).toISOString(), ended_at: new Date(START + 1000).toISOString(), distance_m: 1, chunk_count: 0 });
  // The member renamed it and called it a walk; the replacement keeps both.
  db.tables.activities[0].title = "Cubbon Park";
  db.tables.activities[0].sport = "walk";
  const saved = viewFromRow(db.tables.activities[0])!;
  const { record: full } = buildImportRecord(runFile(296), { sport: saved.sport, clientId, weightKg: null, importedAt: NOW, title: saved.title });
  const replaced = await replaceImportedActivity(db, USER, id, full);
  assert.deepEqual(replaced, { status: "ok", data: { id } });
  const after = await getActivity(db, USER, id);
  assert.ok(after.status === "ok" && after.data);
  if (after.status === "ok" && after.data) {
    assert.deepEqual([after.data.title, after.data.sport, after.data.distanceM, after.data.endedAt, after.data.pointCount], ["Cubbon Park", "walk", full.distanceM, full.endedAt, full.pointCount]);
    assert.ok(after.data.distanceM > short.distanceM);
  }
  const chunks = await getTrackChunks(db, USER, id);
  assert.ok(chunks.status === "ok");
  if (chunks.status === "ok") assert.deepEqual(chunks.data.map((chunk) => chunk.points), full.chunks.map((chunk) => chunk.points), "only the new file's points");
  assert.equal(db.tables.activities.filter((row) => row.client_id === clientId).length, 2, "one row each: nothing duplicated");
  assert.equal(db.tables.activities.find((row) => row.id === "someone-else")?.title, "Theirs");
  // Choosing the complete file again now finds it already in FITX.
  const nowSaved = known((await getActivity(db, USER, id) as { status: "ok"; data: ActivityView }).data);
  assert.equal(settleRepeat({ kind: "already", activity: nowSaved }, shapeOf(runFile(296)).shape).kind, "already");
});

/** A database whose point uploads fail (a timeout), after the row has been read and changed. */
class ChunkUploadsFail extends FakeDb {
  failUploads = false;
  from(table: string) {
    const builder = super.from(table) as unknown as Record<string, unknown>;
    if (table !== "activity_track_chunks" || !this.failUploads) return builder as never;
    builder.upsert = () => ({ then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }).then(resolve) });
    return builder as never;
  }
}

test("stopped part way, the row has the new numbers and none of the old points: the same file fills it in", async () => {
  const db = new ChunkUploadsFail();
  const clientId = await importClientId(START);
  const { record: short } = buildImportRecord(runFile(144), { sport: "run", clientId, weightKg: null, importedAt: NOW });
  const created = await saveImportedActivity(db, USER, short);
  const id = created.status === "ok" ? created.data.id : "";
  const { record: full } = buildImportRecord(runFile(296), { sport: "run", clientId, weightKg: null, importedAt: NOW });
  db.failUploads = true;
  const result = await replaceImportedActivity(db, USER, id, full);
  assert.equal(result.status, "error");
  const count = await countTrackChunks(db, USER, id);
  assert.deepEqual(count, { status: "ok", data: 0 }, "the cut-short file's points are gone, never mixed with the new numbers");
  const view = (await getActivity(db, USER, id) as { status: "ok"; data: ActivityView }).data;
  assert.equal(view.chunkCount, full.chunks.length);
  assert.ok(view.chunkCount > 0);
  // The incomplete path offers the same complete file again, and only it can fill the points in.
  assert.equal(refillsSaved(known(view), shapeOf(runFile(296)).shape), true);
  assert.equal(refillsSaved(known(view), shapeOf(runFile(144)).shape), false);
});

test("a replacement whose old points can't be removed changes nothing", async () => {
  const db = new FakeDb();
  const clientId = await importClientId(START);
  const { record: short } = buildImportRecord(runFile(144), { sport: "run", clientId, weightKg: null, importedAt: NOW });
  const created = await saveImportedActivity(db, USER, short);
  const id = created.status === "ok" ? created.data.id : "";
  db.failures.activity_track_chunks = { message: "Failed to fetch" };
  const { record: full } = buildImportRecord(runFile(296), { sport: "run", clientId, weightKg: null, importedAt: NOW });
  const result = await replaceImportedActivity(db, USER, id, full);
  assert.deepEqual(result, { status: "error", message: "Failed to fetch", offline: true });
  delete db.failures.activity_track_chunks;
  const view = (await getActivity(db, USER, id) as { status: "ok"; data: ActivityView }).data;
  assert.deepEqual([view.endedAt, view.pointCount], [short.endedAt, short.pointCount]);
});
