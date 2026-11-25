// Text typed before the page hydrates is kept (src/components/auth/useKeepTypedValue.ts, hotfix 2d). React hydrates
// a controlled field and leaves the typed text in the DOM, but the forms render again right after hydration and the
// empty state used to overwrite it. Every controlled field of the auth forms copies its live value into state on mount,
// the "Other options" panels do the same with their open state, and each form marks itself data-hydrated once React
// runs it. The e2e flow 15 types into the server-rendered page with its scripts held back and checks it for real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { valueToKeep } from "@/components/auth/useKeepTypedValue";

const source = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

const FORMS = [
  "src/app/(auth)/signin/SignInForm.tsx",
  "src/app/(auth)/signup/SignUpForm.tsx",
  "src/app/(auth)/forgot-password/page.tsx",
  "src/app/(auth)/reset-password/page.tsx",
  "src/components/auth/EmailCodeStep.tsx",
];

/** Each JSX element `<tag ...>` in `text`: its source up to the end of its opening tag (braces are skipped as a whole). */
function elements(text: string, tag: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(new RegExp(`<${tag}\\b`, "g"))) {
    let depth = 0;
    let end = -1;
    for (let index = match.index ?? 0; index < text.length; index += 1) {
      const char = text[index];
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === ">" && depth === 0) {
        end = index;
        break;
      }
    }
    assert.ok(end > 0, `<${tag}> closes`);
    found.push(text.slice(match.index, end + 1));
  }
  return found;
}

test("the value to keep: whatever the field holds that React's state does not", () => {
  assert.equal(valueToKeep("meera@example.test", ""), "meera@example.test", "typed before hydration");
  assert.equal(valueToKeep("", ""), null, "nothing typed");
  assert.equal(valueToKeep("same", "same"), null, "already in state");
  assert.equal(valueToKeep(undefined, ""), null, "no field");
  assert.equal(valueToKeep(null, ""), null);
  assert.equal(valueToKeep("", "kept"), "", "a field emptied before hydration stays empty");
  assert.equal(valueToKeep(true, false), true, "a panel opened before hydration");
  assert.equal(valueToKeep(false, false), null);
});

test("the hooks run in the hydration's own commit, once, before the render that would overwrite the field", () => {
  const hook = source("src/components/auth/useKeepTypedValue.ts");
  for (const name of ["useKeepTypedValue", "useKeepOpenState"]) {
    const body = hook.slice(hook.indexOf(`export function ${name}(`));
    assert.match(body, /^export function \w+\([\s\S]*?\): void \{\s*useLayoutEffect\(\(\) => \{[\s\S]*?\}, \[\]\);\s*\}/, `${name}: a layout effect on mount, and nothing else`);
  }
  assert.match(hook, /useSyncExternalStore\(never, \(\) => true, \(\) => false\)/, "useHydrated: false on the server and while hydrating");
});

test("every controlled field of the auth forms keeps what was typed before hydration", () => {
  let fields = 0;
  for (const file of FORMS) {
    const text = source(file);
    for (const element of [...elements(text, "input"), ...elements(text, "CodeField")]) {
      const value = /\bvalue=\{(\w+)\}/.exec(element)?.[1];
      if (!value) continue;
      fields += 1;
      const ref = /\bref=\{(\w+)\}/.exec(element)?.[1];
      assert.ok(ref, `${file}: the field showing ${value} has a ref`);
      assert.match(text, new RegExp(`useKeepTypedValue\\(${ref}, ${value}, `), `${file}: ${value} keeps its typed text (useKeepTypedValue(${ref}, ${value}, …))`);
    }
  }
  assert.equal(fields, 10, "sign-in 2, sign-up 4, forgot 1, reset 2 and the code step's 1 (both code flows share it)");
});

test("an \"Other options\" panel opened before hydration stays open, and React knows it", () => {
  for (const file of ["src/app/(auth)/signin/SignInForm.tsx", "src/app/(auth)/signup/SignUpForm.tsx"]) {
    const text = source(file);
    const [details] = elements(text, "details");
    assert.ok(details, file);
    assert.match(details, /\bopen=\{open\}/, file);
    const ref = /\bref=\{(\w+)\}/.exec(details)?.[1];
    assert.ok(ref, `${file}: the panel has a ref`);
    assert.match(text, new RegExp(`useKeepOpenState\\(${ref}, open, setOpen\\)`), file);
  }
});

test("each auth form marks itself data-hydrated once React runs it", () => {
  for (const file of FORMS) {
    const text = source(file);
    const forms = elements(text, "form");
    assert.ok(forms.length >= 1, file);
    for (const form of forms) assert.match(form, /data-hydrated=\{hydrated \|\| undefined\}/, `${file}: ${form.slice(0, 60)}`);
    assert.match(text, /const hydrated = useHydrated\(\);/, file);
  }
});
