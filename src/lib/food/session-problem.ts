/**
 * What Nutrition says when its sign-in check gives no member (release 3's rule, session-state.ts). "signed_out": the
 * session has ended, so it says so and offers Sign in. "unknown": the check itself failed (offline, a timeout, an auth
 * outage), so it says the session couldn't be checked and that nothing was done, never that the member is signed out;
 * the day and History offer Try again, and a log is tried again with its own button. Pure, so `node --test` can check
 * it; the page and History make the check (checkSession) and show the result.
 */
import type { SessionState } from "@/components/account/session-state";

/** What the check was for: reading the day, logging food or water, or reading History. */
export type SessionAction = "load" | "log-food" | "log-water" | "history";

export interface SessionProblem {
  text: string;
  /** Offer Sign in, coming back to Nutrition: the session has ended. */
  signIn: boolean;
  /** Offer Try again, which reads the day (or History) again: the check failed. */
  retry: boolean;
}

const SIGNED_OUT: Record<SessionAction, string> = {
  load: "You're signed out. Sign in again to track food and water.",
  "log-food": "You're signed out, so the food wasn't logged. Sign in again to log it.",
  "log-water": "You're signed out, so the water wasn't logged. Sign in again to log it.",
  history: "You're signed out. Sign in again to see your history.",
};

const UNCHECKED: Record<SessionAction, string> = {
  load: "Your session couldn't be checked just now, so this day didn't load. Try again in a moment.",
  "log-food": "Your session couldn't be checked just now, so the food wasn't logged. Try again in a moment.",
  "log-water": "Your session couldn't be checked just now, so the water wasn't logged. Try again in a moment.",
  history: "Your session couldn't be checked just now, so your history didn't load. Try again in a moment.",
};

/** The message for a check that gave no member, or null when the member is signed in. */
export function sessionProblem(state: SessionState, action: SessionAction): SessionProblem | null {
  if (state === "signed_in") return null;
  if (state === "signed_out") return { text: SIGNED_OUT[action], signIn: true, retry: false };
  return { text: UNCHECKED[action], signIn: false, retry: action === "load" || action === "history" };
}

/**
 * The message when the member is signed in but the day's own reads failed (meals, water, profile, preferences or their
 * foods), with Try again, which reads that day again (fix round 3c: it said "Please try again." with no way to, and
 * the meals line said to reload the page). `statuses`: the failed reads' HTTP statuses; 0 is supabase-js's answer to a
 * request that never reached FITX (offline, a dropped connection), so the member is asked to check their connection.
 */
export function dayReadProblem(statuses: ReadonlyArray<number | null | undefined>): SessionProblem {
  const unreached = statuses.some((status) => status === 0);
  return {
    text: unreached ? "FITX couldn't be reached, so this day didn't load. Check your connection and try again." : "This day couldn't be loaded just now. Try again in a moment.",
    signIn: false,
    retry: true,
  };
}

/**
 * What a save in a dialog says when the page has no member yet, because its sign-in check hasn't succeeded: signed out
 * only when that check said so; otherwise the check failed (an outage) or hasn't answered yet. `what` finishes "Sign in
 * again to …" ("save your own foods").
 */
export function noMemberText(state: SessionState | null, what: string): string {
  if (state === "signed_out") return `You're signed out. Sign in again to ${what}.`;
  if (state === "unknown") return "Your session couldn't be checked just now, so nothing was saved. Try again in a moment.";
  return "Your session is still being checked, so nothing was saved. Try again in a moment.";
}

/** Who a save in a dialog is for: the member (`found` when this save's own check found them), or why nothing was saved. */
export type SaveMember = { ok: true; uid: string; found: boolean } | { ok: false; refused: string; state: SessionState };

/**
 * The member a save in a dialog is for (fix round 3f). `known`: the member a day's load found. Until a load's sign-in
 * check has found one (it failed, offline or in an auth outage, or hasn't answered), the save makes the check itself,
 * as logging does, so pressing Save again in the dialog works once the check can be made, and its "Try again in a
 * moment" is true: before, only the day's Try again, behind the dialog, could ever find the member. Nothing is kept
 * from a check that gave no member, so every such save checks again.
 */
export async function memberForSave<U extends { id: string }>(
  known: string | null,
  check: () => PromiseLike<{ state: SessionState; user: U | null }>,
  what: string,
): Promise<SaveMember> {
  if (known) return { ok: true, uid: known, found: false };
  const { state, user } = await check();
  return user ? { ok: true, uid: user.id, found: true } : { ok: false, refused: noMemberText(state, what), state };
}

/** Where Sign in brings the member back to. */
export const NUTRITION_PATH = "/nutrition";
