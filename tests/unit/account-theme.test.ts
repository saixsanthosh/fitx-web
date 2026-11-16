import test from "node:test";
import assert from "node:assert/strict";
import { saveAccountTheme, syncAccountTheme, type ThemeAccount, type ThemeDevice } from "@/components/ui/accountTheme";
import type { ThemeMode } from "@/components/ui/theme";

type Row = { theme: unknown; theme_updated_at: string | null };
type Write = { userId: string; mode: ThemeMode; chosenAt: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A stand-in for the account (user_preferences) with a recorded write log. */
function fakeAccount(options: { userId: string | null; rows?: Record<string, Row | null>; readError?: { code: string }; writeError?: { code: string }; readDelay?: number; writeDelay?: (mode: ThemeMode) => number }) {
  const rows: Record<string, Row | null> = { ...options.rows };
  const writes: Write[] = [];
  const state = { userId: options.userId, writeError: options.writeError ?? null };
  const account: ThemeAccount = {
    async userId() {
      return state.userId;
    },
    async read(userId) {
      if (options.readDelay) await sleep(options.readDelay);
      if (options.readError) return { row: null, error: options.readError };
      return { row: rows[userId] ?? null, error: null };
    },
    async write(userId, mode, chosenAt) {
      if (options.writeDelay) await sleep(options.writeDelay(mode));
      if (state.writeError) return { error: state.writeError };
      writes.push({ userId, mode, chosenAt });
      rows[userId] = { theme: mode, theme_updated_at: chosenAt };
      return { error: null };
    },
  };
  return { account, rows, writes, state };
}

/** A stand-in for the page and localStorage. */
function fakeDevice(options: { stored?: ThemeMode | null; storage?: Record<string, string>; now?: string } = {}) {
  const storage = new Map(Object.entries(options.storage ?? {}));
  const state = { stored: options.stored ?? null, current: options.stored ?? ("system" as ThemeMode), now: options.now ?? "2026-11-18T12:00:00.000Z" };
  const applied: ThemeMode[] = [];
  const device: ThemeDevice = {
    stored: () => state.stored,
    current: () => state.current,
    apply(mode) {
      applied.push(mode);
      state.current = mode;
      state.stored = mode;
    },
    storage: () => ({
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    }),
    now: () => new Date(state.now),
  };
  /** What a Settings click does on the page before the save is queued. */
  const choose = (mode: ThemeMode) => {
    state.current = mode;
    state.stored = mode;
  };
  return { device, storage, applied, state, choose };
}

const pending = (mode: ThemeMode, at: string) => JSON.stringify({ mode, at });

test("an account without a theme keeps this device's earlier choice and stores it (no reset to 'system')", async () => {
  const { account, writes } = fakeAccount({ userId: "u1", rows: { u1: { theme: null, theme_updated_at: null } } });
  const { device, applied, state } = fakeDevice({ stored: "dark" });
  await syncAccountTheme(account, device);
  assert.deepEqual(writes.map(({ userId, mode }) => [userId, mode]), [["u1", "dark"]]);
  assert.deepEqual(applied, []);
  assert.equal(state.current, "dark");
});

test("an account without a theme and a device without a choice stay as they are", async () => {
  const { account, writes } = fakeAccount({ userId: "u1", rows: { u1: { theme: null, theme_updated_at: null } } });
  const { device, applied } = fakeDevice();
  await syncAccountTheme(account, device);
  assert.deepEqual(writes, []);
  assert.deepEqual(applied, []);
});

test("the account's theme follows the user to this device", async () => {
  const { account, writes } = fakeAccount({ userId: "u1", rows: { u1: { theme: "light", theme_updated_at: "2026-11-17T09:00:00.000Z" } } });
  const { device, applied } = fakeDevice({ stored: "dark" });
  await syncAccountTheme(account, device);
  assert.deepEqual(applied, ["light"]);
  assert.deepEqual(writes, []);
});

test("another account's pending choice is never written to the signed-in account", async () => {
  const { account, writes } = fakeAccount({ userId: "userB", rows: { userB: { theme: "light", theme_updated_at: "2026-11-17T09:00:00.000Z" } } });
  const { device, applied, storage } = fakeDevice({ stored: "dark", storage: { "fitx-theme-pending:userA": pending("dark", "2026-11-18T11:00:00.000Z") } });
  await syncAccountTheme(account, device);
  assert.deepEqual(writes, [], "nothing is pushed into B's account");
  assert.deepEqual(applied, ["light"], "B sees B's own theme");
  assert.ok(storage.has("fitx-theme-pending:userA"), "A's choice waits for A");
});

test("a pending choice older than the account's latest one is dropped, not pushed", async () => {
  const { account, writes } = fakeAccount({ userId: "u1", rows: { u1: { theme: "light", theme_updated_at: "2026-11-18T11:00:00.000Z" } } });
  const { device, applied, storage } = fakeDevice({ stored: "dark", storage: { "fitx-theme-pending:u1": pending("dark", "2026-11-18T10:00:00.000Z") } });
  await syncAccountTheme(account, device);
  assert.deepEqual(writes, []);
  assert.deepEqual(applied, ["light"]);
  assert.equal(storage.has("fitx-theme-pending:u1"), false);
});

test("a newer pending choice is pushed once, with the time it was made, then cleared", async () => {
  const { account, writes } = fakeAccount({ userId: "u1", rows: { u1: { theme: "light", theme_updated_at: "2026-11-18T10:00:00.000Z" } } });
  const { device, applied, storage } = fakeDevice({ stored: "light", storage: { "fitx-theme-pending:u1": pending("dark", "2026-11-18T11:00:00.000Z") } });
  await syncAccountTheme(account, device);
  assert.deepEqual(writes, [{ userId: "u1", mode: "dark", chosenAt: "2026-11-18T11:00:00.000Z" }]);
  assert.deepEqual(applied, ["dark"]);
  assert.equal(storage.has("fitx-theme-pending:u1"), false);
  await syncAccountTheme(account, device);
  assert.equal(writes.length, 1, "pushed only once");
});

test("before the migration, or with no preferences row, nothing changes and the pending choice is kept", async () => {
  const missing = fakeAccount({ userId: "u1", readError: { code: "42703" } });
  const first = fakeDevice({ stored: "dark", storage: { "fitx-theme-pending:u1": pending("dark", "2026-11-18T11:00:00.000Z") } });
  await syncAccountTheme(missing.account, first.device);
  assert.deepEqual(missing.writes, []);
  assert.deepEqual(first.applied, []);
  assert.ok(first.storage.has("fitx-theme-pending:u1"));

  const noRow = fakeAccount({ userId: "u1", rows: {} });
  const second = fakeDevice({ stored: "dark" });
  await syncAccountTheme(noRow.account, second.device);
  assert.deepEqual(noRow.writes, [], "never creates a preferences row full of defaults");
});

test("a choice made while the account's theme was loading is not reverted", async () => {
  const { account } = fakeAccount({ userId: "u1", readDelay: 30, rows: { u1: { theme: "dark", theme_updated_at: "2026-11-17T09:00:00.000Z" } } });
  const { device, applied, choose, state } = fakeDevice({ stored: "system" });
  const sync = syncAccountTheme(account, device);
  await sleep(5);
  choose("light");
  await sync;
  assert.deepEqual(applied, []);
  assert.equal(state.current, "light");
});

test("saving: signed out keeps nothing pending; a failed save is pending for that account only; success clears it", async () => {
  const signedOut = fakeAccount({ userId: null });
  const a = fakeDevice({ stored: "dark" });
  const outResult = await saveAccountTheme("dark", signedOut.account, a.device);
  assert.equal(outResult.saved, false);
  assert.equal(outResult.saved === false && outResult.reason, "signed-out");
  assert.equal([...a.storage.keys()].some((key) => key.startsWith("fitx-theme-pending")), false);

  const offline = fakeAccount({ userId: "u1", writeError: { code: "PGRST204" } });
  const b = fakeDevice({ stored: "dark", now: "2026-11-18T08:30:00.000Z" });
  const failed = await saveAccountTheme("dark", offline.account, b.device);
  assert.equal(failed.saved === false && failed.reason, "not-available");
  assert.deepEqual(JSON.parse(b.storage.get("fitx-theme-pending:u1") ?? "null"), { mode: "dark", at: "2026-11-18T08:30:00.000Z" });

  offline.state.writeError = null;
  const saved = await saveAccountTheme("light", offline.account, b.device);
  assert.equal(saved.saved, true);
  assert.equal(b.storage.has("fitx-theme-pending:u1"), false);
});

test("quick successive choices are saved in order and only the last one's result counts", async () => {
  const { account, writes, rows } = fakeAccount({ userId: "u1", rows: { u1: { theme: null, theme_updated_at: null } }, writeDelay: (mode) => (mode === "dark" ? 40 : 1) });
  const { device } = fakeDevice({ stored: "light" });
  const first = saveAccountTheme("dark", account, device);
  await sleep(5);
  const second = saveAccountTheme("system", account, device);
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.deepEqual(writes.map(({ mode }) => mode), ["dark", "system"], "the slow first save cannot land last");
  assert.equal(rows.u1?.theme, "system");
  assert.equal(firstResult.stale, true);
  assert.equal(secondResult.stale, false);

  const skippedFirst = saveAccountTheme("light", account, device);
  const last = saveAccountTheme("dark", account, device);
  assert.equal((await skippedFirst).stale, true);
  assert.equal((await last).stale, false);
  assert.deepEqual(writes.map(({ mode }) => mode).slice(2), ["dark"], "a choice superseded before its turn is not saved at all");
});
