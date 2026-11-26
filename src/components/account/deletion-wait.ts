/**
 * How long "Delete my account" waits on FITX (fix round 3d, the same mistake as Profile's saves): before, a request
 * that never answered (a stalled connection, a captive portal, a server that hangs) left "Checking your account…" up
 * for good, or held the member in the dialog on "Deleting…" with Cancel and Escape switched off.
 *
 * - The check whether the account can be deleted waits at most DELETION_TIME_LIMIT_MS.status and is cancelled then. The
 *   dialog then says it couldn't check, as it does offline.
 * - Deleting is never cancelled: once FITX has the request it deletes the account whatever this page does, and only its
 *   answer can tell this page that it did. So after DELETION_TIME_LIMIT_MS.slow the dialog says it is slow and may be
 *   closed, and the answer is still used when it comes (a deletion that went through shows "Your account is deleted").
 *
 * No React here, so node tests cover it (tests/account/delete-time-limit.test.ts).
 */
import { RECENT_SIGN_IN_MINUTES, type DeletionStatus } from "@/lib/account/deletion";

export const DELETION_TIME_LIMIT_MS = {
  /** The check whether the account can be deleted now (GET /api/account): Profile's 20 seconds. */
  status: 20_000,
  /** Deleting, before the dialog may be closed while it goes on (it stops Razorpay renewals and removes every file). */
  slow: 30_000,
} as const;

/** What the dialog says once deleting is slow; it can then be closed. */
export const DELETE_TAKING_LONG = "Deleting is taking longer than usual. You can close this now: if it goes through, you’ll be signed out. Reload the page later to check.";

/** The dialog's steps (DeleteAccount). */
export type DeletionStep = "checking" | "unavailable" | "reauth" | "switched" | "confirm" | "deleting" | "deleted" | "error";

/**
 * Whether the dialog may be closed now (Cancel, Close or Escape): not once the account is deleted (the page must move
 * on), not while signing out for "Sign in again", and while deleting only once it is slow.
 */
export function canCloseDeletion(step: DeletionStep, { leaving, slow }: { leaving: boolean; slow: boolean }): boolean {
  if (step === "deleted" || leaving) return false;
  return step !== "deleting" || slow;
}

/** `signedOut`: the session here has ended (signed out everywhere, or this page shown again by Back after Log out). */
export type StatusResult = { kind: "ok"; status: DeletionStatus; signedOut: boolean } | { kind: "outage" } | { kind: "error" };

/**
 * Whether this account can be deleted now. A signed-out answer means "sign in again". `request` is fetch (a stand-in in
 * tests); the check is cancelled after `ms`, reading the answer included, and then counts as one that failed.
 */
export async function fetchDeletionStatus(
  request: (input: string, init: RequestInit) => Promise<Response> = (input, init) => fetch(input, init),
  ms: number = DELETION_TIME_LIMIT_MS.status,
): Promise<StatusResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const response = await request("/api/account", { headers: { accept: "application/json" }, cache: "no-store", signal: controller.signal });
    if (response.status === 401) {
      return { kind: "ok", signedOut: true, status: { available: true, recentSignIn: false, signedInAt: null, windowMinutes: RECENT_SIGN_IN_MINUTES, userId: null, email: null } };
    }
    if (response.status === 503) {
      const { error } = ((await response.json().catch(() => ({}))) ?? {}) as { error?: string };
      if (error === "auth_unavailable") return { kind: "outage" };
    }
    if (!response.ok) return { kind: "error" };
    const { deletion } = (await response.json()) as { deletion: DeletionStatus };
    return { kind: "ok", status: deletion, signedOut: false };
  } catch {
    return { kind: "error" };
  } finally {
    clearTimeout(timer);
  }
}
