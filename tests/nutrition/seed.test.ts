import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { localFoodsFrom } from "@/lib/food/catalog-search";

const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);
const read = (file: string) => JSON.parse(readFileSync(new URL(`../../src/data/${file}`, import.meta.url), "utf8"));
const parts = readdirSync(MIGRATIONS).filter((name) => /_fitx_food_catalog_seed_part_\d+\.sql$/.test(name)).sort();
type SeedRow = { id: string; n: string; po?: Array<[string, string, number, boolean?]> };
const seed: SeedRow[] = parts.flatMap((name) => {
  const sql = readFileSync(new URL(name, MIGRATIONS), "utf8");
  return JSON.parse(sql.slice(sql.indexOf("$fitx$[") + "$fitx$".length, sql.indexOf("]$fitx$") + 1)) as SeedRow[];
});

test("the catalogue seed holds every built-in food, so applying it loses no food search finds today", () => {
  const ids = new Set(seed.map((row) => row.id));
  const local = localFoodsFrom(read("fitx-staples.json"), read("usda-foundation-foods.json"));
  assert.deepEqual(local.all.filter((food) => !ids.has(food.id)).map((food) => `${food.id} ${food.name}`), []);
});

test("seed parts are numbered in order, list each food once, and give a bare count no container", () => {
  assert.deepEqual(parts.map((name) => name.slice(0, 14)), parts.map((_, index) => String(20261118140010 + index)));
  assert.equal(new Set(seed.map((row) => row.id)).size, seed.length);
  const containers = seed.flatMap((row) => (row.po ?? []).filter((portion) => portion[3] === true && /cubic inch|container|carton|\bpacks?\b|package|packet|\bcans?\b|bottle|\bjar\b|\bbox\b|\bbag\b|\bpouch\b/i.test(portion[0])).map((portion) => `${row.n}: ${portion[0]}`));
  assert.deepEqual(containers, []);
});
