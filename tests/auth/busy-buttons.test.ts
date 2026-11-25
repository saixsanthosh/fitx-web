// Bug 80 (cross-cutting-6, public-10): a sign-in or sign-up started from its button disabled the button while it worked
// ("Signing in…"), so Chrome dropped keyboard focus to the page; when "That email and password don't match…" appeared,
// nothing had focus. Busy buttons are now aria-disabled (still focusable, announced as unavailable) and their handlers
// return early while busy, so focus stays on the button beside the message. Validation problems take focus to the field
// at fault (tests/auth/field-problems.test.ts). The same mistake elsewhere: Google's redirect button, the Apple buttons,
// the password pages, Log out / Sign out everywhere, and the pages that swap their form for "Check your email" or
// "Password updated", which now move focus to that heading instead of letting it fall to the page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

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

/** The busy flag of each file's busy buttons, and how its handler returns early while it is set. */
const BUSY: Array<[file: string, flag: string, early: RegExp, count: number]> = [
  ["src/app/(auth)/signin/SignInForm.tsx", "loading", /async function submit\([^)]*\) \{\s*event\.preventDefault\(\);\s*if \(loading\) return;[\s\S]*async function signInWith\([^)]*\) \{\s*if \(loading\) return;/, 3],
  ["src/app/(auth)/signup/SignUpForm.tsx", "loading", /async function submit\([^)]*\) \{\s*event\.preventDefault\(\);\s*if \(loading\) return;[\s\S]*async function signInWith\([^)]*\) \{\s*if \(loading\) return;/, 3],
  ["src/app/(auth)/forgot-password/page.tsx", "loading", /async function submit\([^)]*\) \{\s*event\.preventDefault\(\);\s*if \(loading\) return;/, 1],
  ["src/app/(auth)/reset-password/page.tsx", "loading", /async function submit\([^)]*\) \{\s*event\.preventDefault\(\);\s*if \(loading\) return;/, 1],
  ["src/components/auth/GoogleButton.tsx", "disabled", /onClick=\{\(\) => !disabled && onClick\(\)\}/, 1],
  ["src/components/app/LogoutButton.tsx", "busy", /async function logout\(\) \{\s*\/\/[^\n]*\n\s*if \(busy\) return;/, 1],
];

test("no busy button on the sign-in pages is disabled: each is aria-disabled and does nothing while busy", () => {
  for (const [file, flag, early, count] of BUSY) {
    const text = read(file);
    const all = buttons(text);
    const disabledWhileBusy = all.filter((tag) => new RegExp(`\\bdisabled=\\{${flag}\\}`).test(tag.replace(/aria-disabled=\{[^}]*\}/g, "")));
    assert.deepEqual(disabledWhileBusy, [], `${file}: no button is disabled={${flag}}`);
    const marked = all.filter((tag) => tag.includes(`aria-disabled={${flag} || undefined}`));
    assert.equal(marked.length, count, `${file}: ${count} busy button(s) aria-disabled={${flag} || undefined}`);
    assert.match(text, early, `${file}: its handler returns early while busy`);
  }
});

test("the forms' submit buttons work while busy only by returning early: React never sends a second request", () => {
  for (const file of ["src/app/(auth)/signin/SignInForm.tsx", "src/app/(auth)/signup/SignUpForm.tsx"]) {
    assert.match(read(file), /const loading = pending !== null \|\| codeFlow\.sending;/, file);
  }
  // The email-code flow also holds its own guard (a second tap while a code is being sent does nothing).
  assert.match(read("src/components/auth/useEmailCode.ts"), /if \(busy\.current\) return null;/);
});

test("busy buttons look like disabled ones", () => {
  const css = read("src/components/auth/auth.module.css");
  assert.match(css, /\.primary\[aria-disabled="true"\] \{ cursor: progress; opacity: 0\.58; \}/, "as .fitx-button:disabled");
  assert.match(css, /\.primary\[aria-disabled="true"\]:hover \{ background: var\(--fitx-primary\); \}/, "no hover while busy");
  assert.match(css, /\.google:disabled,\s*\.google\[aria-disabled="true"\] \{ cursor: wait; opacity: 0\.68; \}/);
  assert.match(css, /\.link:disabled,\s*\.link\[aria-disabled="true"\] \{/);
  assert.match(css, /\.option\[aria-disabled="true"\] \{/);
  assert.match(read("src/components/app/LogoutButton.tsx"), /aria-disabled:opacity-50/);
});

test("when a form gives way to what happened next, focus goes to its heading, not to the page", () => {
  const hook = read("src/components/auth/useFocusWhen.ts");
  assert.match(hook, /useEffect\(\(\) => \{\s*if \(when\) target\.current\?\.focus\(\{ preventScroll: true \}\);\s*\}, \[target, when\]\);/);
  const cases: Array<[file: string, ref: string, when: string]> = [
    ["src/app/(auth)/signup/SignUpForm.tsx", "sentHeading", 'view === "sent"'],
    ["src/app/(auth)/forgot-password/page.tsx", "heading", "sent"],
    ["src/app/(auth)/reset-password/page.tsx", "heading", "saved"],
  ];
  for (const [file, ref, when] of cases) {
    const text = read(file);
    assert.ok(text.includes(`useFocusWhen(${ref}, ${when});`), `${file}: focus moves when ${when}`);
    assert.match(text, new RegExp(`<h1 ref=\\{${ref}\\} tabIndex=\\{-1\\} className=\\{s\\.title\\}`), `${file}: the heading can take focus`);
  }
  // What the page now says is read with the heading.
  assert.match(read("src/app/(auth)/signup/SignUpForm.tsx"), /aria-describedby=\{`\$\{baseId\}-sent`\}>Check your email<\/h1>\s*<p id=\{`\$\{baseId\}-sent`\}/);
  assert.match(read("src/app/(auth)/forgot-password/page.tsx"), /aria-describedby=\{sent \? `\$\{baseId\}-sent` : undefined\}/);
  assert.match(read("src/components/auth/auth.module.css"), /\.title\[tabindex="-1"\]:focus \{ outline: none; \}/);
});
