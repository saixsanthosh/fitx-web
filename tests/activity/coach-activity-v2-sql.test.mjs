// Migration 20261123100050 on a throwaway local Postgres (the Supabase stand-in, no network): the widened sport
// check, the best_efforts column and its check, that a re-run changes nothing, and that rows stay owner-only.
// Skipped when the Postgres binaries (initdb, pg_ctl, psql) are not on PATH.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { LocalPostgres, MIGRATIONS_DIR, available } from "../support/local-postgres.mjs";

const FILE = "20261123100050_fitx_coach_activity_v2.sql";
const A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const B = "bbbbbbbb-0000-4000-8000-0000000000b2";
const asA = { role: "authenticated", sub: A };
const asB = { role: "authenticated", sub: B };

const skip = available() ? false : "Postgres binaries (initdb, pg_ctl, psql) are not installed";

let n = 0;
const insert = (sport, extra = "") => {
  n += 1;
  const client = `cccccccc-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return `insert into public.activities (user_id, client_id, sport, title, started_at, ended_at, elapsed_seconds, moving_seconds, distance_m${extra ? ", best_efforts" : ""})
    values ('${A}', '${client}', '${sport}', 'Test', '2026-11-20T06:00:00Z', '2026-11-20T07:00:00Z', 3600, 3000, 8000${extra ? `, ${extra}` : ""});`;
};

describe("coach and activity v2 migration on a local Postgres", { skip }, () => {
  /** @type {LocalPostgres} */
  let pg;

  before(() => {
    pg = new LocalPostgres().start();
    pg.applyMigrations({ before: FILE });
    pg.exec(`insert into auth.users (id, email) values ('${A}', 'a@example.test'), ('${B}', 'b@example.test');`);
    // A run saved before the migration.
    pg.exec(insert("run"), asA);
    assert.equal(pg.run(insert("hike"), asA).ok, false, "before the migration a hike is refused");
    pg.applyMigrations({ from: FILE });
  });
  after(() => pg?.stop());

  test("the new sports are accepted, the original ones still are, anything else is refused", () => {
    for (const sport of ["walk", "run", "ride", "hike", "trail_run", "mtb", "ebike", "wheelchair", "skate", "paddle"]) {
      assert.equal(pg.run(insert(sport), asA).ok, true, sport);
    }
    const swim = pg.run(insert("swim"), asA);
    assert.equal(swim.ok, false);
    assert.match(swim.stderr, /activities_sport_check/);
    assert.equal(pg.json("select to_json(count(*)) from public.activities where sport = 'run';"), 2, "the earlier run is kept");
  });

  test("best efforts are an array of at most 20 entries, or null", () => {
    assert.equal(pg.run(insert("run", `'[{"d":1000,"s":290,"start_m":2100}]'::jsonb`), asA).ok, true);
    assert.equal(pg.run(insert("run", `'{"d":1000}'::jsonb`), asA).ok, false);
    const many = JSON.stringify(Array.from({ length: 21 }, (_, i) => ({ d: 1000 + i, s: 300, start_m: 0 })));
    const tooMany = pg.run(insert("run", `'${many}'::jsonb`), asA);
    assert.equal(tooMany.ok, false);
    assert.match(tooMany.stderr, /activities_best_efforts_check/);
    assert.equal(pg.json("select to_json(count(*)) from public.activities where best_efforts is null;") > 0, true, "older rows stay null");
  });

  test("best efforts are owner-only like the rest of the row", () => {
    assert.equal(pg.json("select to_json(count(*)) from public.activities where best_efforts is not null;", asB), 0);
    const update = pg.json(`with u as (update public.activities set best_efforts = '[]'::jsonb returning 1) select to_json(count(*)) from u;`, asB);
    assert.equal(update, 0);
    assert.ok(pg.json("select to_json(count(*)) from public.activities where best_efforts is not null;", asA) >= 1);
  });

  test("running it again changes nothing", () => {
    const before = pg.json(`select json_agg(pg_get_constraintdef(oid) order by conname) from pg_constraint where conrelid = 'public.activities'::regclass and conname in ('activities_sport_check', 'activities_best_efforts_check');`);
    pg.applyFile(path.join(MIGRATIONS_DIR, FILE));
    const again = pg.json(`select json_agg(pg_get_constraintdef(oid) order by conname) from pg_constraint where conrelid = 'public.activities'::regclass and conname in ('activities_sport_check', 'activities_best_efforts_check');`);
    assert.deepEqual(again, before);
    assert.equal(before.length, 2);
    assert.match(before[1], /paddle/);
  });

  test("the runbook Check query gives its pinned result", () => {
    const check = pg.json(`select json_build_object(
      'best_efforts', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'activities' and column_name = 'best_efforts'),
      'sport_check_lists_paddle', (select position('paddle' in pg_get_constraintdef(oid)) > 0 from pg_constraint where conname = 'activities_sport_check' and conrelid = 'public.activities'::regclass),
      'best_efforts_check', exists (select 1 from pg_constraint where conname = 'activities_best_efforts_check' and conrelid = 'public.activities'::regclass));`);
    assert.deepEqual(check, { best_efforts: true, sport_check_lists_paddle: true, best_efforts_check: true });
  });
});
