// Bug 90 (onboarding-9): the sign-in password box was announced as "Password Show password" (or "Password Hide
// password"), because its <label> wrapped the Show password button as well as the box. Now no label on the sign-in
// pages holds a button: the label names its field only, and the reveal button beside it is named for itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

const FILES = [
  "src/app/(auth)/signin/SignInForm.tsx",
  "src/app/(auth)/signup/SignUpForm.tsx",
  "src/app/(auth)/forgot-password/page.tsx",
  "src/app/(auth)/reset-password/page.tsx",
  "src/components/auth/EmailCodeStep.tsx",
  "src/components/auth/CodeField.tsx",
];

/** Every <label>…</label> in a file's JSX. */
const labels = (text: string) => [...text.matchAll(/<label\b[\s\S]*?<\/label>/g)].map((match) => match[0]);

test("no label on the sign-in pages wraps a button, so every field is named by its own words only", () => {
  let count = 0;
  for (const file of FILES) {
    for (const label of labels(source(file))) {
      count += 1;
      assert.doesNotMatch(label, /<button\b|<Link\b|<a\b/, `${file}: a label holds only its words and its field\n${label}`);
    }
  }
  assert.ok(count >= 8, `the walk found the forms' labels (${count})`);
});

test("the sign-in password box is labelled \"Password\" and the reveal button names itself beside it", () => {
  const text = source("src/app/(auth)/signin/SignInForm.tsx");
  assert.match(text, /<label htmlFor=\{ids\.input\("password"\)\}>Password<\/label>/, "the label is the word Password, for the box");
  const input = /<input ref=\{passwordInput\}[^\n]*\/>/.exec(text)?.[0] ?? "";
  assert.match(input, /\bid=\{ids\.input\("password"\)\}/, "the box carries the id the label points at");
  assert.match(input, /autoComplete="current-password"/);
  const reveal = /<button type="button" className=\{s\.reveal\}[^\n]*>/.exec(text)?.[0] ?? "";
  assert.match(reveal, /aria-label=\{visible \? "Hide password" : "Show password"\}/, "the button has its own name");
  assert.match(reveal, /aria-controls=\{ids\.input\("password"\)\}/, "and says which box it shows");
});
