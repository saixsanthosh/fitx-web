import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../src/components/nutrition/FoodUi.module.css", import.meta.url), "utf8");

test("Nutrition's quiet text buttons (Add a meal, Copy yesterday, Save today as a routine…) are full 44 px touch targets", () => {
  const rule = css.match(/^\.textButton \{([^}]*)\}/m)?.[1] ?? "";
  const height = rule.match(/min-height:\s*([\d.]+)rem/)?.[1];
  assert.ok(height, "the text button sets a minimum height");
  assert.ok(Number(height) * 16 >= 44, `at least 44 px tall (${height}rem)`);
});
