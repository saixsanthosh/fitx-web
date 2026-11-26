/**
 * One refresh of the shared user context (UserContextProvider), with a time limit (fix round 3e,
 * open-3d-usercontext-refresh-limit).
 *
 * A refresh checks the session (Supabase Auth's getUser) and then loads the member's profile, preferences, latest
 * weigh-in and equipment lists (loadUserContext). Neither step had a time limit. So when a request never answered (a
 * stalled connection, a captive portal, a server that hangs), the context said "loading" for good: Home's quote area
 * kept its loading bars and never asked the session itself, and Explore's setup form stayed a skeleton. Profile already
 * stopped waiting after 20 s on its own (round 3d).
 *
 * Now the context waits USER_CONTEXT_TIME_LIMIT_MS for a refresh's answers (20 s, like setup's and Profile's loads).
 * Past that, a context that has shown nothing yet says what a failed load says: "error". Each reader then shows what it
 * shows for a failed load: the header and sidebar their own fetch, Home its own session check, Explore its form,
 * Profile its alert with Try again. A context that already shows an answer keeps it.
 *
 * Nothing is cancelled (Supabase Auth's check can't be), and the refresh keeps its ticket. So an answer that comes
 * after the limit is still used, and a late load still sets "ready", unless a newer refresh or a sign-out has replaced
 * it. An answer within the limit is used exactly as before. The promise a caller gets still settles with the answer
 * itself, so Profile's own limits (profile-save.ts waitWithin) still tell a profile that reloaded from one that didn't.
 *
 * No React here, so node:test covers it (tests/shell/user-context-refresh-limit.test.ts).
 */
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { checkSession, sharedStatusWithoutUser } from "@/components/account/session-state";
import { loadUserContext, type LoadPart, type UserContextData } from "@/lib/domain/user-context";
import { loadWithinLimit } from "@/lib/onboarding/time-limit";

export type UserContextStatus = "loading" | "ready" | "signed_out" | "unavailable" | "error";

/** How long a refresh waits for its answers before a context still loading says its load failed, in milliseconds. */
export const USER_CONTEXT_TIME_LIMIT_MS = 20_000;

/**
 * The status once a refresh has gone past its limit, or broken off, without an answer. A context still loading has
 * shown nothing yet, so it says its load failed, as a failed load does. One that shows an answer (the member's profile,
 * an ended session, an earlier failure) keeps it until the new answer comes. Profile's own wait for the shared load
 * follows the same rule (profile-save.ts statusAfterWait).
 */
export function statusPastLimit(status: UserContextStatus): UserContextStatus {
  return status === "loading" ? "error" : status;
}

/** Where a refresh puts what it finds: the provider's state setters (React's fit). */
export type UserContextSetters = {
  setStatus: (status: UserContextStatus | ((current: UserContextStatus) => UserContextStatus)) => void;
  setData: (data: UserContextData | null) => void;
  setFailedPart: (part: LoadPart | null) => void;
  /** After a load is used, in time or late: the provider notes whose it is and brings profiles.weight up to date. */
  loaded?: (data: UserContextData) => void;
};

/**
 * One refresh: checks the session, then loads the member's context, and sets what it finds. `isCurrent` says whether
 * this refresh is still the newest (the provider's ticket): one that a newer refresh or a sign-out has replaced sets
 * nothing, whenever its answer comes. Once `ms` pass without an answer, or when the refresh breaks off, the status
 * follows statusPastLimit; the answer is still used if it comes later. The promise settles with the answer, as before.
 * `load` is loadUserContext (tests pass a stand-in).
 */
export function refreshUserContext(
  supabase: SupabaseClient,
  isCurrent: () => boolean,
  set: UserContextSetters,
  { ms = USER_CONTEXT_TIME_LIMIT_MS, load = loadUserContext }: { ms?: number; load?: typeof loadUserContext } = {},
): Promise<void> {
  const answer = (async () => {
    // "signed_out" only for a session that has ended; a check that failed (offline, a timeout, a 5xx) is "error", so
    // no reader says "signed out" to a member who is still signed in (bug 41; session-state.ts).
    const { state, user } = await checkSession<User>(() => supabase.auth.getUser());
    if (!isCurrent()) return;
    if (!user) {
      set.setData(null);
      set.setFailedPart(null);
      set.setStatus(sharedStatusWithoutUser(state));
      return;
    }
    const result = await load(supabase, { id: user.id, email: user.email ?? null });
    if (!isCurrent()) return;
    if (result.error) {
      set.setFailedPart(result.error.part);
      set.setStatus("error");
      return;
    }
    set.setData(result.data);
    set.setFailedPart(null);
    set.setStatus("ready");
    set.loaded?.(result.data);
  })();
  // The limit only decides what the context says meanwhile: nothing is cancelled and the ticket stays, so a late answer
  // above still lands.
  void loadWithinLimit(() => answer, ms).then((ended) => {
    if (!ended) set.setStatus(statusPastLimit);
  });
  return answer;
}
