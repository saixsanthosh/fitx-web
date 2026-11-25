/**
 * A request's failure on the sign-in pages appears right under the button that sent it, and the button keeps focus
 * (bug 80). The message is therefore always below the focused control: when the browser has just scrolled that button
 * to the bottom of what shows (Tab to it), the message starts at the very edge, below the screen or behind the open
 * privacy banner (bug 43, at 1280 x 720 on a first visit). So the message is brought into view as it appears, without
 * moving focus.
 *
 * `nearest` scrolls only when part of the message is out of view, and only as far as needed, so a message already in
 * view moves nothing, and the button above it stays in view. The scroll padding the page and the desktop form panel keep
 * for the banner while it is open (bug 79: `scroll-padding-bottom`) is the edge it stops at, so the message ends above
 * the banner.
 */
export const INTO_VIEW: ScrollIntoViewOptions = { block: "nearest", inline: "nearest" };

/** Brings `element` (a message just shown) into view, if there is a message; true when it asked the browser to. */
export function bringIntoView(element: Pick<Element, "scrollIntoView"> | null | undefined, message: string): boolean {
  if (!element || !message) return false;
  element.scrollIntoView(INTO_VIEW);
  return true;
}
