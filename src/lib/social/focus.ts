/**
 * Where keyboard focus goes when an action removes the control that had it (D5, bug 82): unblocking a row, deleting a
 * comment or a post, answering a request. `order` is the list's controls in display order before the change, `removed`
 * the ones that go (a comment takes its replies with it). The next control still on the list, else the one before it,
 * else null: the caller then focuses the list's heading (or the control that replaced the removed one).
 */
export function focusAfterRemoval(order: readonly string[], removed: readonly string[]): string | null {
  const gone = new Set(removed);
  const at = order.map((id, index) => (gone.has(id) ? index : -1)).filter((index) => index >= 0);
  if (!at.length) return null;
  for (let index = Math.max(...at) + 1; index < order.length; index += 1) if (!gone.has(order[index])) return order[index];
  for (let index = Math.min(...at) - 1; index >= 0; index -= 1) if (!gone.has(order[index])) return order[index];
  return null;
}

/** The id of a post card's "Post options" button, so a list can hand focus to the next card when one goes. */
export function postOptionsId(postId: string): string {
  return `post-options-${postId}`;
}

/** The ids of a picked photo's buttons in the post composer, so focus can follow a photo that moves or goes. */
export function photoToolId(photoKey: string, tool: "earlier" | "later" | "remove"): string {
  return `photo-${tool}-${photoKey}`;
}

/**
 * Which of a moved photo's buttons takes focus after it moves one place (`by`) to position `to` of `count` (D5): the
 * one for the same direction while the photo can still go that way, else the other one, since a button at the end is
 * disabled and cannot hold focus (null: neither can move it, one photo). Moving can also take the photo's buttons out
 * of the page and put them back, which drops focus by itself, so the composer always moves it explicitly.
 */
export function photoMoveFocus(to: number, by: -1 | 1, count: number): "earlier" | "later" | null {
  const earlier = to > 0;
  const later = to < count - 1;
  if (by < 0) return earlier ? "earlier" : later ? "later" : null;
  return later ? "later" : earlier ? "earlier" : null;
}

/** The little of the page a focus hand-off needs (tests pass stand-ins for the element and the document). */
export type HandOffDocument = { activeElement: unknown; body: unknown };
export type HandOffNode = { contains: (other: never) => boolean; ownerDocument: HandOffDocument };

/**
 * D5 for a control that leaves the page while it has focus with nothing pressed to say where focus goes next: a "Show
 * more" that goes once the last page is in (also when that page came by scrolling), a step of the video picker that
 * gives way to the next one, the first-time Explore setup once the profile is made. Two moments, in one React commit
 * (useFocusHandOff): `left(node)` as React takes the node off the page, while it is still there, so it can tell whether
 * focus was inside it; then `settled(document)` once the new content is on the page: true when focus left with the node
 * and nothing has taken it since (it is on the page body), and the caller then moves it on. Each loss is used once.
 */
export function focusHandOff() {
  let lost = false;
  return {
    left(node: HandOffNode) {
      if (node.contains(node.ownerDocument.activeElement as never)) lost = true;
    },
    settled(page: HandOffDocument): boolean {
      const was = lost;
      lost = false;
      return was && (page.activeElement === null || page.activeElement === page.body);
    },
  };
}

/**
 * Where focus goes when a list's "Show more" (or a conversation's "Show earlier messages") leaves the page while it has
 * focus, because the last page has come in: the first item that page added, in the order the list shows them, so the
 * member carries on where the new ones start, as they would have by tabbing on. Null when it added none: the caller
 * then focuses the end of the list (its "You are up to date." line, or its last item).
 */
export function focusAfterLastPage(before: readonly string[], after: readonly string[]): string | null {
  const had = new Set(before);
  return after.find((id) => !had.has(id)) ?? null;
}

/** The video picker's steps (VideoPicker). */
export type PickerStep = "idle" | "reading" | "trim" | "preparing" | "camera" | "ready";

/** The ids of the video picker's controls that take focus as its steps change. */
export const PICKER_IDS = {
  choose: "video-choose",
  status: "video-status",
  start: "video-start",
  prepare: "video-prepare",
  record: "video-record",
  again: "video-again",
} as const;

/**
 * Where focus goes when the video picker moves to `step` while focus was on the step before (D5; it went with it): a
 * step that asks for something gives its first control, and one that only reports (opening the video, preparing it)
 * its line of text, so a second press of the key that started it cannot cancel it. A ready clip hands focus to what
 * the page asks for next (`ready`, the story's caption, say), else to the picker's Choose another.
 */
export function pickerFocusId(step: PickerStep, { trim, ready }: { trim: boolean; ready?: string }): string {
  switch (step) {
    case "idle": return PICKER_IDS.choose;
    case "reading":
    case "preparing": return PICKER_IDS.status;
    case "trim": return trim ? PICKER_IDS.start : PICKER_IDS.prepare;
    case "camera": return PICKER_IDS.record;
    case "ready": return ready ?? PICKER_IDS.again;
  }
}

/** The id of a post card's author link (the feed's and the Videos tab's cards): where a newly loaded post takes focus. */
export function postAuthorId(postId: string): string {
  return `post-author-${postId}`;
}
