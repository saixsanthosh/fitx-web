// The mistake of bug 16 elsewhere in Nutrition: a refusal shown on the page behind an open dialog (Edit entry, Daily
// targets, the name dialogs), or a toast raised under the open Log food sheet (the one-tap Add).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
