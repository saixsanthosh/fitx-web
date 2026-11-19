import { test } from "node:test";
import assert from "node:assert/strict";
import { ActivityEngine } from "@/lib/activity/engine";
import { MemoryRecordingStore } from "@/lib/activity/local-store";
import { buildActivityRecord } from "@/lib/activity/record";
import {
  deleteActivity, deleteActivityByClientId, deleteAllActivities, getActivity, getTrackChunks, isMissingTableError, isNetworkError,
  countTrackChunks, isPermanentRejection, latestWeight, listActivities, saveActivity, saveImportedActivity, totalsSince, updateActivity, type SupabaseLike,
} from "@/lib/activity/repository";
import { clearActivityDataOnSignOut, prepareActivitySignOut, uploadPending } from "@/lib/activity/sync";
import type { LogEntry } from "@/lib/activity/types";
import { ORIGIN, T0, gps, legs, moveAlong, recording } from "./support/tracks";

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

/**
 * A small in-memory stand-in for the supabase-js query builder: just the calls the activity
 * repository makes, with PostgREST-like results ({ data, error }).
 */
class FakeDb implements SupabaseLike {
  tables: Record<string, Row[]> = { activities: [], activity_track_chunks: [], body_metrics: [], profiles: [] };
  failures: Record<string, { code?: string; message: string; details?: string }> = {};
  calls: string[] = [];
  private ids = 0;

  from(table: string) {
    return this.query(this, table);
  }

  private query(db: FakeDb, table: string) {
    const filters: Filter[] = [];
    let mode: "select" | "upsert" | "update" | "delete" = "select";
    let payload: Row[] = [];
    let options: { onConflict?: string; ignoreDuplicates?: boolean } = {};
    let order: { column: string; ascending: boolean } | null = null;
    let limit = Infinity;
    let single = false;
    let returning = false;
    const run = () => {
      db.calls.push(`${mode}:${table}`);
      const failure = db.failures[table];
      if (failure) return { data: null, error: failure };
      const rows = db.tables[table];
      if (mode === "upsert") {
        const keys = (options.onConflict ?? "").split(",");
        const out: Row[] = [];
        for (const item of payload) {
          const existing = rows.find((row) => keys.every((key) => row[key] === item[key]));
          if (existing) {
            if (!options.ignoreDuplicates) Object.assign(existing, item);
            continue;
          }
          const stored = { id: `00000000-0000-4000-8000-${String(++db.ids).padStart(12, "0")}`, ...item };
          rows.push(stored);
          out.push(stored);
        }
        return { data: returning ? out.map((row) => ({ id: row.id })) : null, error: null };
      }
      let matched = rows.filter((row) => filters.every((f) => f(row)));
      if (mode === "update") {
        for (const row of matched) Object.assign(row, payload[0]);
        return { data: returning ? matched.map((row) => ({ id: row.id })) : null, error: null };
      }
      if (mode === "delete") {
        db.tables[table] = rows.filter((row) => !matched.includes(row));
        if (table === "activities") {
          const gone = new Set(matched.map((row) => row.id));
          db.tables.activity_track_chunks = db.tables.activity_track_chunks.filter((chunk) => !gone.has(chunk.activity_id));
        }
        return { data: null, error: null };
      }
      if (order) {
        const { column, ascending } = order;
        matched = [...matched].sort((a, b) => (String(a[column]) < String(b[column]) ? -1 : String(a[column]) > String(b[column]) ? 1 : 0) * (ascending ? 1 : -1));
      }
      matched = matched.slice(0, limit);
      if (single) return { data: matched[0] ? { ...matched[0] } : null, error: null };
      return { data: matched.map((row) => ({ ...row })), error: null };
    };
    const builder: Record<string, unknown> = {
      select: () => { returning = true; return builder; },
      upsert: (rows: Row | Row[], opts: typeof options) => { mode = "upsert"; payload = Array.isArray(rows) ? rows : [rows]; options = opts ?? {}; return builder; },
      update: (row: Row) => { mode = "update"; payload = [row]; return builder; },
      delete: () => { mode = "delete"; return builder; },
      eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return builder; },
      lt: (column: string, value: string) => { filters.push((row) => String(row[column]) < value); return builder; },
      gte: (column: string, value: string) => { filters.push((row) => String(row[column]) >= value); return builder; },
      not: (column: string) => { filters.push((row) => row[column] !== null && row[column] !== undefined); return builder; },
      order: (column: string, opts: { ascending: boolean }) => { if (!order) order = { column, ascending: opts.ascending }; return builder; },
      limit: (n: number) => { limit = n; return builder; },
      maybeSingle: () => { single = true; return builder; },
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(run).then(resolve, reject),
    };
    return builder;
  }
}

function sampleRecord(clientId: string, startMs = T0) {
  const device = gps({ sigmaM: 3, accuracyM: 5, speedSigma: 0.2 }, 90);
  const run = moveAlong(legs(ORIGIN, [[0, 2500]]), { speedMps: 3, startMs, device });
  const log: LogEntry[] = recording("run", run.fixes);
  return buildActivityRecord(ActivityEngine.replay(log), { clientId, title: "Morning run", weightKg: 70, log });
}

test("missing tables and network failures are recognised", () => {
  assert.equal(isMissingTableError({ code: "42P01", message: 'relation "public.activities" does not exist' }), true);
  assert.equal(isMissingTableError({ code: "PGRST205", message: "Could not find the table 'public.activities' in the schema cache" }), true);
  assert.equal(isMissingTableError({ code: "42501", message: "permission denied" }), false);
  assert.equal(isNetworkError({ message: "TypeError: Failed to fetch" }), true);
  assert.equal(isNetworkError({ message: "", details: "TypeError: Load failed" }), true);
  assert.equal(isNetworkError({ code: "23505", message: "duplicate key" }), false);
});

test("saving is idempotent: a retried upload reuses the activity and replaces its chunks", async () => {
  const db = new FakeDb();
  const record = sampleRecord("6f1c6b1e-0d55-4b1c-9d59-1d2f3c4b5a69");
  const first = await saveActivity(db, "user-1", record);
  assert.equal(first.status, "ok");
  const second = await saveActivity(db, "user-1", record);
  assert.equal(second.status, "ok");
  assert.equal(first.status === "ok" && second.status === "ok" && first.data.id === second.data.id, true);
  assert.equal(db.tables.activities.length, 1);
  assert.equal(db.tables.activity_track_chunks.length, record.chunks.length);
  assert.ok(db.tables.activity_track_chunks.every((chunk) => chunk.user_id === "user-1" && chunk.encoding === 1));
});

test("an import whose points fail part way is taken back out, so importing it again starts clean", async () => {
  const record = { ...sampleRecord("imp-1"), source: "file" as const, sourceFormat: "gpx" as const, sourceDevice: "Garmin", importedAt: T0 };
  assert.ok(record.chunks.length > 0);
  const db = new FakeDb();
  let chunkWrites = 0;
  const flaky: SupabaseLike = {
    from(name: string) {
      if (name === "activity_track_chunks" && ++chunkWrites === 1) db.failures.activity_track_chunks = { code: "54000", message: "GPS data limit reached: at most 1000 chunks a day" };
      return db.from(name);
    },
  };
  const result = await saveImportedActivity(flaky, "u", record);
  assert.equal(result.status, "error");
  assert.equal(result.status === "error" && result.message, "GPS data limit reached: at most 1000 chunks a day");
  assert.equal(db.tables.activities.length, 0, "the activity row is removed (its chunks go with it in the database)");
  delete db.failures.activity_track_chunks;
  const again = await saveImportedActivity(db, "u", record);
  assert.equal(again.status, "ok");
  assert.equal(db.tables.activities.length, 1);
  const stored = again.status === "ok" ? await countTrackChunks(db, "u", again.data.id) : null;
  assert.deepEqual(stored, { status: "ok", data: record.chunks.length });
});

test("importing again only adds the points an earlier import is missing, and never overwrites stored ones", async () => {
  const device = gps({ sigmaM: 3, accuracyM: 5, speedSigma: 0.2 }, 91);
  const log: LogEntry[] = recording("run", moveAlong(legs(ORIGIN, [[0, 8000]]), { speedMps: 3, startMs: T0, device }).fixes);
  const built = buildActivityRecord(ActivityEngine.replay(log), { clientId: "imp-3", title: "Long run", weightKg: 70, log });
  const record = { ...built, source: "file" as const, sourceFormat: "gpx" as const, sourceDevice: "Garmin", importedAt: T0 };
  assert.ok(record.chunks.length > 1, `${record.chunks.length} chunks`);
  const db = new FakeDb();
  assert.equal((await saveImportedActivity(db, "u", record)).status, "ok");
  // The upload had stopped after the first chunk; that chunk is marked to show it stays untouched.
  db.tables.activity_track_chunks = db.tables.activity_track_chunks.filter((chunk) => chunk.seq === 0);
  db.tables.activity_track_chunks[0].points = "stored";
  const again = await saveImportedActivity(db, "u", record);
  assert.equal(again.status, "ok");
  assert.equal(db.tables.activity_track_chunks.length, record.chunks.length);
  assert.equal(db.tables.activity_track_chunks.find((chunk) => chunk.seq === 0)?.points, "stored");
  // A phone save still replaces its chunks from the device copy.
  assert.equal((await saveActivity(db, "u", record)).status, "ok");
  assert.equal(db.tables.activity_track_chunks.find((chunk) => chunk.seq === 0)?.points, record.chunks[0].points);
});

test("an import never removes a row that was already there, and a phone save never removes anything", async () => {
  const record = sampleRecord("imp-2");
  const db = new FakeDb();
  assert.equal((await saveActivity(db, "u", record)).status, "ok");
  db.failures.activity_track_chunks = { message: "upstream timeout" };
  assert.equal((await saveImportedActivity(db, "u", record)).status, "error");
  assert.equal(db.tables.activities.length, 1, "the earlier save stays");
  const phone = sampleRecord("phone-1");
  assert.equal((await saveActivity(db, "u", phone)).status, "error");
  assert.equal(db.tables.activities.length, 2, "a phone recording keeps its row and retries from the device copy");
});

test("before the migration, every call says 'unavailable' instead of failing", async () => {
  const db = new FakeDb();
  db.failures.activities = { code: "PGRST205", message: "Could not find the table 'public.activities' in the schema cache" };
  db.failures.activity_track_chunks = db.failures.activities;
  const record = sampleRecord("c-missing");
  assert.deepEqual(await saveActivity(db, "u", record), { status: "unavailable" });
  assert.deepEqual(await listActivities(db, "u"), { status: "unavailable" });
  assert.deepEqual(await getActivity(db, "u", "x"), { status: "unavailable" });
  assert.deepEqual(await getTrackChunks(db, "u", "x"), { status: "unavailable" });
  assert.deepEqual(await totalsSince(db, "u", T0), { status: "unavailable" });
  assert.deepEqual(await deleteAllActivities(db, "u"), { status: "unavailable" });
});

test("offline errors are reported as offline", async () => {
  const db = new FakeDb();
  db.failures.activities = { message: "TypeError: Failed to fetch", details: "TypeError: Failed to fetch" };
  const result = await listActivities(db, "u");
  assert.deepEqual(result, { status: "error", message: "TypeError: Failed to fetch", offline: true });
});

test("history lists newest first, pages by start time, and totals a period", async () => {
  const db = new FakeDb();
  for (let i = 0; i < 3; i++) assert.equal((await saveActivity(db, "u", sampleRecord(`c-${i}`, T0 + i * 86_400_000))).status, "ok");
  assert.equal((await saveActivity(db, "other", sampleRecord("c-other"))).status, "ok");
  const page = await listActivities(db, "u", { limit: 2 });
  assert.equal(page.status, "ok");
  if (page.status !== "ok") return;
  assert.deepEqual(page.data.map((a) => a.clientId), ["c-2", "c-1"]);
  const next = await listActivities(db, "u", { limit: 2, before: page.data[1].startedAt });
  assert.equal(next.status === "ok" && next.data.map((a) => a.clientId).join(), "c-0");
  const totals = await totalsSince(db, "u", T0 + 86_400_000 - 1);
  assert.equal(totals.status, "ok");
  if (totals.status === "ok") {
    assert.equal(totals.data.count, 2);
    assert.equal(totals.data.bySport.run.count, 2);
    assert.ok(Math.abs(totals.data.distanceM - 2 * page.data[0].distanceM) < 200);
  }
});

test("history can be limited to one sport (the sport pages), still newest first and paged", async () => {
  const db = new FakeDb();
  const ids: string[] = [];
  for (let i = 0; i < 4; i++) {
    const saved = await saveActivity(db, "u", sampleRecord(`s-${i}`, T0 + i * 86_400_000));
    assert.equal(saved.status, "ok");
    if (saved.status === "ok") ids.push(saved.data.id);
  }
  // The first and third become walks; the others stay runs.
  for (const id of [ids[0], ids[2]]) assert.equal((await updateActivity(db, "u", id, { sport: "walk" })).status, "ok");
  const walks = await listActivities(db, "u", { sport: "walk" });
  assert.equal(walks.status === "ok" && walks.data.map((a) => `${a.sport}:${a.clientId}`).join(), "walk:s-2,walk:s-0");
  const runs = await listActivities(db, "u", { sport: "run", limit: 1 });
  assert.equal(runs.status === "ok" && runs.data.map((a) => a.clientId).join(), "s-3");
  const older = await listActivities(db, "u", { sport: "run", limit: 1, before: T0 + 3 * 86_400_000 });
  assert.equal(older.status === "ok" && older.data.map((a) => a.clientId).join(), "s-1");
  const all = await listActivities(db, "u", { sport: null });
  assert.equal(all.status === "ok" && all.data.length, 4);
});

test("detail, chunks, rename and delete only touch the owner's rows", async () => {
  const db = new FakeDb();
  const record = sampleRecord("c-detail");
  const saved = await saveActivity(db, "u", record);
  assert.equal(saved.status, "ok");
  if (saved.status !== "ok") return;
  const id = saved.data.id;
  const detail = await getActivity(db, "u", id);
  assert.equal(detail.status === "ok" && detail.data?.title, "Morning run");
  assert.equal(detail.status === "ok" && detail.data?.timeline.length, record.timeline.length);
  const foreign = await getActivity(db, "someone-else", id);
  assert.equal(foreign.status === "ok" && foreign.data, null);
  const chunks = await getTrackChunks(db, "u", id);
  assert.equal(chunks.status === "ok" && chunks.data.length, record.chunks.length);
  assert.equal((await updateActivity(db, "u", id, { title: "Tempo run" })).status, "ok");
  assert.equal(db.tables.activities[0].title, "Tempo run");
  // Calories filled in later, once the account has a weight (L4): kept with the weight used.
  assert.equal((await updateActivity(db, "u", id, { kcal: 312, kcalMethod: "MET estimate", weightKg: 70.5 })).status, "ok");
  const filled = await getActivity(db, "u", id);
  assert.ok(filled.status === "ok" && filled.data);
  assert.deepEqual([filled.data.kcal, filled.data.kcalMethod, filled.data.weightKg], [312, "MET estimate", 70.5]);
  assert.equal((await updateActivity(db, "someone-else", id, { title: "x" })).status, "error");
  assert.equal((await deleteActivity(db, "someone-else", id)).status, "ok");
  assert.equal(db.tables.activities.length, 1, "another account deletes nothing");
  assert.equal((await deleteActivity(db, "u", id)).status, "ok");
  assert.equal(db.tables.activities.length, 0);
  assert.equal(db.tables.activity_track_chunks.length, 0);
});

test("weight for the estimate: newest weigh-in, else the profile, else none", async () => {
  const db = new FakeDb();
  assert.equal(await latestWeight(db, "u"), null);
  db.tables.profiles.push({ id: "u", weight: 81 });
  assert.equal(await latestWeight(db, "u"), 81);
  db.tables.body_metrics.push({ user_id: "u", weight: 79.5, date: "2026-11-10", created_at: "2026-11-10T06:00:00Z" }, { user_id: "u", weight: "78.2", date: "2026-11-15", created_at: "2026-11-15T06:00:00Z" });
  assert.equal(await latestWeight(db, "u"), 78.2);
});

test("pending uploads go up and leave the device; failures stay for a retry", async () => {
  const db = new FakeDb();
  const store = new MemoryRecordingStore(true);
  for (const id of ["a", "b"]) {
    const record = sampleRecord(id);
    await store.saveRecording({ clientId: id, userId: "u", sport: "run", startedAt: record.startedAt, state: "finished", updatedAt: record.endedAt, record });
  }
  await store.saveRecording({ clientId: "active", userId: "u", sport: "walk", startedAt: T0, state: "active", updatedAt: T0 });
  db.failures.activities = { code: "42P01", message: 'relation "public.activities" does not exist' };
  const blocked = await uploadPending(store, db, "u");
  assert.equal(blocked.length, 1, "stops after the first 'unavailable'");
  assert.equal((await store.getRecording("a"))?.uploadAttempts, 1);
  assert.equal((await store.getRecording("a"))?.lastUploadError, "Activity history is not available yet");
  delete db.failures.activities;
  const done = await uploadPending(store, db, "u");
  assert.deepEqual(done.map((o) => o.result.status), ["ok", "ok"]);
  assert.equal(await store.getRecording("a"), null);
  assert.equal(await store.getRecording("b"), null);
  assert.ok(await store.getRecording("active"), "an unfinished recording is never uploaded");
  assert.equal(db.tables.activities.length, 2);
});

test("data the database refuses for good is not retried, and says so", async () => {
  assert.equal(isPermanentRejection({ code: "23514", message: "violates check constraint" }), true);
  assert.equal(isPermanentRejection({ code: "P0001", message: "chunk number outside the activity's chunk_count" }), true);
  // The daily caps pass: the upload is tried again later.
  assert.equal(isPermanentRejection({ code: "54000", message: "activity limit reached: at most 50 activities a day" }), false);
  assert.equal(isPermanentRejection({ code: "42501", message: "permission denied" }), false);
  const db = new FakeDb();
  const store = new MemoryRecordingStore(true);
  const record = sampleRecord("too-long");
  await store.saveRecording({ clientId: "too-long", userId: "u", sport: "run", startedAt: record.startedAt, state: "finished", updatedAt: record.endedAt, record });
  db.failures.activities = { code: "23514", message: 'new row for relation "activities" violates check constraint "activities_elapsed_seconds_check"' };
  const first = await uploadPending(store, db, "u");
  assert.equal(first[0].result.status, "rejected");
  const kept = await store.getRecording("too-long");
  assert.equal(kept?.uploadRejected, true, "kept on the device, marked as refused");
  delete db.failures.activities;
  assert.deepEqual(await uploadPending(store, db, "u"), [], "not retried");
});

test("the saved copy of a device recording can be found and deleted by its device id", async () => {
  const db = new FakeDb();
  await saveActivity(db, "u", sampleRecord("dev-1"));
  await saveActivity(db, "other", sampleRecord("dev-1"));
  assert.equal((await deleteActivityByClientId(db, "u", "dev-1")).status, "ok");
  assert.deepEqual(db.tables.activities.map((row) => row.user_id), ["other"], "only the owner's copy goes");
});

test("before sign-out: tidy, upload, then count and clear what this device still holds", async () => {
  const db = new FakeDb();
  const store = new MemoryRecordingStore(true);
  const record = sampleRecord("done");
  await store.saveRecording({ clientId: "done", userId: "u", sport: "run", startedAt: record.startedAt, state: "finished", updatedAt: record.endedAt, record });
  await store.saveRecording({ clientId: "orphan", userId: "u", sport: "walk", startedAt: T0, state: "active", updatedAt: T0 });
  await store.saveRecording({ clientId: "theirs", userId: "someone-else", sport: "ride", startedAt: T0, state: "active", updatedAt: T0 });
  await store.appendEntries("ghost", [{ seq: 0, entry: { kind: "control", event: { type: "start", t: T0, sport: "run" } } }]);
  const result = await prepareActivitySignOut(store, db, "u");
  assert.equal(result.notUploaded, 0, "uploaded the finished one, removed the never-started one");
  assert.equal(db.tables.activities.length, 1);

  // An upload that can't happen (offline) is counted, so the app can ask before deleting it.
  db.failures.activities = { message: "TypeError: Failed to fetch" };
  const pending = sampleRecord("pending");
  await store.saveRecording({ clientId: "pending", userId: "u", sport: "run", startedAt: pending.startedAt, state: "finished", updatedAt: pending.endedAt, record: pending });
  assert.equal((await prepareActivitySignOut(store, db, "u")).notUploaded, 1);

  await clearActivityDataOnSignOut(store, "u");
  assert.deepEqual(await store.listRecordings("u"), []);
  assert.deepEqual(await store.readEntries("ghost"), [], "log entries without a recording are removed too");
  assert.equal((await store.listRecordings("someone-else")).length, 1, "another account's rows are left alone");
});
