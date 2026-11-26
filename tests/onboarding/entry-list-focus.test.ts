// The same mistake as review finding a11y-onboarding-continue-disabled-while-saving (fix round 3a), in the shared
// Profile controls (src/components/profile/ProfileControls.tsx): a control that becomes disabled, or goes, while it
// has keyboard focus drops it to the page in Chrome. Profile's entry lists ("Other allergies", "Foods avoided",
// "Anything else") did it three ways: + was disabled as soon as it emptied the box, the box was disabled under focus
// when Enter added the last entry allowed, and an entry's Remove button went with the entry. A choice's Clear ("Clear
// your diet") went once nothing was chosen. Now + and the full box stay focusable (aria-disabled, a press does
// nothing), and a removed control hands focus on before it goes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { focusAfterRemovingEntry } from "@/lib/onboarding/entry-focus";

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const controls = read("src/components/profile/ProfileControls.tsx");

/** A component's source, from its declaration to the next top-level declaration. */
function component(name: string): string {
  const start = controls.indexOf(`export function ${name}`);
  assert.ok(start >= 0, `${name} was found`);
  const end = controls.indexOf("\nexport function ", start + 1);
  return controls.slice(start, end < 0 ? undefined : end);
}

/** Each opening tag of an element in a source (braces skipped as a whole, so arrow functions don't end it early). */
function tags(text: string, element: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(new RegExp(`<${element}\\b`, "g"))) {
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

const withoutAria = (tag: string) => tag.replace(/aria-disabled(?::[\w-]+(?:-\[[^\]]*\])?|=\{[^}]*\})/g, "");

test("a removed entry hands focus to the next entry's Remove, else the one before, else +", () => {
  assert.equal(focusAfterRemovingEntry(3, 0), 1, "the first: the next one");
  assert.equal(focusAfterRemovingEntry(3, 1), 2, "a middle one: the next one");
  assert.equal(focusAfterRemovingEntry(3, 2), 1, "the last: the one before");
  assert.equal(focusAfterRemovingEntry(2, 1), 0);
  assert.equal(focusAfterRemovingEntry(1, 0), "add", "the only one: + (a button, so a phone's keyboard doesn't open)");
  for (const index of [-1, 3, 0.5, Number.NaN]) assert.equal(focusAfterRemovingEntry(3, index), "add", `not on the list (${index})`);
  assert.equal(focusAfterRemovingEntry(0, 0), "add");
  // Whatever is removed, focus lands on a control that is still there afterwards.
  for (let count = 1; count <= 12; count += 1) {
    for (let index = 0; index < count; index += 1) {
      const target = focusAfterRemovingEntry(count, index);
      if (target !== "add") assert.ok(target >= 0 && target < count && target !== index, `${count} entries, removing ${index}`);
      else assert.equal(count, 1, "+ only when the list empties");
    }
  }
});

test("+ and the box stay focusable whatever they hold, and do nothing when there is nothing to add", () => {
  const tagInput = component("TagInput");
  const [box] = tags(tagInput, "input");
  assert.ok(box, "the box was found");
  assert.doesNotMatch(withoutAria(box), /\bdisabled=/, "the box is never disabled");
  assert.match(box, /readOnly=\{full\}/);
  assert.match(box, /aria-disabled=\{full \|\| undefined\}/);
  const add = tags(tagInput, "button").find((tag) => /ref=\{addButton\}/.test(tag));
  assert.ok(add, "+ was found");
  assert.doesNotMatch(withoutAria(add), /\bdisabled=/, "+ is never disabled");
  assert.match(add, /onClick=\{\(\) => \{ if \(canAdd\) add\(\); \}\}/);
  assert.match(add, /aria-disabled=\{!canAdd \|\| undefined\}/);
  assert.match(tagInput, /const canAdd = draft\.trim\(\) !== "" && !full;/);
  assert.match(tagInput, /if \(event\.key === "Enter" \|\| event\.key === ","\) \{\s*event\.preventDefault\(\);\s*if \(canAdd\) add\(\);/, "Enter in a full box adds nothing");
});

test("an entry's Remove moves focus on before the entry goes", () => {
  const tagInput = component("TagInput");
  assert.match(tagInput, /const remove = \(value: string\) => \{\s*const target = focusAfterRemovingEntry\(values\.length, values\.indexOf\(value\)\);\s*const next = target === "add" \? addButton\.current : list\.current\?\.querySelectorAll<HTMLButtonElement>\(":scope > li > button"\)\[target\];\s*next\?\.focus\(\{ preventScroll: true \}\);\s*onChange\(values\.filter\(\(item\) => item !== value\)\);\s*\};/);
  assert.match(tagInput, /<ul ref=\{list\} /);
  assert.match(tagInput, /onClick=\{\(\) => remove\(value\)\}\s*aria-label=\{`Remove \$\{value\}`\}/);
  // One button per entry, in the list's order, so a place in the list is a place among its buttons.
  assert.match(tagInput, /\{values\.map\(\(value\) => \(\s*<li key=\{value\}[^>]*>\s*<span[^>]*>\{value\}<\/span>\s*<button\b/);
  assert.equal(tags(tagInput.slice(tagInput.indexOf("<ul ")), "button").length, 1);
});

test("Clear moves focus to the first choice before it goes", () => {
  const group = component("ChoiceGroup");
  assert.match(group, /const clear = \(\) => \{\s*group\.current\?\.querySelector<HTMLInputElement>\('input\[type="radio"\]:not\(:disabled\)'\)\?\.focus\(\{ preventScroll: true \}\);\s*onClear\?\.\(\);\s*\};/);
  assert.match(group, /<fieldset ref=\{group\} /);
  assert.match(group, /\{onClear && value !== null && \(\s*<button type="button" onClick=\{clear\} /);
});

test("+ and the full box look like a disabled button and field", () => {
  const tagInput = component("TagInput");
  const globals = read("src/app/globals.css");
  assert.match(globals, /\.fitx-button:disabled \{ opacity: \.58; \}/);
  assert.match(globals, /button:disabled \{ cursor: not-allowed; \}/);
  assert.match(tags(tagInput, "button").find((tag) => /ref=\{addButton\}/.test(tag)) ?? "", /aria-disabled:cursor-not-allowed aria-disabled:opacity-\[\.58\]/);
  assert.match(globals, /\.fitx-field:disabled \{ color: var\(--fitx-text-disabled\); opacity: \.72; \}/);
  assert.match(tags(tagInput, "input")[0] ?? "", /className="fitx-field aria-disabled:opacity-\[\.72\]"/);
});
