import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NO_DRAFTS, initialOnboardingForm, validatePage, type MeasureDrafts, type MeasureKey, type OnboardingForm, type OnboardingSource } from "@/lib/onboarding/form";
import { keptDraft, measureRead, measureText, measureValue, type MeasureText } from "@/lib/onboarding/measure-field";
import { normalizePreferences } from "@/lib/domain/user-context";

// Review of bug 8 (onboarding-1), finding onb-8-remount. Text that is not a number lived only in the dial's own state,
// while its NaN lived in setup's answers. Back unmounts step 2's dials, so after Back and Continue a new dial showed an
// empty box ("Not given") for an answer that was still NaN, and Continue refused it: the bug 8 symptom again. Setup
// now keeps each dial's text beside its answer, and a dial shows only what setup gives it.

const FULL = { preferencesV2: true, onboardingV3: true };
const TODAY = new Date(2026, 10, 26);
const box = (main: string, inches = ""): MeasureText => ({ main, inches });
const KIND = { heightCm: "height", weightKg: "weight", targetWeightKg: "weight" } as const;
const KEYS: MeasureKey[] = ["heightCm", "weightKg", "targetWeightKg"];

/** Setup's state for step 2: the answers and the text each dial shows in place of its answer. */
type Step2 = { form: OnboardingForm; drafts: MeasureDrafts };

function start(overrides: Partial<OnboardingForm> = {}): Step2 {
  const source: OnboardingSource = {
    profile: { name: "Asha Rao", date_of_birth: "1997-03-14", gender: "female", height: null, target_weight: null },
    preferences: normalizePreferences(null).values,
    currentWeightKg: null,
  };
  return { form: { ...initialOnboardingForm(source), heightCm: 162.5, weightKg: 58.4, ...overrides }, drafts: NO_DRAFTS };
}

const unitOf = (form: OnboardingForm, key: MeasureKey): string => (key === "heightCm" ? form.heightUnit : form.weightUnit);

/** The member types `text` in a dial, as MeasureDial's typed() reports it: the text, the unit it names, its value. */
function typeIn(state: Step2, key: MeasureKey, text: MeasureText): Step2 {
  const read = measureRead(KIND[key], unitOf(state.form, key), text, true);
  const unitKey = key === "heightCm" ? "heightUnit" : "weightUnit";
  return { form: { ...state.form, [unitKey]: read.unit, [key]: read.value }, drafts: { ...state.drafts, [key]: text } };
}

/** The member leaves the dial, as MeasureDial's leave() reports it. */
function leave(state: Step2, key: MeasureKey): Step2 {
  return { ...state, drafts: { ...state.drafts, [key]: keptDraft(KIND[key], unitOf(state.form, key), state.drafts[key]) } };
}

/** What a dial shows whenever it is mounted, from setup's state alone (MeasureDial: `draft ?? measureText(...)`). */
function shownText(state: Step2, key: MeasureKey): MeasureText {
  return state.drafts[key] ?? measureText(KIND[key], unitOf(state.form, key), state.form[key]);
}

describe("text that is not a number is still in its field after Back", () => {
  test("abc in Target weight, Tab, Back, Continue on step 1: the new dial shows abc, and Continue's message is about it", () => {
    let state = leave(typeIn(start(), "targetWeightKg", box("abc")), "targetWeightKg");
    assert.ok(Number.isNaN(state.form.targetWeightKg));
    assert.deepEqual(shownText(state, "targetWeightKg"), box("abc"));
    // Without the kept text the answer alone shows as an empty box: that is why the text has to outlive the dial.
    assert.deepEqual(measureText("weight", "kg", state.form.targetWeightKg), box(""));
    // Back and Continue change neither the answers nor the drafts (checked in the source below), so the dial mounted
    // on the way back starts from the same state and shows abc again, with the message Continue gives for it.
    assert.deepEqual(validatePage("body", state.form, FULL, TODAY), {
      targetWeightKg: "Enter your target in kilograms, for example 65, or leave it empty.",
    });
    // Backspace has text to delete, and an emptied target passes.
    state = leave(typeIn(state, "targetWeightKg", box("")), "targetWeightKg");
    assert.deepEqual(shownText(state, "targetWeightKg"), box(""));
    assert.equal(state.form.targetWeightKg, null);
    assert.deepEqual(validatePage("body", state.form, FULL, TODAY), {});
  });

  test("Height and Current weight keep their text the same way, in each unit, with the message for it", () => {
    const cases: [MeasureKey, string, MeasureText, string][] = [
      ["heightCm", "cm", box("abc"), "Enter your height in centimetres, for example 175."],
      ["heightCm", "ft_in", box("5", "x"), "Enter your height in feet and inches, for example 5 ft 9 in."],
      ["weightKg", "kg", box("70 kgx"), "Enter your weight in kilograms, for example 70.5."],
      ["weightKg", "lb", box("abc"), "Enter your weight in pounds, for example 155."],
      ["targetWeightKg", "lb", box("6 5"), "Enter your target in pounds, for example 145, or leave it empty."],
    ];
    for (const [key, unit, text, message] of cases) {
      const units = key === "heightCm" ? { heightUnit: unit } : { weightUnit: unit };
      const state = leave(typeIn(start(units as Partial<OnboardingForm>), key, text), key);
      assert.deepEqual(shownText(state, key), text, `${key} in ${unit}`);
      assert.equal(validatePage("body", state.form, FULL, TODAY)[key], message, `${key} in ${unit}`);
    }
  });

  test("whatever is typed and left, a dial mounted again shows text that means what setup holds", () => {
    const texts = ["", "  ", "abc", "65kg", "65 kg", "65", "72,5", "1,102", "65.", "-3", "150 lb", "70 kg", "5 ft", "175 cm", "6 5", "5'9", "kg"];
    for (const key of KEYS) {
      for (const unit of key === "heightCm" ? ["cm", "ft_in"] : ["kg", "lb"]) {
        const units = (key === "heightCm" ? { heightUnit: unit } : { weightUnit: unit }) as Partial<OnboardingForm>;
        const typed = [...texts.map((main) => box(main)), ...(unit === "ft_in" ? [box("5", "9"), box("5", "x"), box("", "x"), box("abc", "4")] : [])];
        for (const text of typed) {
          const state = leave(typeIn(start(units), key, text), key);
          const value = state.form[key];
          const shown = shownText(state, key);
          const read = measureValue(KIND[key], unitOf(state.form, key), shown);
          const label = `${key} ${unit} "${text.main}" "${text.inches}"`;
          if (value === null) assert.equal(read, null, label);
          else if (Number.isNaN(value)) {
            assert.ok(Number.isNaN(read), label);
            assert.ok(`${shown.main}${shown.inches}`.trim() !== "", `${label}: never an empty box while the answer is NaN`);
          } else assert.ok(read !== null && Number.isFinite(read), `${label}: a number shows as a number`);
        }
      }
    }
  });
});

describe("the dial shows what setup gives it, and setup keeps it across Back", () => {
  const dial = readFileSync(new URL("../../src/components/onboarding/MeasureDial.tsx", import.meta.url), "utf8");
  const flow = readFileSync(new URL("../../src/app/(auth)/onboarding/OnboardingFlow.tsx", import.meta.url), "utf8");

  test("the dial has no state of its own, so unmounting it loses nothing", () => {
    assert.doesNotMatch(dial, /useState/);
    assert.match(dial, /const text = draft \?\? measureText\(kind, unit, props\.value\);/);
    assert.match(dial, /function typed\(next: MeasureText\) \{\s*onDraftChange\(next\);/);
    assert.match(dial, /function slide\(display: number\) \{\s*onDraftChange\(null\);/);
  });

  test("setup holds each dial's draft beside its answer; Back keeps both, and a fresh load starts with none", () => {
    assert.match(flow, /const \[drafts, setDrafts\] = useState<MeasureDrafts>\(NO_DRAFTS\);/);
    for (const key of KEYS) {
      assert.match(flow, new RegExp(`value=\\{form\\.${key}\\} draft=\\{drafts\\.${key}\\} onDraftChange=\\{\\(draft\\) => changeDraft\\("${key}", draft\\)\\}`), key);
    }
    const back = /function back\(\) \{([\s\S]*?)\n  \}/.exec(flow)?.[1] ?? "";
    assert.match(back, /setPageIndex/, "back() was found");
    assert.doesNotMatch(back, /setDrafts|setForm/, "Back changes neither the answers nor the text shown for them");
    assert.match(flow, /setForm\(initialOnboardingForm\(result\.data, metadataName\)\);\s*setDrafts\(NO_DRAFTS\);/);
  });
});
