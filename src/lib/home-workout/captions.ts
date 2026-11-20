/**
 * The large caption in the live view: what the coach is saying, short enough to read from two
 * or three metres away, with the full sentence underneath. Waiting states are also spoken, so the
 * caption and the voice always say the same thing.
 */
import type { CoachSnapshot } from "@/lib/form-rules/session";

export interface Caption {
  /** A few words, shown very large (and spoken for waiting states). */
  headline: string;
  /** The full instruction, shown smaller. */
  detail: string | null;
  tone: "cue" | "wait" | "go" | "info";
}

export function captionFor(snapshot: CoachSnapshot | null): Caption {
  if (!snapshot) return { headline: "Step into view", detail: "Getting the first picture ready.", tone: "info" };
  if (snapshot.cue) return { headline: snapshot.cue.speech, detail: snapshot.cue.text, tone: "cue" };
  const guidance = snapshot.guidance || null;
  if (snapshot.status === "searching") return { headline: "Step into view", detail: guidance, tone: "wait" };
  if (snapshot.status === "unclear") {
    if (/too far away/i.test(snapshot.guidance)) return { headline: "Move closer", detail: guidance, tone: "wait" };
    if (/move back/i.test(snapshot.guidance)) return { headline: "Move back", detail: guidance, tone: "wait" };
    return { headline: "Can’t see you clearly", detail: guidance, tone: "wait" };
  }
  if (snapshot.status === "position") {
    if (/turn side-on/i.test(snapshot.guidance)) return { headline: "Turn side-on", detail: guidance, tone: "wait" };
    if (/^face the camera/i.test(snapshot.guidance)) return { headline: "Face the camera", detail: guidance, tone: "wait" };
    if (/phone on its side/i.test(snapshot.guidance)) return { headline: "Turn the phone sideways", detail: guidance, tone: "wait" };
    return { headline: "Get in position", detail: guidance, tone: "wait" };
  }
  if (snapshot.phase === "adjust") return { headline: "Straighten up", detail: guidance, tone: "wait" };
  if (snapshot.phase === "holding") return { headline: "Hold", detail: guidance, tone: "go" };
  if (snapshot.guidance.startsWith("Ready")) return { headline: "Ready. Go", detail: null, tone: "go" };
  return { headline: "Counting", detail: null, tone: "go" };
}

/** A waiting caption worth saying aloud once it has lasted this long (a brief wobble is not). */
export const SPEAK_WAITING_AFTER_MS = 1500;

/** Whether this caption is a waiting instruction that the voice should say. */
export function isSpokenWait(caption: Caption): boolean {
  return caption.tone === "wait";
}
