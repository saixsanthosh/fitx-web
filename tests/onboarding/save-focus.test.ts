// Review finding a11y-onboarding-continue-disabled-while-saving (fix round 3a): setup's Continue / Finish setup was
// disabled while its step saved, so Chrome dropped keyboard focus to the page as soon as it was pressed. On success
// focus went to the next step's heading, but a failed save (offline, a refused write) left the member with focus
// nowhere and only the alert line saying why: the same mistake as sign-in's bug 80. The button is now aria-disabled
// while saving (still focusable, announced as unavailable, a press does nothing), so focus stays on it beside the
// message. If focus fell to the page anyway, because the failed save replaced the field it was in, it goes to Continue.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { focusAfterFailedSave } from "@/lib/onboarding/save-focus";

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const flow = read("src/app/(auth)/onboarding/OnboardingFlow.tsx");

/** Each <button …> opening tag in a file (braces skipped as a whole, so arrow functions don't end it early). */
function buttons(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/<button\b/g)) {
    let depth = 0;
    for (let index = match.index ?? 0; index < text.length; index += 1) {
      const char = text[index];
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === ">" && depth === 0) {
        found.push(text.slice(match.index, index + 1));
        break;
      }
    }
  }
  return found;
}

/** A function's body, from its declaration to the closing brace at its own indent. */
function body(name: string): string {
  const found = new RegExp(`\\n([ \\t]*)(?:async )?function ${name}\\([^)]*\\) \\{([\\s\\S]*?)\\n\\1\\}`).exec(flow);
  assert.ok(found, `${name}() was found`);
  return found[2];
}

test("after a failed save, focus stays where the member left it; only focus that fell to the page goes to Continue", () => {
  const page = { name: "body" };
  const continueButton = { name: "Continue" };
  const field = { name: "Name" };
  assert.equal(focusAfterFailedSave(continueButton, page, continueButton), null, "pressed Continue: it keeps focus");
  assert.equal(focusAfterFailedSave(field, page, continueButton), null, "Enter in a field: the field keeps focus");
  assert.equal(focusAfterFailedSave(page, page, continueButton), continueButton, "fell to the page: Continue, under the message");
  assert.equal(focusAfterFailedSave(null, page, continueButton), continueButton, "nothing focused: Continue");
  assert.equal(focusAfterFailedSave(undefined, page, continueButton), continueButton);
  assert.equal(focusAfterFailedSave(page, page, null), null, "no Continue on the screen: nothing to move to");
});

test("Continue and Finish setup are aria-disabled while the step saves, never disabled, so focus is kept", () => {
  const submits = buttons(flow).filter((tag) => /type="submit"/.test(tag));
  assert.equal(submits.length, 1, "one submit button, labelled Continue or Finish setup");
  const [submit] = submits;
  assert.match(submit, /aria-disabled=\{saving \|\| undefined\}/);
  assert.doesNotMatch(submit.replace(/aria-disabled=\{[^}]*\}/g, ""), /\bdisabled=/, "no disabled attribute of any kind");
  assert.match(submit, /ref=\{submitRef\}/);
  assert.match(submit, /className=\{`fitx-button \$\{styles\.submit\} /, "it looks disabled while saving");
  assert.match(flow, /\{saving \? "Saving…" : isLast \? "Finish setup" : "Continue"\}/, "its label says it is saving");
});

test("a press while the step saves does nothing: advance() returns before anything else", () => {
  assert.match(body("advance"), /^\s*(?:\/\/[^\n]*\n\s*)*if \(!form \|\| saving\) return;/);
  assert.match(flow, /onSubmit=\{\(event: FormEvent<HTMLFormElement>\) => \{ event\.preventDefault\(\); void advance\(\); \}\}/, "Enter in a field goes the same way");
});

test("every failed save is counted, and focus is checked once the failure is on the screen", () => {
  assert.match(body("advance"), /if \(problem\) \{\s*setSaving\(false\);\s*setSaveError\(problem\);\s*setFailedSaves\(\(count\) => count \+ 1\);\s*return;\s*\}/);
  assert.match(flow, /useEffect\(\(\) => \{\s*if \(failedSaves\) focusAfterFailedSave\(document\.activeElement, document\.body, submitRef\.current\)\?\.focus\(\{ preventScroll: true \}\);\s*\}, \[failedSaves\]\);/);
  assert.match(flow, /const \[failedSaves, setFailedSaves\] = useState\(0\);/);
  assert.match(flow, /const submitRef = useRef<HTMLButtonElement>\(null\);/);
});

test("the message is next to the button, and the other outcomes move focus as before", () => {
  // D6: the alert is in the action bar, right above Back and Continue.
  assert.match(flow, /\{saveError && <p role="alert" className="fitx-alert fitx-alert-danger mb-3">\{saveError\}<\/p>\}\s*<div className="flex items-center gap-2">/);
  const advance = body("advance");
  assert.match(advance, /setSaveError\("Check the highlighted answers\."\);\s*focusFirstInvalid\(formRef\.current\);\s*return;/, "a refused answer: its field");
  assert.match(advance, /setSaving\(false\);\s*movedPage\.current = true;\s*setPageIndex\(\(index\) => index \+ 1\);/, "a saved step: the next step's heading");
  assert.match(flow, /if \(!movedPage\.current\) return;\s*heading\.current\?\.focus\(\{ preventScroll: true \}\);/);
});

test("Back can't be pressed while the step saves, so it never races the save", () => {
  const back = buttons(flow).find((tag) => /onClick=\{back\}/.test(tag));
  assert.ok(back, "Back was found");
  // A save starts from Continue or from Enter in a field, never with focus on Back, so disabled drops nothing here.
  assert.match(back, /\bdisabled=\{saving\}/);
});

test("the busy button looks like a disabled one, with no hover or press movement", () => {
  const css = read("src/components/onboarding/Onboarding.module.css");
  assert.match(css, /\.submit\[aria-disabled="true"\] \{ cursor: progress; opacity: 0\.58; \}/);
  assert.match(css, /\.submit\[aria-disabled="true"\]:hover \{ background: var\(--fitx-primary\); \}/);
  assert.match(css, /\.submit\[aria-disabled="true"\]:active \{ transform: none; \}/);
  assert.match(read("src/app/globals.css"), /\.fitx-button:disabled \{ opacity: \.58; \}/, "the same dimming as a disabled button");
});
