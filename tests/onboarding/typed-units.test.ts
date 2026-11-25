import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { heightError, readMeasureText, weightError } from "@/lib/domain/profile-options";
import { initialOnboardingForm, validatePage, type OnboardingSource } from "@/lib/onboarding/form";
import { keptDraft, measureRead, measureText, measureValue, type MeasureText } from "@/lib/onboarding/measure-field";
import { normalizePreferences } from "@/lib/domain/user-context";

// Bug 8 (onboarding-1): "65kg" or "abc" in a weight field was NaN, the field then went blank when it was left (while
// still holding NaN), no message showed, and Continue refused the empty-looking optional target until a digit was
// typed and deleted.

const FULL = { preferencesV2: true, onboardingV3: true };
const TODAY = new Date(2026, 10, 26);
const box = (main: string, inches = ""): MeasureText => ({ main, inches });

function bodyForm(overrides: Record<string, unknown>) {
  const source: OnboardingSource = {
    profile: { name: "Asha Rao", date_of_birth: "1997-03-14", gender: "female", height: null, target_weight: null },
    preferences: normalizePreferences(null).values,
    currentWeightKg: null,
  };
  return { ...initialOnboardingForm(source), heightCm: 162.5, weightKg: 58.4, ...overrides };
}

describe("a unit typed after the number is understood", () => {
  test("65kg, 65 kg, 65 KG, 65 kgs and 65 kilos in a kilogram field are 65", () => {
    for (const typed of ["65kg", "65 kg", "65 KG", "65 kgs", "65 kilos", "65 kilograms", "65", " 65 "]) {
      assert.equal(measureValue("weight", "kg", box(typed)), 65, typed);
    }
  });

  test("the value doesn't vanish while the unit or a decimal is being typed", () => {
    for (const typed of ["65 k", "65 ki", "65.", "65 kg."]) assert.equal(measureValue("weight", "kg", box(typed)), 65, typed);
    assert.equal(measureValue("weight", "kg", box("72,5")), 72.5, "a decimal comma");
    assert.equal(measureValue("weight", "lb", box("1,102 lb")), measureValue("weight", "lb", box("1102")), "1,102 as the messages write it");
  });

  test("heights take their own units too", () => {
    assert.equal(measureValue("height", "cm", box("176cm")), 176);
    assert.equal(measureValue("height", "cm", box("162.5 cm")), 162.5);
    assert.equal(measureValue("height", "ft_in", box("5 ft", "9 in")), measureValue("height", "ft_in", box("5", "9")));
    assert.equal(measureValue("height", "ft_in", box("5'", "9\"")), measureValue("height", "ft_in", box("5", "9")));
  });

  test("the other unit switches the field, when the unit can be saved: 150 lb in kilograms is 150 lb", () => {
    assert.deepEqual(measureRead("weight", "kg", box("150 lb")), { unit: "lb", value: 68.04 });
    assert.deepEqual(measureRead("weight", "kg", box("150 l")), { unit: "lb", value: 68.04 }, "as soon as the unit is begun");
    assert.deepEqual(measureRead("weight", "lb", box("70 kg")), { unit: "kg", value: 70 });
    assert.deepEqual(measureRead("height", "cm", box("5 ft")), { unit: "ft_in", value: 152.4 });
    assert.deepEqual(measureRead("height", "ft_in", box("175 cm", "4")), { unit: "cm", value: 175 }, "the feet box can switch; its inches are then not used");
    assert.ok(Number.isNaN(measureRead("weight", "kg", box("150 lb"), false).value), "before the unit can be saved, pounds aren't a number in kilograms");
    assert.equal(measureRead("weight", "kg", box("150 lb"), false).unit, "kg");
  });

  test("anything else is not a number", () => {
    for (const typed of ["abc", "65 kgx", "65 m", "6 5", "65.5.5", "5'9", "kg"]) assert.ok(Number.isNaN(measureValue("weight", "kg", box(typed))), typed);
    assert.ok(Number.isNaN(measureValue("height", "ft_in", box("5", "9 ft"))), "the inches box takes inches only");
    assert.equal(measureValue("weight", "kg", box("")), null);
    assert.equal(measureValue("weight", "kg", box("   ")), null);
    assert.deepEqual(readMeasureText("", ["kg"]), { value: null, unit: null });
  });

  test("text kept because it is not a number is not a number in the other unit either, so a unit switch never makes it one", () => {
    for (const typed of ["abc", "65 kgx", "65 m", "6 5", "kg", "5'9"]) {
      assert.ok(Number.isNaN(measureRead("weight", "kg", box(typed)).value) && Number.isNaN(measureRead("weight", "lb", box(typed)).value), typed);
      assert.ok(Number.isNaN(measureRead("height", "cm", box(typed)).value) && Number.isNaN(measureRead("height", "ft_in", box(typed)).value), typed);
    }
  });
});

describe("leaving a field never blanks what was typed", () => {
  test("text that is not a number stays; a number shows as it will be saved", () => {
    assert.deepEqual(keptDraft("weight", "kg", box("abc")), box("abc"));
    assert.equal(keptDraft("weight", "kg", box("65kg")), null, "the field then shows the value's own text");
    assert.deepEqual(measureText("weight", "kg", measureValue("weight", "kg", box("65kg"))), box("65"));
    assert.equal(keptDraft("weight", "kg", box("")), null, "an emptied field is empty");
    assert.equal(keptDraft("weight", "kg", null), null);
    assert.deepEqual(keptDraft("height", "ft_in", box("5", "x")), box("5", "x"));
  });
});

describe("the messages say what to type", () => {
  test("text that is not a number gets a message in the unit shown, with an example", () => {
    assert.equal(weightError(Number.NaN, "kg"), "Enter your weight in kilograms, for example 70.5.");
    assert.equal(weightError(Number.NaN, "lb"), "Enter your weight in pounds, for example 155.");
    assert.equal(weightError(Number.NaN, "kg", { target: true }), "Enter your target in kilograms, for example 65, or leave it empty.");
    assert.equal(weightError(Number.NaN, "lb", { target: true }), "Enter your target in pounds, for example 145, or leave it empty.");
    assert.equal(heightError(Number.NaN, "cm"), "Enter your height in centimetres, for example 175.");
    assert.equal(heightError(Number.NaN, "ft_in"), "Enter your height in feet and inches, for example 5 ft 9 in.");
    assert.equal(heightError(Number.NaN, "cm", { optional: true }), "Enter your height in centimetres, for example 175, or leave it empty.");
  });

  test("step 2: 65kg as the target passes; abc is refused with that message; an empty target passes", () => {
    assert.deepEqual(validatePage("body", bodyForm({ targetWeightKg: measureValue("weight", "kg", box("65kg")) }), FULL, TODAY), {});
    assert.deepEqual(validatePage("body", bodyForm({ targetWeightKg: measureValue("weight", "kg", box("abc")) }), FULL, TODAY), {
      targetWeightKg: "Enter your target in kilograms, for example 65, or leave it empty.",
    });
    assert.deepEqual(validatePage("body", bodyForm({ targetWeightKg: measureValue("weight", "kg", box("")) }), FULL, TODAY), {});
    assert.deepEqual(validatePage("body", bodyForm({ weightKg: measureValue("weight", "kg", box("70 kg")) }), FULL, TODAY), {});
  });
});

describe("setup's dial and Profile's fields keep what was typed", () => {
  const dial = readFileSync(new URL("../../src/components/onboarding/MeasureDial.tsx", import.meta.url), "utf8");
  const flow = readFileSync(new URL("../../src/app/(auth)/onboarding/OnboardingFlow.tsx", import.meta.url), "utf8");
  const controls = readFileSync(new URL("../../src/components/profile/ProfileControls.tsx", import.meta.url), "utf8");

  test("leaving the dial keeps text that is not a number, and says what is wrong straight away", () => {
    assert.match(dial, /setDraft\(\(current\) => keptDraft\(kind, unit, current\)\);\s*onCommit\?\.\(\);/);
    assert.doesNotMatch(dial, /onBlur=\{\(\) => setDraft\(null\)\}/);
    assert.match(dial, /const read = measureRead\(kind, unit, next, showUnits\);\s*if \(read\.unit !== unit\) changeUnit\(read\.unit\);\s*report\(read\.value\);/);
    for (const key of ["heightCm", "weightKg", "targetWeightKg"]) assert.match(flow, new RegExp(`onCommit=\\{\\(\\) => checkTyped\\("${key}"\\)\\}`), key);
    assert.match(flow, /function checkTyped\(key: "heightCm" \| "weightKg" \| "targetWeightKg"\) \{\s*if \(!form \|\| form\[key\] === null\) return;/);
  });

  test("a unit change says the shown messages again in the new unit", () => {
    assert.match(flow, /onUnitChange=\{\(unit\) => changeUnit\("heightUnit", unit\)\}/);
    assert.equal(flow.match(/onUnitChange=\{\(unit\) => changeUnit\("weightUnit", unit\)\}/g)?.length, 2);
  });

  test("Profile's fields read units the same way and never blank text that is not a number", () => {
    assert.match(controls, /const read = measureRead\("weight", unit, \{ main: value, inches: "" \}, showUnits\);/);
    assert.match(controls, /if \(!notANumber\(kg\)\) setText\(shown\(kg, unit\)\);/);
    assert.match(controls, /if \(!notANumber\(cm\)\) setText\(heightText\(cm, unit\)\);/);
    assert.doesNotMatch(controls, /parseDecimal/);
  });
});
