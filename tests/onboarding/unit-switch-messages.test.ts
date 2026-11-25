import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MEASURED_IN,
  NO_DRAFTS,
  initialOnboardingForm,
  messagesAfterUnitChange,
  validatePage,
  type MeasureDrafts,
  type MeasureKey,
  type OnboardingErrors,
  type OnboardingForm,
  type OnboardingSource,
} from "@/lib/onboarding/form";
import { keptDraft, measureRead, measureSwitch, type MeasureText } from "@/lib/onboarding/measure-field";
import { normalizePreferences } from "@/lib/domain/user-context";

// Review of bug 8 (onboarding-1), finding onb-8-unit-switch-erases-message. A dial's own unit toggle, with text that is
// not a number kept in the field, reported the NaN read again in the new unit as a change of value before the unit
// changed. A change of value clears the field's message (as typing does), so the unit change then found no message to
// say again: "abc" in Height, Tab, then "ft + in" left "abc" with no message and no aria-invalid until Continue. The
// value now goes with the unit, and the messages shown are said again for what the fields hold in the new unit.

const FULL = { preferencesV2: true, onboardingV3: true };
const box = (main: string, inches = ""): MeasureText => ({ main, inches });
const KIND = { heightCm: "height", weightKg: "weight", targetWeightKg: "weight" } as const;
const UNIT_KEY = { heightCm: "heightUnit", weightKg: "weightUnit", targetWeightKg: "weightUnit" } as const;

/** Setup's state for step 2: the answers, the text each dial shows in place of its answer, the messages shown. */
type Step2 = { form: OnboardingForm; drafts: MeasureDrafts; errors: OnboardingErrors };

function start(overrides: Partial<OnboardingForm> = {}): Step2 {
  const source: OnboardingSource = {
    profile: { name: "Asha Rao", date_of_birth: "1997-03-14", gender: "female", height: null, target_weight: null },
    preferences: normalizePreferences(null).values,
    currentWeightKg: null,
  };
  return { form: { ...initialOnboardingForm(source), heightCm: 162.5, weightKg: 58.4, ...overrides }, drafts: NO_DRAFTS, errors: {} };
}

/** The member types `text` in a dial and leaves it: MeasureDial's typed() and leave(), and setup's checkTyped(). */
function typeAndLeave(state: Step2, key: MeasureKey, text: MeasureText): Step2 {
  const unitKey = UNIT_KEY[key];
  const read = measureRead(KIND[key], state.form[unitKey], text, true);
  const form = { ...state.form, [unitKey]: read.unit, [key]: read.value };
  // A unit typed after the number changes the unit; the typed value is a change, which clears its own message.
  const errors = read.unit === state.form[unitKey] ? { ...state.errors } : messagesAfterUnitChange(state.errors, form, unitKey, FULL);
  delete errors[key];
  const message = read.value === null ? undefined : validatePage("body", form, FULL)[key];
  if (message) errors[key] = message;
  return { form, drafts: { ...state.drafts, [key]: keptDraft(KIND[key], read.unit, text) }, errors };
}

/** The member uses a dial's own unit toggle: MeasureDial's switchUnit() and setup's changeUnit(). */
function toggle(state: Step2, key: MeasureKey, unit: string): Step2 {
  const unitKey = UNIT_KEY[key];
  const switched = measureSwitch(KIND[key], unit, state.drafts[key], state.form[key]);
  const form = { ...state.form, [key]: switched.value, [unitKey]: unit };
  return { form, drafts: { ...state.drafts, [key]: switched.draft }, errors: messagesAfterUnitChange(state.errors, form, unitKey, FULL) };
}

describe("a unit switch says the field's message again in the new unit", () => {
  test("abc in Height, Tab, then ft + in: abc stays, with the message in feet and inches, and back again in cm", () => {
    let state = typeAndLeave(start(), "heightCm", box("abc"));
    assert.equal(state.errors.heightCm, "Enter your height in centimetres, for example 175.");
    state = toggle(state, "heightCm", "ft_in");
    assert.deepEqual(state.drafts.heightCm, box("abc"), "the feet box keeps abc");
    assert.ok(Number.isNaN(state.form.heightCm));
    assert.equal(state.errors.heightCm, "Enter your height in feet and inches, for example 5 ft 9 in.");
    state = toggle(state, "heightCm", "cm");
    assert.equal(state.errors.heightCm, "Enter your height in centimetres, for example 175.");
  });

  test("the weight dials do the same with their own toggle, and with the other weight dial's", () => {
    const lb = { weightKg: "Enter your weight in pounds, for example 155.", targetWeightKg: "Enter your target in pounds, for example 145, or leave it empty." };
    const kg = { weightKg: "Enter your weight in kilograms, for example 70.5.", targetWeightKg: "Enter your target in kilograms, for example 65, or leave it empty." };
    for (const key of ["weightKg", "targetWeightKg"] as const) {
      for (const via of ["weightKg", "targetWeightKg"] as const) {
        let state = typeAndLeave(start(), key, box("abc"));
        assert.equal(state.errors[key], kg[key]);
        state = toggle(state, via, "lb");
        assert.deepEqual(state.drafts[key], box("abc"), `${key} with ${via}'s toggle`);
        assert.equal(state.errors[key], lb[key], `${key} with ${via}'s toggle`);
        state = toggle(state, via, "kg");
        assert.equal(state.errors[key], kg[key], `${key} back with ${via}'s toggle`);
      }
    }
  });

  test("a number keeps its message, in the new unit's limits; the message goes when the value is fine in that unit", () => {
    let height = typeAndLeave(start(), "heightCm", box("89.9"));
    assert.equal(height.errors.heightCm, "Enter a height between 90 and 250 cm.");
    height = toggle(height, "heightCm", "ft_in");
    assert.equal(height.form.heightCm, 89.9, "a switch never changes a number");
    assert.equal(height.errors.heightCm, "Enter a height between 3 ft 0 in and 8 ft 2 in.");

    let weight = typeAndLeave(start({ weightUnit: "lb" }), "weightKg", box("66.5"));
    assert.equal(weight.errors.weightKg, "Enter a weight between 67 and 1,102 lb.");
    weight = toggle(weight, "weightKg", "kg");
    assert.equal(weight.form.weightKg, 30.16);
    assert.deepEqual(weight.errors, {}, "30.2 kg is fine, so the message goes");
  });

  test("feet with inches that aren't a number, then cm: the feet box becomes the centimetre box, and the message is about it", () => {
    let state = typeAndLeave(start({ heightUnit: "ft_in" }), "heightCm", box("5", "x"));
    assert.equal(state.errors.heightCm, "Enter your height in feet and inches, for example 5 ft 9 in.");
    state = toggle(state, "heightCm", "cm");
    assert.equal(state.form.heightCm, 5);
    assert.equal(state.drafts.heightCm, null, "5 is a number in centimetres, so the field shows the value");
    assert.equal(state.errors.heightCm, "Enter a height between 90 and 250 cm.");
  });

  test("a unit typed in one weight field says the other one's message again in that unit", () => {
    let state = typeAndLeave(start(), "targetWeightKg", box("abc"));
    state = typeAndLeave(state, "weightKg", box("150 lb"));
    assert.equal(state.form.weightUnit, "lb");
    assert.equal(state.form.weightKg, 68.04);
    assert.deepEqual(state.errors, { targetWeightKg: "Enter your target in pounds, for example 145, or leave it empty." });
  });

  test("a switch raises no message the member wasn't shown, and leaves the other unit's messages alone", () => {
    // After Back and Continue, abc is in its field again with no message until it is left or Continue is pressed.
    let state: Step2 = { ...typeAndLeave(start(), "heightCm", box("abc")), errors: {} };
    state = toggle(state, "heightCm", "ft_in");
    assert.deepEqual(state.errors, {});
    state = typeAndLeave(start(), "heightCm", box("abc"));
    state = toggle(state, "weightKg", "lb");
    assert.deepEqual(state.errors, { heightCm: "Enter your height in centimetres, for example 175." });
  });

  test("what went wrong: the NaN reported as a change cleared the message before the unit change could say it again", () => {
    const state = typeAndLeave(start(), "heightCm", box("abc"));
    const cleared: OnboardingErrors = { ...state.errors };
    delete cleared.heightCm; // update("heightCm", NaN), as the old switchUnit did first
    assert.deepEqual(messagesAfterUnitChange(cleared, { ...state.form, heightUnit: "ft_in" }, "heightUnit", FULL), {});
  });
});

describe("what a field holds after its unit is switched (measureSwitch)", () => {
  test("a stored value stays as it is; kept text is read again in the new unit and stays while it is still not a number", () => {
    assert.deepEqual(measureSwitch("weight", "lb", null, 68.04), { value: 68.04, draft: null });
    assert.deepEqual(measureSwitch("height", "ft_in", null, null), { value: null, draft: null });
    assert.deepEqual(measureSwitch("height", "ft_in", box("abc"), Number.NaN), { value: Number.NaN, draft: box("abc") });
    assert.deepEqual(measureSwitch("weight", "lb", box("6 5"), Number.NaN), { value: Number.NaN, draft: box("6 5") });
    assert.deepEqual(measureSwitch("height", "cm", box("5", "x"), Number.NaN), { value: 5, draft: null });
    assert.deepEqual(measureSwitch("height", "cm", box("", "x"), Number.NaN), { value: null, draft: null }, "the inches box has no place in centimetres");
    assert.deepEqual(measureSwitch("weight", "lb", box("65"), 65), { value: 29.48, draft: null }, "a number still being typed is read in the unit chosen");
  });
});

describe("the dial hands the value over with the unit, and setup says the messages again for both", () => {
  const dial = readFileSync(new URL("../../src/components/onboarding/MeasureDial.tsx", import.meta.url), "utf8");
  const flow = readFileSync(new URL("../../src/app/(auth)/onboarding/OnboardingFlow.tsx", import.meta.url), "utf8");

  test("switchUnit reads the kept text again and passes the value with the unit, never as a change of its own", () => {
    const body = /function switchUnit\(next: HeightUnit \| WeightUnit\) \{([\s\S]*?)\n  \}/.exec(dial)?.[1] ?? "";
    assert.match(body, /const switched = measureSwitch\(kind, next, draft, props\.value\);/);
    assert.match(body, /changeUnit\(next, switched\.value\);/);
    assert.doesNotMatch(body, /report\(/, "a value reported as a change clears the field's message first");
  });

  test("setup applies the value with the unit and says the messages again for what the fields hold", () => {
    assert.match(flow, /setForm\(\(current\) => \(current \? \{ \.\.\.current, \.\.\.values, \[key\]: unit \} : current\)\);/);
    assert.match(flow, /const next = \{ \.\.\.form, \.\.\.values, \[key\]: unit \};\s*setErrors\(\(current\) => messagesAfterUnitChange\(current, next, key, schema\)\);/);
    assert.deepEqual(MEASURED_IN, { heightUnit: ["heightCm"], weightUnit: ["weightKg", "targetWeightKg"] });
  });
});
