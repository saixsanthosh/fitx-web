/**
 * Optional spoken counts and cues, using the browser's own speech synthesis (on the device, no
 * network). Off unless the user turns it on; the choice is remembered on this device only.
 */
const STORAGE_KEY = "fitx:form-coach:voice";

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

export function readVoicePreference(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function writeVoicePreference(on: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    // Private mode or blocked storage: the switch still works for this visit.
  }
}

export class CoachVoice {
  enabled: boolean;

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  /** Call inside the tap that starts the camera: iOS only allows speech after a user gesture. */
  prime(): void {
    if (!this.enabled || !speechSupported()) return;
    const silent = new SpeechSynthesisUtterance(" ");
    silent.volume = 0;
    window.speechSynthesis.speak(silent);
  }

  /** Counts never queue up behind each other: only the latest number is worth hearing. */
  count(text: string): void {
    if (!this.enabled || !speechSupported()) return;
    if (window.speechSynthesis.pending) window.speechSynthesis.cancel();
    this.speak(text);
  }

  /** A correction interrupts whatever is being said. */
  cue(text: string): void {
    if (!this.enabled || !speechSupported()) return;
    window.speechSynthesis.cancel();
    this.speak(text);
  }

  stop(): void {
    if (speechSupported()) window.speechSynthesis.cancel();
  }

  private speak(text: string) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.lang = document.documentElement.lang || "en";
    window.speechSynthesis.speak(utterance);
  }
}
