import { createClient } from "@/lib/supabase/client";
import { applyTheme, currentTheme, isThemeMode, storedTheme, type ThemeMode } from "./theme";

/**
 * Keeps the theme on the account (user_preferences.theme, migration 20261118100000) as well as on the
 * device. Before that migration is applied the column is missing: everything still works on the device,
 * and a choice made meanwhile is pushed to the account once the column exists.
 */
export type SaveResult =
  | { saved: true }
  | { saved: false; reason: "signed-out" | "not-available" | "failed" };

/** Set while this device holds a choice the account has not stored yet. */
const PENDING_KEY = "fitx-theme-pending";

function setPending(pending: boolean) {
  try {
    if (pending) window.localStorage.setItem(PENDING_KEY, "1");
    else window.localStorage.removeItem(PENDING_KEY);
  } catch {
    // Without storage the next visit simply reads the account's theme.
  }
}

function isPending() {
  try {
    return window.localStorage.getItem(PENDING_KEY) === "1";
  } catch {
    return false;
  }
}

/** "column does not exist" from Postgres (42703) or PostgREST's schema cache (PGRST204). */
function isMissingColumn(error: { code?: string } | null) {
  return error?.code === "42703" || error?.code === "PGRST204";
}

async function signedInUserId() {
  const supabase = createClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user ? { supabase, userId: data.user.id } : null;
}

export async function saveAccountTheme(mode: ThemeMode): Promise<SaveResult> {
  const session = await signedInUserId().catch(() => null);
  if (!session) {
    setPending(true);
    return { saved: false, reason: "signed-out" };
  }
  const { error } = await session.supabase
    .from("user_preferences")
    .upsert({ user_id: session.userId, theme: mode, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  setPending(Boolean(error));
  if (!error) return { saved: true };
  return { saved: false, reason: isMissingColumn(error) ? "not-available" : "failed" };
}

/**
 * Runs once when the signed-in app loads: pushes a choice this device could not save earlier, or else
 * shows the account's theme if this device is showing a different one.
 */
export async function syncAccountTheme() {
  const local = storedTheme();
  if (local && isPending()) {
    await saveAccountTheme(local);
    return;
  }
  const session = await signedInUserId().catch(() => null);
  if (!session) return;
  const { data, error } = await session.supabase.from("user_preferences").select("theme").eq("user_id", session.userId).maybeSingle();
  if (error || !data || !isThemeMode(data.theme)) return;
  if (data.theme !== currentTheme()) applyTheme(data.theme);
}
