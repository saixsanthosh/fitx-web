import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { logoHoldMs, postOnboardingSteps, readCookie } from "@/lib/onboarding/post-sequence";
import { POST_ONBOARDING_FILM } from "@/components/onboarding/post-onboarding-film";

test("after onboarding: film then logo, just the logo without a film, nothing when the account film is pending", () => {
  assert.deepEqual(postOnboardingSteps({ cookies: "", hasFilm: false }), ["logo"]);
  assert.deepEqual(postOnboardingSteps({ cookies: "fitx_intro=seen", hasFilm: true }), ["film", "logo"]);
  assert.deepEqual(postOnboardingSteps({ cookies: "a=1; fitx_intro=play; b=2", hasFilm: true }), [], "the account film plays on Home and ends on the logo");
  assert.deepEqual(postOnboardingSteps({ cookies: "fitx_intro_checked=play", hasFilm: false }), ["logo"], "only the exact cookie counts");
});

test("wave 1 has no post-onboarding film yet: the slot is empty", () => {
  assert.equal(POST_ONBOARDING_FILM, null);
});

test("cookies are read exactly, decoded, and missing ones are null", () => {
  assert.equal(readCookie("x=1; fitx_intro=se%65n", "fitx_intro"), "seen");
  assert.equal(readCookie("x=1", "fitx_intro"), null);
  assert.equal(readCookie("bad=%E0%A4%A", "bad"), "%E0%A4%A");
});

test("the logo holds briefly, never past the 2.2 s the brand allows", () => {
  assert.ok(logoHoldMs(false) <= 2200 && logoHoldMs(false) >= 1400);
  assert.ok(logoHoldMs(true) <= 800);
});

test("onboarding ends in the sequence, which loads Home in full, with Skip", () => {
  const flow = readFileSync(new URL("../../src/app/(auth)/onboarding/OnboardingFlow.tsx", import.meta.url), "utf8");
  assert.match(flow, /<PostOnboardingSequence onDone=\{\(\) => window\.location\.assign\("\/dashboard"\)\} \/>/);
  const sequence = readFileSync(new URL("../../src/components/onboarding/PostOnboardingSequence.tsx", import.meta.url), "utf8");
  assert.match(sequence, />Skip<\/button>/);
  assert.match(sequence, /<Logo size=\{\d+\} animateMark=/);
});
