import { AUTH_HINT_COOKIE } from "./cookies";

/**
 * Back after signing in (bug 40). The sign-in pages are static, so the browser may show its own copy of one from the
 * tab's history (its disk cache, or a page kept whole in the back-forward cache) without asking the server, whose proxy
 * would have sent a signed-in member on. That copy is an empty sign-in form while the member is still signed in.
 *
 * Two things together keep that from happening, while the pages stay static:
 *  - every sign-in leaves the page with location.replace (leaveSignInPage), so the form is no longer in the history;
 *  - a page that still comes back from the history (a sign-in in another tab, Google's or an email link's round trip)
 *    asks the server again when this browser holds FITX's signed-in hint: the reload goes through the proxy, which sends
 *    a signed-in member where they were going (or to onboarding) and answers a signed-out one with the form, clearing
 *    the hint. A reload is never itself a history load, so this can't repeat.
 * Pure, so node:test covers it; AuthScreen runs it on load and on every pageshow.
 */

/** The pages the proxy turns a signed-in member away from (src/proxy.ts). /reset-password is not one: its link signs in. */
export const SIGNED_OUT_PAGES: ReadonlySet<string> = new Set(["/signin", "/signup", "/forgot-password"]);

/** True when the document's cookies carry FITX's signed-in hint: fitx_auth=1, kept while a session cookie exists. */
export function hasSignedInHint(cookie: string): boolean {
  return cookie.split(";").some((part) => part.trim() === `${AUTH_HINT_COOKIE}=1`);
}

/** A document load that came from the tab's history (Back or Forward), from the navigation timing entry's type. */
export function loadedFromHistory(navigationType: string | undefined | null): boolean {
  return navigationType === "back_forward";
}

/**
 * Whether this sign-in page, shown from the tab's history (`restored`), should ask the server again because the
 * member may be signed in.
 */
export function shouldAskServerAgain({ pathname, restored, cookie }: { pathname: string; restored: boolean; cookie: string }): boolean {
  if (!restored) return false;
  const path = pathname.replace(/\/+$/, "") || "/";
  return SIGNED_OUT_PAGES.has(path) && hasSignedInHint(cookie);
}
