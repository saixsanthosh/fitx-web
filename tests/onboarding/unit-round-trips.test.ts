import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HEIGHT_LIMITS,
  HEIGHT_RANGE_CM,
  WEIGHT_LIMITS,
  WEIGHT_RANGE_KG,
  formatHeight,
  formatWeight,
  heightError,
  heightInLimits,
  sameWeightKg,
  weightError,
  weightInLimits,
} from "@/lib/domain/profile-options";
import { weightRangeText, weightText, weightToKg } from "@/lib/domain/weight-display";
import { dialStep } from "@/lib/onboarding/dial";
import { initialOnboardingForm, pageSave, validatePage, type OnboardingSource } from "@/lib/onboarding/form";
import { measureFromShown, measureShown, measureText, measureValue } from "@/lib/onboarding/measure-field";
import { normalizePreferences } from "@/lib/domain/user-context";

// Bugs 6, 32 and 33 (onboarding-2, -3, -4): a height or weight went through the stored unit and was rounded on the
// way (pounds to 0.1 kg, the cm field to whole centimetres, inches to whole inches), so the field, the readouts and
// Profile showed a different number from the one typed, and the limits the messages named were refused.

const FULL = { preferencesV2: true, onboardingV3: true };
const TODAY = new Date(2026, 10, 26);

function bodyForm(overrides: Record<string, unknown>) {
  const source: OnboardingSource = {
    profile: { name: "Asha Rao", date_of_birth: "1997-03-14", gender: "female", height: null, target_weight: null },
    preferences: normalizePreferences(null).values,
    currentWeightKg: null,
  };
  return { ...initialOnboardingForm(source), heightCm: 162, weightKg: 68.5, ...overrides };
}

/** What the field shows after the member types `text` in the unit and leaves it. */
const typedThenShown = (kind: "height" | "weight", unit: string, text: { main: string; inches: string }) => measureText(kind, unit, measureValue(kind, unit, text));
const lb = (value: string) => ({ main: value, inches: "" });

describe("a weight typed in pounds comes back as typed (bug 6)", () => {
  test("150 lb is stored as 68.04 kg and shows as 150 lb in the field, the readout and Profile", () => {
    const kg = measureValue("weight", "lb", lb("150"));
    assert.equal(kg, 68.04);
    assert.deepEqual(measureText("weight", "lb", kg), { main: "150", inches: "" });
    assert.equal(formatWeight(kg, "lb"), "150 lb");
    assert.equal(pageSave("body", bodyForm({ weightKg: kg, weightUnit: "lb" }), { schema: FULL, today: TODAY }).profile!.weight, 68.04);
  });

  test("160, 66 and 1,102 lb stay 160, 66 and 1102", () => {
    for (const typed of ["160", "66", "1102", "67", "440", "155.5", "149.9"]) assert.equal(typedThenShown("weight", "lb", lb(typed)).main, typed, typed);
  });

  test("every weight typed to 0.1 lb inside the limits comes back unchanged", () => {
    const changed: number[] = [];
    for (let tenths = WEIGHT_LIMITS.lb.min * 10; tenths <= WEIGHT_LIMITS.lb.max * 10; tenths += 1) {
      const typed = tenths / 10;
      if (measureShown("weight", "lb", measureValue("weight", "lb", lb(String(typed)))) !== typed) changed.push(typed);
    }
    assert.deepEqual(changed, []);
  });

  test("+ moves by exactly 1 lb: 150 gives 151, 152 and 153", () => {
    let kg = measureValue("weight", "lb", lb("150"));
    const seen: number[] = [];
    for (let press = 0; press < 3; press += 1) {
      kg = measureFromShown("weight", "lb", dialStep("weight", "lb", measureShown("weight", "lb", kg), 1));
      seen.push(measureShown("weight", "lb", kg)!);
    }
    assert.deepEqual(seen, [151, 152, 153]);
  });

  test("switching units shows the same weight and never changes it", () => {
    const kg = measureValue("weight", "lb", lb("150"));
    assert.equal(measureText("weight", "kg", kg).main, "68");
    assert.equal(measureText("weight", "lb", kg).main, "150", "back in pounds, still 150");
  });

  test("kilograms typed to 0.1 stay as typed", () => {
    for (const typed of ["58.4", "68.5", "70", "30", "500"]) assert.equal(typedThenShown("weight", "kg", lb(typed)).main, typed, typed);
  });

  test("Home and Progress weigh-ins in pounds keep the same precision", () => {
    assert.equal(weightToKg(150, "lb"), 68.04);
    assert.equal(weightText(68.04, "lb"), "150.0");
    assert.equal(weightToKg(140, "lb"), 63.5, "e2e flow 13 saves 140 lb as 63.5 kg");
    assert.equal(weightToKg(71.26, "kg"), 71.3, "kilograms are read to 0.1");
  });

  test("a change of 0.1 lb is a change of weight, so it is saved", () => {
    assert.equal(sameWeightKg(measureValue("weight", "lb", lb("150")), measureValue("weight", "lb", lb("150.1"))), false);
    assert.equal(sameWeightKg(68.04, 68.04), true);
    assert.equal(sameWeightKg(68.04, 68.040000001), true);
    assert.equal(sameWeightKg(null, null), true);
    assert.equal(sameWeightKg(null, 68), false);
  });

  test("setup logs the starting weight unless it equals the newest weigh-in to the stored 0.01 kg", () => {
    const flow = readFileSync(new URL("../../src/app/(auth)/onboarding/OnboardingFlow.tsx", import.meta.url), "utf8");
    assert.match(flow, /\(latest === null \|\| !sameWeightKg\(latest, values\.weightKg\)\)/);
  });
});

describe("the height field shows the value that is checked and saved (bug 33)", () => {
  test("175.5 shows as 175.5, and a saved 162.5 loads as 162.5", () => {
    assert.deepEqual(typedThenShown("height", "cm", lb("175.5")), { main: "175.5", inches: "" });
    assert.equal(measureText("height", "cm", 162.5).main, "162.5");
    assert.equal(formatHeight(162.5, "cm"), "162.5 cm");
  });

  test("89.9 and 250.1 show as typed, beside a refusal that names 90 and 250", () => {
    for (const typed of ["89.9", "250.1"]) {
      const cm = measureValue("height", "cm", lb(typed));
      assert.equal(measureText("height", "cm", cm).main, typed);
      assert.equal(validatePage("body", bodyForm({ heightCm: cm }), FULL, TODAY).heightCm, "Enter a height between 90 and 250 cm.");
    }
  });

  test("feet and inches keep a tenth of an inch: 5 ft 9.5 in stays 5 ft 9.5 in", () => {
    assert.deepEqual(typedThenShown("height", "ft_in", { main: "5", inches: "9.5" }), { main: "5", inches: "9.5" });
    assert.deepEqual(typedThenShown("height", "ft_in", { main: "5", inches: "9" }), { main: "5", inches: "9" });
    assert.equal(formatHeight(measureValue("height", "ft_in", { main: "5", inches: "9.5" }), "ft_in"), "5 ft 9.5 in");
  });

  test("every height typed to 0.1 in inside the limits comes back unchanged", () => {
    const changed: number[] = [];
    for (let tenths = HEIGHT_LIMITS.ft_in.min * 10; tenths <= HEIGHT_LIMITS.ft_in.max * 10; tenths += 1) {
      const inches = tenths / 10;
      const cm = measureValue("height", "ft_in", { main: "0", inches: String(inches) });
      if (measureShown("height", "ft_in", cm) !== inches) changed.push(inches);
    }
    assert.deepEqual(changed, []);
  });

  test("the steppers move a centimetre from the value itself, also outside the slider's range", () => {
    assert.equal(dialStep("height", "cm", 162, 1), 163);
    assert.equal(dialStep("height", "cm", 163, -1), 162);
    assert.equal(dialStep("height", "cm", 175.5, 1), 176, "to the next whole centimetre, as a number field's stepper does");
    assert.equal(dialStep("height", "cm", 95, 1), 96, "below the slider (120 cm) the value still moves by one");
    assert.equal(dialStep("weight", "kg", 210, -1), 209.5, "above the slider (200 kg) too");
    assert.equal(dialStep("weight", "kg", 20, 1), 30, "and stays inside the limits FITX takes");
    assert.equal(dialStep("weight", "kg", 68.04, 1), 68.5);
    assert.equal(dialStep("weight", "lb", null, 1), 156, "nothing set: from the thumb's resting place");
  });
});

describe("the limits a message names are the limits accepted, in the unit typed (bug 32)", () => {
  const heightIn = (feet: number, inches: number) => measureValue("height", "ft_in", { main: String(feet), inches: String(inches) });
  const weightInLb = (value: number) => measureValue("weight", "lb", lb(String(value)));

  test("feet and inches: 3 ft 0 in to 8 ft 2 in, and the message says so", () => {
    assert.equal(heightInLimits(heightIn(3, 0), "ft_in"), true);
    assert.equal(heightInLimits(heightIn(8, 2), "ft_in"), true);
    for (const [feet, inches] of [[2, 11], [2, 11.9], [8, 2.1], [8, 3]]) {
      assert.equal(heightError(heightIn(feet, inches), "ft_in"), "Enter a height between 3 ft 0 in and 8 ft 2 in.", `${feet} ft ${inches} in`);
    }
  });

  test("pounds: 67 to 1,102 lb, and the message says so", () => {
    assert.equal(weightInLimits(weightInLb(67), "lb"), true);
    assert.equal(weightInLimits(weightInLb(1102), "lb"), true);
    for (const value of [66, 66.9, 1102.1]) assert.equal(weightError(weightInLb(value), "lb"), "Enter a weight between 67 and 1,102 lb.", String(value));
    assert.equal(weightError(weightInLb(66), "lb", { target: true }), "Enter a target between 67 and 1,102 lb, or leave it empty.");
  });

  test("centimetres and kilograms: 90 to 250 cm, 30 to 500 kg", () => {
    assert.equal(heightError(90, "cm"), null);
    assert.equal(heightError(250, "cm"), null);
    assert.equal(heightError(89.9, "cm"), "Enter a height between 90 and 250 cm.");
    assert.equal(heightError(250.1, "cm", { optional: true }), "Enter a height between 90 and 250 cm, or leave it empty.");
    assert.equal(weightError(30, "kg"), null);
    assert.equal(weightError(500, "kg"), null);
    assert.equal(weightError(29.9, "kg"), "Enter a weight between 30 and 500 kg.");
    assert.equal(weightError(500.1, "kg", { target: true }), "Enter a target between 30 and 500 kg, or leave it empty.");
  });

  test("every limit a message names is accepted, and the next tenth beyond it is refused", () => {
    for (const unit of ["cm", "ft_in"] as const) {
      const { min, max } = HEIGHT_LIMITS[unit];
      const at = (shown: number) => measureFromShown("height", unit, shown);
      assert.deepEqual([heightInLimits(at(min), unit), heightInLimits(at(max), unit)], [true, true], unit);
      assert.deepEqual([heightInLimits(at(min - 0.1), unit), heightInLimits(at(max + 0.1), unit)], [false, false], unit);
    }
    for (const unit of ["kg", "lb"] as const) {
      const { min, max } = WEIGHT_LIMITS[unit];
      const at = (shown: number) => measureFromShown("weight", unit, shown);
      assert.deepEqual([weightInLimits(at(min), unit), weightInLimits(at(max), unit)], [true, true], unit);
      assert.deepEqual([weightInLimits(at(min - 0.1), unit), weightInLimits(at(max + 0.1), unit)], [false, false], unit);
    }
  });

  test("whatever is accepted in feet and inches or pounds is inside the metric ranges once stored", () => {
    for (let inches = HEIGHT_LIMITS.ft_in.min; inches <= HEIGHT_LIMITS.ft_in.max; inches += 0.1) {
      const cm = measureFromShown("height", "ft_in", inches);
      assert.ok(cm >= HEIGHT_RANGE_CM.min && cm <= HEIGHT_RANGE_CM.max, `${inches} in`);
    }
    for (let pounds = WEIGHT_LIMITS.lb.min; pounds <= WEIGHT_LIMITS.lb.max; pounds += 0.1) {
      const kg = measureFromShown("weight", "lb", pounds);
      assert.ok(kg >= WEIGHT_RANGE_KG.min && kg <= WEIGHT_RANGE_KG.max, `${pounds} lb`);
    }
  });

  test("setup's step 2 checks in the units chosen: 2 ft 11 in and 66 lb are refused with limits that work", () => {
    const refused = validatePage("body", bodyForm({ heightUnit: "ft_in", weightUnit: "lb", heightCm: heightIn(2, 11), weightKg: weightInLb(66), targetWeightKg: weightInLb(66) }), FULL, TODAY);
    assert.deepEqual(refused, {
      heightCm: "Enter a height between 3 ft 0 in and 8 ft 2 in.",
      weightKg: "Enter a weight between 67 and 1,102 lb.",
      targetWeightKg: "Enter a target between 67 and 1,102 lb, or leave it empty.",
    });
    assert.deepEqual(validatePage("body", bodyForm({ heightUnit: "ft_in", weightUnit: "lb", heightCm: heightIn(3, 0), weightKg: weightInLb(67) }), FULL, TODAY), {});
    assert.deepEqual(validatePage("body", bodyForm({ heightUnit: "ft_in", weightUnit: "lb", heightCm: heightIn(8, 2), weightKg: weightInLb(1102) }), FULL, TODAY), {});
  });

  test("an empty height or weight is still asked for, and an empty target is fine", () => {
    assert.deepEqual(validatePage("body", bodyForm({ heightCm: null, weightKg: null, targetWeightKg: null }), FULL, TODAY), { heightCm: "Add your height.", weightKg: "Add your current weight." });
  });

  test("Home and Progress name the same limits (Progress's weigh-in field takes 67 to 1102 lb)", () => {
    assert.equal(weightRangeText("lb"), "between 67 and 1102 lb");
    assert.equal(weightRangeText("kg"), "between 30 and 500 kg");
  });
});

describe("setup's dial uses these helpers", () => {
  test("the dial shows measureText, reads measureValue and steps with dialStep", () => {
    const dial = readFileSync(new URL("../../src/components/onboarding/MeasureDial.tsx", import.meta.url), "utf8");
    assert.match(dial, /measureText\(kind, unit, props\.value\)/);
    assert.match(dial, /report\(measureValue\(kind, unit, next\)\)/);
    assert.match(dial, /slide\(dialStep\(kind, unit, shown, -1\)\)/);
    assert.match(dial, /slide\(dialStep\(kind, unit, shown, 1\)\)/);
    assert.doesNotMatch(dial, /Math\.round/, "nothing is rounded in the component itself");
  });

  test("Profile's height and weight fields use them too", () => {
    const controls = readFileSync(new URL("../../src/components/profile/ProfileControls.tsx", import.meta.url), "utf8");
    assert.match(controls, /measureText\("height", unit, cm\)/);
    assert.match(controls, /measureText\("weight", inUnit, value\)\.main/);
    assert.doesNotMatch(controls, /kgToLb|lbToKg|Math\.round\(value \* 10\)/);
  });
});
