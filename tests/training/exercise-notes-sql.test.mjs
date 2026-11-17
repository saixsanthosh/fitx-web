// Runs every repo migration on a throwaway local Postgres (the Supabase stand-in in tests/support, no network, no
// real data) and checks exercise_notes (20261119100010) as signed-in members: each member reads and writes only
// their own notes, one per exercise, 1 to 500 characters; notes go with the account; a note on a merged duplicate
// follows it to the kept exercise; the file can run again. Also checks that every members' table pointing at an
// exercise is in scripts/catalog/migration.mjs's list of tables that follow merges.
// Skipped when the Postgres binaries (initdb, pg_ctl, psql) are not on PATH.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { LocalPostgres, MIGRATIONS_DIR, available } from "../support/local-postgres.mjs";
import { MERGE_REPOINT_TABLES } from "../../scripts/catalog/migration.mjs";

const A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const B = "bbbbbbbb-0000-4000-8000-0000000000b2";
const asA = { role: "authenticated", sub: A };
const asB = { role: "authenticated", sub: B };
const asAnon = { role: "anon" };
const FILE = path.join(MIGRATIONS_DIR, "20261119100010_fitx_exercise_notes.sql");

const skip = available() ? false : "Postgres binaries (initdb, pg_ctl, psql) are not installed";

describe("exercise notes", { skip }, () => {
  /** @type {LocalPostgres} */
  let pg;
  const notes = (who) => pg.json("select coalesce(json_agg(json_build_object('user', user_id, 'exercise', exercise_id, 'body', body) order by user_id, exercise_id), '[]') from public.exercise_notes;", who);
  const quote = (text) => `'${text.replace(/'/g, "''")}'`;
  const write = (who, exercise, body, user = who.sub) => pg.run(`insert into public.exercise_notes (user_id, exercise_id, body) values ('${user}', '${exercise}', ${quote(body)})
    on conflict (user_id, exercise_id) do update set body = excluded.body, updated_at = now();`, who);

  before(() => {
    pg = new LocalPostgres().start();
    pg.applyMigrations();
    pg.exec(`insert into auth.users (id, email) values ('${A}', 'notes-a@example.test'), ('${B}', 'notes-b@example.test');`);
  });

  after(() => pg?.stop());

  test("a member writes, reads, changes and deletes only their own notes", () => {
    assert.ok(write(asA, "bench_press", "Seat on 4, pin at 7").ok);
    assert.ok(write(asA, "bench_press", "Seat on 5").ok, "a second save replaces the note");
    assert.ok(write(asB, "push_up", "Hands on the marks").ok);
    assert.deepEqual(notes(asA), [{ user: A, exercise: "bench_press", body: "Seat on 5" }]);
    assert.deepEqual(notes(asB), [{ user: B, exercise: "push_up", body: "Hands on the marks" }]);

    const forged = write(asB, "squat", "Not mine", A);
    assert.ok(!forged.ok && /row-level security/i.test(forged.stderr), `writing as someone else is refused: ${forged.stderr}`);
    assert.equal(pg.exec(`update public.exercise_notes set body = 'Changed' where user_id = '${A}' returning 1;`, asB), "", "another member's note is not changed");
    assert.equal(pg.exec(`delete from public.exercise_notes where user_id = '${A}' returning 1;`, asB), "", "nor deleted");
    assert.deepEqual(notes(asA), [{ user: A, exercise: "bench_press", body: "Seat on 5" }]);

    // Like the other members' tables, only row level security stands between visitors and the rows: no policy
    // lets them see or add any.
    assert.equal(pg.exec("select count(*) from public.exercise_notes;", asAnon), "0", "signed-out visitors see no notes");
    const visitorWrite = write(asAnon, "bench_press", "Visitor", A);
    assert.ok(!visitorWrite.ok && /row-level security/i.test(visitorWrite.stderr), `signed-out visitors cannot add notes: ${visitorWrite.stderr}`);

    assert.equal(pg.exec(`delete from public.exercise_notes where exercise_id = 'push_up' returning 1;`, asB), "1");
    assert.deepEqual(notes(asB), []);
  });

  test("1 to 500 characters, not blank, on an exercise in the catalogue", () => {
    assert.ok(write(asB, "plank", "x".repeat(500)).ok, "500 characters");
    assert.ok(write(asB, "plank", "💪".repeat(500)).ok, "500 emoji are 500 characters");
    for (const body of ["x".repeat(501), "", "   "]) {
      const result = write(asB, "plank", body);
      assert.ok(!result.ok && /violates check constraint/i.test(result.stderr), `refused: ${JSON.stringify(body.slice(0, 5))} (${body.length})`);
    }
    const unknown = write(asB, "no_such_exercise", "Seat on 4");
    assert.ok(!unknown.ok && /foreign key/i.test(unknown.stderr), "only catalogue exercises");
  });

  test("notes go when the account is deleted", () => {
    const C = "cccccccc-0000-4000-8000-0000000000c3";
    pg.exec(`insert into auth.users (id, email) values ('${C}', 'notes-c@example.test');`);
    assert.ok(write({ role: "authenticated", sub: C }, "bench_press", "Gone soon").ok);
    pg.exec(`delete from auth.users where id = '${C}';`);
    assert.equal(pg.exec(`select count(*) from public.exercise_notes where user_id = '${C}';`), "0");
  });

  test("a note on a merged duplicate follows it to the kept exercise; one already there stays; running the file again changes nothing else", () => {
    pg.exec(`insert into public.exercise_library (id, name, primary_muscle, difficulty, movement_pattern, is_active, merged_into)
      values ('test_dup_bench', 'Duplicate bench press (test)', 'chest', 'beginner', 'push', true, null);`);
    assert.ok(write(asA, "test_dup_bench", "From the duplicate").ok);
    assert.ok(write(asB, "test_dup_bench", "B's duplicate note").ok);
    // The clean-up hides the duplicate and points it at the kept exercise.
    pg.exec(`update public.exercise_library set is_active = false, merged_into = 'bench_press' where id = 'test_dup_bench';`);
    const before = notes();
    pg.applyFile(FILE);
    const afterRun = notes();
    assert.deepEqual(afterRun.filter((note) => note.user === B), [{ user: B, exercise: "bench_press", body: "B's duplicate note" }, { user: B, exercise: "plank", body: "💪".repeat(500) }].sort((x, y) => x.exercise.localeCompare(y.exercise)));
    assert.deepEqual(afterRun.filter((note) => note.user === A), [
      { user: A, exercise: "bench_press", body: "Seat on 5" },
      { user: A, exercise: "test_dup_bench", body: "From the duplicate" },
    ], "A's note on the kept exercise stays, so the duplicate's stays where it is");
    assert.notDeepEqual(before, afterRun);
    pg.applyFile(FILE);
    assert.deepEqual(notes(), afterRun, "a second run changes nothing");
  });

  test("row level security is on, with one owner policy for signed-in members", () => {
    const facts = pg.json(`select json_build_object(
      'rls', (select relrowsecurity from pg_class where oid = 'public.exercise_notes'::regclass),
      'policies', (select json_agg(json_build_object('name', policyname, 'roles', roles::text[], 'command', cmd) order by policyname)
        from pg_policies where schemaname = 'public' and tablename = 'exercise_notes'),
      'members', (select bool_and(has_table_privilege('authenticated', 'public.exercise_notes', p)) from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p));`);
    assert.deepEqual(facts, { rls: true, policies: [{ name: "exercise_notes_owner", roles: ["authenticated"], command: "ALL" }], members: true });
  });

  test("every members' table that points at an exercise follows merges (scripts/catalog/migration.mjs)", () => {
    const tables = pg.json(`select coalesce(json_agg(c.table_name order by c.table_name), '[]') from information_schema.columns c
      where c.table_schema = 'public' and c.column_name = 'exercise_id'
        and exists (select 1 from information_schema.columns u where u.table_schema = 'public' and u.table_name = c.table_name and u.column_name = 'user_id');`);
    assert.deepEqual(tables, MERGE_REPOINT_TABLES.map(({ table }) => table).sort());
  });
});
