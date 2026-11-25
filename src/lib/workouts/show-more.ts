/**
 * Buttons that show or load more (D5, the same mistake as bug 84; review round, workouts-r4). Disabled while it
 * loads, a button drops keyboard focus to the page in Chrome; and once everything is shown it goes, taking focus with
 * it. So it stays focusable while busy (aria-disabled, a press then ignored) and keeps focus while there is more; when
 * it goes, the first item it brought takes focus, so the member carries on where the new items start (the last item
 * shown when it brought none). Pure.
 */
export function focusAfterShowMore(input: { more: boolean; shown: readonly string[]; added: readonly string[] }): "button" | string | null {
  if (input.more) return "button";
  return input.added[0] ?? input.shown[input.shown.length - 1] ?? null;
}

/** The ids in `next` that `before` did not have, in order: what a press of "show more" brought. */
export function addedIds(before: readonly string[], next: readonly string[]): string[] {
  const known = new Set(before);
  return next.filter((id) => !known.has(id));
}
