// Review round, finding N9 (bug 57's fix): "Try again" kept the focus only when the new answer offered Try again too.
// When Open Food Facts answered the retry with "unknown" or "no label", the button went and focus fell to the page; a
// network error took the whole answer away. The focus now moves to the answer's Create a food, or to the barcode box.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { barcodeMissFor, focusAfterRetry } from "@/lib/food/log-sheet";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const CODE = "8901063010031";

test("after Try again the focus stays only where the button still is", () => {
  assert.equal(focusAfterRetry({ found: false, miss: barcodeMissFor("unavailable", CODE, null) }), null, "still not checked: Try again stays, with the focus");
  assert.equal(focusAfterRetry({ found: false, miss: barcodeMissFor("timeout", CODE, null) }), null);
  assert.equal(focusAfterRetry({ found: false, miss: barcodeMissFor("rate_limited", CODE, null) }), null);
  assert.equal(focusAfterRetry({ found: false, miss: barcodeMissFor("not_found", CODE, null) }), "log-barcode-create", "unknown: no Try again, so Create a food");
  assert.equal(focusAfterRetry({ found: false, miss: barcodeMissFor("no_label", CODE, "Parle-G") }), "log-barcode-create");
  assert.equal(focusAfterRetry({ found: false, miss: null }), "barcode-number", "an error: no answer is shown, so the barcode box");
  assert.equal(focusAfterRetry({ found: true, miss: null }), null, "found: the amount takes the focus, as before");
});

test("the page moves the focus only after Try again, and only when it fell to the page", () => {
  const page = read("src/app/(dashboard)/nutrition/page.tsx");
  const lookup = page.slice(page.indexOf("const lookupBarcode = useCallback("), page.indexOf("const onBarcodeDetected"));
  assert.match(lookup, /async \(value: string, \{ retry = false \}: \{ retry\?: boolean \} = \{\}\) =>/);
  assert.match(lookup, /if \(!retry \|\| !target\) return;/);
  assert.match(lookup, /if \(document\.activeElement && document\.activeElement !== document\.body\) return;/);
  assert.equal((lookup.match(/refocus\(focusAfterRetry\(/g) ?? []).length, 3, "a miss, a wrong number and an error");
  assert.match(page, /void lookupBarcode\(barcodeMiss\.code, \{ retry: true \}\); \}\}>\{busy \? "Checking…" : "Try again"\}<\/button>/);
  for (const id of ["log-barcode-create", "barcode-number"]) assert.match(page, new RegExp(`id="${id}"`), id);
});
