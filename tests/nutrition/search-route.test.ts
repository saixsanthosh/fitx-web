import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localFoodsFrom } from "@/lib/food/catalog-search";
import type { OffAnswer } from "@/lib/food/open-food-facts";
import { searchFoods, SEARCH_CACHE_CONTROL, type FoodSearchServices } from "@/lib/food/search-route";
import type { FoodSearchResponse, SourceStatus } from "@/lib/food/types";

const read = (file: string) => JSON.parse(readFileSync(new URL(`../../src/data/${file}`, import.meta.url), "utf8"));
const local = localFoodsFrom(read("fitx-staples.json"), read("usda-foundation-foods.json"));

type Result = { data: unknown; error: { code: string } | null };
const ok = (data: unknown): Result => ({ data, error: null });
const failed = (code: string): Result => ({ data: null, error: { code } });

/**
 * A Supabase client that answers each RPC and table with a fixed result and records what was asked. Every query
 * builder method returns the builder, which resolves to its table's result when awaited.
 */
function fakeSupabase(answers: { rpc?: Record<string, Result>; tables?: Record<string, Result> } = {}) {
  const calls: string[] = [];
  const query = (table: string) => {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "order", "limit"]) builder[method] = () => builder;
    builder.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) => {
      calls.push(`from:${table}`);
      return Promise.resolve(answers.tables?.[table] ?? ok([])).then(resolve, reject);
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
  const filled = { food_catalog: ok([{ id: "2708346" }]) };
  const mango = await search("/api/foods/search?q=mango", fakeSupabase({ rpc: { search_foods: ok([]) }, tables: filled }));
  assert.match(mango.body.foods[0]?.name ?? "", /^Mango, /);
  assert.equal(mango.body.mode, "catalog");
  assert.equal(source(mango.body, "fitx-catalog")?.status, "no_results");
  assert.equal(source(mango.body, "fitx-built-in")?.count, 2);

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
  const db = fakeSupabase({ rpc: { search_foods: ok([dbRow("2707335", "Soup, Manhattan clam chowder", { fuzzy: true })]) } });
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
