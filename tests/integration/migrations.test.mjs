// Every migration in supabase/migrations, applied the way the owner will apply them to production: in
// version order, one file at a time, each in a single transaction, on a fresh database shaped like a
// Supabase project (tests/support/supabase-stub.sql). Then:
//   * every migration is applied a second time, in order, and must neither fail nor move the database
//     away from the fully migrated state (tables, columns, constraints, indexes, policies, triggers,
//     functions, grants, comments, row counts), except the problems listed below with their reason;
//   * every table in public must have row level security on and at least one policy, except the tables
//     listed below with the reason they need none.
// The first migration that fails stops the run: later ones may depend on it, so they are not applied
// and the checks that need the whole schema are skipped with the reason.
// Skipped when the PostgreSQL server binaries (initdb, pg_ctl, psql) are not on PATH.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { LocalPostgres, MIGRATIONS_DIR, SUPABASE_STUB, available, requiresPgCron } from "../support/local-postgres.mjs";

const MIGRATIONS = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
const CRON_MIGRATIONS = MIGRATIONS.filter((name) => requiresPgCron(path.join(MIGRATIONS_DIR, name)));
const NO_CRON =
  "needs the pg_cron extension, which Supabase provides and this local PostgreSQL does not have installed and preloaded";

// Tables that have row level security on but no policy, on purpose. With no policy, anon and
// authenticated can reach no row even if granted; the test also checks they hold no privileges at all.
const NO_POLICY_BY_DESIGN = {
  fitx_rate_limits: "food search quota counters; only the security definer fitx_take_food_search_quota() reads and writes them (20261117110000)",
  ai_coach_limits: "daily coach limits set by the owner; read only inside the security definer coach quota functions (20261118150000)",
  ai_coach_usage_events: "coach usage counters; written only by the security definer quota functions, so members cannot reset their own limit (20261118150000)",
  fitx_admin_audit_logs: "Admin audit log, row level security forced; read and appended by service_role (which bypasses RLS) and the security definer Admin functions (20261118180000, 20261118180002)",
  billing_provider_events: "Razorpay event log; read by service_role only and written by billing_apply_event() (20261118190000)",
  billing_reconciliation_runs: "nightly Razorpay reconciliation results; read by service_role only and written by billing_record_reconciliation() (20261118190000)",
};

// Migrations that cannot safely be applied a second time: the error they stop at, or the changes they
// make to the fully migrated database, and why that is acceptable. Both are part of the original schema
// the hosted project already has (the Phase 1 runbook's inventory builds on their tables), so Supabase's
// migration history never runs them again; they must never be pasted into the SQL editor again either.
const KNOWN_RERUN_PROBLEMS = {
  "20260924162506_initial_fitx_schema.sql": {
    changes: [
      /^added policy public\.profiles\.profiles_self: /,
      /^changed function public\.(handle_new_user|touch_updated_at)\(\): /,
      /^changed policy public\.(body_metrics|habits|meals|tasks|workouts)\.\1_owner: /,
    ],
    reason:
      "its header says it is safe to re-run, but run again it puts back its original profiles_self policy, handle_new_user() " +
      "(search_path public, unbounded metadata), touch_updated_at() without a pinned search_path and the owner policies for " +
      "workouts, meals, tasks, habits and body_metrics (to public, auth.uid() per row), undoing 20260924164105, " +
      "20260924170604 and 20261117100000",
  },
  "20260924170604_fitx_v1_core_product.sql": {
    error: /policy "user_preferences_owner" for table "user_preferences" already exists/,
    reason: "its create policy statements from user_preferences_owner on have no drop policy if exists",
  },
};

// On a fresh database every migration creates what it declares. A later migration that finds a table,
// column, index or extension already there is either re-declaring it on purpose (listed here, after
// checking both definitions match) or conflicting with the earlier one.
const KNOWN_REDECLARATIONS = {
  "20261117100000_fitx_profiles_column_privileges.sql": {
    notices: [/^column "intro_completed_at" of relation "profiles" already exists, skipping$/],
    reason: "adds profiles.intro_completed_at timestamptz exactly as 20261117090000 does, so it also works when applied without it",
  },
};

// Everything a migration can change, keyed by object, so two snapshots can be compared.
const SNAPSHOT = `
with
schemas as (
  select oid, nspname from pg_namespace
  where nspname not in ('pg_catalog', 'information_schema') and nspname !~ '^pg_(toast|temp_)'
),
extension_members as (select objid from pg_depend where deptype = 'e'),
rels as (
  select c.oid, s.nspname || '.' || c.relname as name, c.relkind
  from pg_class c join schemas s on s.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm', 'f', 'S') and c.oid not in (select objid from extension_members)
)
select jsonb_build_object(
  'schema', (select jsonb_object_agg(n.nspname, jsonb_build_object(
      'owner', n.nspowner::regrole::text,
      'acl', (select jsonb_agg(a::text order by a::text) from unnest(n.nspacl) a)))
    from pg_namespace n where n.oid in (select oid from schemas)),
  'relation', (select jsonb_object_agg(r.name, jsonb_build_object(
      'kind', c.relkind, 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity, 'options', c.reloptions,
      'owner', c.relowner::regrole::text,
      'acl', (select jsonb_agg(a::text order by a::text) from unnest(c.relacl) a),
      'comment', obj_description(c.oid, 'pg_class')))
    from rels r join pg_class c on c.oid = r.oid),
  'column', (select jsonb_object_agg(r.name || '.' || a.attname, jsonb_build_object(
      'type', format_type(a.atttypid, a.atttypmod), 'not_null', a.attnotnull, 'default', pg_get_expr(d.adbin, d.adrelid),
      'identity', a.attidentity, 'generated', a.attgenerated,
      'acl', (select jsonb_agg(x::text order by x::text) from unnest(a.attacl) x),
      'comment', col_description(a.attrelid, a.attnum)))
    from rels r
    join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum),
  'constraint', (select jsonb_object_agg(r.name || '.' || co.conname, jsonb_build_object(
      'definition', pg_get_constraintdef(co.oid), 'validated', co.convalidated))
    from rels r join pg_constraint co on co.conrelid = r.oid),
  'index', (select jsonb_object_agg(s.nspname || '.' || i.relname, pg_get_indexdef(i.oid))
    from pg_index x join pg_class i on i.oid = x.indexrelid join schemas s on s.oid = i.relnamespace
    where x.indrelid in (select oid from rels)),
  'policy', (select jsonb_object_agg(r.name || '.' || p.polname, jsonb_build_object(
      'command', p.polcmd, 'permissive', p.polpermissive,
      'roles', (select jsonb_agg(case when role_id = 0 then 'public' else role_id::regrole::text end
                                 order by case when role_id = 0 then 'public' else role_id::regrole::text end)
                from unnest(p.polroles) role_id),
      'using', pg_get_expr(p.polqual, p.polrelid), 'check', pg_get_expr(p.polwithcheck, p.polrelid)))
    from rels r join pg_policy p on p.polrelid = r.oid),
  'trigger', (select jsonb_object_agg(r.name || '.' || t.tgname, jsonb_build_object(
      'definition', pg_get_triggerdef(t.oid), 'enabled', t.tgenabled))
    from rels r join pg_trigger t on t.tgrelid = r.oid and not t.tgisinternal),
  'function', (select jsonb_object_agg(s.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
      jsonb_build_object(
        'definition', md5(pg_get_functiondef(p.oid)), 'security_definer', p.prosecdef, 'config', p.proconfig,
        'owner', p.proowner::regrole::text,
        'acl', (select jsonb_agg(a::text order by a::text) from unnest(p.proacl) a),
        'comment', obj_description(p.oid, 'pg_proc')))
    from pg_proc p join schemas s on s.oid = p.pronamespace
    where p.prokind in ('f', 'p') and p.oid not in (select objid from extension_members)),
  'type', (select jsonb_object_agg(s.nspname || '.' || t.typname, jsonb_build_object(
      'kind', t.typtype, 'base', case when t.typtype = 'd' then format_type(t.typbasetype, t.typtypmod) end,
      'labels', (select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid)))
    from pg_type t join schemas s on s.oid = t.typnamespace
    where t.typtype in ('e', 'd') and t.oid not in (select objid from extension_members)),
  'extension', (select jsonb_object_agg(e.extname, jsonb_build_object('version', e.extversion, 'schema', e.extnamespace::regnamespace::text))
    from pg_extension e),
  'event_trigger', (select jsonb_object_agg(e.evtname, jsonb_build_object('event', e.evtevent, 'function', e.evtfoid::regproc::text))
    from pg_event_trigger e),
  'publication', (select jsonb_object_agg(pt.pubname || ' ' || pt.schemaname || '.' || pt.tablename, true) from pg_publication_tables pt),
  'default_acl', (select jsonb_object_agg(d.defaclrole::regrole::text || ' ' || coalesce(d.defaclnamespace::regnamespace::text, '*') || ' ' || d.defaclobjtype::text,
      (select jsonb_agg(a::text order by a::text) from unnest(d.defaclacl) a))
    from pg_default_acl d),
  'rows', (select jsonb_object_agg(r.name, (xpath('/row/n/text()', query_to_xml(
      format('select count(*) as n from %s', r.oid::regclass), false, true, '')))[1]::text::bigint)
    from rels r where r.relkind in ('r', 'p'))
)::text;`;

const RLS = `
select jsonb_build_object(
  'tables', (select coalesce(jsonb_agg(jsonb_build_object(
      'name', c.relname, 'rls', c.relrowsecurity,
      'policies', (select count(*) from pg_policy p where p.polrelid = c.oid),
      'anon', has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate, references, trigger')
              or has_any_column_privilege('anon', c.oid, 'select, insert, update, references'),
      'authenticated', has_table_privilege('authenticated', c.oid, 'select, insert, update, delete, truncate, references, trigger')
              or has_any_column_privilege('authenticated', c.oid, 'select, insert, update, references'))
      order by c.relname), '[]'::jsonb)
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')),
  'other_relations', (select coalesce(jsonb_agg(jsonb_build_object(
      'name', c.relname, 'kind', c.relkind,
      'security_invoker', coalesce(c.reloptions @> array['security_invoker=true'], false)) order by c.relname), '[]'::jsonb)
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm', 'f'))
)::text;`;

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
function skippedNotices(stderr) {
  return [...stderr.matchAll(/NOTICE:\s+(.+ already exists, skipping)/g)].map((match) => match[1]);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function short(value) {
  const text = JSON.stringify(value) ?? "none";
  return text.length > 200 ? `${text.slice(0, 197)}...` : text;
}

/** One object's change: the fields that differ, or the whole value. */
function describeChange(a, b) {
  const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  if (!isRecord(a) || !isRecord(b)) return `${short(a)} -> ${short(b)}`;
  return Object.keys({ ...a, ...b })
    .filter((field) => !same(a[field], b[field]))
    .map((field) => `${field} ${short(a[field])} -> ${short(b[field])}`)
    .join("; ");
}

/**
 * What changed between two snapshots, one line per object. With a `reference` (the fully migrated
 * database), changes that bring an object back to it are listed apart as `restored`.
 */
function diff(before, after, reference) {
  const moved = [];
  const restored = [];
  for (const section of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[section] ?? {};
    const b = after[section] ?? {};
    const r = reference?.[section] ?? {};
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      let line;
      if (!(key in a)) line = `added ${section} ${key}: ${short(b[key])}`;
      else if (!(key in b)) line = `removed ${section} ${key}`;
      else if (!same(a[key], b[key])) line = `changed ${section} ${key}: ${describeChange(a[key], b[key])}`;
      else continue;
      (reference && same(b[key], r[key]) ? restored : moved).push(line);
    }
  }
  return { moved: moved.sort(), restored: restored.sort() };
}

const indent = (text) => `    ${text.replaceAll("\n", "\n    ")}`;

const skip = available() ? false : "Postgres binaries (initdb, pg_ctl, psql) are not installed";

test("migration files are named <14-digit version>_<name>.sql with unique versions", () => {
  const badNames = MIGRATIONS.filter((name) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(name));
  assert.deepEqual(badNames, [], "Supabase orders and records migrations by this version prefix");
  const versions = MIGRATIONS.map((name) => name.slice(0, 14));
  const duplicates = versions.filter((version, index) => versions.indexOf(version) !== index);
  assert.deepEqual(duplicates, [], "two migrations share a version: Supabase would record only one of them");
});

describe("every migration on a fresh Supabase-shaped database", { skip }, () => {
  /** @type {LocalPostgres} */
  let pg;
  let cronUsable = false;
  /** @type {Map<string, { first: { ok?: boolean, skipped?: string, error?: string, notices?: string[] }, second?: { ok: boolean, error: string | null, moved: string[], restored: string[] } }>} */
  const status = new Map();
  /** @type {{ name: string, error: string } | null} */
  let firstFailure = null;
  let rls = null;
  /** How the database differs from the fully migrated one after the second run. */
  let drift = [];

  before(() => {
    pg = new LocalPostgres().start();
    pg.applyFile(SUPABASE_STUB, { singleTransaction: true });
    cronUsable = pg.pgCronUsable();

    // First run: in order, stopping at the first failure.
    for (const name of MIGRATIONS) {
      if (!cronUsable && CRON_MIGRATIONS.includes(name)) {
        status.set(name, { first: { skipped: NO_CRON } });
        continue;
      }
      const result = pg.runFile(path.join(MIGRATIONS_DIR, name), { singleTransaction: true });
      if (!result.ok) {
        firstFailure = { name, error: errorText(result.stderr) };
        status.set(name, { first: { ok: false, error: firstFailure.error } });
        break;
      }
      status.set(name, { first: { ok: true, notices: skippedNotices(result.stderr) } });
    }
    if (firstFailure) return;
    rls = pg.json(RLS);

    // Second run: every migration again, in order. Each one is judged by what it moves away from the
    // fully migrated database; putting back what an earlier re-run changed is listed apart.
    const migrated = pg.json(SNAPSHOT);
    let previous = migrated;
    for (const name of MIGRATIONS) {
      const entry = status.get(name);
      if (entry.first.skipped) continue;
      const result = pg.runFile(path.join(MIGRATIONS_DIR, name), { singleTransaction: true });
      const next = pg.json(SNAPSHOT);
      entry.second = { ok: result.ok, error: result.ok ? null : errorText(result.stderr), ...diff(previous, next, migrated) };
      previous = next;
    }
    drift = diff(migrated, previous).moved;
  });

  after(() => pg?.stop());

  test("every migration applies, in order, each in one transaction", (t) => {
    const applied = [...status.values()].filter((entry) => entry.first.ok).length;
    for (const [name, entry] of status) if (entry.first.skipped) t.diagnostic(`not applied: ${name}: ${entry.first.skipped}`);
    if (firstFailure) {
      const notRun = MIGRATIONS.length - MIGRATIONS.indexOf(firstFailure.name) - 1;
      assert.fail(
        `${firstFailure.name} failed after the ${applied} migrations before it applied:\n${indent(firstFailure.error)}\n` +
          `The ${notRun} migrations after it were not applied. If the migration is wrong for Supabase, fix it (one already ` +
          "applied in production is never edited: add a new migration instead); if a Supabase project has something " +
          "tests/support/supabase-stub.sql lacks, add it there.",
      );
    }
    t.diagnostic(`${applied} of ${MIGRATIONS.length} migrations applied in order`);
  });

  for (const name of CRON_MIGRATIONS) {
    test(`${name} applies (needs pg_cron)`, (t) => {
      if (!cronUsable) return t.skip(`not applied here: ${NO_CRON}; nothing after it depends on it`);
      if (firstFailure && MIGRATIONS.indexOf(name) > MIGRATIONS.indexOf(firstFailure.name)) return t.skip(`not reached: ${firstFailure.name} failed first`);
      assert.equal(status.get(name)?.first.ok, true, status.get(name)?.first.error);
    });
  }

  test("no migration re-creates what an earlier one created, unless both definitions match", (t) => {
    if (firstFailure) return t.skip(`not checked: ${firstFailure.name} failed on the first run`);
    const problems = [];
    for (const [name, entry] of status) {
      const known = KNOWN_REDECLARATIONS[name];
      for (const notice of entry.first.notices ?? []) {
        if (known?.notices.some((pattern) => pattern.test(notice))) t.diagnostic(`${name}: ${notice} (${known.reason})`);
        else problems.push(`${name}: ${notice}. An earlier migration already created it: check both definitions match, then list it in KNOWN_REDECLARATIONS.`);
      }
    }
    assert.ok(problems.length === 0, problems.join("\n"));
  });

  test("every migration can be applied a second time without errors or changes", (t) => {
    if (firstFailure) return t.skip(`not checked: ${firstFailure.name} failed on the first run`);
    const problems = [];
    let clean = 0;
    for (const [name, entry] of status) {
      const { second } = entry;
      if (!second) continue;
      const known = KNOWN_RERUN_PROBLEMS[name];
      const knownError = !second.ok && known?.error?.test(second.error);
      const unexpected = second.moved.filter((line) => !known?.changes?.some((pattern) => pattern.test(line)));
      if (!second.ok && !knownError) problems.push(`${name} fails when applied a second time:\n${indent(second.error)}`);
      if (unexpected.length) problems.push(`${name} changes the migrated database when applied a second time:\n${indent(unexpected.join("\n"))}`);
      if (known && second.ok && second.moved.length === unexpected.length) problems.push(`${name} no longer shows its known re-run problem: remove it from KNOWN_RERUN_PROBLEMS`);
      if (knownError) t.diagnostic(`cannot be re-run (known): ${name}: ${second.error.split("\n")[0]}: ${known.reason}`);
      if (known?.changes && second.moved.length > unexpected.length) {
        t.diagnostic(`unsafe to re-run (known): ${name}: ${known.reason}:\n${indent(second.moved.filter((line) => !unexpected.includes(line)).join("\n"))}`);
      }
      if (second.restored.length) t.diagnostic(`${name} put back what an earlier re-run changed:\n${indent(second.restored.join("\n"))}`);
      if (second.ok && !second.moved.length && !second.restored.length) clean += 1;
    }
    t.diagnostic(`${clean} migrations re-applied with no change at all`);
    if (drift.length) t.diagnostic(`after the second run the database still differs from the migrated one:\n${indent(drift.join("\n"))}`);
    assert.ok(problems.length === 0, problems.join("\n"));
  });

  test("every public table has row level security on and at least one policy", (t) => {
    if (firstFailure) return t.skip(`not checked: ${firstFailure.name} failed on the first run`);
    const problems = [];
    const names = rls.tables.map((table) => table.name);
    for (const table of rls.tables) {
      const reason = NO_POLICY_BY_DESIGN[table.name];
      if (!table.rls) problems.push(`public.${table.name}: row level security is off`);
      if (!reason && table.policies === 0) problems.push(`public.${table.name}: no policy, so the API roles reach none of its rows; add one or list the table in NO_POLICY_BY_DESIGN with the reason`);
      if (reason && table.policies > 0) problems.push(`public.${table.name} now has ${table.policies} policies: remove it from NO_POLICY_BY_DESIGN`);
      if (reason && (table.anon || table.authenticated)) problems.push(`public.${table.name} has no policy by design, yet ${table.anon ? "anon" : "authenticated"} holds privileges on it`);
    }
    for (const name of Object.keys(NO_POLICY_BY_DESIGN)) if (!names.includes(name)) problems.push(`NO_POLICY_BY_DESIGN lists public.${name}, which no migration creates`);
    // Views and materialized views skip the policies of the tables they read unless they run as the caller.
    for (const relation of rls.other_relations) {
      if (relation.kind !== "v" || !relation.security_invoker) problems.push(`public.${relation.name} (relkind ${relation.kind}) bypasses row level security: use a view with security_invoker = true`);
    }
    for (const [name, reason] of Object.entries(NO_POLICY_BY_DESIGN)) t.diagnostic(`no policy by design: public.${name}: ${reason}`);
    t.diagnostic(`${names.length} public tables checked`);
    assert.ok(problems.length === 0, problems.join("\n"));
  });
});
