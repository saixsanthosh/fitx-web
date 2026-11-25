import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initialOnboardingForm, validatePage, type OnboardingSource } from "@/lib/onboarding/form";
import { normalizePreferences } from "@/lib/domain/user-context";
import { AGE_RANGE, OLDEST_SHOWN_AGE, ageFromBirthDate, birthDateEdit, normalizeBirthDate, profileAge, shownAge } from "@/lib/domain/profile-options";

// Bug 34 (onboarding-8): Date.UTC read the years 0 to 99 as 1900 to 1999, so 0001-01-01 was "not a real date", and the
// stage's Age readout had no cap, so 0100-06-15 read "Age 1926 yrs".

const TODAY = new Date(2026, 10, 26); // 26 November 2026, local time
const FULL = { preferencesV2: true, onboardingV3: true };

function step1(birthDate: string) {
  const source: OnboardingSource = {
    profile: { name: "Asha Rao", date_of_birth: null, gender: "female", height: null, target_weight: null },
    preferences: normalizePreferences(null).values,
    currentWeightKg: null,
  };
  return { ...initialOnboardingForm(source), birthDate };
}

describe("birth years below 100 are read as written", () => {
  test("0001-01-01, 0050-06-15 and 0099-12-31 are real dates that FITX doesn't take: ages 13 to 100", () => {
    for (const date of ["0001-01-01", "0050-06-15", "0099-12-31", "0100-06-15", "0999-06-15"]) {
      assert.equal(normalizeBirthDate(date), date, date);
      assert.equal(validatePage("you", step1(date), FULL, TODAY).birthDate, `FITX is for ages ${AGE_RANGE.min} to ${AGE_RANGE.max}.`, date);
    }
    assert.equal(ageFromBirthDate("0001-01-01", TODAY), 2025);
    assert.equal(ageFromBirthDate("0100-06-15", TODAY), 1926);
  });

  test("Profile's birth date check reads them the same way", () => {
    assert.match(birthDateEdit({ age: null, date_of_birth: null }, "0001-01-01", TODAY).error ?? "", /ages 13 to 100/);
  });

  test("a day key is read with its year as written too (the same mistake in profileAge)", () => {
    assert.equal(profileAge({ age: null, date_of_birth: "0010-01-01" }, "0050-06-01"), 40);
    assert.equal(profileAge({ age: 17, date_of_birth: "2008-11-20" }, "2026-11-20"), 18);
    assert.equal(profileAge({ age: null, date_of_birth: "2000-02-29" }, "2028-02-29"), 28, "a leap-day key");
  });

  test("dates that don't exist are still refused as not real", () => {
    for (const date of ["0000-01-01", "2023-02-29", "1900-02-29", "1997-13-01", "1997-00-10", "1997-04-31", "1997-06-00"]) {
      assert.equal(normalizeBirthDate(date), null, date);
      assert.match(validatePage("you", step1(date), FULL, TODAY).birthDate ?? "", /real date/, date);
    }
    for (const date of ["2000-02-29", "2004-02-29", "1600-02-29", "0004-02-29"]) assert.equal(normalizeBirthDate(date), date, `${date} is a leap day`);
  });

  test("an ordinary date still passes", () => {
    assert.equal(validatePage("you", step1("2001-05-12"), FULL, TODAY).birthDate, undefined);
  });
});

describe("no impossible age is shown", () => {
  test("the readout shows no age for 0100-06-15 (1926 years), 0199 or 0999", () => {
    assert.equal(shownAge("0100-06-15", TODAY), null);
    assert.equal(shownAge("0199-06-15", TODAY), null);
    assert.equal(shownAge("0999-06-15", TODAY), null);
  });

  test("typing 2001 a digit at a time passes through 0002, 0020 and 0200 without showing an age", () => {
    assert.deepEqual(["0002-06-15", "0020-06-15", "0200-06-15", "2001-06-15"].map((date) => shownAge(date, TODAY)), [null, null, null, 25]);
  });

  test("real ages show, the ones FITX refuses included, up to the oldest anyone could be", () => {
    assert.equal(shownAge("2014-01-01", TODAY), 12, "too young for FITX, but true");
    assert.equal(shownAge("1925-11-26", TODAY), 101);
    assert.equal(shownAge("1899-06-15", TODAY), 127);
    assert.equal(shownAge(`${2026 - OLDEST_SHOWN_AGE}-01-01`, TODAY), OLDEST_SHOWN_AGE);
    assert.equal(shownAge(`${2026 - OLDEST_SHOWN_AGE - 1}-01-01`, TODAY), null);
    assert.equal(shownAge("", TODAY), null);
    assert.equal(shownAge("2027-01-01", TODAY), null, "the future");
  });

  test("setup's stage readout and the field's age hint both use shownAge", () => {
    const flow = readFileSync(new URL("../../src/app/(auth)/onboarding/OnboardingFlow.tsx", import.meta.url), "utf8");
    assert.match(flow, /const age = form \? shownAge\(form\.birthDate\) : null;/);
    assert.doesNotMatch(flow, /ageFromBirthDate\(form\.birthDate\)/);
    const controls = readFileSync(new URL("../../src/components/profile/ProfileControls.tsx", import.meta.url), "utf8");
    const field = controls.slice(controls.indexOf("export function BirthDateField"));
    assert.match(field, /const age = shownAge\(value\);/);
  });
});
