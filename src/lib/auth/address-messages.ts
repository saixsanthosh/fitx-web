import { SUSPENDED_MESSAGE } from "@/lib/platform/account-status";

/**
 * Messages the sign-in page reads from its own address: ?error= when a sign-in comes back without one (Google, an email
 * link, a suspended account), ?signed_out= after Log out or Sign out everywhere, and ?setup= when this environment has
 * no Supabase. Each says what already happened, so once the member acts on the page (sends a code, signs in, starts
 * Google) the page stops showing them and takes ?error= and ?signed_out= out of its address (bug 44): a new code, Change
 * email or a reload never brings an old "link has expired" back. Pure, so node:test covers it; SignInForm shows them.
 */

/** ?error= values, set by /auth/callback and the proxy. Anything else in the address is ignored. */
export const ADDRESS_ERRORS: Readonly<Record<string, string>> = {
  cancelled: "Google sign-in was cancelled. Try again whenever you’re ready.",
  provider: "Google sign-in is not turned on for FITX yet. Use your email instead.",
  callback: "We couldn’t complete sign-in. Please try again.",
  browser: "That link was opened in a different browser or app. Sign in again here.",
  expired: "That link has expired or was already used. Sign in again, or ask for a new code.",
  suspended: SUSPENDED_MESSAGE,
};

export const SETUP_MISSING = "Account access is not configured in this environment yet.";

/** After Log out, which ends the session in this browser only. */
export const SIGNED_OUT_HERE = "You’re signed out on this device.";
/** After Sign out everywhere ("Sign out of FITX on every device, including this one?"), bug 42. */
export const SIGNED_OUT_EVERYWHERE = "You’re signed out everywhere, including this device.";

/** Where signing out lands: Log out ("local") and Sign out everywhere ("global") each say what they did. */
export function signedOutAddress(scope: "local" | "global"): string {
  return scope === "global" ? "/signin?signed_out=everywhere" : "/signin?signed_out=1";
}

/** The error the address carries, or "". Only known codes count: nothing else from the address is shown. */
export function addressError(search: string): string {
  const query = new URLSearchParams(search);
  const code = query.get("error");
  if (code !== null && Object.hasOwn(ADDRESS_ERRORS, code)) return ADDRESS_ERRORS[code];
  return query.has("setup") ? SETUP_MISSING : "";
}

/** The query without its one-time messages (?error=, ?signed_out=), keeping everything else: ?next= above all. */
export function withoutAddressMessages(search: string): string {
  const query = new URLSearchParams(search);
  query.delete("error");
  query.delete("signed_out");
  const rest = query.toString();
  return rest ? `?${rest}` : "";
}

/** The signed-out notice the address carries, or "". */
export function addressNotice(search: string): string {
  const value = new URLSearchParams(search).get("signed_out");
  if (value === null) return "";
  return value === "everywhere" ? SIGNED_OUT_EVERYWHERE : SIGNED_OUT_HERE;
}
