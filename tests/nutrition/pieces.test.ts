import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { localFoodsFrom } from "@/lib/food/catalog-search";
import { amountMode, countMode, isCountableName, isPiecePortion, noPieceReason, pieceSizeLabel, pieceSource } from "@/lib/food/pieces";
import type { FoodPortion } from "@/lib/domain/food-query";

const read = (file: string) => JSON.parse(readFileSync(new URL(`../../src/data/${file}`, import.meta.url), "utf8"));
const LOCAL_FOODS = localFoodsFrom(read("fitx-staples.json"), read("usda-foundation-foods.json")).all;

function local(name: RegExp) {
  const food = LOCAL_FOODS.find((item) => name.test(item.name));
  assert.ok(food, `${name} should be in the built-in food list`);
  return food;
}

test("idli counts by the piece with USDA's 38 g item, and nothing else is invented", () => {
  const idli = local(/^Idli$/);
  const mode = countMode(idli, idli.portions);
  assert.equal(mode.kind, "pieces");
  if (mode.kind !== "pieces") return;
  assert.deepEqual(mode.indices.map((index) => idli.portions[index].grams), [38]);
  assert.equal(idli.portions[mode.preferred].grams, 38);
  assert.equal(pieceSizeLabel(idli.portions[mode.preferred]), "1 piece · 38 g");
});

test("dosa and chapati offer each USDA size and start on the medium one", () => {
  for (const pattern of [/^Dosa, plain$/, /^Bread, chappatti or roti$/]) {
    const food = local(pattern);
    const mode = countMode(food, food.portions);
    assert.equal(mode.kind, "pieces", food.name);
    if (mode.kind !== "pieces") continue;
    assert.equal(mode.indices.length, 3, food.name);
    assert.match(food.portions[mode.preferred].label, /medium/i, food.name);
    assert.deepEqual(mode.indices.map((index) => pieceSizeLabel(food.portions[index]).split(" · ")[0]), ["Small", "Medium", "Large"]);
  }
});

test("a raw egg's sizes come from USDA, from small to jumbo", () => {
  const egg = local(/^Egg, whole, raw, fresh$/);
  const mode = countMode(egg, egg.portions);
  assert.equal(mode.kind, "pieces");
  if (mode.kind !== "pieces") return;
  assert.deepEqual(mode.indices.map((index) => egg.portions[index].grams), [38, 44, 50, 56, 63]);
});

test("a banana with no sourced piece weight is grams only, with the reason", () => {
  const banana = local(/^Bananas, ripe/);
  assert.equal(banana.portions.filter(isPiecePortion).length, 0, "the Foundation snapshot has no banana piece weight");
  const mode = countMode(banana, banana.portions);
  assert.deepEqual(mode, { kind: "grams-only", reason: noPieceReason(banana) });
  if (mode.kind === "grams-only") assert.match(mode.reason, /^Grams only/);
});

test("foods people don't count say nothing", () => {
  const rice = local(/^Rice, white, cooked/);
  assert.deepEqual(countMode(rice, rice.portions), { kind: "none" });
  assert.equal(isCountableName("Dal"), false);
  assert.equal(isCountableName("Masala dosa"), true);
  assert.equal(isCountableName("Eggplant, raw"), false, "egg must match a whole word");
});

test("containers are never a piece", () => {
  const curd: FoodPortion[] = [{ label: "1 6 oz container", unit: "piece", grams: 170 }, { label: "1 cup", unit: "cup", grams: 245 }];
  assert.equal(isPiecePortion(curd[0]), false);
  assert.equal(countMode({ name: "Yogurt, plain" }, curd).kind, "none");
  // A pack is still a measure the member can log, so the line says so instead of "Grams only" (fix round 3a).
  assert.equal(countMode({ name: "Cookies, plain" }, [{ label: "1 pack", unit: "piece", grams: 120 }]).kind, "no-pieces");
});

test("the reason and the source name where the weight comes from", () => {
  assert.match(noPieceReason({ kind: "custom" }), /your food/);
  assert.match(noPieceReason({ source: "Open Food Facts" }), /label/);
  assert.equal(pieceSource({ label: "1 item", grams: 38 }, { source: "USDA FoodData Central" }), "USDA average for 1 item: 38 g");
  assert.equal(pieceSource({ label: "1 biscuit", grams: 12, estimate: false }, { source: "Open Food Facts" }), "Package label: 12 g each");
  assert.equal(pieceSource({ label: "1 serving", grams: 180 }, { kind: "custom" }), "Your saved serving: 180 g");
});

test("the entry mode follows the chosen unit", () => {
  const options: FoodPortion[] = [{ label: "1 item", unit: "piece", grams: 38 }, { label: "1 cup", unit: "cup", grams: 120 }];
  const mode = countMode({ name: "Idli" }, options);
  assert.equal(amountMode("g", mode), "grams");
  assert.equal(amountMode("portion:0", mode), "pieces");
  assert.equal(amountMode("portion:1", mode), "other");
  assert.equal(amountMode("portion:0", { kind: "none" }), "other");
});
