// Migration 20261126100000 (#56, bug 4) on a throwaway local Postgres: before it a custom food could not be saved
// with protein, carbs or fat unknown (so the app stored 0 g); after it the three columns hold NULL for "not known".
// Their default (0) and checks (>= 0) stay, no saved row changes, row level security is untouched, search_foods
// returns the NULLs as they are, a second run changes nothing, and the header's undo puts the rule back (turning the
// unknowns into 0) so the file can run again after it. Skipped when the Postgres binaries are not on PATH.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { LocalPostgres, MIGRATIONS_DIR, available } from "../support/local-postgres.mjs";

const skip = available() ? false : "Postgres binaries (initdb, pg_ctl, psql) are not installed";
const VERSION = "20261126100000";
const FILE = path.join(MIGRATIONS_DIR, `${VERSION}_fitx_custom_food_unknown_macros.sql`);
/** Data-only migrations, not needed here. */
const DATA_PARTS = /free_exercise_db_part|food_catalog_seed_part/;
const ASHA = "aaaaaaaa-5656-4000-8000-0000000000a1";
const BEN = "bbbbbbbb-5656-4000-8000-0000000000b2";
const OLD_FOOD = "11111111-5656-4000-8000-000000000001";
const CHAI = "11111111-5656-4000-8000-000000000002";
const as = (sub) => ({ role: "authenticated", sub });
const MACROS = ["protein_per_100g", "carbs_per_100g", "fat_per_100g"];

/** Each value column of custom_foods: whether it is NOT NULL, and its default. */
const COLUMNS = `select jsonb_object_agg(a.attname, jsonb_build_object('not_null', a.attnotnull, 'default', pg_get_expr(d.adbin, d.adrelid)))
  from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attrelid = 'public.custom_foods'::regclass and a.attname in ('calories_per_100g', 'protein_per_100g', 'carbs_per_100g', 'fat_per_100g', 'serving_grams');`;
/** The table's check rules and policies, which the file must leave alone. */
const RULES = `select jsonb_build_object(
  'checks', (select jsonb_agg(pg_get_constraintdef(oid) order by conname) from pg_constraint where conrelid = 'public.custom_foods'::regclass and contype = 'c'),
  'policies', (select jsonb_agg(polname order by polname) from pg_policy where polrelid = 'public.custom_foods'::regclass));`;
const ROWS = `select jsonb_agg(jsonb_build_object('id', id, 'protein', protein_per_100g, 'carbs', carbs_per_100g, 'fat', fat_per_100g) order by id) from public.custom_foods;`;

/** A migration header's undo: its "--   " lines after "-- Undo", up to the first statement. */
function headerUndo(file) {
  const lines = readFileSync(file, "utf8").split("\n");
  const start = lines.findIndex((line) => line.startsWith("-- Undo"));
  const end = lines.findIndex((line, index) => index > start && !line.startsWith("--"));
  return lines.slice(start + 1, end).filter((line) => line.startsWith("--   ")).map((line) => line.slice(5)).join("\n");
}

describe("Custom foods: protein, carbs and fat may be unknown (#56)", { skip }, () => {
  /** @type {LocalPostgres} */
  let pg;
  const beforeFile = { columns: null, rules: null, refused: null };
  let afterFile = null;

  before(() => {
    pg = new LocalPostgres().start();
    pg.applyMigrations({ skip: DATA_PARTS, before: VERSION });
    pg.exec(`insert into auth.users (id, email) values ('${ASHA}', 'asha@example.test'), ('${BEN}', 'ben@example.test');`);
    // A food saved before the file, with every value given (a 0 g fat included).
    pg.exec(`insert into public.custom_foods (id, user_id, name, serving_size, serving_grams, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g)
      values ('${OLD_FOOD}', '${ASHA}', 'Idli (amma''s recipe)', '2 idlis', 90, 140, 5, 28, 0);`, as(ASHA));
    beforeFile.columns = pg.json(COLUMNS);
    beforeFile.rules = pg.json(RULES);
    beforeFile.refused = pg.run(`insert into public.custom_foods (user_id, name, serving_grams, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g)
      values ('${ASHA}', 'Masala chai (home)', 150, 60, null, 8, null);`, as(ASHA));
    pg.applyFile(FILE);
    afterFile = pg.json(COLUMNS);
  });
  after(() => pg?.stop());

  test("before the file, a food with a value left blank could not be saved", () => {
    assert.equal(beforeFile.refused.ok, false);
    assert.match(beforeFile.refused.stderr, /null value in column "protein_per_100g"/);
    for (const column of MACROS) assert.equal(beforeFile.columns[column].not_null, true, column);
  });

  test("after it, a member saves a food with protein and fat unknown and reads them back as NULL", () => {
    pg.exec(`insert into public.custom_foods (id, user_id, name, serving_size, serving_grams, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g)
      values ('${CHAI}', '${ASHA}', 'Masala chai (home)', '1 cup', 150, 60, null, 8, null);`, as(ASHA));
    const chai = pg.json(`select jsonb_build_object('protein', protein_per_100g, 'carbs', carbs_per_100g, 'fat', fat_per_100g) from public.custom_foods where id = '${CHAI}';`, as(ASHA));
    assert.deepEqual(chai, { protein: null, carbs: 8, fat: null });
    // An edit can make a value unknown, or fill one in.
    pg.exec(`update public.custom_foods set carbs_per_100g = null, fat_per_100g = 2.5 where id = '${CHAI}';`, as(ASHA));
    assert.deepEqual(pg.json(`select jsonb_build_object('carbs', carbs_per_100g, 'fat', fat_per_100g) from public.custom_foods where id = '${CHAI}';`, as(ASHA)), { carbs: null, fat: 2.5 });
    pg.exec(`update public.custom_foods set carbs_per_100g = 8, fat_per_100g = null where id = '${CHAI}';`, as(ASHA));
  });

  test("only the NOT NULL rule of the three columns changes: defaults, checks, policies and saved rows stay", () => {
    const expected = structuredClone(beforeFile.columns);
    for (const column of MACROS) expected[column].not_null = false;
    assert.deepEqual(afterFile, expected);
    assert.equal(afterFile.protein_per_100g.default, "0", "a writer that names no value still stores 0, as before");
    assert.deepEqual(pg.json(RULES), beforeFile.rules);
    assert.deepEqual(pg.json(`select jsonb_build_object('protein', protein_per_100g, 'carbs', carbs_per_100g, 'fat', fat_per_100g) from public.custom_foods where id = '${OLD_FOOD}';`),
      { protein: 5, carbs: 28, fat: 0 }, "a food saved with 0 keeps 0");
    const negative = pg.run(`insert into public.custom_foods (user_id, name, serving_grams, calories_per_100g, protein_per_100g) values ('${ASHA}', 'Bad', 100, 10, -1);`, as(ASHA));
    assert.match(negative.stderr, /violates check constraint "custom_foods_protein_per_100g_check"/, "below 0 is still refused");
    const unnamed = pg.json(`insert into public.custom_foods (user_id, name, serving_grams, calories_per_100g) values ('${ASHA}', 'Plain', 100, 10)
      returning jsonb_build_object('protein', protein_per_100g, 'carbs', carbs_per_100g, 'fat', fat_per_100g);`, as(ASHA));
    assert.deepEqual(unnamed, { protein: 0, carbs: 0, fat: 0 });
    pg.exec(`delete from public.custom_foods where name = 'Plain';`);
  });

  test("row level security still keeps each member's foods their own", () => {
    assert.equal(pg.json(`select count(*) from public.custom_foods;`, as(BEN)), 0);
    const write = pg.run(`update public.custom_foods set protein_per_100g = null where id = '${OLD_FOOD}' returning id;`, as(BEN));
    assert.equal(write.ok, true);
    assert.equal(write.stdout, "", "Ben changes nothing of Asha's");
  });

  test("search_foods returns the unknown values as NULL, for the app to show as unknown", () => {
    const rows = pg.json(`select jsonb_agg(jsonb_build_object('id', r.id, 'protein', r.protein_g, 'carbs', r.carbs_g, 'fat', r.fat_g)) from public.search_foods('masala chai', array['masala', 'chai'], 20) r where r.kind = 'custom';`, as(ASHA));
    assert.deepEqual(rows, [{ id: CHAI, protein: null, carbs: 8, fat: null }]);
  });

  test("a second run changes nothing", () => {
    const rows = pg.json(ROWS);
    pg.applyFile(FILE);
    assert.deepEqual(pg.json(COLUMNS), afterFile);
    assert.deepEqual(pg.json(RULES), beforeFile.rules);
    assert.deepEqual(pg.json(ROWS), rows);
  });

  test("the header's undo makes unknown values 0 again and puts the rule back; the file then applies again", () => {
    pg.exec(headerUndo(FILE));
    assert.deepEqual(pg.json(COLUMNS), beforeFile.columns);
    assert.deepEqual(pg.json(`select jsonb_build_object('protein', protein_per_100g, 'carbs', carbs_per_100g, 'fat', fat_per_100g) from public.custom_foods where id = '${CHAI}';`),
      { protein: 0, carbs: 8, fat: 0 }, "what the app saved for a blank value before the file");
    pg.applyFile(FILE);
    assert.deepEqual(pg.json(COLUMNS), afterFile);
  });
});
