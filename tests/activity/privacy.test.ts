import { test } from "node:test";
import assert from "node:assert/strict";
import { destination, haversine } from "@/lib/activity/geo";
import { PRIVACY_RADIUS_M, privateBounds, trimForPrivacy } from "@/lib/activity/privacy";
import type { LatLng } from "@/lib/activity/types";
import { ORIGIN, legs, runningTrack } from "./support/tracks";

function densify(points: LatLng[], stepM = 5): LatLng[] {
  const out: LatLng[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const d = haversine(points[i - 1], points[i]);
    const n = Math.max(1, Math.round(d / stepM));
    for (let k = 1; k <= n; k++) out.push({ lat: points[i - 1].lat + ((points[i].lat - points[i - 1].lat) * k) / n, lng: points[i - 1].lng + ((points[i].lng - points[i - 1].lng) * k) / n });
  }
  return out;
}

test("nothing within the privacy radius of the start or finish remains", () => {
  const route = densify(legs(ORIGIN, [[0, 1500], [90, 800], [180, 600]]));
  const start = route[0];
  const end = route.at(-1)!;
  const trimmed = trimForPrivacy([route]);
  assert.ok(trimmed.length >= 1);
  for (const segment of trimmed) for (const p of segment) {
    assert.ok(haversine(p, start) >= PRIVACY_RADIUS_M - 0.5, "near the start");
    assert.ok(haversine(p, end) >= PRIVACY_RADIUS_M - 0.5, "near the finish");
  }
  // The cut lands on the circle's edge, so most of the route is kept.
  const kept = trimmed.reduce((sum, segment) => sum + segment.slice(1).reduce((s, p, i) => s + haversine(segment[i], p), 0), 0);
  assert.ok(kept > 2900 - 2 * PRIVACY_RADIUS_M - 20 && kept < 2900 - 2 * PRIVACY_RADIUS_M + 20, `${kept}`);
});

test("a loop that starts and ends at home hides home once", () => {
  const loop = densify(legs(ORIGIN, [[0, 700], [90, 700], [180, 700], [270, 700]]));
  const trimmed = trimForPrivacy([loop]);
  for (const segment of trimmed) for (const p of segment) assert.ok(haversine(p, ORIGIN) >= PRIVACY_RADIUS_M - 0.5);
  // The raw box of the trimmed square still has its corner exactly at home; the stored bounds
  // are widened to a 0.01-degree grid so they cannot point at it.
  const bounds = privateBounds(trimmed)!;
  for (const value of [bounds.west, bounds.south, bounds.east, bounds.north]) assert.ok(Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, `${value} is on the grid`);
  assert.ok(!(bounds.south === ORIGIN.lat && bounds.west === ORIGIN.lng));
  for (const segment of trimmed) for (const p of segment) assert.ok(p.lat >= bounds.south && p.lat <= bounds.north && p.lng >= bounds.west && p.lng <= bounds.east);
});

test("passing home in the middle splits the route there too", () => {
  const outAndBack = densify(legs(ORIGIN, [[0, 1000], [180, 1000], [180, 1000]]));
  const trimmed = trimForPrivacy([outAndBack]);
  for (const segment of trimmed) for (const p of segment) assert.ok(haversine(p, ORIGIN) >= PRIVACY_RADIUS_M - 0.5 && haversine(p, outAndBack.at(-1)!) >= PRIVACY_RADIUS_M - 0.5);
  assert.ok(trimmed.length >= 2);
});

test("a route entirely near its start shares no route at all", () => {
  const track = runningTrack(ORIGIN, 2);
  assert.deepEqual(trimForPrivacy([track], 250), []);
  assert.equal(privateBounds([]), null);
  assert.deepEqual(trimForPrivacy([]), []);
});

test("separate stretches stay separate", () => {
  const a = densify(legs(ORIGIN, [[0, 1200]]));
  const b = densify(legs(destination(ORIGIN, 90, 3000), [[0, 1200]]));
  const trimmed = trimForPrivacy([a, b]);
  assert.equal(trimmed.length, 2);
});
