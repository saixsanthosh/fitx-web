import { test } from "node:test";
import assert from "node:assert/strict";
import { ActivityEngine } from "@/lib/activity/engine";
import { MemoryRecordingStore } from "@/lib/activity/local-store";
import { buildActivityRecord } from "@/lib/activity/record";
import type { SupabaseLike } from "@/lib/activity/repository";
import { prepareDeviceActivityForSignOut } from "@/lib/activity/sign-out";
import type { LogEntry } from "@/lib/activity/types";
import { ORIGIN, T0, gps, legs, moveAlong, recording } from "./support/tracks";

// What LogoutButton does with the account's GPS recordings on this device before and after signing out.

type Answer = { data: unknown; error: unknown };

/** A supabase-js stand-in: every query, whatever its chain, answers with `answer()`. */
function client(answer: () => Promise<Answer>): SupabaseLike & { tables: string[] } {
  const tables: string[] = [];
  const query = (): unknown => new Proxy(() => undefined, {
    get: (_target, property) => (property === "then"
      ? (resolve: (value: Answer) => unknown, reject: (reason: unknown) => unknown) => answer().then(resolve, reject)
      : () => query()),
  });
  return { tables, from: (table: string) => { tables.push(table); return query(); } };
}

const saved = () => Promise.resolve({ data: [{ id: "activity-1" }], error: null });
const offline = () => Promise.resolve({ data: null, error: { message: "TypeError: Failed to fetch" } });
const never = () => new Promise<Answer>(() => undefined);

function finishedRun(clientId: string) {
  const device = gps({ sigmaM: 3, accuracyM: 5, speedSigma: 0.2 }, 90);
  const run = moveAlong(legs(ORIGIN, [[0, 2500]]), { speedMps: 3, startMs: T0, device });
  const log: LogEntry[] = recording("run", run.fixes);
  const record = buildActivityRecord(ActivityEngine.replay(log), { clientId, title: "Morning run", weightKg: 70, log });
  return { clientId, userId: "u", sport: "run" as const, startedAt: record.startedAt, state: "finished" as const, updatedAt: record.endedAt, record };
}

test("uploads what it can, then clearing removes the account's recordings and stray log entries only", async () => {
  const store = new MemoryRecordingStore(true);
  await store.saveRecording(finishedRun("finished"));
  await store.saveRecording({ clientId: "theirs", userId: "someone-else", sport: "ride", startedAt: T0, state: "active", updatedAt: T0 });
  await store.appendEntries("ghost", [{ seq: 0, entry: { kind: "control", event: { type: "start", t: T0, sport: "run" } } }]);
  const db = client(saved);

  const activity = await prepareDeviceActivityForSignOut(store, db, "u");
  assert.equal(activity.notUploaded, 0, "the finished run was uploaded, so nothing would be lost");
  assert.ok(db.tables.includes("activities"));
  await activity.clear();
  assert.deepEqual(await store.listRecordings("u"), []);
  assert.deepEqual(await store.readEntries("ghost"), [], "log entries without a recording go too");
  assert.equal((await store.listRecordings("someone-else")).length, 1, "another account's recordings stay");
});

test("a recording that can't be uploaded is counted, so the member is asked before it is deleted", async () => {
  const store = new MemoryRecordingStore(true);
  await store.saveRecording(finishedRun("pending"));
  const activity = await prepareDeviceActivityForSignOut(store, client(offline), "u");
  assert.equal(activity.notUploaded, 1);
  assert.equal((await store.listRecordings("u")).length, 1, "nothing is removed before clear()");
});

test("a stalled upload never keeps anyone signed in: what is left is counted after the time limit", async () => {
  const store = new MemoryRecordingStore(true);
  await store.saveRecording(finishedRun("stuck"));
  const started = Date.now();
  const activity = await prepareDeviceActivityForSignOut(store, client(never), "u", { timeoutMs: 50 });
  assert.ok(Date.now() - started < 2000);
  assert.equal(activity.notUploaded, 1);
});

test("a recording another window has just started is counted and kept, not tidied away as a crash leftover", async () => {
  const fresh = () => ({ clientId: "live", userId: "u", sport: "walk" as const, startedAt: T0, state: "active" as const, updatedAt: T0 });
  // With no window holding it, a row whose log never started is what a crash leaves behind, and it goes.
  const leftover = new MemoryRecordingStore(true);
  await leftover.saveRecording(fresh());
  assert.equal((await prepareDeviceActivityForSignOut(leftover, client(saved), "u")).notUploaded, 0);
  // Held by another window, it is that window's live recording.
  const live = new MemoryRecordingStore(true);
  await live.saveRecording(fresh());
  const locks = { request: async () => undefined, query: async () => ({ held: [{ name: "fitx-recording:live" }] }) };
  const activity = await prepareDeviceActivityForSignOut(live, client(saved), "u", { locks });
  assert.equal(activity.notUploaded, 1);
  assert.equal((await live.listRecordings("u"))[0]?.state, "active");
});
