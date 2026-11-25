import { formatDistance, formatDuration } from "@/lib/activity/format";
import type { LocationIssue, RecorderSnapshot, SignalQuality, WakeLockState } from "@/lib/activity/recorder";
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

/** What the corner chip says for each location problem: the same answer as the banner under it. */
export const ISSUE_CHIP_TEXT: Record<Exclude<LocationIssue, "coarse">, string> = {
  unsupported: "No location",
  insecure: "No location",
  denied: "Location blocked",
  unavailable: "No GPS",
  timeout: "No GPS",
  searching: "GPS lost",
};

export type SignalChip = {
  text: string;
  /** Filled bars, 0 to 3. */
  bars: 0 | 1 | 2 | 3;
  tone: "good" | "fair" | "weak" | "bad" | "off";
  /** True only while FITX is waiting for a first position: the bars pulse. */
  searching: boolean;
  /** Shown beside the text ("± 6 m"), only with a current position. */
  accuracyM: number | null;
};

/**
 * The GPS chip in the Record screen's corner: one clear answer, the same as the banner below it. A location
 * problem (blocked, unsupported, lost, not found) is named, never "GPS good" from a position that stopped
 * arriving; "Finding GPS…" is said only while FITX is really looking, never before location is allowed or
 * after it stopped.
 */
export function signalChip(snapshot: Pick<RecorderSnapshot, "issue" | "signal" | "accuracyM" | "phase">): SignalChip {
  const { issue, signal } = snapshot;
  if (issue && issue !== "coarse") return { text: ISSUE_CHIP_TEXT[issue], bars: 0, tone: issue === "searching" || issue === "timeout" || issue === "unavailable" ? "bad" : "off", searching: false, accuracyM: null };
  if (signal === "none") {
    // Location isn't being read: not allowed yet (or not asked), or the activity is finished.
    if (snapshot.phase === "idle" || snapshot.phase === "finished") return { text: "Location off", bars: 0, tone: "off", searching: false, accuracyM: null };
    return { text: SIGNAL_TEXT.none, bars: 0, tone: "off", searching: true, accuracyM: null };
  }
  const bars = signal === "good" ? 3 : signal === "fair" ? 2 : 1;
  const tone = signal === "good" ? "good" : signal === "fair" ? "fair" : signal === "weak" ? "weak" : "bad";
  return { text: SIGNAL_TEXT[signal], bars, tone, searching: false, accuracyM: snapshot.accuracyM };
}

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

/**
 * What happens with location on the Record screen (the privacy page says the same): positions are
 * read while the screen is open, to show the GPS signal, and kept only while recording.
 */
export const LOCATION_USE_NOTE =
  "FITX uses your location while this screen is open, to show the GPS signal and then to record, until you finish or leave. Only the positions from while you record are kept.";

/** Map tiles are the one outside request the maps make (Record screen and activity pages). */
export const MAP_TILES_NOTE =
  "Map images come from OpenFreeMap (openfreemap.org), which receives the map area shown and your IP address, not your route or account.";

/** What browsers allow, said once before recording. */
export const SCREEN_ON_NOTE =
  "Keep FITX open with the screen on while you record. Phones stop sharing location with websites when the screen locks or you switch apps; FITX keeps the screen awake where the browser allows and marks any gap instead of guessing it.";
