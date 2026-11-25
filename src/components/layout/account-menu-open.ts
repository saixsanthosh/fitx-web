/**
 * When the account menu (AccountMenu.tsx: the header's avatar and the desktop sidebar's account card) shows. It
 * remembers the page it was opened on, or null while closed, and shows only on that page, so a page change closes it
 * however the page changed: a link in its panel, the browser's Back or Forward (a button, a key or a swipe), Android's
 * Back, a redirect. That page is forgotten as soon as the page changes, so coming back to it later (Forward, the Home
 * link) does not open the menu again by itself, with focus moved into it; only the menu's own button opens it
 * (review of bug 73).
 *
 * No imports and no React, so it is unit-tested.
 */

/** The page the menu was opened on, or null while it is closed. */
export type MenuOpenOn = string | null;

/** What the menu remembers on `pathname`: the page it was opened on while that is still the page, otherwise nothing. */
export function menuOpenOn(openOn: MenuOpenOn, pathname: string): MenuOpenOn {
  return openOn !== null && openOn === pathname ? openOn : null;
}
