/**
 * Whether this browser is still signed in, from a supabase.auth.getUser() answer (bug 41).
 *
 * - "signed_in": the auth server knows the session and returned its user.
 * - "signed_out": there is no session here, or the server says it has ended: signed out on every device from
 *   somewhere else, logged out in another tab, an expired or revoked session, a deleted account.
 * - "unknown": the check itself failed (offline, a timeout, a server error), so a page must say it couldn't check,
 *   never that the member is signed out, and never show an ended session as a loading failure.
 *
 * No React here, so node tests cover it (tests/account/session-state.test.ts).
 */
export type SessionState = "signed_in" | "signed_out" | "unknown";

/** Auth error codes that mean the session is over rather than that the check failed. */
const ENDED_CODES = new Set([
  "session_not_found",
  "session_expired",
  "refresh_token_not_found",
  "refresh_token_already_used",
  "user_not_found",
  "user_banned",
  "bad_jwt",
  "invalid_jwt",
  "no_authorization",
]);

type Answer = { data?: { user?: unknown } | null; error?: unknown } | null | undefined;

export function sessionState(answer: Answer): SessionState {
  const error = answer?.error ?? null;
  if (!error) return answer?.data?.user ? "signed_in" : "signed_out";
  if (typeof error !== "object") return "unknown";
  const { name, status, code } = error as { name?: unknown; status?: unknown; code?: unknown };
  // supabase-js: no session in this browser, or the server's "session_not_found" (it clears the session then).
  if (name === "AuthSessionMissingError") return "signed_out";
  // A network failure, a timeout or a 5xx: nothing is known about the session.
  if (name === "AuthRetryableFetchError" || name === "AuthUnknownError") return "unknown";
  if (typeof code === "string" && ENDED_CODES.has(code)) return "signed_out";
  if (status === 401 || status === 403) return "signed_out";
  return "unknown";
}

/** The sign-in page, bringing the member back to `next` (a path in the app) afterwards. */
export function signInHref(next: string): string {
  return `/signin?next=${encodeURIComponent(next)}`;
}

/** getUser() as a settled answer: a thrown error (not an auth error) counts as a failed check. */
export async function checkSession<U>(getUser: () => PromiseLike<{ data: { user: U | null }; error: unknown }>): Promise<{ state: SessionState; user: U | null }> {
  try {
    const answer = await getUser();
    const state = sessionState(answer);
    return { state, user: state === "signed_in" ? answer.data.user : null };
  } catch (error) {
    return { state: sessionState({ data: { user: null }, error }), user: null };
  }
}
