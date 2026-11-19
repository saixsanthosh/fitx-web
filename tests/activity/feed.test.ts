import { test } from "node:test";
import assert from "node:assert/strict";
import { barScale, matchesFilter, parseSportFilter, recentWeeks, sportSummary, weekBySport, weekDays } from "@/lib/activity/feed";
import type { ActivitySummary } from "@/lib/activity/repository";
import type { Sport } from "@/lib/activity/types";

// Wednesday 18 Nov 2026, 15:00 local time.
const NOW = new Date(2026, 10, 18, 15, 0).getTime();
const at = (y: number, m: number, d: number, h = 7) => new Date(y, m, d, h).getTime();

let n = 0;
function row(sport: Sport, startedAt: number, distanceM: number, movingSeconds: number): ActivitySummary {
  n++;
  const speed = movingSeconds > 0 ? distanceM / movingSeconds : null;
  return {
    id: `id-${n}`, clientId: `c-${n}`, sport, title: `${sport} ${n}`, startedAt, distanceM, movingSeconds,
    avgPaceSecondsPerKm: speed && distanceM >= 10 ? 1000 / speed : null, avgSpeedMps: speed, local: false,
  };
}

test("the sport filter accepts the three sports and treats anything else as all", () => {
  assert.equal(parseSportFilter("run"), "run");
  assert.equal(parseSportFilter(["ride", "walk"]), "ride");
  for (const value of [undefined, "", "swim", "RUN", 3, null]) assert.equal(parseSportFilter(value), "all");
  assert.equal(matchesFilter({ sport: "walk" }, "all"), true);
  assert.equal(matchesFilter({ sport: "walk" }, "run"), false);
});

test("this week's days run Monday to Sunday and add up each day's activities by sport", () => {
  const rows = [
    row("run", at(2026, 10, 16, 0), 5000, 1500), // Monday, just after midnight
    row("walk", at(2026, 10, 18, 9), 2000, 1400),
    row("ride", at(2026, 10, 18, 18), 12000, 2400),
    row("run", at(2026, 10, 22, 23), 3000, 900), // Sunday night
    row("run", at(2026, 10, 15, 23), 9000, 2700), // last week's Sunday: left out
    row("run", at(2026, 10, 23, 0), 9000, 2700), // next Monday: left out
  ];
  const days = weekDays(rows, NOW);
  assert.equal(days.length, 7);
  assert.equal(days[0].dayStart, new Date(2026, 10, 16).getTime());
  assert.equal(days[6].dayStart, new Date(2026, 10, 22).getTime());
  assert.deepEqual(days.map((day) => day.distanceM), [5000, 0, 14000, 0, 0, 0, 3000]);
  assert.deepEqual(days[2].bySport, { walk: 2000, run: 0, ride: 12000 });
  assert.equal(days[2].count, 2);
  assert.deepEqual(weekDays(rows, NOW, "ride").map((day) => day.distanceM), [0, 0, 12000, 0, 0, 0, 0]);
});

test("recent weeks are oldest first, end with this week, and only count real activities", () => {
  const rows = [
    row("run", at(2026, 10, 17), 5000, 1500),
    row("walk", at(2026, 10, 10), 2000, 1400),
    row("ride", at(2026, 7, 3), 40000, 7200), // more than 12 weeks ago
  ];
  const weeks = recentWeeks(rows, NOW, 12);
  assert.equal(weeks.length, 12);
  assert.equal(weeks[11].weekStart, new Date(2026, 10, 16).getTime());
  assert.equal(weeks[10].weekStart, new Date(2026, 10, 9).getTime());
  assert.equal(weeks[11].distanceM, 5000);
  assert.equal(weeks[10].distanceM, 2000);
  assert.equal(weeks.reduce((sum, week) => sum + week.count, 0), 2);
  assert.equal(recentWeeks(rows, NOW, 12, "run").reduce((sum, week) => sum + week.distanceM, 0), 5000);
});

test("bar heights scale to the largest value and an empty chart stays empty", () => {
  assert.deepEqual(barScale([0, 500, 1000]), [0, 0.5, 1]);
  assert.deepEqual(barScale([0, 0, 0]), [0, 0, 0]);
  assert.deepEqual(barScale([]), []);
});

test("a sport's summary uses only that sport: totals, this week, averages over moving time and bests", () => {
  const rows = [
    row("run", at(2026, 10, 17), 5000, 1500),
    row("run", at(2026, 10, 2), 10000, 3300),
    row("walk", at(2026, 10, 17), 3000, 2000),
  ];
  const run = sportSummary(rows, "run", NOW);
  assert.equal(run.count, 2);
  assert.equal(run.distanceM, 15000);
  assert.equal(run.movingSeconds, 4800);
  assert.equal(run.weekDistanceM, 5000);
  assert.equal(run.weekCount, 1);
  assert.ok(Math.abs((run.avgPaceSecondsPerKm ?? 0) - 320) < 1e-9, "4800 s over 15 km is 5:20 /km");
  assert.equal(run.bests.longest?.value, 10000);
  assert.equal(run.bests.fastest?.value, 300);
});

test("a sport with nothing recorded has zero distance but no average (shown as a dash, never 0)", () => {
  const ride = sportSummary([row("run", at(2026, 10, 17), 5000, 1500)], "ride", NOW);
  assert.equal(ride.count, 0);
  assert.equal(ride.distanceM, 0);
  assert.equal(ride.avgSpeedMps, null);
  assert.equal(ride.avgPaceSecondsPerKm, null);
  assert.equal(ride.bests.longest, null);
  // Activities without moving time add distance but never a made-up average.
  const untimed = sportSummary([row("walk", at(2026, 10, 17), 800, 0)], "walk", NOW);
  assert.equal(untimed.distanceM, 800);
  assert.equal(untimed.avgSpeedMps, null);
});

test("the sport launchers show this week's distance per sport", () => {
  const rows = [row("run", at(2026, 10, 17), 5000, 1500), row("run", at(2026, 10, 18), 2000, 600), row("ride", at(2026, 10, 10), 20000, 3600)];
  assert.deepEqual(weekBySport(rows, NOW), { walk: 0, run: 7000, ride: 0 });
});
