import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COACH_LAUNCHER_CACHE_KEY,
  cachedLauncherPref,
  isMissingLauncherColumn,
  loadLauncherPref,
  saveLauncherPref,
  type LauncherAccount,
} from "@/lib/shell/coach-launcher-pref";

function memory(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return { map, getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value) };
}

function account({ userId = "u1" as string | null, row = null as { coach_launcher?: unknown } | null, readError = null as { code?: string } | null, writeError = null as { code?: string } | null } = {}) {
  const writes: Array<[string, boolean]> = [];
  const stub: LauncherAccount = {
    userId: async () => userId,
    read: async () => ({ row, error: readError }),
    write: async (id, on) => { writes.push([id, on]); return { error: writeError }; },
  };
  return { stub, writes };
}

test("the device cache: on unless it says off, and on when storage is blocked", () => {
  assert.equal(COACH_LAUNCHER_CACHE_KEY, "fitx-coach-launcher");
  assert.equal(cachedLauncherPref(memory()), true);
  assert.equal(cachedLauncherPref(memory({ [COACH_LAUNCHER_CACHE_KEY]: "off" })), false);
  assert.equal(cachedLauncherPref(memory({ [COACH_LAUNCHER_CACHE_KEY]: "garbage" })), true);
  assert.equal(cachedLauncherPref({ getItem: () => { throw new Error("blocked"); }, setItem() {} }), true);
  assert.equal(cachedLauncherPref(null), true);
});

test("the account wins and refreshes the cache; no row means the default (on)", async () => {
  const off = memory();
  assert.deepEqual(await loadLauncherPref(account({ row: { coach_launcher: false } }).stub, off), { on: false, where: "account" });
  assert.equal(off.map.get(COACH_LAUNCHER_CACHE_KEY), "off");
  const fresh = memory({ [COACH_LAUNCHER_CACHE_KEY]: "off" });
  assert.deepEqual(await loadLauncherPref(account({ row: null }).stub, fresh), { on: true, where: "account" });
  assert.equal(fresh.map.get(COACH_LAUNCHER_CACHE_KEY), "on");
});

test("signed out, offline or before the migration: the device's own choice", async () => {
  const cached = memory({ [COACH_LAUNCHER_CACHE_KEY]: "off" });
  assert.deepEqual(await loadLauncherPref(account({ userId: null }).stub, cached), { on: false, where: "device" });
  assert.deepEqual(await loadLauncherPref(account({ readError: { code: "42703" } }).stub, cached), { on: false, where: "device" });
  const broken: LauncherAccount = { userId: async () => { throw new Error("offline"); }, read: async () => ({ row: null, error: null }), write: async () => ({ error: null }) };
  assert.deepEqual(await loadLauncherPref(broken, memory()), { on: true, where: "device" });
});

test("saving: on the device at once, then on the account; a missing column says so", async () => {
  const storage = memory();
  const ok = account();
  assert.deepEqual(await saveLauncherPref(false, ok.stub, storage), { saved: true });
  assert.deepEqual(ok.writes, [["u1", false]]);
  assert.equal(storage.map.get(COACH_LAUNCHER_CACHE_KEY), "off");
  assert.deepEqual(await saveLauncherPref(true, account({ writeError: { code: "PGRST204" } }).stub, storage), { saved: false, reason: "not-available" });
  assert.equal(storage.map.get(COACH_LAUNCHER_CACHE_KEY), "on", "the device keeps the choice anyway");
  assert.deepEqual(await saveLauncherPref(true, account({ writeError: { code: "500" } }).stub, storage), { saved: false, reason: "failed" });
  assert.deepEqual(await saveLauncherPref(true, account({ userId: null }).stub, storage), { saved: false, reason: "signed-out" });
  assert.equal(isMissingLauncherColumn({ code: "42703" }), true);
  assert.equal(isMissingLauncherColumn({ code: "23505" }), false);
  assert.equal(isMissingLauncherColumn(null), false);
});
