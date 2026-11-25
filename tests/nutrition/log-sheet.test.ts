// Bugs 54 to 57 in the Log food sheet. 54 (nutrition-8): "Enter an amount…" stayed after a valid amount. 55
// (nutrition-9): reopening Log food after a barcode lookup showed the old result, not the start view. 56
// (nutrition-15): a search with no food name ("???", "...") left the previous search's message and counts. 57
// (nutrition-10): a barcode Open Food Facts couldn't check said "add the product yourself" with no way to do it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseFoodQuery } from "@/lib/domain/food-query";
import { amountProblem, barcodeMissFor, barcodeMissText, listedFoods, noSearchReason, startView } from "@/lib/food/log-sheet";
import type { FoodResult } from "@/lib/food/types";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("54: the amount's problem lasts only while the amount is wrong, and shows next to it", () => {
  for (const grams of [Number.NaN, 0, 0.5, 5000.1]) assert.equal(amountProblem(grams), "Enter an amount that comes to between 1 and 5,000 grams.", String(grams));
  for (const grams of [1, 150, 5000]) assert.equal(amountProblem(grams), null, String(grams));
  const page = read("src/app/(dashboard)/nutrition/page.tsx");
  const logFood = page.slice(page.indexOf("async function logFood("), page.indexOf("async function undoAdded("));
  assert.match(logFood, /setAmountTried\(true\)/);
  assert.doesNotMatch(logFood, /setError\("Enter an amount/, "not the sheet's own message area, which nothing cleared");
  assert.match(page, /amountProblem=\{amountTried \? amountProblem\(grams\) : null\}/, "worked out from the amount as it is now");
  assert.match(page, /aria-label="Back to results"/);
  assert.match(page, /setAmountTried\(false\); setNotice\(""\); \}\} className=\{styles\.back\}/, "Back to results takes it away");
  const picker = read("src/components/nutrition/PortionPicker.tsx");
  assert.match(picker, /aria-invalid=\{amountProblem \? true : undefined\}/);
  assert.match(picker, /\{amountProblem && <p id=\{problemId\} role="alert"/);
});

const food = (id: string) => ({ id, name: id }) as unknown as FoodResult;

test("55, 56: the start view keeps nothing of an earlier search or lookup", () => {
  const view = startView();
  assert.deepEqual(view, { results: [], sources: [], searchMode: "browse", lastSearch: "", lastQuery: parseFoodQuery("") });
  const browse = { foods: [food("idli"), food("rice")], sources: [] };
  assert.deepEqual(listedFoods(view, browse).map((item) => item.id), ["idli", "rice"]);
  assert.deepEqual(listedFoods({ searchMode: "barcode", results: [food("digestive")] }, browse).map((item) => item.id), ["digestive"]);
  assert.deepEqual(listedFoods(view, null), [], "before the browse list arrives");
  const page = read("src/app/(dashboard)/nutrition/page.tsx");
  const closeLog = page.slice(page.indexOf("function closeLog("), page.indexOf("function hideLog("));
  assert.match(closeLog, /showStart\(\);\s*setQuery\(""\); setBarcode\(""\);/, "closing Log food goes back to the start view and an empty box");
  const search = page.slice(page.indexOf("async function runFoodSearch("), page.indexOf("async function searchFoods("));
  assert.match(search, /if \(typed\.text\.length < 2\) \{[^}]*showStart\(\);/, "a search with no food name shows the start view");
});

test("56: text with no food name says what to type, never an old message", () => {
  assert.equal(noSearchReason(parseFoodQuery(""), ""), null);
  assert.equal(noSearchReason(parseFoodQuery("2 plates poha"), "2 plates poha"), null);
  for (const text of ["???", "...", "%", "<b>x</b>"]) {
    const reason = noSearchReason(parseFoodQuery(text), text);
    assert.equal(reason?.kind, "notice", text);
  }
  assert.deepEqual(noSearchReason(parseFoodQuery("150 g"), "150 g"), { kind: "error", message: "Add a food name after the amount, for example “150 g rice”." });
  assert.equal(noSearchReason(parseFoodQuery("-2"), "-2")?.kind, "error");
});

test("57: every barcode that found nothing offers Create a food with it; one not checked also offers Try again", () => {
  assert.equal(barcodeMissFor("found", "5000159484695", null), null);
  assert.equal(barcodeMissFor("invalid", "123", null), null, "a wrong number is a typing error, said as such");
  assert.deepEqual(barcodeMissFor("not_found", "8901063010031", null), { code: "8901063010031", name: null, kind: "not_found" });
  assert.equal(barcodeMissFor("no_label", "8901063010031", "Parle-G")?.kind, "no_label");
  assert.equal(barcodeMissFor("rate_limited", "8901063010031", null)?.kind, "busy");
  assert.equal(barcodeMissFor("timeout", "8901063010031", null)?.kind, "unavailable");
  assert.equal(barcodeMissFor("unavailable", "8901063010031", null)?.kind, "unavailable");
  const offline = barcodeMissText({ code: "8901063010031", name: null, kind: "unavailable" });
  assert.match(offline.text, /didn't answer, so 8901063010031 couldn't be checked\. Try again shortly, or add the product yourself\./);
  assert.deepEqual([offline.retry, offline.addToOpenFoodFacts], [true, false]);
  const busy = barcodeMissText({ code: "8901063010031", name: null, kind: "busy" });
  assert.match(busy.text, /busy right now/);
  assert.equal(busy.retry, true);
  const unknown = barcodeMissText({ code: "8901063010031", name: null, kind: "not_found" });
  assert.equal(unknown.text, "No product with barcode 8901063010031 on Open Food Facts. Nothing was guessed.");
  assert.deepEqual([unknown.retry, unknown.addToOpenFoodFacts], [false, true]);
  assert.match(barcodeMissText({ code: "1", name: "Parle-G", kind: "no_label" }).text, /knows 1 \(“Parle-G”\) but has no nutrition label/);
  const page = read("src/app/(dashboard)/nutrition/page.tsx");
  const callout = page.slice(page.indexOf("{barcodeMiss && (() => {"), page.indexOf("})()}"));
  assert.match(callout, /id="log-barcode-create"/, "Create a food, for every miss");
  assert.match(callout, /prefill: \{ barcode: barcodeMiss\.code/, "with the barcode filled in");
  assert.match(callout, /said\.retry && <button/);
  assert.doesNotMatch(page, /setError\("Open Food Facts didn't answer, so the barcode/, "no dead-end message");
});
