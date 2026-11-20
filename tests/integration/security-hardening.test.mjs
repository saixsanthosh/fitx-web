// What 20261121100040_fitx_security_hardening.sql promises, tried as a member would, with the publishable key and
// their own sign-in, on a throwaway Supabase-shaped database with every migration applied
// (tests/support/local-postgres.mjs; nothing here touches a real project):
//   * the write limit: 10,000 rows (and 50 MB) an hour per member; a statement past it is refused whole and is not
//     counted; writes without a member (the server key, Admin, sign-up) are never counted; members cannot read or
//     reset their own count; hours over two days old go, for every member, at a member's first write of an hour;
//   * the photo folder limit in fitx-user-media/<uid>/, and only there: 1,000 files, 250 MB, and 100 files under an
//     hour old (the files there now: a deleted file no longer counts);
//   * enrolments name published programmes only, and a left or completed one comes back only while its programme is
//     published; a paused one can still be resumed after its programme goes to draft;
//   * workout_sessions is no longer broadcast by Realtime.
// Skipped when the PostgreSQL server binaries (initdb, pg_ctl, psql) are not on PATH.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { LocalPostgres, available } from "../support/local-postgres.mjs";

const MEMBER = "5ec00000-0000-4000-8000-000000000001";
const OTHER = "5ec00000-0000-4000-8000-000000000002";
const JOINER = "5ec00000-0000-4000-8000-000000000003";
const CLEANER = "5ec00000-0000-4000-8000-000000000004";
const skip = available() ? false : "Postgres binaries (initdb, pg_ctl, psql) are not installed";

/** The error line psql printed, or null when the SQL ran. */
const refusal = (result) => (result.ok ? null : (result.stderr.match(/ERROR:\s+(.+)/)?.[1] ?? result.stderr));

describe("20261121100040: the security hardening as members meet it", { skip }, () => {
  /** @type {LocalPostgres} */
  let pg;
  const asMember = (sql, sub = MEMBER) => pg.run(sql, { role: "authenticated", sub });
  const count = (sql) => Number(pg.exec(sql));

  before(() => {
    pg = new LocalPostgres().start();
    pg.applyMigrations();
    pg.exec(`insert into auth.users (id, email) values ('${MEMBER}', 'limits@example.test'), ('${OTHER}', 'other@example.test'), ('${JOINER}', 'joiner@example.test'), ('${CLEANER}', 'cleaner@example.test');`);
  });

  after(() => pg?.stop());

  test("a member's writes count against an hourly limit; past it the statement is refused whole and not counted", () => {
    const rows = (n, sub = MEMBER) => `insert into public.water_logs (user_id, amount_ml) select '${sub}', 250 from generate_series(1, ${n});`;
    assert.equal(refusal(asMember(rows(9000))), null, "9,000 rows in an hour is within the limit");
    assert.equal(count(`select rows_written from public.fitx_member_write_budget where user_id = '${MEMBER}';`), 9000);
    assert.match(refusal(asMember(rows(1001))) ?? "", /write limit reached: at most 10000 rows and 50 MB an hour/);
    assert.equal(count(`select count(*) from public.water_logs where user_id = '${MEMBER}';`), 9000, "nothing of the refused statement stays");
    assert.equal(count(`select rows_written from public.fitx_member_write_budget where user_id = '${MEMBER}';`), 9000, "and it is not counted");
    assert.equal(refusal(asMember(rows(1000))), null, "up to the limit still goes through");
    assert.match(refusal(asMember(`update public.water_logs set amount_ml = 300 where id = (select id from public.water_logs where user_id = '${MEMBER}' limit 1);`)) ?? "",
      /write limit reached/, "updates count too");
    assert.equal(refusal(asMember(rows(5, OTHER), OTHER)), null, "each member has their own limit");
  });

  test("the limit counts bytes as well as rows", () => {
    const big = `insert into public.body_metrics (user_id, note) select '${OTHER}', repeat('x', 1000000) from generate_series(1, 20);`;
    assert.equal(refusal(asMember(big, OTHER)), null, "20 MB in an hour is within the limit");
    // 50 MB is 52,428,800 bytes: 20 + 33 rows of a million characters pass it.
    assert.match(refusal(asMember(big.replace("1, 20", "1, 33"), OTHER)) ?? "", /write limit reached: at most 10000 rows and 50 MB an hour/);
    assert.equal(refusal(asMember(big.replace("1, 20", "1, 30"), OTHER)), null, "what was refused was not counted");
  });

  test("writes without a member are not counted, and members can neither read nor reset their count", () => {
    const before = count("select coalesce(sum(rows_written), 0) from public.fitx_member_write_budget;");
    pg.exec(`insert into public.water_logs (user_id, amount_ml) select '${MEMBER}', 100 from generate_series(1, 20000);`);
    assert.equal(count("select coalesce(sum(rows_written), 0) from public.fitx_member_write_budget;"), before, "the server key is not limited");
    assert.match(refusal(asMember("select * from public.fitx_member_write_budget;")) ?? "", /permission denied/);
    assert.match(refusal(asMember(`delete from public.fitx_member_write_budget where user_id = '${MEMBER}';`)) ?? "", /permission denied/);
    assert.match(refusal(pg.run("select * from public.fitx_member_write_budget;", { role: "anon" })) ?? "", /permission denied/);
    assert.match(refusal(asMember("select public.fitx_member_write_budget();")) ?? "", /permission denied|trigger functions can only be called as triggers/);
  });

  test("hours over two days old are deleted for every member at a member's first write of an hour", () => {
    const hour = "date_trunc('hour', now())";
    pg.exec(`insert into public.fitx_member_write_budget (user_id, window_start, rows_written, bytes_written) values
      ('${OTHER}', ${hour} - interval '3 days', 5, 500), ('${JOINER}', ${hour} - interval '49 hours', 5, 500),
      ('${JOINER}', ${hour} - interval '47 hours', 5, 500);`);
    assert.equal(refusal(asMember(`insert into public.water_logs (user_id, amount_ml) values ('${CLEANER}', 250);`, CLEANER)), null);
    const left = (sub) => count(`select count(*) from public.fitx_member_write_budget where user_id = '${sub}' and window_start < ${hour};`);
    assert.equal(left(OTHER), 0, "another member's hour from three days ago is gone");
    assert.equal(left(JOINER), 1, "of a member who stopped writing, only the hour under two days old stays");
    assert.equal(count(`select rows_written from public.fitx_member_write_budget where user_id = '${CLEANER}';`), 1);
    pg.exec(`delete from public.fitx_member_write_budget where user_id = '${JOINER}';`);
  });

  test("a member's photo folder holds at most 1,000 files, 250 MB and 100 files under an hour old; other folders and buckets are untouched", () => {
    const upload = (name, size = 1000, sub = MEMBER) => asMember(
      `insert into storage.objects (bucket_id, name, owner_id, metadata) values ('fitx-user-media', '${sub}/${name}', '${sub}', '{"size": ${size}}');`, sub);
    const quota = /new row violates row-level security policy "fitx_media_insert_quota"/;
    assert.equal(refusal(upload("avatar-1.webp")), null);
    pg.exec(`insert into storage.objects (bucket_id, name, metadata) select 'fitx-user-media', '${MEMBER}/foods/' || g || '.webp', '{"size": 100}' from generate_series(1, 99) g;`);
    assert.match(refusal(upload("avatar-2.webp")) ?? "", quota, "the 101st upload within an hour is refused");
    pg.exec(`delete from storage.objects where name = '${MEMBER}/foods/1.webp';`);
    assert.equal(refusal(upload("avatar-2b.webp")), null, "it counts the files there now: a deleted one no longer counts");
    assert.equal(refusal(upload("avatar-1.webp", 1000, OTHER)), null, "another member's folder has its own limit");
    pg.exec(`update storage.objects set created_at = now() - interval '2 hours' where name like '${MEMBER}/%';`);
    assert.equal(refusal(upload("avatar-2.webp")), null, "an hour later uploads go through again");
    pg.exec(`update storage.objects set metadata = '{"size": 262144000}' where name = '${MEMBER}/avatar-1.webp';`);
    assert.match(refusal(upload("avatar-3.webp")) ?? "", quota, "a folder holding 250 MB takes no more");
    pg.exec(`update storage.objects set metadata = '{"size": 1000}' where name = '${MEMBER}/avatar-1.webp';`);
    pg.exec(`insert into storage.objects (bucket_id, name, metadata, created_at) select 'fitx-user-media', '${MEMBER}/old/' || g || '.webp', '{"size": 10}', now() - interval '1 day' from generate_series(1, 899) g;`);
    assert.equal(count(`select count(*) from storage.objects where name like '${MEMBER}/%';`), 1000);
    assert.match(refusal(upload("avatar-3.webp")) ?? "", quota, "a folder holding 1,000 files takes no more");
    assert.match(refusal(asMember(`insert into storage.objects (bucket_id, name) values ('fitx-user-media', '${OTHER}/sneaky.webp');`)) ?? "",
      /row-level security/, "a member still cannot write into another member's folder");
    assert.match(refusal(asMember(`insert into storage.objects (bucket_id, name) values ('exercise-media', 'x.webp');`)) ?? "",
      /row-level security/, "public buckets stay server-only");
  });

  test("a member joins only a published programme, and can still resume one that has gone back to draft", () => {
    const enrol = (programme) => `insert into public.programme_enrolments (user_id, programme_id, context, weekdays) values ('${JOINER}', '${programme}', 'gym', '{1,3,5}');`;
    pg.exec("update public.training_programmes set status = 'draft' where id = 'ppl-6';");
    assert.match(refusal(asMember(enrol("ppl-6"), JOINER)) ?? "", /programme_not_published/);
    assert.equal(refusal(asMember(enrol("ppl-3"), JOINER)), null);
    assert.match(refusal(asMember(`update public.programme_enrolments set programme_id = 'ppl-6' where user_id = '${JOINER}';`, JOINER)) ?? "", /programme_not_published/);
    assert.equal(refusal(asMember(`update public.programme_enrolments set status = 'paused' where user_id = '${JOINER}';`, JOINER)), null);
    pg.exec("update public.training_programmes set status = 'draft' where id = 'ppl-3';");
    assert.equal(refusal(asMember(`update public.programme_enrolments set status = 'active' where user_id = '${JOINER}';`, JOINER)), null, "resuming is not joining");
    const setStatus = (status) => asMember(`update public.programme_enrolments set status = '${status}' where user_id = '${JOINER}';`, JOINER);
    assert.equal(refusal(setStatus("left")), null, "leaving is always allowed");
    assert.match(refusal(setStatus("active")) ?? "", /programme_not_published/, "a left enrolment does not come back while its programme is a draft");
    assert.match(refusal(setStatus("paused")) ?? "", /programme_not_published/, "nor as paused");
    pg.exec(`update public.programme_enrolments set status = 'completed' where user_id = '${JOINER}';`);
    assert.match(refusal(setStatus("active")) ?? "", /programme_not_published/, "nor does a completed one");
    pg.exec("update public.training_programmes set status = 'published' where id = 'ppl-3';");
    assert.equal(refusal(setStatus("active")), null, "once the programme is published again it can come back");
    assert.equal(refusal(pg.run(enrol("ppl-6").replace(JOINER, OTHER))), null, "the server key is not checked");
    pg.exec("update public.training_programmes set status = 'published' where id in ('ppl-3', 'ppl-6');");
  });

  test("Realtime broadcasts no table of members' data", () => {
    assert.equal(count("select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public';"), 0);
  });
});
