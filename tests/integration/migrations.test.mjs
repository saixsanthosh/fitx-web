// Every migration in supabase/migrations, applied the way the owner will apply them to production: in
// version order, one file at a time, each in a single transaction, on throwaway databases shaped like a
// Supabase project (tests/support/supabase-stub.sql):
//   fresh       every migration, on a new project;
//   production  the database production really has, then every pending migration (20261115100000 on).
//               Production's history holds the 14 September migrations and three changes applied there by
//               hand, with no file in supabase/migrations; tests/integration/fixtures/production-drift holds
//               those three byte for byte, and they run right after the September migrations, as there;
//   food last   production again, with the five food parts and 20261118200000 applied after every other
//               pending migration: the order the runbook (docs/runbooks/platform-database.md) allows.
// On the fresh and production databases:
//   * every migration (on production, every pending one) is applied a second time, in order, and must
//     neither fail nor move the database away from the fully migrated state (tables, columns, constraints,
//     indexes, policies, triggers, functions, grants, comments, row counts), except the problems listed
//     below with their reason;
//   * a migration that finds a table, column, index or extension already there is listed below, after
//     checking both definitions match;
//   * every table in public must have row level security on and at least one policy, except the tables
//     listed below with the reason they need none.
// Then:
//   * on the fresh database, an account created between the two runs must still have its intro film unseen
//     after the second;
//   * production must end exactly like the fresh database, reference rows included, apart from the leftovers
//     of production's hand-applied changes (PRODUCTION_LEFTOVERS), which nothing in the app, Admin or the
//     scripts uses and no pending migration changes;
//   * on production, the runbook's own queries (Start, Before, Check, Final, Undo, Record and History, read
//     from the runbook itself) give what it says to expect;
//   * with the food parts last, every other pending migration applies without them, food search keeps
//     answering meanwhile, and the end is exactly production's with every file in version order.
// The first migration that fails stops the run: later ones may depend on it, so they are not applied
// and the checks that need the whole schema are skipped with the reason.
// Skipped when the PostgreSQL server binaries (initdb, pg_ctl, psql) are not on PATH.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LocalPostgres, MIGRATIONS_DIR, SUPABASE_STUB, available, requiresPgCron } from "../support/local-postgres.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const MIGRATIONS = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
const CRON_MIGRATIONS = MIGRATIONS.filter((name) => requiresPgCron(path.join(MIGRATIONS_DIR, name)));
const NO_CRON =
  "needs the pg_cron extension, which Supabase provides and this local PostgreSQL does not have installed and preloaded";

// Production's migration history (supabase_migrations.schema_migrations, read 2026-11-17): the 14 September
// migrations, under the versions and names of the files here, then three changes applied by hand that no file
// here matches. Each fixture's md5 is md5(statements[1]) of its history row.
const PRODUCTION_HISTORY = [
  ["20260924162506", "initial_fitx_schema"],
  ["20260924164105", "harden_trigger_function_privileges"],
  ["20260924170604", "fitx_v1_core_product"],
  ["20260924171527", "fitx_preferences_water_goal"],
  ["20260924174525", "fitx_foreign_key_indexes"],
  ["20260930180637", "free_exercise_db_part_01"],
  ["20260930180649", "free_exercise_db_part_02"],
  ["20260930180652", "free_exercise_db_part_03"],
  ["20260930180655", "free_exercise_db_part_04"],
  ["20260930180659", "free_exercise_db_part_05"],
  ["20260930180706", "free_exercise_db_part_06"],
  ["20260930180709", "free_exercise_db_part_07"],
  ["20260930180714", "free_exercise_db_part_08"],
  ["20260930180717", "free_exercise_db_part_09"],
  ["20261002172610", "fitx_experience_2_0"],
  ["20261002172706", "fitx_share_access_and_index"],
  ["20261116093902", "fitx_admin_control_plane"],
];
const PRODUCTION_ONLY_MD5 = {
  "20261002172610_fitx_experience_2_0.sql": "8cade9d4cc29515551260735fbcca189",
  "20261002172706_fitx_share_access_and_index.sql": "a1d1251b3971a7e63274af58ff2ca142",
  "20261116093902_fitx_admin_control_plane.sql": "91921eac9b51cdf9a279008693d51944",
};
const FIXTURES_DIR = path.join(HERE, "fixtures", "production-drift");
const FIXTURES = readdirSync(FIXTURES_DIR).filter((name) => name.endsWith(".sql")).sort();
/** The first migration production has not applied: it and every later one are pending. */
const FIRST_PENDING = "20261115100000";
const SEPTEMBER = MIGRATIONS.filter((name) => name < FIRST_PENDING);
const PENDING = MIGRATIONS.filter((name) => name >= FIRST_PENDING);
const FOOD_PARTS = PENDING.filter((name) => /_fitx_food_catalog_seed_part_\d+\.sql$/.test(name));
/** Adds search words to six foods from the first food part, so it moves with the parts. */
const RAJMA = "20261118200000_fitx_food_catalog_rajma_keywords.sql";
const RAJMA_FOODS = [...readFileSync(path.join(MIGRATIONS_DIR, RAJMA), "utf8").matchAll(/'(\d+)',?\s+--/g)].map((match) => match[1]).sort();
const RUNBOOK = path.join(ROOT, "docs", "runbooks", "platform-database.md");

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

// On production four pending migrations find objects that a hand-applied change made first: experience 2.0
// (20261002172610) or the old Admin draft (20261116093902). Each keeps the object, which has the definition the
// file gives it (production must end like the fresh database), and adds what is missing.
const KNOWN_PRODUCTION_REDECLARATIONS = {
  "20261115100000_fitx_workout_session_pause_timing.sql": {
    notices: [/^column "paused_at" of relation "workout_sessions" already exists, skipping$/],
    reason: "experience 2.0 added workout_sessions.paused_at timestamptz; on production this file adds active_duration_seconds and resumed_at",
  },
  "20261115110000_fitx_workout_prescription_targets.sql": {
    notices: [
      /^column "target_weight_kg" of relation "workout_plan_exercises" already exists, skipping$/,
      /^column "target_duration_seconds" of relation "workout_plan_exercises" already exists, skipping$/,
      /^column "target_weight_kg" of relation "workout_session_exercises" already exists, skipping$/,
      /^column "target_duration_seconds" of relation "workout_session_exercises" already exists, skipping$/,
      /^column "duration_seconds" of relation "workout_sets" already exists, skipping$/,
    ],
    reason:
      "experience 2.0 added the five target and duration columns with these types; on production this file adds its five range " +
      "checks and validates experience 2.0's three NOT VALID checks",
  },
  "20261118140001_fitx_nutrition_user_data.sql": {
    notices: [/^column "barcode" of relation "custom_foods" already exists, skipping$/],
    reason:
      "experience 2.0 added custom_foods.barcode text; this file adds custom_foods_barcode_check on its own and drops experience " +
      "2.0's two barcode rules",
  },
  "20261118180000_fitx_admin_control_plane.sql": {
    notices: [
      /^relation "fitx_admin_members" already exists, skipping$/,
      /^relation "fitx_admin_audit_logs" already exists, skipping$/,
      /^relation "fitx_admin_audit_logs_created_at_idx" already exists, skipping$/,
      /^relation "fitx_admin_audit_logs_actor_idx" already exists, skipping$/,
    ],
    reason: "the Admin draft created both tables and both indexes as this file declares them, apart from the audit log's key to accounts, which this file drops",
  },
};

// What experience 2.0 (20261002172610, 20261002172706) leaves on production after every pending migration and a
// fresh database never has. Production has no rows in any of it (2026-11-17); keeping, locking down or dropping it
// is the owner's decision (docs/runbooks/platform-database.md, section 1.8). Until a migration settles an entry,
// production must end with exactly these extras, as the hand-applied changes left them: remove the entry when one
// does. `names` are what code using an entry would have to name; nothing in the app, Admin or the scripts may.
const LEFTOVER_TABLES = ["exercise_favorites", "food_favorites", "outdoor_activities", "activity_shares", "user_release_reads"];
const PRODUCTION_LEFTOVERS = [
  {
    what:
      "the tables exercise_favorites, food_favorites, outdoor_activities, activity_shares and user_release_reads, with their " +
      "columns, keys, checks, indexes and owner-only policies: signed-in members can write their own rows, and signed-out " +
      "visitors hold every table privilege, but no policy lets them reach a row",
    keys: new RegExp(
      `^((relation|column|constraint|policy|trigger|rows) public\\.(${LEFTOVER_TABLES.join("|")})(\\.|$)|index public\\.(${LEFTOVER_TABLES.join("|")})_)`,
    ),
    names: LEFTOVER_TABLES,
  },
  {
    what:
      "get_activity_share(text): runs as its owner and signed-out visitors can call it (the runbook's Final 3 lists it); it " +
      "returns the route coordinates saved in activity_shares for a share token",
    keys: /^function public\.get_activity_share\(p_token text\)$/,
    names: ["get_activity_share"],
  },
  {
    // aliases, tags and breathing are ordinary words in the code too; the app reads exercise_library through
    // explicit column lists (src/lib/training/catalog.ts) that name none of the five.
    what: "exercise_library.aliases, tags, form_cues, common_mistakes (text[], empty on every exercise) and breathing (text, null)",
    keys: /^column public\.exercise_library\.(aliases|tags|form_cues|common_mistakes|breathing)$/,
    names: ["form_cues", "common_mistakes"],
  },
  {
    // ingredients and allergens are ordinary words in the nutrition and coach code; the app reads custom_foods
    // through explicit column lists that name neither.
    what: "custom_foods.additional_nutrients (jsonb, {}), ingredients and allergens (text, null)",
    keys: /^column public\.custom_foods\.(additional_nutrients|ingredients|allergens)$/,
    names: ["additional_nutrients"],
  },
  {
    what:
      "workout_sessions.paused_duration_seconds (integer, 0) and rest_timer_ends_at, target_distance_meters on both exercise " +
      "tables and workout_sets.distance_meters",
    keys: /^column public\.(workout_sessions\.(paused_duration_seconds|rest_timer_ends_at)|workout_(plan|session)_exercises\.target_distance_meters|workout_sets\.distance_meters)$/,
    names: ["paused_duration_seconds", "rest_timer_ends_at", "target_distance_meters", "distance_meters"],
  },
  {
    what:
      "the checks workout_plan_exercises_targets_nonnegative, workout_session_exercises_targets_nonnegative and " +
      "workout_sets_time_distance_nonnegative, which also cover the distance columns (validated by 20261115110000)",
    keys: /^constraint public\.(workout_plan_exercises\.workout_plan_exercises_targets_nonnegative|workout_session_exercises\.workout_session_exercises_targets_nonnegative|workout_sets\.workout_sets_time_distance_nonnegative)$/,
    names: ["workout_plan_exercises_targets_nonnegative", "workout_session_exercises_targets_nonnegative", "workout_sets_time_distance_nonnegative"],
  },
];
/** Where the app, Admin and the scripts live (node_modules and build output left out). */
const APP_SOURCES = ["src", "admin/src", "admin/scripts", "scripts"];

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

// Values that differ from one database to the next however the migrations ran: times and random ids.
const VOLATILE_DEFAULT = /\b(now|gen_random_uuid|uuid_generate_v4|clock_timestamp|statement_timestamp|transaction_timestamp)\(|\bCURRENT_(DATE|TIMESTAMP)\b/i;

/** Per table in a snapshot, the columns whose values every database must agree on: no times, no random ids. */
function stableColumns(snapshot) {
  const columns = {};
  for (const [key, column] of Object.entries(snapshot.column ?? {})) {
    const [schema, table, name] = key.split(".");
    if (!["r", "p"].includes(snapshot.relation?.[`${schema}.${table}`]?.kind)) continue;
    if (/^timestamp/.test(column.type) || VOLATILE_DEFAULT.test(column.default ?? "")) continue;
    (columns[`${schema}.${table}`] ??= []).push(name);
  }
  return columns;
}

/**
 * Per table, an md5 of its rows, each row reduced to `columns` (so a table with extra columns elsewhere still
 * compares); null for a table this database lacks. What the migrations wrote, not only how much.
 */
function rowDigests(pg, columns) {
  const tables = JSON.stringify(Object.entries(columns).sort().map(([name, cols]) => ({ name, cols }))).replaceAll("'", "''");
  return pg.json(`
select coalesce(jsonb_object_agg(t.name, case when to_regclass(t.name) is null then null else
  (xpath('/row/d/text()', query_to_xml(format(
    'select md5(coalesce(string_agg(r, chr(10) order by r), %L)) as d from ('
      'select (select jsonb_object_agg(e.key, e.value) from jsonb_each(to_jsonb(x)) e where e.key = any (%L::text[]))::text as r '
      'from %s x) s',
    '', t.cols, to_regclass(t.name)), false, true, '')))[1]::text end), '{}'::jsonb)::text
from jsonb_to_recordset('${tables}'::jsonb) as t (name text, cols text[]);`);
}

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

/** How two databases' ends differ, as "<section> <key>": only on the first, only on the second, or changed. */
function compareEnds(first, second) {
  const onlyFirst = [];
  const onlySecond = [];
  const changed = [];
  for (const section of new Set([...Object.keys(first), ...Object.keys(second)])) {
    const a = first[section] ?? {};
    const b = second[section] ?? {};
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const object = `${section} ${key}`;
      if (!(key in b)) onlyFirst.push(object);
      else if (!(key in a)) onlySecond.push(object);
      else if (!same(a[key], b[key])) changed.push(`${object}: ${describeChange(a[key], b[key])}`);
    }
  }
  return { onlyFirst: onlyFirst.sort(), onlySecond: onlySecond.sort(), changed: changed.sort() };
}

const indent = (text) => `    ${text.replaceAll("\n", "\n    ")}`;

/**
 * Applies the migrations in order, each in one transaction, stopping at the first failure; `afterEach` runs
 * after each file that applied. Each file's entry says whether it applied (with the notices it printed), was
 * skipped (needs pg_cron) or failed.
 * @returns {{ status: Map<string, { first: { ok?: boolean, skipped?: string, error?: string, notices?: string[] }, second?: { ok: boolean, error: string | null, moved: string[], restored: string[] } }>, failure: { name: string, error: string } | null }}
 */
function applyInOrder(pg, names, cronUsable, afterEach = () => {}) {
  const status = new Map();
  for (const name of names) {
    if (!cronUsable && CRON_MIGRATIONS.includes(name)) {
      status.set(name, { first: { skipped: NO_CRON } });
      continue;
    }
    const result = pg.runFile(path.join(MIGRATIONS_DIR, name), { singleTransaction: true });
    if (!result.ok) {
      const failure = { name, error: errorText(result.stderr) };
      status.set(name, { first: { ok: false, error: failure.error } });
      return { status, failure };
    }
    status.set(name, { first: { ok: true, notices: skippedNotices(result.stderr) } });
    afterEach(name);
  }
  return { status, failure: null };
}

/** The runbook's SQL block whose first line starts "-- <label>", up to its closing fence. */
function runbookSql(label) {
  const runbook = readFileSync(RUNBOOK, "utf8");
  const start = runbook.indexOf(`\`\`\`sql\n-- ${label}`);
  if (start === -1) throw new Error(`docs/runbooks/platform-database.md has no SQL block that starts "-- ${label}"`);
  const body = runbook.slice(start + "```sql\n".length);
  return body.slice(0, body.indexOf("\n```"));
}

/** Runs one of the runbook's read-only queries as the session would; returns its rows as objects. */
function runbookRows(pg, label) {
  return pg.json(`select coalesce(jsonb_agg(q), '[]')::text from (\n${runbookSql(label).trim().replace(/;$/, "")}\n) q;`);
}

/** A history row as Start 1 and History 2 list it, for a migration file's name. */
const historyRow = (name) => ({ version: name.slice(0, 14), name: name.slice(15, -".sql".length) });

/**
 * Production's migration history, then what applying the 37 files and the runbook's section 6.3 do to it: the
 * connector records each file it applies under the time it ran, the six SQL editor files are recorded with their
 * Record queries, then History 0 to 2. Returns what Start 1 and History 0 and 2 listed, and whether History 1 ran.
 */
function historyAsTheRunbookLeavesIt(pg) {
  pg.exec(`
create schema supabase_migrations;
create table supabase_migrations.schema_migrations (
  version text primary key, statements text[], name text, created_by text, idempotency_key text, rollback text[]);
insert into supabase_migrations.schema_migrations (version, name) values
  ${PRODUCTION_HISTORY.map(([version, name]) => `('${version}', '${name}')`).join(",\n  ")};`);
  const start1 = runbookRows(pg, "Start 1:");
  const inSqlEditor = (name) => name.startsWith("20261118130010_") || FOOD_PARTS.includes(name);
  PENDING.forEach((name, index) => {
    const { version, name: shortName } = historyRow(name);
    // The apply day's clock, a minute per file from 10:00 UTC: never one of the files' own numbers.
    const appliedAt = `2026111910${String(index).padStart(2, "0")}00`;
    if (inSqlEditor(name)) pg.exec(runbookSql(`Record ${version} (writes`));
    else pg.exec(`insert into supabase_migrations.schema_migrations (version, name) values ('${appliedAt}', '${shortName}');`);
  });
  const history0 = runbookRows(pg, "History 0:");
  const history1 = pg.run(runbookSql("History 1 (writes, once)"));
  return { start1, history0, history1: history1.ok ? "applied" : errorText(history1.stderr), history2: runbookRows(pg, "History 2:") };
}

// The runbook's undo for #19, #18, #2 and #1, in that order, on production, rolled back: what is left of the
// fields and rules those files and experience 2.0 share.
const SHARED_WITH_EXPERIENCE_2 = {
  columns: [
    "custom_foods.archived_at", "custom_foods.barcode", "custom_foods.origin", "custom_foods.value_basis",
    "workout_plan_exercises.target_duration_seconds", "workout_plan_exercises.target_weight_kg",
    "workout_session_exercises.target_duration_seconds", "workout_session_exercises.target_weight_kg",
    "workout_sessions.active_duration_seconds", "workout_sessions.paused_at", "workout_sessions.resumed_at",
    "workout_sets.duration_seconds",
  ],
  rules: [
    "custom_foods_barcode_check", "workout_plan_exercises_target_duration_seconds_check", "workout_plan_exercises_target_weight_kg_check",
    "workout_plan_exercises_targets_nonnegative", "workout_session_exercises_target_duration_seconds_check",
    "workout_session_exercises_target_weight_kg_check", "workout_session_exercises_targets_nonnegative",
    "workout_sets_duration_seconds_check", "workout_sets_time_distance_nonnegative",
  ],
  relations: ["custom_foods_user_barcode_idx", "meal_template_items", "meal_templates", "nutrition_targets"],
};
const list = (names) => names.map((name) => `'${name}'`).join(", ");
const SHARED_NOW = `
select jsonb_build_object(
  'columns', (select coalesce(jsonb_agg(table_name || '.' || column_name order by table_name || '.' || column_name), '[]')
              from information_schema.columns where table_schema = 'public' and table_name || '.' || column_name in (${list(SHARED_WITH_EXPERIENCE_2.columns)})),
  'rules', (select coalesce(jsonb_agg(conname order by conname), '[]') from pg_constraint
            where connamespace = 'public'::regnamespace and conname in (${list(SHARED_WITH_EXPERIENCE_2.rules)})),
  'relations', (select coalesce(jsonb_agg(relname order by relname), '[]') from pg_class
                where relnamespace = 'public'::regnamespace and relname in (${list(SHARED_WITH_EXPERIENCE_2.relations)})),
  'search_foods', to_regprocedure('public.search_foods(text,text[],integer)') is not null
)::text`;
const undo = (version) => runbookSql(`Undo ${version} (writes`).replace(/^(begin|commit);$/gm, "");
const UNDO_ON_PRODUCTION = `
begin;
${["20261118140002", "20261118140001", "20261115110000", "20261115100000"].map(undo).join("\n")}
${SHARED_NOW};
rollback;`;

/**
 * Applies every migration that applied the first time again, in order. Each one is judged by what it moves
 * away from the fully migrated database (`migrated`); putting back what an earlier re-run changed is listed
 * apart. Returns how the database still differs from `migrated` at the end.
 */
function applyAgain(pg, status, migrated) {
  let previous = migrated;
  for (const [name, entry] of status) {
    if (!entry.first.ok) continue;
    const result = pg.runFile(path.join(MIGRATIONS_DIR, name), { singleTransaction: true });
    const next = pg.json(SNAPSHOT);
    entry.second = { ok: result.ok, error: result.ok ? null : errorText(result.stderr), ...diff(previous, next, migrated) };
    previous = next;
  }
  return diff(migrated, previous).moved;
}

/** The stand-in, the September migrations and production's three hand-applied changes: production today. */
function buildProductionToday(pg) {
  pg.applyFile(SUPABASE_STUB, { singleTransaction: true });
  for (const name of SEPTEMBER) pg.applyFile(path.join(MIGRATIONS_DIR, name), { singleTransaction: true });
  for (const name of FIXTURES) pg.applyFile(path.join(FIXTURES_DIR, name), { singleTransaction: true });
}

function assertAllApplied(t, { status, failure }, names, fix) {
  const applied = [...status.values()].filter((entry) => entry.first.ok).length;
  for (const [name, entry] of status) if (entry.first.skipped) t.diagnostic(`not applied: ${name}: ${entry.first.skipped}`);
  if (failure) {
    const notRun = names.length - names.indexOf(failure.name) - 1;
    assert.fail(
      `${failure.name} failed after the ${applied} migrations before it applied:\n${indent(failure.error)}\n` +
        `The ${notRun} migrations after it were not applied. ${fix}`,
    );
  }
  t.diagnostic(`${applied} of ${names.length} migrations applied in order`);
}

/** Notices about objects that were already there, unless a list explains them; and list entries never seen. */
function redeclarationProblems(t, status, lists) {
  const problems = [];
  const seen = new Set();
  for (const [name, entry] of status) {
    for (const notice of entry.first.notices ?? []) {
      const list = lists.find((known) => known[name]?.notices.some((pattern) => pattern.test(notice)));
      if (!list) {
        problems.push(
          `${name}: ${notice}. An earlier migration already created it: check both definitions match, then list it in ` +
            "KNOWN_REDECLARATIONS (KNOWN_PRODUCTION_REDECLARATIONS when a hand-applied change on production made it).",
        );
        continue;
      }
      const known = list[name];
      seen.add(known.notices.find((pattern) => pattern.test(notice)));
      t.diagnostic(`${name}: ${notice} (${known.reason})`);
    }
  }
  for (const list of lists) {
    for (const [name, known] of Object.entries(list)) {
      if (!status.get(name)?.first.ok) continue;
      for (const pattern of known.notices) if (!seen.has(pattern)) problems.push(`${name} no longer prints ${pattern}: remove it from the list`);
    }
  }
  return problems;
}

/** Re-runs that failed or moved the migrated database, unless KNOWN_RERUN_PROBLEMS explains them. */
function rerunProblems(t, status, stillDiffers) {
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
  if (stillDiffers.length) t.diagnostic(`after the second run the database still differs from the migrated one:\n${indent(stillDiffers.join("\n"))}`);
  return problems;
}

/** Public tables without row level security or a policy, unless NO_POLICY_BY_DESIGN explains them. */
function rlsProblems(t, rls) {
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
  return problems;
}

/** The files of the app, Admin and the scripts that code could live in. */
function appSourceFiles() {
  const files = [];
  for (const dir of APP_SOURCES) {
    for (const entry of readdirSync(path.join(ROOT, dir), { recursive: true, withFileTypes: true })) {
      const file = path.join(entry.parentPath, entry.name);
      if (entry.isFile() && /\.(ts|tsx|js|mjs|cjs|sql|json|md)$/.test(entry.name) && !/[\\/](node_modules|\.next)[\\/]/.test(file)) files.push(file);
    }
  }
  return files;
}

/** Each database's end, right after every migration's first run and before anything else touched it. */
const ends = { fresh: null, production: null };

/** An account that signs up after the migrations were applied, before they are applied again. */
const LATER_MEMBER = "c0000000-0000-4000-8000-000000000001";

const skip = available() ? false : "Postgres binaries (initdb, pg_ctl, psql) are not installed";

test("migration files are named <14-digit version>_<name>.sql with unique versions", () => {
  const badNames = MIGRATIONS.filter((name) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(name));
  assert.deepEqual(badNames, [], "Supabase orders and records migrations by this version prefix");
  const versions = MIGRATIONS.map((name) => name.slice(0, 14));
  const duplicates = versions.filter((version, index) => versions.indexOf(version) !== index);
  assert.deepEqual(duplicates, [], "two migrations share a version: Supabase would record only one of them");
});

test("production's history is the September migrations here, then the three fixtures, byte for byte", () => {
  const entry = (name) => [name.slice(0, 14), name.slice(15, -".sql".length)];
  const history = [...SEPTEMBER.map(entry), ...FIXTURES.map(entry)].sort(([a], [b]) => a.localeCompare(b));
  assert.deepEqual(history, PRODUCTION_HISTORY, "production's replica must start where production's history does");
  for (const name of FIXTURES) {
    const md5 = createHash("md5").update(readFileSync(path.join(FIXTURES_DIR, name))).digest("hex");
    assert.equal(md5, PRODUCTION_ONLY_MD5[name], `${name} differs from md5(statements[1]) of its row in production's history; copy it again, read-only`);
  }
  const versions = new Set(MIGRATIONS.map((name) => name.slice(0, 14)));
  for (const name of FIXTURES) {
    assert.ok(!versions.has(name.slice(0, 14)), `supabase/migrations now has ${name.slice(0, 14)}: production's replica would apply that version twice`);
  }
});

test("the runbook applies and records every pending migration, and only those", () => {
  const runbook = readFileSync(RUNBOOK, "utf8");
  const order = [...runbook.matchAll(/^\| (\d+) \| `(\d{14}_[a-z0-9_]+)` \|/gm)];
  assert.deepEqual(order.map((match) => Number(match[1])), PENDING.map((_, index) => index + 1), "section 2 numbers the files 1, 2, 3 and so on");
  assert.deepEqual(order.map((match) => `${match[2]}.sql`), PENDING, "section 2 lists every pending migration, in version order");
  const history = runbook.match(/-- History 1 \(writes, once\)[^]*?\) as f \(version, name\)/)?.[0] ?? "";
  const recorded = [...history.matchAll(/\('(\d{14})', '([a-z0-9_]+)'\)/g)].map((match) => `${match[1]}_${match[2]}.sql`);
  assert.deepEqual(recorded, PENDING, "History 1 gives every pending migration its own version and name");
});

test("nothing in the app, Admin or the scripts uses what production's hand-applied changes left behind", () => {
  const names = PRODUCTION_LEFTOVERS.flatMap((leftover) => leftover.names);
  const pattern = new RegExp(`\\b(${names.join("|")})\\b`, "g");
  const uses = [];
  for (const file of appSourceFiles()) {
    const found = new Set([...readFileSync(file, "utf8").matchAll(pattern)].map((match) => match[1]));
    if (found.size) uses.push(`${path.relative(ROOT, file)}: ${[...found].join(", ")}`);
  }
  assert.deepEqual(uses, [], "code now uses a leftover: settle it with a migration (and take it out of PRODUCTION_LEFTOVERS) first");
});

describe("every migration on a fresh Supabase-shaped database", { skip }, () => {
  /** @type {LocalPostgres} */
  let pg;
  /** @type {ReturnType<typeof applyInOrder>} */
  let run = { status: new Map(), failure: null };
  let rls = null;
  /** How the database differs from the fully migrated one after the second run. */
  let stillDiffers = [];
  /** LATER_MEMBER's profile flag, read before and after the second run. */
  const laterMember = { beforeSecondRun: null, afterSecondRun: null };
  const notChecked = () => run.failure && `not checked: ${run.failure.name} failed on the first run`;

  before(() => {
    pg = new LocalPostgres().start();
    pg.applyFile(SUPABASE_STUB, { singleTransaction: true });
    run = applyInOrder(pg, MIGRATIONS, pg.pgCronUsable());
    if (run.failure) return;
    rls = pg.json(RLS);
    const snapshot = pg.json(SNAPSHOT);
    const columns = stableColumns(snapshot);
    ends.fresh = { snapshot, columns, rows: rowDigests(pg, columns) };

    // Someone signs up after the release (sign-up's trigger creates the profile), so the second run
    // meets an account that has not seen its intro film yet.
    pg.exec(`insert into auth.users (id, email) values ('${LATER_MEMBER}', 'later@example.test');`);
    const introFlag = () => pg.json(`select json_build_object('intro_completed_at', intro_completed_at) from public.profiles where id = '${LATER_MEMBER}';`);
    laterMember.beforeSecondRun = introFlag();

    // Second run: every migration again, in order.
    stillDiffers = applyAgain(pg, run.status, pg.json(SNAPSHOT));
    laterMember.afterSecondRun = introFlag();
  });

  after(() => pg?.stop());

  test("every migration applies, in order, each in one transaction", (t) => {
    assertAllApplied(t, run, MIGRATIONS,
      "If the migration is wrong for Supabase, fix it (one already applied in production is never edited: add a new migration " +
        "instead); if a Supabase project has something tests/support/supabase-stub.sql lacks, add it there.");
  });

  for (const name of CRON_MIGRATIONS) {
    test(`${name} applies (needs pg_cron)`, (t) => {
      if (run.status.get(name)?.first.skipped) return t.skip(`not applied here: ${NO_CRON}; nothing after it depends on it`);
      if (!run.status.has(name)) return t.skip(`not reached: ${run.failure?.name ?? "an earlier step"} failed first`);
      assert.equal(run.status.get(name).first.ok, true, run.status.get(name).first.error);
    });
  }

  test("no migration re-creates what an earlier one created, unless both definitions match", (t) => {
    if (run.failure) return t.skip(notChecked());
    const problems = redeclarationProblems(t, run.status, [KNOWN_REDECLARATIONS]);
    assert.ok(problems.length === 0, problems.join("\n"));
  });

  test("every migration can be applied a second time without errors or changes", (t) => {
    if (run.failure) return t.skip(notChecked());
    const problems = rerunProblems(t, run.status, stillDiffers);
    assert.ok(problems.length === 0, problems.join("\n"));
  });

  test("applying the migrations again never marks an account as having seen its intro film", (t) => {
    if (run.failure) return t.skip(notChecked());
    assert.deepEqual(laterMember.beforeSecondRun, { intro_completed_at: null }, "a new account starts with the film unseen");
    assert.deepEqual(laterMember.afterSecondRun, { intro_completed_at: null }, "the second run must leave it null, or the account never gets its film");
  });

  test("every public table has row level security on and at least one policy", (t) => {
    if (run.failure) return t.skip(notChecked());
    const problems = rlsProblems(t, rls);
    assert.ok(problems.length === 0, problems.join("\n"));
  });
});

// 20261117090000 adds profiles.intro_completed_at and marks the accounts that already exist as having seen
// the film (it used to play on every visit). Only the step that adds the column may do that: run again,
// a backfill would take the film away from everyone who signed up since. 20261117100000 adds the same
// column (its grant names it) and never backfills.
describe("the intro film flag on a database that already has accounts", { skip }, () => {
  const FLAG = "20261117090000_fitx_profiles_intro_flag.sql";
  const PRIVILEGES = "20261117100000_fitx_profiles_column_privileges.sql";
  /** @type {LocalPostgres} */
  let pg;
  const apply = (name) => pg.applyFile(path.join(MIGRATIONS_DIR, name), { singleTransaction: true });
  // Per account email: the flag, and whether it equals the profile's creation time.
  const flags = () => pg.json(`
    select json_object_agg(email, json_build_object('seen', intro_completed_at, 'at_creation', intro_completed_at = created_at))
    from public.profiles;`);

  before(() => {
    pg = new LocalPostgres().start();
    pg.applyMigrations({ before: FLAG.slice(0, 14) });
    pg.exec(`insert into auth.users (id, email) values ('e0000000-0000-4000-8000-000000000001', 'early@example.test');`);
  });

  after(() => pg?.stop());

  test("accounts that exist when the column is added count as having seen the film; later ones never do", () => {
    apply(FLAG);
    apply(PRIVILEGES);
    pg.exec(`insert into auth.users (id, email) values ('e0000000-0000-4000-8000-000000000002', 'later@example.test');`);
    const first = flags();
    assert.equal(first["early@example.test"].at_creation, true, "an account from before the migration counts as having seen it since it was created");
    assert.deepEqual(first["later@example.test"], { seen: null, at_creation: null });
    apply(FLAG);
    apply(PRIVILEGES);
    assert.deepEqual(flags(), first, "applying both again changes no account");
  });

  test("when 20261117100000 adds the column first, neither migration marks anyone", () => {
    pg.exec(`alter table public.profiles drop column intro_completed_at;`);
    apply(PRIVILEGES);
    apply(FLAG);
    assert.deepEqual(Object.values(flags()).map((flag) => flag.seen), [null, null]);
  });
});

describe("every pending migration on a copy of production's database", { skip }, () => {
  /** @type {LocalPostgres} */
  let pg;
  /** @type {ReturnType<typeof applyInOrder>} */
  let run = { status: new Map(), failure: null };
  let rls = null;
  let stillDiffers = [];
  /** Production's rows reduced to the fresh database's stable columns, so the two compare. */
  let rowsAsFresh = null;
  /** Production before the first pending migration. */
  let today = null;
  /** What the runbook's own queries give on production: before #1, right after the files they check, at the end. */
  const runbook = { today: null, checks: {}, end: null, shared: null, undone: null, history: null };
  /** The files whose summaries and Checks the runbook gives a production-only part (section 1.8). */
  const CHECKED = ["20261115100000", "20261115110000", "20261118140001", "20261118180000", "20261118180002"];
  const notChecked = () => run.failure && `not checked: ${run.failure.name} failed on the first run`;

  before(() => {
    pg = new LocalPostgres().start();
    buildProductionToday(pg);
    today = pg.json(SNAPSHOT);
    runbook.today = Object.fromEntries(["Start 2:", "Start 9:", "Start 10:", "Before 20261115110000:"].map((label) => [label, runbookRows(pg, label)]));
    run = applyInOrder(pg, PENDING, pg.pgCronUsable(), (name) => {
      const version = name.slice(0, 14);
      if (CHECKED.includes(version)) runbook.checks[version] = runbookRows(pg, `Check ${version}:`);
    });
    if (run.failure) return;
    rls = pg.json(RLS);
    const snapshot = pg.json(SNAPSHOT);
    const columns = stableColumns(snapshot);
    ends.production = { snapshot, columns, rows: rowDigests(pg, columns) };
    if (ends.fresh) rowsAsFresh = rowDigests(pg, ends.fresh.columns);
    runbook.end = Object.fromEntries(["Start 2:", "Final 3:"].map((label) => [label, runbookRows(pg, label)]));
    // Second run: every pending migration again, in order. The September migrations and the hand-applied
    // changes are in production's history, so nothing runs them again.
    stillDiffers = applyAgain(pg, run.status, snapshot);
    runbook.shared = pg.json(`${SHARED_NOW};`);
    runbook.undone = pg.json(UNDO_ON_PRODUCTION);
    runbook.history = historyAsTheRunbookLeavesIt(pg);
  });

  after(() => pg?.stop());

  test("every pending migration applies on production's copy, in order, each in one transaction", (t) => {
    assertAllApplied(t, run, PENDING,
      "If production has something the copy lacks, add it to tests/integration/fixtures/production-drift only as production's " +
        "history recorded it; otherwise make the migration work on both databases.");
  });

  test("no pending migration re-creates what an earlier one or a hand-applied change created, unless both definitions match", (t) => {
    if (run.failure) return t.skip(notChecked());
    const problems = redeclarationProblems(t, run.status, [KNOWN_REDECLARATIONS, KNOWN_PRODUCTION_REDECLARATIONS]);
    assert.ok(problems.length === 0, problems.join("\n"));
  });

  test("every pending migration can be applied a second time on production's copy without errors or changes", (t) => {
    if (run.failure) return t.skip(notChecked());
    const problems = rerunProblems(t, run.status, stillDiffers);
    assert.deepEqual(stillDiffers, [], "after the second run, production's copy must be as the first run left it");
    assert.ok(problems.length === 0, problems.join("\n"));
  });

  test("every public table on production's copy has row level security on and at least one policy", (t) => {
    if (run.failure) return t.skip(notChecked());
    const problems = rlsProblems(t, rls);
    assert.ok(problems.length === 0, problems.join("\n"));
  });

  test("production ends exactly like a fresh database, apart from its hand-applied changes' leftovers", (t) => {
    if (run.failure) return t.skip(notChecked());
    if (!ends.fresh) return t.skip("not checked: the fresh database did not finish its first run");
    const { onlyFirst: onlyFresh, onlySecond: onlyProduction, changed } = compareEnds(
      { ...ends.fresh.snapshot, data: ends.fresh.rows },
      { ...ends.production.snapshot, data: rowsAsFresh },
    );
    const leftover = (key) => PRODUCTION_LEFTOVERS.find((entry) => entry.keys.test(key));
    const problems = [
      ...onlyFresh.map((key) => `${key}: a pending migration makes it on a fresh database but not on production (did it skip an object of the same name?)`),
      ...changed.map((line) => `${line} (fresh -> production): a pending migration ends differently on production`),
      ...onlyProduction.filter((key) => !leftover(key)).map((key) =>
        `${key}: only on production. If a hand-applied change made it and nothing uses it, list it in PRODUCTION_LEFTOVERS with the reason; if a pending migration should make or remove it, fix that migration`),
    ];
    for (const entry of PRODUCTION_LEFTOVERS) {
      const keys = onlyProduction.filter((key) => entry.keys.test(key));
      if (keys.length === 0) problems.push(`PRODUCTION_LEFTOVERS lists ${entry.what}, but production no longer differs there: remove the entry`);
      else t.diagnostic(`left for the owner: ${entry.what} (${keys.length} ${keys.length === 1 ? "object" : "objects"})`);
    }
    // A check added NOT VALID was never run against the rows already there; the leftovers' must have been since.
    for (const key of onlyProduction.filter((name) => name.startsWith("constraint "))) {
      if (!ends.production.snapshot.constraint[key.slice("constraint ".length)].validated) problems.push(`${key} is still NOT VALID on production`);
    }
    t.diagnostic(`${Object.keys(ends.fresh.rows).length} tables' rows and ${Object.keys(ends.fresh.snapshot.function ?? {}).length} functions compared`);
    assert.ok(problems.length === 0, problems.join("\n"));
  });

  test("the pending migrations leave those leftovers as they found them, apart from checking experience 2.0's three workout checks", (t) => {
    if (run.failure) return t.skip(notChecked());
    /** Each leftover object, keyed "<section> <key>". */
    const leftovers = (snapshot) => Object.fromEntries(Object.entries(snapshot).flatMap(([section, objects]) =>
      Object.entries(objects ?? {}).map(([key, value]) => [`${section} ${key}`, value])
        .filter(([object]) => PRODUCTION_LEFTOVERS.some((entry) => entry.keys.test(object)))));
    const before = leftovers(today);
    const end = leftovers(ends.production.snapshot);
    // 20261115110000 validates those three: the definition loses its NOT VALID and the check is marked validated.
    const validated = (a, b) => a?.validated === false && b?.validated === true && a.definition === `${b.definition} NOT VALID`;
    const moved = [];
    let checked = 0;
    for (const object of [...new Set([...Object.keys(before), ...Object.keys(end)])].sort()) {
      if (!(object in end)) moved.push(`${object}: removed`);
      else if (!(object in before)) moved.push(`${object}: added`);
      else if (validated(before[object], end[object])) checked += 1;
      else if (!same(before[object], end[object])) moved.push(`${object}: ${describeChange(before[object], end[object])}`);
    }
    assert.deepEqual(moved, [], "the leftovers are the owner's to decide about: no pending migration may change them");
    assert.equal(checked, 3, "the three checks experience 2.0 added NOT VALID are validated");
    t.diagnostic(`${Object.keys(before).length} leftover objects compared`);
  });

  test("before #1, the runbook's Start queries and #2's Before query give what it expects on production", () => {
    assert.deepEqual(runbook.today, {
      "Start 2:": [
        { file: "20261115110000", object: "workout_sets.duration_seconds" },
        { file: "20261118180000", object: "fitx_admin_members" },
      ],
      "Start 9:": [{ tables: 7, fields: 20, rules: 4, indexes: 2, share_function: 1, admin_functions: 3, audit_log_links_to_accounts: 1 }],
      "Start 10:": [{ rows_in_the_five_tables: 0, custom_foods_with_a_barcode: 0, admin_team_members: 0, admin_audit_rows: 0 }],
      "Before 20261115110000:": [{ planned_exercises: 0, live_exercises: 0, sets: 0 }],
    });
  });

  test("right after each file that meets a hand-applied change, its Check gives what the runbook expects", (t) => {
    if (run.failure) return t.skip(notChecked());
    assert.deepEqual(runbook.checks, {
      "20261115100000": [{ pause_columns: 3 }],
      "20261115110000": [{ target_columns: 5, target_checks: 5, rules_never_checked: 0 }],
      "20261118140001": [{
        new_columns: 8,
        tables_with_row_security: 3,
        updated_time_triggers: "custom_foods_touch_updated_at,meals_touch_updated_at",
        visitors_read: false,
        barcode_rules: "CHECK (((barcode IS NULL) OR (barcode ~ '^[0-9]{8,14}$'::text)))",
        barcode_indexes: "custom_foods_user_barcode_idx",
      }],
      "20261118180000": [{
        team_row_security_forced: true, audit_row_security_forced: true, server_reads_team: true, members_read_audit: false,
        admin_functions: 3, owner_bypasses_row_security: true, team_members: 0, links_to_accounts: 0,
      }],
      "20261118180002": [{
        server_can_change: false, server_can_delete: false, server_can_add: true,
        guards: "fitx_admin_audit_logs_append_only_rows,fitx_admin_audit_logs_append_only_truncate", links_to_accounts: 0, log_function: true,
      }],
    });
    assert.equal(runbook.end["Start 2:"].length, 28, "after the last file, Start 2 lists all 28 rows");
    assert.deepEqual(runbook.end["Final 3:"], [{ proname: "get_activity_share", visitors_can_call: true }], "Final 3 lists only experience 2.0's function");
  });

  test("on production, the runbook's undo for #19, #18, #2 and #1 keeps what experience 2.0 made", (t) => {
    if (run.failure) return t.skip(notChecked());
    assert.deepEqual(runbook.shared, { ...SHARED_WITH_EXPERIENCE_2, search_foods: true }, "after the 37 files");
    assert.deepEqual(runbook.undone, {
      columns: [
        "custom_foods.barcode", "workout_plan_exercises.target_duration_seconds", "workout_plan_exercises.target_weight_kg",
        "workout_session_exercises.target_duration_seconds", "workout_session_exercises.target_weight_kg",
        "workout_sessions.paused_at", "workout_sets.duration_seconds",
      ],
      rules: ["custom_foods_barcode_check", "workout_plan_exercises_targets_nonnegative", "workout_session_exercises_targets_nonnegative", "workout_sets_time_distance_nonnegative"],
      relations: [],
      search_foods: false,
    }, "the undo removes what the four files added, and leaves experience 2.0's fields and checks (and #18's barcode check)");
  });

  test("the runbook's history steps give every pending file its own number, next to production's 17 rows", (t) => {
    if (run.failure) return t.skip(notChecked());
    const production = PRODUCTION_HISTORY.map(([version, name]) => ({ version, name }));
    assert.deepEqual(runbook.history.start1, production, "Start 1 lists production's 17 rows");
    assert.deepEqual(runbook.history.history0, [], "History 0 finds no file recorded twice");
    assert.equal(runbook.history.history1, "applied", "History 1 runs");
    assert.deepEqual(runbook.history.history2, [...production, ...PENDING.map(historyRow)].sort((a, b) => a.version.localeCompare(b.version)),
      "History 2 lists the 54 rows");
  });
});

// The five food parts (about 150 KB each, through the SQL editor) can wait until after every other pending
// migration and the new app's deploy. Nothing after them needs their rows except 20261118200000, which adds
// search words to six foods from part 01 and so moves with them; meanwhile the app's food search answers from
// its built-in list and the member's own foods (tests/nutrition/search-route.test.ts: "an empty catalogue").
describe("the food parts and 20261118200000 applied last on production's copy", { skip }, () => {
  const LAST = [...FOOD_PARTS, RAJMA];
  const EARLIER = PENDING.filter((name) => !LAST.includes(name));
  const MEMBER = "f0000000-0000-4000-8000-0000000000f1";
  const asMember = (sub) => `set local role authenticated;
select set_config('request.jwt.claims', '${JSON.stringify({ sub, role: "authenticated" })}', true) \\g /dev/null`;
  // A member uses Nutrition while the catalogue is still empty: saves a food, logs a USDA food from the app's
  // built-in list (meals keep its FoodData Central id, which the catalogue uses too) and searches. Rolled back.
  const MEANWHILE = `
begin;
insert into auth.users (id, email) values ('${MEMBER}', 'meanwhile@example.test');
${asMember(MEMBER)}
insert into public.custom_foods (user_id, name, serving_size, serving_grams, calories_per_100g) values ('${MEMBER}', 'Idli (homemade)', '1 piece', 40, 130);
insert into public.meals (user_id, meal, food_name, source, provider_id, quantity_grams, calories)
  values ('${MEMBER}', 'Breakfast', 'Idli', 'USDA FoodData Central', '2708346', 120, 156);
select jsonb_build_object(
  'catalogue_probe', (select coalesce(jsonb_agg(id), '[]') from (select id from public.food_catalog limit 1) f),
  'search', (select coalesce(jsonb_agg(jsonb_build_array(kind, name, recent_count, fuzzy)), '[]')
             from public.search_foods('idli', array['idli'], 120)),
  'meals_logged', (select count(*) from public.meals)
)::text;
rollback;`;
  const rajmaWords = () => pg.json(`
    select coalesce(json_object_agg(id, keywords @> array['rajma', 'rajmah'] order by id), '{}')::text from public.food_catalog
    where id in (${RAJMA_FOODS.map((id) => `'${id}'`).join(", ")});`);

  /** @type {LocalPostgres} */
  let pg;
  /** @type {ReturnType<typeof applyInOrder>} */
  let earlier = { status: new Map(), failure: null };
  /** @type {ReturnType<typeof applyInOrder>} */
  let last = { status: new Map(), failure: null };
  let meanwhile = null;
  const words = { beforeRajma: null, afterRajma: null };
  let searches = null;
  let end = null;
  const failed = () => earlier.failure ?? last.failure;

  before(() => {
    pg = new LocalPostgres().start();
    buildProductionToday(pg);
    const cronUsable = pg.pgCronUsable();
    earlier = applyInOrder(pg, EARLIER, cronUsable);
    if (earlier.failure) return;
    meanwhile = pg.json(MEANWHILE);
    last = applyInOrder(pg, FOOD_PARTS, cronUsable);
    if (last.failure) return;
    words.beforeRajma = rajmaWords();
    const rajma = applyInOrder(pg, [RAJMA], cronUsable);
    for (const [name, entry] of rajma.status) last.status.set(name, entry);
    if (rajma.failure) {
      last.failure = rajma.failure;
      return;
    }
    words.afterRajma = rajmaWords();
    // The runbook's own search checks, as a made-up member: after #24 and after #37.
    searches = { smoke: runbookRows(pg, "Smoke 20261118140014:"), rajma: runbookRows(pg, "Check 20261118200000:") };
    const snapshot = pg.json(SNAPSHOT);
    end = { snapshot, rows: ends.production ? rowDigests(pg, ends.production.columns) : null };
  });

  after(() => pg?.stop());

  test("every other pending migration applies before the food parts, in order, each in one transaction", (t) => {
    assertAllApplied(t, earlier, EARLIER, "A migration that needs the food parts' rows cannot come before them: keep it after them in the runbook.");
    assertAllApplied(t, last, LAST, "The food parts and 20261118200000 must also apply after every other pending migration.");
  });

  test("meanwhile food search answers with the member's own foods, and the catalogue reads as not loaded", (t) => {
    if (failed()) return t.skip(`not checked: ${failed().name} failed`);
    assert.deepEqual(meanwhile, {
      // Empty: the search route then answers from the app's built-in list instead of reporting no match.
      catalogue_probe: [],
      search: [["custom", "Idli (homemade)", 0, false]],
      meals_logged: 1,
    });
  });

  test("20261118200000 comes after the food parts: their six kidney-bean foods get the rajma words only from it", (t) => {
    if (failed()) return t.skip(`not checked: ${failed().name} failed`);
    assert.equal(RAJMA_FOODS.length, 6, `the six foods are read from ${RAJMA}`);
    assert.deepEqual(words.beforeRajma, Object.fromEntries(RAJMA_FOODS.map((id) => [id, false])), "the food parts add the six foods without the words");
    assert.deepEqual(words.afterRajma, Object.fromEntries(RAJMA_FOODS.map((id) => [id, true])));
    assert.deepEqual(searches.smoke[0], { kind: "catalog", id: "2708346", name: "Idli" }, "the runbook's Smoke 20261118140014: Idli first");
    assert.deepEqual(searches.rajma.map((row) => [row.id, row.has_rajma]), RAJMA_FOODS.map((id) => [id, true]), "the runbook's Check 20261118200000");
  });

  test("the end is exactly production's with every pending migration in version order", (t) => {
    if (failed()) return t.skip(`not checked: ${failed().name} failed`);
    if (!ends.production) return t.skip("not checked: production's copy did not finish its first run");
    const { onlyFirst, onlySecond, changed } = compareEnds(
      { ...ends.production.snapshot, data: ends.production.rows },
      { ...end.snapshot, data: end.rows },
    );
    const lines = [...onlyFirst.map((key) => `${key}: only in version order`), ...onlySecond.map((key) => `${key}: only with the food parts last`), ...changed];
    assert.deepEqual(lines, [], "applying the food parts and 20261118200000 last must end exactly as applying everything in version order");
    t.diagnostic(`${Object.keys(end.rows).length} tables' rows compared, the food catalogue's included`);
  });
});
