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
