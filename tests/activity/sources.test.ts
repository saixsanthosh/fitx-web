import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ActivityEngine } from "@/lib/activity/engine";
import { buildImportRecord } from "@/lib/activity/import/to-record";
import type { ParsedImport } from "@/lib/activity/import/types";
import { buildActivityRecord } from "@/lib/activity/record";
import {
  activitySourcesReady, findActivitiesBetween, findActivitiesByClientIds, getActivity, listActivities, listActivitySummaries, rowFromRecord, saveActivity,
  sourceFromRow, viewFromRecord,
} from "@/lib/activity/repository";
import { kcalFromDevice, sourceLabel, sourceSentence } from "@/lib/activity/source";
import type { LogEntry } from "@/lib/activity/types";
import { FakeDb } from "./support/fake-db";
import { ORIGIN, T0, gps, legs, moveAlong, recording } from "./support/tracks";

function phoneRecord(clientId: string, startMs = T0) {
  const device = gps({ sigmaM: 3, accuracyM: 5, speedSigma: 0.2 }, 90);
  const run = moveAlong(legs(ORIGIN, [[0, 1500]]), { speedMps: 3, startMs, device });
  const log: LogEntry[] = recording("run", run.fixes);
  return buildActivityRecord(ActivityEngine.replay(log), { clientId, title: "Morning run", weightKg: 70, log });
}

function importedRecord(clientId: string) {
  const device = gps({ sigmaM: 1, accuracyM: 5 }, 7);
  const run = moveAlong(legs(ORIGIN, [[90, 1200]]), { speedMps: 3, startMs: T0, device });
  const file: ParsedImport = {
    format: "fit", device: "Garmin Forerunner 255", sport: { kind: "known", sport: "run", label: "Running" },
    name: null, segments: [run.fixes.map((fix) => ({ t: fix.t, lat: fix.lat, lng: fix.lng, alt: null, speed: null, distanceM: null, heartRate: null, acc: null, altAcc: null }))],
    pauses: [], segmentsArePauses: false, startedAt: run.fixes[0].t, endedAt: run.fixes[run.fixes.length - 1].t, totals: null, skippedPoints: 0,
  };
  return buildImportRecord(file, { sport: "run", clientId, weightKg: null, importedAt: T0 + 86_400_000 }).record;
}

test("phone recordings never send the source columns; imports send all four", () => {
  const phone = rowFromRecord(phoneRecord("p-1"), "u");
  for (const column of ["source", "source_format", "source_device", "imported_at"]) assert.equal(column in phone, false, column);
  const imported = rowFromRecord(importedRecord("i-1"), "u");
  assert.equal(imported.source, "file");
  assert.equal(imported.source_format, "fit");
  assert.equal(imported.source_device, "Garmin Forerunner 255");
  assert.equal(imported.imported_at, new Date(T0 + 86_400_000).toISOString());
});

test("rows read before the migration (no source columns) are FITX recordings", () => {
  assert.deepEqual(sourceFromRow({}), { source: "fitx_gps", sourceFormat: null, sourceDevice: null, importedAt: null });
  assert.deepEqual(sourceFromRow({ source: "file", source_format: "gpx", source_device: " Apple Health Export ", imported_at: "2026-11-18T09:00:00Z" }), {
    source: "file", sourceFormat: "gpx", sourceDevice: "Apple Health Export", importedAt: Date.UTC(2026, 10, 18, 9),
  });
  assert.equal(sourceFromRow({ source: "something-else", source_format: "kml" }).source, "fitx_gps");
  const view = viewFromRecord(importedRecord("i-2"));
  assert.deepEqual([view.source, view.sourceFormat, view.sourceDevice], ["file", "fit", "Garmin Forerunner 255"]);
  assert.equal(viewFromRecord(phoneRecord("p-2")).source, "fitx_gps", "a device copy from before this change has no source: a FITX recording");
});

test("before the migration, history still loads (the read is retried without the new columns) and later reads skip them", async () => {
  const db = new FakeDb();
  db.missingColumns.activities = ["source", "source_format", "source_device", "imported_at"];
  assert.equal((await saveActivity(db, "u", phoneRecord("p-3"))).status, "ok", "phone uploads keep working");
  const list = await listActivities(db, "u");
  assert.equal(list.status, "ok");
  assert.equal(list.status === "ok" && list.data[0].source, "fitx_gps");
  const before = db.calls.length;
  const again = await listActivities(db, "u");
  assert.equal(again.status, "ok");
  assert.equal(db.calls.length - before, 1, "the second read goes straight to the old columns");
  const id = db.tables.activities[0].id as string;
  const detail = await getActivity(db, "u", id);
  assert.equal(detail.status === "ok" && detail.data?.clientId, "p-3");
  // Imports need the migration: saving one before it says "unavailable", nothing half-saved.
  assert.deepEqual(await saveActivity(db, "u", importedRecord("i-3")), { status: "unavailable" });
  assert.equal(db.tables.activities.length, 1);
});

test("the import page checks for the migration first", async () => {
  const db = new FakeDb();
  assert.deepEqual(await activitySourcesReady(db, "u"), { status: "ok", data: true });
  const old = new FakeDb();
  old.missingColumns.activities = ["source"];
  assert.deepEqual(await activitySourcesReady(old, "u"), { status: "ok", data: false });
  const none = new FakeDb();
  none.failures.activities = { code: "PGRST205", message: "Could not find the table 'public.activities' in the schema cache" };
  assert.deepEqual(await activitySourcesReady(none, "u"), { status: "unavailable" });
  const offline = new FakeDb();
  offline.failures.activities = { message: "TypeError: Failed to fetch" };
  assert.equal((await activitySourcesReady(offline, "u")).status, "error");
});

test("importing the same session again finds the saved row: one activity, same id", async () => {
  const db = new FakeDb();
  const first = await saveActivity(db, "u", importedRecord("6f1c6b1e-0d55-4b1c-9d59-1d2f3c4b5a69"));
  const second = await saveActivity(db, "u", importedRecord("6f1c6b1e-0d55-4b1c-9d59-1d2f3c4b5a69"));
  assert.equal(first.status === "ok" && second.status === "ok" && first.data.id === second.data.id, true);
  assert.equal(db.tables.activities.length, 1);
  assert.equal(db.tables.activities[0].source, "file");
  const found = await findActivitiesByClientIds(db, "u", ["6f1c6b1e-0d55-4b1c-9d59-1d2f3c4b5a69", "nope"]);
  assert.equal(found.status === "ok" && found.data.length, 1);
  assert.equal(found.status === "ok" && found.data[0].sourceDevice, "Garmin Forerunner 255");
  assert.deepEqual(await findActivitiesByClientIds(db, "u", []), { status: "ok", data: [] });
  assert.equal((await findActivitiesByClientIds(db, "someone-else", ["6f1c6b1e-0d55-4b1c-9d59-1d2f3c4b5a69"])).status === "ok", true);
});

test("activities around a time window are found for the overlap check (owner only)", async () => {
  const db = new FakeDb();
  await saveActivity(db, "u", phoneRecord("p-a", T0));
  await saveActivity(db, "u", phoneRecord("p-b", T0 + 86_400_000));
  await saveActivity(db, "other", phoneRecord("p-c", T0));
  const around = await findActivitiesBetween(db, "u", T0 + 60_000, T0 + 120_000);
  assert.equal(around.status === "ok" && around.data.map((a) => a.clientId).join(), "p-a");
  const none = await findActivitiesBetween(db, "u", T0 - 7200_000, T0 - 3600_000);
  assert.equal(none.status === "ok" && none.data.length, 0);
});

test("statistics read every activity in pages, newest first", async () => {
  const db = new FakeDb();
  for (let i = 0; i < 3; i++) await saveActivity(db, "u", phoneRecord(`s-${i}`, T0 + i * 86_400_000));
  const summaries = await listActivitySummaries(db, "u");
  assert.equal(summaries.status, "ok");
  if (summaries.status !== "ok") return;
  assert.equal(summaries.data.complete, true);
  assert.deepEqual(summaries.data.rows.map((row) => row.clientId), ["s-2", "s-1", "s-0"]);
  assert.ok(summaries.data.rows.every((row) => row.distanceM > 1000 && row.avgPaceSecondsPerKm !== null && !row.local));
  assert.ok(db.calls.some((call) => call.startsWith("select:activities:id,client_id,sport,title,started_at")));
});

test("source labels say where the data came from, and calories say who estimated them", () => {
  assert.equal(sourceLabel({ source: "fitx_gps", sourceFormat: null, sourceDevice: null }), "Recorded with FITX");
  assert.equal(sourceLabel({ source: "file", sourceFormat: "fit", sourceDevice: "Garmin Forerunner 255" }), "Imported · Garmin Forerunner 255 · FIT");
  assert.equal(sourceLabel({ source: "file", sourceFormat: "gpx", sourceDevice: null }), "Imported · GPX file");
  assert.match(sourceSentence({ source: "file", sourceFormat: "tcx", sourceDevice: "Forerunner 255" }), /^Imported from a TCX file from Forerunner 255\./);
  assert.match(sourceSentence({ source: "fitx_gps", sourceFormat: null, sourceDevice: null }), /phone’s GPS/);
  assert.equal(kcalFromDevice({ source: "file", kcalMethod: "Estimated by Garmin Forerunner 255, from the imported FIT file." }), true);
  assert.equal(kcalFromDevice({ source: "file", kcalMethod: "MET for your speed…" }), false);
  assert.equal(kcalFromDevice({ source: "fitx_gps", kcalMethod: "Estimated by something" }), false);
});

const MIGRATION = readFileSync(path.resolve(process.cwd(), "supabase/migrations/20261119100000_fitx_activity_sources.sql"), "utf8").replace(/--.*$/gm, "");

test("the sources migration is additive, re-runnable and matches the app's values", () => {
  assert.match(MIGRATION, /add column if not exists source text not null default 'fitx_gps'/);
  assert.match(MIGRATION, /add column if not exists source_format text,/);
  assert.match(MIGRATION, /add column if not exists source_device text,/);
  assert.match(MIGRATION, /add column if not exists imported_at timestamptz;/);
  assert.match(MIGRATION, /check \(source in \('fitx_gps', 'file'\)\)/);
  assert.match(MIGRATION, /check \(source_format in \('gpx', 'tcx', 'fit'\)\)/);
  assert.match(MIGRATION, /check \(char_length\(source_device\) <= 120\)/);
  // Every constraint is added only when missing, so running the file twice is safe.
  assert.equal((MIGRATION.match(/add constraint/g) ?? []).length, 3);
  assert.equal((MIGRATION.match(/if not exists \(select 1 from pg_constraint where conname = /g) ?? []).length, 3);
  assert.doesNotMatch(MIGRATION, /\bdrop\b|\btruncate\b|\bgrant\b|\brevoke\b|create policy|security definer/i);
});
