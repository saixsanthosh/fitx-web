/**
 * Where Nutrition puts the focus once a save has reloaded the day (D5: when an action removes the focused control,
 * the focus moves to the next sensible one). Pure, so `node --test` can check it; the page does the focusing.
 */

/**
 * The selectors to try, the first one found taking the focus. `pending`: the control that had the focus was replaced
 * or removed on purpose (an entry edited, moved, removed or put back; a saved food or routine deleted), so these
 * always take it. `ifLost`: the control may go with the reload (an empty day's "Log a food" or "Copy meals from the
 * day before" once the day has food), so these take it only when it fell to the page; otherwise it stays where it is.
 */
export function reloadFocusTargets(pending: readonly string[] | null, ifLost: readonly string[] | null, focusLost: boolean): readonly string[] {
  if (pending) return pending;
  return focusLost && ifLost ? ifLost : [];
}

/** Whether the focus has fallen to the page: the control that had it was removed (or nothing has it). */
export function focusFellToPage(active: unknown, body: unknown): boolean {
  return !active || active === body;
}

/** The controls of the message for a day that didn't load (Sign in, Try again): the page marks their row data-day-actions. */
export const DAY_ACTIONS = "[data-day-actions] a, [data-day-actions] button";

/**
 * Where the focus goes once the day's Try again has its answer (fix round 3f, D5). When the day failed again and the
 * focus fell to the page, the button pressed went with the answer (a session that ended meanwhile offers only Sign
 * in): the message's own first control takes it, else the tab's heading. Otherwise nowhere: a Try again that is still
 * there keeps the focus, the member may have moved it on, and a day that loaded hands it to its heading itself
 * (reloadFocusTargets, with the targets retryLoad sets).
 */
export function dayRetryFocusTargets(failed: boolean, focusLost: boolean): readonly string[] {
  return failed && focusLost ? [DAY_ACTIONS, "#meals-title", "#routines-title", "[data-food-add]", "#history-title"] : [];
}
