import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dietFilterFor, dietTypeOf, hiddenByDiet, stapleDietType, strongerDiet } from "@/lib/food/diet";
import { localFoodsFrom } from "@/lib/food/catalog-search";

const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);
const read = (file: string) => JSON.parse(readFileSync(new URL(`../../src/data/${file}`, import.meta.url), "utf8"));
type SeedRow = { id: string; n: string; c?: string; d?: string };
/** Every food in the catalogue seed parts, as the importer wrote them. */
const seed: SeedRow[] = readdirSync(MIGRATIONS).filter((name) => /_fitx_food_catalog_seed_part_\d+\.sql$/.test(name)).sort().flatMap((name) => {
  const sql = readFileSync(new URL(name, MIGRATIONS), "utf8");
  return JSON.parse(sql.slice(sql.indexOf("$fitx$[") + "$fitx$".length, sql.indexOf("]$fitx$") + 1)) as SeedRow[];
});

test("burgers and hot dogs are non-veg, though their names name no meat", () => {
  assert.equal(dietTypeOf("Hamburger (McDonalds)", [], "Burgers"), "non_veg");
  assert.equal(dietTypeOf("Hamburger, NFS", [], "Burgers"), "non_veg");
  assert.equal(dietTypeOf("Big Mac (McDonalds)", ["Fast foods, cheeseburger; double, regular patty; double decker bun with condiments and special sauce"], "Burgers"), "non_veg");
  assert.equal(dietTypeOf("Whopper (Burger King)", ["Fast foods, hamburger; single, large patty; with condiments, vegetables and mayonnaise"], "Burgers"), "non_veg",
    "a beef burger with mayonnaise is non-veg, not \"Contains egg\"");
  assert.equal(dietTypeOf("Corn dog", ["Corn dogs, frozen, prepared"], "Frankfurter sandwiches"), "non_veg");
  assert.equal(dietTypeOf("Pig in a blanket", ["Hot dog, NFS", "Rolls, dinner, plain, commercially prepared (includes brown-and-serve)"], "Frankfurter sandwiches"), "non_veg");
  assert.equal(dietTypeOf("Rice bowl", ["Hot dog, NFS"], null), "non_veg", "an ingredient that is a hot dog");
});

test("a bun, a veggie burger or a food that says it is meatless is not non-veg", () => {
  assert.equal(dietTypeOf("Cheese sandwich, on bun", ["Rolls, hamburger or hotdog, plain", "Cheese, cheddar"], null), null, "a hamburger bun is bread");
  assert.equal(dietTypeOf("Roll, hamburger or hot dog, whole wheat", [], null), null);
  assert.equal(dietTypeOf("Veggie burger, on bun", ["Rolls, hamburger or hotdog, plain"], "Burgers"), null);
  assert.equal(dietTypeOf("Black bean burger", [], "Burgers"), null);
  assert.equal(dietTypeOf("Soy burger", [], "Burgers"), null);
  assert.equal(dietTypeOf("Hot dog sandwich, vegetarian, on bun", ["Rolls, hamburger or hotdog, plain", "Frankfurter, meatless"], "Frankfurter sandwiches"), null);
  assert.equal(dietTypeOf("Cheese, Limburger", ["Cheese, limburger"], "Cheese"), null, "Limburger is cheese");
  assert.equal(dietTypeOf("French fries (Burger King)", [], "French fries"), null, "a Burger King side is not a burger");
});

test("meat named next to a vegetable or tofu stays non-veg, and imitation crab is fish", () => {
  assert.equal(dietTypeOf("Beef, tofu, and vegetables, soy-based sauce", [], "Stir-fry and soy-based sauce mixtures"), "non_veg");
  assert.equal(dietTypeOf("Fish, tofu, and vegetables, tempura", [], "Seafood mixed dishes"), "non_veg");
  assert.equal(dietTypeOf("Imitation crab meat", ["Surimi"], "Fish"), "non_veg");
  assert.equal(dietTypeOf("Frankfurters or hot dogs and sauerkraut", [], "Meat mixed dishes"), "non_veg");
});

test("every burger and hot dog in the seed is non-veg unless it says it is meatless", () => {
  const dishes = seed.filter((row) => /^(burgers|frankfurter sandwiches|frankfurters)$/i.test(row.c ?? ""));
  assert.ok(dishes.length > 50, `${dishes.length} rows`);
  for (const row of dishes) {
    if (/vegetarian|veggie|meatless|vegan|soy|bean/i.test(row.n)) assert.notEqual(row.d, "non_veg", row.n);
    else assert.equal(row.d, "non_veg", row.n);
  }
});

test("the built-in list labels foods exactly as the catalogue seed does", () => {
  const local = localFoodsFrom(read("fitx-staples.json"), read("usda-foundation-foods.json"));
  const byId = new Map(seed.map((row) => [row.id, row]));
  const compared = local.all.filter((food) => byId.has(food.id));
  assert.ok(compared.length >= 200, `${compared.length} foods compared`);
  for (const food of compared) assert.equal(food.dietType, byId.get(food.id)?.d ?? null, food.name);
  const name = (id: string) => local.all.find((food) => food.id === id);
  assert.equal(name("2708346")?.dietType, "vegan", "idli, checked by hand");
  assert.equal(local.all.find((food) => food.name === "Biryani with chicken")?.dietType, "non_veg");
  assert.equal(local.all.find((food) => food.name === "Biryani with meat")?.dietType, "non_veg");
  assert.equal(local.all.find((food) => /^Chicken, breast/.test(food.name))?.dietType, "non_veg", "Foundation foods are labelled from their names");
  assert.equal(stapleDietType("2707713", "Chapati or roti, plain, commercially prepared", []), "veg");
});

test("a saved label is never weakened, only made more cautious", () => {
  assert.equal(strongerDiet(null, "non_veg"), "non_veg");
  assert.equal(strongerDiet("egg", "non_veg"), "non_veg");
  assert.equal(strongerDiet("non_veg", null), "non_veg");
  assert.equal(strongerDiet("vegan", null), "vegan", "no label never overrides one");
  assert.equal(strongerDiet("veg", "vegan"), "veg");
});

test("the diet filter starts from the user's diet and hides only labelled foods", () => {
  assert.deepEqual(dietFilterFor(["Vegetarian"]), { nonVeg: true, egg: true }, "FITX's vegetarian means no meat, fish or eggs");
  assert.deepEqual(dietFilterFor(["Vegan", "Halal"]), { nonVeg: true, egg: true });
  assert.deepEqual(dietFilterFor(["Eggetarian"]), { nonVeg: true, egg: false });
  assert.deepEqual(dietFilterFor(["Non-vegetarian"]), { nonVeg: false, egg: false });
  assert.deepEqual(dietFilterFor(["Both"]), { nonVeg: false, egg: false });
  assert.deepEqual(dietFilterFor(null), { nonVeg: false, egg: false });
  const vegetarian = dietFilterFor(["Vegetarian"]);
  assert.equal(hiddenByDiet("non_veg", vegetarian), true);
  assert.equal(hiddenByDiet("egg", vegetarian), true);
  assert.equal(hiddenByDiet(null, vegetarian), false, "a food FITX could not check is shown, marked as not checked");
  assert.equal(hiddenByDiet("egg", dietFilterFor(["Eggetarian"])), false);
});
