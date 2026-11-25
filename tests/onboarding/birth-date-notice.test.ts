import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BIRTH_DATE_ONCE_NOTE } from "@/lib/domain/profile-options";

// Bug 25 (onboarding-6): setup's first Continue saves the date of birth for good (the database refuses a member's
// change, 20261124100000), but step 1 said nothing before then. The .tsx files cannot be loaded here, so their wiring
// is checked in their source.

const ROOT = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

describe("setup says the date of birth is added once, before it is saved", () => {
  test("the notice uses the words Profile > Body and Explore settings already show", () => {
    assert.equal(BIRTH_DATE_ONCE_NOTE, "You can add it once. To change it later, ask FITX support.");
    // Either the same words or the shared constant itself.
    const says = (path: string) => read(path).includes(BIRTH_DATE_ONCE_NOTE) || read(path).includes("BIRTH_DATE_ONCE_NOTE");
    assert.ok(says("src/app/(dashboard)/profile/ProfileSections.tsx"), "Profile > Body");
    assert.ok(says("src/components/social/SettingsView.tsx"), "Explore settings");
  });

  test("step 1's date field carries the notice while the date is not saved yet", () => {
    const flow = read("src/app/(auth)/onboarding/OnboardingFlow.tsx");
    assert.match(flow, /: <BirthDateField value=\{form\.birthDate\} onChange=\{\(value\) => update\("birthDate", value\)\} error=\{errors\.birthDate\} note=\{BIRTH_DATE_ONCE_NOTE\} \/>/);
    // Once saved, the read-only date says how to change it instead.
    assert.match(flow, /\? <SavedBirthDate value=\{savedBirthDate\}/);
  });

  test("the field shows the notice under it and screen readers hear it with the field", () => {
    const controls = read("src/components/profile/ProfileControls.tsx");
    const field = controls.slice(controls.indexOf("export function BirthDateField"));
    assert.match(field, /const describedBy = \[`\$\{id\}-age`, error \? `\$\{id\}-error` : null, note \? `\$\{id\}-note` : null\]/);
    assert.match(field, /aria-describedby=\{describedBy\}/);
    assert.match(field, /\{note && <p id=\{`\$\{id\}-note`\} className="[^"]*">\{note\}<\/p>\}/);
  });
});
