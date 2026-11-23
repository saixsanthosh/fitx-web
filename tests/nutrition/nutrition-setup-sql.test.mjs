// Runs the repo migrations on a throwaway local Postgres (the Supabase stand-in in tests/support, no network, no real
// data) and checks 20261123100040_fitx_nutrition_v2.sql: nutrition_setup_at is added, members who already chose a diet
// are marked as set up (nobody is asked twice), others stay null, a re-run changes nothing, and the owner-only
// preferences policy covers the new column. Skipped when the Postgres binaries are not on PATH.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { LocalPostgres, MIGRATIONS_DIR, available } from "../support/local-postgres.mjs";

const FILE = "20261123100040_fitx_nutrition_v2.sql";
const A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const B = "bbbbbbbb-0000-4000-8000-0000000000b2";
const asA = { role: "authenticated", sub: A };
const skip = available() ? false : "Postgres binaries (initdb, pg_ctl, psql) are not installed";

describe("Nutrition setup migration on a local Postgres", { skip }, () => {
  /** @type {LocalPostgres} */
  let pg;

  before(() => {
    pg = new LocalPostgres().start();
    pg.applyMigrations({ skip: /free_exercise_db_part|food_catalog_seed_part/, before: FILE });
    pg.exec(`
      insert into auth.users (id, email) values ('${A}', 'a@example.test'), ('${B}', 'b@example.test');
      insert into public.user_preferences (user_id, diet_type) values ('${A}', 'vegetarian') on conflict (user_id) do update set diet_type = excluded.diet_type;
      insert into public.user_preferences (user_id, diet_type) values ('${B}', null) on conflict (user_id) do update set diet_type = excluded.diet_type;
    `);
    pg.applyFile(path.join(MIGRATIONS_DIR, FILE));
  });

  after(() => pg?.stop());

  test("adds the column and backfills only members who already chose a diet", () => {
    const rows = pg.json(`select json_object_agg(user_id, nutrition_setup_at is not null) from public.user_preferences where user_id in ('${A}', '${B}');`);
    assert.deepEqual(rows, { [A]: true, [B]: false });
    const type = pg.json(`select to_json(data_type) from information_schema.columns where table_schema = 'public' and table_name = 'user_preferences' and column_name = 'nutrition_setup_at';`);
    assert.equal(type, "timestamp with time zone");
  });

  test("is safe to re-run: stamped times stay as they were", () => {
    const first = pg.json(`select to_json(nutrition_setup_at) from public.user_preferences where user_id = '${A}';`);
    pg.applyFile(path.join(MIGRATIONS_DIR, FILE));
    assert.equal(pg.json(`select to_json(nutrition_setup_at) from public.user_preferences where user_id = '${A}';`), first);
    assert.equal(pg.json(`select to_json(nutrition_setup_at is null) from public.user_preferences where user_id = '${B}';`), true);
  });

  test("members set and read only their own setup time", () => {
    pg.exec(`update public.user_preferences set nutrition_setup_at = now() where user_id = '${B}';`, asA);
    assert.equal(pg.json(`select to_json(nutrition_setup_at is null) from public.user_preferences where user_id = '${B}';`), true, "A cannot stamp B");
    const seen = pg.json(`select coalesce(json_agg(user_id), '[]'::json) from public.user_preferences;`, asA);
    assert.deepEqual(seen, [A]);
  });

  test("the file is additive: no drops, no default that rewrites the table", () => {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, FILE), "utf8");
    assert.doesNotMatch(sql, /\bdrop\b/i);
    assert.match(sql, /add column if not exists nutrition_setup_at timestamptz;/);
  });
});
