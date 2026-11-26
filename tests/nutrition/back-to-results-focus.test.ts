// Fix round 3c, the browser re-check's side note on bug 54 (nutrition-b): after a press on "Back to results" in Log
// food, the keyboard focus fell to the page body. The Add to log panel and the list take each other's place in the
// sheet, so the control pressed goes with what it was in: Back to results with the panel, a food of the list (or the
// search box, an example, "Search packaged") with the list. Now the chosen food's amount takes the focus, and back on
// the list the food just left does (else the search box, or the barcode box after a lookup), only when it fell to the
// page. The same mistake in the panel itself: "Use 150 g" (and "1 teaspoon (5 g)") took their own question away, with
// the focus; the amount they set takes it now.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { foodCardKey, swapFocusTargets } from "@/lib/food/log-sheet";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("each entry of the sheet's lists has its own name, also a food that is both in Recent and in the results", () => {
  assert.equal(foodCardKey("recent", "171287", "USDA FoodData Central"), "recent:USDA FoodData Central:171287");
  assert.equal(foodCardKey("result", "171287", "USDA FoodData Central"), "result:USDA FoodData Central:171287");
  assert.notEqual(foodCardKey("recent", "171287", "USDA FoodData Central"), foodCardKey("result", "171287", "USDA FoodData Central"));
  assert.equal(foodCardKey("frequent", "usda:171287"), "frequent:usda:171287");
});

test("the panel gives the focus to the food's amount; the list to the food just left, else the search or barcode box", () => {
  assert.deepEqual(swapFocusTargets({ panel: true, mode: "search", from: "recent:FITX:idli" }), ["#log-portion-amount"]);
  assert.deepEqual(swapFocusTargets({ panel: true, mode: "barcode", from: null }), ["#log-portion-amount"], "a scanned product: its amount");
  assert.deepEqual(swapFocusTargets({ panel: false, mode: "search", from: "result:FITX:roti" }), ['[data-food-card="result:FITX:roti"]', "#log-search"], "Back to results: the food just left, else the search box");
  assert.deepEqual(swapFocusTargets({ panel: false, mode: "search", from: null }), ["#log-search"], "a food a search picked, or one opened from My foods: the search box");
  assert.deepEqual(swapFocusTargets({ panel: false, mode: "barcode", from: "recent:FITX:idli" }), ["#barcode-number"], "back from a scanned product: the barcode box");
  const escaped = swapFocusTargets({ panel: false, mode: "search", from: 'result:Open Food Facts:a"b' }, (value) => value.replace(/"/g, '\\"'));
  assert.equal(escaped[0], '[data-food-card="result:Open Food Facts:a\\"b"]', "the page escapes the name (CSS.escape)");
});

test("the page moves the focus only when it fell to the page, after the panel and the list swap places", () => {
  const page = read("src/app/(dashboard)/nutrition/page.tsx");
  const effect = page.slice(page.indexOf("useEffect(() => {\n    if (!logOpen || !focusFellToPage("), page.indexOf("useEffect(() => {\n    const targets = reloadFocusTargets("));
  assert.ok(effect.length > 0, "one effect does it");
  assert.match(effect, /if \(!logOpen \|\| !focusFellToPage\(document\.activeElement, document\.body\)\) return;/, "a control that is still there keeps the focus");
  assert.match(effect, /swapFocusTargets\(\{ panel: Boolean\(selected\), mode: logMode, from: chosenFrom\.current \}, CSS\.escape\)/);
  assert.match(effect, /\}, \[logOpen, selected, logMode, lastSearch, searchMode, searchingFoods\]\);/, "the panel, the list, and an answer that takes an example or Packaged away");
  assert.match(page, /<input id="log-search" ref=\{searchInput\}/, "the search box can be found");
  assert.match(page, /chosenFrom\.current = from;\s*setSelected\(food\);/, "every choice records where it came from (null when not from a list)");
  const showStart = page.slice(page.indexOf("function showStart("), page.indexOf("function resetLogSheet("));
  assert.match(showStart, /chosenFrom\.current = null;/, "the start view is a new list: an entry of the old one is never focused");
  assert.match(page, /card=\{foodCardKey\("recent", food\.id, food\.source\)\} onSelect=\{\(chosen\) => chooseFood\(chosen, lastQuery, foodCardKey\("recent", chosen\.id, chosen\.source\)\)\}/);
  assert.match(page, /card=\{foodCardKey\("result", food\.id, food\.source\)\} onSelect=\{\(chosen\) => chooseFood\(chosen, lastQuery, foodCardKey\("result", chosen\.id, chosen\.source\)\)\}/);
  assert.match(page, /chooseFood\(food, NO_AMOUNT, foodCardKey\("frequent", item\.key\)\);/);
  assert.match(page, /aria-label="Back to results"/, "Back to results is still the panel's way back");
  const card = read("src/components/nutrition/FoodResultCard.tsx");
  assert.match(card, /data-food-card=\{card\}/);
  const frequent = read("src/components/nutrition/FrequentFoods.tsx");
  assert.match(frequent, /data-food-card=\{foodCardKey\("frequent", item\.key\)\} onClick=\{\(\) => onChoose\(item\)\}/);
});

test("an answer to the amount's question gives the focus to the amount it set", () => {
  const picker = read("src/components/nutrition/PortionPicker.tsx");
  assert.match(picker, /onClick=\{\(\) => \{ action\.run\(\); document\.getElementById\(`\$\{idPrefix\}-amount`\)\?\.focus\(\); \}\}/);
  assert.doesNotMatch(picker, /onClick=\{action\.run\}/);
  assert.match(picker, /<input id=\{`\$\{idPrefix\}-amount`\}/, "the amount field it focuses");
});
