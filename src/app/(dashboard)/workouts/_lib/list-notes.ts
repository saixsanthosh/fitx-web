/**
 * Where the Workouts page's list and History messages go (D6, the same mistake as bug 11; review round, workouts-r5).
 * They used to show only in the alert under the page heading, often far above the control used, so on a phone a
 * failed Delete or Repeat seemed to do nothing. Now a plan card's Edit, Duplicate and Delete answer in that card,
 * "Show more plans" beside itself, Repeat in its History row, and a saved plan's planner warning in its card. A
 * message for a plan that is not on the list shows on the list's own line instead. A message lasts until the member
 * moves on: another list action, New workout, or the list loading again (the page clears it then). Pure.
 */
export type NoteTone = "info" | "error";
export type Note = { tone: NoteTone; text: string };

export type ListNote =
  | { at: "plan"; planId: string; tone: NoteTone; text: string }
  | { at: "plans"; tone: NoteTone; text: string }
  | { at: "more"; text: string }
  | { at: "history"; sessionId: string; text: string };

/** The message inside one plan's card, when it is about that plan. */
export function planCardNote(note: ListNote | null, planId: string): Note | null {
  return note?.at === "plan" && note.planId === planId ? { tone: note.tone, text: note.text } : null;
}

/** The plan list's own line: its own messages, and a plan's when that plan is not on the list (`listed`). */
export function plansLineNote(note: ListNote | null, listed: readonly { id: string }[]): Note | null {
  if (note?.at === "plans") return { tone: note.tone, text: note.text };
  if (note?.at === "plan" && !listed.some((plan) => plan.id === note.planId)) return { tone: note.tone, text: note.text };
  return null;
}

/** Why "Show more plans" did not work, beside it. */
export function moreNote(note: ListNote | null): string | null {
  return note?.at === "more" ? note.text : null;
}

/** Why Repeat did not work, in that History row. */
export function historyNote(note: ListNote | null, sessionId: string): string | null {
  return note?.at === "history" && note.sessionId === sessionId ? note.text : null;
}

/**
 * After a plan is deleted its card, and the menu that held focus, are gone (D5): the next plan's Start takes focus, the
 * previous one's when it was the last, or null when the list is left empty (its "Build a workout" button then).
 */
export function focusAfterPlanDelete(listed: readonly { id: string }[], deletedId: string): string | null {
  const index = listed.findIndex((plan) => plan.id === deletedId);
  if (index < 0) return listed[0]?.id ?? null;
  return listed[index + 1]?.id ?? listed[index - 1]?.id ?? null;
}
