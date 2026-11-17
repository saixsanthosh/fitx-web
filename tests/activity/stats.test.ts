import { test } from "node:test";
import assert from "node:assert/strict";
import type { ActivitySummary, ActivityView } from "@/lib/activity/repository";
import { BEST_MIN_DISTANCE_M, mergeSummaries, periods, periodTotals, personalBests, sportsWithBests, weekChange } from "@/lib/activity/stats";
import { listStrengthSessions, sessionFromRow, strengthTotals, type StrengthSession } from "@/lib/activity/strength";
import { mergeTimeline, nextToLoad, timelineBoundary } from "@/lib/activity/timeline";
import type { Sport } from "@/lib/activity/types";
import { FakeDb } from "./support/fake-db";

// Wednesday 18 Nov 2026, 15:00 local time.
const NOW = new Date(2026, 10, 18, 15, 0).getTime();
const at = (y: number, m: number, d: number, h = 7) => new Date(y, m, d, h).getTime();

let n = 0;
function row(sport: Sport, startedAt: number, distanceM: number, movingSeconds: number, extra: Partial<ActivitySummary> = {}): ActivitySummary {
  n++;
  const speed = movingSeconds > 0 ? distanceM / movingSeconds : null;
  return {
    id: `id-${n}`, clientId: `c-${n}`, sport, title: `${sport} ${n}`, startedAt, distanceM, movingSeconds,
    avgPaceSecondsPerKm: speed && distanceM >= 10 ? 1000 / speed : null, avgSpeedMps: speed, local: false, ...extra,
  };
}

test("periods follow the viewer's calendar: Monday weeks, calendar month and year", () => {
  const p = periods(NOW);
  assert.equal(p.week.start, new Date(2026, 10, 16).getTime());
  assert.equal(p.week.end, new Date(2026, 10, 23).getTime());
  assert.equal(p.lastWeek.start, new Date(2026, 10, 9).getTime());
  assert.equal(p.lastWeek.end, p.week.start);
  assert.equal(p.month.start, new Date(2026, 10, 1).getTime());
  assert.equal(p.month.end, new Date(2026, 11, 1).getTime());
  assert.equal(p.year.start, new Date(2026, 0, 1).getTime());
  assert.equal(p.year.end, new Date(2027, 0, 1).getTime());
});

test("totals count each activity once, in the period it started", () => {
  const rows = [
    row("run", at(2026, 10, 17), 5000, 1500),
    row("walk", at(2026, 10, 16, 0), 2000, 1400),
    row("ride", at(2026, 10, 10), 20000, 3600),
    row("run", at(2026, 10, 2), 10000, 3000),
    row("run", at(2026, 2, 5), 8000, 2500),
    row("run", at(2025, 11, 31), 3000, 1000),
  ];
  const t = periodTotals(rows, NOW);
  assert.deepEqual([t.week.count, t.week.distanceM, t.week.movingSeconds], [2, 7000, 2900]);
  assert.deepEqual([t.lastWeek.count, t.lastWeek.distanceM], [1, 20000]);
  assert.deepEqual([t.month.count, t.month.distanceM], [4, 37000]);
  assert.deepEqual([t.year.count, t.year.distanceM], [5, 45000]);
  assert.equal(t.week.bySport.run.distanceM, 5000);
  assert.equal(t.year.bySport.ride.count, 1);
  const change = weekChange(t.week, t.lastWeek);
  assert.deepEqual(change, { distanceM: -13000, count: 1, direction: "down" });
  assert.equal(weekChange(t.week, t.week).direction, "same");
});

test("personal bests are real activities: longest, and fastest average only from 1 km up", () => {
  const sprint = row("run", at(2026, 10, 1), 400, 60);
  const tempo = row("run", at(2026, 10, 2), 5000, 1250);
  const tie = row("run", at(2026, 10, 3), 5000, 1250);
  const long = row("run", at(2026, 10, 4), 21100, 7200);
  const ride = row("ride", at(2026, 10, 5), 40000, 4800);
  const fastRide = row("ride", at(2026, 10, 6), 20000, 2000);
  const shortRide = row("ride", at(2026, 10, 7), 900, 60);
  const bests = personalBests([long, tie, tempo, sprint, ride, fastRide, shortRide]);
  assert.equal(bests.run.longest?.activity.id, long.id);
  assert.equal(bests.run.fastest?.activity.id, tempo.id, "a sprint under 1 km is not a best; the earlier of two equal runs keeps it");
  assert.equal(bests.run.fastest?.value, 250);
  assert.equal(bests.ride.longest?.activity.id, ride.id);
  assert.equal(bests.ride.fastest?.activity.id, fastRide.id, "rides use average speed");
  assert.equal(bests.walk.longest, null);
  assert.deepEqual(sportsWithBests(bests), ["run", "ride"]);
  assert.equal(BEST_MIN_DISTANCE_M, 1000);
  // No moving time, no pace: never a best.
  assert.equal(personalBests([row("walk", at(2026, 10, 1), 3000, 0)]).walk.fastest, null);
});

test("device-only activities join the statistics once", () => {
  const saved = [row("run", NOW, 5000, 1500, { clientId: "same" })];
  const device = [row("run", NOW, 5000, 1500, { clientId: "same", local: true }), row("walk", NOW, 1000, 700, { clientId: "only-here", local: true })];
  assert.deepEqual(mergeSummaries(saved, device).map((r) => r.clientId), ["same", "only-here"]);
});

const view = (startedAt: number, extra: Partial<ActivityView> = {}): ActivityView => ({
  id: `a-${startedAt}`, clientId: `c-${startedAt}`, sport: "run", title: "Run", startedAt, endedAt: startedAt + 1000, elapsedSeconds: 1, movingSeconds: 1, pausedSeconds: 0,
  distanceM: 10, avgSpeedMps: null, maxSpeedMps: null, avgPaceSecondsPerKm: null, elevationGainM: null, kcal: null, kcalMethod: null, weightKg: null, gapCount: 0, gapSeconds: 0,
  splits: [], gaps: [], timeline: [], routePolyline: "", sharePolyline: "", shareBbox: null, pointCount: 0, chunkCount: 0, local: false,
  source: "fitx_gps", sourceFormat: null, sourceDevice: null, importedAt: null, ...extra,
});
const session = (startedAt: number): StrengthSession => ({ id: `s-${startedAt}`, name: "Push day", startedAt, completedAt: startedAt + 3600_000, trainingSeconds: 3000, volumeKg: 4200 });

test("the timeline mixes activities and strength sessions, newest first, without skipping any", () => {
  const activities = { items: [view(100), view(80), view(60)], more: true };
  const sessions = { items: [session(90), session(50)], more: true };
  // Both lists have more pages: nothing older than the newer of the two oldest-loaded entries is shown yet.
  assert.equal(timelineBoundary(activities, sessions), 60);
  const merged = mergeTimeline(activities, sessions);
  assert.deepEqual(merged.entries.map((e) => `${e.kind}:${e.startedAt}`), ["activity:100", "strength:90", "activity:80", "activity:60"]);
  assert.equal(merged.more, true);
  assert.equal(nextToLoad(activities, sessions), "activities");
  // Once the activities are complete, the session list decides.
  const done = mergeTimeline({ items: activities.items, more: false }, sessions);
  assert.deepEqual(done.entries.map((e) => e.startedAt), [100, 90, 80, 60, 50]);
  assert.equal(nextToLoad({ items: activities.items, more: false }, sessions), "sessions");
  assert.equal(nextToLoad({ items: [], more: false }, { items: [], more: false }), null);
  // Activities kept only on this device are all known: they never hold older entries back.
  const local = view(10, { local: true, id: null, clientId: "dev" });
  const withLocal = mergeTimeline({ items: [view(100)], more: false }, { items: [], more: false }, [local]);
  assert.deepEqual(withLocal.entries.map((e) => e.key), ["activity-a-100", "local-dev"]);
  const held = mergeTimeline({ items: [view(100)], more: true }, { items: [], more: false }, [local]);
  assert.deepEqual(held.entries.map((e) => e.startedAt), [100], "an older device copy waits for the older page");
});

test("strength sessions: completed only, honest numbers, own totals", async () => {
  assert.deepEqual(sessionFromRow({ id: "s1", name: " Legs ", started_at: "2026-11-18T01:00:00Z", completed_at: "2026-11-18T02:00:00Z", duration_seconds: 3000, total_volume: "5250.50" }), {
    id: "s1", name: "Legs", startedAt: Date.UTC(2026, 10, 18, 1), completedAt: Date.UTC(2026, 10, 18, 2), trainingSeconds: 3000, volumeKg: 5250.5,
  });
  assert.equal(sessionFromRow({ id: "s2", name: "", started_at: "2026-11-18T01:00:00Z", duration_seconds: 900, total_volume: 0 })?.volumeKg, null, "no lifts logged: no volume, not 0 kg");
  assert.equal(sessionFromRow({ id: "s2", started_at: "x" }), null);
  assert.deepEqual(strengthTotals([session(10), session(20), session(30)], 15, 31), { count: 2, trainingSeconds: 6000 });

  const db = new FakeDb();
  db.tables.workout_sessions.push(
    { id: "a", user_id: "u", name: "Push", status: "completed", started_at: "2026-11-17T01:00:00Z", duration_seconds: 2400, total_volume: 3000 },
    { id: "b", user_id: "u", name: "Pull", status: "abandoned", started_at: "2026-11-16T01:00:00Z", duration_seconds: 600, total_volume: 200 },
    { id: "c", user_id: "u", name: "Legs", status: "in_progress", started_at: "2026-11-18T01:00:00Z", duration_seconds: 0, total_volume: 0 },
    { id: "d", user_id: "other", name: "Theirs", status: "completed", started_at: "2026-11-17T02:00:00Z", duration_seconds: 100, total_volume: 0 },
  );
  const list = await listStrengthSessions(db, "u");
  assert.equal(list.status === "ok" && list.data.map((s) => s.id).join(), "a", "abandoned and unfinished sessions are left out");
  const missing = new FakeDb();
  missing.failures.workout_sessions = { code: "42P01", message: 'relation "public.workout_sessions" does not exist' };
  assert.deepEqual(await listStrengthSessions(missing, "u"), { status: "unavailable" });
});
