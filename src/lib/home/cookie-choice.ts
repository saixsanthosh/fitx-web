/**
 * The analytics choice (bug 24): "essential" (Essential only) or "all" (Allow analytics), kept in this browser's
 * local storage under fitx-cookie-consent. The privacy banner (components/layout/AnalyticsConsent) asks until one is
 * saved and sends analytics only with "all"; the cookie page's box (CookiePreferences) reads the choice back, shows
 * which one is saved, and confirms a change. Both raise CONSENT_EVENT after a save, so the other updates at once.
 *
 * No React here, so node tests cover it (tests/home/cookie-choice.test.ts).
 */

export const CONSENT_KEY = "fitx-cookie-consent";
export const CONSENT_EVENT = "fitx-cookie-consent-change";

export type ConsentChoice = "all" | "essential";
/** A saved choice, none yet, storage this browser refuses, or (on the server, before hydration) not read yet. */
export type StoredChoice = ConsentChoice | "none" | "blocked" | "pending";

export const CHOICES: readonly { value: ConsentChoice; label: string }[] = [
  { value: "essential", label: "Essential only" },
  { value: "all", label: "Allow analytics" },
];

/** The choice this browser holds. Storage that is missing or throws (some private modes) counts as blocked. */
export function readChoice(storage: Pick<Storage, "getItem"> | null): Exclude<StoredChoice, "pending"> {
  if (!storage) return "blocked";
  try {
    const saved = storage.getItem(CONSENT_KEY);
    return saved === "all" || saved === "essential" ? saved : "none";
  } catch {
    return "blocked";
  }
}

/** Saves the choice; false when the browser refuses (nothing changes then, and analytics stay off). */
export function saveChoice(storage: Pick<Storage, "setItem"> | null, choice: ConsentChoice): boolean {
  if (!storage) return false;
  try {
    storage.setItem(CONSENT_KEY, choice);
    return true;
  } catch {
    return false;
  }
}

/** Whether a button shows as the saved choice; undefined before the browser has been read (no pressed state yet). */
export function isPressed(stored: StoredChoice, choice: ConsentChoice): boolean | undefined {
  return stored === "pending" ? undefined : stored === choice;
}

/** The line that says which choice this browser has. */
export function currentChoiceText(stored: StoredChoice): string {
  switch (stored) {
    case "all":
      return "Your choice on this browser: analytics allowed.";
    case "essential":
      return "Your choice on this browser: essential only, so analytics are off.";
    case "none":
      return "No choice saved on this browser yet, so analytics are off.";
    case "blocked":
      return "This browser doesn’t let FITX save a choice, so analytics are off.";
    default:
      return "";
  }
}

/** What a press confirms. */
export function savedText(choice: ConsentChoice, saved: boolean): string {
  if (!saved) return "Your choice couldn’t be saved on this browser, so analytics stay off.";
  return choice === "all" ? "Saved. Anonymous page analytics are on for this browser." : "Saved. Analytics are off for this browser.";
}

/** The confirmation stays only while it still matches what is saved (another tab or the banner may change it). */
export function confirmationFor(stored: StoredChoice, last: { choice: ConsentChoice; saved: boolean } | null): string {
  if (!last) return "";
  if (last.saved && stored !== last.choice) return "";
  return savedText(last.choice, last.saved);
}
