// The floating AI Coach button on a first visit: with nothing cached on the device it waits for the account's
// answer (and FITX Admin's switch) instead of showing for a moment and vanishing when the answer is "off".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cachedAnswer, knownAnswer } from "@/components/layout/coach-launcher-reveal";

/** The launcher's own rule (CoachLauncher: `enabled !== true || coachOn !== true` hides it). */
const launcherAllowed = (choice: boolean | null, coachSwitch: boolean | null) => choice === true && coachSwitch === true;
import { COACH_LAUNCHER_CACHE_KEY } from "@/lib/shell/coach-launcher-pref";

const memory = (initial: Record<string, string> = {}) => ({ getItem: (key: string) => initial[key] ?? null });

test("the device's cached answer: on, off, or unknown when nothing is stored or storage is blocked", () => {
  assert.equal(cachedAnswer(memory({ [COACH_LAUNCHER_CACHE_KEY]: "on" }), COACH_LAUNCHER_CACHE_KEY), true);
  assert.equal(cachedAnswer(memory({ [COACH_LAUNCHER_CACHE_KEY]: "off" }), COACH_LAUNCHER_CACHE_KEY), false);
  assert.equal(cachedAnswer(memory({ [COACH_LAUNCHER_CACHE_KEY]: "garbage" }), COACH_LAUNCHER_CACHE_KEY), true, "as cachedLauncherPref reads it");
  assert.equal(cachedAnswer(memory(), COACH_LAUNCHER_CACHE_KEY), null, "a first visit knows nothing yet");
  assert.equal(cachedAnswer(null, COACH_LAUNCHER_CACHE_KEY), null);
  assert.equal(cachedAnswer({ getItem: () => { throw new Error("blocked"); } }, COACH_LAUNCHER_CACHE_KEY), null);
});

test("a first visit shows nothing until both answers come; a returning device shows its cached choice at once", () => {
  // First visit: nothing cached, nothing answered yet: hidden (no flash).
  assert.equal(launcherAllowed(knownAnswer(null, null), knownAnswer(null, null)), false);
  // The account answers on, the switch has not answered: still waiting.
  assert.equal(launcherAllowed(knownAnswer(true, null), knownAnswer(null, null)), false);
  assert.equal(launcherAllowed(knownAnswer(true, null), knownAnswer(true, null)), true, "both on: it appears");
  // The account answers off: it never appeared, so nothing vanishes.
  assert.equal(launcherAllowed(knownAnswer(false, null), knownAnswer(true, null)), false);
  // Returning device: the cache answers at once, the fresh answer wins when it comes.
  assert.equal(launcherAllowed(knownAnswer(null, true), knownAnswer(null, true)), true);
  assert.equal(launcherAllowed(knownAnswer(false, true), knownAnswer(null, true)), false, "turned off on another device");
  assert.equal(launcherAllowed(knownAnswer(null, false), knownAnswer(null, true)), false, "off on this device stays off");
});

test("the launcher reads the raw caches, so a missing entry is unknown rather than on", () => {
  const launcher = readFileSync(new URL("../../src/components/layout/CoachLauncher.tsx", import.meta.url), "utf8");
  assert.match(launcher, /const cached = \(key: string\) => cachedAnswer\(storage\(\), key\);/);
  assert.match(launcher, /knownAnswer\(chosen, cached\(COACH_LAUNCHER_CACHE_KEY\)\)/);
  assert.match(launcher, /knownAnswer\(switchedOn, cached\(COACH_SWITCH_CACHE_KEY\)\)/);
  assert.match(launcher, /const hidden = enabled !== true \|\| coachOn !== true \|\|/);
  assert.doesNotMatch(launcher, /cachedLauncherPref\(\)|cachedCoachSwitch\(\)/, "the on-when-missing readers are not used for showing it");
});
