// Fix round 3c, an open item from round 3a (the onboarding fixer, D5): the Nutrition setup's own lists of other
// allergies and foods you dislike dropped the keyboard focus. Add was disabled={!draft.trim()}, so once it had added
// the word and emptied the box it became disabled under the focus (Chrome then drops it to the page), and each Remove
// went with its entry. Now Add is only marked unavailable (aria-disabled, with an early return), and Remove hands the
// focus to the next entry's Remove, else the one before, else Add, before its entry goes. The same mistake in the food
// form: "Remove photo" and "Keep it" take each other's place, so the other one takes the focus.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addTag, tagFocusAfterRemoving } from "@/lib/food/setup";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("Remove hands the focus to the next entry, else the one before, else Add", () => {
  const list = ["Kiwi", "Mustard", "Celery"];
  assert.equal(tagFocusAfterRemoving(list, "Kiwi"), 1, "the next one (Mustard), at its place in the list as it was");
  assert.equal(tagFocusAfterRemoving(list, "Mustard"), 2);
  assert.equal(tagFocusAfterRemoving(list, "Celery"), 1, "the last one: the one before");
  assert.equal(tagFocusAfterRemoving(["Kiwi"], "Kiwi"), "add", "the only one: Add");
  assert.equal(tagFocusAfterRemoving(list, "Sesame"), "add", "not in the list");
  assert.equal(addTag(["Kiwi"], "  mustard ", "allergy").length, 2, "adding still works as before");
});

test("the setup's Add stays focusable and Remove moves the focus before its entry goes", () => {
  const setup = read("src/components/nutrition/NutritionSetup.tsx");
  const tags = setup.slice(setup.indexOf("function TagInput("));
  assert.doesNotMatch(tags, /(?<!aria-)disabled=\{/, "never disabled under the focus");
  assert.match(tags, /<button ref=\{add\} type="button" className="fitx-button fitx-button-secondary" aria-disabled=\{empty \|\| undefined\} onClick=\{\(\) => \{ if \(!empty\) onAdd\(\); \}\}>Add<\/button>/);
  assert.match(tags, /const next = tagFocusAfterRemoving\(values, value\);\s*\(next === "add" \? add\.current : list\.current\?\.querySelectorAll<HTMLButtonElement>\("button"\)\[next\] \?\? add\.current\)\?\.focus\(\);\s*onRemove\(value\);/, "the focus moves first, then the entry goes");
  assert.match(tags, /<button type="button" onClick=\{\(\) => remove\(value\)\} aria-label=\{`Remove \$\{value\}`\}>/);
  assert.match(tags, /<ul ref=\{list\} className=\{styles\.tagList\}>/);
  const css = read("src/components/nutrition/NutritionSetup.module.css");
  assert.match(css, /\.tagRow :global\(\.fitx-button\)\[aria-disabled="true"\] \{ opacity: \.58; cursor: not-allowed; \}/, "it still looks unavailable");
});

test("Remove photo and Keep it hand the focus to each other", () => {
  const form = read("src/components/nutrition/CustomFoodForm.tsx");
  assert.match(form, /id="custom-food-remove-photo" className=\{styles\.textButton\} onClick=\{\(\) => \{ photoSwapped\.current = true; setRemovePhoto\(true\); \}\}>Remove photo<\/button>/);
  assert.match(form, /id="custom-food-keep-photo" className=\{styles\.textButton\} onClick=\{\(\) => \{ photoSwapped\.current = true; setRemovePhoto\(false\); \}\}>Keep it<\/button>/);
  assert.match(form, /if \(!photoSwapped\.current\) return;\s*photoSwapped\.current = false;\s*document\.getElementById\(removePhoto \? "custom-food-keep-photo" : "custom-food-remove-photo"\)\?\.focus\(\);\s*\}, \[removePhoto\]\);/, "only after one of them was pressed, not when a new photo is chosen");
});
