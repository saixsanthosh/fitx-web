import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localFoodsFrom, USDA_SOURCE } from "@/lib/food/catalog-search";
import type { OffAnswer } from "@/lib/food/open-food-facts";
import { searchFoods, SEARCH_CACHE_CONTROL, type FoodSearchServices } from "@/lib/food/search-route";
import type { FoodSearchResponse, SourceStatus } from "@/lib/food/types";

const read = (file: string) => JSON.parse(readFileSync(new URL(`../../src/data/${file}`, import.meta.url), "utf8"));
const local = localFoodsFrom(read("fitx-staples.json"), read("usda-foundation-foods.json"));

type Result = { data: unknown; error: { code: string } | null };
const ok = (data: unknown): Result => ({ data, error: null });
const failed = (code: string): Result => ({ data: null, error: { code } });

/** What a table query asked for: the ids of an `.in("id", …)` filter, if any. */
type TableQuery = { ids: string[] | null };
type TableAnswer = Result | ((query: TableQuery) => Result);

/**
 * A Supabase client that answers each RPC and table with a fixed result (or one worked out from the query) and
 * records what was asked. Every query builder method returns the builder, which resolves to its table's result
 * when awaited.
 */
function fakeSupabase(answers: { rpc?: Record<string, Result>; tables?: Record<string, TableAnswer> } = {}) {
  const calls: string[] = [];
  const query = (table: string) => {
    const asked: TableQuery = { ids: null };
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "order", "limit"]) builder[method] = () => builder;
    builder.in = (_column: string, ids: string[]) => { asked.ids = [...ids]; return builder; };
    builder.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) => {
      calls.push(asked.ids ? `from:${table}:in` : `from:${table}`);
      const answer = answers.tables?.[table];
      return Promise.resolve(typeof answer === "function" ? answer(asked) : answer ?? ok([])).then(resolve, reject);
    };
    return builder;
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "aaaaaaaa-0000-4000-8000-000000000001" } } }) },
    rpc: async (name: string) => {
      calls.push(`rpc:${name}`);
      return answers.rpc?.[name] ?? failed("PGRST202");
    },
    from: (table: string) => query(table),
  };
  return { client: client as unknown as SupabaseClient, calls };
}

function services(overrides: Partial<FoodSearchServices> = {}) {
  const asked: string[] = [];
  const nothing: OffAnswer = { status: "no_results", foods: [], productName: null, noLabel: false };
  const value: FoodSearchServices = {
    lookupProduct: async (code) => { asked.push(`off:${code}`); return nothing; },
    searchProducts: async (text) => { asked.push(`off-search:${text}`); return nothing; },
    searchUsda: async (text) => { asked.push(`usda:${text}`); return { status: "no_results", foods: [] }; },
    usdaKey: "",
    localFoods: local.all,
    stapleFoods: local.staples,
    ...overrides,
  };
  return { value, asked };
}

async function search(path: string, supabase: ReturnType<typeof fakeSupabase>, service = services()) {
  const response = await searchFoods(new Request(`http://localhost${path}`), supabase.client, service.value);
  const body = (await response.json()) as FoodSearchResponse;
  return { response, body, asked: service.asked };
}

const source = (body: FoodSearchResponse, id: SourceStatus["id"]) => body.sources.find((item) => item.id === id);

/** A food_catalog table row (with its food_portions) for a bundled food, as seeded, with `extra` changes. */
function tableRow(id: string, extra: Record<string, unknown> = {}) {
  const food = local.all.find((item) => item.id === id);
  assert.ok(food, id);
  return { id, name: food.name, aliases: food.aliases ?? [], keywords: [], category: null, diet_type: null, state: food.state,
    kcal: food.calories, protein_g: food.protein, carbs_g: food.carbs, fat_g: food.fat, fiber_g: null, sugar_g: null, sodium_mg: null,
    value_basis: food.valueBasis, source_data_type: food.dataType, image_url: null, image_attribution: null,
    food_portions: food.portions.map((portion, index) => ({ label: portion.label, unit: portion.unit, grams: portion.grams, is_default: Boolean(portion.countDefault), is_estimate: portion.estimate !== false, sort_order: index })),
    ...extra };
}

/**
 * A seeded catalogue as members' row-level security shows it: every bundled USDA food, `hidden` ones left out,
 * `edited` ones changed. Answers both the "is it seeded" probe and reads by id.
 */
function seededCatalogue(options: { hidden?: string[]; edited?: Record<string, Record<string, unknown>> } = {}): TableAnswer {
  const hidden = new Set(options.hidden ?? []);
  const rows = local.all.filter((food) => food.source === USDA_SOURCE && !hidden.has(food.id)).map((food) => tableRow(food.id, options.edited?.[food.id]));
  return ({ ids }) => ok(ids ? rows.filter((row) => ids.includes(row.id)) : rows.slice(0, 1));
}

/** A search_foods catalogue row. */
function dbRow(id: string, name: string, extra: Record<string, unknown> = {}) {
  return { kind: "catalog", id, name, aliases: [], keywords: [], kcal: 100, protein_g: 1, carbs_g: 20, fat_g: 1, value_basis: "recipe_calculated",
    source_data_type: "Survey (FNDDS)", portions: [], recent_count: 0, fuzzy: false, ...extra };
}

test("search answers are never kept by the browser: they hold the user's own foods", async () => {
  const db = fakeSupabase({ rpc: { search_foods: ok([]) }, tables: { food_catalog: ok([]) } });
  for (const path of ["/api/foods/search?q=idli", "/api/foods/search?browse=1", "/api/foods/search?barcode=5449000131805"]) {
    const { response } = await search(path, db);
    assert.equal(response.headers.get("cache-control"), SEARCH_CACHE_CONTROL, path);
  }
  assert.equal(SEARCH_CACHE_CONTROL, "private, no-store");
});

test("browse takes no quota and never reaches Open Food Facts, even with a barcode added", async () => {
  const db = fakeSupabase({ rpc: { fitx_take_food_search_quota: ok([{ allowed: true }]) } });
  const { body, asked } = await search("/api/foods/search?browse=1&barcode=5449000131805", db);
  assert.equal(body.mode, "browse");
  assert.equal(body.foods.length, local.staples.length);
  assert.deepEqual(asked, [], "no Open Food Facts or USDA request");
  assert.equal(db.calls.includes("rpc:fitx_take_food_search_quota"), false);
  assert.deepEqual(source(body, "fitx-built-in"), { id: "fitx-built-in", label: "FITX built-in foods", status: "ok", count: local.staples.length });
});

test("every barcode lookup takes the account's quota first", async () => {
  const db = fakeSupabase({ rpc: { fitx_take_food_search_quota: ok([{ allowed: false, retry_after_seconds: 30 }]) } });
  const { response, asked } = await search("/api/foods/search?barcode=5449000131805", db);
  assert.equal(response.status, 429);
  assert.deepEqual(asked, []);
  const allowed = fakeSupabase({ rpc: { fitx_take_food_search_quota: ok([{ allowed: true }]) } });
  const lookup = await search("/api/foods/search?barcode=5449000131805", allowed);
  assert.deepEqual(lookup.asked, ["off:5449000131805"]);
  assert.equal(allowed.calls[0], "rpc:fitx_take_food_search_quota");
});

test("an empty catalogue (migrations applied, seed parts not yet) answers from the built-in list", async () => {
  const db = fakeSupabase({ rpc: { search_foods: ok([]) }, tables: { food_catalog: ok([]) } });
  const { body } = await search("/api/foods/search?q=3%20idli", db);
  assert.equal(body.pick?.id, "2708346", "3 idli still selects Idli");
  assert.equal(body.mode, "fallback");
  assert.equal(source(body, "fitx-catalog")?.status, "not_used", "an empty catalogue is not a \"no match\"");
  assert.equal(source(body, "fitx-built-in")?.status, "ok");
});

test("foods the catalogue lacks come from the built-in list; foods it has are listed once, with its values", async () => {
  const filled = { food_catalog: seededCatalogue({ edited: { "2710834": { kcal: 61 } } }) };
  // Only the bundled everyday name "aam" finds these mangoes; the catalogue's rows still give the values.
  const mango = await search("/api/foods/search?q=aam", fakeSupabase({ rpc: { search_foods: ok([]) }, tables: filled }));
  assert.match(mango.body.foods[0]?.name ?? "", /^Mango, /);
  assert.equal(mango.body.mode, "catalog");
  assert.equal(mango.body.foods.find((food) => food.id === "2710834")?.calories, 61, "the catalogue's corrected values");
  assert.equal(source(mango.body, "fitx-catalog")?.count, 2);
  assert.equal(source(mango.body, "fitx-built-in")?.status, "not_used");

  const recipe = await search("/api/foods/search?q=dal%20tadka", fakeSupabase({ rpc: { search_foods: ok([]) }, tables: filled }));
  assert.ok(recipe.body.foods.some((food) => food.id === "fitx-recipe-dal-tadka"), "FITX's recipe estimates are not in the catalogue");
  assert.equal(source(recipe.body, "fitx-built-in")?.status, "ok");

  const rice = await search("/api/foods/search?q=rice", fakeSupabase({
    rpc: { search_foods: ok([dbRow("2708408", "Rice, white, cooked, no added fat", { aliases: ["rice", "chawal"], kcal: 130, state: "cooked" })]) },
  }));
  const copies = rice.body.foods.filter((food) => food.id === "2708408");
  assert.equal(copies.length, 1);
  assert.equal(copies[0].calories, 130, "the database's values win");
  assert.equal(rice.body.pick?.id, "2708408");
  assert.equal(source(rice.body, "fitx-catalog")?.count, 1);
});

test("the database's close spellings are left out once the built-in list matched every word", async () => {
  const db = fakeSupabase({ rpc: { search_foods: ok([dbRow("2707335", "Soup, Manhattan clam chowder", { fuzzy: true })]) }, tables: { food_catalog: seededCatalogue() } });
  const { body } = await search("/api/foods/search?q=mango", db);
  assert.equal(body.foods.some((food) => food.suggestion), false);
  assert.match(body.foods[0]?.name ?? "", /^Mango, /);
  const typo = await search("/api/foods/search?q=idlly", fakeSupabase({ rpc: { search_foods: ok([dbRow("2708346", "Idli", { fuzzy: true })]) } }));
  assert.deepEqual(typo.body.foods.map((food) => [food.name, food.suggestion]), [["Idli", true]], "with no real match the suggestions stay");
});

test("a catalogue outage says so, while the built-in list answers", async () => {
  const db = fakeSupabase({ rpc: { search_foods: failed("57014") } });
  const { body } = await search("/api/foods/search?q=idli", db);
  assert.equal(body.mode, "fallback");
  assert.equal(source(body, "fitx-catalog")?.status, "error");
  assert.equal(source(body, "fitx-built-in")?.status, "ok", "the chip for the foods shown is not \"unavailable\"");
  const before = await search("/api/foods/search?q=idli", fakeSupabase());
  assert.equal(source(before.body, "fitx-catalog")?.status, "not_used", "before the migrations nothing is wrong");
});

test("your own foods are found by their brand, without being picked by it", async () => {
  const bhujia = { id: "c1", name: "Bhujia", brand: "Haldiram's", serving_size: "30 g", serving_grams: 30, calories_per_100g: 560, protein_per_100g: 12, carbs_per_100g: 40, fat_per_100g: 38 };
  const db = fakeSupabase({ tables: { custom_foods: ok([bhujia]) } });
  for (const phrase of ["haldiram bhujia", "haldiram's bhujia", "haldiram", "2 haldiram bhujia"]) {
    const { body } = await search(`/api/foods/search?q=${encodeURIComponent(phrase)}`, db);
    assert.deepEqual(body.foods.map((food) => food.name), ["Bhujia"], phrase);
    assert.equal(body.pick, null, phrase);
    assert.equal(source(body, "my-foods")?.status, "ok");
  }
  const { body } = await search("/api/foods/search?q=bhujia", db);
  assert.equal(body.pick?.id, "c1");
});

test("a food Admin hid stays out of search: its bundled copy does not come back", async () => {
  // Rice is a curated staple; search_foods leaves it out once it is hidden, and so does the read by id.
  const tables = { food_catalog: seededCatalogue({ hidden: ["2708408"] }) };
  const rice = await search("/api/foods/search?q=rice", fakeSupabase({ rpc: { search_foods: ok([]) }, tables }));
  assert.equal(rice.body.foods.some((food) => food.id === "2708408"), false);
  assert.notEqual(rice.body.pick?.id, "2708408");
  assert.ok(rice.body.foods.length > 0, "other rice foods are still found");
  const fuzzy = await search("/api/foods/search?q=rice", fakeSupabase({ rpc: { search_foods: ok([dbRow("2707335", "Soup, Manhattan clam chowder", { fuzzy: true })]) }, tables }));
  assert.equal(fuzzy.body.foods.some((food) => food.id === "2708408"), false, "also when the catalogue answered with close spellings");
});

test("browse shows the staples as the catalogue has them: corrected, renamed, re-portioned or hidden", async () => {
  const tables = { food_catalog: seededCatalogue({
    hidden: ["2708408"],
    edited: { "2708346": { name: "Idli, plain", kcal: 140, protein_g: 4.5, food_portions: [{ label: "1 small idli", unit: "piece", grams: 30, is_default: true, is_estimate: true, sort_order: 0 }] } },
  }) };
  const db = fakeSupabase({ tables });
  const { body } = await search("/api/foods/search?browse=1", db);
  assert.equal(body.mode, "browse");
  assert.equal(body.foods.some((food) => food.id === "2708408"), false, "hidden rice is not listed");
  assert.equal(body.foods.length, local.staples.length - 1);
  const idli = body.foods.find((food) => food.id === "2708346");
  assert.equal(idli?.name, "Idli, plain");
  assert.equal(idli?.calories, 140);
  assert.deepEqual(idli?.portions.map((portion) => [portion.label, portion.grams]), [["1 small idli", 30]]);
  assert.deepEqual(body.foods.map((food) => food.id), local.staples.map((food) => food.id).filter((id) => id !== "2708408"), "the curated order stays");
  assert.deepEqual(source(body, "fitx-catalog"), { id: "fitx-catalog", label: "FITX food catalogue", status: "ok", count: local.staples.length - 1 });
  assert.equal(db.calls.includes("rpc:fitx_take_food_search_quota"), false, "browse still takes no quota");

  const empty = await search("/api/foods/search?browse=1", fakeSupabase({ tables: { food_catalog: ok([]) } }));
  assert.equal(empty.body.foods.length, local.staples.length, "before the seed parts, the bundled staples");
  const outage = await search("/api/foods/search?browse=1", fakeSupabase({ tables: { food_catalog: failed("57014") } }));
  assert.equal(outage.body.foods.length, local.staples.length, "and when the catalogue cannot be read");
});

test("every bundled USDA food is in the catalogue's seed, so a seeded catalogue that leaves one out has hidden it", () => {
  const dir = new URL("../../supabase/migrations/", import.meta.url);
  const seeded = new Set<string>();
  for (const file of readdirSync(dir).filter((name) => /_fitx_food_catalog_seed_part_\d+\.sql$/.test(name))) {
    for (const match of readFileSync(new URL(file, dir), "utf8").matchAll(/\{"id":"([^"]+)"/g)) seeded.add(match[1]);
  }
  const missing = local.all.filter((food) => food.source === USDA_SOURCE && !seeded.has(food.id)).map((food) => `${food.id} ${food.name}`);
  assert.deepEqual(missing, [], "add these foods to the catalogue in a migration before bundling them");
});
