import { test } from "node:test";
import assert from "node:assert/strict";
import { ActivityEngine } from "@/lib/activity/engine";
import { destination, haversine, projector } from "@/lib/activity/geo";
import { decodeRoute } from "@/lib/activity/polyline";
import { gridCellCenter, PRIVACY_GRID_M, PRIVACY_RADIUS_M, privacyZones, privateBounds, trimForPrivacy } from "@/lib/activity/privacy";
import { buildActivityRecord } from "@/lib/activity/record";
import type { LatLng } from "@/lib/activity/types";
import { ORIGIN, T0, gps, legs, moveAlong, recording, runningTrack } from "./support/tracks";

/** Shortest distance from `p` to any drawn line of the route, metres (not only its vertices). */
function distanceToRoute(p: LatLng, segments: readonly (readonly LatLng[])[]): number {
  const { toXY } = projector(p);
  let best = Infinity;
  for (const segment of segments) {
    for (let i = 0; i < segment.length; i++) {
      const b = toXY(segment[i]);
      if (i === 0) { best = Math.min(best, Math.hypot(b.x, b.y)); continue; }
      const a = toXY(segment[i - 1]);
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / len2)) : 0;
      best = Math.min(best, Math.hypot(a.x + t * dx, a.y + t * dy));
    }
  }
  return best;
}

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
  // At least 200 m goes at each end, and at most the whole zone around the start's or finish's cell.
  const kept = trimmed.reduce((sum, segment) => sum + segment.slice(1).reduce((s, p, i) => s + haversine(segment[i], p), 0), 0);
  const zoneRadius = privacyZones([route])[0].radiusM;
  assert.ok(kept <= 2900 - 2 * PRIVACY_RADIUS_M && kept >= 2900 - 2 * (zoneRadius + PRIVACY_GRID_M) - 20, `${kept}`);
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
  assert.deepEqual(trimForPrivacy([track]), []);
  assert.equal(privateBounds([]), null);
  assert.deepEqual(trimForPrivacy([]), []);
});

test("separate stretches stay separate", () => {
  const a = densify(legs(ORIGIN, [[0, 1200]]));
  const b = densify(legs(destination(ORIGIN, 90, 3000), [[0, 1200]]));
  const trimmed = trimForPrivacy([a, b]);
  assert.equal(trimmed.length, 2);
});

test("the cut-out is centred on a grid cell, so the gap does not point at the start", () => {
  // A walk that leaves home north and comes back from the south along the same street.
  for (const home of [ORIGIN, destination(destination(ORIGIN, 90, 37), 0, 52)]) {
    const loop = densify(legs(home, [[0, 900], [90, 400], [180, 1800], [270, 400], [0, 900]]));
    const zones = privacyZones([loop]);
    assert.equal(zones.length, 1, "start and finish share one cell");
    assert.ok(haversine(zones[0].center, home) > 1, "the zone is not centred on home");
    assert.ok(haversine(zones[0].center, home) <= (PRIVACY_GRID_M * Math.SQRT2) / 2 + 1);
    const trimmed = trimForPrivacy([loop]);
    const cutEnds = [trimmed[0][0], trimmed[trimmed.length - 1][trimmed[trimmed.length - 1].length - 1]];
    for (const end of cutEnds) {
      assert.ok(haversine(end, home) >= PRIVACY_RADIUS_M - 0.5, "nothing within 200 m of home");
      assert.ok(Math.abs(haversine(end, zones[0].center) - zones[0].radiusM) < 1, "cut ends sit on the zone, around the cell centre");
    }
  }
  // Two homes in the same cell get the same zone: repeated walks can't be averaged to a house.
  const cell = gridCellCenter(ORIGIN);
  const neighbour = destination(cell, 45, 20);
  assert.deepEqual(gridCellCenter(destination(cell, 225, 20)), gridCellCenter(neighbour));
});

test("a straight line passing the start through the zone is cut too, after simplification", () => {
  // Out and back past home on a straight road: simplification leaves one long chord through the zone.
  const device = gps({ sigmaM: 2, accuracyM: 4, speedSigma: 0.2 }, 80);
  const path = legs(ORIGIN, [[0, 1000], [180, 2000], [90, 1000]]);
  const run = moveAlong(path, { speedMps: 3, startMs: T0, device });
  const log = recording("run", run.fixes);
  const engine = ActivityEngine.replay(log);
  const record = buildActivityRecord(engine, { clientId: "c-chord", title: "Run", weightKg: null, log });
  const shared = decodeRoute(record.sharePolyline);
  assert.ok(shared.length >= 2, "the route splits where it passes the start");
  const start = engine.segments[0][0];
  const finish = engine.segments[engine.segments.length - 1].at(-1)!;
  assert.ok(distanceToRoute(start, shared) >= PRIVACY_RADIUS_M - 2, `drawn line comes within ${distanceToRoute(start, shared).toFixed(1)} m of the start`);
  assert.ok(distanceToRoute(finish, shared) >= PRIVACY_RADIUS_M - 2);
});
