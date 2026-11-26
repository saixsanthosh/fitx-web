// Fix round 3c, the browser re-check's side note on bug 57 (nutrition-b): when the network really failed, Log food
// showed the browser's own "Failed to fetch" (Barcode > Find or Try again; the same code in food search and in the list
// of common foods, which put it at the top of the page). Every request to the food search now goes through
// askFoodSearch: a request that never reached FITX asks the member to check their connection, an answer that isn't
// FITX's (an error page, a reply cut off) says it couldn't be done just now, and FITX's own refusals are said as they
// are. The common foods' failure is said where the list would be, with Try again. The same mistake in the food form's
// photo: a photo the browser can't open showed the browser's words, and a save that failed said "not saved: not saved".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { askFoodSearch, unansweredText, unreachedText, type FoodRequest } from "@/lib/food/food-request";
import { FoodPhotoError, photoNotSavedText, photoRetryText } from "@/lib/food/food-photos";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const REQUESTS: FoodRequest[] = [{ kind: "search" }, { kind: "browse" }, { kind: "barcode", code: "8901063010031" }];
const RAW = /failed to fetch|load failed|networkerror|unexpected token|json|syntaxerror|typeerror/i;

const offline = async (): Promise<Response> => { throw new TypeError("Failed to fetch"); };
const answer = (body: string, status: number, type = "application/json") => async () => new Response(body, { status, headers: { "Content-Type": type } });

test("a request that never reached FITX asks the member to check their connection, never says \"Failed to fetch\"", async () => {
  for (const request of REQUESTS) {
    const said = await askFoodSearch("/api/foods/search?q=rice", request, undefined, offline);
    assert.deepEqual(said, { ok: false, message: unreachedText(request) }, request.kind);
    assert.doesNotMatch(unreachedText(request), RAW);
    assert.match(unreachedText(request), /^FITX couldn't be reached, so .+\. Check your connection and try again\.$/, request.kind);
  }
  assert.equal(unreachedText({ kind: "barcode", code: "8901063010031" }), "FITX couldn't be reached, so 8901063010031 couldn't be checked. Check your connection and try again.");
  assert.equal(unreachedText({ kind: "search" }), "FITX couldn't be reached, so the search didn't run. Check your connection and try again.");
  assert.equal(unreachedText({ kind: "browse" }), "FITX couldn't be reached, so the common foods didn't load. Check your connection and try again.");
  const safari = await askFoodSearch("/api/foods/search?browse=1", { kind: "browse" }, undefined, async () => { throw new TypeError("Load failed"); });
  assert.equal(safari.ok, false);
  assert.doesNotMatch(safari.ok ? "" : safari.message, RAW, "Safari's and Firefox's words too");
});

test("an answer that isn't FITX's says it couldn't be done just now; FITX's own refusal is said as it is", async () => {
  for (const request of REQUESTS) {
    const page = await askFoodSearch("/api/foods/search", request, undefined, answer("<!DOCTYPE html><title>502</title>", 502, "text/html"));
    assert.deepEqual(page, { ok: false, message: unansweredText(request) }, `${request.kind}: an error page`);
    const cut = await askFoodSearch("/api/foods/search", request, undefined, answer('{"foods": [', 200));
    assert.deepEqual(cut, { ok: false, message: unansweredText(request) }, `${request.kind}: a reply cut off`);
    const bare = await askFoodSearch("/api/foods/search", request, undefined, answer("{}", 500));
    assert.deepEqual(bare, { ok: false, message: unansweredText(request) }, `${request.kind}: no words of FITX's`);
    assert.doesNotMatch(unansweredText(request), RAW);
  }
  const busy = await askFoodSearch("/api/foods/search?q=rice", { kind: "search" }, undefined, answer(JSON.stringify({ error: "You’re searching quickly. Try again in 12 s." }), 429));
  assert.deepEqual(busy, { ok: false, message: "You’re searching quickly. Try again in 12 s." });
  const outage = await askFoodSearch("/api/foods/search?browse=1", { kind: "browse" }, undefined, answer(JSON.stringify({ error: "Your session couldn't be checked just now, so the search didn't run. Try again in a moment." }), 503));
  assert.equal(outage.ok ? "" : outage.message, "Your session couldn't be checked just now, so the search didn't run. Try again in a moment.");
  const found = await askFoodSearch("/api/foods/search?q=rice", { kind: "search" }, undefined, answer(JSON.stringify({ foods: [], sources: [], pick: null, mode: "catalog" }), 200));
  assert.deepEqual(found, { ok: true, data: { foods: [], sources: [], pick: null, mode: "catalog" } });
  const invalid = await askFoodSearch("/api/foods/search?barcode=123", { kind: "barcode", code: "123" }, undefined, answer(JSON.stringify({ foods: [], sources: [], pick: null, mode: "barcode", barcodeStatus: "invalid", error: "Check the number." }), 200));
  assert.equal(invalid.ok && invalid.data.barcodeStatus, "invalid", "a wrong number is FITX's answer, handled by the sheet as before");
});

test("the sheet asks only through askFoodSearch and shows only FITX's words", () => {
  const page = read("src/app/(dashboard)/nutrition/page.tsx");
  assert.doesNotMatch(page, /\bfetch\(/, "no request of the page's own");
  assert.equal((page.match(/await askFoodSearch\(/g) ?? []).length, 3, "the barcode, the common foods and a search");
  assert.doesNotMatch(page, /cause instanceof Error \? cause\.message/, "never an error's own message");
  assert.doesNotMatch(page, /Barcode lookup failed\.|Food search failed\.|Food search is temporarily unavailable\./);
  const lookup = page.slice(page.indexOf("const lookupBarcode = useCallback("), page.indexOf("const onBarcodeDetected"));
  assert.match(lookup, /\{ kind: "barcode", code: checked\.code \}/);
  assert.match(lookup, /if \(!answer\.ok\) \{ failed\(answer\.message\); return; \}/);
  assert.match(lookup, /setBarcodeMiss\(null\); setError\(message\);\s*refocus\(focusAfterRetry\(\{ found: false, miss: null \}\)\);/, "after Try again the focus still goes to the barcode box (review N9)");
  const search = page.slice(page.indexOf("async function runFoodSearch("), page.indexOf("async function searchFoods("));
  assert.match(search, /if \(!answer\.ok\) \{ setError\(answer\.message\); return; \}/);
  assert.match(search, /catch \{ if \(current\(\)\) setError\(unansweredText\(\{ kind: "search" \}\)\); \}/);
  const browse = page.slice(page.indexOf("const browseFoods = useCallback("), page.indexOf("function retryLoad("));
  assert.match(browse, /if \(!answer\.ok\) \{ failed\(answer\.message\); return; \}/);
  assert.match(browse, /setBrowseProblem\(null\);/);
});

test("the common foods' failure is said where the list would be, with a Try again that keeps the focus", () => {
  const page = read("src/app/(dashboard)/nutrition/page.tsx");
  const list = page.slice(page.indexOf("const foodList = ("), page.indexOf("return (\n    <div className={styles.page}>"));
  const callout = list.slice(list.indexOf("{showBrowse && !browse && browseProblem &&"), list.indexOf("{searchingFoods ?"));
  assert.ok(callout.length > 0, "before the list's loading line, so it stays while Try again asks");
  assert.match(callout, /<p key=\{browseProblem\.attempt\}>\{browseProblem\.text\}<\/p>/, "a failure again is read out again (the list is a live region)");
  assert.match(callout, /aria-disabled=\{searchingFoods \|\| undefined\} onClick=\{\(\) => \{ if \(!searchingFoods\) void browseFoods\(\); \}\}>Try again<\/button>/);
  assert.match(list, /\{showBrowse && browse && <p className=\{styles\.listLabel\}>Common foods<\/p>\}/, "no \"Common foods\" label over nothing");
  const effect = page.slice(page.indexOf("useEffect(() => {\n    if (!logOpen || !focusFellToPage("), page.indexOf("useEffect(() => {\n    const targets = reloadFocusTargets("));
  assert.match(effect, /searchingFoods\]\);/, "once the list is in, the button goes and the search box takes the focus (back-to-results-focus.test.ts)");
});

test("a photo that wasn't saved says why in FITX's words", () => {
  assert.equal(photoNotSavedText(new FoodPhotoError("Choose a JPEG, PNG or WebP photo.")), "The photo was not saved. Choose a JPEG, PNG or WebP photo.");
  assert.equal(photoNotSavedText(new FoodPhotoError(photoRetryText(true))), "The photo was not saved. Check your connection and try again.");
  assert.equal(photoNotSavedText(new FoodPhotoError(photoRetryText(false))), "The photo was not saved. Please try again.");
  assert.equal(photoNotSavedText(new TypeError("Failed to fetch")), "The photo was not saved. Please try again.", "a browser's own error is never shown");
  assert.equal(photoNotSavedText(new Error("The source image could not be decoded.")), "The photo was not saved. Please try again.");
  const photos = read("src/lib/food/food-photos.ts");
  assert.doesNotMatch(photos, /throw new Error\(/, "every failure it names is a FoodPhotoError");
  assert.match(photos, /createImageBitmap\(file\)\.catch\(\(\) => \{ throw new FoodPhotoError\("This browser couldn't open that photo\. Choose a JPEG, PNG or WebP photo\."\); \}\)/);
  assert.match(photos, /if \(uploaded\.error\) throw new FoodPhotoError\(photoRetryText\(uploaded\.error\.name === "StorageUnknownError"\)\);/);
  const page = read("src/app/(dashboard)/nutrition/page.tsx");
  const save = page.slice(page.indexOf("async function saveFood("), page.indexOf("async function removeFood("));
  assert.doesNotMatch(save, /new Error\("not saved"\)/, "it said \"The photo was not saved: not saved\"");
  // The food is pointed at its photo in replaceCustomFoodPhoto now (food-photo-order.test.ts tries each failure).
  const data = read("src/lib/food/client-data.ts");
  const replace = data.slice(data.indexOf("export async function replaceCustomFoodPhoto("), data.indexOf("async function removePhotoFile("));
  assert.match(replace, /throw new FoodPhotoError\(photoRetryText\(updated\.status === 0\)\);/);
  assert.match(save, /photoProblem = ` \$\{photoNotSavedText\(cause\)\}`;/);
});
