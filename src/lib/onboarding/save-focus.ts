/**
 * Keyboard focus when one of setup's steps fails to save (and, below, after Try again when the details didn't load).
 *
 * While a step saves, Continue (or Finish setup) is aria-disabled and setup ignores a press of it, but it stays
 * focusable: Chrome drops focus to the page from a button that becomes disabled, so a failed save used to leave the
 * member with focus nowhere and only the alert line saying why. Focus now stays where the member left it, on the
 * button or in the field where Enter was pressed.
 *
 * It moves only when it has fallen to the page anyway, which happens when the failed save replaces the field it was
 * in: a date of birth saved meanwhile (another tab, or Explore) turns the date field into the saved date. Then it goes
 * to `next` (Continue, right under the message, ready to try again). `active` and `body` are the document's focused
 * element and its body; anything else focused is left alone.
 */
export function focusAfterFailedSave<T>(active: unknown, body: unknown, next: T | null): T | null {
  return active === null || active === undefined || active === body ? next : null;
}

/**
 * Where focus goes once the member's details have loaded again after Try again. The button goes while they load, and
 * focus falls to the page with it, so when loading ends it goes to the step's heading (setup is ready) or to the new
 * Try again (loading failed again, and its message is read with it). Anything else gets nothing: while `phase` is
 * still "loading" there is nowhere to go yet, and "unavailable" has no control of its own.
 */
export function focusAfterRetry(phase: string): "heading" | "retry" | null {
  if (phase === "ready") return "heading";
  if (phase === "load_failed") return "retry";
  return null;
}
