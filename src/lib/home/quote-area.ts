/**
 * Which member Home loads the quote of the day for, and what its quote area says (bug 41 on Home; review home-1).
 *
 * The shared user context (UserContextProvider) reports "signed_out" both when the session has ended and when its own
 * check failed (offline, an auth timeout, a 5xx), so Home never takes its word for a sign-out. Whenever the context gives
 * no member (no provider, a failed load, "signed_out", no client) Home asks the session itself
 * (session-state.ts checkSessionKeepingMember), and only that check's "signed_out" makes Home say "You’re signed out".
 * A check that failed keeps the member this browser's session names, so the day's quote this device keeps (bug 70)
 * still shows during an outage; with no member at all the area says the quote could not be loaded, never "loading"
 * for ever and never "signed out".
 *
 * No React here, so node tests cover it (tests/home/home-signed-out.test.ts); DailyHome does the browser parts.
 */
import type { SessionState } from "@/components/account/session-state";
import type { UserContextStatus } from "@/components/app/UserContextProvider";

/** What the shared context says, as Home reads it; null where no provider is mounted. */
export type SharedMember = { status: UserContextStatus; userId: string | null } | null;

/** Home's own session check (checkSessionKeepingMember); null while it hasn't answered. */
export type OwnCheck = { state: SessionState; userId: string | null };

export type HomeMember = { kind: "member"; userId: string } | { kind: "waiting" } | { kind: "signed_out" } | { kind: "unknown" };

/** The context names a member it loaded (an "error" refresh keeps the last one); a "signed_out" one never does. */
function contextMember(shared: SharedMember): string | null {
  return shared?.userId && shared.status !== "signed_out" ? shared.userId : null;
}

/** Whether Home must check the session itself: the context names no member and isn't still loading. */
export function needsOwnCheck(shared: SharedMember): boolean {
  if (contextMember(shared)) return false;
  return shared?.status !== "loading";
}

/** The member Home shows the quote for, or why there is none. */
export function homeMember(shared: SharedMember, own: OwnCheck | null): HomeMember {
  const fromContext = contextMember(shared);
  if (fromContext) return { kind: "member", userId: fromContext };
  if (!needsOwnCheck(shared) || !own) return { kind: "waiting" };
  if (own.state === "signed_out") return { kind: "signed_out" };
  if (own.userId) return { kind: "member", userId: own.userId };
  return { kind: "unknown" };
}

export type QuoteArea = "quote" | "loading" | "signed_out" | "unavailable";

/**
 * What the quote area shows. `quote` is the state of the quote for the member: still loading, shown, or missing
 * (it couldn't be loaded). Only a member gets a quote; "signed out" only when Home's own check says so.
 */
export function quoteArea(member: HomeMember, quote: "loading" | "shown" | "missing"): QuoteArea {
  if (member.kind === "member") return quote === "shown" ? "quote" : quote === "loading" ? "loading" : "unavailable";
  if (member.kind === "signed_out") return "signed_out";
  return member.kind === "waiting" ? "loading" : "unavailable";
}
