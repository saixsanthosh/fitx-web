// Bug 58 (nutrition-11): FITX recipe estimates were badged "Estimate · estimate" ("An estimate."), and the Sources
// page's key had no entry for them. A badge now names FITX's own recipes, never says "estimate" twice, and the key
// lists every badge a member can meet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { localFoodsFrom, RECIPE_SOURCE } from "@/lib/food/catalog-search";
import { basisBadge, FITX_RECIPE_SOURCE, VALUE_BASIS } from "@/lib/food/value-basis";
import type { ValueBasis } from "@/lib/food/types";

const read = (file: string) => JSON.parse(readFileSync(new URL(`../../src/data/${file}`, import.meta.url), "utf8"));

test("a FITX recipe estimate is badged as one, with what it means", () => {
  const curdRice = localFoodsFrom(read("fitx-staples.json"), read("usda-foundation-foods.json")).all.find((food) => food.id === "fitx-recipe-curd-rice");
  assert.ok(curdRice);
  assert.equal(curdRice.source, FITX_RECIPE_SOURCE);
  assert.equal(RECIPE_SOURCE, FITX_RECIPE_SOURCE);
  const badge = basisBadge(curdRice.valueBasis, curdRice.source);
  assert.equal(badge.text, "FITX recipe estimate");
  assert.equal(badge.estimate, true);
  assert.match(badge.detail, /from USDA values for the dish's ingredients/);
  assert.doesNotMatch(curdRice.basis, /FITX recipe estimate/, "the line under the name says how, without repeating the badge");
});

test("no badge says estimate twice, and other badges read as before", () => {
  for (const basis of Object.keys(VALUE_BASIS) as ValueBasis[]) {
    const { text } = basisBadge(basis);
    assert.doesNotMatch(text, /estimate.*estimate/i, `${basis}: ${text}`);
  }
  assert.equal(basisBadge("estimated").text, "Estimate");
  assert.notEqual(basisBadge("estimated").detail, "An estimate.", "the tooltip explains");
  assert.equal(basisBadge("recipe_calculated").text, "Typical recipe · estimate");
  assert.equal(basisBadge("lab_analysed").text, "USDA lab analysis");
  assert.equal(basisBadge("ai_suggested", null, "From the AI coach").text, "From the AI coach · estimate");
  assert.equal(basisBadge("recipe_calculated", "USDA FoodData Central").text, "Typical recipe · estimate", "only FITX's own source names a FITX recipe");
});

test("the Sources page's key lists the FITX recipe estimate and the plain estimate", () => {
  const page = readFileSync(new URL("../../src/app/(dashboard)/nutrition/sources/page.tsx", import.meta.url), "utf8");
  assert.match(page, /\{ basis: "estimated", source: FITX_RECIPE_SOURCE, detail: RECIPE_ESTIMATE\.detail \}/);
  assert.match(page, /\{ basis: "estimated", detail: VALUE_BASIS\.estimated\.detail \}/);
  for (const basis of Object.keys(VALUE_BASIS)) assert.match(page, new RegExp(`basis: "${basis}"`), `${basis} is in the key`);
});
