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
 *    the hint. A reload is a new document whose first page is the server's answer, so this can't repeat.
 * A copy shows in three ways: the browser loads the document again from the history (its disk cache), it shows a
 * document it kept whole (the back-forward cache: pageshow), or Next's router draws the page itself, with no request,
 * from what it already has: Back or Forward between pages of one document (/signin, then Terms by a link, then Back),
 * or a link to a sign-in page it prefetched while the member was signed out (static pages stay in its cache for five
 * minutes). The server answers a document once, with its own address; restoredOnMount tells the rest apart.
 * Pure, so node:test covers it; AuthScreen runs it on mount and on every pageshow.
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
 * Counts the sign-in pages one document draws: `firstDraw(page)` is true for the first page only. Each page asks with its
 * own ref and keeps its answer there, so React's development double run of effects, which asks twice, counts it once.
 */
export function drawCounter(): (page: { current: boolean | null }) => boolean {
  let drawn = false;
  return (page) => {
    if (page.current === null) {
      page.current = !drawn;
      drawn = true;
    }
    return page.current;
  };
}

/** The path and query of an address (absolute, or from the site's root), without its #fragment; null when unreadable. */
function pathAndQuery(address: string | undefined | null): string | null {
  if (!address) return null;
  try {
    const url = new URL(address, "https://fitx.invalid");
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

/**
 * Whether a sign-in page that is mounting may be a copy the server didn't just give, rather than its answer. The server
 * answers a document once: the document's first sign-in page, at the document's own address (`documentAddress`, the
 * navigation timing entry's name). A copy is:
 *  - a document loaded from the tab's history (`navigationType` back_forward);
 *  - any later sign-in page of the document (`firstDraw` false), which Next's router drew: Back or Forward inside the
 *    document, or a link;
 *  - a first one at another address than the document's: the document began on another page, and the router drew this
 *    one (a link it had prefetched).
 * An unknown document address never makes a copy: a reload must not be able to ask again for itself.
 */
export function restoredOnMount({ navigationType, firstDraw, documentAddress, address }: {
  navigationType: string | undefined | null;
  firstDraw: boolean;
  documentAddress: string | undefined | null;
  address: string;
}): boolean {
  if (loadedFromHistory(navigationType) || !firstDraw) return true;
  const began = pathAndQuery(documentAddress);
  return began !== null && began !== pathAndQuery(address);
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
