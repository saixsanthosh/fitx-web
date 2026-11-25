// Profile > Body with the onboarding stream's lossless units (release 3, bugs 6, 8, 25 and 32): the edits H1 to H4 its
// report asked of Profile (reports-3/onboarding.md). The .tsx section cannot be loaded here, so its decisions are
// checked through the same helpers and its wiring in its source.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sameWeightKg, weightFromUnit } from "@/lib/domain/profile-options";
import { measureRead } from "@/lib/onboarding/measure-field";

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
