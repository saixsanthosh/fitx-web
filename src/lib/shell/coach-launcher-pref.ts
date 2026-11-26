import { saveWithinLimit, withAbortSignal } from "@/lib/onboarding/time-limit";
import { createClient } from "@/lib/supabase/client";

/**
 * The Settings switch "Floating AI Coach button": on (the default) or off for good. Stored on the account in
 * user_preferences.coach_launcher (migration 20261123100000_fitx_shell_prefs.sql), so it holds after a refresh, a
 * new sign-in or another device, and cached on this device (localStorage) so the button never flashes before the
 * account answers. Before the migration is applied the choice is kept on this device only, and Settings says so.
 * A temporary dismiss is something else: it lives in memory for one page load (CoachLauncher).
 *
 * Saving waits for the account at most LAUNCHER_SAVE_LIMIT_MS (fix round 3d): past it the request is cancelled and the
 * save counts as failed, so Settings never stays on "Saving…", and a late answer can't undo a later choice.
 */

/** How long saving the switch waits for the account: the 20 seconds Profile's saves wait. */
export const LAUNCHER_SAVE_LIMIT_MS = 20_000;

/** localStorage: "on" or "off", the last known choice on this device. */
export const COACH_LAUNCHER_CACHE_KEY = "fitx-coach-launcher";
/** Dispatched on `window` with `{ on }` when the choice changes, so a mounted launcher follows at once. */
export const COACH_LAUNCHER_PREF_EVENT = "fitx:coach-launcher-pref";

export type LauncherPrefDetail = { on: boolean };
export type LauncherPrefLoad = { on: boolean; where: "account" | "device" };
export type LauncherPrefSave = { saved: true } | { saved: false; reason: "signed-out" | "not-available" | "failed" };

type DbError = { code?: string } | null;

/** The account side: Supabase in the app, a stub in tests. */
export type LauncherAccount = {
  userId(): Promise<string | null>;
  read(userId: string): Promise<{ row: { coach_launcher?: unknown } | null; error: DbError }>;
  /** `signal`, when given, cancels the request once the save's time limit has passed. */
  write(userId: string, on: boolean, signal?: AbortSignal): Promise<{ error: DbError }>;
};

type Storageish = Pick<Storage, "getItem" | "setItem">;

const supabaseAccount: LauncherAccount = {
  async userId() {
    const supabase = createClient();
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.user.id ?? null;
  },
  async read(userId) {
    const supabase = createClient();
    if (!supabase) return { row: null, error: { code: "unavailable" } };
    const { data, error } = await supabase.from("user_preferences").select("coach_launcher").eq("user_id", userId).maybeSingle();
    return { row: (data as { coach_launcher?: unknown } | null) ?? null, error };
  },
  async write(userId, on, signal) {
    const client = createClient();
    if (!client) return { error: { code: "unavailable" } };
    const supabase = signal ? withAbortSignal(client, signal) : client;
    const { error } = await supabase
      .from("user_preferences")
      .upsert({ user_id: userId, coach_launcher: on, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    return { error };
  },
};

function browserStorage(): Storageish | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** "column does not exist": Postgres 42703 or PostgREST's schema cache PGRST204 (the migration is not applied yet). */
export function isMissingLauncherColumn(error: DbError): boolean {
  return error?.code === "42703" || error?.code === "PGRST204";
}

/** The choice cached on this device; on when nothing (or something unreadable) is stored. */
export function cachedLauncherPref(storage: Storageish | null = browserStorage()): boolean {
  try {
    return storage?.getItem(COACH_LAUNCHER_CACHE_KEY) !== "off";
  } catch {
    return true;
  }
}

function cache(storage: Storageish | null, on: boolean) {
  try {
    storage?.setItem(COACH_LAUNCHER_CACHE_KEY, on ? "on" : "off");
  } catch {
    // Storage blocked: the account still holds the choice.
  }
}

function announce(on: boolean) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<LauncherPrefDetail>(COACH_LAUNCHER_PREF_EVENT, { detail: { on } }));
}

/**
 * The account's choice, refreshing the device cache. Falls back to the cache when signed out, offline or before
 * the migration (`where: "device"`). An account without a preferences row has the default: on.
 */
export async function loadLauncherPref(account: LauncherAccount = supabaseAccount, storage: Storageish | null = browserStorage()): Promise<LauncherPrefLoad> {
  const device = { on: cachedLauncherPref(storage), where: "device" as const };
  const userId = await account.userId().catch(() => null);
  if (!userId) return device;
  const { row, error } = await account.read(userId).catch(() => ({ row: null, error: { code: "network" } }));
  if (error) return device;
  const on = row?.coach_launcher === false ? false : true;
  cache(storage, on);
  return { on, where: "account" };
}

/**
 * Saves a choice from Settings: on this device at once (and to any mounted launcher), then on the account, which is
 * waited for at most `ms` (setup's saveWithinLimit times it and cancels the request); past that it is a failed save.
 */
export async function saveLauncherPref(
  on: boolean,
  account: LauncherAccount = supabaseAccount,
  storage: Storageish | null = browserStorage(),
  ms: number = LAUNCHER_SAVE_LIMIT_MS,
): Promise<LauncherPrefSave> {
  cache(storage, on);
  announce(on);
  // The save answers null once stored, or why not; setup's helper gives its own words past the limit or when it broke off.
  const outcome = await saveWithinLimit(async (signal) => {
    const userId = await account.userId().catch(() => null);
    if (!userId) return "signed-out";
    const { error } = await account.write(userId, on, signal).catch(() => ({ error: { code: "network" } }));
    if (!error) return null;
    return isMissingLauncherColumn(error) ? "not-available" : "failed";
  }, { ms });
  if (outcome === null) return { saved: true };
  return { saved: false, reason: outcome === "signed-out" || outcome === "not-available" ? outcome : "failed" };
}
