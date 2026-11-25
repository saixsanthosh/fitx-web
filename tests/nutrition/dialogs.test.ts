// Bug 13 (nutrition-5): Nutrition's Edit entry, Daily targets, food form, name and katori dialogs were divs marked as
// modal: Tab left them for the page behind, screen readers reached the page, and closing them dropped focus on the page
// body. They are now the shared Sheet (a native <dialog> opened with showModal(): focus stays inside, the page behind
// is inert, Escape closes, focus goes back to the opener). There is no DOM library in these tests, so they check the
// source for the structure that gives that behaviour.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const DIALOGS = ["EntryEditor", "TargetsEditor", "CustomFoodForm", "NameDialog", "HouseholdMeasures"];

test("every Nutrition dialog is a Sheet (native modal dialog), not a div marked as one", () => {
  for (const name of DIALOGS) {
    const source = read(`src/components/nutrition/${name}.tsx`);
    assert.match(source, /import \{ Sheet \} from "@\/components\/ui\/Sheet";/, `${name} uses Sheet`);
    assert.match(source, /<Sheet open onClose=\{on(Cancel|Close)\}/, `${name} closes through Sheet (Escape, backdrop, Close)`);
    assert.doesNotMatch(source, /role="dialog"|aria-modal/, `${name} is not a hand-made dialog`);
    assert.doesNotMatch(source, /addEventListener\("keydown"/, `${name} leaves Escape to the native dialog`);
    assert.match(source, /useEffect\(\(\) => \{[^}]*focus\(\)/, `${name} starts on its first field once open`);
  }
});

test("a dialog's Save button is never disabled under the focus while saving", () => {
  for (const name of DIALOGS) {
    const source = read(`src/components/nutrition/${name}.tsx`);
    const submit = source.split("\n").find((line) => line.includes('type="submit"')) ?? "";
    assert.ok(!/\sdisabled=/.test(submit), `${name}: aria-disabled, so Chrome keeps the focus on it (${submit.trim()})`);
  }
  for (const name of ["EntryEditor", "CustomFoodForm"]) assert.match(read(`src/components/nutrition/${name}.tsx`), /if \(busy\) return;/, `${name} ignores a second press while saving`);
});

test("closing a dialog opened from Log food brings the focus back to the control that opened it", () => {
  const page = read("src/app/(dashboard)/nutrition/page.tsx");
  const targets = [...page.matchAll(/hideLog\("([a-z-]+)"\)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(targets)].sort(), ["log-add-food", "log-barcode-create", "log-create-food", "log-portion-meal", "log-portion-measures", "log-save-food"]);
  for (const id of targets.filter((target) => !target.startsWith("log-portion-"))) assert.match(page, new RegExp(`id="${id}"`), `${id} is on the page`);
  assert.match(page, /idPrefix="log-portion"/);
  assert.match(read("src/components/nutrition/FoodDetail.tsx"), /id=\{`\$\{props\.idPrefix\}-meal`\}/);
  assert.match(read("src/components/nutrition/PortionPicker.tsx"), /id=\{`\$\{idPrefix\}-measures`\}/);
  const quickAdd = page.split("\n").find((line) => line.includes('aria-label="Quick add"')) ?? "";
  assert.ok(quickAdd.includes("<form hidden={logOpen}"), "the quick add box that opened Log food stays on the page to take the focus back");
});
