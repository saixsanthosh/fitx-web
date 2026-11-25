/**
 * Where keyboard focus goes when an action on the coach page removes the control the member used, and how the page's
 * polite announcements are worded. Free of React and imports so `node --test` can run them (BRIEF-3 D5).
 */

export type ListFocus = { kind: "thread"; id: string } | { kind: "new" };

/**
 * After a conversation is deleted from the list: the conversation that moves into its place (the next one), else the
 * one before it, else "New conversation" once the list is empty.
 */
export function focusAfterDelete(ids: readonly string[], deletedId: string): ListFocus {
  const index = ids.indexOf(deletedId);
  const rest = ids.filter((id) => id !== deletedId);
  if (index < 0 || !rest.length) return { kind: "new" };
  return { kind: "thread", id: rest[Math.min(index, rest.length - 1)] };
}

/**
 * The text of the page's polite live region. Screen readers announce a live region when its text changes, so the same
 * words twice in a row ("Deleted “Rest days”.") would be read only once: every second announcement ends with a
 * no-break space, which changes the text without changing what is read.
 */
export function announcementText(text: string, count: number): string {
  return text && count % 2 === 1 ? `${text} ` : text;
}
