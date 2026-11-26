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
import { withTimeLimit } from "@/lib/auth/time-limit";

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

/** The two supabase.auth calls checkSessionKeepingMember makes. */
export type SessionAuth = {
  getUser(): PromiseLike<{ data: { user: { id: string } | null }; error: unknown }>;
  getSession(): PromiseLike<{ data: { session: { user?: { id?: unknown } | null } | null } }>;
};

/**
 * How long checkSessionKeepingMember waits, in milliseconds: the shared user context's 20 s
 * (user-context-refresh.ts USER_CONTEXT_TIME_LIMIT_MS), which Home has already waited out when it checks itself.
 */
export const SESSION_CHECK_TIME_LIMIT_MS = 20_000;

/**
 * checkSession, plus, when the check itself failed ("unknown"), the member this browser's own session names. That is
 * read locally (getSession() needs no network while the access token is valid), so a page can still show what this
 * device keeps for that member, such as Home's quote of the day (bug 70). It is never proof of a session: only a
 * "signed_in" answer is. `auth` is null where Supabase isn't set up, which is a check that couldn't be made.
 *
 * The check and the session read each wait `ms` at most, side by side, so the whole check ends within `ms` (fix round
 * 3f: with neither limited, Home's quote area kept its loading lines for good on a stalled connection, a captive portal
 * or an auth server that hangs). A check with no answer by then counts as one that failed ("unknown"); a session read
 * with none (renewing an expired access token over the same connection) names no member. Supabase Auth's requests
 * can't be cancelled: a late answer is dropped, and one that finds the session ended still reaches the page as auth's
 * SIGNED_OUT event.
 */
export async function checkSessionKeepingMember(auth: SessionAuth | null, ms: number = SESSION_CHECK_TIME_LIMIT_MS): Promise<{ state: SessionState; userId: string | null }> {
  if (!auth) return { state: "unknown", userId: null };
  // Read beside the check rather than after it, so a check that runs out of time still has it within the same limit.
  const local = sessionMember(auth, ms);
  const { state, user } = await checkSession(() => withTimeLimit(auth.getUser(), ms));
  if (state !== "unknown") return { state, userId: user?.id ?? null };
  return { state, userId: await local };
}

/** The member this browser's own session names, read within `ms`: null for none, a read that failed, or no answer in time. */
async function sessionMember(auth: SessionAuth, ms: number): Promise<string | null> {
  try {
    const { data } = await withTimeLimit(auth.getSession(), ms);
    const id = data.session?.user?.id;
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

/**
 * The shared user context's status (UserContextProvider) when its check gave no user: "signed_out" only for a session
 * that has ended; a check that failed is "error", which no reader shows as a sign-out.
 */
export function sharedStatusWithoutUser(state: SessionState): "signed_out" | "error" {
  return state === "signed_out" ? "signed_out" : "error";
}

/**
 * A page's status from the shared user context's (UserContextProvider), which reports "signed_out" for an ended session
 * and "error" for a check that failed (offline, a timeout, a 5xx); before release 3 it said "signed_out" for both. The
 * page says "signed out" only once its own check (`own`) agrees: until that answer comes it is loading, and a check
 * that failed, or that found the member signed in after all, is a load failure the member can retry, never a sign-out.
 */
export function confirmSignedOut<S extends string>(shared: S, own: SessionState | null): S | "loading" | "error" {
  if (shared !== "signed_out") return shared;
  if (own === null) return "loading";
  return own === "signed_out" ? shared : "error";
}
