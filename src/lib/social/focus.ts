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
