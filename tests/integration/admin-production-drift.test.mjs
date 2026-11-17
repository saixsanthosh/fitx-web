// The Admin migrations (20261118180000 to 20261118180006) on the two databases they will meet, each built in
// a throwaway local cluster (tests/support/local-postgres.mjs; nothing here touches a real project):
//   * fresh: a Supabase-shaped database (tests/support/supabase-stub.sql), the September migrations, then
//     every later migration;
//   * production: the same, except that production's three migrations that have no file in
//     supabase/migrations run right after the September migrations, in version order, as they did there.
//     They are copied byte for byte from its migration history (tests/integration/fixtures/production-drift).
//     The third is the old Admin draft ("Prepared for review only"), applied by hand: it created
//     fitx_admin_members, fitx_admin_audit_logs with actor_id referencing auth.users on delete set null, and
//     the first three Admin functions.
// The later migrations are applied in version order, one file at a time, each in one transaction, as the
// runbook applies them. Then:
//   * after each Admin file, every table and function the Admin files declare is the same on both databases
//     (columns in order, constraints, indexes, policies, triggers, privileges, row security, function
//     definitions, row counts), apart from the known difference listed below with its reason;
//   * from 20261118180000 on, the audit log has no foreign key to accounts on either database, so deleting an
//     account keeps its ID on the log (tried right after that file and after the last migration);
//   * on production, only 20261118180000 meets Admin objects that already exist: the draft's two tables and
//     their two indexes;
//   * the Admin files can be applied a second time on both without errors or changes;
//   * the Phase 10 database checks (admin/tests/database/phase10-checks.sql) pass on both;
//   * on production, while a request holds the accounts table, 20261118180000 gives up after about 3 seconds
//     and leaves nothing, rather than queue every sign-in behind its lock, and applies once the table is free.
// Skipped when the PostgreSQL server binaries (initdb, pg_ctl, psql) are not on PATH.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LocalPostgres, MIGRATIONS_DIR, available, requiresPgCron } from "../support/local-postgres.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(HERE, "fixtures", "production-drift");
const PHASE10_CHECKS = path.join(HERE, "..", "..", "admin", "tests", "database", "phase10-checks.sql");

// md5(statements[1]) of the rows in production's supabase_migrations.schema_migrations that have no file in
// supabase/migrations (read 2026-11-17).
const PRODUCTION_ONLY = {
  "20261002172610_fitx_experience_2_0.sql": "8cade9d4cc29515551260735fbcca189",
  "20261002172706_fitx_share_access_and_index.sql": "a1d1251b3971a7e63274af58ff2ca142",
  "20261116093902_fitx_admin_control_plane.sql": "91921eac9b51cdf9a279008693d51944",
};

const MIGRATIONS = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
const FIXTURES = readdirSync(FIXTURES_DIR).filter((name) => name.endsWith(".sql")).sort();
const DRIFT_FROM = FIXTURES[0].slice(0, 14);
const LATER = MIGRATIONS.filter((name) => name >= DRIFT_FROM);
const ADMIN = MIGRATIONS.filter((name) => /^2026111818000[0-6]_/.test(name));
const CONTROL_PLANE = ADMIN[0];

// What the Admin files declare, read from the files themselves.
const ADMIN_SQL = ADMIN.map((name) => readFileSync(path.join(MIGRATIONS_DIR, name), "utf8")).join("\n");
const declared = (pattern) => [...new Set([...ADMIN_SQL.matchAll(pattern)].map((match) => match[1]))].sort();
const TABLES = declared(/create table if not exists public\.([a-z0-9_]+)/g);
const FUNCTIONS = declared(/create (?:or replace )?function public\.([a-z0-9_]+)\(/g);

// What may differ between the two databases right after an Admin file, and why. Each function listed may
// differ in its definition only by whitespace.
const KNOWN_DIFFERENCES = {
  [CONTROL_PLANE]: {
    functions: ["fitx_admin_set_member(uuid, uuid, text, boolean)", "fitx_admin_set_exercise_active(uuid, text, boolean)"],
    reason:
      "it creates these two only when they are missing, so production keeps the draft's copies, which differ from its " +
      "own only in indentation; 20261118180001 replaces both on every database",
  },
};

const list = (names) => `array[${names.map((name) => `'${name}'`).join(", ")}]::text[]`;

// Everything the Admin files declare, keyed by object, so the two databases can be compared.
const SNAPSHOT = `
with
tables as (
  select c.oid, c.relname::text as name from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and c.relname = any (${list(TABLES)})
),
rels as (
  select oid, name from tables
  union all
  select s.oid, s.relname::text from pg_class s
  join pg_depend d on d.classid = 'pg_class'::regclass and d.objid = s.oid and d.refclassid = 'pg_class'::regclass
    and d.deptype in ('a', 'i')
  where s.relkind = 'S' and d.refobjid in (select oid from tables)
),
functions as (
  select p.oid, p.proname || '(' || oidvectortypes(p.proargtypes) || ')' as name from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname = any (${list(FUNCTIONS)})
)
select jsonb_build_object(
  'relation', (select coalesce(jsonb_object_agg(r.name, jsonb_build_object(
      'kind', c.relkind, 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity, 'owner', c.relowner::regrole::text,
      'acl', (select jsonb_agg(a::text order by a::text) from unnest(c.relacl) a),
      'replica_identity', c.relreplident, 'options', c.reloptions, 'comment', obj_description(c.oid, 'pg_class'))), '{}')
    from rels r join pg_class c on c.oid = r.oid),
  'column', (select coalesce(jsonb_object_agg(t.name || '.' || a.attname, jsonb_build_object(
      'position', (select count(*) from pg_attribute b where b.attrelid = a.attrelid and b.attnum between 1 and a.attnum and not b.attisdropped),
      'type', format_type(a.atttypid, a.atttypmod), 'not_null', a.attnotnull, 'default', pg_get_expr(d.adbin, d.adrelid),
      'identity', a.attidentity, 'generated', a.attgenerated,
      'acl', (select jsonb_agg(x::text order by x::text) from unnest(a.attacl) x),
      'comment', col_description(a.attrelid, a.attnum))), '{}')
    from tables t
    join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum),
  'constraint', (select coalesce(jsonb_object_agg(t.name || '.' || co.conname, jsonb_build_object(
      'definition', pg_get_constraintdef(co.oid), 'validated', co.convalidated, 'deferrable', co.condeferrable)), '{}')
    from tables t join pg_constraint co on co.conrelid = t.oid),
  'index', (select coalesce(jsonb_object_agg(i.relname, jsonb_build_object('definition', pg_get_indexdef(i.oid), 'valid', x.indisvalid)), '{}')
    from tables t join pg_index x on x.indrelid = t.oid join pg_class i on i.oid = x.indexrelid),
  'policy', (select coalesce(jsonb_object_agg(t.name || '.' || p.polname, jsonb_build_object(
      'command', p.polcmd, 'permissive', p.polpermissive,
      'roles', (select jsonb_agg(case when role_id = 0 then 'public' else role_id::regrole::text end
                                 order by case when role_id = 0 then 'public' else role_id::regrole::text end)
                from unnest(p.polroles) role_id),
      'using', pg_get_expr(p.polqual, p.polrelid), 'check', pg_get_expr(p.polwithcheck, p.polrelid))), '{}')
    from tables t join pg_policy p on p.polrelid = t.oid),
  'trigger', (select coalesce(jsonb_object_agg(t.name || '.' || tg.tgname, jsonb_build_object(
      'definition', pg_get_triggerdef(tg.oid), 'enabled', tg.tgenabled)), '{}')
    from tables t join pg_trigger tg on tg.tgrelid = t.oid and not tg.tgisinternal),
  'function', (select coalesce(jsonb_object_agg(f.name, jsonb_build_object(
      'definition', md5(pg_get_functiondef(f.oid)),
      'definition_ignoring_whitespace', md5(regexp_replace(pg_get_functiondef(f.oid), '[[:space:]]+', ' ', 'g')),
      'result', pg_get_function_result(f.oid), 'volatility', p.provolatile, 'security_definer', p.prosecdef,
      'config', p.proconfig, 'owner', p.proowner::regrole::text,
      'acl', (select jsonb_agg(a::text order by a::text) from unnest(p.proacl) a),
      'comment', obj_description(f.oid, 'pg_proc'))), '{}')
    from functions f join pg_proc p on p.oid = f.oid),
  'rows', (select coalesce(jsonb_object_agg(t.name, (xpath('/row/n/text()', query_to_xml(
      format('select count(*) as n from %s', t.oid::regclass), false, true, '')))[1]::text::bigint), '{}')
    from tables t)
)::text;`;

// The Admin tables as the draft left them, before any Admin file runs.
const DRAFT_STATE = `
select jsonb_build_object(
  'tables', (select coalesce(jsonb_agg(c.relname order by c.relname), '[]'::jsonb) from pg_class c
             where c.relnamespace = 'public'::regnamespace and c.relname in ('fitx_admin_members', 'fitx_admin_audit_logs')),
  'audit_log_foreign_keys', (select coalesce(jsonb_agg(pg_get_constraintdef(oid) order by conname), '[]'::jsonb) from pg_constraint
                             where conrelid = to_regclass('public.fitx_admin_audit_logs') and contype = 'f')
)::text;`;

const AUDIT_LOG_FOREIGN_KEYS = `
select coalesce(jsonb_agg(pg_get_constraintdef(oid) order by conname), '[]'::jsonb)::text from pg_constraint
where conrelid = to_regclass('public.fitx_admin_audit_logs') and contype = 'f';`;

// An account that appears in the audit log is deleted; its rows must keep the ID. Rolled back, so the
// database is left as it was.
const ACTOR = "a0000000-0000-4000-8000-0000000000a1";
const DELETE_AN_AUDIT_ACTOR = `
begin;
insert into auth.users (id, email) values ('${ACTOR}', 'audit-actor@example.test');
insert into public.fitx_admin_audit_logs (actor_id, action, resource_type, resource_id)
values ('${ACTOR}', 'drift_probe_recorded', 'drift_probe', 'actor');
delete from auth.users where id = '${ACTOR}';
select jsonb_build_object('actor_ids', (select jsonb_agg(actor_id) from public.fitx_admin_audit_logs
                                        where action = 'drift_probe_recorded'))::text;
rollback;`;

/** The error psql reported, from the first ERROR line on, with the migration's path shortened to its name. */
function errorText(stderr) {
  const lines = stderr.split("\n").filter((line) => !/there is (already a|no) transaction in progress/.test(line));
  const start = lines.findIndex((line) => /\bERROR:/.test(line));
  return (start === -1 ? lines : lines.slice(start))
    .map((line) => line.replace(/^psql:.*?([^/]+\.sql):(\d+): /, "$1:$2: "))
    .join("\n")
    .trim();
}

/** The "... already exists, skipping" notices psql printed while applying a file. */
const skippedNotices = (stderr) => [...stderr.matchAll(/NOTICE:\s+(.+ already exists, skipping)/g)].map((match) => match[1]);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function short(value) {
  const text = JSON.stringify(value) ?? "none";
  return text.length > 200 ? `${text.slice(0, 197)}...` : text;
}

/** One line per object that differs between two snapshots; `ignore(section, key)` names fields to leave out. */
function diff(first, second, ignore = () => []) {
  const lines = [];
  for (const section of new Set([...Object.keys(first), ...Object.keys(second)])) {
    const a = first[section] ?? {};
    const b = second[section] ?? {};
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (!(key in a)) lines.push(`only on the second: ${section} ${key}: ${short(b[key])}`);
      else if (!(key in b)) lines.push(`only on the first: ${section} ${key}: ${short(a[key])}`);
      else {
        const left = { ...a[key] };
        const right = { ...b[key] };
        for (const field of ignore(section, key)) {
          delete left[field];
          delete right[field];
        }
        if (same(left, right)) continue;
        const fields = Object.keys({ ...left, ...right }).filter((field) => !same(left[field], right[field]));
        lines.push(`${section} ${key}: ${fields.map((field) => `${field} ${short(left[field])} -> ${short(right[field])}`).join("; ")}`);
      }
    }
  }
  return lines;
}

/** Runs the audit-actor deletion; returns the actor IDs left on the log, or the error. */
function deleteAnAuditActor(pg) {
  const result = pg.run(DELETE_AN_AUDIT_ACTOR);
  if (!result.ok) return { error: errorText(result.stderr) };
  return JSON.parse(result.stdout.split("\n").filter(Boolean).pop());
}

const indent = (text) => `    ${text.replaceAll("\n", "\n    ")}`;

/**
 * Builds one database: the stand-in and the September migrations (the exercise catalogue included, as
 * production has it), production's three unrecorded migrations when `production`, then every later
 * migration one file at a time, each in one transaction. Records what the Admin files need checked.
 */
function build(pg, { production }) {
  pg.applyMigrations({ before: DRIFT_FROM, skip: /^$/ });
  if (production) for (const name of FIXTURES) pg.applyFile(path.join(FIXTURES_DIR, name), { singleTransaction: true });
  const state = {
    draft: pg.json(DRAFT_STATE),
    applied: [],
    skipped: [],
    failure: null,
    notices: {},
    after: {},
    foreignKeys: {},
    actorAfterControlPlane: null,
  };
  const cron = pg.pgCronUsable();
  for (const name of LATER) {
    const file = path.join(MIGRATIONS_DIR, name);
    if (!cron && requiresPgCron(file)) {
      state.skipped.push(name);
      continue;
    }
    const result = pg.runFile(file, { singleTransaction: true });
    if (!result.ok) {
      state.failure = { name, error: errorText(result.stderr) };
      return state;
    }
    state.applied.push(name);
    if (!ADMIN.includes(name)) continue;
    state.notices[name] = skippedNotices(result.stderr);
    state.after[name] = pg.json(SNAPSHOT);
    state.foreignKeys[name] = pg.json(AUDIT_LOG_FOREIGN_KEYS);
    if (name === CONTROL_PLANE) state.actorAfterControlPlane = deleteAnAuditActor(pg);
  }
  state.end = pg.json(SNAPSHOT);
  state.actorAtEnd = deleteAnAuditActor(pg);

  // The Admin files a second time, in order: each must apply and change nothing.
  state.rerun = {};
  for (const name of ADMIN) {
    const result = pg.runFile(path.join(MIGRATIONS_DIR, name), { singleTransaction: true });
    state.rerun[name] = result.ok ? { ok: true, changes: diff(state.end, pg.json(SNAPSHOT)) } : { ok: false, error: errorText(result.stderr) };
  }

  const checks = pg.runFile(PHASE10_CHECKS);
  state.phase10 = { ok: checks.ok, passed: checks.stdout.split("\n").filter((line) => line.startsWith("ok ")), error: checks.ok ? null : errorText(checks.stderr) };
  return state;
}

const skip = available() ? false : "Postgres binaries (initdb, pg_ctl, psql) are not installed";

test("the production fixtures are byte for byte what production's migration history holds", () => {
  assert.deepEqual(FIXTURES, Object.keys(PRODUCTION_ONLY), "one fixture per production-only history row");
  const versions = new Set(MIGRATIONS.map((name) => name.slice(0, 14)));
  for (const name of FIXTURES) {
    const md5 = createHash("md5").update(readFileSync(path.join(FIXTURES_DIR, name))).digest("hex");
    assert.equal(md5, PRODUCTION_ONLY[name], `${name} differs from md5(statements[1]) of its production history row`);
    assert.ok(!versions.has(name.slice(0, 14)), `supabase/migrations now has ${name.slice(0, 14)}: the production build here would apply it twice`);
  }
});

test("the Admin files declare the Admin tables and functions this test compares", () => {
  assert.equal(ADMIN.length, 7, ADMIN.join(", "));
  assert.deepEqual(TABLES, ["announcement_dismissals", "announcements", "fitx_admin_audit_logs", "fitx_admin_members", "support_messages", "support_requests"]);
  for (const name of ["fitx_admin_overview_metrics", "fitx_admin_set_member", "fitx_admin_set_exercise_active", "fitx_admin_actor_can", "fitx_admin_log_event", "fitx_admin_audit_logs_append_only"]) {
    assert.ok(FUNCTIONS.includes(name), name);
  }
});

describe("the Admin migrations on a fresh database and on production's schema", { skip }, () => {
  /** @type {LocalPostgres} */
  let fresh;
  /** @type {LocalPostgres} */
  let production;
  /** @type {Record<"fresh" | "production", ReturnType<typeof build>>} */
  const state = {};

  before(() => {
    fresh = new LocalPostgres().start();
    state.fresh = build(fresh, { production: false });
    production = new LocalPostgres().start();
    state.production = build(production, { production: true });
  });

  after(() => {
    fresh?.stop();
    production?.stop();
  });

  const failed = () => ["fresh", "production"].map((db) => state[db].failure && `${db}: ${state[db].failure.name}`).filter(Boolean);

  test("before the Admin files, production has the draft's tables, its audit log linked to accounts", () => {
    assert.deepEqual(state.fresh.draft, { tables: [], audit_log_foreign_keys: [] });
    assert.deepEqual(state.production.draft, {
      tables: ["fitx_admin_audit_logs", "fitx_admin_members"],
      audit_log_foreign_keys: ["FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL"],
    });
  });

  test("every later migration applies on both databases, in order, one transaction each", (t) => {
    for (const db of ["fresh", "production"]) {
      const { failure, applied, skipped } = state[db];
      for (const name of skipped) t.diagnostic(`${db}: not applied: ${name} needs pg_cron, which this PostgreSQL lacks`);
      if (failure) assert.fail(`${db}: ${failure.name} failed after ${applied.length} later migrations applied:\n${indent(failure.error)}`);
      t.diagnostic(`${db}: ${applied.length} of ${LATER.length} later migrations applied`);
    }
  });

  test("after each Admin file, everything the Admin files declare is the same on both databases", (t) => {
    if (failed().length) return t.skip(`not checked: ${failed().join(", ")} failed`);
    const problems = [];
    for (const name of ADMIN) {
      const known = KNOWN_DIFFERENCES[name];
      const allowed = (section, key) => (section === "function" && known?.functions.includes(key) ? ["definition"] : []);
      const lines = diff(state.fresh.after[name], state.production.after[name], allowed);
      if (lines.length) problems.push(`after ${name}, production (second) differs from a fresh database (first):\n${indent(lines.join("\n"))}`);
      if (known) {
        const strict = diff(state.fresh.after[name], state.production.after[name]);
        if (strict.length === lines.length) problems.push(`${name} no longer shows its known difference: remove it from KNOWN_DIFFERENCES`);
        else t.diagnostic(`known: after ${name}, ${known.functions.join(" and ")} differ only in whitespace: ${known.reason}`);
      }
    }
    assert.ok(problems.length === 0, problems.join("\n"));
  });

  test("after the last migration, everything the Admin files declare is the same on both databases", (t) => {
    if (failed().length) return t.skip(`not checked: ${failed().join(", ")} failed`);
    assert.deepEqual(diff(state.fresh.end, state.production.end), [], "production (second) differs from a fresh database (first)");
    t.diagnostic(`${TABLES.length} tables and ${Object.keys(state.fresh.end.function).length} functions compared`);
  });

  test("from 20261118180000 on, the audit log has no foreign key to accounts on either database", (t) => {
    if (failed().length) return t.skip(`not checked: ${failed().join(", ")} failed`);
    for (const db of ["fresh", "production"]) {
      for (const name of ADMIN) assert.deepEqual(state[db].foreignKeys[name], [], `${db}: after ${name}`);
    }
  });

  test("deleting an account keeps its ID on the audit log, right after 20261118180000 and at the end", (t) => {
    if (failed().length) return t.skip(`not checked: ${failed().join(", ")} failed`);
    for (const db of ["fresh", "production"]) {
      assert.deepEqual(state[db].actorAfterControlPlane, { actor_ids: [ACTOR] }, `${db}: after ${CONTROL_PLANE}`);
      assert.deepEqual(state[db].actorAtEnd, { actor_ids: [ACTOR] }, `${db}: after the last migration`);
    }
  });

  test("on production, only 20261118180000 finds Admin objects already there: the draft's tables and indexes", (t) => {
    if (failed().length) return t.skip(`not checked: ${failed().join(", ")} failed`);
    for (const name of ADMIN) assert.deepEqual(state.fresh.notices[name], [], `fresh: ${name}`);
    const adopted = {
      [CONTROL_PLANE]: [
        'relation "fitx_admin_members" already exists, skipping',
        'relation "fitx_admin_audit_logs" already exists, skipping',
        'relation "fitx_admin_audit_logs_created_at_idx" already exists, skipping',
        'relation "fitx_admin_audit_logs_actor_idx" already exists, skipping',
      ],
    };
    for (const name of ADMIN) assert.deepEqual(state.production.notices[name], adopted[name] ?? [], `production: ${name}`);
  });

  test("the Admin files can be applied a second time on both databases without errors or changes", (t) => {
    if (failed().length) return t.skip(`not checked: ${failed().join(", ")} failed`);
    const problems = [];
    for (const db of ["fresh", "production"]) {
      for (const [name, result] of Object.entries(state[db].rerun)) {
        if (!result.ok) problems.push(`${db}: ${name} fails when applied a second time:\n${indent(result.error)}`);
        else if (result.changes.length) problems.push(`${db}: ${name} changes the database when applied a second time:\n${indent(result.changes.join("\n"))}`);
      }
    }
    assert.ok(problems.length === 0, problems.join("\n"));
  });

  test("the Phase 10 database checks pass on both databases", (t) => {
    if (failed().length) return t.skip(`not checked: ${failed().join(", ")} failed`);
    const expected = readFileSync(PHASE10_CHECKS, "utf8").split("\n").filter((line) => line.startsWith("\\echo ok ")).map((line) => line.slice("\\echo ".length));
    for (const db of ["fresh", "production"]) {
      const { ok, passed, error } = state[db].phase10;
      assert.ok(ok, `${db}: ${error}`);
      assert.deepEqual(passed, expected, db);
    }
    t.diagnostic(`${expected.length} groups of checks passed on both`);
  });
});

// On production, 20261118180000 drops the draft's key from the audit log to accounts. That locks auth.users until the
// file commits, and every sign-in, token refresh and account lookup waits for the lock. So while a request holds the
// table, the file must give up after its 3-second lock_timeout and leave nothing, instead of queueing them all behind
// it for as long as the request lasts; and it must apply once the table is free (the runbook: run it again).
describe("20261118180000 on production while a request holds the accounts table", { skip }, () => {
  /** @type {LocalPostgres} */
  let pg;
  /** @type {import("node:child_process").ChildProcess | null} */
  let request = null;
  const holdsAccounts = () => pg.json(`
    select to_json(exists (select 1 from pg_locks where relation = 'auth.users'::regclass and granted and pid <> pg_backend_pid()))::text;`);
  const until = async (condition, what) => {
    for (let waited = 0; !condition(); waited += 50) {
      assert.ok(waited < 10000, what);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  before(() => {
    pg = new LocalPostgres().start();
    pg.applyMigrations({ before: DRIFT_FROM, skip: /^$/ });
    for (const name of FIXTURES) pg.applyFile(path.join(FIXTURES_DIR, name), { singleTransaction: true });
  });

  after(() => {
    request?.kill();
    pg?.stop();
  });

  test("it waits about 3 seconds, stops with the draft's key still there, and applies once the table is free", async () => {
    // A request that has read auth.users in a transaction that stays open for a minute.
    request = spawn("psql", ["-h", pg.socket, "-U", "postgres", "-d", "postgres", "-X", "-q", "-c",
      "begin; lock table auth.users in access share mode; select pg_sleep(60);"], { stdio: "ignore", env: { ...process.env, LC_ALL: "C", LANG: "C" } });
    await until(holdsAccounts, "the request never got its lock on auth.users");
    const started = Date.now();
    const busy = pg.runFile(path.join(MIGRATIONS_DIR, CONTROL_PLANE), { singleTransaction: true });
    const waited = Date.now() - started;
    assert.equal(busy.ok, false, "it must not wait for the request to end");
    assert.match(errorText(busy.stderr), /canceling statement due to lock timeout/);
    assert.ok(waited >= 2500 && waited < 20000, `it gave up after ${waited} ms`);
    assert.deepEqual(pg.json(AUDIT_LOG_FOREIGN_KEYS), ["FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL"], "nothing of the file stayed");
    pg.exec("select pg_terminate_backend(pid) from pg_locks where relation = 'auth.users'::regclass and pid <> pg_backend_pid();");
    await until(() => !holdsAccounts(), "the request still holds auth.users");
    const free = pg.runFile(path.join(MIGRATIONS_DIR, CONTROL_PLANE), { singleTransaction: true });
    assert.equal(free.ok, true, errorText(free.stderr));
    assert.deepEqual(pg.json(AUDIT_LOG_FOREIGN_KEYS), [], "applied again once the table is free, it drops the key");
  });
});
