// Profile > Body with the onboarding stream's lossless units (release 3, bugs 6, 8, 25 and 32): the edits H1 to H4 its
// report asked of Profile (reports-3/onboarding.md). The .tsx section cannot be loaded here, so its decisions are
// checked through the same helpers and its wiring in its source.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { feetInchesToCm, sameWeightKg, weightFromUnit } from "@/lib/domain/profile-options";
import { measureRead } from "@/lib/onboarding/measure-field";
import { bodyMeasureProblems, messagesAfterEdit, type BodyMeasures } from "@/app/(dashboard)/profile/body-checks";

const ROOT = new URL("../../", import.meta.url);
const source = readFileSync(new URL("src/app/(dashboard)/profile/ProfileSections.tsx", ROOT), "utf8");
const body = source.slice(source.indexOf("export function BodySection"), source.indexOf("export function GoalSection"));

/** What Profile's WeightField reports for a typed text, in kg (it reads text as setup's dial does). */
const typed = (text: string, unit: "kg" | "lb") => measureRead("weight", unit, { main: text, inches: "" }, true).value;

describe("H1: a weight change of 0.1 lb is a change, and is saved", () => {
  test("150 lb then 150.1 lb: the second differs from the stored weight, so Save logs it instead of 'No changes'", () => {
    const stored = weightFromUnit(150, "lb");
    assert.equal(stored, 68.04);
    assert.equal(typed("150", "lb"), stored, "the stored weight, typed again, is no change");
    assert.equal(sameWeightKg(typed("150", "lb"), stored), true);
    assert.equal(sameWeightKg(typed("150.1", "lb"), stored), false, "0.045 kg: Profile's old 0.05 kg rule called it the same");
    assert.equal(sameWeightKg(typed("68.1", "kg"), weightFromUnit(68, "kg")), false);
    assert.equal(sameWeightKg(null, stored), false);
  });

  test("the section compares with the stored precision's rule, not a 0.05 kg one of its own", () => {
    assert.match(body, /const weightChanged = !sameWeightKg\(draft\.weightKg, data\.currentWeightKg\);/);
    assert.doesNotMatch(source, /const sameWeight = /);
    assert.doesNotMatch(source, /< 0\.05/);
  });
});

describe("H2: Profile's height and weight messages name the limits accepted, in the unit shown (bug 32)", () => {
  const draft = (patch: Partial<BodyMeasures>): BodyMeasures => ({ heightCm: 175, heightUnit: "cm", weightKg: 70, weightUnit: "kg", targetWeightKg: null, ...patch });

  test("the hunt's 2 ft 11 in and 66 lb are refused with limits that work (they named 2 ft 11 in and 66 lb before)", () => {
    const found = bodyMeasureProblems(draft({ heightCm: feetInchesToCm(2, 11), heightUnit: "ft_in", weightKg: weightFromUnit(66, "lb"), weightUnit: "lb", targetWeightKg: weightFromUnit(66, "lb") }));
    assert.deepEqual(found, {
      heightCm: "Enter a height between 3 ft 0 in and 8 ft 2 in, or leave it empty.",
      weightKg: "Enter a weight between 67 and 1,102 lb.",
      targetWeightKg: "Enter a target between 67 and 1,102 lb, or leave it empty.",
    });
  });

  test("the limits named are accepted, in every unit, and the next 0.1 beyond them is refused", () => {
    assert.deepEqual(bodyMeasureProblems(draft({ heightCm: feetInchesToCm(3, 0), heightUnit: "ft_in", weightKg: weightFromUnit(67, "lb"), weightUnit: "lb", targetWeightKg: weightFromUnit(1102, "lb") })), {});
    assert.deepEqual(bodyMeasureProblems(draft({ heightCm: feetInchesToCm(8, 2), heightUnit: "ft_in", weightKg: weightFromUnit(1102, "lb"), weightUnit: "lb" })), {});
    assert.deepEqual(bodyMeasureProblems(draft({ heightCm: 90, weightKg: 30, targetWeightKg: 500 })), {});
    assert.deepEqual(bodyMeasureProblems(draft({ heightCm: 250, weightKg: 500 })), {});
    assert.deepEqual(bodyMeasureProblems(draft({ heightCm: 89.9, weightKg: 29.9, targetWeightKg: 500.1 })), {
      heightCm: "Enter a height between 90 and 250 cm, or leave it empty.",
      weightKg: "Enter a weight between 30 and 500 kg.",
      targetWeightKg: "Enter a target between 30 and 500 kg, or leave it empty.",
    });
    assert.equal(bodyMeasureProblems(draft({ weightKg: weightFromUnit(1102.1, "lb"), weightUnit: "lb" })).weightKg, "Enter a weight between 67 and 1,102 lb.");
  });

  test("an empty height and target are fine, an empty weight is not, and text that isn't a number says so in the unit (bug 8)", () => {
    assert.deepEqual(bodyMeasureProblems(draft({ heightCm: null, targetWeightKg: null })), {});
    assert.deepEqual(bodyMeasureProblems(draft({ weightKg: null })), { weightKg: "Add your weight." });
    assert.deepEqual(bodyMeasureProblems(draft({ heightCm: Number.NaN, weightKg: Number.NaN, targetWeightKg: Number.NaN })), {
      heightCm: "Enter your height in centimetres, for example 175, or leave it empty.",
      weightKg: "Enter your weight in kilograms, for example 70.5.",
      targetWeightKg: "Enter your target in kilograms, for example 65, or leave it empty.",
    });
    assert.equal(bodyMeasureProblems(draft({ weightKg: typed("abc", "lb"), weightUnit: "lb" })).weightKg, "Enter your weight in pounds, for example 155.");
  });

  test("the section uses those checks; the old messages with the wrong imperial limits are gone", () => {
    assert.match(body, /Object\.assign\(found, bodyMeasureProblems\(draft\)\);/);
    assert.doesNotMatch(source, /\(2 ft 11 in to 8 ft 2 in\)|\(66 to 1,102 lb\)|between 30 and 500 kg|HEIGHT_RANGE_CM|WEIGHT_RANGE_KG/);
  });
});

describe("H3: a unit change clears the messages that named the old unit's limits", () => {
  const shown = {
    heightCm: "Enter a height between 90 and 250 cm, or leave it empty.",
    weightKg: "Enter a weight between 30 and 500 kg.",
    targetWeightKg: "Enter a target between 30 and 500 kg, or leave it empty.",
    birthDate: "FITX is for ages 13 to 100.",
  };

  test("the height unit takes the height's message; the weight unit takes both weights'; the rest stay", () => {
    assert.deepEqual(messagesAfterEdit(shown, "heightUnit"), { weightKg: shown.weightKg, targetWeightKg: shown.targetWeightKg, birthDate: shown.birthDate });
    assert.deepEqual(messagesAfterEdit(shown, "weightUnit"), { heightCm: shown.heightCm, birthDate: shown.birthDate });
  });

  test("any other change takes only its own message, and nothing changes when there is none to take", () => {
    assert.deepEqual(messagesAfterEdit(shown, "weightKg"), { heightCm: shown.heightCm, targetWeightKg: shown.targetWeightKg, birthDate: shown.birthDate });
    assert.deepEqual(messagesAfterEdit(shown, "gender"), shown);
    const none = { birthDate: shown.birthDate };
    assert.equal(messagesAfterEdit(none, "heightUnit"), none, "the same object: no re-render for nothing");
    assert.equal(messagesAfterEdit(none, "gender"), none);
  });

  test("the section clears messages through it whenever a Body answer changes", () => {
    assert.match(body, /setErrors\(\(current\) => messagesAfterEdit\(current, key\)\);/);
    assert.doesNotMatch(body, /withoutKey\(/);
  });
});
