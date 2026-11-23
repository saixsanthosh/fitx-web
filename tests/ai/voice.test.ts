// Voice conversation: the pure helpers behind push to talk and read aloud, plus source checks on how the coach wires them.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAX_SPOKEN, joinTranscript, pickVoice, recognitionLang, speakableText, voiceErrorText } from "../../src/components/coach/voice.ts";
import { VOICE_PRIVACY } from "../../src/lib/ai/disclosure.ts";

const source = (file: string) => readFileSync(new URL(`../../src/components/coach/${file}`, import.meta.url), "utf8");

describe("coach voice helpers", () => {
  test("recognition uses the browser's English variant, else British English", () => {
    assert.equal(recognitionLang("en-IN"), "en-IN");
    assert.equal(recognitionLang("en"), "en");
    assert.equal(recognitionLang("hi-IN"), "en-GB");
    assert.equal(recognitionLang(undefined), "en-GB");
  });

  test("only on-device voices read replies aloud", () => {
    const voices = [
      { name: "Google UK English Female", lang: "en-GB", localService: false },
      { name: "Daniel", lang: "en-GB", localService: true },
      { name: "Rishi", lang: "en-IN", localService: true },
    ];
    assert.equal(pickVoice(voices, "en-IN")?.name, "Rishi");
    assert.equal(pickVoice(voices, "en-US")?.name, "Daniel");
    assert.equal(pickVoice([voices[0]], "en-GB"), null, "a network voice is never used");
    assert.equal(pickVoice([{ name: "Amélie", lang: "fr-CA", localService: true }], "en-GB"), null);
  });

  test("spoken text drops list marks, emphasis and links, and long replies stop at a sentence", () => {
    assert.equal(speakableText("**Rest** today.\n- Sleep 8 hours\n- Walk https://example.com"), "Rest today. Sleep 8 hours. Walk");
    const long = Array.from({ length: 80 }, (_, index) => `Sentence number ${index} is here.`).join(" ");
    const spoken = speakableText(long);
    assert.ok(spoken.length <= MAX_SPOKEN);
    assert.match(spoken, /\.$/);
  });

  test("recognition errors read as plain advice, and stopping says nothing", () => {
    assert.equal(voiceErrorText("aborted"), null);
    assert.match(voiceErrorText("not-allowed") ?? "", /Microphone access is off/);
    assert.match(voiceErrorText("network") ?? "", /internet/);
    assert.match(voiceErrorText("weird") ?? "", /try again/i);
  });

  test("transcripts join final and interim parts", () => {
    assert.equal(joinTranscript(["how much ", " protein"], " do I need"), "how much protein do I need");
    assert.equal(joinTranscript([], ""), "");
  });

  test("the privacy note is honest about where speech goes", () => {
    assert.match(VOICE_PRIVACY, /browser may send the recording to its maker/);
    assert.match(VOICE_PRIVACY, /FITX receives only the text/);
    assert.match(VOICE_PRIVACY, /never records or stores audio/);
  });
});

describe("coach voice wiring", () => {
  test("push to talk explains privacy before the first use, and sends what was heard", () => {
    const voice = source("CoachVoice.tsx");
    assert.match(voice, /read\(VOICE_OK_KEY\) !== "yes"/);
    assert.match(voice, /\{VOICE_PRIVACY\}/);
    assert.match(voice, /aria-label=\{listening \? "Stop talking" : "Hold to talk"\}/);
    assert.match(voice, /if \(!supported\) return null;/, "no microphone button where the browser has no speech recognition");
    const app = source("CoachApp.tsx");
    assert.match(app, /onFinished=\{\(text\) => void send\(text\)\}/);
    assert.match(app, /onTranscript=\{setDraft\}/);
    assert.match(app, /<ReadAloudToggle readAloud=\{readAloud\} \/>/);
    assert.match(app, /event\.message\.role !== "user" && event\.message\.task === "chat"\) speakReply/);
    assert.match(source("Composer.tsx"), /\{voice\}/);
  });
});
