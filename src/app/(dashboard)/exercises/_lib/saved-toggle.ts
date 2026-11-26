/**
 * A save or unsave of an exercise in the library that fails (D5, D6; release 3 fix round 3f, open item 2 of round
 * 3d). The bookmark is put back as it was, and the reason used to show at the top of "Search and filters", far from
 * the card; in the Saved view the unsaved card had left the list (it comes back) and focus had gone to the next card's
 * bookmark. Now the reason shows in the card it belongs to, beside its bookmark, which carries it for screen readers;
 * and that bookmark has focus again, unless the member has moved focus somewhere else meanwhile. Pure.
 */
import { focusLost, type FocusState } from "@/lib/workouts/focus-heading";
import type { LibraryFocus } from "./library-focus";

/** What became of a press of a card's bookmark. */
export type SavedToggle =
  | { status: "done" }
  /** Nothing was asked: no member, or this exercise's last change is still on its way. */
  | { status: "ignored" }
  | { status: "failed"; message: string };

/** Why a save or an unsave did not go through, said in the card: the bookmark is back as it was. */
export function savedToggleProblem(wasSaved: boolean): string {
  return wasSaved ? "This exercise could not be removed from your saved list. Try again." : "This exercise could not be saved. Try again.";
}

/** The two lists a card can be in: the searches' Recent row and the results (the same exercise can be in both). */
export type CardPlace = "recent" | "results";

/**
 * The failed press, for the card that shows it: the exercise, the list it was pressed in, the reason, where the press
 * sent focus (library-focus.ts: in the Saved view, the next card's bookmark or the results heading; null when it moved
 * nothing), and a number that is new for each failure.
 */
export type SaveProblem = { id: string; place: CardPlace; message: string; movedTo: LibraryFocus | null; seq: number };

/**
 * Whether the bookmark whose press failed takes focus back: when focus was lost, or is still on `sentTo`, the element
 * the press sent it to (in the Saved view, as the card left the list); never when the member has moved it elsewhere
 * since. A bookmark that kept focus (any other view: the card stays) needs nothing.
 */
export function bookmarkTakesFocusBack(page: FocusState, sentTo: unknown): boolean {
  if (focusLost(page)) return true;
  return sentTo != null && page.activeElement === sentTo;
}
