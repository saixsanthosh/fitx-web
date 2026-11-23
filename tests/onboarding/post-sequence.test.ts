import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { logoHoldMs, postOnboardingSteps, readCookie } from "@/lib/onboarding/post-sequence";
import { FILM_MANIFESTS } from "@/components/brand/films/cuts.generated";

test("without the welcome film (D1 dormant): exactly wave 1's steps, the logo, or nothing when the account film is pending", () => {
  assert.deepEqual(postOnboardingSteps({ cookies: "", hasFilm: false }), ["logo"]);
  assert.deepEqual(postOnboardingSteps({ cookies: "fitx_intro=seen", hasFilm: false }), ["logo"]);
  assert.deepEqual(postOnboardingSteps({ cookies: "a=1; fitx_intro=play; b=2", hasFilm: false }), [], "the account film plays on Home and ends on the logo");
  assert.deepEqual(postOnboardingSteps({ cookies: "fitx_intro_checked=play", hasFilm: false }), ["logo"], "only the exact cookie counts");
});

test("with the welcome film: just the film, whatever the cookie says (it ends on the logo and records itself)", () => {
  for (const cookies of ["", "fitx_intro=seen", "a=1; fitx_intro=play; b=2"]) assert.deepEqual(postOnboardingSteps({ cookies, hasFilm: true }), ["film"], cookies);
});

test("the slot holds the welcome film, which stays dormant until its cuts exist", () => {
  const slot = readFileSync(new URL("../../src/components/onboarding/post-onboarding-film.ts", import.meta.url), "utf8");
  assert.match(slot, /= WelcomeFilm;/);
  assert.equal(FILM_MANIFESTS.welcome, null, "no welcome cuts before S6, so new sign-ups see what they see today");
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
  assert.match(flow, /<PostOnboardingSequence onDone=\{\(\) => window\.location\.assign\("\/dashboard"\)\} firstName=\{form \? firstName\(form\.name\) : null\} \/>/);
  const sequence = readFileSync(new URL("../../src/components/onboarding/PostOnboardingSequence.tsx", import.meta.url), "utf8");
  assert.match(sequence, />Skip<\/button>/);
  assert.match(sequence, /<Logo size=\{\d+\} animateMark=/);
});
