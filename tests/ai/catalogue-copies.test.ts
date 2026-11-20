import "./support/hooks.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { buildCatalogue, withCatalogueRows } = await import("@/lib/ai/food-catalogue");
const { groundFood, isConflict } = await import("@/lib/ai/grounding");
const { parseFood } = await import("@/lib/ai/plans");
const { catalogueRowToFood } = await import("@/lib/food/catalogue-copies");

const read = (file: string) => JSON.parse(readFileSync(new URL(`../../src/data/${file}`, import.meta.url), "utf8"));
const bundled = buildCatalogue(read("fitx-staples.json"), read("usda-foundation-foods.json"));

/** The seeded catalogue as members see it: every bundled food, `hidden` ones left out, `edited` ones changed. */
function copies(hidden: string[], edited: Record<string, Record<string, unknown>>) {
  return new Map(bundled.filter((food) => !hidden.includes(food.id)).map((food) => [food.id, catalogueRowToFood({
    id: food.id, name: food.name, aliases: food.aliases ?? [], keywords: [], state: food.state, kcal: food.calories, protein_g: food.protein,
    carbs_g: food.carbs, fat_g: food.fat, source_data_type: food.dataType,
    food_portions: food.portions.map((portion, index) => ({ label: portion.label, unit: portion.unit, grams: portion.grams, is_default: Boolean(portion.countDefault), is_estimate: true, sort_order: index })),
    ...edited[food.id],
  })]));
}

const ask = (search: string) => {
  const parsed = parseFood({ name: search, search, quantity: 100, unit: "g", grams: 100, calories: 150, protein: 4, carbs: 30, fat: 1, cost: "low" });
  assert.ok(parsed);
  return parsed;
};
const open = { diet: [], allergies: { rules: [], other: [] } };

test("the coach grounds foods on the catalogue's current values and never on a food Admin hid", async () => {
  const current = withCatalogueRows(bundled, copies(["2708408"], { "2708346": { kcal: 140 } }));
  assert.equal(current.some((food) => food.id === "2708408"), false, "hidden rice is left out");
  assert.equal(current.length, bundled.length - 1);
  assert.equal(current.find((food) => food.id === "2708346")?.calories, 140, "the corrected idli");

  const idli = await groundFood(ask("idli"), { ...open, catalogue: current });
  assert.ok(!isConflict(idli));
  assert.equal(idli.sourceRef, "2708346");
  assert.equal(idli.per100.calories, 140);

  const rice = await groundFood(ask("rice"), { ...open, catalogue: current });
  assert.ok(!isConflict(rice));
  assert.notEqual(rice.sourceRef, "2708408");
});
