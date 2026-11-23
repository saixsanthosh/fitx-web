// Runs every repo migration on a throwaway local Postgres (the Supabase stand-in in tests/support, no network, no
// real data) and checks 20261123100000_fitx_shell_prefs.sql: user_preferences.coach_launcher defaults to on, a
// member turns it off and on for themselves only, and the file can run again. Skipped when the Postgres binaries
// (initdb, pg_ctl, psql) are not on PATH.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LocalPostgres, available } from "../support/local-postgres.mjs";

const A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const B = "bbbbbbbb-0000-4000-8000-0000000000b2";
const asA = { role: "authenticated", sub: A };
const asB = { role: "authenticated", sub: B };
const FILE = "supabase/migrations/20261123100000_fitx_shell_prefs.sql";

const skip = available() ? false : "Postgres binaries (initdb, pg_ctl, psql) are not installed";

describe("shell preferences SQL on a local Postgres", { skip }, () => {
  /** @type {LocalPostgres} */
  let pg;
  /** A query's rows, as JSON. */
  const rows = (sql, options) => pg.json(`select coalesce(json_agg(q), '[]'::json) from (${sql}) q`, options);

  before(() => {
    pg = new LocalPostgres().start();
    pg.applyMigrations();
    pg.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('${A}', 'a@example.test', '{"name":"Asha"}'), ('${B}', 'b@example.test', '{"name":"Ben"}');`);
  });
  after(() => pg?.stop());

  test("the column: boolean, not null, on by default, documented", () => {
    const column = rows(`select data_type, is_nullable, column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'user_preferences' and column_name = 'coach_launcher'`)[0];
    assert.deepEqual(column, { data_type: "boolean", is_nullable: "NO", column_default: "true" });
    const comment = rows(`select col_description('public.user_preferences'::regclass, attnum) c from pg_attribute
      where attrelid = 'public.user_preferences'::regclass and attname = 'coach_launcher'`)[0];
    assert.match(comment.c, /Floating AI Coach button/);
  });

  test("a member's new preferences row has it on; they turn it off and on through their own row only", () => {
    pg.exec(`insert into public.user_preferences (user_id) values ('${A}') on conflict (user_id) do nothing;`, asA);
    assert.equal(rows(`select coach_launcher from public.user_preferences where user_id = '${A}'`, asA)[0].coach_launcher, true);
    pg.exec(`update public.user_preferences set coach_launcher = false where user_id = '${A}';`, asA);
    assert.equal(rows(`select coach_launcher from public.user_preferences where user_id = '${A}'`, asA)[0].coach_launcher, false);
    // Another member can neither read nor change it.
    assert.deepEqual(rows(`select coach_launcher from public.user_preferences where user_id = '${A}'`, asB), []);
    pg.exec(`update public.user_preferences set coach_launcher = true where user_id = '${A}';`, asB);
    assert.equal(rows(`select coach_launcher from public.user_preferences where user_id = '${A}'`)[0].coach_launcher, false);
    // The upsert the app sends (src/lib/shell/coach-launcher-pref.ts).
    pg.exec(`insert into public.user_preferences (user_id, coach_launcher, updated_at) values ('${A}', true, now())
      on conflict (user_id) do update set coach_launcher = excluded.coach_launcher, updated_at = excluded.updated_at;`, asA);
    assert.equal(rows(`select coach_launcher from public.user_preferences where user_id = '${A}'`, asA)[0].coach_launcher, true);
    assert.throws(() => pg.exec(`update public.user_preferences set coach_launcher = null where user_id = '${A}';`, asA));
  });

  test("re-runnable: applying the file again changes nothing", () => {
    pg.exec(readFileSync(FILE, "utf8"));
    assert.equal(rows(`select count(*)::int n from information_schema.columns where table_name = 'user_preferences' and column_name = 'coach_launcher'`)[0].n, 1);
    assert.equal(rows(`select coach_launcher from public.user_preferences where user_id = '${A}'`)[0].coach_launcher, true);
  });
});
