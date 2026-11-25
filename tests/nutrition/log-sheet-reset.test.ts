// Review round, findings N2 and N3 (bugs 55, 56 and 57's fixes). N2: Log food went back to its start view only when it
// was closed, a food was logged or a search had no food name. A dialog opened from it that saved (Create a food, Add
// your own food, Save to My foods) left the old barcode answer, search or Add to log panel for the next Log food, and
// going from Barcode to Search listed only the lookup's source chips; logging left the barcode number in its box. N3: a
// search or lookup still running when the sheet closed (or a search with no food name was sent) answered late and
// put its results, chips, barcode answer or chosen food back, or left "Loading foods…" on the start view.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { answerGate, listedFoods, startView } from "@/lib/food/log-sheet";
import type { FoodResult } from "@/lib/food/types";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const page = read("src/app/(dashboard)/nutrition/page.tsx");
const between = (from: string, to: string) => {
  const start = page.indexOf(from);
  assert.ok(start >= 0, from);
  return page.slice(start, page.indexOf(to, start + from.length));
};

test("only the newest search or lookup answers, and none once the sheet is back on its start view", () => {
  const gate = answerGate();
  const poha = gate.start();
  assert.equal(poha(), true);
  const dal = gate.start();
  assert.deepEqual([poha(), dal()], [false, true], "a newer search replaces an older one");
  gate.drop();
  assert.equal(dal(), false, "closed (or a search with no food name) while it ran: its late answer is dropped");
  const next = gate.start();
  assert.equal(next(), true, "the next search answers as usual");
});

test("the start view drops what is still to come and never waits for a dropped search", () => {
  const showStart = between("function showStart(", "function resetLogSheet(");
  assert.match(showStart, /searchGate\.current\.drop\(\);\s*barcodeGate\.current\.drop\(\);/);
  assert.match(showStart, /setSearchingFoods\(false\);\s*if \(!browse\) void browseFoods\(\);/, "\"Loading foods…\" only while the browse list itself loads");
  assert.match(showStart, /if \(!keepMiss\) setBarcodeMiss\(null\);/);
  const search = between("async function runFoodSearch(", "async function searchFoods(");
  assert.match(search, /const current = searchGate\.current\.start\(\);/);
  assert.match(search, /if \(!current\(\)\) return;/);
  assert.match(search, /finally \{ if \(current\(\)\) setSearchingFoods\(false\); \}/);
  const lookup = between("const lookupBarcode = useCallback(", "const onBarcodeDetected");
  assert.match(lookup, /const current = barcodeGate\.current\.start\(\);/, "a barcode lookup is numbered too");
  assert.ok(lookup.indexOf("if (!current()) return;") > lookup.indexOf("await response.json()"), "and its answer is checked once it comes");
  assert.ok(lookup.indexOf("if (!current()) return;") < lookup.indexOf('setSearchMode("barcode")'), "before it sets anything");
  assert.match(lookup, /catch \(cause\) \{\s*if \(current\(\)\) \{/, "a late failure is dropped too");
});

test("every way out of the sheet that doesn't come back starts the next Log food afresh, barcode box included", () => {
  const reset = between("function resetLogSheet(", "/**");
  assert.match(reset, /showStart\(\);\s*setQuery\(""\); setBarcode\(""\); setError\(""\); setNotice\(""\);/);
  assert.match(between("function closeLog(", "function hideLog("), /resetLogSheet\(\);/);
  assert.match(between("async function insertLoggedFood(", "async function addUsual("), /setLogOpen\(false\); resetLogSheet\(\);/, "logging empties the barcode box too");
  assert.match(between("async function addUsual(", "function chooseFrequent("), /setLogOpen\(false\); resetLogSheet\(\);/);
  const save = between("async function saveFood(", "async function removeFood(");
  assert.match(save, /const fromLog = reopenLog\.current;\s*reopenLog\.current = false;\s*if \(fromLog\) resetLogSheet\(\);/, "a food saved from Log food (Create a food, Add your own food, Save to My foods)");
  assert.ok(save.indexOf("resetLogSheet()") < save.indexOf("toast.success("), "before Log it can choose the saved food");
});

test("going from Barcode to Search shows the start view, keeping a missed barcode for Add your own food", () => {
  const change = between("function changeLogMode(", "function searchByName(");
  assert.match(change, /if \(searchMode === "barcode"\) showStart\(\{ keepMiss: true \}\);\s*else barcodeGate\.current\.drop\(\);/);
  assert.match(page, /<Segmented<LogMode> label="Log by" block value=\{logMode\} onChange=\{changeLogMode\}/);
  assert.match(page, /onClick=\{searchByName\}>Search by name<\/button>/);
  assert.match(between("function searchByName(", "useEffect("), /changeLogMode\("search"\);/, "Search by name goes the same way as the Search tab");
  assert.match(page, /id="log-add-food" onClick=\{\(\) => \{ hideLog\("log-add-food"\); setFoodForm\(\{ editing: null, prefill: barcodeMiss \? \{ barcode: barcodeMiss\.code/, "Add your own food starts with it");
  // What the Search view then lists: the browse list (Frequent and Recent above it), not the lookup's empty answer.
  const browse = { foods: [{ id: "idli" }, { id: "rice" }] as FoodResult[], sources: [] };
  assert.deepEqual(listedFoods({ searchMode: "barcode", results: [] }, browse), [], "before: no foods at all, only the chips");
  assert.deepEqual(listedFoods(startView(), browse).map((food) => food.id), ["idli", "rice"]);
});
