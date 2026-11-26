// The same mistake as review finding a11y-onboarding-continue-disabled-while-saving (fix round 3a), on setup's other
// failure: when the member's details don't load, "Try again" sits in the alert. Pressing it swapped the alert for
// "Loading your profile…", so the button went and keyboard focus fell to the page; when loading ended (setup ready, or
// the alert again), nothing had focus. Focus now goes to the step's heading, or to the new Try again, which carries
// the alert's message for screen readers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { focusAfterRetry } from "@/lib/onboarding/save-focus";

const flow = readFileSync(new URL("../../src/app/(auth)/onboarding/OnboardingFlow.tsx", import.meta.url), "utf8");

test("after Try again, focus goes to the heading when setup is ready, or to Try again when loading failed again", () => {
  assert.equal(focusAfterRetry("ready"), "heading");
  assert.equal(focusAfterRetry("load_failed"), "retry");
  assert.equal(focusAfterRetry("loading"), null, "still loading: nowhere to go yet");
  assert.equal(focusAfterRetry("unavailable"), null, "no control of its own");
  assert.equal(focusAfterRetry("welcome"), null);
});

test("Try again marks the retry; once loading ends, focus is handed on and the mark is cleared", () => {
  assert.match(flow, /const retried = useRef\(false\);/);
  assert.match(flow, /onClick=\{\(\) => \{ retried\.current = true; setPhase\("loading"\); setReload\(\(count\) => count \+ 1\); \}\}/);
  assert.match(flow, /useEffect\(\(\) => \{\s*if \(!retried\.current \|\| phase === "loading"\) return;\s*retried\.current = false;\s*const target = focusAfterRetry\(phase\);\s*\(target === "heading" \? heading\.current : target === "retry" \? retryRef\.current : null\)\?\.focus\(\{ preventScroll: true \}\);\s*\}, \[phase\]\);/);
  // The heading can take focus (as on a step change), and only a retry moves focus: a first load leaves it alone.
  assert.match(flow, /<h1 id="onboarding-title" ref=\{heading\} tabIndex=\{-1\}/);
  assert.doesNotMatch(flow.replace(/onClick=\{\(\) => \{ retried\.current = true;/, ""), /retried\.current = true/, "nothing else sets it");
});

test("Try again carries the alert's message, so it is read when focus lands on it", () => {
  assert.match(flow, /<span id="onboarding-load-failed">We couldn’t load your details, so setup is paused to keep them safe\.<\/span>/);
  assert.match(flow, /<button ref=\{retryRef\} type="button" aria-describedby="onboarding-load-failed" className="fitx-alert-action/);
});
