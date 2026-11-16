import { formatDistance, formatDuration } from "@/lib/activity/format";
import type { LocationIssue, SignalQuality, WakeLockState } from "@/lib/activity/recorder";
import type { Gap } from "@/lib/activity/types";

/** Plain-language help for each location problem, with the exact settings to change. */
export const ISSUE_TEXT: Record<LocationIssue, { title: string; body: string }> = {
  unsupported: {
    title: "This browser can’t share your location",
    body: "Open FITX in Chrome on Android or Safari on iPhone to record activities.",
  },
  insecure: {
    title: "Location needs the secure FITX site",
    body: "Browsers share location only on secure (https) pages. Open FITX from its usual address.",
  },
  denied: {
    title: "Location is blocked for FITX",
    body: "iPhone: Settings → Privacy & Security → Location Services → Safari Websites → While Using the App. Android (Chrome): tap the icon left of the address → Permissions → Location → Allow. Then reload this page.",
  },
  unavailable: {
    title: "Your phone can’t find its location",
    body: "Check that Location (GPS) is switched on in your phone’s settings, then step outside or near a window.",
  },
  timeout: {
    title: "Still looking for GPS",
    body: "Move to an open area away from tall buildings. Tracking starts as soon as a position arrives.",
  },
  searching: {
    title: "GPS signal lost",
    body: "Keep FITX open and stay in the open. The route continues when the signal returns; the missing stretch is not counted.",
  },
  coarse: {
    title: "Only your approximate location is shared",
    body: "A route needs precise location. iPhone: Settings → Privacy & Security → Location Services → Safari Websites → turn on Precise Location. Android: Settings → Location → App location permissions → Chrome → Use precise location.",
  },
};

export const SIGNAL_TEXT: Record<SignalQuality, string> = {
  none: "Finding GPS…",
  good: "GPS good",
  fair: "GPS fair",
  weak: "Weak GPS",
  coarse: "Approximate location",
};

export const WAKE_LOCK_TEXT: Record<WakeLockState, string | null> = {
  off: null,
  active: "Screen stays on",
  unsupported: "Keep your screen on: this browser can’t do it for you",
  failed: "The browser didn’t allow keeping the screen on: keep it awake yourself",
};

/** "No GPS for 3:12 while the screen was locked or FITX was in the background." */
export function gapSentence(gap: Gap): string {
  const duration = formatDuration((gap.end - gap.start) / 1000);
  if (gap.kind === "hidden") return `No GPS for ${duration} while the screen was locked or FITX was in the background. That stretch isn’t counted.`;
  if (gap.kind === "jump") return `Your GPS position jumped ${formatDistance(gap.straightLineM ?? 0)}. That jump isn’t counted.`;
  return `GPS signal was lost for ${duration}. That stretch isn’t counted.`;
}

export const GAP_LABEL: Record<Gap["kind"], string> = {
  hidden: "Screen locked or app in background",
  signal: "GPS signal lost",
  jump: "GPS position jumped",
};

/** What browsers allow, said once before recording. */
export const SCREEN_ON_NOTE =
  "Keep FITX open with the screen on while you record. Phones stop sharing location with websites when the screen locks or you switch apps; FITX keeps the screen awake where the browser allows and marks any gap instead of guessing it.";
