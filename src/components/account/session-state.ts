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

/** The two supabase.auth calls checkSessionKeepingMember makes. */
export type SessionAuth = {
  getUser(): PromiseLike<{ data: { user: { id: string } | null }; error: unknown }>;
  getSession(): PromiseLike<{ data: { session: { user?: { id?: unknown } | null } | null } }>;
};

/**
 * checkSession, plus, when the check itself failed ("unknown"), the member this browser's own session names. That is
 * read locally (getSession() needs no network while the access token is valid), so a page can still show what this
 * device keeps for that member, such as Home's quote of the day (bug 70). It is never proof of a session: only a
 * "signed_in" answer is. `auth` is null where Supabase isn't set up, which is a check that couldn't be made.
 */
export async function checkSessionKeepingMember(auth: SessionAuth | null): Promise<{ state: SessionState; userId: string | null }> {
  if (!auth) return { state: "unknown", userId: null };
  const { state, user } = await checkSession(() => auth.getUser());
  if (state !== "unknown") return { state, userId: user?.id ?? null };
  try {
    const { data } = await auth.getSession();
    const id = data.session?.user?.id;
    return { state, userId: typeof id === "string" && id ? id : null };
  } catch {
    return { state, userId: null };
  }
}

/**
 * A page's status from the shared user context's (UserContextProvider), which also reports "signed_out" when its own
 * check failed (offline, a timeout, a 5xx). The page says "signed out" only once its own check (`own`) agrees: until
 * that answer comes it is loading, and a check that failed, or that found the member signed in after all, is a load
 * failure the member can retry, never a sign-out.
 */
export function confirmSignedOut<S extends string>(shared: S, own: SessionState | null): S | "loading" | "error" {
  if (shared !== "signed_out") return shared;
  if (own === null) return "loading";
  return own === "signed_out" ? shared : "error";
}
