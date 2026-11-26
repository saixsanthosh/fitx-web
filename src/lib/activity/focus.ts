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
