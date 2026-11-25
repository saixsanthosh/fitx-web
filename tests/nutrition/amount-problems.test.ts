// Bug 31 (nutrition-12): "0 idli" searched for a food called "0 idli" (no exact match, close spellings) and "-2 idli"
// quietly became 2 idlis. An amount of 0 or below is now recognised: it is not part of the food's name, it is never
// used, and the member is told why and asked how much they had.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { amountProblemMessage, parseFoodQuery, resolvePortion } from "@/lib/domain/food-query";
import { localFoodsFrom, rankAndPick } from "@/lib/food/catalog-search";
import { searchOutcome } from "@/lib/food/search-outcome";

const read = (file: string) => JSON.parse(readFileSync(new URL(`../../src/data/${file}`, import.meta.url), "utf8"));
const local = localFoodsFrom(read("fitx-staples.json"), read("usda-foundation-foods.json"));
const NO_FILTER = { nonVeg: false, egg: false };

test("0 and negative amounts are flagged, left out of the food's name and never used", () => {
  for (const [typed, problem] of [["0 idli", "zero"], ["0 g rice", "zero"], ["0.0 roti", "zero"], ["-2 idli", "negative"], ["−2 idli", "negative"], ["idli -2", "negative"], ["-0.5 cup dal", "negative"]] as const) {
    const parsed = parseFoodQuery(typed);
    assert.equal(parsed.problem, problem, typed);
    assert.equal(parsed.amount, null, `${typed}: the amount is not used`);
    assert.equal(parsed.unit, null, typed);
    assert.ok(!parsed.words.some((word) => /\d/.test(word)), `${typed}: no number is searched for (${parsed.words.join(" ")})`);
  }
  assert.deepEqual(parseFoodQuery("-2 idli").words, ["idli"]);
  assert.deepEqual(parseFoodQuery("0 g rice").words, ["rice"]);
  assert.equal(resolvePortion(parseFoodQuery("-2 idli")).kind, "none", "no grams are worked out from it");
});

test("ordinary amounts and names with numbers are unchanged", () => {
  assert.deepEqual(parseFoodQuery("2 idli"), { text: "idli", words: ["idli"], amount: 2, unit: null, size: null });
  assert.equal(parseFoodQuery("0.5 roti").amount, 0.5);
  assert.equal(parseFoodQuery("half cup rice").amount, 0.5);
  assert.equal(parseFoodQuery("0% fat yogurt").problem, undefined, "0% is part of the name");
  assert.equal(parseFoodQuery("coke zero").problem, undefined, "the word zero is part of a name");
  assert.equal(parseFoodQuery("7up").amount, null);
  assert.equal(parseFoodQuery("x-ray fish").problem, undefined);
});

test("the search lists Idli with a plain reason, and never selects it at 2", () => {
  const words = parseFoodQuery("-2 idli").words;
  const ranked = rankAndPick(local.all, [], words);
  const idli = ranked.foods.find((food) => food.id === "2708346");
  assert.ok(idli && !idli.suggestion, "Idli is an exact match, not a close spelling");
  for (const typed of ["0 idli", "-2 idli"]) {
    const outcome = searchOutcome(parseFoodQuery(typed), ranked.foods, ranked.pick ? { source: ranked.pick.source, id: ranked.pick.id } : null, NO_FILTER);
    assert.equal(outcome.kind, "choose", typed);
    assert.equal(outcome.kind === "choose" && outcome.hint, amountProblemMessage(parseFoodQuery(typed).problem ?? "zero", true));
  }
  assert.equal(amountProblemMessage("zero", true), "An amount of 0 can't be logged. Tap the food you mean, then enter how much you had.");
  assert.equal(amountProblemMessage("negative", false), "An amount below 0 can't be logged. Enter how much you had.");
  const fine = searchOutcome(parseFoodQuery("2 idli"), ranked.foods, { source: idli.source, id: idli.id }, NO_FILTER);
  assert.equal(fine.kind === "pick" && fine.food.id, "2708346", "2 idli still selects Idli");
});
