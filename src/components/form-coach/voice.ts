/**
 * Optional spoken counts and cues, using the browser's own speech synthesis (on the device, no
 * network), in a female or male voice. Off unless the user turns it on; the choice of voice and
 * whether it is on are remembered on this device only.
 */
const STORAGE_KEY = "fitx:form-coach:voice";
const GENDER_KEY = "fitx:home-workout:voice-gender";

export type VoiceGender = "female" | "male";

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

/** The choice made on this visit when the browser refused to store it (blocked site data, full storage). */
let unsaved: boolean | null = null;

export function readVoicePreference(): boolean {
  if (unsaved !== null) return unsaved;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function writeVoicePreference(on: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
    unsaved = null;
  } catch {
    // Private mode or blocked storage: the switch still works for this visit.
    unsaved = on;
  }
}

let unsavedGender: VoiceGender | null = null;

export function readVoiceGender(): VoiceGender {
  if (unsavedGender) return unsavedGender;
  try {
    return window.localStorage.getItem(GENDER_KEY) === "male" ? "male" : "female";
  } catch {
    return "female";
  }
}

export function writeVoiceGender(gender: VoiceGender): void {
  try {
    window.localStorage.setItem(GENDER_KEY, gender);
    unsavedGender = null;
  } catch {
    unsavedGender = gender;
  }
}

/** The parts of a SpeechSynthesisVoice this module reads. */
export interface VoiceLike {
  name: string;
  lang: string;
  default?: boolean;
  localService?: boolean;
}

// "female" is tested first: it contains "male".
const FEMALE_NAMES = /\b(female|woman|samantha|victoria|karen|moira|tessa|fiona|serena|zira|hazel|susan|libby|sonia|aria|jenny|veena|heera|kate|martha|catherine|allison|ava|nicky|amelie|anna|neerja|swara|natasha|clara|emma|olivia|maisie|isha|kalpana|lekha)\b/i;
const MALE_NAMES = /\b(male|man|daniel|alex|oliver|arthur|george|ryan|guy|rishi|ravi|aaron|thomas|gordon|david|mark|james|william|lee|prabhat|madhur|hemant|tom|aditya|liam|noah)\b/i;
/**
 * Apple's Eloquence voices (listed for every English locale on iOS 17+ and macOS), its old
 * MacinTalk voices and its novelty voices: robotic or comic, never a coach. They are never picked
 * while any other voice exists.
 */
const NOVELTY_NAMES = /\b(eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley|albert|agnes|bruce|fred|junior|kathy|princess|ralph|vicki|bad news|good news|bahh|bells|boing|bubbles|cellos|deranged|hysterical|jester|organ|superstar|trinoids|whisper|wobble|zarvox)\b/i;
/** Apple's enhanced, premium and Siri voices, and Microsoft's and Google's neural ones: the natural-sounding ones. */
const NATURAL_NAMES = /\b(enhanced|premium|neural|natural|siri)\b/i;

export function isNoveltyVoice(voice: VoiceLike): boolean {
  return NOVELTY_NAMES.test(voice.name);
}

export function voiceGenderOf(voice: VoiceLike): VoiceGender | null {
  if (isNoveltyVoice(voice)) return null;
  if (FEMALE_NAMES.test(voice.name)) return "female";
  if (MALE_NAMES.test(voice.name)) return "male";
  return null;
}

/**
 * The best English voice of the chosen gender: the page's own English first (en-GB), then Indian
 * and other English voices, voices on the device before network ones, and within those the
 * natural-sounding (enhanced, premium, Siri) ones. Novelty voices come last of all. `matched` is
 * false when no voice of that gender exists here, and the closest English voice is returned instead.
 */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], gender: VoiceGender, lang = "en-GB"): { voice: V | null; matched: boolean } {
  const english = voices.filter((voice) => /^en([-_]|$)/i.test(voice.lang));
  const pool = english.length ? english : [...voices];
  const wanted = lang.toLowerCase().replace("_", "-");
  const score = (voice: V) => {
    const voiceLang = voice.lang.toLowerCase().replace("_", "-");
    let points = 0;
    if (voiceLang === wanted) points += 8;
    else if (voiceLang === "en-gb" || voiceLang === "en-in") points += 6;
    else if (voiceLang.startsWith("en")) points += 4;
    if (voice.localService !== false) points += 2;
    if (NATURAL_NAMES.test(voice.name)) points += 1.5;
    if (voice.default) points += 1;
    return points;
  };
  const ranked = [...pool].sort((a, b) => score(b) - score(a));
  const usable = ranked.filter((voice) => !isNoveltyVoice(voice));
  const match = usable.find((voice) => voiceGenderOf(voice) === gender);
  if (match) return { voice: match, matched: true };
  // No named voice of that gender: take one not clearly of the other, else the best ordinary
  // English one, and a novelty voice only when the device has nothing else.
  const neutral = usable.find((voice) => voiceGenderOf(voice) === null) ?? usable[0] ?? ranked[0] ?? null;
  return { voice: neutral, matched: false };
}

/** Pitch for a voice that is not of the chosen gender: a gentle shift, never a cartoon. */
export function fallbackPitch(gender: VoiceGender): number {
  return gender === "female" ? 1.15 : 0.82;
}

export class CoachVoice {
  enabled: boolean;
  gender: VoiceGender;

  constructor(enabled: boolean, gender: VoiceGender = "female") {
    this.enabled = enabled;
    this.gender = gender;
  }

  /** Says a short line in the chosen voice even while counting cues are off (the voice preview). */
  preview(text: string): void {
    if (!speechSupported()) return;
    window.speechSynthesis.cancel();
    this.speak(text);
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
    const lang = document.documentElement.lang || "en-GB";
    const { voice, matched } = pickVoice(window.speechSynthesis.getVoices(), this.gender, lang);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = lang;
    }
    if (!matched) utterance.pitch = fallbackPitch(this.gender);
    window.speechSynthesis.speak(utterance);
  }
}
