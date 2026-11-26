/**
 * Where keyboard focus goes when an entry of a list like Profile's "Other allergies" is removed with its own Remove
 * button, which goes with it (focus would otherwise fall to the page): the next entry's Remove, else the one before,
 * else "add", the list's + beside its text box. That last one is a button, so a phone's keyboard doesn't open.
 *
 * `index` is the entry's place in the list as it was, and a number returned is a place in that same list.
 */
export function focusAfterRemovingEntry(count: number, index: number): number | "add" {
  if (!Number.isInteger(index) || index < 0 || index >= count) return "add";
  if (index + 1 < count) return index + 1;
  if (index > 0) return index - 1;
  return "add";
}
