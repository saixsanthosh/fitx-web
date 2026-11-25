// Bug 81 (public-3): on the email-code step, "Change email" removed the step with focus on its button, and "Resend code"
// disabled itself while it worked, so both times keyboard focus fell to the page body; after Resend the next Tab skipped
// the code field. Now Change email hands focus to the email field it came back to, Resend keeps focus (aria-disabled,
// never disabled) and puts it in the code field once the new code is sent, and "New code sent." is spoken by a status
// line that is always on the page. The same on /signin and /signup, which share the step.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { focusAfterStep } from "@/lib/auth/step-focus";

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

test("coming back from the code step puts focus in the email field; nothing else moves it", () => {
  assert.equal(focusAfterStep("code", "email"), "email", "Change email");
  assert.equal(focusAfterStep(null, "email"), null, "the first render leaves focus where the page put it");
  assert.equal(focusAfterStep("email", "email"), null);
  assert.equal(focusAfterStep("email", "code"), null, "the code step focuses its own field");
  assert.equal(focusAfterStep("code", "code"), null);
  assert.equal(focusAfterStep("email", "sent"), null, "sign-up's confirmation view focuses its heading itself");
});

test("both forms move focus to the email field when the code step gives way to it", () => {
  for (const [file, step] of [["src/app/(auth)/signin/SignInForm.tsx", "codeFlow.step"], ["src/app/(auth)/signup/SignUpForm.tsx", "view"]] as const) {
    const text = read(file);
    const escaped = step.replace(".", "\\.");
    assert.match(text, new RegExp(`if \\(focusAfterStep\\(\\w+\\.current, ${escaped}\\) === "email"\\) emailInput\\.current\\?\\.focus\\(\\{ preventScroll: true \\}\\);`), file);
    assert.match(text, new RegExp(`\\}, \\[${escaped}\\]\\);`), `${file}: checked whenever the step changes`);
  }
});

test("the code step's buttons are never disabled while they hold focus, and do nothing while they can't be used", () => {
  const text = read("src/components/auth/EmailCodeStep.tsx");
  assert.match(text, /onClick=\{\(\) => !working && flow\.back\(\)\} aria-disabled=\{working \|\| undefined\}/, "Change email");
  assert.match(text, /const canResend = resendIn === 0 && !sending && !working;/);
  assert.match(text, /onClick=\{\(\) => void resend\(\)\} aria-disabled=\{!canResend \|\| undefined\}/, "Resend: aria-disabled while counting down or sending");
  assert.match(text, /async function resend\(\) \{\s*if \(!canResend\) return;/);
  assert.match(text, /disabled=\{code\.length < 6\} aria-disabled=\{working \|\| undefined\}/, "Verify: not ready until six digits; busy while checking");
  assert.match(text, /function submit\(event: FormEvent<HTMLFormElement>\) \{\s*event\.preventDefault\(\);\s*if \(working\) return;/);
  assert.doesNotMatch(text, /disabled=\{working\}|disabled=\{resendIn > 0/, "no button disables itself while busy");
});

test("after a new code is sent, focus waits in the code field and the status line says so", () => {
  const text = read("src/components/auth/EmailCodeStep.tsx");
  assert.match(text, /if \(await flow\.resend\(\)\) input\.current\?\.focus\(\{ preventScroll: true \}\);/);
  const hook = read("src/components/auth/useEmailCode.ts");
  assert.match(hook, /async function resend\(\): Promise<boolean> \{\s*if \(resendIn > 0\) return false;\s*const problem = await send\(email, \{ again: true \}\);\s*if \(problem\) setError\(problem\);\s*return problem === null;\s*\}/);
  assert.match(hook, /if \(again\) setNotice\("New code sent\."\);/);
  // Always on the page, empty until it has something to say, so the change is announced.
  assert.match(text, /<p role="status" className=\{s\.notice\}>\{notice && !error \? notice : null\}<\/p>/);
  assert.doesNotMatch(text, /\{notice && !error && <p role="status"/, "not added together with its text");
  assert.match(read("src/components/auth/auth.module.css"), /\.notice:empty \{ position: absolute; \}/, "out of the flow while empty, still in the accessibility tree");
});
