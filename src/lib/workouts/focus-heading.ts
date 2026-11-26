/**
 * Moving keyboard focus on once an action has replaced what held it (D5; release 3 re-check: after Finish workout or
 * Abandon focus fell to the page body). The new screen's heading says where the member now is ("Workout complete",
 * "Workout abandoned"), and Tab carries on from there. Focus moves only when it was lost: a member who has already
 * moved it somewhere that is still there (the menu, say) keeps it there. Pure apart from the page it is given (tests
 * pass a plain object).
 */
export type FocusState = { activeElement: unknown; body: unknown };
export type HeadingLookup = FocusState & { getElementById(id: string): { tabIndex: number; focus(): void } | null };

/** True when nothing but the page itself has focus: the control that had it went away (or nothing had it). */
export function focusLost(page: FocusState): boolean {
  return !page.activeElement || page.activeElement === page.body;
}

/**
 * Focuses the heading with this id when focus was lost. A heading is not focusable by itself, so it gets tabIndex -1:
 * a script can focus it, but it is not a Tab stop. False (nothing moves) when focus is elsewhere or there is no such
 * heading.
 */
export function focusHeading(page: HeadingLookup, id: string): boolean {
  if (!focusLost(page)) return false;
  const heading = page.getElementById(id);
  if (!heading) return false;
  heading.tabIndex = -1;
  heading.focus();
  return true;
}
