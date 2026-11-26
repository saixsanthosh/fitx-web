/** The little of an element that a sheet's focus return needs (tests pass stand-ins). */
export type FocusTarget = { isConnected: boolean; focus: (options?: FocusOptions) => void };

/**
 * Where focus goes when a Sheet closes (or unmounts while open): the control its host named with `returnFocus`, while
 * it is still on the page; otherwise the element that had focus when the sheet opened, unless that was the page itself
 * (`page`, the body) or it has left the page; otherwise nowhere, and focus stays where it is.
 *
 * A host names the control when the opener cannot be trusted to hold focus: a button that was busy (and so lost focus)
 * while the sheet was getting ready, or a click in a browser that does not focus buttons it clicks (bug 83).
 */
export function returnFocusTarget<T extends FocusTarget>(named: T | null | undefined, opener: T | null | undefined, page: unknown = null): T | null {
  if (named?.isConnected) return named;
  if (opener && opener !== page && opener.isConnected) return opener;
  return null;
}

/** The top and bottom of a box on screen, in px (as getBoundingClientRect gives them). */
export type Span = { top: number; bottom: number };

/**
 * How far to scroll a sheet's content (px, positive is down) so that `target`, the control with focus, is in full
 * view again with `gap` px to spare for its focus ring; 0 when it already is in full view. A target taller than the
 * view lines up with its top.
 *
 * A Sheet `notice` sits between the content and the actions, so the content loses that room from below and does not
 * scroll by itself: a button near the end of the content (Edit post's Save changes, a Follow button low in a followers
 * list) went out of view, focus ring and all, until the member scrolled (reg-explore-1).
 */
export function revealBy(view: Span, target: Span, gap = 12): number {
  if (target.top >= view.top && target.bottom <= view.bottom) return 0;
  if (target.top < view.top || target.bottom - target.top + 2 * gap > view.bottom - view.top) return target.top - gap - view.top;
  return target.bottom + gap - view.bottom;
}
