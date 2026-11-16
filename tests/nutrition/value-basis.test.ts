import { test } from "node:test";
import assert from "node:assert/strict";
import { basisForDataType, basisInfo, customValueBasis, VALUE_BASIS } from "@/lib/food/value-basis";

test("USDA data types map to how their values were obtained", () => {
  assert.equal(basisForDataType("Foundation"), "lab_analysed");
  assert.equal(basisForDataType("SR Legacy"), "compiled");
  assert.equal(basisForDataType("Survey (FNDDS)"), "recipe_calculated");
  assert.equal(basisForDataType("Branded"), "label");
  assert.equal(basisForDataType(null), "estimated");
});

test("typical recipes and AI suggestions are estimates; lab values, labels and your entries are not", () => {
  const estimates = Object.entries(VALUE_BASIS).filter(([, info]) => info.estimate).map(([basis]) => basis).sort();
  assert.deepEqual(estimates, ["ai_suggested", "estimated", "recipe_calculated"]);
  assert.equal(basisInfo("label").label, "Package label");
  assert.equal(basisInfo("nonsense").label, "Estimate", "an unknown basis is shown as an estimate");
});

test("a food the AI coach saved is never labelled as the user's own entry", () => {
  assert.equal(customValueBasis("ai_coach", "user_entered"), "ai_suggested", "the column default on a coach row");
  assert.equal(customValueBasis("ai_coach", null), "ai_suggested");
  assert.equal(customValueBasis("ai_coach", "recipe_calculated"), "recipe_calculated", "a basis the coach wrote is kept");
  assert.equal(customValueBasis("user", null), "user_entered");
  assert.equal(customValueBasis("barcode", "label"), "label");
  assert.equal(customValueBasis("user", "made_up"), "user_entered");
});
