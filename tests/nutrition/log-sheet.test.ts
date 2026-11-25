// Bug 54 (nutrition-8) in the Log food sheet: "Enter an amount…" stayed after a valid amount.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { amountProblem } from "@/lib/food/log-sheet";

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
