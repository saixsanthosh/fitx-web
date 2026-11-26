import { withTimeLimit } from "@/lib/auth/time-limit";
import { withAbortSignal } from "@/lib/onboarding/time-limit";
import { createClient } from "@/lib/supabase/client";
import { applyTheme, currentTheme, isThemeMode, storedTheme, type ThemeMode } from "./theme";

/**
 * Keeps the theme on the account (user_preferences.theme and theme_updated_at, migration
 * 20261118100000) as well as on the device.
 *
 * - A choice in Settings is saved to the account at once. If that fails (offline, or before the
 *   migration is applied) it stays pending on this device for that account only, with the time it was
 *   made. A later signed-in load of the same account pushes it, unless the account has a newer choice.
 * - An account with no theme yet (theme NULL) keeps the device's earlier choice, for example one made
 *   with the old header toggle, and stores it; it never resets it.
 * - Otherwise the account's theme is shown on this device, so a choice follows the user.
 * - Saves and the on-load sync run one at a time, and a choice made while the account's theme was
 *   loading is never overwritten by it.
 * - Each of them waits for the account at most THEME_TIME_LIMIT_MS, and its requests are cancelled past it (fix round
 *   3d), so one that never answers can't leave Settings on "Saving…" or hold up the work queued after it. A choice is
 *   pending on the device before its request goes, so one the account never confirmed is still pushed on a later load.
 */

/** How long a theme save, or the on-load sync, waits for the account: the 20 seconds Profile's saves wait. */
export const THEME_TIME_LIMIT_MS = 20_000;

export type SaveResult = { stale: boolean } & ({ saved: true } | { saved: false; reason: "signed-out" | "not-available" | "failed" });

type DbError = { code?: string } | null;
type ThemeRow = { theme: unknown; theme_updated_at: string | null };

/** The account side: Supabase in the app, a stub in tests. */
export type ThemeAccount = {
  userId(): Promise<string | null>;
  /** `signal`, when given, cancels the request once its task's time limit has passed (so does write's). */
  read(userId: string, signal?: AbortSignal): Promise<{ row: ThemeRow | null; error: DbError }>;
  write(userId: string, mode: ThemeMode, chosenAt: string, signal?: AbortSignal): Promise<{ error: DbError }>;
};

/** The device side: the page and localStorage in the app, plain objects in tests. */
export type ThemeDevice = {
  stored(): ThemeMode | null;
  current(): ThemeMode;
  apply(mode: ThemeMode): void;
  storage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  now(): Date;
};

const supabaseAccount: ThemeAccount = {
  async userId() {
    const supabase = createClient();
    if (!supabase) return null;
    // From the stored session, so it works offline too; every write is still checked by RLS.
    const { data } = await supabase.auth.getSession();
    return data.session?.user.id ?? null;
  },
  async read(userId, signal) {
    const client = createClient();
    if (!client) return { row: null, error: { code: "unavailable" } };
    const supabase = signal ? withAbortSignal(client, signal) : client;
    const { data, error } = await supabase.from("user_preferences").select("theme, theme_updated_at").eq("user_id", userId).maybeSingle();
    return { row: (data as ThemeRow | null) ?? null, error };
  },
  async write(userId, mode, chosenAt, signal) {
    const client = createClient();
    if (!client) return { error: { code: "unavailable" } };
    const supabase = signal ? withAbortSignal(client, signal) : client;
    const { error } = await supabase
      .from("user_preferences")
      .upsert({ user_id: userId, theme: mode, theme_updated_at: chosenAt, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    return { error };
  },
};

const browserDevice: ThemeDevice = {
  stored: storedTheme,
  current: currentTheme,
  apply: applyTheme,
  storage: () => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  },
  now: () => new Date(),
};

type Pending = { mode: ThemeMode; at: string };
const pendingKey = (userId: string) => `fitx-theme-pending:${userId}`;

function readPending(device: ThemeDevice, userId: string): Pending | null {
  try {
    const raw = device.storage()?.getItem(pendingKey(userId));
    const value = raw ? (JSON.parse(raw) as Partial<Pending>) : null;
    return value && isThemeMode(value.mode) && typeof value.at === "string" && !Number.isNaN(Date.parse(value.at)) ? { mode: value.mode, at: value.at } : null;
  } catch {
    return null;
  }
}

function writePending(device: ThemeDevice, userId: string, pending: Pending | null) {
  try {
    const storage = device.storage();
    if (pending) storage?.setItem(pendingKey(userId), JSON.stringify(pending));
    else storage?.removeItem(pendingKey(userId));
  } catch {
    // Without storage, the choice still shows on this device; the account keeps its own.
  }
}

/** "column does not exist" from Postgres (42703) or PostgREST's schema cache (PGRST204). */
function isMissingColumn(error: DbError) {
  return error?.code === "42703" || error?.code === "PGRST204";
}

const offline = { code: "network" };

/**
 * Runs theme work one task at a time, in order. A task gets `ms` from its start: past that its promise rejects (sign-in's
 * withTimeLimit), the requests it built with `signal` are cancelled, and the next task runs.
 */
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const run = queue.then(() => {
    const controller = new AbortController();
    return withTimeLimit(task(controller.signal), ms).catch((problem: unknown) => {
      controller.abort();
      throw problem;
    });
  });
  queue = run.catch(() => undefined);
  return run;
}
let latestChoice = 0;

/**
 * Saves a choice made in Settings. A result is `stale` when a newer choice was made meanwhile. An account that doesn't
 * answer within `ms` is a failed save: its request is cancelled and the choice stays pending on this device.
 */
export function saveAccountTheme(mode: ThemeMode, account: ThemeAccount = supabaseAccount, device: ThemeDevice = browserDevice, ms: number = THEME_TIME_LIMIT_MS): Promise<SaveResult> {
  const choice = ++latestChoice;
  const chosenAt = device.now().toISOString();
  return enqueue(async (signal): Promise<SaveResult> => {
    // A newer choice is queued behind this one, and only that one needs saving.
    if (choice !== latestChoice) return { saved: true, stale: true };
    const userId = await account.userId().catch(() => null);
    if (!userId) return { saved: false, reason: "signed-out", stale: choice !== latestChoice };
    // Pending before the request goes, so a request that never answers (or a page closed meanwhile) leaves it to push.
    writePending(device, userId, { mode, at: chosenAt });
    const { error } = await account.write(userId, mode, chosenAt, signal).catch(() => ({ error: offline }));
    if (!error) writePending(device, userId, null);
    const stale = choice !== latestChoice;
    return error ? { saved: false, reason: isMissingColumn(error) ? "not-available" : "failed", stale } : { saved: true, stale };
  }, ms).catch((): SaveResult => ({ saved: false, reason: "failed", stale: choice !== latestChoice }));
}

/**
 * Runs once when the signed-in app loads (see ShellEffects). An account that doesn't answer within `ms` changes
 * nothing: its requests are cancelled and a pending choice stays pending.
 */
export function syncAccountTheme(account: ThemeAccount = supabaseAccount, device: ThemeDevice = browserDevice, ms: number = THEME_TIME_LIMIT_MS): Promise<void> {
  return enqueue(async (signal) => {
    const userId = await account.userId().catch(() => null);
    if (!userId) return;
    const shownBefore = device.current();
    const { row, error } = await account.read(userId, signal).catch(() => ({ row: null, error: offline }));
    // Missing columns, offline, or no preferences row yet (never create one here): change nothing.
    if (error || !row) return;
    const show = (mode: ThemeMode) => {
      // A choice made while the account's theme was loading wins over it.
      if (device.current() === shownBefore && device.current() !== mode) device.apply(mode);
    };
    const accountMode = isThemeMode(row.theme) ? row.theme : null;
    const pending = readPending(device, userId);
    if (pending) {
      const accountChosenAt = row.theme_updated_at ? Date.parse(row.theme_updated_at) : Number.NaN;
      if (accountMode && accountChosenAt > Date.parse(pending.at)) {
        // Another device saved a newer choice: it wins and this device's older one is dropped.
        writePending(device, userId, null);
        show(accountMode);
        return;
      }
      const { error: pushError } = await account.write(userId, pending.mode, pending.at, signal).catch(() => ({ error: offline }));
      if (!pushError) writePending(device, userId, null);
      show(pending.mode);
      return;
    }
    if (!accountMode) {
      // No theme on the account yet: keep the device's earlier choice and store it on the account.
      const local = device.stored();
      if (local) await account.write(userId, local, device.now().toISOString(), signal).catch(() => undefined);
      return;
    }
    show(accountMode);
  }, ms).catch(() => undefined);
}
