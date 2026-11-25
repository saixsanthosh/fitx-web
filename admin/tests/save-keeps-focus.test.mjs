// A save must not remount the control it was sent from: keyboard focus would fall to the page (review finding
// 76-settings-focus-remount; BRIEF-3 D5). Settings keyed its maintenance fieldset by the save's time, so every save
// sent with Enter from Title, From or Until destroyed the focused field. Now the fields are never remounted; only a
// save that cleared the notice (switch off: the fieldset is disabled, so nothing in it can hold focus) puts what is
// stored back into them. The same mistake in the notice composer: it starts again after a send with a new form that
// no longer has the Send button that had focus, so focus now moves to the result, which is read out.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const { showStoredWhenOff } = await importTypeScriptModule("src/components/settings/settings-rules.ts");
const source = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

// A field as the fieldset's `elements` gives it: what is in it, and the stored value React drew it with.
const field = (value, defaultValue) => ({ value, defaultValue });

test("with the switch off, a save shows what is stored (the cleared notice) in the notice's fields", () => {
  const title = field("Planned upgrade tonight", "");
  const body = field("Slow for an hour.", "");
  const starts = field("2026-11-26T22:00", "");
  const notAField = {};
  assert.equal(showStoredWhenOff({ disabled: true, elements: [title, body, starts, notAField] }), true);
  assert.deepEqual([title.value, body.value, starts.value], ["", "", ""]);
  assert.deepEqual(notAField, {}, "an element without a stored value is left alone");
});

test("with the switch on, a save leaves the fields as typed, so focus and caret stay where they are", () => {
  const title = field("Planned upgrade tonight ", "Planned upgrade tonight");
  assert.equal(showStoredWhenOff({ disabled: false, elements: [title] }), false);
  assert.equal(title.value, "Planned upgrade tonight ");
  assert.equal(showStoredWhenOff(null), false);
  assert.equal(showStoredWhenOff(undefined), false);
});

test("Settings never keys the maintenance fields by the save; the stored values come in after each save instead", async () => {
  const form = await source("components/settings/settings-form.tsx");
  assert.doesNotMatch(form, /<fieldset key=|key=\{defaults\.updatedAt/);
  assert.match(form, /<fieldset ref=\{maintenanceFields\} className=\{`\$\{styles\.maintenanceFields\} stack-form`\} disabled=\{!maintenanceOn\}>/);
  assert.match(form, /useEffect\(\(\) => \{\s+showStoredWhenOff\(maintenanceFields\.current\);\s+\}, \[defaults\.updatedAt\]\);/);
  // The save keeps the form on the page (no redirect), so nothing else takes focus away.
  const actions = await source("app/(control)/settings/actions.ts");
  assert.doesNotMatch(actions, /redirect\(/);
  assert.match(actions, /revalidatePath\("\/settings"\);\n  return \{ status: "saved"/);
});

test("after a send the notice composer moves focus to its result instead of losing it with the old form", async () => {
  const form = await source("components/notifications/notice-form.tsx");
  assert.match(form, /<form key=\{formKey\}/, "the composer still starts again after a send");
  assert.match(form, /useEffect\(\(\) => \{\s+if \(state\?\.sent\) sentRef\.current\?\.focus\(\);\s+\}, \[state\]\);/);
  assert.match(form, /\{state\?\.sent && <p ref=\{sentRef\} tabIndex=\{-1\} role="status" className="inline-notice notice-success">\{state\.sent\}<\/p>\}/);
});
