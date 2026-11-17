// Nutrition v2 on a database shaped like production. Production's migration history has three migrations that no
// file in supabase/migrations matches; tests/integration/fixtures/production-drift has them byte for byte. One of
// them, 20261002172610_fitx_experience_2_0, gave public.custom_foods a barcode column before Nutrition v2 did, with
// its own rules: the check custom_foods_barcode_format_check (8, 12, 13 or 14 digits) and the unique index
// custom_foods_user_barcode_unique on (user_id, barcode) where barcode is not null, which an archived food keeps
// holding. 20261118140001 replaces both, so production ends with Nutrition v2's rules.
//
// Two throwaway databases get the migrations the way the owner applies them: in version order, one file at a time,
// each in a single transaction (the exercise catalogue parts are only data and are left out of both):
//   clean    the Supabase stand-in, the September files, then every later file;
//   replica  the same, with the three production-only migrations, in version order, right after the September
//            files, which is where production has them.
// Then the nutrition files (20261118140000 to 20261118140014 and 20261118200000) must have left the nutrition tables
// and functions the same on both, apart from the experience 2.0 leftovers listed below; barcodes must follow the same
// rules on both; and applying the nutrition files again must change nothing.
// Skipped when the PostgreSQL server binaries (initdb, pg_ctl, psql) are not on PATH.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LocalPostgres, MIGRATIONS_DIR, SUPABASE_STUB, available, requiresPgCron } from "../support/local-postgres.mjs";

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "production-drift");
/** md5(statements[1]) of each production-only row in supabase_migrations.schema_migrations, read 2026-11-17. */
const PRODUCTION_ONLY = {
  "20261002172610_fitx_experience_2_0.sql": "8cade9d4cc29515551260735fbcca189",
  "20261002172706_fitx_share_access_and_index.sql": "a1d1251b3971a7e63274af58ff2ca142",
  "20261116093902_fitx_admin_control_plane.sql": "91921eac9b51cdf9a279008693d51944",
};
const MIGRATIONS = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql") && !/free_exercise_db_part/.test(name)).sort();
/** Production's history has every repo file before this version (the September files) and none from it on. */
const FIRST_PENDING = "20261115100000";
const NUTRITION = MIGRATIONS.filter((name) => /^(2026111814\d{4}|20261118200000)_/.test(name));

const TABLES = ["custom_foods", "meals", "meal_templates", "meal_template_items", "nutrition_targets", "food_catalog", "food_portions", "food_favorites"];
const FUNCTIONS = ["search_foods", "food_catalog_before_write"];

// Experience 2.0 objects that production keeps and a fresh database never gets. No FITX code uses them; whether to
// keep or drop them is the owner's call, so the nutrition files leave them alone. Remove an entry once a migration
// settles it.
const PRODUCTION_LEFTOVERS = {
  "custom_foods.additional_nutrients, ingredients and allergens": /^column custom_foods\.(additional_nutrients|ingredients|allergens)$/,
  "the food_favorites table": /^(relation|column|constraint|index|policy|rows) food_favorites(\.|$)/,
};

// The nutrition tables and functions: definitions, access rules and row counts, plus the catalogue rows the seed
// parts write (without their timestamps).
const SNAPSHOT = `
with rels as (
  select c.oid, c.relname as name from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
    and c.relname = any (array[${TABLES.map((name) => `'${name}'`).join(", ")}])
)
select jsonb_build_object(
  'relation', (select jsonb_object_agg(r.name, jsonb_build_object(
      'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity, 'owner', c.relowner::regrole::text,
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
  'index', (select jsonb_object_agg(r.name || '.' || i.relname, pg_get_indexdef(i.oid))
    from rels r join pg_index x on x.indrelid = r.oid join pg_class i on i.oid = x.indexrelid),
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
  'function', (select jsonb_object_agg(p.oid::regprocedure::text, jsonb_build_object(
      'definition', md5(pg_get_functiondef(p.oid)), 'security_definer', p.prosecdef, 'config', p.proconfig,
      'owner', p.proowner::regrole::text,
      'acl', (select jsonb_agg(a::text order by a::text) from unnest(p.proacl) a)))
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = any (array[${FUNCTIONS.map((name) => `'${name}'`).join(", ")}])),
  'extension', (select jsonb_object_agg(e.extname, jsonb_build_object('version', e.extversion, 'schema', e.extnamespace::regnamespace::text))
    from pg_extension e where e.extname = 'pg_trgm'),
  'rows', (select jsonb_object_agg(r.name, (xpath('/row/n/text()', query_to_xml(
      format('select count(*) as n from %s', r.oid::regclass), false, true, '')))[1]::text::bigint)
    from rels r),
  'catalogue', jsonb_build_object(
    'food_catalog', (select md5(coalesce(string_agg((to_jsonb(f) - 'created_at' - 'updated_at')::text, E'\\n' order by f.id), ''))
      from public.food_catalog f),
    'food_portions', (select md5(coalesce(string_agg((to_jsonb(p) - 'id')::text, E'\\n' order by p.food_id, p.label), ''))
      from public.food_portions p))
)::text;`;

/** The error psql reported, from the first ERROR line on, with the file's path shortened to its name. */
function errorText(stderr) {
  const lines = stderr.split("\n").filter((line) => !/there is (already a|no) transaction in progress/.test(line));
  const start = lines.findIndex((line) => /\bERROR:/.test(line));
  return (start === -1 ? lines : lines.slice(start)).map((line) => line.replace(/^psql:.*?([^/]+\.sql):(\d+): /, "$1:$2: ")).join("\n").trim();
}

/** The "... already exists, skipping" notices psql printed while applying a file. */
const skippedNotices = (stderr) => [...stderr.matchAll(/NOTICE:\s+(.+ already exists, skipping)/g)].map((match) => match[1]);

/**
 * A database with the migrations applied in order, one transaction each; with `productionOnly`, the three
 * production-only migrations go right after the September files. Records each file's skipped-object notices and
 * stops at the first failure.
 */
function build(productionOnly) {
  const db = { pg: new LocalPostgres().start(), notices: {}, failure: null };
  try {
    db.pg.applyFile(SUPABASE_STUB, { singleTransaction: true });
    const cronUsable = db.pg.pgCronUsable();
    const files = [
      ...MIGRATIONS.filter((name) => name < FIRST_PENDING).map((name) => path.join(MIGRATIONS_DIR, name)),
      ...(productionOnly ? Object.keys(PRODUCTION_ONLY).sort().map((name) => path.join(FIXTURES_DIR, name)) : []),
      ...MIGRATIONS.filter((name) => name >= FIRST_PENDING).map((name) => path.join(MIGRATIONS_DIR, name)),
    ];
    for (const file of files) {
      // pg_cron: Supabase has it, a plain local PostgreSQL usually lacks it; nothing in nutrition depends on it.
      if (!cronUsable && requiresPgCron(file)) continue;
      const result = db.pg.runFile(file, { singleTransaction: true });
      if (!result.ok) {
        db.failure = `${path.basename(file)} failed:\n${errorText(result.stderr)}`;
        break;
      }
      const notices = skippedNotices(result.stderr);
      if (notices.length) db.notices[path.basename(file)] = notices;
    }
  } catch (error) {
    db.failure = String(error);
  }
  return db;
}

/** Every object whose snapshot differs, as "<section> <key>" and where it is. */
function compare(clean, replica) {
  const differences = [];
  for (const section of new Set([...Object.keys(clean), ...Object.keys(replica)])) {
    const a = clean[section] ?? {};
    const b = replica[section] ?? {};
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const object = `${section} ${key}`;
      if (!(key in a)) differences.push({ object, only: "replica", replica: b[key] });
      else if (!(key in b)) differences.push({ object, only: "clean", clean: a[key] });
      else if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) differences.push({ object, clean: a[key], replica: b[key] });
    }
  }
  return differences.sort((x, y) => x.object.localeCompare(y.object));
}

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const PRODUCT = "8901063011366";

/** What saving a custom food with this barcode does for the member: "saved", or the rule that refused it. */
function save(pg, member, barcode) {
  const result = pg.run(
    `insert into public.custom_foods (user_id, name, serving_grams, calories_per_100g, barcode, origin, value_basis)
     values ('${member}', 'Biscuits', 25, 480, '${barcode}', 'barcode', 'label');`,
    { role: "authenticated", sub: member },
  );
  return result.ok ? "saved" : (result.stderr.match(/violates (?:unique|check) constraint "([^"]+)"/)?.[1] ?? result.stderr);
}

/** Saves barcodes the way members do (signed in, under row level security) and reports what each one did. */
function barcodeRules(pg) {
  pg.exec(`insert into auth.users (id, email) values ('${A}', 'a@example.test'), ('${B}', 'b@example.test');`);
  const rules = { first: save(pg, A, PRODUCT), again: save(pg, A, PRODUCT), otherMember: save(pg, B, PRODUCT) };
  pg.exec(`update public.custom_foods set archived_at = now() where barcode = '${PRODUCT}';`, { role: "authenticated", sub: A });
  rules.afterArchiving = save(pg, A, PRODUCT);
  rules.againAfterArchiving = save(pg, A, PRODUCT);
  for (const barcode of ["1234567", "12345670", "123456789", "12345678901", "12345678901234", "123456789012345", "12AB5678"]) {
    rules[`${barcode.length} characters: ${barcode}`] = save(pg, A, barcode);
  }
  return rules;
}

// Nutrition v2's rules: 8 to 14 digits; one active food per barcode per member; an archived food frees its barcode.
const BARCODE_RULES = {
  first: "saved",
  again: "custom_foods_user_barcode_idx",
  otherMember: "saved",
  afterArchiving: "saved",
  againAfterArchiving: "custom_foods_user_barcode_idx",
  "7 characters: 1234567": "custom_foods_barcode_check",
  "8 characters: 12345670": "saved",
  "9 characters: 123456789": "saved",
  "11 characters: 12345678901": "saved",
  "14 characters: 12345678901234": "saved",
  "15 characters: 123456789012345": "custom_foods_barcode_check",
  "8 characters: 12AB5678": "custom_foods_barcode_check",
};

const indent = (text) => `    ${text.replaceAll("\n", "\n    ")}`;

const skip = available() ? false : "Postgres binaries (initdb, pg_ctl, psql) are not installed";

test("the production-only migrations are byte for byte what production's history holds", () => {
  const files = readdirSync(FIXTURES_DIR).filter((name) => name.endsWith(".sql")).sort();
  assert.deepEqual(files, Object.keys(PRODUCTION_ONLY).sort());
  for (const [name, md5] of Object.entries(PRODUCTION_ONLY)) {
    assert.equal(createHash("md5").update(readFileSync(path.join(FIXTURES_DIR, name))).digest("hex"), md5, `${name} no longer matches production`);
  }
  assert.ok(NUTRITION.includes("20261118140001_fitx_nutrition_user_data.sql"), "the nutrition files are found by version");
});

describe("Nutrition v2 on a fresh database and on production's schema", { skip }, () => {
  /** @type {{ pg: LocalPostgres, notices: Record<string, string[]>, failure: string | null }} */
  let clean;
  /** @type {{ pg: LocalPostgres, notices: Record<string, string[]>, failure: string | null }} */
  let replica;
  const failed = () => [clean, replica].find((db) => db.failure)?.failure;

  before(() => {
    clean = build(false);
    replica = build(true);
  });

  after(() => {
    clean?.pg.stop();
    replica?.pg.stop();
  });

  test("every migration applies on both, in order, each in one transaction", () => {
    assert.equal(clean.failure, null, `clean: ${clean.failure}`);
    assert.equal(replica.failure, null, `production replica: ${replica.failure}`);
  });

  test("on production's schema, the nutrition files find only custom_foods.barcode already there", (t) => {
    if (failed()) return t.skip(`not checked: ${failed()}`);
    const nutritionNotices = (db) => Object.fromEntries(Object.entries(db.notices).filter(([name]) => NUTRITION.includes(name)));
    assert.deepEqual(nutritionNotices(clean), {}, "on a fresh database every nutrition file creates what it declares");
    assert.deepEqual(nutritionNotices(replica), {
      "20261118140001_fitx_nutrition_user_data.sql": ['column "barcode" of relation "custom_foods" already exists, skipping'],
    });
  });

  test("the nutrition tables and functions end the same on both, apart from production's leftovers", (t) => {
    if (failed()) return t.skip(`not checked: ${failed()}`);
    const fresh = clean.pg.json(SNAPSHOT);
    assert.ok(fresh.rows.food_catalog > 1000, `the food parts loaded (${fresh.rows.food_catalog} foods), so the catalogue rows are compared too`);
    const differences = compare(fresh, replica.pg.json(SNAPSHOT));
    const leftover = (difference) => difference.only === "replica" && Object.values(PRODUCTION_LEFTOVERS).some((pattern) => pattern.test(difference.object));
    const problems = differences.filter((difference) => !leftover(difference)).map((difference) =>
      difference.only
        ? `${difference.object} exists only on the ${difference.only === "clean" ? "fresh database" : "production replica"}: ${JSON.stringify(difference[difference.only])}`
        : `${difference.object} differs:\n${indent(`fresh:      ${JSON.stringify(difference.clean)}\nproduction: ${JSON.stringify(difference.replica)}`)}`);
    for (const [what, pattern] of Object.entries(PRODUCTION_LEFTOVERS)) {
      const found = differences.filter((difference) => leftover(difference) && pattern.test(difference.object));
      if (found.length) t.diagnostic(`left for the owner: ${what}: ${found.map((difference) => difference.object).join(", ")}`);
      else problems.push(`PRODUCTION_LEFTOVERS lists ${what}, which no longer differs: remove it`);
    }
    assert.ok(problems.length === 0, problems.join("\n"));
  });

  test("barcodes follow Nutrition v2's rules on both", (t) => {
    if (failed()) return t.skip(`not checked: ${failed()}`);
    assert.deepEqual(barcodeRules(clean.pg), BARCODE_RULES, "fresh database");
    assert.deepEqual(barcodeRules(replica.pg), BARCODE_RULES, "production replica");
  });

  test("applying the nutrition files again, with foods saved, changes nothing on either", (t) => {
    if (failed()) return t.skip(`not checked: ${failed()}`);
    for (const [label, db] of [["fresh database", clean], ["production replica", replica]]) {
      const before = db.pg.json(SNAPSHOT);
      for (const name of NUTRITION) {
        const result = db.pg.runFile(path.join(MIGRATIONS_DIR, name), { singleTransaction: true });
        assert.ok(result.ok, `${label}: ${name} fails when applied again:\n${indent(errorText(result.stderr))}`);
      }
      assert.deepEqual(compare(before, db.pg.json(SNAPSHOT)), [], `${label}: applying the nutrition files again changed the database`);
    }
  });
});
