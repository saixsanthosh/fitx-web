import { test } from "node:test";
import assert from "node:assert/strict";
import { ActivityEngine } from "@/lib/activity/engine";
import { destination, haversine, pathLength } from "@/lib/activity/geo";
import { parseGpx, toGpx } from "@/lib/activity/gpx";
import type { Fix, LogEntry, Sport } from "@/lib/activity/types";
import { ORIGIN, T0, control, fixEntries, gps, legs, moveAlong, pointAt, recording, relativeError, runningTrack, standStill, type Noise } from "./support/tracks";

// Realistic phone GPS: error that drifts slowly (20 s memory) plus a little jitter, 5 m reported accuracy.
const REALISTIC: Noise = { sigmaM: 3, accuracyM: 5, correlationS: 20 };
// Harsh: independent error at every fix (worse than real phones), used as a stress test.
const HARSH: Noise = { sigmaM: 4, accuracyM: 6, correlationS: 0 };
// A phone that also reports its Doppler ground speed with each fix (most phones do).
const WITH_SPEED: Noise = { sigmaM: 6, accuracyM: 9, correlationS: 20, speedSigma: 0.25 };

const finished = (entries: LogEntry[]) => {
  const engine = ActivityEngine.replay(entries);
  assert.equal(engine.status, "finished");
  return { engine, snap: engine.snapshot(engine.endedAt as number) };
};

function scenario(name: string, sport: Sport, noise: Noise, seed: number) {
  const device = gps(noise, seed);
  switch (name) {
    case "straight run": {
      const run = moveAlong(legs(ORIGIN, [[45, 5000]]), { speedMps: 3, startMs: T0, device });
      return { log: recording(sport, run.fixes), distance: 5000, moving: 5000 / 3 };
    }
    case "track laps": {
      const path = runningTrack(ORIGIN, 10);
      const run = moveAlong(path, { speedMps: 4, startMs: T0, device });
      return { log: recording(sport, run.fixes), distance: pathLength(path), moving: pathLength(path) / 4 };
    }
    case "stop and go walk": {
      const path = legs(ORIGIN, [[90, 600], [0, 600]]);
      const a = moveAlong(path, { toM: 600, speedMps: 1.4, startMs: T0, device });
      const b = standStill(pointAt(path, 600), { seconds: 120, startMs: a.endMs, device });
      const c = moveAlong(path, { fromM: 600, speedMps: 1.4, startMs: b.endMs, device });
      return { log: recording(sport, [...a.fixes, ...b.fixes, ...c.fixes]), distance: 1200, moving: 1200 / 1.4 };
    }
    case "city ride": {
      const turns: Array<[number, number]> = [];
      for (let i = 0; i < 80; i++) turns.push([i % 2 === 0 ? 0 : 90, 250]);
      const ride = moveAlong(legs(ORIGIN, turns), { speedMps: 7, startMs: T0, device });
      return { log: recording(sport, ride.fixes), distance: 20000, moving: 20000 / 7 };
    }
    default:
      throw new Error(name);
  }
}

const CASES: Array<[string, Sport]> = [["straight run", "run"], ["track laps", "run"], ["stop and go walk", "walk"], ["city ride", "ride"]];

test("distance and moving time on realistic GPS (positions only)", () => {
  for (const [name, sport] of CASES) {
    const { log, distance, moving } = scenario(name, sport, REALISTIC, 11);
    const { snap } = finished(log);
    assert.equal(snap.distanceModel, "position", name);
    // Known limit without device speeds: the position smoother runs slightly wide on sustained
    // tight curves (a 400 m track reads about 3% long even without GPS error).
    const tolerance = name === "track laps" ? 0.06 : 0.04;
    assert.ok(relativeError(snap.distanceM, distance) < tolerance, `${name}: distance ${snap.distanceM.toFixed(0)} m vs ${distance.toFixed(0)} m`);
    assert.ok(relativeError(snap.movingSeconds, moving) < 0.04, `${name}: moving ${snap.movingSeconds.toFixed(0)} s vs ${moving.toFixed(0)} s`);
  }
});

test("harsh independent GPS error stays bounded", () => {
  for (const [name, sport] of CASES) {
    const { log, distance, moving } = scenario(name, sport, HARSH, 12);
    const { snap } = finished(log);
    assert.ok(relativeError(snap.distanceM, distance) < 0.07, `${name}: distance ${snap.distanceM.toFixed(0)} m vs ${distance.toFixed(0)} m`);
    assert.ok(relativeError(snap.movingSeconds, moving) < 0.05, `${name}: moving ${snap.movingSeconds.toFixed(0)} s vs ${moving.toFixed(0)} s`);
  }
});

test("device (Doppler) speeds give precise distance even with poor positions", () => {
  for (const [name, sport] of CASES) {
    const { log, distance, moving } = scenario(name, sport, WITH_SPEED, 13);
    const { snap } = finished(log);
    assert.equal(snap.distanceModel, "doppler", name);
    assert.ok(relativeError(snap.distanceM, distance) < 0.02, `${name}: distance ${snap.distanceM.toFixed(0)} m vs ${distance.toFixed(0)} m`);
    assert.ok(relativeError(snap.movingSeconds, moving) < 0.02, `${name}: moving ${snap.movingSeconds.toFixed(0)} s vs ${moving.toFixed(0)} s`);
  }
});

test("standing still adds no distance or moving time", () => {
  const noises: Noise[] = [REALISTIC, { sigmaM: 8, accuracyM: 12, correlationS: 20 }, HARSH, WITH_SPEED];
  noises.forEach((noise, i) => {
    const still = standStill(ORIGIN, { seconds: 600, startMs: T0, device: gps(noise, 20 + i) });
    const { snap } = finished(recording("walk", still.fixes));
    assert.ok(snap.distanceM < 5, `noise ${i}: ${snap.distanceM.toFixed(1)} m`);
    assert.ok(snap.movingSeconds < 5, `noise ${i}: ${snap.movingSeconds.toFixed(1)} s`);
    assert.equal(snap.elapsedSeconds, (still.fixes.at(-1)!.t - T0) / 1000);
  });
});

test("a locked screen is an honest gap: no straight line, no distance, disclosed", () => {
  const device = gps(REALISTIC, 30);
  const path = legs(ORIGIN, [[0, 3000]]);
  const a = moveAlong(path, { toM: 1000, speedMps: 3, startMs: T0, device });
  const hiddenAt = a.endMs;
  const back = hiddenAt + 180_000; // locked for 3 minutes while running 540 m
  const c = moveAlong(path, { fromM: 1540, toM: 2540, speedMps: 3, startMs: back, device });
  const log = [control({ type: "start", t: T0, sport: "run" }), ...fixEntries(a.fixes), control({ type: "hidden", t: hiddenAt }), control({ type: "visible", t: back - 400 }), ...fixEntries(c.fixes), control({ type: "finish", t: c.endMs })];
  const { snap } = finished(log);
  assert.equal(snap.gaps.length, 1);
  assert.equal(snap.gaps[0].kind, "hidden");
  assert.ok(Math.abs((snap.gaps[0].end - snap.gaps[0].start) / 1000 - 180) < 3);
  assert.ok(Math.abs((snap.gaps[0].straightLineM ?? 0) - 540) < 30);
  assert.equal(snap.segments.length, 2, "the route breaks at the gap");
  const endOfFirst = snap.segments[0].at(-1)!;
  const startOfSecond = snap.segments[1][0];
  assert.ok(haversine(endOfFirst, startOfSecond) > 450, "the two stretches are not joined");
  assert.ok(relativeError(snap.distanceM, 2000) < 0.03, `distance ${snap.distanceM.toFixed(0)} excludes the 540 m gap`);
  assert.ok(relativeError(snap.movingSeconds, 2000 / 3) < 0.04, "the gap is not moving time");
  assert.ok(Math.abs(snap.gapSeconds - 180) < 3);
});

test("hidden but back at the same place: gap recorded, route continues, no moving time", () => {
  const device = gps(REALISTIC, 31);
  const path = legs(ORIGIN, [[0, 1000]]);
  const a = moveAlong(path, { toM: 500, speedMps: 1.4, startMs: T0, device });
  const still = standStill(pointAt(path, 500), { seconds: 5, startMs: a.endMs, device });
  const back = still.endMs + 120_000;
  const after = standStill(pointAt(path, 500), { seconds: 10, startMs: back, device });
  const log = [control({ type: "start", t: T0, sport: "walk" }), ...fixEntries([...a.fixes, ...still.fixes]), control({ type: "hidden", t: still.endMs }), control({ type: "visible", t: back }), ...fixEntries(after.fixes), control({ type: "finish", t: after.endMs })];
  const { snap } = finished(log);
  assert.equal(snap.gaps.length, 1);
  assert.equal(snap.segments.length, 1, "nothing moved, so the stretch continues");
  assert.ok(snap.movingSeconds < 500 / 1.4 + 10, `moving ${snap.movingSeconds.toFixed(0)} s excludes the hidden time`);
});

test("GPS signal lost in a tunnel while riding: interruption, nothing bridged", () => {
  const device = gps(REALISTIC, 32);
  const path = legs(ORIGIN, [[90, 4420]]);
  const a = moveAlong(path, { toM: 2000, speedMps: 7, startMs: T0, device });
  const c = moveAlong(path, { fromM: 2420, speedMps: 7, startMs: a.endMs + 60_000, device });
  const { snap } = finished(recording("ride", [...a.fixes, ...c.fixes]));
  assert.equal(snap.gaps.length, 1);
  assert.equal(snap.gaps[0].kind, "signal");
  assert.equal(snap.segments.length, 2);
  assert.ok(relativeError(snap.distanceM, 4000) < 0.03, `distance ${snap.distanceM.toFixed(0)}`);
});

test("a short dropout is bridged like a slower fix rate", () => {
  const device = gps(REALISTIC, 33);
  const path = legs(ORIGIN, [[0, 2000]]);
  const all = moveAlong(path, { speedMps: 3, startMs: T0, device }).fixes;
  const withDropout = all.filter((fix) => fix.t < T0 + 300_000 || fix.t > T0 + 315_000);
  const { snap } = finished(recording("run", withDropout));
  assert.equal(snap.gaps.length, 0);
  assert.equal(snap.segments.length, 1);
  assert.ok(relativeError(snap.distanceM, 2000) < 0.04);
});

test("a single GPS spike is ignored", () => {
  const device = gps(REALISTIC, 34);
  const path = legs(ORIGIN, [[0, 2000]]);
  const clean = moveAlong(path, { speedMps: 3, startMs: T0, device }).fixes;
  const spiked = clean.map((fix, i) => (i === 300 ? { ...fix, ...destination(fix, 90, 300) } : fix));
  const a = finished(recording("run", clean)).snap;
  const b = finished(recording("run", spiked)).snap;
  assert.ok(b.rejectedJumpCount >= 1);
  assert.equal(b.gaps.length, 0);
  assert.ok(Math.abs(a.distanceM - b.distanceM) < 25, `${a.distanceM.toFixed(0)} vs ${b.distanceM.toFixed(0)}`);
});

test("after a real jump, three consistent fixes re-anchor the route, reported as a jump", () => {
  const device = gps(REALISTIC, 35);
  const first = moveAlong(legs(ORIGIN, [[0, 500]]), { speedMps: 1.4, startMs: T0, device });
  const elsewhere = destination(ORIGIN, 90, 3000);
  const second = moveAlong(legs(elsewhere, [[0, 500]]), { speedMps: 1.4, startMs: first.endMs + 2_000, device });
  const { snap } = finished(recording("walk", [...first.fixes, ...second.fixes]));
  assert.equal(snap.gaps.length, 1);
  assert.equal(snap.gaps[0].kind, "jump");
  assert.ok(Math.abs((snap.gaps[0].straightLineM ?? 0) - 3000) < 600);
  assert.equal(snap.segments.length, 2);
  assert.ok(snap.distanceM < 1100, `distance ${snap.distanceM.toFixed(0)} has no 3 km jump`);
  assert.ok(snap.distanceM > 850);
});

test("pause and resume: nothing counted while paused, elapsed includes the pause", () => {
  const device = gps(REALISTIC, 36);
  const path = legs(ORIGIN, [[0, 1200]]);
  const a = moveAlong(path, { toM: 500, speedMps: 1.4, startMs: T0, device });
  const pauseAt = a.endMs;
  const duringPause = moveAlong(path, { fromM: 500, toM: 700, speedMps: 1.4, startMs: pauseAt + 1_000, device });
  const resumeAt = pauseAt + 300_000;
  const c = moveAlong(path, { fromM: 700, speedMps: 1.4, startMs: resumeAt, device });
  const log = [control({ type: "start", t: T0, sport: "walk" }), ...fixEntries(a.fixes), control({ type: "pause", t: pauseAt }), ...fixEntries(duringPause.fixes), control({ type: "resume", t: resumeAt }), ...fixEntries(c.fixes), control({ type: "finish", t: c.endMs })];
  const { engine, snap } = finished(log);
  assert.ok(relativeError(snap.distanceM, 1000) < 0.04, `distance ${snap.distanceM.toFixed(0)}`);
  assert.ok(Math.abs(snap.pausedSeconds - 300) < 1);
  assert.equal(Math.round(snap.elapsedSeconds), Math.round((c.endMs - T0) / 1000));
  assert.ok(Math.abs(snap.activeSeconds - (snap.elapsedSeconds - 300)) < 1);
  assert.ok(relativeError(snap.movingSeconds, 1000 / 1.4) < 0.05);
  assert.equal(snap.segments.length, 2);
  assert.equal(engine.recordedFixes.length, a.fixes.length + c.fixes.length, "positions during the pause are not stored");
});

test("inaccurate, invalid, duplicate and out-of-order fixes are not used", () => {
  const device = gps(REALISTIC, 37);
  const run = moveAlong(legs(ORIGIN, [[0, 1000]]), { speedMps: 3, startMs: T0, device }).fixes;
  const noisy: Fix[] = [];
  run.forEach((fix, i) => {
    noisy.push(fix);
    if (i % 10 === 0) noisy.push({ ...fix, t: fix.t + 100, acc: 80, lat: fix.lat + 0.002 });
    if (i % 25 === 0) noisy.push({ ...fix }); // duplicate time
    if (i % 40 === 0) noisy.push({ ...fix, t: fix.t - 5_000 }); // out of order
    if (i === 50) noisy.push({ ...fix, t: fix.t + 200, lat: Number.NaN });
  });
  const clean = finished(recording("run", run)).snap;
  const { engine, snap } = finished(recording("run", noisy));
  assert.ok(snap.rejectedAccuracyCount >= 30);
  assert.ok(Math.abs(snap.distanceM - clean.distanceM) < 20);
  for (let i = 1; i < engine.recordedFixes.length; i++) assert.ok(engine.recordedFixes[i].t > engine.recordedFixes[i - 1].t);
});

test("approximate location (hundreds of metres) never becomes a route", () => {
  const device = gps({ sigmaM: 300, accuracyM: 1500, correlationS: 60 }, 38);
  const run = moveAlong(legs(ORIGIN, [[0, 1000]]), { speedMps: 3, startMs: T0, device });
  const { snap } = finished(recording("run", run.fixes));
  assert.equal(snap.distanceM, 0);
  assert.equal(snap.segments.length, 0);
  assert.equal(snap.rejectedAccuracyCount, run.fixes.length);
});

test("kilometre splits add up to the totals", () => {
  const { log } = scenario("straight run", "run", REALISTIC, 39);
  const { snap } = finished(log);
  const full = snap.splits.filter((split) => split.distanceM === 1000);
  assert.ok(full.length >= 5);
  const movingSum = snap.splits.reduce((sum, split) => sum + split.movingSeconds, 0);
  assert.ok(Math.abs(movingSum - snap.movingSeconds) <= snap.splits.length, `${movingSum} vs ${snap.movingSeconds}`);
  for (const split of full) assert.ok(relativeError(split.movingSeconds, 1000 / 3) < 0.08, `split ${split.index}: ${split.movingSeconds} s`);
  const distanceSum = snap.splits.reduce((sum, split) => sum + split.distanceM, 0);
  assert.ok(Math.abs(distanceSum - snap.distanceM) < 1);
});

test("top speed comes only from the phone's own speed readings", () => {
  const ride = moveAlong(legs(ORIGIN, [[0, 4000]]), { speedMps: 7, startMs: T0, device: gps(WITH_SPEED, 48) });
  const withSpeed = finished(recording("ride", ride.fixes)).snap.maxSpeedMps!;
  assert.ok(withSpeed >= 7 && withSpeed < 7.5, `doppler top speed ${withSpeed}`);
  // Positions alone would overstate it, so none is reported.
  const run = moveAlong(legs(ORIGIN, [[0, 3000]]), { speedMps: 3, startMs: T0, device: gps(REALISTIC, 49) });
  assert.equal(finished(recording("run", run.fixes)).snap.maxSpeedMps, null);
});

test("live pace follows the last 30 seconds and shows stopped", () => {
  const device = gps(WITH_SPEED, 40);
  const path = legs(ORIGIN, [[0, 1000]]);
  const a = moveAlong(path, { toM: 600, speedMps: 3, startMs: T0, device });
  const b = standStill(pointAt(path, 600), { seconds: 40, startMs: a.endMs, device });
  const engine = new ActivityEngine();
  engine.apply(control({ type: "start", t: T0, sport: "run" }));
  for (const fix of a.fixes) engine.addFix(fix);
  const running = engine.snapshot(a.fixes.at(-1)!.t);
  assert.ok(running.currentPaceSecondsPerKm !== null && relativeError(running.currentPaceSecondsPerKm, 1000 / 3) < 0.1, `${running.currentPaceSecondsPerKm}`);
  assert.equal(running.stopped, false);
  for (const fix of b.fixes) engine.addFix(fix);
  const stopped = engine.snapshot(b.fixes.at(-1)!.t);
  assert.equal(stopped.stopped, true);
  assert.equal(stopped.currentPaceSecondsPerKm, null);
});

test("device speeds that are clearly wrong are dropped for positions", () => {
  // A phone reporting speed 0 all the time while actually moving.
  const device = gps({ ...REALISTIC, speedSigma: 0 }, 41);
  const run = moveAlong(legs(ORIGIN, [[0, 3000]]), { speedMps: 3, startMs: T0, device }).fixes.map((fix) => ({ ...fix, speed: 0 }));
  const { snap } = finished(recording("run", run));
  assert.equal(snap.distanceModel, "position");
  assert.ok(relativeError(snap.distanceM, 3000) < 0.06, `distance ${snap.distanceM.toFixed(0)}`);

  // A phone reporting 3 m/s while its owner stands still after a short walk.
  const walker = gps({ ...REALISTIC, speedSigma: 0.1 }, 42);
  const path = legs(ORIGIN, [[0, 300]]);
  const walk = moveAlong(path, { speedMps: 1.4, startMs: T0, device: walker });
  const still = standStill(pointAt(path, 300), { seconds: 300, startMs: walk.endMs, device: walker }).fixes.map((fix) => ({ ...fix, speed: 3 }));
  const bogus = finished(recording("walk", [...walk.fixes, ...still])).snap;
  assert.ok(bogus.distanceM < 300 + 250, `distance ${bogus.distanceM.toFixed(0)} stops growing once the speeds are found wrong`);
});

test("climb comes from GPS altitude with noise filtered out", () => {
  const device = gps(REALISTIC, 43);
  const path = legs(ORIGIN, [[0, 2000]]);
  const run = moveAlong(path, { speedMps: 3, startMs: T0, device }).fixes;
  // Altitude error of a few metres that changes from fix to fix.
  const noise = (i: number) => 3 * Math.sin(i * 1.7) + 2 * Math.sin(i * 0.37);
  const climbing = run.map((fix, i) => ({ ...fix, alt: 100 + (60 * i) / run.length + noise(i), altAcc: 8 }));
  const flat = run.map((fix, i) => ({ ...fix, alt: 100 + noise(i), altAcc: 8 }));
  const up = finished(recording("run", climbing)).snap.elevationGainM ?? 0;
  const level = finished(recording("run", flat)).snap.elevationGainM ?? 0;
  assert.ok(up >= 45 && up <= 75, `climb ${up}`);
  assert.ok(level <= 12, `flat ${level}`);
  assert.equal(finished(recording("run", run)).snap.elevationGainM, null, "no altitude, no climb");
});

test("replaying the log gives exactly the live result", () => {
  const { log } = scenario("stop and go walk", "walk", WITH_SPEED, 45);
  const live = new ActivityEngine();
  for (const entry of log) live.apply(entry);
  const replayed = ActivityEngine.replay(JSON.parse(JSON.stringify(log)) as LogEntry[]);
  const end = live.endedAt as number;
  assert.deepEqual(JSON.parse(JSON.stringify(replayed.snapshot(end))), JSON.parse(JSON.stringify(live.snapshot(end))));
});

test("a GPX file round trip feeds the engine the same track", () => {
  const device = gps(REALISTIC, 46);
  const run = moveAlong(legs(ORIGIN, [[30, 1500]]), { speedMps: 3, startMs: T0, device }).fixes.map((fix) => ({ ...fix, alt: 120.5 }));
  const xml = toGpx({ name: "Morning <run> & co", sport: "run", segments: [run] });
  assert.match(xml, /Morning &lt;run&gt; &amp; co/);
  assert.match(xml, /<type>running<\/type>/);
  const parsed = parseGpx(xml, 5);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].length, run.length);
  const direct = finished(recording("run", run)).snap.distanceM;
  const fromGpx = finished(recording("run", parsed[0])).snap.distanceM;
  assert.ok(Math.abs(direct - fromGpx) < 2, `${direct} vs ${fromGpx}`);
});

test("hidden then finished without new positions closes the gap at the finish", () => {
  const device = gps(REALISTIC, 47);
  const a = moveAlong(legs(ORIGIN, [[0, 500]]), { speedMps: 3, startMs: T0, device });
  const log = [control({ type: "start", t: T0, sport: "run" }), ...fixEntries(a.fixes), control({ type: "hidden", t: a.endMs }), control({ type: "visible", t: a.endMs + 60_000 }), control({ type: "finish", t: a.endMs + 61_000 })];
  const { snap } = finished(log);
  assert.equal(snap.gaps.length, 1);
  assert.equal(snap.gaps[0].straightLineM, null);
  assert.ok(Math.abs(snap.gapSeconds - 61) < 2);
});

test("controls out of place are ignored", () => {
  const engine = new ActivityEngine();
  engine.apply(control({ type: "pause", t: T0 }));
  engine.apply(control({ type: "finish", t: T0 }));
  assert.equal(engine.status, "idle");
  engine.apply(control({ type: "start", t: T0, sport: "ride" }));
  engine.apply(control({ type: "start", t: T0 + 5, sport: "walk" }));
  engine.apply(control({ type: "resume", t: T0 + 10 }));
  assert.equal(engine.sport, "ride");
  assert.equal(engine.status, "recording");
  engine.addFix({ t: T0 - 1_000, lat: ORIGIN.lat, lng: ORIGIN.lng, acc: 5, alt: null, altAcc: null, speed: null });
  assert.equal(engine.recordedFixes.length, 0, "a fix from before the start is not part of the activity");
});
