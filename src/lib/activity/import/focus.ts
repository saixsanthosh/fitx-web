import { hasFocus, type WitnessedControl } from "../focus";
import type { BarFile } from "./plan";

/*
 * Keyboard focus on the import screen when the control that had it goes (D5). A file's card goes with its Remove, the
 * file list with Clear list, the account check's alert with Check again once a check works, and "Set them all to:"
 * once every file has its sport: each time the browser dropped focus to the page. Focus moves on to what is left in
 * the control's place instead. Pure (the elements are passed in), so it is tested without a DOM.
 */

/** Whether a file's card shows Remove: not while the files are imported, nor once the file is imported or has its result. */
export function canRemove(phase: BarFile["phase"], importing: boolean): boolean {
  return !importing && phase !== "done" && phase !== "importing";
}

/**
 * Whether the account check's alert ("FITX couldn't check your activities…", with Check again) shows: once a check has
 * failed, until one works. It stays while Check again checks, so the button keeps focus (aria-disabled meanwhile) and
 * still has it when the check fails again; files chosen after a failure hide it while they are read, as before (their
 * own check follows, and says again if it fails).
 */
export function checkAlertShown(state: { failed: boolean; reading: boolean; checkingAgain: boolean }): boolean {
  return state.failed && (!state.reading || state.checkingAgain);
}

/** What takes focus: Choose files, the Import bar's button, the file list's heading, or a file's Remove. */
export type ImportFocusTarget = "choose" | "import" | "files" | { remove: string };

/** A control of the file list that can go while it has focus. */
export type ImportControl = { control: "remove"; file: string } | { control: "clear" } | { control: "check" } | { control: "set-all" };

/** A file in the list as it is drawn: its key, and whether its card shows Remove. */
export type ListedFile = { key: string; removable: boolean };

/**
 * Where focus goes once a file's Remove went with its card: the Remove of the next file that still shows one, else of
 * the file before it (as the app's other lists do), else, with none left, Choose files.
 */
export function focusAfterRemove(before: readonly ListedFile[], removed: string, after: readonly ListedFile[]): ImportFocusTarget {
  const left = new Set(after.filter((file) => file.removable).map((file) => file.key));
  const at = before.findIndex((file) => file.key === removed);
  if (at >= 0) {
    const next = before.slice(at + 1).find((file) => left.has(file.key));
    if (next) return { remove: next.key };
    const previous = before.slice(0, at).reverse().find((file) => left.has(file.key));
    if (previous) return { remove: previous.key };
  }
  return "choose";
}

/**
 * Where focus goes once one of the file list's controls went with it:
 * - a file's Remove: focusAfterRemove;
 * - Clear list (the list went with it): Choose files, to choose others;
 * - Check again (the check worked, so its alert went, or files dropped meanwhile hide it while they are read) and a
 *   sport in "Set them all to:" (every file has its sport now, so the group went): the Import button when it has
 *   something to import (the next step, and its label says how many), else the file list's heading, where the alert
 *   and the cards say what each file still needs; with no files left, Choose files.
 */
export function importFocusAfter(went: ImportControl, list: { before: readonly ListedFile[]; after: readonly ListedFile[]; importReady: boolean }): ImportFocusTarget {
  if (went.control === "remove") return focusAfterRemove(list.before, went.file, list.after);
  if (went.control === "clear" || list.after.length === 0) return "choose";
  return list.importReady ? "import" : "files";
}

/** A control as importFocusWitness sees it: whether it is still on the page, and what it is (its data attributes). */
export type ImportControlElement = WitnessedControl & { isConnected: boolean; dataset: { importControl?: string; importFile?: string } };

/** What a control is, from data-import-control (and, for Remove, data-import-file); null for anything else. */
export function importControlOf(dataset: ImportControlElement["dataset"]): ImportControl | null {
  const { importControl, importFile } = dataset;
  if (importControl === "remove") return importFile ? { control: "remove", file: importFile } : null;
  if (importControl === "clear" || importControl === "check" || importControl === "set-all") return { control: importControl };
  return null;
}

/**
 * Sees which of the file list's controls went with focus, as listFocusWitness does for Activity's history. React takes
 * a removed control's ref away while the control is still on the page (tests/activity/reload-focus.test.ts guards
 * that order), so the ref's cleanup sees whether it had focus. One ref serves them all, each saying what it is
 * (data-import-control, and data-import-file on a Remove); `take()` says what went with focus since it was last asked,
 * then forgets it. A control still on the page (its ref only given again) says nothing.
 */
export function importFocusWitness<T extends ImportControlElement>() {
  let went: { element: T; what: ImportControl } | null = null;
  return {
    ref: (element: T | null): (() => void) | undefined => {
      if (!element) return undefined;
      return () => {
        if (!hasFocus(element.ownerDocument, element)) return;
        const what = importControlOf(element.dataset);
        if (what) went = { element, what };
      };
    },
    take: (): ImportControl | null => {
      const had = went;
      went = null;
      return had && !had.element.isConnected ? had.what : null;
    },
  };
}
