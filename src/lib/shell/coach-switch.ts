import { createClient } from "@/lib/supabase/client";

/**
 * The FITX Admin switch "AI coach" (platform_settings.features.ai_coach), as the browser sees it. While it is off the
 * proxy closes the coach page and its chat, swap and actions APIs (src/lib/platform/gate.ts), so the floating AI Coach
 * button hides too: it would only open a coach that cannot answer. Read with the member's own session (the table is
 * readable by every signed-in account), at most once a minute per page load, and cached on this device so the button
 * does not flash before the answer. Any failure means on, as the server's gate fails open.
 */

/** localStorage: "off" while the last read said the coach is switched off. */
export const COACH_SWITCH_CACHE_KEY = "fitx-coach-switch";
const FRESH_MS = 60_000;

/** The settings row's `features` object, or an error. Supabase in the app, a stub in tests. */
export type CoachSwitchSource = () => Promise<{ features: unknown; error: unknown }>;
type Storageish = Pick<Storage, "getItem" | "setItem">;

const supabaseSource: CoachSwitchSource = async () => {
  const supabase = createClient();
  if (!supabase) return { features: null, error: { code: "unavailable" } };
  const { data, error } = await supabase.from("platform_settings").select("features").eq("id", 1).maybeSingle();
  return { features: (data as { features?: unknown } | null)?.features ?? null, error };
};

function browserStorage(): Storageish | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The answer cached on this device: on unless it says off. */
export function cachedCoachSwitch(storage: Storageish | null = browserStorage()): boolean {
  try {
    return storage?.getItem(COACH_SWITCH_CACHE_KEY) !== "off";
  } catch {
    return true;
  }
}

/** On unless the saved features say `ai_coach: false` (the same rule as parsePlatformSettings). */
export function coachOnIn(features: unknown): boolean {
  return !(features && typeof features === "object" && (features as Record<string, unknown>).ai_coach === false);
}

let memo: { at: number; on: Promise<boolean> } | null = null;

/** For tests: forget the last read. */
export function resetCoachSwitch() {
  memo = null;
}

/** Whether the AI Coach is switched on in FITX Admin, refreshing the device cache. */
export function loadCoachSwitch(source: CoachSwitchSource = supabaseSource, storage: Storageish | null = browserStorage(), now = Date.now()): Promise<boolean> {
  if (memo && now - memo.at < FRESH_MS) return memo.on;
  const on = source()
    .then(({ features, error }) => {
      if (error) return cachedCoachSwitch(storage);
      const value = coachOnIn(features);
      try {
        storage?.setItem(COACH_SWITCH_CACHE_KEY, value ? "on" : "off");
      } catch {
        // Storage blocked: the answer holds for this page load.
      }
      return value;
    })
    .catch(() => cachedCoachSwitch(storage));
  memo = { at: now, on };
  return on;
}
