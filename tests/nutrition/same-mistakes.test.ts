// The mistakes of bugs 13, 15 and 16 elsewhere in Nutrition: a refusal shown on the page behind an open dialog (Edit
// entry, Daily targets, the name dialogs) or a toast raised under the open Log food sheet (the one-tap Add); controls
// disabled under the focus while saving (which drops it to the page body in Chrome); and rows deleted with the focus
// on them (a saved food, a routine).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { neighbourAfterRemoval } from "@/lib/food/meal-undo";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const page = read("src/app/(dashboard)/nutrition/page.tsx");
const between = (from: string, to: string) => page.slice(page.indexOf(from), page.indexOf(to, page.indexOf(from)));

test("a refused save is said inside the dialog that is still open", () => {
  for (const [start, end] of [["async function saveEntry(", "/**"], ["async function saveNamed(", "async function applyTemplate("], ["async function updateTargets(", "/**"]]) {
    const body = between(start, end);
    assert.match(body, /Promise<string \| null>/, start);
    assert.doesNotMatch(body, /setError\("[^"]/, `${start}: not on the page behind the dialog`);
  }
  assert.match(read("src/components/nutrition/EntryEditor.tsx"), /if \(refused\) setProblem\(refused\);/);
  assert.match(read("src/components/nutrition/TargetsEditor.tsx"), /\{refused && <p role="alert"/);
  assert.match(read("src/components/nutrition/NameDialog.tsx"), /\{refused && <p role="alert"/);
});

test("the one-tap Add closes Log food before its toast, so the toast and its Undo can be seen", () => {
  const addUsual = between("async function addUsual(", "function chooseFrequent(");
  assert.ok(addUsual.indexOf("setLogOpen(false)") > 0 && addUsual.indexOf("setLogOpen(false)") < addUsual.indexOf("announceAdded("));
});

test("no Nutrition control is disabled under the focus while something saves or searches", () => {
  const files = [
    "src/app/(dashboard)/nutrition/page.tsx",
    ...readdirSync(new URL("../../src/components/nutrition/", import.meta.url)).filter((name) => name.endsWith(".tsx")).map((name) => `src/components/nutrition/${name}`),
  ];
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /(?<![-\w])disabled=\{(busy|searchingFoods|water\.busy)\b/, `${file}: aria-disabled and an early return instead`);
  }
});

test("deleting a saved food or a routine moves the focus to the next one, the one before, or the list", () => {
  assert.equal(neighbourAfterRemoval(["a", "b", "c"], "b"), "c");
  assert.equal(neighbourAfterRemoval(["a", "b", "c"], "c"), "b");
  assert.equal(neighbourAfterRemoval(["a"], "a"), null);
  assert.equal(neighbourAfterRemoval(["a"], "x"), null);
  assert.match(between("async function removeFood(", "/**"), /pendingFocus\.current = \[\.\.\.\(next \? \[`\[data-food-use="\$\{next\}"\]`\] : \[\]\), "\[data-food-add\]"\];/);
  assert.match(between("async function removeTemplate(", "/**"), /"#routines-title"\]/);
  assert.match(read("src/components/nutrition/MyFoods.tsx"), /data-food-use=\{row\.id\}/);
  assert.match(read("src/components/nutrition/Routines.tsx"), /data-routine-add=\{template\.id\}/);
  assert.match(read("src/components/nutrition/Routines.tsx"), /<h2 id="routines-title" tabIndex=\{-1\}/);
});
