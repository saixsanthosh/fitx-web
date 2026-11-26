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

/** Whether `control` has focus now (never when there is no control). */
export function hasFocus(doc: FocusDocument, control: unknown): boolean {
  return control !== null && control !== undefined && doc.activeElement === control;
}

/** A control as `focusWitness` sees it: its own document says what has focus. */
export type WitnessedControl = { ownerDocument: FocusDocument };

/**
 * Some controls go without a press of them: when a sport page's figures come back by themselves (the "online" reload),
 * their alert goes with its Try again, and on Activity the same reload takes Upload now and the history's Try again
 * away while it uploads and reads. Focus is then handed on only if it was on that control as it went, and this sees
 * whether it was. React takes a removed control's ref away before it takes the control out of the page, so the ref's
 * cleanup still finds focus on it; once it is out, the page has focus, as it does when nothing had it. Give the control
 * `ref` (one function for its whole life, so React attaches it once: take the three apart where the witness is made);
 * `element()` is the control while it is shown; `wentWithFocus()` says whether one went with focus since it was last
 * asked, then forgets it.
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
        if (hasFocus(element.ownerDocument, element)) went = true;
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

/** What in Activity's history list had focus as it went: an entry (by its timeline key), or one of the list's buttons. */
export type ListFocus = { entry: string } | { control: "older" | "sessions" };

/** A control in the history list as `listFocusWitness` sees it: whether it is still on the page, and what it is. */
export type ListControl = WitnessedControl & { isConnected: boolean; dataset: { feedEntry?: string; feedControl?: string } };

/**
 * The history list's entries, "Show older activities" and the strength sessions' Try again can go while one has focus,
 * without a press of it: the list is read again (back online, Upload now, the figures' Try again), drawn from its
 * loading state, or an entry is gone from the account. One ref serves all of them: each says what it is
 * (data-feed-entry, or data-feed-control "older" or "sessions"). React takes a removed control's ref away while the
 * control is still on the page (focusWitness), so the ref's cleanup sees whether it had focus. `take()` says what went
 * with focus since it was last asked, then forgets it; a control still on the page (its ref only given again, as a
 * link's is when its address changes) says nothing.
 */
export function listFocusWitness<T extends ListControl>() {
  let went: { element: T; what: ListFocus } | null = null;
  return {
    ref: (element: T | null): (() => void) | undefined => {
      if (!element) return undefined;
      return () => {
        if (!hasFocus(element.ownerDocument, element)) return;
        const { feedEntry, feedControl } = element.dataset;
        if (feedEntry) went = { element, what: { entry: feedEntry } };
        else if (feedControl === "older" || feedControl === "sessions") went = { element, what: { control: feedControl } };
      };
    },
    take: (): ListFocus | null => {
      const had = went;
      went = null;
      return had && !had.element.isConnected ? had.what : null;
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

/** Activity's banner buttons: Upload now (activities not uploaded yet) and Try again (the history couldn't load). */
export type BannerButton = "upload" | "retry";

/**
 * Where focus goes once Activity's history has been read again, when Upload now or Try again went meanwhile: after a
 * press of one, or by itself while it had focus (the "online" reload uploads what was waiting and reads the history
 * again, and both banners go while it reads). Back to that button when its banner is there again, else to the list
 * heading; null leaves focus where it is (handsFocusOn's rule). A press decides which button over one that went by
 * itself.
 */
export function bannerFocusAfterReload(
  doc: FocusDocument,
  input: { pressed: BannerButton | null; went: BannerButton | null; shown: Readonly<Record<BannerButton, boolean>> },
): BannerButton | "list" | null {
  const from = input.pressed ?? input.went;
  if (!from || !focusDropped(doc)) return null;
  return input.shown[from] ? from : "list";
}
