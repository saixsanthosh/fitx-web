import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { clearMatch, matchFoods, parseFoodQuery, singular } from "@/lib/domain/food-query";
import { localFoodsFrom, overlayFor, rankAndPick } from "@/lib/food/catalog-search";
import { recipeValues, type RecipeDef } from "@/lib/food/recipe";

const SRC = new URL("../../src/data/", import.meta.url);
const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);
const read = (file: string) => JSON.parse(readFileSync(new URL(file, SRC), "utf8"));
const staples = read("fitx-staples.json") as { foods: Array<{ id: string; calories: number; protein: number; carbs: number; fat: number }>; names: Record<string, unknown>; recipes: RecipeDef[] };
const foundation = read("usda-foundation-foods.json") as Array<{ id: string; name: string }>;
const local = localFoodsFrom(staples as never, foundation as never);

type SeedRow = { id: string; n: string; e: number; p: number; cb: number; f: number };
const seed = new Map<string, SeedRow>(readdirSync(MIGRATIONS).filter((name) => /_fitx_food_catalog_seed_part_\d+\.sql$/.test(name)).flatMap((name) => {
  const sql = readFileSync(new URL(name, MIGRATIONS), "utf8");
  return (JSON.parse(sql.slice(sql.indexOf("$fitx$[") + "$fitx$".length, sql.indexOf("]$fitx$") + 1)) as SeedRow[]).map((row): [string, SeedRow] => [row.id, row]);
}));

const search = (text: string) => {
  const words = parseFoodQuery(text).words;
  return rankAndPick(local.all, [], words);
};

test("every recipe ingredient is a USDA record already in FITX's data, with USDA's own values", () => {
  assert.ok(staples.recipes.length >= 8);
  for (const recipe of staples.recipes) {
    for (const item of recipe.ingredients) {
      if (item.fdcId === null) { assert.equal(item.name, "Water", `${recipe.id}: only water has no FDC id`); assert.deepEqual([item.calories, item.protein, item.carbs, item.fat], [0, 0, 0, 0]); continue; }
      const row = seed.get(item.fdcId);
      assert.ok(row, `${recipe.id}: ${item.name} (${item.fdcId}) is not in the catalogue seed`);
      assert.deepEqual([item.calories, item.protein, item.carbs, item.fat], [row.e, row.p, row.cb, row.f], `${recipe.id}: ${item.name} differs from USDA ${row.n}`);
      assert.ok(item.grams > 0 && item.grams <= 400, `${recipe.id}: ${item.name} grams`);
    }
  }
});

test("a recipe estimate adds its ingredients up, is labelled an estimate and has a recipe serving", () => {
  const curdRice = staples.recipes.find((recipe) => recipe.id === "fitx-recipe-curd-rice");
  assert.ok(curdRice);
  const values = recipeValues(curdRice);
  // 150 g rice (129 kcal, 2.67 P, 27.99 C, 0.28 F per 100 g) + 100 g yogurt (77.3, 3.82, 5.57, 4.48).
  assert.equal(values.servingGrams, 250);
  assert.equal(values.calories, Math.round(((150 * 129 + 100 * 77.3) / 250)));
  assert.equal(values.protein, Math.round(((150 * 2.67 + 100 * 3.82) / 250) * 10) / 10);
  assert.equal(values.portion.estimate, true);
  assert.match(values.summary, /150 g rice, white, cooked \+ 100 g plain whole-milk yogurt/);
  const food = local.all.find((item) => item.id === "fitx-recipe-curd-rice");
  assert.equal(food?.valueBasis, "estimated");
  assert.equal(food?.source, "FITX recipe estimate");
  assert.match(food?.recipeNote ?? "", /150 g rice/);
  assert.equal(food?.dietType, "veg");
  for (const recipe of staples.recipes) {
    const { calories, protein, carbs, fat } = recipeValues(recipe);
    assert.ok(Math.abs(4 * protein + 4 * carbs + 9 * fat - calories) <= Math.max(25, calories * 0.25), `${recipe.id}: energy and macros agree`);
    assert.ok(protein + carbs + fat <= 100, recipe.id);
  }
});

test("curd and dahi find plain yogurt, not cottage cheese", () => {
  for (const text of ["curd", "dahi", "200 g curd"]) {
    const result = search(text);
    assert.equal(result.foods[0].id, "2705418", `${text} should lead with plain whole-milk yogurt`);
    assert.equal(result.pick?.id, "2705418", `${text} picks yogurt`);
    assert.ok(result.foods[0].protein < 5, "plain yogurt has about 3.8 g protein, cottage cheese 11.6 g");
  }
  const cottage = search("curd").foods.filter((food) => /cottage/i.test(food.name));
  assert.ok(cottage.every((food) => food.id !== search("curd").pick?.id), "cottage cheese is never the pick");
  const curdRice = search("curd rice");
  assert.equal(curdRice.foods[0].id, "fitx-recipe-curd-rice");
});

test("Indian vegetable names find the matching USDA food", () => {
  const first = (text: string) => search(text).foods[0]?.name ?? "";
  assert.match(first("baingan"), /Eggplant/);
  assert.match(first("brinjal"), /Eggplant/);
  assert.match(first("gobi"), /Cauliflower/);
  assert.match(first("phool gobi"), /Cauliflower/);
  assert.match(first("patta gobi"), /Cabbage, green/);
  assert.match(first("gajar"), /Carrots/);
  assert.match(first("kheera"), /Cucumber/);
  assert.ok(search("palak").foods.some((food) => /^Spinach/.test(food.name)), "palak finds spinach (and Palak Paneer)");
  assert.ok(search("aloo").foods.some((food) => /^Potatoes/.test(food.name)), "aloo finds the potatoes (and Aloo paratha)");
  assert.match(first("matar"), /Peas, green/);
  assert.match(first("seb"), /Apples/);
  assert.match(first("kela"), /Bananas/);
  // Aloo and palak name more than one USDA food, so they are keywords: they find but never select.
  assert.equal(search("aloo").pick, null);
  assert.equal(search("palak").pick, null);
  assert.equal(search("baingan").pick?.name, "Eggplant, raw", "one clear food is selected");
});

test("everyday regional dishes are found as FITX recipe estimates", () => {
  const find = (text: string) => search(text).foods.find((food) => food.source === "FITX recipe estimate")?.name;
  assert.equal(find("rajma chawal"), "Rajma rice");
  assert.equal(find("chole"), "Chole (chickpea curry)");
  assert.equal(find("dal tadka"), "Dal tadka");
  assert.equal(find("khichdi"), "Khichdi (rice and dal)");
  assert.equal(find("raita"), "Cucumber raita");
  assert.equal(find("lassi"), "Plain lassi");
  assert.equal(find("aloo paratha"), "Aloo paratha");
  assert.equal(search("sambar").foods[0].source, "USDA FoodData Central", "dishes USDA has stay USDA's");
});

test("names overlay entries point at foods FITX has, and no alias is claimed twice", () => {
  const ids = new Set(local.all.map((food) => food.id));
  const phrase = (text: string) => text.toLowerCase().split(/[^a-z0-9%]+/).filter(Boolean).map(singular).join(" ");
  const owner = new Map<string, string>();
  for (const key of Object.keys(staples.names).filter((name) => !name.startsWith("_"))) {
    assert.ok(ids.has(key), `${key} is not in the built-in list`);
    for (const alias of overlayFor(staples.names, key).aliases) {
      const name = phrase(alias);
      assert.ok(!owner.has(name) || owner.get(name) === key, `"${alias}" names both ${owner.get(name)} and ${key}`);
      owner.set(name, key);
    }
  }
  // An alias selects a food, so none may equal the name or alias of another food in the list.
  for (const food of local.all) {
    for (const name of [food.name, ...(food.aliases ?? [])].map(phrase)) {
      const claimed = owner.get(name);
      assert.ok(!claimed || claimed === food.id || !(food.aliases ?? []).includes(name) && phrase(food.name) !== name, `"${name}" is an alias of ${claimed} and a name of ${food.id}`);
    }
  }
});

test("search still matches foods the overlay does not touch", () => {
  assert.equal(clearMatch(matchFoods(local.all, parseFoodQuery("idli").words))?.id, "2708346");
  assert.equal(search("2 eggs").pick?.id, "171287");
});
