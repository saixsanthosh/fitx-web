// Production's database is more than supabase/migrations. Three changes were applied to it by hand and recorded
// in its migration history with no file in the repository; tests/integration/fixtures/production-drift holds
// them byte for byte:
//   20261002172610 fitx_experience_2_0          exercise_library extras, five new tables, get_activity_share(),
//                                                and columns on the workout tables and custom_foods;
//   20261002172706 fitx_share_access_and_index  get_activity_share() for signed-out visitors only, one index;
//   20261116093902 fitx_admin_control_plane     the old Codex Admin draft.
// This test builds two throwaway databases and applies every later migration to both, in version order, one
// file at a time, each in one transaction, as the owner will apply them to production:
//   fresh:      the Supabase stand-in, the 14 September migrations (with the exercise catalogue), the rest;
//   production: the same, with the three hand-applied changes right after the September migrations.
// Where those changes overlap with pending files (the four workout tables, custom_foods, and the Admin tables
// and functions: ELSEWHERE_TABLES), the differences belong to those files and are left out here. Everywhere
// else, the pending files must leave production exactly like the fresh database, apart from experience 2.0's
// leftovers (LEFTOVERS), which they must leave as they found them. Applying them all again must change nothing.
// Skipped when the PostgreSQL server binaries (initdb, pg_ctl, psql) are not on PATH.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LocalPostgres, MIGRATIONS_DIR, SUPABASE_STUB, available, requiresPgCron } from "../support/local-postgres.mjs";

const DRIFT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "production-drift");
const DRIFT = readdirSync(DRIFT_DIR).filter((name) => name.endsWith(".sql")).sort();
const MIGRATIONS = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
// Production's history: the September migrations, then the three hand-applied changes. Every later file is pending.
const APPLIED = MIGRATIONS.filter((name) => name < DRIFT[0]);
const PENDING = MIGRATIONS.filter((name) => name > DRIFT[0]);

// md5(statements[1]) of each hand-applied row in production's supabase_migrations.schema_migrations (2026-11-17).
const PRODUCTION_MD5 = {
  "20261002172610_fitx_experience_2_0.sql": "8cade9d4cc29515551260735fbcca189",
  "20261002172706_fitx_share_access_and_index.sql": "a1d1251b3971a7e63274af58ff2ca142",
  "20261116093902_fitx_admin_control_plane.sql": "91921eac9b51cdf9a279008693d51944",
};

// Where the hand-applied changes overlap with pending files: pause timing and targets on the workout tables
// (20261115100000, 20261115110000), Nutrition v2 on custom_foods (20261118140001) and the Admin draft's tables
// and functions (20261118180000 to 20261118180002). Not compared here.
const ELSEWHERE_TABLES = new Set(["workout_sessions", "workout_sets", "workout_plan_exercises", "workout_session_exercises", "custom_foods"]);
const ELSEWHERE_PREFIX = "fitx_admin_";
const elsewhere = (name) => typeof name === "string" && (ELSEWHERE_TABLES.has(name) || name.startsWith(ELSEWHERE_PREFIX));

// What experience 2.0 (20261002172610, 20261002172706) left on production outside those tables, and no migration
// in the repository creates. Nothing in the app, Admin, the scripts or the pending migrations reads or writes it,
// and production has no rows in any of it (2026-11-17). Whether to keep it, lock it down or drop it is the owner's
// decision; until a migration settles it, production ends with exactly these extras. Remove an entry when one does.
const LEFTOVERS = [
  {
    what:
      "the tables food_favorites, outdoor_activities, activity_shares and user_release_reads (exercise_favorites was adopted by " +
      "20261119100020), with their " +
      "columns, keys, checks, indexes, owner-only policies and grants: signed-in members can write their own rows, and " +
      "signed-out visitors hold every table privilege but no policy lets them reach a row",
    pattern: /^(relation|column|constraint|index|policy|trigger|rows) public\.(food_favorites|outdoor_activities|activity_shares|user_release_reads)(\.|$)/,
  },
  {
    what: "exercise_library.aliases, tags, form_cues, common_mistakes (text[], empty) and breathing (text, null) on every exercise",
    pattern: /^column public\.exercise_library\.(aliases|tags|form_cues|common_mistakes|breathing)$/,
  },
  {
    what:
      "get_activity_share(text): runs as its owner and signed-out visitors can call it (the runbook's Final 3 lists it); " +
      "it returns the route coordinates saved in activity_shares for a share token",
    pattern: /^function public\.get_activity_share\(p_token text\)$/,
  },
];
const leftover = (key) => LEFTOVERS.find((entry) => entry.pattern.test(key));

// Everything a migration can shape in public, storage and auth, one entry per object: { obj, value }. `obj` is
// the table an entry belongs to, or the function's, type's or bucket's own name.
const SNAPSHOT = `
with
extension_members as (select objid from pg_depend where deptype = 'e'),
rels as (
  select c.oid, n.nspname || '.' || c.relname as name, c.relname::text as obj, c.relkind
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'storage', 'auth') and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
    and c.oid not in (select objid from extension_members)
),
items (key, obj, value) as (
  select 'relation ' || r.name, r.obj, jsonb_build_object(
      'kind', c.relkind, 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity, 'options', c.reloptions,
      'owner', c.relowner::regrole::text, 'acl', (select jsonb_agg(a::text order by a::text) from unnest(c.relacl) a),
      'comment', obj_description(c.oid, 'pg_class'))
  from rels r join pg_class c on c.oid = r.oid
  union all
  select 'column ' || r.name || '.' || a.attname, r.obj, jsonb_build_object(
      'type', format_type(a.atttypid, a.atttypmod), 'not_null', a.attnotnull, 'default', pg_get_expr(d.adbin, d.adrelid),
      'identity', a.attidentity, 'generated', a.attgenerated,
      'acl', (select jsonb_agg(x::text order by x::text) from unnest(a.attacl) x),
      'comment', col_description(a.attrelid, a.attnum))
  from rels r
  join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  union all
  select 'constraint ' || r.name || '.' || co.conname, r.obj,
    jsonb_build_object('definition', pg_get_constraintdef(co.oid), 'validated', co.convalidated)
  from rels r join pg_constraint co on co.conrelid = r.oid
  union all
  select 'index ' || r.name || '.' || i.relname, r.obj, jsonb_build_object('definition', pg_get_indexdef(i.oid), 'valid', x.indisvalid)
  from rels r join pg_index x on x.indrelid = r.oid join pg_class i on i.oid = x.indexrelid
  union all
  select 'policy ' || r.name || '.' || p.polname, r.obj, jsonb_build_object(
      'command', p.polcmd, 'permissive', p.polpermissive,
      'roles', (select jsonb_agg(case when role_id = 0 then 'public' else role_id::regrole::text end
                                 order by case when role_id = 0 then 'public' else role_id::regrole::text end)
                from unnest(p.polroles) role_id),
      'using', pg_get_expr(p.polqual, p.polrelid), 'check', pg_get_expr(p.polwithcheck, p.polrelid))
  from rels r join pg_policy p on p.polrelid = r.oid
  union all
  select 'trigger ' || r.name || '.' || t.tgname, r.obj, jsonb_build_object('definition', pg_get_triggerdef(t.oid), 'enabled', t.tgenabled)
  from rels r join pg_trigger t on t.tgrelid = r.oid and not t.tgisinternal
  union all
  select 'function ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', p.proname::text,
    jsonb_build_object(
      'definition', md5(pg_get_functiondef(p.oid)), 'security_definer', p.prosecdef, 'config', p.proconfig,
      'owner', p.proowner::regrole::text, 'acl', (select jsonb_agg(a::text order by a::text) from unnest(p.proacl) a),
      'comment', obj_description(p.oid, 'pg_proc'))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'storage', 'auth') and p.prokind in ('f', 'p') and p.oid not in (select objid from extension_members)
  union all
  select 'type ' || n.nspname || '.' || t.typname, t.typname::text, jsonb_build_object(
      'kind', t.typtype, 'base', case when t.typtype = 'd' then format_type(t.typbasetype, t.typtypmod) end,
      'labels', (select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid))
  from pg_type t join pg_namespace n on n.oid = t.typnamespace
  where n.nspname in ('public', 'storage', 'auth') and t.typtype in ('e', 'd') and t.oid not in (select objid from extension_members)
  union all
  select 'bucket ' || b.id, b.id, jsonb_build_object('public', b.public, 'file_size_limit', b.file_size_limit, 'allowed_mime_types', b.allowed_mime_types)
  from storage.buckets b
  union all
  select 'publication ' || pt.pubname || ' ' || pt.schemaname || '.' || pt.tablename, pt.tablename::text, 'true'::jsonb
  from pg_publication_tables pt
  union all
  select 'extension ' || e.extname, e.extname::text, jsonb_build_object('version', e.extversion, 'schema', e.extnamespace::regnamespace::text)
  from pg_extension e
  union all
  select 'event_trigger ' || e.evtname, e.evtname::text,
    jsonb_build_object('event', e.evtevent, 'tags', e.evttags, 'function', e.evtfoid::regproc::text, 'enabled', e.evtenabled)
  from pg_event_trigger e
  union all
  select 'default_acl ' || d.defaclrole::regrole::text || ' ' || coalesce(d.defaclnamespace::regnamespace::text, '*') || ' ' || d.defaclobjtype::text,
    null, (select jsonb_agg(a::text order by a::text) from unnest(d.defaclacl) a)
  from pg_default_acl d
  union all
  select 'rows ' || r.name, r.obj, to_jsonb((xpath('/row/n/text()', query_to_xml(
      format('select count(*) as n from %s', r.oid::regclass), false, true, '')))[1]::text::bigint)
  from rels r where r.relkind in ('r', 'p')
)
select jsonb_object_agg(key, jsonb_build_object('obj', obj, 'value', value))::text from items;`;

// The runbook's final checks (docs/runbooks/platform-database.md, section 6.1), each as one JSON array.
const FINAL_CHECKS = `
select json_build_object(
  'Final 1: public tables without row level security', (
    select coalesce(json_agg(relname order by relname), '[]') from pg_class
    where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') and not relrowsecurity),
  'Final 2: tables with row level security but no policy', (
    select coalesce(json_agg(c.relname order by c.relname), '[]') from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relrowsecurity
      and not exists (select 1 from pg_policy p where p.polrelid = c.oid)),
  'Final 3: functions that run as their owner with no fixed search path, or that signed-out visitors can call', (
    select coalesce(json_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text), '[]') from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
           or not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) as s (setting) where s.setting like 'search_path=%')))
)::text;`;

/** The error psql reported, from the first ERROR line on, with the file's path shortened to its name. */
function errorText(stderr) {
  const lines = stderr.split("\n").filter((line) => !/there is (already a|no) transaction in progress/.test(line));
  const start = lines.findIndex((line) => /\bERROR:/.test(line));
  return (start === -1 ? lines : lines.slice(start)).map((line) => line.replace(/^psql:.*?([^/]+\.sql):(\d+): /, "$1:$2: ")).join("\n").trim();
}

/** The "... already exists, skipping" notices psql printed, leaving out those about the tables checked elsewhere. */
function skippedNotices(stderr) {
  return [...stderr.matchAll(/NOTICE:\s+(.+ already exists, skipping)/g)]
    .map((match) => match[1])
    .filter((notice) => ![...notice.matchAll(/"([^"]+)"/g)].some((name) => elsewhere(name[1])));
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const short = (value) => {
  const text = JSON.stringify(value) ?? "none";
  return text.length > 200 ? `${text.slice(0, 197)}...` : text;
};
const indent = (lines) => lines.map((line) => `    ${line}`).join("\n");

/** How snapshot `b` differs from snapshot `a`, outside the tables checked elsewhere. */
function diff(a, b) {
  const onlyInA = [];
  const onlyInB = [];
  const changed = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (elsewhere((a[key] ?? b[key]).obj)) continue;
    if (!(key in b)) onlyInA.push(key);
    else if (!(key in a)) onlyInB.push(key);
    else if (!same(a[key].value, b[key].value)) changed.push(`${key}: ${short(a[key].value)} -> ${short(b[key].value)}`);
  }
  return { onlyInA: onlyInA.sort(), onlyInB: onlyInB.sort(), changed: changed.sort() };
}

/** One line per object that moved between two snapshots taken before and after something ran. */
function moves({ onlyInA, onlyInB, changed }) {
  return [...onlyInA.map((key) => `${key}: removed`), ...onlyInB.map((key) => `${key}: added`), ...changed.map((line) => `changed ${line}`)];
}

const skip = available() ? false : "Postgres binaries (initdb, pg_ctl, psql) are not installed";

describe("the pending migrations on production, which has three hand-applied changes, and on a fresh database", { skip }, () => {
  /** @typedef {{ name: string, error: string }} Failure */
  /**
   * @typedef {{
   *   pg: LocalPostgres | null, failure: Failure | null, notApplied: string[], notices: Map<string, string[]>,
   *   beforePending: Record<string, { obj: string | null, value: unknown }> | null,
   *   end: Record<string, { obj: string | null, value: unknown }> | null,
   *   finalChecks: Record<string, string[]> | null,
   * }} Database
   */
  /** @type {Database} */
  const fresh = { pg: null, failure: null, notApplied: [], notices: new Map(), beforePending: null, end: null, finalChecks: null };
  /** @type {Database} */
  const production = { pg: null, failure: null, notApplied: [], notices: new Map(), beforePending: null, end: null, finalChecks: null };
  /** Production after every pending file was applied a second time, or the file that failed then. */
  const secondRun = { failure: /** @type {Failure | null} */ (null), end: /** @type {Database["end"]} */ (null) };

  /** Applies the files in order, each in one transaction; stops at the first failure and records it. */
  function applyAll(db, dir, names, { cron, notices = true } = {}) {
    for (const name of names) {
      const file = path.join(dir, name);
      if (cron === false && requiresPgCron(file)) {
        if (!db.notApplied.includes(name)) db.notApplied.push(name);
        continue;
      }
      const result = db.pg.runFile(file, { singleTransaction: true });
      if (!result.ok) return { name, error: errorText(result.stderr) };
      if (notices) db.notices.set(name, skippedNotices(result.stderr));
    }
    return null;
  }

  function build(db, withDrift) {
    db.pg = new LocalPostgres().start();
    db.pg.applyFile(SUPABASE_STUB, { singleTransaction: true });
    // Supabase offers pg_cron; a plain local PostgreSQL usually lacks it. Both databases skip the same file.
    const cron = db.pg.pgCronUsable();
    db.failure = applyAll(db, MIGRATIONS_DIR, APPLIED, { notices: false });
    if (!db.failure && withDrift) db.failure = applyAll(db, DRIFT_DIR, DRIFT, { notices: false });
    if (db.failure) return;
    db.beforePending = db.pg.json(SNAPSHOT);
    db.failure = applyAll(db, MIGRATIONS_DIR, PENDING, { cron });
    if (db.failure) return;
    db.end = db.pg.json(SNAPSHOT);
    db.finalChecks = db.pg.json(FINAL_CHECKS);
    return cron;
  }

  before(() => {
    build(fresh, false);
    const cron = build(production, true);
    if (production.end) {
      secondRun.failure = applyAll(production, MIGRATIONS_DIR, PENDING, { cron, notices: false });
      if (!secondRun.failure) secondRun.end = production.pg.json(SNAPSHOT);
    }
  });

  after(() => {
    fresh.pg?.stop();
    production.pg?.stop();
  });

  const notBuilt = () => [fresh, production].find((db) => db.failure);
  const skipReason = () => {
    const db = notBuilt();
    return db ? `not checked: ${db.failure.name} failed on the ${db === fresh ? "fresh" : "production"} database` : null;
  };

  test("the three hand-applied changes are byte for byte what production recorded", () => {
    assert.deepEqual(DRIFT, Object.keys(PRODUCTION_MD5), "production's history has exactly these three rows with no file in supabase/migrations");
    for (const name of DRIFT) {
      const md5 = createHash("md5").update(readFileSync(path.join(DRIFT_DIR, name))).digest("hex");
      assert.equal(md5, PRODUCTION_MD5[name], `${name} differs from production's statements[1]; copy it again, read-only, from the history`);
    }
  });

  test("every pending migration applies on both, in order, each in one transaction", (t) => {
    for (const db of [fresh, production]) {
      const label = db === fresh ? "fresh database" : "production";
      if (db.failure) {
        assert.fail(`${label}: ${db.failure.name} failed:\n${indent(db.failure.error.split("\n"))}`);
      }
      for (const name of db.notApplied) t.diagnostic(`${label}: not applied: ${name} (needs pg_cron, which this PostgreSQL lacks)`);
    }
    t.diagnostic(`${APPLIED.length} migrations already in production, ${DRIFT.length} hand-applied changes, ${PENDING.length} pending`);
  });

  test("no pending migration finds an object of its own already made by a hand-applied change", (t) => {
    if (notBuilt()) return t.skip(skipReason());
    const problems = [];
    for (const name of PENDING) {
      const extra = (production.notices.get(name) ?? []).filter((notice) => !(fresh.notices.get(name) ?? []).includes(notice));
      for (const notice of extra) {
        problems.push(`${name}: ${notice} on production only: the file keeps experience 2.0's definition instead of its own; make it drift-aware`);
      }
    }
    assert.ok(problems.length === 0, problems.join("\n"));
  });

  test("production ends like the fresh database, apart from experience 2.0's leftovers", (t) => {
    if (notBuilt()) return t.skip(skipReason());
    const { onlyInA: onlyFresh, onlyInB: onlyProduction, changed } = diff(fresh.end, production.end);
    const problems = [
      ...onlyFresh.map((key) => `${key}: a pending migration makes it on a fresh database but not on production (did it skip an object of the same name?)`),
      ...changed.map((line) => `${line} (fresh -> production): a pending migration ends differently on production`),
      ...onlyProduction.filter((key) => !leftover(key)).map(
        (key) => `${key}: only on production. If a hand-applied change made it and nothing uses it, list it in LEFTOVERS with the reason; if a pending migration should make or remove it, fix that migration`,
      ),
    ];
    for (const entry of LEFTOVERS) {
      const keys = onlyProduction.filter((key) => entry.pattern.test(key));
      if (keys.length === 0) problems.push(`LEFTOVERS lists ${entry.what}, but production no longer differs there: remove the entry`);
      else t.diagnostic(`left for the owner: ${entry.what} (${keys.length} ${keys.length === 1 ? "object" : "objects"})`);
    }
    assert.ok(problems.length === 0, problems.join("\n"));
  });

  test("the pending migrations leave experience 2.0's leftovers as they found them", (t) => {
    if (notBuilt()) return t.skip(skipReason());
    const only = (snapshot) => Object.fromEntries(Object.entries(snapshot).filter(([key]) => leftover(key)));
    const touched = moves(diff(only(production.beforePending), only(production.end)));
    assert.ok(
      touched.length === 0,
      `the pending migrations changed experience 2.0's leftovers, which are the owner's to decide about:\n${indent(touched)}`,
    );
    t.diagnostic(`${Object.keys(only(production.end)).length} leftover objects unchanged`);
  });

  test("the runbook's final checks agree on both, except get_activity_share in Final 3", (t) => {
    if (notBuilt()) return t.skip(skipReason());
    const final3 = Object.keys(fresh.finalChecks).find((label) => label.startsWith("Final 3"));
    assert.deepEqual(fresh.finalChecks[final3], [], "on a fresh database Final 3 lists no function");
    assert.deepEqual(production.finalChecks[final3], ["get_activity_share(text)"], "on production Final 3 lists only experience 2.0's share function");
    assert.deepEqual({ ...production.finalChecks, [final3]: [] }, fresh.finalChecks);
  });

  test("applied a second time, the pending migrations change nothing more on production", (t) => {
    if (notBuilt()) return t.skip(skipReason());
    if (secondRun.failure) assert.fail(`${secondRun.failure.name} fails when applied again on production:\n${indent(secondRun.failure.error.split("\n"))}`);
    const moved = moves(diff(production.end, secondRun.end));
    assert.ok(moved.length === 0, `the second run moved production away from where the first one left it:\n${indent(moved)}`);
  });
});
