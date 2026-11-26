// Fix round 3d (open-3c-profile-save-timeout): Settings' own saves had no time limit either. A theme choice or the
// "Floating AI Coach button" switch whose request never answered left "Saving…" under it for good, and a stalled theme
// save held up every later choice (they run one at a time). Each now waits for the account 20 s at most, with its
// request cancelled then (src/components/ui/accountTheme.ts, src/lib/shell/coach-launcher-pref.ts), and Settings shows
// the existing "Saved on this device…" message, which is true: the device keeps the choice, and a theme the account
// never confirmed is pending, so the next signed-in load pushes it.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { THEME_TIME_LIMIT_MS, saveAccountTheme, syncAccountTheme, type ThemeAccount, type ThemeDevice } from "@/components/ui/accountTheme";
import type { ThemeMode } from "@/components/ui/theme";
import { COACH_LAUNCHER_CACHE_KEY, LAUNCHER_SAVE_LIMIT_MS, saveLauncherPref, type LauncherAccount } from "@/lib/shell/coach-launcher-pref";

const read = (file: string) => readFileSync(new URL(`../../src/${file}`, import.meta.url), "utf8");
const never = () => new Promise<never>(() => {});
const turn = () => new Promise((resolve) => setImmediate(resolve));

/** This browser: localStorage and the page's theme. */
function device() {
  const storage = new Map<string, string>();
  const state = { current: "dark" as ThemeMode };
  const page: ThemeDevice = {
    stored: () => state.current,
    current: () => state.current,
    apply: (mode) => { state.current = mode; },
    storage: () => ({ getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => void storage.set(key, value), removeItem: (key) => void storage.delete(key) }),
    now: () => new Date("2026-11-26T10:00:00.000Z"),
  };
  return { page, storage, state };
}

/** The account: `hang` makes every request wait until its signal is aborted. */
function themeAccount() {
  const signals: AbortSignal[] = [];
  const control = { hangWrites: true, hangReads: false };
  const untilAborted = (signal?: AbortSignal) => new Promise<{ error: { code: string } }>((resolve) => signal?.addEventListener("abort", () => resolve({ error: { code: "aborted" } }), { once: true }));
  const account: ThemeAccount = {
    userId: async () => "u1",
    read: (_userId, signal) => {
      if (signal) signals.push(signal);
      return control.hangReads ? untilAborted(signal).then(({ error }) => ({ row: null, error })) : Promise.resolve({ row: { theme: "light", theme_updated_at: "2026-11-25T10:00:00.000Z" }, error: null });
    },
    write: (_userId, _mode, _chosenAt, signal) => {
      if (signal) signals.push(signal);
      return control.hangWrites ? untilAborted(signal) : Promise.resolve({ error: null });
    },
  };
  return { account, signals, control };
}

describe("a theme choice waits for the account 20 s at most", () => {
  test("a save that never answers stops at the limit, not before, is cancelled, and stays pending on this device", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { account, signals, control } = themeAccount();
    const { page, storage } = device();
    let settled = false;
    const saving = saveAccountTheme("dark", account, page);
    void saving.then(() => { settled = true; });
    await turn();
    assert.deepEqual(JSON.parse(storage.get("fitx-theme-pending:u1") ?? "null"), { mode: "dark", at: "2026-11-26T10:00:00.000Z" }, "pending before the request answers");
    t.mock.timers.tick(THEME_TIME_LIMIT_MS - 1);
    await turn();
    assert.equal(settled, false, "still waiting a moment before the limit");
    assert.equal(signals[0].aborted, false);
    t.mock.timers.tick(1);
    // Settings: "Saved on this device. We couldn’t reach your account, so we’ll try again next time you open FITX."
    assert.deepEqual(await saving, { saved: false, reason: "failed", stale: false });
    assert.equal(signals[0].aborted, true, "the request is cancelled");
    assert.ok(storage.has("fitx-theme-pending:u1"), "so the next signed-in load pushes it");

    control.hangWrites = false;
    assert.deepEqual(await saveAccountTheme("light", account, page), { saved: true, stale: false }, "the next choice is not held up");
    assert.equal(storage.has("fitx-theme-pending:u1"), false, "and a save that worked clears it");
  });

  test("an on-load sync that never answers changes nothing at its limit and doesn't hold up a choice made meanwhile", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { account, signals, control } = themeAccount();
    control.hangReads = true;
    control.hangWrites = false;
    const { page, state } = device();
    const sync = syncAccountTheme(account, page);
    const saving = saveAccountTheme("system", account, page);
    await turn();
    t.mock.timers.tick(THEME_TIME_LIMIT_MS);
    assert.equal(await sync, undefined, "it gives up quietly");
    assert.equal(signals[0].aborted, true, "its read is cancelled");
    assert.equal(state.current, "dark", "nothing on this device changed");
    assert.deepEqual(await saving, { saved: true, stale: false });
  });

  test("the account's requests carry the signal", () => {
    const theme = read("components/ui/accountTheme.ts");
    assert.equal(theme.match(/const supabase = signal \? withAbortSignal\(client, signal\) : client;/g)?.length, 2, "read and write");
    assert.match(theme, /writePending\(device, userId, \{ mode, at: chosenAt \}\);\s*const \{ error \} = await account\.write\(userId, mode, chosenAt, signal\)/);
    assert.equal(THEME_TIME_LIMIT_MS, 20_000);
    const settings = read("app/(dashboard)/settings/SettingsAppearance.tsx");
    assert.match(settings, /failed: "Saved on this device\. We couldn’t reach your account, so we’ll try again next time you open FITX\.",/);
  });
});

describe("the Floating AI Coach button switch waits for the account 20 s at most", () => {
  function launcherAccount(write: LauncherAccount["write"]) {
    const account: LauncherAccount = { userId: async () => "u1", read: async () => ({ row: null, error: null }), write };
    return account;
  }
  const memory = () => {
    const map = new Map<string, string>();
    return { map, getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value) };
  };

  test("a save that never answers stops at the limit, not before, and is cancelled; this device keeps the choice", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const signals: AbortSignal[] = [];
    const storage = memory();
    let settled = false;
    const saving = saveLauncherPref(false, launcherAccount((_userId, _on, signal) => {
      if (signal) signals.push(signal);
      return never();
    }), storage);
    void saving.then(() => { settled = true; });
    await turn();
    assert.equal(storage.map.get(COACH_LAUNCHER_CACHE_KEY), "off", "on this device at once");
    t.mock.timers.tick(LAUNCHER_SAVE_LIMIT_MS - 1);
    await turn();
    assert.equal(settled, false);
    assert.equal(signals[0].aborted, false);
    t.mock.timers.tick(1);
    // Settings: "Saved on this device. We couldn’t reach your account, so try again later."
    assert.deepEqual(await saving, { saved: false, reason: "failed" });
    assert.equal(signals[0].aborted, true, "so a late answer can't undo a later choice");
  });

  test("answers in time keep their own outcome, and a write that breaks off is a failed save", async () => {
    const storage = memory();
    assert.deepEqual(await saveLauncherPref(true, launcherAccount(async () => ({ error: null })), storage), { saved: true });
    assert.deepEqual(await saveLauncherPref(true, launcherAccount(async () => ({ error: { code: "PGRST204" } })), storage), { saved: false, reason: "not-available" });
    assert.deepEqual(await saveLauncherPref(true, launcherAccount(async () => { throw new Error("offline"); }), storage), { saved: false, reason: "failed" });
    const signedOut: LauncherAccount = { userId: async () => null, read: async () => ({ row: null, error: null }), write: async () => ({ error: null }) };
    assert.deepEqual(await saveLauncherPref(true, signedOut, storage), { saved: false, reason: "signed-out" });
    assert.equal(LAUNCHER_SAVE_LIMIT_MS, 20_000);
    const pref = read("lib/shell/coach-launcher-pref.ts");
    assert.match(pref, /const supabase = signal \? withAbortSignal\(client, signal\) : client;/);
    assert.match(read("app/(dashboard)/settings/SettingsCoachLauncher.tsx"), /failed: "Saved on this device\. We couldn’t reach your account, so try again later\.",/);
  });
});

describe("Settings > Account's check says when it can't load the details", () => {
  test("past 20 s it shows the existing could-not-be-loaded line, and a later answer still shows the account", () => {
    const account = read("app/(dashboard)/settings/SettingsAccount.tsx");
    assert.match(account, /const overdue = window\.setTimeout\(\(\) => \{\s*if \(live && mine === ticket\) setView\(\(current\) => \(current\.kind === "loading" \? \{ kind: "failed" \} : current\)\);\s*\}, PROFILE_TIME_LIMIT_MS\.reload\);/);
    assert.match(account, /const amr = state === "signed_in" \? await sessionAmr\(supabase\) : \[\];\s*window\.clearTimeout\(overdue\);\s*if \(!live \|\| mine !== ticket\) return;/, "an answer that comes later still counts");
    assert.match(account, /"Your account details could not be loaded\. Reload to try again\."/);
  });
});
