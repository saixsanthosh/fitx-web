import { test } from "node:test";
import assert from "node:assert/strict";
import { cardDataFor, detailFromEngine, engineOptionsFor, lateKcal } from "@/lib/activity/detail";
import { distanceAt, elevationProfile, MIN_PROFILE_POINTS, profilePaths } from "@/lib/activity/elevation";
import { ActivityEngine } from "@/lib/activity/engine";
import { FINISH_UPLOAD_TIMEOUT_MS, uploadWithin } from "@/lib/activity/finish";
import { IMPORT_ENGINE } from "@/lib/activity/import/config";
import { buildActivityRecord } from "@/lib/activity/record";
import { viewFromRecord } from "@/lib/activity/repository";
import type { UploadOutcome } from "@/lib/activity/sync";
import type { Fix, LogEntry } from "@/lib/activity/types";
import { ORIGIN, T0, control, fixEntries, gps, legs, moveAlong, recording } from "./support/tracks";

/** A run whose fixes carry altitude: up 30 m over the first kilometre, then flat. */
function hillyRun(altitude = true): LogEntry[] {
  const device = gps({ sigmaM: 2, accuracyM: 5, speedSigma: 0.1 }, 11);
  const run = moveAlong(legs(ORIGIN, [[0, 2000]]), { speedMps: 3, startMs: T0, device });
  const fixes: Fix[] = run.fixes.map((fix, i) => ({ ...fix, alt: altitude ? 900 + Math.min(30, (i * 3) / 1000 * 30) : null, altAcc: altitude ? 4 : null }));
  return recording("run", fixes);
}

test("the elevation profile follows the recorded altitude against the engine's distance", () => {
  const engine = ActivityEngine.replay(hillyRun());
  const profile = elevationProfile(engine.acceptedSegments, engine.segments);
  assert.ok(profile, "a profile from altitude readings");
  assert.equal(profile.lines.length, 1);
  assert.ok(Math.abs(profile.distanceM - engine.distanceM) < 30, `x axis ${profile.distanceM} vs ${engine.distanceM}`);
  assert.ok(profile.minAlt >= 899 && profile.minAlt < 902, `lowest ${profile.minAlt}`);
  assert.ok(profile.maxAlt > 925 && profile.maxAlt <= 930.5, `highest ${profile.maxAlt}`);
  const paths = profilePaths(profile, 600, 140);
  assert.equal(paths.lines.length, 1);
  assert.match(paths.lines[0], /^M0 /);
  assert.match(paths.areas[0], / Z$/);
});

test("no altitude, or only poor altitude, gives no profile (nothing is guessed)", () => {
  const engine = ActivityEngine.replay(hillyRun(false));
  assert.equal(elevationProfile(engine.acceptedSegments, engine.segments), null);
  const poor = engine.acceptedSegments.map((segment) => segment.map((fix) => ({ ...fix, alt: 900, altAcc: 40 })));
  assert.equal(elevationProfile(poor, engine.segments), null);
  assert.ok(MIN_PROFILE_POINTS >= 5);
});

test("stretches stay separate in the profile, as on the map", () => {
  const device = gps({ sigmaM: 2, accuracyM: 5 }, 3);
  const first = moveAlong(legs(ORIGIN, [[0, 600]]), { speedMps: 3, startMs: T0, device });
  const second = moveAlong(legs(ORIGIN, [[0, 1200]]), { fromM: 700, speedMps: 3, startMs: first.endMs + 60_000, device });
  const withAlt = (fixes: Fix[]) => fixes.map((fix) => ({ ...fix, alt: 900, altAcc: 3 }));
  const log: LogEntry[] = [
    control({ type: "start", t: T0, sport: "run" }), ...fixEntries(withAlt(first.fixes)), control({ type: "pause", t: first.endMs }),
    control({ type: "resume", t: first.endMs + 60_000 }), ...fixEntries(withAlt(second.fixes)), control({ type: "finish", t: second.endMs }),
  ];
  const engine = ActivityEngine.replay(log);
  const profile = elevationProfile(engine.acceptedSegments, engine.segments);
  assert.equal(profile?.lines.length, 2);
});

test("distance at a time interpolates the committed route", () => {
  const route = [{ t: 0, lat: 0, lng: 0, d: 0 }, { t: 10, lat: 0, lng: 0, d: 30 }, { t: 20, lat: 0, lng: 0, d: 50 }];
  assert.equal(distanceAt(route, -5), 0);
  assert.equal(distanceAt(route, 5), 15);
  assert.equal(distanceAt(route, 15), 40);
  assert.equal(distanceAt(route, 99), 50);
  assert.equal(distanceAt([], 3), null);
});

test("an activity page's detail and share data come from the record itself", () => {
  const log = hillyRun();
  const engine = ActivityEngine.replay(log);
  const record = buildActivityRecord(engine, { clientId: "c-1", title: "Hill run", weightKg: null, log });
  const view = viewFromRecord(record);
  const detail = detailFromEngine(engine);
  assert.ok(detail.segments.length >= 1 && detail.route.length >= 1 && detail.profile !== null);
  const card = cardDataFor(view, null);
  assert.equal(card.hadRoute, true);
  assert.equal(card.source, "fitx_gps");
  assert.equal(cardDataFor({ ...view, pointCount: 0, routePolyline: "" }, null).hadRoute, false);
  assert.equal(engineOptionsFor("file"), IMPORT_ENGINE);
  assert.deepEqual(engineOptionsFor("fitx_gps"), {});
});

test("calories are filled in later only from real moving time, never 0 from nothing", () => {
  const log = hillyRun();
  const record = buildActivityRecord(ActivityEngine.replay(log), { clientId: "c-2", title: "Run", weightKg: null, log });
  const view = viewFromRecord(record);
  assert.equal(view.kcal, null);
  assert.ok((lateKcal(view, 70) ?? 0) > 0);
  assert.equal(lateKcal({ ...view, splits: [] }, 70), null, "no splits: nothing to estimate from");
  assert.equal(lateKcal(view, null), null);
  assert.equal(lateKcal({ ...view, kcal: 300 }, 70), null);
});

const outcome = (result: UploadOutcome["result"]): UploadOutcome => ({ clientId: "c", result });
const never = () => new Promise<void>(() => undefined);
const instant = () => Promise.resolve();

test("finishing never waits long on the network", async () => {
  assert.deepEqual(await uploadWithin(async () => outcome({ status: "ok", data: { id: "a-1" } }), 10_000, never), { kind: "uploaded", id: "a-1" });
  assert.deepEqual(await uploadWithin(async () => outcome({ status: "error", message: "Failed to fetch", offline: true }), 10_000, never), { kind: "kept", reason: "offline", pending: null });
  assert.deepEqual(await uploadWithin(async () => outcome({ status: "unavailable" }), 10_000, never), { kind: "kept", reason: "unavailable", pending: null });
  assert.deepEqual(await uploadWithin(async () => outcome({ status: "rejected", message: "x" }), 10_000, never), { kind: "kept", reason: "rejected", pending: null });
  assert.deepEqual(await uploadWithin(async () => { throw new Error("boom"); }, 10_000, never), { kind: "kept", reason: "error", pending: null });
  // A slow upload: the result shows after the timeout, and the upload can still finish later.
  let finish: (value: UploadOutcome) => void = () => undefined;
  const slow = new Promise<UploadOutcome>((resolve) => { finish = resolve; });
  const kept = await uploadWithin(() => slow, 10_000, instant);
  assert.equal(kept.kind, "kept");
  assert.equal(kept.kind === "kept" && kept.reason, "timeout");
  finish(outcome({ status: "ok", data: { id: "late" } }));
  const late = kept.kind === "kept" ? await kept.pending : null;
  assert.equal(late?.result.status === "ok" && late.result.data.id, "late");
  assert.ok(FINISH_UPLOAD_TIMEOUT_MS <= 15_000);
});

test("an imported activity replays with the import settings on its page", () => {
  assert.equal(new ActivityEngine(IMPORT_ENGINE).status, "idle");
  const sparse = moveAlong(legs(ORIGIN, [[0, 900]]), { speedMps: 3, startMs: T0, intervalMs: 45_000, device: gps({ sigmaM: 1, accuracyM: 5 }, 2) });
  const log = recording("run", sparse.fixes);
  assert.ok(ActivityEngine.replay(log).gaps.length > 0, "the phone settings call a 45 s wait that moved lost signal");
  assert.equal(ActivityEngine.replay(log, IMPORT_ENGINE).gaps.length, 0, "the import settings don't");
});
