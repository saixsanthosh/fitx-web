// D5 in "Delete my account" (release 3 fix round 3a: the same mistake as Profile's busy buttons, review
// a11y-copy:a11y-home-profile-controls-drop-focus). "Sign in again" was disabled={leaving} while it signed out: when the
// member chose to keep recordings that aren't on their account yet, it came back with focus dropped to the page, and
// nothing put it back (the dialog moves focus only when its step changes). Cancel and Delete permanently were disabled
// while busy too. All three now stay focusable while busy (aria-disabled) and do nothing meanwhile; Delete permanently
// is still disabled until DELETE is typed (flow 08 checks that), a reason the dialog itself gives.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../src/components/account/DeleteAccount.tsx", import.meta.url), "utf8");

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

const tags = buttons(source);
const find = (needle: string) => tags.find((tag) => tag.includes(needle)) ?? "";

test("Sign in again stays focusable while it signs out, and a second press does nothing", () => {
  const signIn = find("signInAgain()");
  assert.match(signIn, /aria-disabled=\{leaving \|\| undefined\}/);
  assert.doesNotMatch(signIn.replace(/aria-disabled=\{[^}]*\}/g, ""), /\bdisabled=/);
  assert.match(source, /async function signInAgain\(\) \{\s*(?:\/\/[^\n]*\n\s*)*if \(leaving\) return;\s*const supabase = createClient\(\);\s*setLeaving\(true\);/);
});

test("Cancel stays focusable while deleting or signing out; close() already does nothing then", () => {
  const cancel = find("onClick={close}");
  // Since fix round 3d a deletion that is slow may be closed (deletion-wait.ts canCloseDeletion, delete-time-limit.test.ts).
  assert.match(cancel, /aria-disabled=\{!closable \|\| undefined\}/);
  assert.doesNotMatch(cancel.replace(/aria-disabled=\{[^}]*\}/g, ""), /\bdisabled=/);
  assert.match(source, /const closable = canCloseDeletion\(step, \{ leaving, slow \}\);/);
  assert.match(source, /function close\(\) \{\s*if \(!closable\) return;/);
});

test("Delete permanently: disabled only until DELETE is typed; while deleting it keeps focus and does nothing", () => {
  const remove = find('form="delete-account-form"');
  assert.match(remove, /disabled=\{typed !== DELETE_CONFIRMATION\} aria-disabled=\{step === "deleting" \|\| undefined\}/);
  assert.match(source, /async function remove\(\) \{\s*(?:\/\/[^\n]*\n\s*)*if \(step === "deleting" \|\| typed !== DELETE_CONFIRMATION \|\| !status\?\.userId\) return;/);
});

test("busy buttons still look busy", () => {
  for (const needle of ["signInAgain()", "onClick={close}", 'form="delete-account-form"']) assert.match(find(needle), /aria-disabled:opacity-60/, needle);
});

test("no button in the dialog is disabled while busy", () => {
  const busyDisabled = tags.filter((tag) => /\bdisabled=\{[^}]*(?:leaving|"deleting")[^}]*\}/.test(tag.replace(/aria-disabled=\{[^}]*\}/g, "")));
  assert.deepEqual(busyDisabled, []);
});
