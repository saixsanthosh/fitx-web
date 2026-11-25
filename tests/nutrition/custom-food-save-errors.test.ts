// Bug 16 (nutrition-4): a refused save of your own food (a barcode another of your foods has, or any failure) put its
// message on the page behind the open food form, so Save seemed to do nothing. The save now answers the form, which
// shows the reason inside the dialog: a duplicate barcode next to the barcode field, marked invalid and focused.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { customFoodSaveProblem } from "@/lib/food/custom-food-form";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("each refusal maps to a message and the place it belongs", () => {
  assert.deepEqual(customFoodSaveProblem({ code: "23505" }), { field: "barcode", message: "One of your foods already has that barcode. Change it, or leave it blank." });
  assert.equal(customFoodSaveProblem({ code: "23502" }).field, null, "a blank value the database can't keep yet");
  assert.match(customFoodSaveProblem({ code: "23502" }).message, /left blank/);
  assert.deepEqual(customFoodSaveProblem({ code: "57014" }), { field: null, message: "Your food could not be saved. Please try again." });
  assert.deepEqual(customFoodSaveProblem(null), { field: null, message: "Your food could not be saved. Please try again." });
});

test("the page hands the refusal to the open form instead of its own message area", () => {
  const page = read("src/app/(dashboard)/nutrition/page.tsx");
  const saveFood = page.slice(page.indexOf("async function saveFood("), page.indexOf("async function removeFood("));
  assert.match(saveFood, /return customFoodSaveProblem\(saveError\);/);
  assert.doesNotMatch(saveFood, /already has that barcode/, "no page-level duplicate message behind the dialog");
  assert.match(page, /onSave=\{saveFood\}/);
});

test("the form shows a refused barcode at the barcode field, which is marked and described by it", () => {
  const form = read("src/components/nutrition/CustomFoodForm.tsx");
  assert.match(form, /aria-invalid=\{refused\?\.field === "barcode" \|\| undefined\}/);
  assert.match(form, /aria-describedby=\{refused\?\.field === "barcode" \? "custom-food-barcode-problem" : undefined\}/);
  assert.match(form, /<p id="custom-food-barcode-problem" role="alert"/);
  assert.match(form, /if \(answer\.field === "barcode"\) barcodeField\.current\?\.focus\(\);/);
  assert.match(form, /\{problem \|\| refused\?\.message\}/, "any other refusal next to Save");
});
