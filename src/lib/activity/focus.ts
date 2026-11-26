/**
 * Handing keyboard focus on after an action (D5). When the control that was pressed goes once its job is done (Show
 * older activities with nothing left, Upload now once everything is uploaded, Start once recording), the browser drops
 * focus to the page. Focus is handed on only then, or while it is still on the control that was pressed: focus the
 * member has moved somewhere else meanwhile stays where they put it. Pure (the document is passed in).
 */
export type FocusDocument = { activeElement: unknown; body: unknown };

/** Nothing has focus: it was dropped to the page, as when the focused control is removed. */
export function focusDropped(doc: FocusDocument): boolean {
  return doc.activeElement === null || doc.activeElement === undefined || doc.activeElement === doc.body;
}

/** Whether focus may be handed on from `pressed`: it is still there, or it was dropped to the page. */
export function mayHandFocus(doc: FocusDocument, pressed: unknown): boolean {
  return focusDropped(doc) || (pressed !== null && pressed !== undefined && doc.activeElement === pressed);
}

/** A control as `focusWitness` sees it: its own document says what has focus. */
export type WitnessedControl = { ownerDocument: FocusDocument };

/**
 * Some controls go without a press of them: when a sport page's figures come back by themselves (the "online" reload),
 * their alert goes with its Try again. Focus is then handed on only if it was on that control as it went, and this sees
 * whether it was. React takes a removed control's ref away before it takes the control out of
 * the page, so the ref's cleanup still finds focus on it; once it is out, the page has focus, as it does when nothing
 * had it. Give the control `ref` (one function for its whole life, so React attaches it once: take the three apart
 * where the witness is made); `element()` is the control while it is shown; `wentWithFocus()` says whether one went
 * with focus since it was last asked, then forgets it.
 */
export function focusWitness<T extends WitnessedControl>() {
  let shown: T | null = null;
  let went = false;
  return {
    ref: (element: T | null): (() => void) | undefined => {
      if (!element) return undefined;
      shown = element;
      return () => {
        if (shown === element) shown = null;
        // Only ever set here: the control drawn again meanwhile, or React's second attach in development, never
        // clears what an earlier one saw.
        if (element.ownerDocument.activeElement === element) went = true;
      };
    },
    element: (): T | null => shown,
    wentWithFocus: (): boolean => {
      const had = went;
      went = false;
      return had;
    },
  };
}

/**
 * Whether focus moves on to what took a control's place once it went: after a press of it, or when it went with focus
 * by itself; either way only while the page has focus, so focus the member moved somewhere else stays put. Without a
 * press, focus that was already on the page stays too: the member wasn't on that control.
 */
export function handsFocusOn(doc: FocusDocument, cause: { pressed: boolean; wentWithFocus: boolean }): boolean {
  return (cause.pressed || cause.wentWithFocus) && focusDropped(doc);
}
