/**
 * Voice conversation helpers: plain functions, no DOM, so they run under node --test. CoachVoice.tsx wires them to the
 * browser's SpeechRecognition (push to talk) and speechSynthesis (replies read aloud with an on-device voice only).
 */

export type VoiceLike = { name: string; lang: string; localService: boolean; default?: boolean };

/** Key for "the member has read how voice works" (per device). */
export const VOICE_OK_KEY = "fitx:coach-voice-ok";
/** Key for "read replies aloud" (per device). */
export const READ_ALOUD_KEY = "fitx:coach-read-aloud";
/** Longest reply read aloud, in characters; longer ones stop at a sentence end before it. */
export const MAX_SPOKEN = 900;
/** A press shorter than this is a tap: the microphone stays on until the next tap. */
export const TAP_MS = 350;

/** The recognition language: the browser's English variant, or British English. */
export function recognitionLang(language: string | undefined | null): string {
  return language && /^en(-[A-Z]{2})?$/i.test(language) ? language : "en-GB";
}

/**
 * An on-device voice for replies, or null. Network voices (Chrome's "Google …" voices) would send the reply text to the
 * browser maker, which the privacy note does not cover, so they are never used.
 */
export function pickVoice(voices: readonly VoiceLike[], lang: string): VoiceLike | null {
  const local = voices.filter((voice) => voice.localService);
  const base = lang.slice(0, 2).toLowerCase();
  return (
    local.find((voice) => voice.lang.toLowerCase() === lang.toLowerCase()) ??
    local.find((voice) => voice.lang.toLowerCase() === "en-gb") ??
    local.find((voice) => voice.lang.toLowerCase().startsWith(`${base}-`) || voice.lang.toLowerCase() === base) ??
    null
  );
}

/** A reply as it should sound: no list dashes, emphasis marks or links; long replies end at a sentence. */
export function speakableText(text: string): string {
  const plain = text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_`#>]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s*\n+\s*/g, ". ")
    .replace(/\.\s*\.+/g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (plain.length <= MAX_SPOKEN) return plain;
  const cut = plain.slice(0, MAX_SPOKEN);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return (end > 200 ? cut.slice(0, end + 1) : cut).trim();
}

/** What a recognition error means for the member, in plain words; null when nothing needs saying (they stopped). */
export function voiceErrorText(code: string): string | null {
  switch (code) {
    case "aborted":
      return null;
    case "no-speech":
      return "Didn't catch that. Hold the microphone and speak.";
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access is off for FITX. Allow it in your browser's site settings, then try again.";
    case "audio-capture":
      return "No microphone was found.";
    case "network":
      return "Voice needs an internet connection in this browser.";
    case "language-not-supported":
      return "Voice isn't available in this language in your browser.";
    default:
      return "Voice stopped. Please try again.";
  }
}

/** Joins recognition results: the final text so far plus what is still being heard. */
export function joinTranscript(finals: readonly string[], interim: string): string {
  return [...finals, interim].map((part) => part.trim()).filter(Boolean).join(" ").replace(/\s{2,}/g, " ");
}
