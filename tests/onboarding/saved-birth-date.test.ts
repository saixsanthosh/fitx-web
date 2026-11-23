import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Setup and a saved date of birth (20261124100000 refuses a member's change: profiles_birth_date_locked). The .tsx
// flow cannot be loaded here, so its wiring is checked in its source.

const ROOT = new URL("../../", import.meta.url);
const flow = readFileSync(new URL("src/app/(auth)/onboarding/OnboardingFlow.tsx", ROOT), "utf8");
const controls = readFileSync(new URL("src/components/profile/ProfileControls.tsx", ROOT), "utf8");

describe("setup shows a saved date of birth instead of editing it", () => {
  test("a date already saved (or saved by the first page) is shown read-only, with a way to ask support", () => {
    assert.match(flow, /setSavedBirthDate\(result\.data\.schema\.onboardingV3 \? normalizeBirthDate\(result\.data\.profile\?\.date_of_birth\) : null\)/);
    assert.match(flow, /if \(birthDateSent\) setSavedBirthDate\(normalizeBirthDate\(plan\.profile\.date_of_birth\)\);/);
    assert.match(flow, /\{savedBirthDate\s*\? <SavedBirthDate value=\{savedBirthDate\} helpHref="\/help\?from=%2Fonboarding" \/>\s*: <BirthDateField /);
  });

  test("a date the member had no right to save is not shown as saved", () => {
    assert.match(flow, /if \(saved\.error\?\.code === "42501" && birthDateSent\) \{[\s\S]*?birthDateSent = false;/);
  });

  test("a refused change says why and keeps the saved date", () => {
    assert.match(flow, /if \(isBirthDateLocked\(saved\.error\)\) \{\s*const kept = await loadBirthDate\(supabase, userId\);[\s\S]*?return BIRTH_DATE_SAVED_ERROR;/);
  });

  test("the read-only date has a 44 px link to Help and the support line", () => {
    const saved = controls.slice(controls.indexOf("export function SavedBirthDate"), controls.indexOf("export function BirthDateField"));
    assert.match(saved, /You can add it once\. To change it, ask FITX support\./);
    assert.match(saved, /<Link href=\{helpHref\} className="[^"]*\bmin-h-11\b/);
  });
});
