// Bugs 20 and 38: the Record screen's GPS chip gives the same answer as the location banner. Once FITX says the
// signal is lost, the chip says so (never "GPS good ± 6 m" from a position that stopped arriving); while location
// is blocked, unsupported or not allowed yet it says that, never "Finding GPS…" with pulsing bars.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ISSUE_TEXT, signalChip } from "@/components/activity/messages";
import { MemoryRecordingStore } from "@/lib/activity/local-store";
import { ActivityRecorder, type RecorderDeps } from "@/lib/activity/recorder";
import type { LatLng } from "@/lib/activity/types";
import { ORIGIN, T0, legs, pointAt } from "./support/tracks";

type Success = (position: { timestamp: number; coords: { latitude: number; longitude: number; accuracy: number; altitude: number | null; altitudeAccuracy: number | null; speed: number | null } }) => void;
type Failure = (error: { code: number }) => void;

class FakeGeolocation {
  watches = new Map<number, { success: Success; error: Failure }>();
  private next = 1;
  watchPosition(success: Success, error: Failure) {
    const id = this.next++;
    this.watches.set(id, { success, error });
    return id;
  }
  clearWatch(id: number) {
    this.watches.delete(id);
  }
  emit(point: LatLng, t: number, accuracy = 6) {
    for (const watch of this.watches.values()) watch.success({ timestamp: t, coords: { latitude: point.lat, longitude: point.lng, accuracy, altitude: null, altitudeAccuracy: null, speed: null } });
  }
  fail(code: number) {
    for (const watch of this.watches.values()) watch.error({ code });
  }
}

const target = () => ({ visibilityState: "visible", addEventListener: () => undefined, removeEventListener: () => undefined });

function setup(overrides: Partial<RecorderDeps> = {}) {
  let now = T0;
  const geolocation = new FakeGeolocation();
  const ticks: Array<() => void> = [];
  let ids = 0;
  const recorder = new ActivityRecorder({
    geolocation,
    queryPermission: async () => ({ state: "granted" }),
    wakeLock: null,
    document: target(),
    window: target(),
    isSecureContext: true,
    store: new MemoryRecordingStore(true),
    now: () => now,
    randomId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    setInterval: (callback) => { ticks.push(callback); return ticks.length; },
    clearInterval: () => undefined,
    ...overrides,
  });
  return {
    recorder, geolocation,
    setNow: (value: number) => { now = value; },
    tick: () => { for (const callback of ticks) callback(); },
    chip: () => signalChip(recorder.getSnapshot()),
  };
}

const path = legs(ORIGIN, [[0, 3000]]);

test("standing still after Start: when the signal is called lost, the chip says 'GPS lost' with no bars", async () => {
  const env = setup();
  await env.recorder.init("u1");
  env.recorder.warmUp();
  env.geolocation.emit(ORIGIN, T0);
  assert.deepEqual(env.chip(), { text: "GPS good", bars: 3, tone: "good", searching: false, accuracyM: 6 });
  await env.recorder.start("run", null);
  env.setNow(T0 + 20_000);
  env.tick();
  const snap = env.recorder.getSnapshot();
  assert.equal(snap.issue, "searching");
  assert.equal(ISSUE_TEXT.searching.title, "GPS signal lost");
  assert.equal(snap.signal, "none", "no signal from a 20-second-old position");
  assert.deepEqual(env.chip(), { text: "GPS lost", bars: 0, tone: "bad", searching: false, accuracyM: null });
});

test("moving and then stopping: GPS good while positions arrive, GPS lost once they stop, good again when they return", async () => {
  const env = setup();
  await env.recorder.init("u1");
  env.recorder.warmUp();
  env.geolocation.emit(ORIGIN, T0);
  await env.recorder.start("walk", null);
  for (let i = 1; i <= 30; i++) {
    env.setNow(T0 + i * 1000);
    env.geolocation.emit(pointAt(path, i * 1.4), T0 + i * 1000);
    env.tick();
  }
  assert.equal(env.chip().text, "GPS good");
  env.setNow(T0 + 50_000);
  env.tick();
  assert.equal(env.recorder.getSnapshot().issue, "searching");
  assert.equal(env.chip().text, "GPS lost");
  env.geolocation.emit(pointAt(path, 50), T0 + 50_000);
  assert.equal(env.recorder.getSnapshot().issue, null);
  assert.deepEqual([env.chip().text, env.chip().accuracyM], ["GPS good", 6]);
});

test("blocked before the page opened: the chip says 'Location blocked', never 'Finding GPS…', and doesn't pulse", async () => {
  const env = setup({ queryPermission: async () => ({ state: "denied" }) });
  await env.recorder.init("u1");
  assert.deepEqual(env.chip(), { text: "Location blocked", bars: 0, tone: "off", searching: false, accuracyM: null });
  env.setNow(T0 + 22_000);
  env.tick();
  assert.equal(env.chip().text, "Location blocked", "still after 22 seconds");
});

test("Allow location, then the browser refuses: 'Location blocked', matching the banner", async () => {
  const env = setup({ queryPermission: async () => ({ state: "prompt" }) });
  await env.recorder.init("u1");
  assert.deepEqual(env.chip(), { text: "Location off", bars: 0, tone: "off", searching: false, accuracyM: null }, "not asked yet: nothing is looking");
  env.recorder.warmUp();
  assert.deepEqual([env.chip().text, env.chip().searching], ["Finding GPS…", true], "asked: looking for a first position");
  env.geolocation.fail(1);
  assert.equal(env.recorder.getSnapshot().issue, "denied");
  assert.equal(ISSUE_TEXT.denied.title, "Location is blocked for FITX");
  assert.deepEqual([env.chip().text, env.chip().searching], ["Location blocked", false]);
});

test("unsupported and insecure pages say there is no location; a timeout or an unavailable position say no GPS", async () => {
  const unsupported = setup({ geolocation: null });
  await unsupported.recorder.init("u1");
  assert.deepEqual([unsupported.chip().text, unsupported.chip().searching], ["No location", false]);
  const insecure = setup({ isSecureContext: false });
  await insecure.recorder.init("u1");
  assert.equal(insecure.chip().text, "No location");
  const env = setup();
  await env.recorder.init("u1");
  env.recorder.warmUp();
  env.geolocation.emit(ORIGIN, T0);
  env.geolocation.fail(3);
  assert.deepEqual([env.recorder.getSnapshot().signal, env.chip().text, env.chip().accuracyM], ["none", "No GPS", null], "the old position's accuracy isn't shown");
  env.geolocation.fail(2);
  assert.equal(env.chip().text, "No GPS");
});

test("approximate location keeps its own chip; a finished activity no longer reads location", async () => {
  const env = setup();
  await env.recorder.init("u1");
  env.recorder.warmUp();
  for (let i = 0; i < 3; i++) env.geolocation.emit(ORIGIN, T0 + i * 1000, 1800);
  assert.deepEqual([env.chip().text, env.chip().bars, env.chip().tone], ["Approximate location", 1, "bad"]);
  env.geolocation.emit(ORIGIN, T0 + 4000, 6);
  await env.recorder.start("walk", null);
  env.setNow(T0 + 10_000);
  await env.recorder.finish(null);
  assert.deepEqual([env.recorder.getSnapshot().phase, env.chip().text], ["finished", "Location off"]);
});
