/**
 * Keyboard focus in the exercise library when a control goes with its own press (D5; release 3 fix round 3d, open
 * item 1 of round 3c). A filter chip, Clear all, a recent search's ×, Clear recent, the search box's ×, a recent
 * search run again, the no-results suggestions and "Filter by …" each took themselves out of the page, and focus fell
 * to the page body: Tab started again at the top and a screen reader said nothing.
 *
 * Where focus goes instead. The coordinator's decision for phones: never into the search box after a press, since that
 * opens the on-screen keyboard; so on any device:
 * - a removed filter chip or recent search: its neighbour (the next one, else the one before);
 * - the last filter chip: the results heading, once the new results show (the results change);
 * - the last recent search: the Filters button, which stays where it was (the results don't change);
 * - Clear all, Clear recent, the search box's ×, a recent search run again, Show all exercises, Clear search and
 *   filters, a "Try one change" or "Did you mean" suggestion and "Filter by …": the results heading (tabIndex -1),
 *   once the new results show, so the new count is read.
 * A filter section's Clear hands focus to that section's first option (FilterPanel does it itself). Pure.
 */

/** A press of a control that goes with it, with what is needed to find its neighbour. */
export type LibraryPress =
  | { control: "remove-chip"; chips: readonly string[]; id: string }
  | { control: "forget-recent"; recent: readonly string[]; term: string }
  | { control: "clear-all" | "clear-recent" | "clear-search" | "pick-recent" | "show-all" | "clear-search-and-filters" | "relax" | "spelling" | "word-filter" };

/** Where focus goes: the results heading, a filter chip, a recent search's × or the Filters button. */
export type LibraryFocus =
  | { to: "results" }
  | { to: "chip"; id: string }
  | { to: "recent"; term: string }
  | { to: "filters" };

/** The control after the removed one in `order`, else the one before it; null when it was the only one (or not there). */
export function neighbourAfterRemoval(order: readonly string[], removed: string): string | null {
  const at = order.indexOf(removed);
  if (at < 0) return null;
  return order[at + 1] ?? (at > 0 ? order[at - 1] : null) ?? null;
}

export function libraryFocusAfter(press: LibraryPress): LibraryFocus {
  switch (press.control) {
    case "remove-chip": {
      const next = neighbourAfterRemoval(press.chips, press.id);
      return next ? { to: "chip", id: next } : { to: "results" };
    }
    case "forget-recent": {
      const next = neighbourAfterRemoval(press.recent, press.term);
      return next ? { to: "recent", term: next } : { to: "filters" };
    }
    default:
      return { to: "results" };
  }
}

/** The results heading says the new count, so focus waits until the results for the new choice are shown. */
export function waitsForResults(target: LibraryFocus): boolean {
  return target.to === "results";
}

/** The data attributes that mark the controls focus can go to (the values are member-typed text, so not selectors). */
export const LIBRARY_MARKS = { chip: "data-filter-chip", recent: "data-recent-forget" } as const;

/** The first node whose `attribute` is exactly `value`. */
export function findMarked<T extends { getAttribute(name: string): string | null }>(nodes: Iterable<T>, attribute: string, value: string): T | null {
  for (const node of nodes) if (node.getAttribute(attribute) === value) return node;
  return null;
}
