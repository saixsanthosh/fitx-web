// Bug 7: an activity dated after now (a watch or phone whose clock was set wrong) is refused at import, and one
// already saved counts in no weekly, monthly or yearly total until its time comes, so Activity, Progress, Home and
// goals agree on the same week.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recentWeeks, sportSummary, weekBySport, weekDays } from "@/lib/activity/feed";
import { CLOCK_SKEW_MS, startedBy, startsInFuture } from "@/lib/activity/future";
import { destination } from "@/lib/activity/geo";
import { buildImportRecord, checkStartTime } from "@/lib/activity/import/to-record";
import { ImportError, type ImportPoint, type ParsedImport } from "@/lib/activity/import/types";
import type { ActivitySummary } from "@/lib/activity/repository";
import { periodTotals, personalBests } from "@/lib/activity/stats";
import type { Sport } from "@/lib/activity/types";
import { calendarDays, indexDays, periodFor, periodSummary } from "@/components/progress/period";
import { loadActivitiesBetween } from "@/lib/data/activities";
import { loadGoals } from "@/lib/data/goals";
import { localDateKey } from "@/lib/domain/dates";
import { addDays } from "@/lib/domain/day-keys";

// Wednesday 25 Nov 2026, 15:00 local time; the future walk is Friday 27 Nov, 7:30 am (bug 7's file).
const NOW = new Date(2026, 10, 25, 15, 0).getTime();
const FRIDAY = new Date(2026, 10, 27, 7, 30).getTime();
const at = (d: number, h = 7) => new Date(2026, 10, d, h).getTime();

let n = 0;
function row(sport: Sport, startedAt: number, distanceM: number, movingSeconds: number): ActivitySummary {
  n++;
  return { id: `id-${n}`, clientId: `c-${n}`, sport, title: `${sport} ${n}`, startedAt, distanceM, movingSeconds, avgPaceSecondsPerKm: 1000 / (distanceM / movingSeconds), avgSpeedMps: distanceM / movingSeconds, local: false };
}

const past = [row("walk", at(23), 4000, 2400), row("run", at(25, 6), 8670, 2900)];
const future = row("walk", FRIDAY, 829, 600);
const rows = [...past, future];

test("a start counts as now within a few minutes of clock difference; later is the future", () => {
  assert.equal(startsInFuture(NOW + CLOCK_SKEW_MS, NOW), false, "five minutes ahead is clock difference");
  assert.equal(startsInFuture(NOW + CLOCK_SKEW_MS + 1, NOW), true);
  assert.equal(startsInFuture(NOW - 86_400_000, NOW), false);
  assert.equal(startsInFuture(Number.NaN, NOW), false, "an unreadable time is not called the future");
  assert.deepEqual(startedBy(rows, NOW).map((item) => item.id), past.map((item) => item.id));
});

test("Activity: this week, the day bars, the 12 weeks, the month and the year leave the future walk out", () => {
  const totals = periodTotals(rows, NOW);
  assert.deepEqual([totals.week.count, totals.week.distanceM, totals.week.movingSeconds], [2, 12670, 5300]);
  assert.deepEqual([totals.month.count, totals.month.distanceM], [2, 12670]);
  assert.deepEqual([totals.year.count, totals.year.distanceM], [2, 12670]);
  const friday = weekDays(rows, NOW)[4];
  assert.deepEqual([friday.count, friday.distanceM], [0, 0], "no bar on a day that hasn't come");
  assert.equal(recentWeeks(rows, NOW).at(-1)?.distanceM, 12670);
  assert.equal(weekBySport(rows, NOW).walk, 4000, "the Walk card's this week");
});

test("the Walk screen's This week counts walks that happened; all time and bests still list the stored walk", () => {
  const walk = sportSummary(rows, "walk", NOW);
  assert.deepEqual([walk.weekCount, walk.weekDistanceM], [1, 4000]);
  assert.deepEqual([walk.count, walk.distanceM], [2, 4829], "all time is every walk stored");
  assert.ok(personalBests(rows).walk.longest, "bests are not period totals");
});

test("once its day comes, the walk counts like any other", () => {
  const saturday = new Date(2026, 10, 28, 9).getTime();
  assert.equal(periodTotals(rows, saturday).week.distanceM, 13499);
  assert.equal(weekDays(rows, saturday)[4].distanceM, 829);
});

// ------------------------------------------------------------------ import

const ORIGIN = { lat: 12.97634, lng: 77.59287 };
function file(startMs: number, seconds = 600): ParsedImport {
  const points: ImportPoint[] = [];
  for (let s = 0; s <= seconds; s += 1) {
    const p = destination(ORIGIN, 40, s * 1.4);
    points.push({ t: startMs + s * 1000, lat: p.lat, lng: p.lng, alt: null, speed: null, distanceM: null, heartRate: null, acc: null, altAcc: null });
  }
  return { format: "gpx", device: null, sport: { kind: "known", sport: "walk", label: "walking" }, name: null, segments: [points], pauses: [], segmentsArePauses: true, startedAt: startMs, endedAt: startMs + seconds * 1000, totals: null, skippedPoints: 0 };
}

test("import: a file that starts in the future is refused with a plain reason before anything is asked", () => {
  const ahead = file(FRIDAY);
  assert.throws(() => checkStartTime(ahead, NOW), (error: unknown) => {
    assert.ok(error instanceof ImportError);
    assert.equal(error.code, "future-start");
    assert.match(error.message, /^This activity starts in the future: Fri, 27 Nov/);
    assert.match(error.message, /may have had the wrong date or time\.$/);
    return true;
  });
  // Every build refuses it too, so no path can save it.
  assert.throws(() => buildImportRecord(ahead, { sport: "walk", clientId: "c", weightKg: null, importedAt: NOW }), ImportError);
});

test("import: a watch a couple of minutes fast, or a session that just ended, is accepted", () => {
  assert.doesNotThrow(() => checkStartTime(file(NOW + 2 * 60_000), NOW));
  assert.doesNotThrow(() => checkStartTime(file(NOW - 3_600_000), NOW));
  assert.equal(buildImportRecord(file(NOW - 3_600_000), { sport: "walk", clientId: "c", weightKg: null, importedAt: NOW }).record.sport, "walk");
});

// ------------------------------------------------------------------ Home, Progress and goals

type Response = { data?: unknown; error?: unknown };
/** A stand-in for the supabase-js client: every chain answers from `answer` (by table, or "rpc"). */
function stubDb(answer: (name: string) => Response) {
  const from = (name: string) => {
    const builder: Record<string, unknown> = new Proxy({}, {
      get(_target, property) {
        if (property === "then") return (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: null, ...answer(name) }).then(resolve);
        return () => builder;
      },
    });
    return builder;
  };
  return { from, rpc: async (name: string) => ({ data: null, error: null, ...answer(`rpc:${name}`) }) } as unknown as SupabaseClient;
}

const iso = (ms: number) => new Date(ms).toISOString();
const dbRows = [
  { id: "a1", sport: "walk", started_at: iso(at(23)), distance_m: 4000, moving_seconds: 2400 },
  { id: "a2", sport: "run", started_at: iso(at(25, 6)), distance_m: 8670, moving_seconds: 2900 },
  { id: "a3", sport: "walk", started_at: iso(FRIDAY), distance_m: 829, moving_seconds: 600 },
];

test("the shared loader (Home, Progress, goals) leaves out an activity dated after now", async () => {
  const db = stubDb((name) => (name === "activities" ? { data: dbRows } : {}));
  const result = await loadActivitiesBetween(db, "u1", "2026-11-23", "2026-11-29", { now: NOW });
  assert.deepEqual(result.activities.map((activity) => activity.id), ["a1", "a2"]);
  const later = await loadActivitiesBetween(db, "u1", "2026-11-23", "2026-11-29", { now: new Date(2026, 10, 28).getTime() });
  assert.equal(later.activities.length, 3, "on its day it is loaded like the rest");
});

test("Progress's week and Activity's week give the same distance; Friday's ring isn't drawn ahead of time", async () => {
  const db = stubDb((name) => (name === "activities" ? { data: dbRows } : {}));
  const loaded = await loadActivitiesBetween(db, "u1", "2026-11-23", "2026-11-29", { now: NOW });
  const index = indexDays([], loaded.activities);
  const week = periodFor("week", "2026-11-25");
  assert.equal(periodSummary(week, index, new Map(), true).distanceM, periodTotals(rows, NOW).week.distanceM);
  // Even with the future walk in the index (a caller that didn't load through the loader), a day ahead is not trained.
  const withFuture = indexDays([], dbRows.map((item) => ({ startedAt: item.started_at, distanceM: item.distance_m, movingSeconds: item.moving_seconds })));
  const fridayCell = calendarDays(week, withFuture, new Map(), null).find((day) => day?.key === "2026-11-27");
  assert.deepEqual([fridayCell?.future, fridayCell?.active, fridayCell?.activities], [true, false, 0]);
});

test("goals: a weekly distance goal counts the walks that happened, like Activity and Progress", async () => {
  // Relative to the real clock, since the goal loader reads the time itself: one walk this morning, one in two days.
  const today = localDateKey(new Date());
  const real = Date.now();
  const db = stubDb((name) => {
    if (name === "rpc:fitx_goal_progress") {
      return { data: [{ id: "g-km", title: "Cover 15 km a week", category: "fitness", metric: "manual", period: "weekly", direction: "increase", target_value: 15, unit: "km (activities)", starts_on: addDays(today, -10), status: "active", created_at: iso(real - 10 * 86_400_000), current_value: 0, period_start: addDays(today, -3), period_end: addDays(today, 3) }] };
    }
    if (name === "activities") {
      return { data: [
        { id: "now", sport: "walk", started_at: iso(real - 3_600_000), distance_m: 4000, moving_seconds: 2400 },
        { id: "ahead", sport: "walk", started_at: iso(real + 2 * 86_400_000), distance_m: 829, moving_seconds: 600 },
      ] };
    }
    return { data: [] };
  });
  const { goals } = await loadGoals(db, "u1", today, "Asia/Kolkata");
  assert.equal(goals[0].currentValue, 4, "4 km, not 4.83 km");
});
