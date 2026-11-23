// Best efforts: the fastest elapsed time per benchmark distance inside an activity, how they are stored, ranked
// across activities, and how saving falls back before migration 20261123100050.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bestEfforts, effortDistances, effortName, effortRank, effortsFromJson, effortsToJson, effortTable, topEfforts } from "@/lib/activity/best-efforts";
import { ActivityEngine } from "@/lib/activity/engine";
import { buildActivityRecord } from "@/lib/activity/record";
import { activityV2Ready, listBestEfforts, saveActivity, saveBestEfforts } from "@/lib/activity/repository";
import type { LogEntry, RoutePoint } from "@/lib/activity/types";
import { FakeDb } from "./support/fake-db";
import { ORIGIN, T0, gps, legs, moveAlong, recording } from "./support/tracks";

/** A straight route: one point a second at the given speeds (m/s) per second. */
function route(speeds: number[], start = T0): RoutePoint[] {
  const points: RoutePoint[] = [{ t: start, lat: 0, lng: 0, d: 0 }];
  let d = 0;
  speeds.forEach((speed, index) => {
    d += speed;
    points.push({ t: start + (index + 1) * 1000, lat: 0, lng: 0, d });
  });
  return points;
}

test("the fastest stretch is found anywhere in the activity, with elapsed time", () => {
  // 600 s at 3 m/s (1,800 m), then 250 s at 5 m/s (1,250 m), then 300 s at 3 m/s.
  const speeds = [...Array(600).fill(3), ...Array(250).fill(5), ...Array(300).fill(3)];
  const efforts = bestEfforts([route(speeds)], "run");
  const km = efforts.find((effort) => effort.d === 1000);
  assert.equal(km?.s, 200, "1 km inside the fast part takes 200 s");
  assert.ok(km && km.startM >= 1800 && km.startM <= 2050);
  const fourHundred = efforts.find((effort) => effort.d === 400);
  assert.equal(fourHundred?.s, 80);
  assert.equal(efforts.find((effort) => effort.d === 5000), undefined, "a distance not covered has no effort");
});

test("a pause inside the stretch counts, like a race clock", () => {
  const first = route(Array(200).fill(5));
  const last = first[first.length - 1];
  // 2 minutes paused, then another 1,000 m at 5 m/s.
  const second = route(Array(200).fill(5), last.t + 120_000).map((point) => ({ ...point, d: point.d + last.d }));
  const efforts = bestEfforts([first, second.slice(1)], "run");
  assert.equal(efforts.find((effort) => effort.d === 1000)?.s, 200, "the 1 km inside one stretch");
  assert.equal(efforts.find((effort) => effort.d === 1609.344)?.s, Math.round(1609.344 / 5 + 120), "the mile spans the pause and includes it");
});

test("each sport has its benchmarks, and impossible speeds are dropped", () => {
  assert.deepEqual(effortDistances("ride"), [5000, 10_000, 20_000, 40_000, 100_000]);
  assert.equal(effortDistances("trail_run"), effortDistances("run"));
  assert.ok(!effortDistances("hike").includes(400));
  assert.equal(effortName(21_097.5), "Half marathon");
  assert.equal(effortName(1609.344), "1 mile");
  // 1 km in 20 s on foot is a GPS error, not an effort.
  assert.deepEqual(bestEfforts([route(Array(30).fill(50))], "run"), []);
  assert.deepEqual(bestEfforts([], "walk"), []);
});

test("efforts round-trip through the stored JSON, and malformed entries are left out", () => {
  const efforts = [{ d: 1000, s: 240, startM: 120 }];
  assert.deepEqual(effortsFromJson(effortsToJson(efforts)), efforts);
  assert.deepEqual(effortsFromJson([{ d: 1000, s: "fast" }, null, { d: 5000, s: 1300 }]), [{ d: 5000, s: 1300, startM: 0 }]);
  assert.equal(effortsFromJson({ d: 1 }), null);
});

test("top three per distance across activities: runs and trail runs share a table, ties go to the earlier one", () => {
  const rows = [
    { id: "a", sport: "run" as const, startedAt: 1, efforts: [{ d: 1000, s: 250, startM: 0 }] },
    { id: "b", sport: "trail_run" as const, startedAt: 2, efforts: [{ d: 1000, s: 240, startM: 0 }] },
    { id: "c", sport: "run" as const, startedAt: 3, efforts: [{ d: 1000, s: 250, startM: 0 }, { d: 5000, s: 1400, startM: 0 }] },
    { id: "d", sport: "run" as const, startedAt: 4, efforts: [{ d: 1000, s: 300, startM: 0 }] },
    { id: "e", sport: "ride" as const, startedAt: 5, efforts: [{ d: 5000, s: 600, startM: 0 }] },
  ];
  const top = topEfforts(rows, "run");
  assert.deepEqual(top.get(1000)?.map((effort) => effort.activityId), ["b", "a", "c"]);
  assert.deepEqual([...top.keys()], [1000, 5000]);
  assert.equal(effortRank(top, "b", 1000), 1);
  assert.equal(effortRank(top, "c", 1000), 3);
  assert.equal(effortRank(top, "d", 1000), null);
  assert.equal(effortTable("hike"), "walk");
  assert.equal(effortTable("ebike"), "ebike");
});

function sampleRecord(clientId: string) {
  const device = gps({ sigmaM: 3, accuracyM: 5, speedSigma: 0.2 }, 90);
  const run = moveAlong(legs(ORIGIN, [[0, 2500]]), { speedMps: 3, startMs: T0, device });
  const log: LogEntry[] = recording("run", run.fixes);
  return buildActivityRecord(ActivityEngine.replay(log), { clientId, title: "Morning run", weightKg: 70, log });
}

test("a finished recording carries its best efforts, and they are saved with the activity", async () => {
  const record = sampleRecord("be-1");
  const km = record.bestEfforts?.find((effort) => effort.d === 1000);
  assert.ok(km && km.s > 300 && km.s < 370, `about 333 s at 3 m/s, got ${km?.s}`);
  const db = new FakeDb();
  const saved = await saveActivity(db, "user-1", record);
  assert.equal(saved.status, "ok");
  assert.ok(Array.isArray(db.tables.activities[0].best_efforts));
  assert.equal(await activityV2Ready(db, "user-1"), true);
  const listed = await listBestEfforts(db, "user-1");
  assert.equal(listed.status, "ok");
  assert.equal(listed.status === "ok" && listed.data[0].efforts.length, record.bestEfforts?.length);
});

test("before the migration the activity still saves, without best efforts, and v2 counts as not ready", async () => {
  const db = new FakeDb();
  db.missingColumns.activities = ["best_efforts"];
  const saved = await saveActivity(db, "user-1", sampleRecord("be-2"));
  assert.equal(saved.status, "ok");
  assert.equal("best_efforts" in db.tables.activities[0], false);
  assert.equal(await activityV2Ready(db, "user-1"), false);
  assert.equal((await listBestEfforts(db, "user-1")).status, "unavailable");
});

test("efforts worked out later fill only an activity that has none", async () => {
  const db = new FakeDb();
  db.tables.activities.push({ id: "x", user_id: "user-1", sport: "run", started_at: new Date(T0).toISOString(), best_efforts: null });
  db.tables.activities.push({ id: "y", user_id: "user-1", sport: "run", started_at: new Date(T0).toISOString(), best_efforts: [{ d: 1000, s: 200, start_m: 0 }] });
  await saveBestEfforts(db, "user-1", "x", [{ d: 1000, s: 260, startM: 5 }]);
  await saveBestEfforts(db, "user-1", "y", [{ d: 1000, s: 999, startM: 5 }]);
  assert.deepEqual(db.tables.activities[0].best_efforts, [{ d: 1000, s: 260, start_m: 5 }]);
  assert.deepEqual(db.tables.activities[1].best_efforts, [{ d: 1000, s: 200, start_m: 0 }], "never overwritten");
});
