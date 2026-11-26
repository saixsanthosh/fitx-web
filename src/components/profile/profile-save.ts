/**
 * Time limits for Profile's saves (fix round 3d), the way setup's saves have them since round 3c: setup's helper
 * (src/lib/onboarding/time-limit.ts, on sign-in's withTimeLimit) does the timing and the cancelling, and only the words
 * are Profile's. Before, a save that never answered (a stalled connection, a captive portal, a server that hangs) left
 * "Saving…" or "Working…" up until the page was reloaded, with nothing said. Now each save stops waiting at its limit
 * and says so beside its buttons; the form stays open with everything as typed, and keyboard focus stays on Save, which
 * is only aria-disabled while it saves (D5).
 *
 * A save's database requests are built with its AbortSignal (withAbortSignal), and the limit cancels them, so nothing of
 * it is left on its way to land after the member's next try and put older answers back. A request the database had
 * already taken may still go through. Trying again is safe: the same answers are saved again, and a weigh-in is logged
 * only when it differs from the newest one (logWeighInOnce), so it is never logged twice.
 *
 * Reloading the profile after a save has its own limit. Past it the save still counts: the section closes and says it is
 * saved and how to see it, since the card shows the change only once the profile has reloaded.
 *
 * Pure, so node:test covers it (tests/profile/save-time-limit.test.ts).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { sameWeightKg } from "@/lib/domain/profile-options";
import { logWeighIn, syncProfileWeight } from "@/lib/domain/user-context";
import { SAVE_FAILED, SAVE_TIMED_OUT, loadWithinLimit, saveWithinLimit } from "@/lib/onboarding/time-limit";

/** How long Profile waits, in milliseconds. */
export const PROFILE_TIME_LIMIT_MS = {
  /** A save's requests, from the press of Save to the answer to the last one: setup's 20 seconds. */
  save: 20_000,
  /** Reloading the profile once a save is stored (and Try again), so the page shows what is saved. */
  reload: 20_000,
} as const;

/** What a save says beside its buttons when it runs out of time, and when it breaks off without an answer. */
export type SaveWords = { readonly timedOut: string; readonly failed: string };

/** A section's Save (Body, Goal, Training, Food, Injuries). `failed` is the sections' own message, unchanged. */
export const SECTION_SAVE: SaveWords = {
  timedOut: "Saving your changes is taking too long, so we stopped waiting. Check your connection and try again.",
  failed: "Your changes couldn't be saved. Check your connection and try again.",
};

/** The name editor's Save. */
export const NAME_SAVE: SaveWords = {
  timedOut: "Saving your name is taking too long, so we stopped waiting. Check your connection and try again.",
  failed: "Your name couldn't be saved. Try again.",
};

/** Remove photo. */
export const PHOTO_REMOVE: SaveWords = {
  timedOut: "Removing your photo is taking too long, so we stopped waiting. Check your connection and try again.",
  failed: "Your photo couldn't be removed. Try again.",
};

/**
 * Runs a Profile save within its limit. `save` builds every request with the signal it gets (withAbortSignal) and gives
 * null once everything is stored, or its own message when the database refused. The outcome is null, that message,
 * `words.timedOut` once the limit passes with no answer (what the save still has on its way is then cancelled), or
 * `words.failed` when it broke off (a request that threw).
 */
export async function saveWithin(save: (signal: AbortSignal) => PromiseLike<string | null>, words: SaveWords, ms: number = PROFILE_TIME_LIMIT_MS.save): Promise<string | null> {
  const outcome = await saveWithinLimit(save, { ms });
  if (outcome === SAVE_TIMED_OUT.page) return words.timedOut;
  if (outcome === SAVE_FAILED.page) return words.failed;
  return outcome;
}

/**
 * Waits for `work` (reloading the profile, or a clean-up after a save) at most `ms`: true when it ended in time, false
 * when it ran out of time or broke off. Nothing is cancelled: the shared profile's reload and storage's requests can't
 * be, and whatever comes back later is still used (a reload that lands late shows the change then).
 */
export function waitWithin(work: () => PromiseLike<unknown>, ms: number = PROFILE_TIME_LIMIT_MS.reload): Promise<boolean> {
  return loadWithinLimit(work, ms);
}

/** A section's status line after a save (ProfileParts SectionNotice). */
export type SavedNotice = { tone: "saved" | "note"; text: string };

/** What a section says when its save is stored but the profile didn't reload in time to show it. */
export const SAVED_NOT_SHOWN: SavedNotice = { tone: "note", text: "Saved. Reload the page to see the change." };

/** The section's own notice once the profile has reloaded in time; otherwise that it saved, and how to see it. */
export function noticeAfterReload(notice: SavedNotice, reloaded: boolean): SavedNotice {
  return reloaded ? notice : SAVED_NOT_SHOWN;
}

/** The header's status line after a name or photo save: shown once the profile has reloaded, or not yet. */
export const HEADER_SAVED = {
  name: { shown: "Name saved", notShown: "Name saved. Reload the page to see it." },
  photo: { shown: "Photo updated", notShown: "Photo updated. Reload the page to see it." },
  removed: { shown: "Photo removed", notShown: "Photo removed. Reload the page to see the change." },
} as const;

export function headerNotice(kind: keyof typeof HEADER_SAVED, reloaded: boolean): string {
  return reloaded ? HEADER_SAVED[kind].shown : HEADER_SAVED[kind].notShown;
}

/**
 * Logs today's weigh-in for a Body save, unless the newest weigh-in already has this weight (compared at the stored
 * 0.01 kg): a save that ran out of time may still have logged it, and trying again must not log it twice. profiles.weight
 * is brought up to date either way. A read that fails stops the save, whose message then says to try again.
 */
export async function logWeighInOnce(db: SupabaseClient, userId: string, weightKg: number, note: string): Promise<{ error: unknown }> {
  const prior = await db.from("body_metrics").select("weight").eq("user_id", userId).not("weight", "is", null)
    .order("date", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (prior.error) return { error: prior.error };
  const latest = prior.data ? Number((prior.data as { weight: unknown }).weight) : null;
  if (latest !== null && Number.isFinite(latest) && sameWeightKg(latest, weightKg)) {
    await syncProfileWeight(db, userId, weightKg);
    return { error: null };
  }
  const logged = await logWeighIn(db, userId, weightKg, note);
  return { error: logged.error };
}
