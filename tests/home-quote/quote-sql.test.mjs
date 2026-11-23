// Runs every repo migration on a throwaway local Postgres (the Supabase stand-in in tests/support, no network,
// no real data) and checks migration 20261123100010: the quote library matches src/data/quotes.ts, each member
// gets one quote a day that stays the same all day, never one they saw before while unseen ones remain, the
// oldest seen quote after the library is used up, and nobody reads or writes another member's history.
// Skipped when the Postgres binaries (initdb, pg_ctl, psql) are not on PATH.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { LocalPostgres, MIGRATIONS_DIR, available } from "../support/local-postgres.mjs";
import { QUOTES } from "@/data/quotes";

const A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const B = "bbbbbbbb-0000-4000-8000-0000000000b2";
const asA = { role: "authenticated", sub: A };
const asB = { role: "authenticated", sub: B };
const FILE = path.join(MIGRATIONS_DIR, "20261123100010_fitx_onboarding_v4.sql");

const skip = available() ? false : "Postgres binaries (initdb, pg_ctl, psql) are not installed";

describe("daily quote SQL on a local Postgres", { skip }, () => {
  /** @type {LocalPostgres} */
  let pg;
  let today;
  const quoteFor = (date, as, avoid = "{}") => pg.json(`select to_json(q) from public.fitx_daily_quote('${date}', '${avoid}') q`, as);
  const day = (offset) => pg.exec(`select ((now() at time zone 'utc')::date + ${offset})::text`);

  before(() => {
    pg = new LocalPostgres().start();
    pg.applyMigrations();
    pg.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('${A}', 'a@example.test', '{"name":"Asha"}'), ('${B}', 'b@example.test', '{"name":"Ben"}');`);
    today = day(0);
  });

  after(() => pg?.stop());

  test("the migration runs again without error and keeps one row per quote", () => {
    pg.applyFile(FILE, { singleTransaction: true });
    assert.equal(pg.exec("select count(*) from public.daily_quotes"), String(QUOTES.length));
  });

  test("the library is exactly src/data/quotes.ts, in the same order", () => {
    const rows = pg.json("select json_agg(json_build_object('id', id, 'text', text, 'author', author, 'source', source, 'theme', theme, 'scene', scene) order by position) from public.daily_quotes");
    assert.deepEqual(rows, QUOTES.map(({ id, text, author, source, theme, scene }) => ({ id, text, author, source, theme, scene })));
  });

  test("a member gets one quote a day: the same on every call, a new one on a new day", () => {
    const first = quoteFor(today, asA);
    assert.ok(first && QUOTES.some((quote) => quote.id === first.quote_id && quote.text === first.text), JSON.stringify(first));
    assert.equal(first.local_date, today);
    assert.equal(quoteFor(today, asA).quote_id, first.quote_id, "a reload or a new sign-in gets the same quote");
    const tomorrow = quoteFor(day(1), asA);
    assert.notEqual(tomorrow.quote_id, first.quote_id, "the next day brings a different quote");
    assert.equal(pg.exec(`select count(*) from public.daily_quote_history where user_id = '${A}'`), "2");
  });

  test("days too far from today are refused, and so is a visitor", () => {
    const far = pg.run(`select * from public.fitx_daily_quote('${day(5)}')`, asA);
    assert.equal(far.ok, false);
    assert.match(far.stderr, /too far from today/);
    const anon = pg.run(`select * from public.fitx_daily_quote('${today}')`, { role: "anon" });
    assert.equal(anon.ok, false);
    assert.match(anon.stderr, /permission denied/);
  });

  test("members read only their own history and cannot write it directly", () => {
    quoteFor(today, asB);
    assert.equal(pg.exec(`select count(*) from public.daily_quote_history where user_id = '${A}'`, asB), "0");
    assert.equal(pg.exec("select count(*) from public.daily_quote_history", asB), "1");
    const insert = pg.run(`insert into public.daily_quote_history (user_id, local_date, quote_id) values ('${B}', '${day(-1)}', 'dis-001')`, asB);
    assert.equal(insert.ok, false);
    assert.match(insert.stderr, /permission denied/);
    const library = pg.run("update public.daily_quotes set text = 'x' where id = 'dis-001'", asB);
    assert.equal(library.ok, false);
  });

  test("quotes this browser showed before the migration are avoided while others remain", () => {
    pg.exec(`delete from public.daily_quote_history where user_id = '${B}'`);
    const allButOne = QUOTES.filter((quote) => quote.id !== "rec-010").map((quote) => quote.id);
    const pick = quoteFor(today, asB, `{${allButOne.join(",")}}`);
    assert.equal(pick.quote_id, "rec-010");
  });

  test("after every quote has been seen, the one seen longest ago comes back and moves to the new day", () => {
    pg.exec(`delete from public.daily_quote_history where user_id = '${B}';
      insert into public.daily_quote_history (user_id, local_date, quote_id)
      select '${B}', date '2020-01-01' + (position - 1), id from public.daily_quotes;`);
    const oldest = pg.exec("select id from public.daily_quotes order by position limit 1");
    const pick = quoteFor(today, asB);
    assert.equal(pick.quote_id, oldest);
    assert.equal(pg.exec(`select count(*) from public.daily_quote_history where user_id = '${B}'`), String(QUOTES.length));
    assert.equal(pg.exec(`select local_date::text from public.daily_quote_history where user_id = '${B}' and quote_id = '${oldest}'`), today);
  });

  test("history joins the write budget and goes with the account", () => {
    assert.equal(pg.exec("select count(*) from pg_trigger where tgrelid = 'public.daily_quote_history'::regclass and tgname like 'fitx_write_budget_%'"), "2");
    assert.equal(pg.exec("select prosecdef::text || ' ' || array_to_string(proconfig, ',') from pg_proc where proname = 'fitx_daily_quote'"), "true search_path=\"\"");
    pg.exec(`delete from auth.users where id = '${A}'`);
    assert.equal(pg.exec(`select count(*) from public.daily_quote_history where user_id = '${A}'`), "0");
  });
});
