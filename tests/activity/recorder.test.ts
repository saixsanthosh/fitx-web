import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryRecordingStore } from "@/lib/activity/local-store";
import { ActivityRecorder, signalFor, toFix, WATCH_OPTIONS, type RecorderDeps } from "@/lib/activity/recorder";
import type { LatLng } from "@/lib/activity/types";
import { ORIGIN, T0, legs, pointAt } from "./support/tracks";

type Success = (position: { timestamp: number; coords: { latitude: number; longitude: number; accuracy: number; altitude: number | null; altitudeAccuracy: number | null; speed: number | null } }) => void;
type Failure = (error: { code: number }) => void;

class FakeGeolocation {
  watches = new Map<number, { success: Success; error: Failure; options: unknown }>();
  private next = 1;
  watchPosition(success: Success, error: Failure, options: unknown) {
    const id = this.next++;
    this.watches.set(id, { success, error, options });
    return id;
  }
  clearWatch(id: number) {
    this.watches.delete(id);
  }
  emit(point: LatLng, t: number, accuracy = 5, speed: number | null = null) {
    for (const watch of this.watches.values()) watch.success({ timestamp: t, coords: { latitude: point.lat, longitude: point.lng, accuracy, altitude: null, altitudeAccuracy: null, speed } });
  }
  fail(code: number) {
    for (const watch of this.watches.values()) watch.error({ code });
  }
}

class FakeTarget {
  listeners = new Map<string, Set<() => void>>();
  visibilityState = "visible";
  addEventListener(type: string, listener: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }
  dispatch(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

class FakeWakeLock {
  requests = 0;
  active: Array<{ released: boolean; release(): Promise<void>; addEventListener(type: "release", l: () => void): void; fire(): void }> = [];
  async request() {
    this.requests++;
    const listeners: Array<() => void> = [];
    const sentinel = {
      released: false,
      async release() { sentinel.released = true; },
      addEventListener(_type: "release", listener: () => void) { listeners.push(listener); },
      fire() { sentinel.released = true; for (const l of listeners) l(); },
    };
    this.active.push(sentinel);
    return sentinel;
  }
  /** What browsers do when the page is hidden. */
  releaseAll() {
    for (const s of this.active) if (!s.released) s.fire();
  }
}

function setup(overrides: Partial<RecorderDeps> = {}, store = new MemoryRecordingStore(true)) {
  let now = T0;
  const geolocation = new FakeGeolocation();
  const document = new FakeTarget();
  const window = new FakeTarget();
  const wakeLock = new FakeWakeLock();
  let ids = 0;
  const ticks: Array<() => void> = [];
  const deps: RecorderDeps = {
    geolocation,
    queryPermission: async () => ({ state: "granted" }),
    wakeLock,
    document,
    window,
    isSecureContext: true,
    store,
    now: () => now,
    randomId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    setInterval: (callback) => { ticks.push(callback); return ticks.length; },
    clearInterval: () => undefined,
    ...overrides,
  };
  const recorder = new ActivityRecorder(deps);
  return {
    recorder, geolocation, document, window, wakeLock, store, ticks,
    setNow: (value: number) => { now = value; },
    tick: () => { for (const t of ticks) t(); },
  };
}

const path = legs(ORIGIN, [[0, 3000]]);
/** Walks `env` along the path at `speed` from `fromM`, one fix a second, for `seconds`. */
function walk(env: ReturnType<typeof setup>, fromM: number, startMs: number, seconds: number, speed = 3) {
  for (let i = 0; i <= seconds; i++) {
    const t = startMs + i * 1000;
    env.setNow(t);
    env.geolocation.emit(pointAt(path, fromM + speed * i), t);
  }
  return { endMs: startMs + seconds * 1000, endM: fromM + speed * seconds };
}

test("positions are normalised; cached ones are ignored", () => {
  const fix = toFix({ timestamp: T0 - 2_000, coords: { latitude: 1, longitude: 2, accuracy: 7, altitude: Number.NaN, altitudeAccuracy: null, speed: -1 } }, T0)!;
  assert.deepEqual(fix, { t: T0 - 2_000, lat: 1, lng: 2, acc: 7, alt: null, altAcc: null, speed: null });
  assert.equal(toFix({ timestamp: T0 - 60_000, coords: { latitude: 1, longitude: 2, accuracy: 7, altitude: null, altitudeAccuracy: null, speed: null } }, T0), null);
  assert.equal(toFix({ timestamp: T0 + 5_000, coords: { latitude: 1, longitude: 2, accuracy: 7, altitude: null, altitudeAccuracy: null, speed: 2 } }, T0)!.t, T0, "a clock running ahead is clamped");
  assert.deepEqual([signalFor(null), signalFor(8), signalFor(25), signalFor(60), signalFor(900)], ["none", "good", "fair", "weak", "coarse"]);
});

test("unsupported, insecure and blocked location are reported before anything starts", async () => {
  const insecure = setup({ isSecureContext: false });
  await insecure.recorder.init("u1");
  assert.equal(insecure.recorder.getSnapshot().issue, "insecure");
  const unsupported = setup({ geolocation: null });
  await unsupported.recorder.init("u1");
  assert.equal(unsupported.recorder.getSnapshot().issue, "unsupported");
  const blocked = setup({ queryPermission: async () => ({ state: "denied" }) });
  await blocked.recorder.init("u1");
  assert.equal(blocked.recorder.getSnapshot().issue, "denied");
  assert.equal(blocked.recorder.getSnapshot().permission, "denied");
});

test("location errors: denied stops watching, timeout and unavailable keep trying", async () => {
  const env = setup({ queryPermission: null });
  await env.recorder.init("u1");
  assert.equal(env.recorder.getSnapshot().permission, "unknown");
  env.recorder.warmUp();
  assert.equal(env.geolocation.watches.size, 1);
  assert.deepEqual([...env.geolocation.watches.values()][0].options, WATCH_OPTIONS);
  env.geolocation.fail(3);
  assert.equal(env.recorder.getSnapshot().issue, "timeout");
  assert.equal(env.geolocation.watches.size, 1);
  env.geolocation.fail(2);
  assert.equal(env.recorder.getSnapshot().issue, "unavailable");
  env.geolocation.emit(ORIGIN, T0);
  assert.equal(env.recorder.getSnapshot().issue, null, "a position clears the problem");
  assert.equal(env.recorder.getSnapshot().permission, "granted");
  assert.equal(env.recorder.getSnapshot().signal, "good");
  env.geolocation.fail(1);
  assert.equal(env.recorder.getSnapshot().issue, "denied");
  assert.equal(env.geolocation.watches.size, 0);
});

test("approximate location is called out after a few fixes", async () => {
  const env = setup();
  await env.recorder.init("u1");
  env.recorder.warmUp();
  for (let i = 0; i < 3; i++) env.geolocation.emit(ORIGIN, T0 + i * 1000, 1800);
  const snap = env.recorder.getSnapshot();
  assert.equal(snap.issue, "coarse");
  assert.equal(snap.signal, "coarse");
});

test("a full recording: wake lock, screen lock gap, pause, finish, saved on the device", async () => {
  const env = setup();
  await env.recorder.init("u1");
  env.recorder.warmUp();
  env.geolocation.emit(ORIGIN, T0 - 500);
  await env.recorder.start("run", 70);
  let snap = env.recorder.getSnapshot();
  assert.equal(snap.phase, "recording");
  assert.equal(snap.wakeLock, "active");
  assert.equal(env.wakeLock.requests, 1);

  let leg = walk(env, 0, T0 + 1000, 300); // 900 m
  // The screen locks: the page is hidden, the browser releases the wake lock, no positions arrive.
  env.document.visibilityState = "hidden";
  env.document.dispatch("visibilitychange");
  env.wakeLock.releaseAll();
  assert.equal(env.recorder.getSnapshot().wakeLock, "off");
  const back = leg.endMs + 120_000;
  env.setNow(back);
  env.document.visibilityState = "visible";
  env.document.dispatch("visibilitychange");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(env.recorder.getSnapshot().wakeLock, "active", "re-acquired when the page is visible again");
  assert.equal(env.wakeLock.requests, 2);
  leg = walk(env, leg.endM + 360, back + 1000, 200);

  env.recorder.pause();
  env.setNow(leg.endMs + 60_000);
  env.geolocation.emit(pointAt(path, leg.endM + 100), leg.endMs + 60_000);
  env.recorder.resume();
  leg = walk(env, leg.endM + 100, leg.endMs + 61_000, 100);
  env.setNow(leg.endMs + 500);
  const record = await env.recorder.finish("Lunch run");
  assert.ok(record);
  assert.equal(record.title, "Lunch run");
  assert.equal(record.gapCount, 1);
  assert.ok(Math.abs(record.distanceM - 1800) < 120, `${record.distanceM}`);
  assert.ok(Math.abs(record.pausedSeconds - 60) <= 1);
  assert.ok(record.kcal !== null && record.kcal > 0);
  snap = env.recorder.getSnapshot();
  assert.equal(snap.phase, "finished");
  assert.equal(env.geolocation.watches.size, 0, "location updates stop at the finish");
  const stored = await env.store.getRecording(record.clientId);
  assert.equal(stored?.state, "finished");
  assert.equal(stored?.record?.distanceM, record.distanceM);
  const entries = await env.store.readEntries(record.clientId);
  assert.equal(entries[0].kind, "control");
  assert.equal(entries.filter((e) => e.kind === "control").map((e) => (e.kind === "control" ? e.event.type : "")).join(","), "start,hidden,visible,pause,resume,finish");
});

test("a recording survives a reload: restore, resume with the time away as a gap", async () => {
  const store = new MemoryRecordingStore(true);
  const first = setup({}, store);
  await first.recorder.init("u1");
  first.recorder.warmUp();
  await first.recorder.start("walk", null);
  const leg = walk(first, 0, T0 + 1000, 200, 1.4);
  await first.recorder.dispose(); // the tab is closed mid-walk

  const second = setup({}, store);
  const away = leg.endMs + 300_000;
  second.setNow(away);
  await second.recorder.init("u1");
  const restorable = second.recorder.getSnapshot().restorable;
  assert.ok(restorable);
  assert.equal(restorable.sport, "walk");
  assert.ok(restorable.distanceM > 200);
  assert.equal(await (async () => { const other = setup({}, store); await other.recorder.init("someone-else"); return other.recorder.getSnapshot().restorable; })(), null, "another account sees nothing");

  assert.equal(await second.recorder.resumeRestored(null), true);
  assert.equal(second.recorder.getSnapshot().phase, "recording");
  walk(second, 280 + 400, away + 1000, 100, 1.4);
  second.setNow(away + 102_000);
  const record = await second.recorder.finish(null);
  assert.ok(record);
  assert.equal(record.kcal, null, "no weight, no calories");
  assert.equal(record.title, "Morning walk");
  assert.equal(record.gaps.length, 1);
  assert.equal(record.gaps[0].kind, "hidden");
  assert.ok((record.gaps[0].end - record.gaps[0].start) / 1000 > 290);
});

test("an abandoned recording can be finished where its data ended, or discarded", async () => {
  const store = new MemoryRecordingStore(true);
  const first = setup({}, store);
  await first.recorder.init("u1");
  first.recorder.warmUp();
  await first.recorder.start("ride", 80);
  const leg = walk(first, 0, T0 + 1000, 120, 6);
  await first.recorder.dispose();

  const second = setup({}, store);
  second.setNow(leg.endMs + 86_400_000);
  await second.recorder.init("u1");
  const record = await second.recorder.finishRestored(80);
  assert.ok(record);
  assert.equal(record.endedAt, leg.endMs, "ends when the data ended, not a day later");
  assert.ok(record.elapsedSeconds <= 122);

  const third = setup({}, store);
  await third.recorder.init("u1");
  assert.equal(third.recorder.getSnapshot().restorable, null, "a finished recording is not offered again");
  await third.recorder.start("walk", null);
  const clientId = third.recorder.getSnapshot().clientId!;
  await third.recorder.discard();
  assert.equal(await store.getRecording(clientId), null);
  assert.equal(third.recorder.getSnapshot().phase, "locating");
});

test("no positions for a while on a visible page shows 'searching'", async () => {
  const env = setup();
  await env.recorder.init("u1");
  env.recorder.warmUp();
  env.geolocation.emit(ORIGIN, T0);
  await env.recorder.start("run", null);
  env.setNow(T0 + 20_000);
  env.tick();
  assert.equal(env.recorder.getSnapshot().issue, "searching");
  env.geolocation.emit(ORIGIN, T0 + 20_000);
  assert.equal(env.recorder.getSnapshot().issue, null);
});

test("without a wake lock API the screen state says so", async () => {
  const env = setup({ wakeLock: null });
  await env.recorder.init("u1");
  env.recorder.warmUp();
  await env.recorder.start("walk", null);
  assert.equal(env.recorder.getSnapshot().wakeLock, "unsupported");
});
