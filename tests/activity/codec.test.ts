import { test } from "node:test";
import assert from "node:assert/strict";
import { boundsOf, destination, haversine, pathLength, simplify } from "@/lib/activity/geo";
import { decodePolyline, decodeRoute, decodeTrackChunk, encodePolyline, encodeRoute, encodeTrackChunk } from "@/lib/activity/polyline";
import type { Fix } from "@/lib/activity/types";
import { ORIGIN, T0, gps, legs, moveAlong } from "./support/tracks";

test("haversine matches known distances", () => {
  // One degree of latitude on the mean-radius sphere.
  assert.ok(Math.abs(haversine({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }) - 111_195) < 1);
  // Bengaluru to Chennai is about 290 km in a straight line.
  const blrMaa = haversine({ lat: 12.9716, lng: 77.5946 }, { lat: 13.0827, lng: 80.2707 });
  assert.ok(blrMaa > 285_000 && blrMaa < 295_000, `${blrMaa}`);
  assert.equal(haversine(ORIGIN, ORIGIN), 0);
});

test("destination walks the given distance and bearing", () => {
  for (const bearing of [0, 45, 90, 180, 270]) {
    const p = destination(ORIGIN, bearing, 1234);
    assert.ok(Math.abs(haversine(ORIGIN, p) - 1234) < 0.01);
  }
});

test("simplification keeps the ends and removes points within tolerance", () => {
  const device = gps({ sigmaM: 1, accuracyM: 2, correlationS: 0 }, 3);
  const line = moveAlong(legs(ORIGIN, [[90, 1000]]), { speedMps: 2, startMs: T0, device }).fixes;
  const simple = simplify(line, 5);
  assert.ok(simple.length < 20, `${simple.length} points`);
  assert.deepEqual(simple[0], line[0]);
  assert.deepEqual(simple.at(-1), line.at(-1));
  const corner = legs(ORIGIN, [[0, 500], [90, 500]]);
  const dense = [corner[0], destination(corner[0], 0, 250), corner[1], destination(corner[1], 90, 250), corner[2]];
  assert.equal(simplify(dense, 3).length, 3, "a right-angle corner survives");
  assert.ok(Math.abs(pathLength(simplify(dense, 3)) - 1000) < 0.5);
});

test("bounds cover every segment", () => {
  const bounds = boundsOf([[{ lat: 1, lng: 2 }, { lat: 3, lng: -1 }], [{ lat: -2, lng: 5 }]]);
  assert.deepEqual(bounds, { west: -1, south: -2, east: 5, north: 3 });
  assert.equal(boundsOf([]), null);
});

test("Google polyline: the reference example", () => {
  const points = [{ lat: 38.5, lng: -120.2 }, { lat: 40.7, lng: -120.95 }, { lat: 43.252, lng: -126.453 }];
  assert.equal(encodePolyline(points), "_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  assert.deepEqual(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@"), points);
});

test("routes keep separate stretches and round-trip within precision", () => {
  const device = gps({ sigmaM: 3, accuracyM: 5 }, 4);
  const a = moveAlong(legs(ORIGIN, [[10, 800]]), { speedMps: 3, startMs: T0, device }).fixes;
  const b = moveAlong(legs(destination(ORIGIN, 90, 2000), [[200, 600]]), { speedMps: 3, startMs: T0, device }).fixes;
  const text = encodeRoute([a, [], b]);
  assert.equal(text.split(" ").length, 2);
  const back = decodeRoute(text);
  assert.equal(back.length, 2);
  assert.equal(back[0].length, a.length);
  for (let i = 0; i < a.length; i++) assert.ok(haversine(back[0][i], a[i]) < 1);
  assert.deepEqual(decodeRoute(""), []);
  assert.deepEqual(decodeRoute(null), []);
});

test("track chunks round-trip every field, with and without optional values", () => {
  const fixes: Fix[] = [];
  for (let i = 0; i < 500; i++) {
    const p = destination(ORIGIN, i * 0.7, i * 2.9);
    fixes.push({
      t: T0 + i * 1003 + (i % 3) * 17,
      lat: p.lat,
      lng: p.lng,
      acc: 3 + (i % 7) * 1.37,
      alt: i % 5 === 0 ? null : 900 + Math.sin(i) * 12.34,
      altAcc: i % 4 === 0 ? null : 5 + (i % 3),
      speed: i % 6 === 0 ? null : 2.5 + Math.cos(i) * 0.789,
    });
  }
  const text = encodeTrackChunk(fixes, fixes[0].t);
  const back = decodeTrackChunk(text, fixes[0].t);
  assert.equal(back.length, fixes.length);
  back.forEach((fix, i) => {
    const original = fixes[i];
    assert.ok(Math.abs(fix.t - original.t) <= 50, `t ${i}`);
    assert.ok(Math.abs(fix.lat - original.lat) <= 5.1e-7 && Math.abs(fix.lng - original.lng) <= 5.1e-7, `position ${i}`);
    assert.ok(Math.abs(fix.acc - original.acc) <= 0.051, `acc ${i}`);
    assert.equal(fix.alt === null, original.alt === null);
    if (original.alt !== null) assert.ok(Math.abs((fix.alt as number) - original.alt) <= 0.051);
    assert.equal(fix.speed === null, original.speed === null);
    if (original.speed !== null) assert.ok(Math.abs((fix.speed as number) - original.speed) <= 0.0051);
    assert.equal(fix.altAcc === null, original.altAcc === null);
  });
});

test("an hour of one-second fixes stays compact", () => {
  const device = gps({ sigmaM: 3, accuracyM: 5, speedSigma: 0.2 }, 5);
  const fixes = moveAlong(legs(ORIGIN, [[60, 10_800]]), { speedMps: 3, startMs: T0, device }).fixes.map((fix, i) => ({ ...fix, alt: 900 + i * 0.01, altAcc: 6 }));
  assert.ok(fixes.length >= 3600);
  const bytes = encodeTrackChunk(fixes, fixes[0].t).length;
  assert.ok(bytes < 70_000, `${bytes} characters for ${fixes.length} fixes`);
});

test("corrupt encoded text is rejected, not misread", () => {
  assert.throws(() => decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq"), /Truncated|Invalid/);
  assert.throws(() => decodeTrackChunk("\u0001\u0002", T0), /Invalid/);
});
