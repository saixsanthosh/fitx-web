import { test } from "node:test";
import assert from "node:assert/strict";
import { fallbackPitch, isNoveltyVoice, pickVoice, readVoiceGender, voiceGenderOf, writeVoiceGender } from "@/components/form-coach/voice";

const v = (name: string, lang: string, extra: { default?: boolean; localService?: boolean } = {}) => ({ name, lang, ...extra });

test("voices are sorted into female and male by their names", () => {
  assert.equal(voiceGenderOf(v("Google UK English Female", "en-GB")), "female");
  assert.equal(voiceGenderOf(v("Google UK English Male", "en-GB")), "male");
  assert.equal(voiceGenderOf(v("Samantha", "en-US")), "female");
  assert.equal(voiceGenderOf(v("Daniel", "en-GB")), "male");
  assert.equal(voiceGenderOf(v("Microsoft Zira - English (United States)", "en-US")), "female");
  assert.equal(voiceGenderOf(v("Microsoft David - English (United States)", "en-US")), "male");
  assert.equal(voiceGenderOf(v("Rishi", "en-IN")), "male");
  assert.equal(voiceGenderOf(v("Veena", "en-IN")), "female");
  assert.equal(voiceGenderOf(v("Google English", "en-US")), null);
});

test("picks a British voice of the chosen gender first, then Indian, then any English", () => {
  const voices = [v("Samantha", "en-US"), v("Daniel", "en-GB"), v("Rishi", "en-IN"), v("Serena", "en-GB"), v("Thomas", "fr-FR")];
  assert.deepEqual(pickVoice(voices, "female"), { voice: voices[3], matched: true });
  assert.deepEqual(pickVoice(voices, "male"), { voice: voices[1], matched: true });
  assert.deepEqual(pickVoice([v("Samantha", "en-US"), v("Veena", "en-IN")], "female", "en-GB").voice?.name, "Veena");
});

test("prefers voices that run on the device", () => {
  const voices = [v("Google UK English Female", "en-GB", { localService: false }), v("Kate", "en-GB", { localService: true })];
  assert.equal(pickVoice(voices, "female").voice?.name, "Kate");
});

test("on an iPhone, Apple's Eloquence and novelty voices are never the coach", () => {
  // iOS 17+ lists the Eloquence set for en-GB beside Daniel, often first; Samantha is en-US.
  const uk = (name: string) => v(`${name} (English (United Kingdom))`, "en-GB", { localService: true });
  const voices = [
    uk("Eddy"), uk("Flo"), uk("Grandma"), uk("Grandpa"), uk("Reed"), uk("Rocko"), uk("Sandy"), uk("Shelley"),
    v("Daniel", "en-GB", { localService: true, default: true }),
    v("Fred", "en-US", { localService: true }), v("Junior", "en-US", { localService: true }), v("Kathy", "en-US", { localService: true }),
    v("Ralph", "en-US", { localService: true }), v("Bad News", "en-US", { localService: true }), v("Zarvox", "en-US", { localService: true }),
    v("Samantha", "en-US", { localService: true }),
  ];
  assert.deepEqual(pickVoice(voices, "female", "en"), { voice: voices.at(-1), matched: true }, "Samantha, not Flo, Grandma, Sandy or Shelley");
  assert.equal(pickVoice(voices, "male", "en").voice?.name, "Daniel", "Daniel, not Eddy, Grandpa, Reed or Rocko");
  for (const voice of voices.filter((item) => !["Daniel", "Samantha"].includes(item.name))) {
    assert.ok(isNoveltyVoice(voice), voice.name);
    assert.equal(voiceGenderOf(voice), null, voice.name);
  }
  // With only Daniel and the Eloquence set, "Female" uses Daniel at a higher pitch rather than Flo.
  const picked = pickVoice([uk("Flo"), uk("Shelley"), v("Daniel", "en-GB")], "female");
  assert.deepEqual([picked.voice?.name, picked.matched], ["Daniel", false]);
  // A device with nothing else still speaks.
  assert.equal(pickVoice([uk("Flo")], "female").voice?.name, "Flo (English (United Kingdom))");
});

test("enhanced, premium and Siri voices win over the compact ones in the same English", () => {
  const voices = [v("Serena", "en-GB"), v("Serena (Premium)", "en-GB"), v("Kate (Enhanced)", "en-GB")];
  assert.equal(pickVoice(voices, "female").voice?.name, "Serena (Premium)");
  const male = [v("Daniel", "en-GB", { default: true }), v("Arthur (Enhanced)", "en-GB")];
  assert.equal(pickVoice(male, "male").voice?.name, "Arthur (Enhanced)");
  assert.equal(pickVoice([v("Samantha (Enhanced)", "en-US"), v("Martha", "en-GB")], "female").voice?.name, "Martha", "British English still comes first");
});

test("with no voice of that gender it falls back gracefully and says so", () => {
  const voices = [v("Daniel", "en-GB"), v("Google English", "en-US")];
  const picked = pickVoice(voices, "female");
  assert.equal(picked.matched, false);
  assert.equal(picked.voice?.name, "Google English", "a voice that is not clearly male comes first");
  assert.ok(fallbackPitch("female") > 1 && fallbackPitch("male") < 1);
  assert.deepEqual(pickVoice([], "male"), { voice: null, matched: false });
});

test("the chosen voice is remembered, and works for the visit when storage is blocked", () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { value: { localStorage: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, x: string) => void values.set(k, x) } }, configurable: true, writable: true });
  assert.equal(readVoiceGender(), "female", "female until chosen");
  writeVoiceGender("male");
  assert.equal(readVoiceGender(), "male");
  assert.equal(values.get("fitx:home-workout:voice-gender"), "male");
  const blocked = {};
  Object.defineProperty(blocked, "localStorage", { get() { throw new DOMException("blocked", "SecurityError"); } });
  Object.defineProperty(globalThis, "window", { value: blocked, configurable: true, writable: true });
  writeVoiceGender("female");
  assert.equal(readVoiceGender(), "female");
  writeVoiceGender("male");
  assert.equal(readVoiceGender(), "male");
});
