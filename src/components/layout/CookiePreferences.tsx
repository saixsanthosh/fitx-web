"use client";

import { useState, useSyncExternalStore } from "react";
import { Check } from "lucide-react";
import { CHOICES, CONSENT_EVENT, confirmationFor, currentChoiceText, isPressed, readChoice, saveChoice, type ConsentChoice, type StoredChoice } from "@/lib/home/cookie-choice";

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(CONSENT_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CONSENT_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const readStored = (): StoredChoice => readChoice(browserStorage());
const notReadYet = (): StoredChoice => "pending";

/**
 * The cookie page's analytics choice. It shows which choice this browser has saved (a line, and the saved option as
 * the pressed, filled button), follows the banner and other tabs, and confirms a press. Neither option is pressed
 * until one is saved. Saving needs a press: no choice changes on focus or arrow keys.
 */
export function CookiePreferences() {
  const stored = useSyncExternalStore(subscribe, readStored, notReadYet);
  const [last, setLast] = useState<{ choice: ConsentChoice; saved: boolean } | null>(null);

  function choose(choice: ConsentChoice) {
    const saved = saveChoice(browserStorage(), choice);
    if (saved) window.dispatchEvent(new Event(CONSENT_EVENT));
    setLast({ choice, saved });
  }

  return <div className="rounded-lg border border-fitx-border bg-fitx-surface p-4">
    <p id="cookie-choice-title" className="text-sm font-medium">Change your analytics choice</p>
    <p className="mt-1 text-xs leading-5 text-fitx-text-secondary">This setting takes effect on this browser. Essential sign-in storage is always active.</p>
    <p className="mt-2 min-h-5 text-sm text-fitx-text">{currentChoiceText(stored)}</p>
    <div role="group" aria-labelledby="cookie-choice-title" className="mt-3 flex flex-wrap gap-2">
      {CHOICES.map(({ value, label }) => {
        const pressed = isPressed(stored, value);
        return <button key={value} type="button" aria-pressed={pressed} onClick={() => choose(value)} className={`fitx-button px-4 text-sm ${pressed ? "" : "fitx-button-secondary"}`}>
          {pressed && <Check size={16} aria-hidden="true" />}{label}
        </button>;
      })}
    </div>
    <p role="status" aria-live="polite" className="mt-2 min-h-5 text-xs font-medium text-fitx-text-secondary">{confirmationFor(stored, last)}</p>
  </div>;
}
