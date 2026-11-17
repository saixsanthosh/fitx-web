// The four workout tables (workout_sessions, workout_sets, workout_plan_exercises and
// workout_session_exercises) on both databases the pending migrations (20261115100000 on) will meet, each
// built on a throwaway local PostgreSQL (tests/support/local-postgres.mjs):
//   * clean: tests/support/supabase-stub.sql, the migrations production has applied from this repository
//     (the September files), then every pending migration;
//   * production: the same, except that the three migrations production recorded outside this repository
//     (tests/integration/fixtures/production-drift, byte-identical to its migration history) come right
//     after the September files, as production has them before any pending file runs.
// Every file is applied in version order, each in one transaction, as the owner applies them.
//
// On production, experience 2.0 (20261002172610) already added workout_sessions.paused_at, the target
// columns of workout_plan_exercises and workout_session_exercises and workout_sets.duration_seconds, with
// the types 20261115100000 and 20261115110000 give them, so those two files skip these columns there and
// add only the rest. It also added columns and checks of its own, which production keeps. Checked here:
//   * before any pending file, production's workout tables differ from the clean path by exactly what
//     experience 2.0 added;
//   * after all of them, the workout tables are the same on both (columns, constraints, indexes, policies,
//     triggers, grants, publications and the functions that use the tables), apart from experience 2.0's
//     own columns and checks in PRODUCTION_ONLY, which are left for the owner;
//   * no constraint on them is left NOT VALID on either;
//   * targets and timed sets the live app saves on production before the release keep their values;
//   * applying the files that change these tables again changes nothing on production;
//   * a member planning, starting, pausing, logging and finishing a workout gets the same results, and
//     the same errors for values out of range, on both.
// Skipped when the PostgreSQL server binaries (initdb, pg_ctl, psql) are not on PATH.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { LocalPostgres, MIGRATIONS_DIR, SUPABASE_STUB, available, requiresPgCron } from "../support/local-postgres.mjs";

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "production-drift");

// The migrations production recorded outside this repository, with md5(statements[1]) of each one's row
// in its supabase_migrations.schema_migrations: the fixture files must be byte-identical to them.
const PRODUCTION_HISTORY_MD5 = {
  "20261002172610_fitx_experience_2_0.sql": "8cade9d4cc29515551260735fbcca189",
  "20261002172706_fitx_share_access_and_index.sql": "a1d1251b3971a7e63274af58ff2ca142",
  "20261116093902_fitx_admin_control_plane.sql": "91921eac9b51cdf9a279008693d51944",
};
const FIXTURES = readdirSync(FIXTURES_DIR).filter((name) => name.endsWith(".sql")).sort();

/** The first migration production has not applied: it and every later one are pending. */
const FIRST_PENDING = "20261115100000";
const MIGRATIONS = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
const APPLIED = MIGRATIONS.filter((name) => name < FIRST_PENDING);
const PENDING = MIGRATIONS.filter((name) => name >= FIRST_PENDING);

const PAUSE = "20261115100000_fitx_workout_session_pause_timing.sql";
const TARGETS = "20261115110000_fitx_workout_prescription_targets.sql";
/** The pending files that change the workout tables themselves. */
const WORKOUT_SCHEMA_FILES = [
  PAUSE,
  TARGETS,
  "20261118120000_fitx_planner_todo_store.sql", // workout_sessions.planner_event_id
  "20261118130050_fitx_workout_rpcs.sql", // workout_sessions_one_in_progress
  "20261118170008_fitx_workout_sets_rep_source.sql", // workout_sets.rep_source
];
const TABLES = ["workout_sessions", "workout_sets", "workout_plan_exercises", "workout_session_exercises"];

const column = (type, { notNull = false, def = null, comment = null } = {}) =>
  ({ type, not_null: notNull, default: def, identity: "", generated: "", acl: null, comment });
const TARGETS_NONNEGATIVE =
  "CHECK ((((target_weight_kg IS NULL) OR (target_weight_kg >= (0)::numeric)) AND ((target_duration_seconds IS NULL) OR " +
  "(target_duration_seconds >= 0)) AND ((target_distance_meters IS NULL) OR (target_distance_meters >= (0)::numeric))))";
const TIME_DISTANCE_NONNEGATIVE =
  "CHECK ((((duration_seconds IS NULL) OR (duration_seconds >= 0)) AND ((distance_meters IS NULL) OR (distance_meters >= (0)::numeric))))";

// Experience 2.0's own columns and checks on the workout tables, which production keeps after every pending
// migration: nothing in src, admin or scripts reads or writes them, and what happens to them is the owner's
// call, with experience 2.0's other leftovers (dropping the distance columns drops the three checks too).
// 20261115110000 validates the checks, which experience 2.0 added NOT VALID. Values as production ends.
const PRODUCTION_ONLY = {
  column: {
    "workout_sessions.paused_duration_seconds": column("integer", { notNull: true, def: "0" }),
    "workout_sessions.rest_timer_ends_at": column("timestamp with time zone"),
    "workout_plan_exercises.target_distance_meters": column("numeric(10,2)"),
    "workout_session_exercises.target_distance_meters": column("numeric(10,2)"),
    "workout_sets.distance_meters": column("numeric(10,2)"),
  },
  constraint: {
    "workout_plan_exercises.workout_plan_exercises_targets_nonnegative": { definition: TARGETS_NONNEGATIVE, validated: true },
    "workout_session_exercises.workout_session_exercises_targets_nonnegative": { definition: TARGETS_NONNEGATIVE, validated: true },
    "workout_sets.workout_sets_time_distance_nonnegative": { definition: TIME_DISTANCE_NONNEGATIVE, validated: true },
  },
};

// What experience 2.0 added to the workout tables, so production has it before any pending file: the five
// columns 20261115100000 and 20261115110000 add as well (same types, no comment yet), its own columns, and
// its checks, still NOT VALID.
const PRODUCTION_ONLY_BEFORE_PENDING = {
  column: {
    ...PRODUCTION_ONLY.column,
    "workout_sessions.paused_at": column("timestamp with time zone"),
    "workout_plan_exercises.target_weight_kg": column("numeric(8,2)"),
    "workout_plan_exercises.target_duration_seconds": column("integer"),
    "workout_session_exercises.target_weight_kg": column("numeric(8,2)"),
    "workout_session_exercises.target_duration_seconds": column("integer"),
    "workout_sets.duration_seconds": column("integer"),
  },
  constraint: Object.fromEntries(Object.entries(PRODUCTION_ONLY.constraint)
    .map(([key, check]) => [key, { definition: `${check.definition} NOT VALID`, validated: false }])),
};

// What applying the pending files prints about existing workout columns and indexes, per file.
const SKIPPED_ON_PRODUCTION = {
  [PAUSE]: ['column "paused_at" of relation "workout_sessions" already exists, skipping'],
  [TARGETS]: [
    'column "target_weight_kg" of relation "workout_plan_exercises" already exists, skipping',
    'column "target_duration_seconds" of relation "workout_plan_exercises" already exists, skipping',
    'column "target_weight_kg" of relation "workout_session_exercises" already exists, skipping',
    'column "target_duration_seconds" of relation "workout_session_exercises" already exists, skipping',
    'column "duration_seconds" of relation "workout_sets" already exists, skipping',
  ],
};
const WORKOUT_OBJECT = /"workout_(?:sessions|sets|plan_exercises|session_exercises)(?:_\w+)?"/;

// The workout tables and the functions that use them, keyed by object, so two databases can be compared.
const SNAPSHOT = `
with t as (
  select c.oid, c.relname::text as name from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname in (${TABLES.map((name) => `'${name}'`).join(", ")})
)
select jsonb_build_object(
  'table', (select coalesce(jsonb_object_agg(t.name, jsonb_build_object(
      'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity, 'owner', c.relowner::regrole::text,
      'replica_identity', c.relreplident, 'comment', obj_description(c.oid, 'pg_class'),
      'acl', (select jsonb_agg(a::text order by a::text) from unnest(c.relacl) a),
      'publications', (select coalesce(jsonb_agg(p.pubname::text order by p.pubname), '[]'::jsonb)
                       from pg_publication_tables p where p.schemaname = 'public' and p.tablename = t.name))), '{}'::jsonb)
    from t join pg_class c on c.oid = t.oid),
  'column', (select coalesce(jsonb_object_agg(t.name || '.' || a.attname, jsonb_build_object(
      'type', format_type(a.atttypid, a.atttypmod), 'not_null', a.attnotnull, 'default', pg_get_expr(d.adbin, d.adrelid),
      'identity', a.attidentity, 'generated', a.attgenerated,
      'acl', (select jsonb_agg(x::text order by x::text) from unnest(a.attacl) x),
      'comment', col_description(a.attrelid, a.attnum))), '{}'::jsonb)
    from t
    join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum),
  'constraint', (select coalesce(jsonb_object_agg(t.name || '.' || co.conname, jsonb_build_object(
      'definition', pg_get_constraintdef(co.oid), 'validated', co.convalidated)), '{}'::jsonb)
    from t join pg_constraint co on co.conrelid = t.oid),
  'index', (select coalesce(jsonb_object_agg(i.relname, pg_get_indexdef(i.oid)), '{}'::jsonb)
    from t join pg_index x on x.indrelid = t.oid join pg_class i on i.oid = x.indexrelid),
  'policy', (select coalesce(jsonb_object_agg(t.name || '.' || p.polname, jsonb_build_object(
      'command', p.polcmd, 'permissive', p.polpermissive,
      'roles', (select jsonb_agg(case when r = 0 then 'public' else r::regrole::text end
                                 order by case when r = 0 then 'public' else r::regrole::text end)
                from unnest(p.polroles) r),
      'using', pg_get_expr(p.polqual, p.polrelid), 'check', pg_get_expr(p.polwithcheck, p.polrelid))), '{}'::jsonb)
    from t join pg_policy p on p.polrelid = t.oid),
  'trigger', (select coalesce(jsonb_object_agg(t.name || '.' || tg.tgname, jsonb_build_object(
      'definition', pg_get_triggerdef(tg.oid), 'enabled', tg.tgenabled)), '{}'::jsonb)
    from t join pg_trigger tg on tg.tgrelid = t.oid and not tg.tgisinternal),
  'function', (select coalesce(jsonb_object_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', jsonb_build_object(
      'definition', md5(pg_get_functiondef(p.oid)), 'security_definer', p.prosecdef, 'config', p.proconfig,
      'owner', p.proowner::regrole::text,
      'acl', (select jsonb_agg(a::text order by a::text) from unnest(p.proacl) a))), '{}'::jsonb)
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
      and pg_get_functiondef(p.oid) ~ '\\mworkout_(sessions|sets|plan_exercises|session_exercises)\\M')
)::text;`;

/** The error psql reported, from the first ERROR line on, with the file's path shortened to its name. */
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

function short(value) {
  const text = JSON.stringify(value) ?? "none";
  return text.length > 400 ? `${text.slice(0, 397)}...` : text;
}

/**
 * How production's snapshot differs from the clean one, one line per object, given what production alone
 * is expected to have (`expected`, per section). Empty when they match.
 */
function differences(clean, production, expected, sections = Object.keys(clean)) {
  const problems = [];
  for (const section of sections) {
    const a = clean[section] ?? {};
    const b = production[section] ?? {};
    const allowed = expected[section] ?? {};
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b), ...Object.keys(allowed)])].sort()) {
      if (key in allowed) {
        if (key in a) problems.push(`${section} ${key} is listed as production-only, yet the clean path has it too: ${short(a[key])}`);
        if (!(key in b)) problems.push(`${section} ${key} is listed as production-only, but production does not have it`);
        else if (!isDeepStrictEqual(b[key], allowed[key])) problems.push(`${section} ${key} on production: expected ${short(allowed[key])}, got ${short(b[key])}`);
      } else if (!(key in b)) problems.push(`${section} ${key} is only on the clean path: ${short(a[key])}`);
      else if (!(key in a)) problems.push(`${section} ${key} is only on production: ${short(b[key])}`);
      else if (!isDeepStrictEqual(a[key], b[key])) problems.push(`${section} ${key} differs: clean ${short(a[key])}, production ${short(b[key])}`);
    }
  }
  return problems;
}

/** Applies one file in a single transaction, as the owner applies a migration. */
function apply(pg, file) {
  const result = pg.runFile(file, { singleTransaction: true });
  return { ok: result.ok, error: result.ok ? null : errorText(result.stderr), notices: skippedNotices(result.stderr) };
}

// A member who planned and logged a workout on production with the live app before the release: the live
// app already saves targets and set durations there, since experience 2.0's columns exist. The values are
// the limits the app allows (Target kg 0 to 2000, Target sec 1 to 7200, a set's seconds 1 to 86400).
const LIVE = "e0000000-0000-4000-8000-0000000000e1";
const LIVE_PLAN = "e0000000-0000-4000-8000-0000000000e2";
const LIVE_SESSION = "e0000000-0000-4000-8000-0000000000e3";
const LIVE_HOLD = "e0000000-0000-4000-8000-0000000000e4";
const LIVE_LIFT = "e0000000-0000-4000-8000-0000000000e5";
const LIVE_APP_WRITES = `
insert into public.workout_plans (id, user_id, title) values ('${LIVE_PLAN}', '${LIVE}', 'Saved before the release');
insert into public.workout_plan_exercises (user_id, plan_id, exercise_name, sort_order, target_weight_kg, target_duration_seconds) values
  ('${LIVE}', '${LIVE_PLAN}', 'Heaviest load', 0, 2000, null),
  ('${LIVE}', '${LIVE_PLAN}', 'Bodyweight hold', 1, 0, 7200),
  ('${LIVE}', '${LIVE_PLAN}', 'Shortest hold', 2, null, 1);
insert into public.workout_sessions (id, user_id, plan_id, name) values ('${LIVE_SESSION}', '${LIVE}', '${LIVE_PLAN}', 'Saved before the release');
insert into public.workout_session_exercises (id, user_id, session_id, exercise_name, sort_order, target_weight_kg, target_duration_seconds) values
  ('${LIVE_HOLD}', '${LIVE}', '${LIVE_SESSION}', 'Bodyweight hold', 0, 0, 7200),
  ('${LIVE_LIFT}', '${LIVE}', '${LIVE_SESSION}', 'Heaviest load', 1, 2000, null);
insert into public.workout_sets (user_id, session_exercise_id, set_number, reps, weight_kg, duration_seconds, completed_at) values
  ('${LIVE}', '${LIVE_HOLD}', 1, null, 0, 86400, now()),
  ('${LIVE}', '${LIVE_HOLD}', 2, null, 0, 1, now()),
  ('${LIVE}', '${LIVE_LIFT}', 1, 1, 2000, null, now());`;
const LIVE_ROWS = `
select json_build_object(
  'plan', (select json_agg(json_build_array(exercise_name, target_weight_kg, target_duration_seconds) order by sort_order)
           from public.workout_plan_exercises where plan_id = '${LIVE_PLAN}'),
  'session', (select json_agg(json_build_array(exercise_name, target_weight_kg, target_duration_seconds) order by sort_order)
              from public.workout_session_exercises where session_id = '${LIVE_SESSION}'),
  'sets', (select json_agg(json_build_array(se.exercise_name, ws.set_number, ws.reps, ws.weight_kg, ws.duration_seconds)
                           order by se.sort_order, ws.set_number)
           from public.workout_sets ws join public.workout_session_exercises se on se.id = ws.session_exercise_id
           where se.session_id = '${LIVE_SESSION}'),
  'status', (select status from public.workout_sessions where id = '${LIVE_SESSION}'));`;

// A member's workout after the release, as the app runs it.
const MEMBER = "d0000000-0000-4000-8000-0000000000d1";
const asMember = { role: "authenticated", sub: MEMBER };
const LIFT = { exercise_id: null, exercise_name: "Drift bench", target_sets: 2, reps_min: 6, reps_max: 8, rest_seconds: 120, target_weight_kg: 60, target_duration_seconds: null };
const HOLD = { exercise_id: null, exercise_name: "Drift plank", target_sets: 2, reps_min: 1, reps_max: 1, rest_seconds: 45, target_weight_kg: null, target_duration_seconds: 40 };

/** Plans, starts, pauses, resumes, logs and finishes a workout as MEMBER; returns what the member saw. */
function memberWorkout(pg) {
  pg.exec(`insert into auth.users (id, email) values ('${MEMBER}', 'drift-member@example.test');`);
  const plan = pg.json(`select to_json(public.fitx_save_workout_plan('${JSON.stringify({ title: "Drift check" })}'::jsonb, '${JSON.stringify([LIFT, HOLD])}'::jsonb));`, asMember);
  const started = pg.json(`select public.fitx_start_workout_session('${plan}');`, asMember);
  const session = started.session_id;
  // The live session page's pause and resume updates.
  const clock = (sql) => pg.json(`${sql} returning json_build_object('active_duration_seconds', active_duration_seconds,
    'paused', paused_at is not null, 'running', resumed_at is not null);`, asMember);
  const paused = clock(`update public.workout_sessions set active_duration_seconds = 90, paused_at = now(), resumed_at = null
    where id = '${session}' and status = 'in_progress' and paused_at is null`);
  const resumed = clock(`update public.workout_sessions set paused_at = null, resumed_at = now()
    where id = '${session}' and status = 'in_progress' and paused_at is not null`);
  const set = (exercise, number) => `from public.workout_session_exercises se where se.id = ws.session_exercise_id
    and se.session_id = '${session}' and se.exercise_name = '${exercise.exercise_name}' and ws.set_number = ${number}`;
  pg.exec(`update public.workout_sets ws set reps = 8, weight_kg = 60, completed_at = now() ${set(LIFT, 1)};`, asMember);
  pg.exec(`update public.workout_sets ws set reps = null, duration_seconds = 45, completed_at = now() ${set(HOLD, 1)};`, asMember);
  /** The check constraint that rejected a write, or "accepted". */
  const rejectedBy = (sql) => {
    const result = pg.run(sql, asMember);
    return result.ok ? "accepted" : (/violates check constraint "([^"]+)"/.exec(result.stderr)?.[1] ?? errorText(result.stderr));
  };
  // LIFT is the plan's first exercise (sort_order 0), HOLD its second.
  const planRow = (sortOrder) => `where plan_id = '${plan}' and sort_order = ${sortOrder}`;
  const errors = {
    "0-second set": rejectedBy(`update public.workout_sets ws set duration_seconds = 0 ${set(HOLD, 2)};`),
    "negative set seconds": rejectedBy(`update public.workout_sets ws set duration_seconds = -5 ${set(HOLD, 2)};`),
    "set over a day": rejectedBy(`update public.workout_sets ws set duration_seconds = 86401 ${set(HOLD, 2)};`),
    "0-second plan target": rejectedBy(`update public.workout_plan_exercises set target_duration_seconds = 0 ${planRow(1)};`),
    "plan target over two hours": rejectedBy(`update public.workout_plan_exercises set target_duration_seconds = 7201 ${planRow(1)};`),
    "negative plan load": rejectedBy(`update public.workout_plan_exercises set target_weight_kg = -0.5 ${planRow(0)};`),
    "plan load over 2000 kg": rejectedBy(`update public.workout_plan_exercises set target_weight_kg = 2000.01 ${planRow(0)};`),
    "0-second session target": rejectedBy(`update public.workout_session_exercises set target_duration_seconds = 0 where session_id = '${session}' and exercise_name = '${HOLD.exercise_name}';`),
    "negative session load": rejectedBy(`update public.workout_session_exercises set target_weight_kg = -1 where session_id = '${session}' and exercise_name = '${LIFT.exercise_name}';`),
    "negative active time": rejectedBy(`update public.workout_sessions set active_duration_seconds = -1 where id = '${session}';`),
  };
  const summary = pg.json(`select public.fitx_finish_workout_session('${session}', 1800, 'UTC');`, asMember);
  return { resumedExisting: started.resumed, paused, resumed, errors, summary };
}

const skip = available() ? false : "Postgres binaries (initdb, pg_ctl, psql) are not installed";
const KINDS = ["clean", "production"];

test("the production fixtures are byte-identical to the three migrations production recorded outside the repository", () => {
  assert.deepEqual(FIXTURES, Object.keys(PRODUCTION_HISTORY_MD5).sort(), "one fixture per production-only history row");
  for (const name of FIXTURES) {
    const md5 = createHash("md5").update(readFileSync(path.join(FIXTURES_DIR, name))).digest("hex");
    assert.equal(md5, PRODUCTION_HISTORY_MD5[name], `${name} must equal md5(statements[1]) of its row in production's history`);
  }
});

describe("the workout tables on a clean database and on production's replica", { skip }, () => {
  /** @type {Record<string, { pg: LocalPostgres, results: Map<string, { ok: boolean, error: string | null, notices: string[] }>, skipped: string[], failure: { name: string, error: string } | null }>} */
  const paths = {};
  const snapshots = { before: {}, after: {} };
  /** The live member's rows on production: right after the live app saved them, and after the release. */
  const live = { saved: null, released: null };
  /** Production after the files that change the workout tables were applied a second time. */
  const rerun = { results: [], snapshot: null };
  let notReached = null;

  before(() => {
    for (const kind of KINDS) {
      const pg = new LocalPostgres().start();
      paths[kind] = { pg, results: new Map(), skipped: [], failure: null };
      pg.applyFile(SUPABASE_STUB, { singleTransaction: true });
      for (const name of APPLIED) pg.applyFile(path.join(MIGRATIONS_DIR, name), { singleTransaction: true });
      if (kind === "production") for (const name of FIXTURES) pg.applyFile(path.join(FIXTURES_DIR, name), { singleTransaction: true });
      snapshots.before[kind] = pg.json(SNAPSHOT);
    }

    const production = paths.production.pg;
    production.exec(`insert into auth.users (id, email) values ('${LIVE}', 'live-app@example.test');`);
    production.exec(LIVE_APP_WRITES, { role: "authenticated", sub: LIVE });
    live.saved = production.json(LIVE_ROWS);

    for (const kind of KINDS) {
      const entry = paths[kind];
      const cronUsable = entry.pg.pgCronUsable();
      for (const name of PENDING) {
        const file = path.join(MIGRATIONS_DIR, name);
        if (!cronUsable && requiresPgCron(file)) {
          entry.skipped.push(name);
          continue;
        }
        const result = apply(entry.pg, file);
        entry.results.set(name, result);
        if (!result.ok) {
          entry.failure = { name, error: result.error };
          break;
        }
      }
    }
    const failed = KINDS.filter((kind) => paths[kind].failure);
    if (failed.length) {
      notReached = failed.map((kind) => `${paths[kind].failure.name} failed on the ${kind} path`).join("; ");
      return;
    }
    for (const kind of KINDS) snapshots.after[kind] = paths[kind].pg.json(SNAPSHOT);
    live.released = production.json(LIVE_ROWS);

    for (const name of WORKOUT_SCHEMA_FILES) rerun.results.push({ name, ...apply(production, path.join(MIGRATIONS_DIR, name)) });
    rerun.snapshot = production.json(SNAPSHOT);
  });

  after(() => {
    for (const kind of KINDS) paths[kind]?.pg.stop();
  });

  test("before any pending file, production's workout tables differ from the clean path by exactly what experience 2.0 added", () => {
    const sections = ["table", "column", "constraint", "index", "policy", "trigger"];
    const problems = differences(snapshots.before.clean, snapshots.before.production, PRODUCTION_ONLY_BEFORE_PENDING, sections);
    assert.ok(problems.length === 0, `the replica does not start where production does:\n${problems.join("\n")}`);
  });

  test("every pending migration applies on both, in order, each in one transaction", (t) => {
    for (const kind of KINDS) {
      const { results, skipped, failure } = paths[kind];
      for (const name of skipped) t.diagnostic(`${kind}: not applied: ${name}: needs pg_cron, which this local PostgreSQL lacks`);
      if (failure) assert.fail(`on the ${kind} path ${failure.name} failed after ${results.size - 1} pending migrations applied:\n${failure.error}`);
      t.diagnostic(`${kind}: ${results.size} of ${PENDING.length} pending migrations applied`);
    }
    assert.ok(WORKOUT_SCHEMA_FILES.every((name) => PENDING.includes(name)), "every workout file listed here is pending");
  });

  test("only 20261115100000 and 20261115110000 meet existing workout columns, and only on production", (t) => {
    if (notReached) return t.skip(`not checked: ${notReached}`);
    const met = (kind) => Object.fromEntries([...paths[kind].results]
      .map(([name, result]) => [name, result.notices.filter((notice) => WORKOUT_OBJECT.test(notice))])
      .filter(([, notices]) => notices.length));
    assert.deepEqual(met("clean"), {}, "on a fresh database every pending file creates the workout columns and indexes it declares");
    assert.deepEqual(met("production"), SKIPPED_ON_PRODUCTION, "on production only the columns experience 2.0 already added are skipped");
  });

  test("the workout tables end the same on both, apart from experience 2.0's own columns and checks", (t) => {
    if (notReached) return t.skip(`not checked: ${notReached}`);
    const problems = differences(snapshots.after.clean, snapshots.after.production, PRODUCTION_ONLY);
    for (const [section, objects] of Object.entries(PRODUCTION_ONLY)) {
      for (const key of Object.keys(objects)) t.diagnostic(`production only, left for the owner: ${section} ${key}`);
    }
    t.diagnostic(`${Object.keys(snapshots.after.clean.function).length} functions that use the workout tables compared`);
    assert.ok(problems.length === 0, `production ends differently:\n${problems.join("\n")}`);
  });

  test("no constraint on the workout tables is left NOT VALID on either", (t) => {
    if (notReached) return t.skip(`not checked: ${notReached}`);
    for (const kind of KINDS) {
      const unvalidated = Object.entries(snapshots.after[kind].constraint).filter(([, check]) => !check.validated).map(([key]) => key);
      assert.deepEqual(unvalidated, [], `${kind}: constraints not validated`);
    }
  });

  test("targets and timed sets the live app saved on production before the release keep their values", (t) => {
    if (notReached) return t.skip(`not checked: ${notReached}`);
    assert.deepEqual(live.saved, {
      plan: [["Heaviest load", 2000, null], ["Bodyweight hold", 0, 7200], ["Shortest hold", null, 1]],
      session: [["Bodyweight hold", 0, 7200], ["Heaviest load", 2000, null]],
      sets: [["Bodyweight hold", 1, null, 0, 86400], ["Bodyweight hold", 2, null, 0, 1], ["Heaviest load", 1, 1, 2000, null]],
      status: "in_progress",
    });
    assert.deepEqual(live.released, live.saved, "the release changes none of them");
  });

  test("applying the files that change the workout tables again changes nothing on production", (t) => {
    if (notReached) return t.skip(`not checked: ${notReached}`);
    for (const { name, ok, error } of rerun.results) assert.ok(ok, `${name} fails when applied again on production:\n${error}`);
    const problems = differences(snapshots.after.production, rerun.snapshot, {});
    assert.ok(problems.length === 0, `applied again, they change production's workout tables:\n${problems.join("\n")}`);
  });

  test("a member's workout gets the same results and the same errors on both", (t) => {
    if (notReached) return t.skip(`not checked: ${notReached}`);
    const seen = Object.fromEntries(KINDS.map((kind) => [kind, memberWorkout(paths[kind].pg)]));
    assert.deepEqual(seen.clean, {
      resumedExisting: false,
      paused: { active_duration_seconds: 90, paused: true, running: false },
      resumed: { active_duration_seconds: 90, paused: false, running: true },
      errors: {
        "0-second set": "workout_sets_duration_seconds_check",
        "negative set seconds": "workout_sets_duration_seconds_check",
        "set over a day": "workout_sets_duration_seconds_check",
        "0-second plan target": "workout_plan_exercises_target_duration_seconds_check",
        "plan target over two hours": "workout_plan_exercises_target_duration_seconds_check",
        "negative plan load": "workout_plan_exercises_target_weight_kg_check",
        "plan load over 2000 kg": "workout_plan_exercises_target_weight_kg_check",
        "0-second session target": "workout_session_exercises_target_duration_seconds_check",
        "negative session load": "workout_session_exercises_target_weight_kg_check",
        "negative active time": "workout_sessions_active_duration_seconds_check",
      },
      summary: { duration_seconds: 1800, total_volume: 480, sets: 2, records: 1, planner_event_id: null },
    });
    assert.deepEqual(seen.production, seen.clean, "production behaves like the clean path");
  });
});
