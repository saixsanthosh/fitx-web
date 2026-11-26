/**
 * Moving keyboard focus on once an action has replaced what held it (D5; release 3 re-check: after Finish workout or
 * Abandon focus fell to the page body). The new screen's heading says where the member now is ("Workout complete",
 * "Workout abandoned", the next exercise's name), and Tab carries on from there. Focus moves only when it was lost: a
 * member who has already moved it somewhere that is still there (the menu, say) keeps it there. Pure apart from the
 * page it is given (tests pass a plain object).
 */
export type FocusState = { activeElement: unknown; body: unknown };
type FocusableHeading = {
  tabIndex: number;
  focus(options?: { preventScroll?: boolean }): void;
  matches(selector: string): boolean;
  scrollIntoView(options?: { block?: "nearest" }): void;
};
export type HeadingLookup = FocusState & { getElementById(id: string): FocusableHeading | null };

/** True when nothing but the page itself has focus: the control that had it went away (or nothing had it). */
export function focusLost(page: FocusState): boolean {
  return !page.activeElement || page.activeElement === page.body;
}

/**
 * Focuses the heading with this id when focus was lost. A heading is not focusable by itself, so it gets tabIndex -1:
 * a script can focus it, but it is not a Tab stop. Focusing scrolls the heading into view; with `keepScroll` the page
 * stays where it is for a member using touch or a mouse, who is not following focus, and the heading is scrolled into
 * view only when the browser shows focus (after a key press). False (nothing moves) when focus is elsewhere or there
 * is no such heading.
 */
export function focusHeading(page: HeadingLookup, id: string, options: { keepScroll?: boolean } = {}): boolean {
  if (!focusLost(page)) return false;
  const heading = page.getElementById(id);
  if (!heading) return false;
  heading.tabIndex = -1;
  if (!options.keepScroll) {
    heading.focus();
    return true;
  }
  heading.focus({ preventScroll: true });
  if (focusShows(heading)) heading.scrollIntoView({ block: "nearest" });
  return true;
}

/** Whether the browser shows focus on the element (:focus-visible), as after a key press; a browser without it: yes. */
function focusShows(element: { matches(selector: string): boolean }): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return true;
  }
}
