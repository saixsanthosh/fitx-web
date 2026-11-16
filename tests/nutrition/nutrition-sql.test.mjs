// Runs every repo migration on a throwaway local Postgres (Supabase stubs, no network, no real data) and checks
// the Nutrition v2 SQL: the food catalogue and its access rules, search_foods, custom foods v2, saved meals and
// routines, editable targets, re-running the migrations, and the catalogue seed parts when they are present.
// Skipped when the Postgres binaries (initdb, pg_ctl, psql) are not on PATH.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { LocalPostgres, MIGRATIONS_DIR, available } from "./support/local-postgres.mjs";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const asA = { role: "authenticated", sub: A };
const asB = { role: "authenticated", sub: B };
const anon = { role: "anon" };
const SEED_PARTS = readdirSync(MIGRATIONS_DIR).filter((name) => /_fitx_food_catalog_seed_part_\d+\.sql$/.test(name)).sort();

const skip = available() ? false : "Postgres binaries (initdb, pg_ctl, psql) are not installed";

describe("Nutrition v2 SQL on a local Postgres", { skip }, () => {
  /** @type {LocalPostgres} */
  let pg;

  before(() => {
    pg = new LocalPostgres().start();
    pg.applyMigrations();
    pg.exec(`
      insert into auth.users (id, email) values ('${A}', 'a@example.test'), ('${B}', 'b@example.test');
      insert into public.food_catalog (id, name, aliases, keywords, state, kcal, protein_g, carbs_g, fat_g, value_basis, source_data_type, is_active) values
        ('2708346', 'Idli', array[' Idly ', 'IDLY', '', 'idlis'], '{}', 'cooked', 128, 6.36, 24.98, 0.35, 'recipe_calculated', 'Survey (FNDDS)', true),
        ('2708408', 'Rice, white, cooked, no added fat', array['rice', 'chawal'], '{}', 'cooked', 129, 2.67, 27.99, 0.28, 'recipe_calculated', 'Survey (FNDDS)', true),
        ('2512381', 'Rice, white, long grain, unenriched, raw', '{}', '{}', 'raw', 359, 7.04, 80.3, 1.03, 'lab_analysed', 'Foundation', true),
        ('2706538', 'Biryani with chicken', array['chicken biryani'], '{}', 'cooked', 104, 6.8, 13.6, 2.5, 'recipe_calculated', 'Survey (FNDDS)', true),
        ('2707320', 'Seafood sauce', '{}', array['lobster', 'white clam'], null, 120, 2, 10, 8, 'recipe_calculated', 'Survey (FNDDS)', true),
        ('2747657', 'Lobster, tail only, frozen, wild caught', '{}', '{}', null, 59, 12.8, 0, 0.6, 'lab_analysed', 'Foundation', true),
        ('9999999', 'Retired idli entry', '{}', '{}', null, 100, 1, 1, 1, 'estimated', null, false);
      insert into public.food_portions (food_id, label, unit, grams, is_default, sort_order) values
        ('2708346', '1 item', 'piece', 38, true, 0),
        ('2708408', '1 cup, cooked', 'cup', 158, false, 0),
        ('9999999', '1 piece', 'piece', 40, true, 0);
    `);
  });

  after(() => pg?.stop());

  test("the catalogue trigger cleans aliases and builds the search text", () => {
    const row = pg.json(`select json_build_object('aliases', aliases, 'search', search_text) from public.food_catalog where id = '2708346';`);
    assert.deepEqual(row.aliases.slice().sort(), ["idlis", "idly"]);
    assert.match(row.search, /^idli /);
    assert.match(row.search, /\bidly\b/);
    const keywords = pg.json(`select to_json(search_text) from public.food_catalog where id = '2707320';`);
    assert.match(keywords, /lobster/, "keywords help search find the food");
  });

  test("signed-in users read active foods only, and nobody writes the catalogue through the API", () => {
    const visible = pg.json(`select json_agg(id order by id) from public.food_catalog;`, asA);
    assert.equal(visible.includes("9999999"), false, "inactive foods are hidden");
    assert.equal(visible.includes("2708346"), true);
    const portions = pg.json(`select json_agg(food_id) from public.food_portions;`, asA);
    assert.equal(portions.includes("9999999"), false, "portions of inactive foods are hidden too");
    const write = pg.run(`insert into public.food_catalog (id, name, kcal, value_basis) values ('x', 'Fake', 1, 'estimated');`, asA);
    assert.equal(write.ok, false);
    assert.match(write.stderr, /permission denied/);
    const update = pg.run(`update public.food_catalog set kcal = 1 where id = '2708346';`, asA);
    assert.match(update.stderr, /permission denied/);
    const signedOut = pg.run(`select count(*) from public.food_catalog;`, anon);
    assert.match(signedOut.stderr, /permission denied/, "signed-out visitors cannot read the catalogue");
  });

  test("search_foods returns foods containing every word stem, with portions, exact names first", () => {
    const idli = pg.json(`select json_agg(r) from public.search_foods('idli', array['idli'], 50) r;`, asA);
    assert.equal(idli[0].id, "2708346");
    assert.equal(idli[0].kind, "catalog");
    assert.deepEqual(idli[0].portions, [{ label: "1 item", unit: "piece", grams: 38, isDefault: true, estimate: true }]);
    assert.equal(idli.some((row) => row.id === "9999999"), false, "inactive foods never come back");

    const rice = pg.json(`select json_agg(r.id) from public.search_foods('rice', array['rice'], 50) r;`, asA);
    assert.deepEqual(rice, ["2708408", "2512381"], "the alias match (cooked rice) before the raw grain");

    const biryani = pg.json(`select json_agg(r.id) from public.search_foods('chicken biryani', array['chicken', 'biryani'], 50) r;`, asA);
    assert.deepEqual(biryani, ["2706538"], "every word must appear, in any order");

    const lobster = pg.json(`select json_agg(r.id) from public.search_foods('lobster', array['lobster'], 50) r;`, asA);
    assert.deepEqual(lobster.slice().sort(), ["2707320", "2747657"], "keywords find the sauce too; the app ranks it below the lobster");
  });

  test("search_foods includes only the caller's own active custom foods and counts their recent logs", () => {
    pg.exec(`
      insert into public.custom_foods (id, user_id, name, serving_size, serving_grams, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g) values
        ('11111111-0000-4000-8000-000000000001', '${A}', 'Idli (amma''s recipe)', '2 idlis', 90, 140, 5, 28, 1),
        ('11111111-0000-4000-8000-000000000002', '${B}', 'Idli from the canteen', '1 plate', 150, 130, 5, 25, 1),
        ('11111111-0000-4000-8000-000000000003', '${A}', 'Idli old recipe', '1', 40, 120, 5, 22, 1);
      update public.custom_foods set archived_at = now() where id = '11111111-0000-4000-8000-000000000003';
      insert into public.meals (user_id, date, meal, food_name, source, provider_id, calories, created_at) values
        ('${A}', current_date, 'Breakfast', 'Idli', 'USDA FoodData Central', '2708346', 146, now()),
        ('${A}', current_date - 3, 'Breakfast', 'Idli', 'USDA FoodData Central', '2708346', 146, now() - interval '3 days'),
        ('${A}', current_date - 90, 'Breakfast', 'Idli', 'USDA FoodData Central', '2708346', 146, now() - interval '90 days'),
        ('${A}', current_date, 'Dinner', 'Idli (amma''s recipe)', 'FITX custom food', '11111111-0000-4000-8000-000000000001', 126, now()),
        ('${B}', current_date, 'Breakfast', 'Idli', 'USDA FoodData Central', '2708346', 146, now());
    `);
    const rows = pg.json(`select json_agg(json_build_object('kind', r.kind, 'id', r.id, 'name', r.name, 'recent', r.recent_count, 'serving', r.serving_grams, 'origin', r.origin, 'basis', r.value_basis)) from public.search_foods('idli', array['idli'], 50) r;`, asA);
    const custom = rows.filter((row) => row.kind === "custom");
    assert.deepEqual(custom.map((row) => row.name), ["Idli (amma's recipe)"], "B's food and the archived one are not returned");
    assert.equal(custom[0].recent, 1);
    assert.equal(custom[0].origin, "user");
    assert.equal(custom[0].basis, "user_entered");
    assert.equal(rows.find((row) => row.id === "2708346").recent, 2, "two logs in the last 60 days; B's log does not count");
    const forB = pg.json(`select json_agg(json_build_object('id', r.id, 'recent', r.recent_count)) from public.search_foods('idli', array['idli'], 50) r where r.kind = 'custom';`, asB);
    assert.deepEqual(forB.map((row) => row.id), ["11111111-0000-4000-8000-000000000002"]);
  });

  test("a typo gets close spellings, marked as suggestions", () => {
    const rows = pg.json(`select json_agg(json_build_object('id', r.id, 'fuzzy', r.fuzzy)) from public.search_foods('idlly', array['idlly'], 50) r;`, asA);
    assert.ok(rows?.length, "close spellings are offered when nothing contains every word");
    assert.deepEqual(rows[0], { id: "2708346", fuzzy: true });
    assert.equal(rows.every((row) => row.fuzzy), true);
    const none = pg.json(`select coalesce(json_agg(r.id), '[]'::json) from public.search_foods('zzzzqx', array['zzzzqx'], 50) r;`, asA);
    assert.deepEqual(none, []);
  });

  test("search_foods needs a signed-in caller and sane input", () => {
    const signedOut = pg.run(`select * from public.search_foods('idli', array['idli'], 5);`, anon);
    assert.equal(signedOut.ok, false);
    assert.match(signedOut.stderr, /permission denied/);
    const noUser = pg.run(`select * from public.search_foods('idli', array['idli'], 5);`, { role: "authenticated" });
    assert.match(noUser.stderr, /authentication required/);
    const tooMany = pg.json(`select coalesce(json_agg(r.id), '[]'::json) from public.search_foods('a b c d e f g h i', array['a','b','c','d','e','f','g','h','i'], 5) r;`, asA);
    assert.deepEqual(tooMany, [], "more than 8 words returns nothing rather than scanning");
    const capped = pg.json(`select count(*) from public.search_foods('i', array['i'], 1) r where r.kind = 'catalog';`, asA);
    assert.equal(capped, 1, "max_results caps the catalogue rows");
  });

  test("custom foods: barcode format, one active barcode per user, archiving frees it, origin and basis", () => {
    const insert = (who, id, barcode, origin = "barcode") => pg.run(
      `insert into public.custom_foods (id, user_id, name, serving_grams, calories_per_100g, barcode, origin, value_basis) values ('${id}', '${who}', 'Biscuits', 25, 480, ${barcode === null ? "null" : `'${barcode}'`}, '${origin}', 'label');`,
      who === A ? asA : asB,
    );
    assert.equal(insert(A, "22222222-0000-4000-8000-000000000001", "8901063011366").ok, true);
    const duplicate = insert(A, "22222222-0000-4000-8000-000000000002", "8901063011366");
    assert.match(duplicate.stderr, /custom_foods_user_barcode_idx/);
    assert.equal(insert(B, "22222222-0000-4000-8000-000000000003", "8901063011366").ok, true, "another user may save the same product");
    pg.exec(`update public.custom_foods set archived_at = now() where id = '22222222-0000-4000-8000-000000000001';`, asA);
    assert.equal(insert(A, "22222222-0000-4000-8000-000000000004", "8901063011366").ok, true, "archiving frees the barcode");
    assert.match(insert(A, "22222222-0000-4000-8000-000000000005", "12AB").stderr, /custom_foods_barcode_check/);
    assert.match(insert(A, "22222222-0000-4000-8000-000000000006", null, "robot").stderr, /custom_foods_origin_check/);
    assert.equal(insert(A, "22222222-0000-4000-8000-000000000007", null, "ai_coach").ok, true, "the AI coach can add foods");
    const touched = pg.json(`
      update public.custom_foods set name = 'Biscuits (renamed)' where id = '22222222-0000-4000-8000-000000000004';
      select to_json(updated_at > created_at) from public.custom_foods where id = '22222222-0000-4000-8000-000000000004';`, asA);
    assert.equal(touched, true, "updated_at is maintained");
    const theirs = pg.json(`select count(*) from public.custom_foods where user_id = '${B}';`, asA);
    assert.equal(theirs, 0, "custom foods stay private");
  });

  test("saved meals and routines are private, and items must belong to the template's owner", () => {
    const template = pg.json(`
      with t as (insert into public.meal_templates (user_id, name, kind, meal_slot) values ('${A}', 'Usual breakfast', 'meal', 'Breakfast') returning id)
      select to_json(id) from t;`, asA);
    pg.exec(`insert into public.meal_template_items (template_id, user_id, meal_slot, food_name, source, provider_id, quantity_grams, calories, protein, carbs, fat, nutrition_snapshot)
      values ('${template}', '${A}', 'Breakfast', 'Idli', 'USDA FoodData Central', '2708346', 114, 145.9, 7.3, 28.5, 0.4, '{"portion":{"count":3,"label":"1 item","unit":"piece","grams_each":38,"estimate":true}}');`, asA);
    const seenByB = pg.json(`select json_build_object('templates', (select count(*) from public.meal_templates), 'items', (select count(*) from public.meal_template_items));`, asB);
    assert.deepEqual(seenByB, { templates: 0, items: 0 });
    const hijack = pg.run(`insert into public.meal_template_items (template_id, user_id, meal_slot, food_name, calories) values ('${template}', '${B}', 'Lunch', 'Sneaky', 1);`, asB);
    assert.equal(hijack.ok, false, "B cannot add items to A's saved meal");
    const asOwner = pg.run(`insert into public.meal_template_items (template_id, user_id, meal_slot, food_name, calories) values ('${template}', '${A}', 'Lunch', 'Sneaky', 1);`, asB);
    assert.equal(asOwner.ok, false, "nor pretend to be A");
    const badSlot = pg.run(`insert into public.meal_templates (user_id, name, kind, meal_slot) values ('${A}', 'x', 'meal', 'Brunch');`, asA);
    assert.match(badSlot.stderr, /meal_templates_meal_slot_check/);
    const left = pg.json(`
      delete from public.meal_templates where id = '${template}';
      select count(*) from public.meal_template_items where template_id = '${template}';`, asA);
    assert.equal(left, 0, "deleting a template deletes its items");
  });

  test("nutrition targets: one row per user, sensible ranges, private", () => {
    pg.exec(`insert into public.nutrition_targets (user_id, calories, protein_g, carbs_g, fat_g) values ('${A}', 2200, 140, 250, 70)
      on conflict (user_id) do update set calories = excluded.calories;`, asA);
    pg.exec(`insert into public.nutrition_targets (user_id, calories, protein_g, carbs_g, fat_g) values ('${A}', 2100, 140, 230, 70)
      on conflict (user_id) do update set calories = excluded.calories;`, asA);
    assert.equal(pg.json(`select calories from public.nutrition_targets where user_id = '${A}';`, asA), 2100);
    const low = pg.run(`update public.nutrition_targets set calories = 500 where user_id = '${A}';`, asA);
    assert.match(low.stderr, /nutrition_targets_calories_check/);
    assert.equal(pg.json(`select count(*) from public.nutrition_targets;`, asB), 0);
    const forB = pg.run(`insert into public.nutrition_targets (user_id, calories, protein_g, carbs_g, fat_g) values ('${A}', 2000, 1, 1, 1);`, asB);
    assert.equal(forB.ok, false, "B cannot set A's targets");
  });

  test("the nutrition migrations can be applied again without errors", () => {
    const files = pg.applyMigrations({ from: "20261118140000", skip: /food_catalog_seed_part/ });
    assert.deepEqual(files.filter((name) => /^2026111814000[0-2]_/.test(name)).length, 3);
    assert.equal(pg.json(`select count(*) from public.food_catalog where id = '2708346';`), 1);
  });

  test("the catalogue seed parts load, are safe to re-run, and keep curated portions", { skip: SEED_PARTS.length ? false : "no seed parts generated yet" }, () => {
    for (const name of SEED_PARTS) pg.applyFile(path.join(MIGRATIONS_DIR, name));
    const counts = pg.json(`select json_build_object('foods', (select count(*) from public.food_catalog), 'portions', (select count(*) from public.food_portions));`);
    assert.ok(counts.foods > 1000, `foods: ${counts.foods}`);
    pg.applyFile(path.join(MIGRATIONS_DIR, SEED_PARTS[0]));
    const again = pg.json(`select json_build_object('foods', (select count(*) from public.food_catalog), 'portions', (select count(*) from public.food_portions));`);
    assert.deepEqual(again, counts, "re-running a part changes nothing");
    const idli = pg.json(`select json_agg(json_build_object('label', label, 'grams', grams, 'default', is_default)) from public.food_portions where food_id = '2708346';`);
    assert.deepEqual(idli, [{ label: "1 item", grams: 38, default: true }]);
    const egg = pg.json(`select json_build_object('aliases', aliases, 'diet', diet_type, 'basis', value_basis) from public.food_catalog where id = '171287';`);
    assert.deepEqual({ ...egg, aliases: egg.aliases.slice().sort() }, { aliases: ["anda", "ande", "egg", "whole egg"], diet: "egg", basis: "compiled" });
    const paneer = pg.json(`select count(*) from public.food_catalog where id = '2705740';`);
    assert.equal(paneer, 0, "FNDDS paneer stays out");
    const search = pg.json(`select json_agg(r.id) from public.search_foods('idli', array['idli'], 5) r where r.kind = 'catalog';`, asA);
    assert.equal(search[0], "2708346");
  });
});
