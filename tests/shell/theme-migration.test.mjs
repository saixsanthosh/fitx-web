// The account theme migration (20261118100000) on a database that already has preferences rows, as
// production does: existing rows must get no theme (NULL), so the app keeps each device's earlier choice
// instead of resetting everyone to "Match device". Skipped when the PostgreSQL server binaries are not
// on PATH (see tests/support/local-postgres.mjs).
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { LocalPostgres, available } from "../support/local-postgres.mjs";

const skip = available() ? false : "Postgres binaries (initdb, pg_ctl, psql) are not installed";
const THEME_MIGRATION = "20261118100000";
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

describe("account theme migration on existing preferences", { skip }, () => {
  /** @type {LocalPostgres} */
  let pg;

  before(() => {
    pg = new LocalPostgres().start();
    pg.applyMigrations({ before: THEME_MIGRATION });
    // An account that onboarded before the theme column existed (onboarding always creates this row).
    pg.exec(`
      insert into auth.users (id, email) values ('${A}', 'a@example.test'), ('${B}', 'b@example.test');
      insert into public.user_preferences (user_id) values ('${A}'), ('${B}');
    `);
    pg.applyMigrations({ from: THEME_MIGRATION });
  });

  after(() => pg?.stop());

  test("existing rows have no theme yet, so nothing resets a device's earlier choice", () => {
    const row = pg.json(`select json_build_object('theme', theme, 'chosen_at', theme_updated_at) from public.user_preferences where user_id = '${A}';`);
    assert.deepEqual(row, { theme: null, chosen_at: null });
  });

  test("only light, dark and system are accepted", () => {
    const bad = pg.run(`update public.user_preferences set theme = 'purple' where user_id = '${A}';`);
    assert.equal(bad.ok, false);
    assert.match(bad.stderr, /user_preferences_theme_check/);
    for (const theme of ["light", "dark", "system"]) {
      pg.exec(`update public.user_preferences set theme = '${theme}', theme_updated_at = now() where user_id = '${A}';`);
    }
  });

  test("a member saves their own theme the way the app does, and cannot change anyone else's", () => {
    pg.exec(
      `insert into public.user_preferences (user_id, theme, theme_updated_at, updated_at)
         values ('${A}', 'dark', '2026-11-18T10:00:00Z', now())
         on conflict (user_id) do update set theme = excluded.theme, theme_updated_at = excluded.theme_updated_at, updated_at = excluded.updated_at;`,
      { role: "authenticated", sub: A },
    );
    const mine = pg.json(`select json_build_object('theme', theme, 'chosen_at', theme_updated_at) from public.user_preferences where user_id = '${A}';`);
    assert.deepEqual(mine, { theme: "dark", chosen_at: "2026-11-18T10:00:00+00:00" });

    pg.exec(`update public.user_preferences set theme = 'light' where user_id = '${B}';`, { role: "authenticated", sub: A });
    const theirs = pg.exec(`select coalesce(theme, 'null') from public.user_preferences where user_id = '${B}';`);
    assert.equal(theirs, "null", "row level security keeps A out of B's row");
  });
});
