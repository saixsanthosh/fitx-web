// Bug 15's Undo on a throwaway local Postgres: a member deletes one of their logged foods and reads it back in the same
// request (delete ... returning, as the app's .select() asks), then puts the same row back (its id and time included)
// under row-level security; another member can neither remove nor put back someone else's entry. Skipped when the
// Postgres binaries are not on PATH.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { LocalPostgres, available } from "../support/local-postgres.mjs";

const skip = available() ? false : "Postgres binaries (initdb, pg_ctl, psql) are not installed";
const DATA_PARTS = /free_exercise_db_part|food_catalog_seed_part/;
const ASHA = "aaaaaaaa-1515-4000-8000-0000000000a1";
const BEN = "bbbbbbbb-1515-4000-8000-0000000000b2";
const GHEE = "22222222-1515-4000-8000-000000000001";
const as = (sub) => ({ role: "authenticated", sub });
/** RESTORE_COLUMNS in src/lib/food/meal-undo.ts. */
const COLUMNS = "id,date,meal,food_name,brand,barcode,servings,calories,protein,carbs,fat,quantity_grams,source,provider_id,serving_size,nutrition_snapshot,created_at";

describe("Removing a logged food can be undone (bug 15)", { skip }, () => {
  /** @type {LocalPostgres} */
  let pg;
  let deleted = null;

  before(() => {
    pg = new LocalPostgres().start();
    pg.applyMigrations({ skip: DATA_PARTS });
    pg.exec(`insert into auth.users (id, email) values ('${ASHA}', 'asha@example.test'), ('${BEN}', 'ben@example.test');`);
    pg.exec(`insert into public.meals (id, user_id, date, meal, food_name, source, provider_id, serving_size, servings, quantity_grams, calories, protein, carbs, fat, nutrition_snapshot, created_at)
      values ('${GHEE}', '${ASHA}', '2026-11-25', 'Breakfast', 'Ghee, clarified butter', 'USDA FoodData Central', '2710168', '1 × 1 teaspoon (4.67 g)', 0.0467, 4.67, 40.9, 0.01, 0, 4.65,
        '{"per_100g": {"calories": 876}, "portion": {"count": 1, "label": "1 teaspoon"}}', '2026-11-25T03:00:00Z');`);
  });
  after(() => pg?.stop());

  test("another member can't remove it", () => {
    const tried = pg.run(`delete from public.meals where id = '${GHEE}' returning id;`, as(BEN));
    assert.equal(tried.ok, true);
    assert.equal(tried.stdout, "", "row-level security leaves Asha's entry alone");
  });

  test("the member removes it and gets the row back in the same request", () => {
    deleted = pg.json(`with gone as (delete from public.meals where id = '${GHEE}' and user_id = '${ASHA}' returning ${COLUMNS}) select to_jsonb(gone) from gone;`, as(ASHA));
    assert.equal(deleted.id, GHEE);
    assert.equal(deleted.created_at, "2026-11-25T03:00:00+00:00");
    assert.equal(pg.json(`select count(*) from public.meals where id = '${GHEE}';`), 0);
  });

  test("Undo puts the same entry back, id and time included; a second press changes nothing", () => {
    // What the app sends (restoreRow): the columns read back, and the member; updated_at takes its default.
    const row = { ...deleted, user_id: ASHA };
    const insert = (who) => pg.run(`insert into public.meals (user_id, ${COLUMNS}) select user_id, ${COLUMNS}
      from jsonb_populate_record(null::public.meals, '${JSON.stringify(row).replaceAll("'", "''")}'::jsonb);`, as(who));
    assert.equal(insert(BEN).ok, false, "nobody else can put Asha's entry back");
    assert.equal(insert(ASHA).ok, true);
    const back = pg.json(`select jsonb_build_object('id', id, 'created_at', created_at, 'calories', calories, 'snapshot', nutrition_snapshot) from public.meals where id = '${GHEE}';`, as(ASHA));
    assert.deepEqual(back, { id: GHEE, created_at: "2026-11-25T03:00:00+00:00", calories: 40.9, snapshot: deleted.nutrition_snapshot });
    const again = insert(ASHA);
    assert.match(again.stderr, /duplicate key value violates unique constraint "meals_pkey"/, "23505: the app treats it as already back");
  });
});
