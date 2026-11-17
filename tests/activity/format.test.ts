import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanTitle, defaultTitle, formatDistance, formatDuration, formatDurationWords, formatPace, formatSpeed, kmValue, paceValue, speedValue } from "@/lib/activity/format";
import { cardStats, fitRoute } from "@/lib/activity/share-card";
import { groupByWeek, startOfWeek, weekLabel } from "@/lib/activity/weeks";
import { ORIGIN, legs } from "./support/tracks";

test("distance, time, pace and speed formats", () => {
  assert.equal(kmValue(5234.6), "5.23");
  assert.equal(kmValue(-3), "0.00");
  assert.equal(formatDistance(850.4), "850 m");
  assert.equal(formatDistance(12345), "12.35 km");
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(65), "1:05");
  assert.equal(formatDuration(3661), "1:01:01");
  assert.equal(formatDurationWords(250), "4 min");
  assert.equal(formatDurationWords(3900), "1 h 05 min");
  assert.equal(paceValue(332.6), "5:33");
  assert.equal(paceValue(null), "–");
  assert.equal(paceValue(4000), "–");
  assert.equal(formatPace(299.5), "5:00 /km");
  assert.equal(speedValue(6.9444), "25.0");
  assert.equal(formatSpeed(null), "–");
});

test("default titles follow the local time of day", () => {
  assert.equal(defaultTitle("run", new Date(2026, 10, 16, 6, 30)), "Morning run");
  assert.equal(defaultTitle("ride", new Date(2026, 10, 16, 13, 0)), "Afternoon ride");
  assert.equal(defaultTitle("walk", new Date(2026, 10, 16, 19, 0)), "Evening walk");
  assert.equal(defaultTitle("walk", new Date(2026, 10, 16, 23, 30)), "Night walk");
  assert.equal(cleanTitle("   Long   run  ", "x"), "Long run");
  assert.equal(cleanTitle("   ", "Morning run"), "Morning run");
  assert.equal(cleanTitle("a".repeat(120), "x").length, 80);
});

test("weeks start on Monday and are labelled for people", () => {
  const wednesday = new Date(2026, 10, 18, 15, 0).getTime();
  const monday = new Date(2026, 10, 16, 0, 0).getTime();
  assert.equal(startOfWeek(wednesday), monday);
  assert.equal(startOfWeek(monday), monday);
  assert.equal(startOfWeek(new Date(2026, 10, 22, 23, 59).getTime()), monday, "Sunday belongs to the same week");
  assert.equal(weekLabel(monday, wednesday), "This week");
  assert.equal(weekLabel(new Date(2026, 10, 9).getTime(), wednesday), "Last week");
  assert.equal(weekLabel(new Date(2026, 10, 2).getTime(), wednesday), "2–8 Nov");
  assert.equal(weekLabel(new Date(2026, 9, 26).getTime(), wednesday), "26 Oct – 1 Nov");
  const groups = groupByWeek([{ startedAt: wednesday }, { startedAt: monday + 1 }, { startedAt: new Date(2026, 10, 10).getTime() }]);
  assert.deepEqual(groups.map((g) => g.items.length), [2, 1]);
});

test("routes fit inside the card area, centred, with the aspect ratio kept", () => {
  const route = [legs(ORIGIN, [[0, 2000], [90, 500]])];
  const box = { x: 100, y: 200, width: 800, height: 600 };
  const points = fitRoute(route, box, 20).flat();
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  assert.ok(Math.min(...xs) >= box.x + 20 - 1e-6 && Math.max(...xs) <= box.x + box.width - 20 + 1e-6);
  assert.ok(Math.min(...ys) >= box.y + 20 - 1e-6 && Math.max(...ys) <= box.y + box.height - 20 + 1e-6);
  // 2 km tall by 0.5 km wide: height fills the box, width is a quarter of it.
  const height = Math.max(...ys) - Math.min(...ys);
  const width = Math.max(...xs) - Math.min(...xs);
  assert.ok(Math.abs(height - 560) < 1);
  assert.ok(Math.abs(width / height - 0.25) < 0.01);
  // North is up: the first leg goes north, so y decreases.
  assert.ok(points[1].y < points[0].y);
  assert.deepEqual(fitRoute([], box), []);
  const single = fitRoute([[ORIGIN]], box);
  assert.deepEqual(single[0][0], { x: 500, y: 500 });
});

test("share stats: pace for walks and runs, speed for rides, climb whenever recorded, calories only when known", () => {
  const base = { title: "x", startedAt: 0, distanceM: 5000, movingSeconds: 1500, avgSpeedMps: 5000 / 1500, avgPaceSecondsPerKm: 300, kcal: 380, elevationGainM: 12, sharePolyline: "" };
  assert.deepEqual(cardStats({ ...base, sport: "run" }).map((s) => s.label), ["Avg pace", "Moving time", "Climb (GPS)", "Calories (est.)"]);
  assert.deepEqual(cardStats({ ...base, sport: "ride", kcal: null }).map((s) => s.label), ["Avg speed", "Moving time", "Climb (GPS)"]);
  assert.deepEqual(cardStats({ ...base, sport: "walk", kcal: null, elevationGainM: null }).map((s) => s.label), ["Moving time", "Avg pace"]);
  assert.equal(cardStats({ ...base, sport: "run" })[0].value, "5:00");
});
