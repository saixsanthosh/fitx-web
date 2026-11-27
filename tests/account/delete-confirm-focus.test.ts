// Delete my account, typed confirmation (release 3 fix round 3f, review
// a11y-copy:a11y-home-delete-account-confirm-box-disabled-while-deleting). Typing DELETE and pressing Enter submits from
// the confirmation box, and the box was disabled={step === "deleting"}: a control that becomes disabled under focus drops
// it to the page (D5), so focus was nowhere for the whole deletion. Since round 3d's slow state a member who waited 30 s
// heard "You can close this now…" with focus still nowhere, and nothing had said that deleting had started. The box now
// stays focusable while deleting (read-only and aria-disabled, as Profile's full entry box), Enter there does nothing
// more, and one status line inside the dialog says deleting has started and, once slow, shows the note.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DELETE_STARTED, DELETE_TAKING_LONG, deletingStatus } from "@/components/account/deletion-wait";

const source = readFileSync(new URL("../../src/components/account/DeleteAccount.tsx", import.meta.url), "utf8");

/** Each opening tag of `name` in the file (braces skipped as a whole, so arrow functions don't end it early). */
function tags(text: string, name: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(new RegExp(`<${name}\\b`, "g"))) {
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

describe("the confirmation box keeps focus while deleting", () => {
  const box = tags(source, "input").find((tag) => tag.includes('id="delete-confirm"')) ?? "";

  test("it is read-only and aria-disabled while deleting, never disabled", () => {
    assert.ok(box, "the box is there");
    assert.match(box, /readOnly=\{step === "deleting"\}/);
    assert.match(box, /aria-disabled=\{step === "deleting" \|\| undefined\}/);
    assert.doesNotMatch(box.replace(/aria-disabled=\{[^}]*\}/g, ""), /\bdisabled=/, "a disabled box drops focus to the page");
  });

  test("it still looks unavailable while deleting, as Profile's full entry box does", () => {
    assert.match(box, /className="fitx-field mt-1\.5 aria-disabled:opacity-\[\.72\]"/);
  });

  test("Enter in the box while deleting does nothing more: the form's submit goes to remove(), which returns early", () => {
    assert.match(source, /<form id="delete-account-form" onSubmit=\{\(event\) => \{ event\.preventDefault\(\); void remove\(\); \}\}/);
    assert.match(source, /async function remove\(\) \{\s*(?:\/\/[^\n]*\n\s*)*if \(step === "deleting" \|\| typed !== DELETE_CONFIRMATION \|\| !status\?\.userId\) return;/);
  });

  test("nothing in the dialog moves focus while deleting, so it stays where the member left it (the box or the button)", () => {
    const effect = source.slice(source.indexOf("// Move focus to what the dialog now asks for"), source.indexOf("async function open()"));
    assert.match(effect, /const target = step === "confirm" \? document\.getElementById\("delete-confirm"\) : dialog\.current\.querySelector<HTMLElement>\("\[data-autofocus\]"\);/);
    const autofocused = tags(source, "button").filter((tag) => /data-autofocus/.test(tag));
    for (const tag of autofocused) assert.doesNotMatch(tag, /data-autofocus=\{[^}]*"deleting"/, "no button takes focus while deleting");
  });

  test("no form control in the dialog is disabled by a busy state (D5)", () => {
    const controls = ["input", "button", "textarea", "select"].flatMap((name) => tags(source, name));
    const busyDisabled = controls.filter((tag) => /\bdisabled=\{[^}]*(?:leaving|"deleting"|slow)[^}]*\}/.test(tag.replace(/aria-disabled=\{[^}]*\}/g, "")));
    assert.deepEqual(busyDisabled, []);
  });
});

describe("one status line says deleting has started, then that it is slow", () => {
  test("from the start it is read out, not shown: the button already shows Deleting…", () => {
    assert.deepEqual(deletingStatus(false), { text: DELETE_STARTED, shown: false });
    assert.equal(DELETE_STARTED, "Deleting your account…");
  });

  test("once slow, the same line shows the note, with Close and Escape (delete-time-limit.test.ts)", () => {
    assert.deepEqual(deletingStatus(true), { text: DELETE_TAKING_LONG, shown: true });
  });

  test("the dialog draws it as one role=status line for the whole deletion, inside the dialog (D6)", () => {
    assert.match(source, /const progress = deletingStatus\(slow\);/);
    const lines = source.match(/\{step === "deleting" && <p role="status"[^\n]*<\/p>\}/g) ?? [];
    assert.equal(lines.length, 1, "one line, so the change to the note is read out");
    assert.match(lines[0], /className=\{progress\.shown \? "mt-4 text-sm leading-6 text-fitx-text-secondary" : "sr-only"\}>\{progress\.text\}<\/p>/);
    assert.doesNotMatch(source, /step === "deleting" && slow && <p/, "no second line added when slow");
    const dialog = source.slice(source.indexOf("<dialog"), source.indexOf("</dialog>"));
    assert.ok(dialog.includes("{progress.text}"), "inside the dialog, above the top layer");
  });
});
