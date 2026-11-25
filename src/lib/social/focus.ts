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
