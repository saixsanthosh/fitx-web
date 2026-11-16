// Builds the FITX food catalogue seed migrations from USDA FoodData Central data.
//
//   node --import ./tests/setup/hooks.mjs scripts/import-fdc.mjs <data-dir> [--check]
//
// <data-dir> holds either or both of:
// - the bulk JSON downloads from https://fdc.nal.usda.gov/download-datasets, zipped or unzipped:
//   FoodData_Central_survey_food_json_*.zip (Survey (FNDDS)) and FoodData_Central_foundation_food_json_*.zip;
// - search responses saved from POST https://api.nal.usda.gov/fdc/v1/foods/search with
//   {"query":"*","dataType":[...],"pageSize":200,"pageNumber":N,"sortBy":"fdcId","sortOrder":"asc"}:
//   fndds-p*.json and foundation-p*.json.
// A bulk file wins over pages of the same data type. SR Legacy foods come only from the curated staples in
// src/data/fitx-staples.json. Writes supabase/migrations/202611181400NN_fitx_food_catalog_seed_part_NN.sql from
// version 20261118140010 (about 150 KB each; staples, Indian dishes and Foundation foods first) and prints a summary.
// Each part adds only foods the catalogue does not have yet, so applying it again is harmless and never undoes later
// edits. --check builds everything but writes nothing. --append keeps the existing parts exactly as they are and
// writes only foods they do not hold, as new parts after them, so a database that already applied the old parts
// needs only the new ones (use it once parts have been applied anywhere).
//
// Every number is copied from FDC. FDC data is public domain (CC0 1.0).
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { catalogRow, fromFullRecord, withStaple } from "@/lib/food/fdc-import";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const STAPLES = path.join(ROOT, "src", "data", "fitx-staples.json");
const FIRST_PART_VERSION = 20261118140010;
const PART_BYTES = 150_000;
const ATTRIBUTION = "U.S. Department of Agriculture, Agricultural Research Service. FoodData Central. fdc.nal.usda.gov";

const [dataDir, ...flags] = process.argv.slice(2);
if (!dataDir) {
  console.error("usage: node --import ./tests/setup/hooks.mjs scripts/import-fdc.mjs <data-dir> [--check]");
  process.exit(2);
}
const check = flags.includes("--check");
const append = flags.includes("--append");
const SEED_PART = /^202611181400\d\d_fitx_food_catalog_seed_part_\d+\.sql$/;

/** The parts already written, and the food ids they hold (each part's foods are one JSON array). */
const existingParts = readdirSync(MIGRATIONS).filter((name) => SEED_PART.test(name)).sort();
const existingIds = new Set();
if (append) {
  for (const name of existingParts) {
    const sql = readFileSync(path.join(MIGRATIONS, name), "utf8");
    const start = sql.indexOf("$fitx$[");
    const end = sql.indexOf("]$fitx$");
    if (start < 0 || end < 0) throw new Error(`${name}: no food list found`);
    for (const food of JSON.parse(sql.slice(start + "$fitx$".length, end + 1))) existingIds.add(String(food.id));
  }
}

function readPages(prefix) {
  const files = readdirSync(dataDir).filter((name) => name.startsWith(`${prefix}-p`) && /-p\d+\.json$/.test(name));
  files.sort((a, b) => Number(/-p(\d+)\.json$/.exec(a)[1]) - Number(/-p(\d+)\.json$/.exec(b)[1]));
  const foods = [];
  let expected = null;
  let pagesTotal = null;
  for (const file of files) {
    const page = JSON.parse(readFileSync(path.join(dataDir, file), "utf8"));
    expected ??= page.totalHits ?? null;
    pagesTotal ??= page.totalPages ?? null;
    foods.push(...(page.foods ?? []));
  }
  const source = files.length ? `API search pages (${files.length} of ${pagesTotal ?? "?"})` : null;
  return { foods, expected, source };
}

/**
 * The newest bulk download of a kind ("survey", "foundation"): the zip as downloaded, or the JSON file unzipped from
 * it (FoodData_Central_<kind>_food_json_<date>.json or <kind>Download.json). Its records, in the search shape.
 */
function readBulk(kind) {
  const pattern = new RegExp(`^(FoodData_Central_${kind}_food_json_[0-9-]+\\.(zip|json)|${kind}Download\\.json)$`);
  const files = readdirSync(dataDir).filter((name) => pattern.test(name)).sort();
  const file = files.at(-1);
  if (!file) return null;
  const full = path.join(dataDir, file);
  const text = file.endsWith(".zip")
    ? execFileSync("unzip", ["-p", full, "*.json"], { maxBuffer: 1024 * 1024 * 1024, encoding: "utf8" })
    : readFileSync(full, "utf8");
  const data = JSON.parse(text);
  const records = Object.values(data).find((value) => Array.isArray(value));
  if (!records) throw new Error(`${file}: no list of foods in it`);
  return { foods: records.map((record) => fromFullRecord(record)), expected: records.length, source: `bulk download ${file}` };
}

const fndds = readBulk("survey") ?? readPages("fndds");
const foundation = readBulk("foundation") ?? readPages("foundation");
const staples = JSON.parse(readFileSync(STAPLES, "utf8"));

const rows = new Map();
const skipped = new Map();
for (const record of [...fndds.foods, ...foundation.foods]) {
  const row = catalogRow(record);
  if ("skip" in row) {
    skipped.set(row.skip, (skipped.get(row.skip) ?? 0) + 1);
    continue;
  }
  if (!rows.has(row.id)) rows.set(row.id, row);
}

// Curated staples: their aliases, state and chosen portions win; SR Legacy staples are added as they are.
const stapleIds = new Set();
for (const staple of staples.foods) {
  const existing = rows.get(staple.id) ?? null;
  if (existing && (Math.abs(existing.kcal - staple.calories) > 0.6 || Math.abs(existing.protein - staple.protein) > 0.06)) {
    throw new Error(`staple ${staple.id} ${staple.name}: values differ from the FDC record (${existing.kcal} vs ${staple.calories} kcal)`);
  }
  rows.set(staple.id, withStaple(existing, staple));
  stapleIds.add(staple.id);
}

// Order: curated staples, Indian dishes, Foundation (lab-analysed), then FNDDS by how often Indian users are likely
// to log that kind of food (grains and breads first, US mixed dishes last), so the first parts are useful alone.
const CATEGORY_PRIORITY = [
  /rice|grain|pasta|noodle|bread|roll|tortilla|cereal|oatmeal|biscuit|bagel/i,
  /bean|pea|legume|lentil|nut|seed/i,
  /vegetable|potato|tomato|lettuce|onion|carrot|greens|broccoli|squash|corn/i,
  /fruit|apple|banana|citrus|berr|melon|grape|mango|dried fruit/i,
  /milk|yogurt|cheese|cream|egg|omelet|dairy/i,
  /chicken|turkey|poultry|fish|seafood|shellfish/i,
  /beef|pork|lamb|goat|meat|sausage|bacon|frankfurter/i,
  /juice|tea|coffee|water|soft drink|beverage|smoothie|nutritional|sport|energy/i,
  /sugar|candy|chocolate|cake|cookie|pie|pastry|dessert|ice cream|pudding|doughnut|sweet/i,
  /snack|chip|cracker|popcorn|pretzel/i,
  /oil|butter|fat|dressing|sauce|gravy|condiment|dip|spread/i,
];
const categoryRank = (category) => {
  const index = CATEGORY_PRIORITY.findIndex((pattern) => pattern.test(String(category ?? "")));
  return index < 0 ? CATEGORY_PRIORITY.length : index;
};
const rank = (row) => (stapleIds.has(row.id) ? 0 : row.cuisine === "indian" ? 1 : row.valueBasis === "lab_analysed" ? 2 : 3);
const ordered = [...rows.values()].filter((row) => !existingIds.has(row.id)).sort((a, b) => rank(a) - rank(b) || categoryRank(a.category) - categoryRank(b.category)
  || String(a.category).localeCompare(String(b.category)) || a.name.localeCompare(b.name));

function compact(row) {
  const out = { id: row.id, n: row.name };
  if (row.aliases.length) out.a = row.aliases;
  if (row.keywords.length) out.k = row.keywords;
  if (row.category) out.c = row.category;
  if (row.cuisine) out.cu = row.cuisine;
  if (row.dietType) out.d = row.dietType;
  if (row.state) out.s = row.state;
  out.e = row.kcal;
  out.p = row.protein;
  out.cb = row.carbs;
  out.f = row.fat;
  if (row.fiber !== null) out.fi = row.fiber;
  if (row.sugar !== null) out.su = row.sugar;
  if (row.sodiumMg !== null) out.na = row.sodiumMg;
  out.vb = row.valueBasis;
  out.dt = row.dataType;
  if (row.version) out.v = row.version;
  if (row.portions.length) out.po = row.portions.map((portion) => (portion.isDefault ? [portion.label, portion.unit, portion.grams, true] : [portion.label, portion.unit, portion.grams]));
  return JSON.stringify(out);
}

// Split into parts by size.
const parts = [];
let current = [];
let size = 0;
for (const row of ordered) {
  const json = compact(row);
  if (json.includes("$fitx$")) throw new Error(`row ${row.id} contains the dollar-quote tag`);
  if (current.length && size + json.length > PART_BYTES) {
    parts.push(current);
    current = [];
    size = 0;
  }
  current.push({ row, json });
  size += json.length + 2;
}
if (current.length) parts.push(current);
const firstIndex = append ? existingParts.length : 0;
if (firstIndex + parts.length > 50) throw new Error(`${firstIndex + parts.length} parts do not fit the migration numbering (20261118140010-59)`);

const sources = [
  fndds.source && `Survey (FNDDS) from ${fndds.source}`,
  foundation.source && `Foundation from ${foundation.source}`,
  `the curated staples in src/data/fitx-staples.json (retrieved ${staples.retrieved})`,
].filter(Boolean).join(", ");
function partSql(items, index) {
  const foods = items.length;
  const portions = items.reduce((sum, item) => sum + item.row.portions.length, 0);
  return `-- FITX food catalogue, part ${String(index + 1).padStart(2, "0")}: ${foods} foods and ${portions} household portions.
-- Generated by scripts/import-fdc.mjs from USDA FoodData Central: ${sources}.
-- Public domain (CC0 1.0). Needs 20261118140000_fitx_food_catalog.sql. Adds only the foods the catalogue does not
-- have yet, each with its portions, so running it again changes nothing and never undoes later changes (a food
-- hidden or corrected since stays that way); corrections to foods already added ship as their own migrations.
-- Keys: n name, a aliases, k keywords, c category, cu cuisine, d diet type, s state, e kcal, p protein, cb carbs,
-- f fat, fi fibre, su sugar, na sodium mg (per 100 g), vb value basis, dt FDC data type, v FDC publication date,
-- po portions [label, unit, grams, bare-count default].
create temp table if not exists fitx_food_seed (
  id text primary key, n text, a text[], k text[], c text, cu text, d text, s text, e numeric, p numeric, cb numeric,
  f numeric, fi numeric, su numeric, na numeric, vb text, dt text, v text, po jsonb
);
truncate fitx_food_seed;
insert into fitx_food_seed
select * from jsonb_to_recordset($fitx$[
${items.map((item) => item.json).join(",\n")}
]$fitx$::jsonb) as r(id text, n text, a text[], k text[], c text, cu text, d text, s text, e numeric, p numeric, cb numeric,
  f numeric, fi numeric, su numeric, na numeric, vb text, dt text, v text, po jsonb);

with added as (
  insert into public.food_catalog (id, name, aliases, keywords, category, cuisine, diet_type, state, kcal, protein_g, carbs_g,
    fat_g, fiber_g, sugar_g, sodium_mg, value_basis, source, source_ref, source_data_type, source_version, licence, attribution, is_active)
  select id, n, coalesce(a, '{}'::text[]), coalesce(k, '{}'::text[]), c, cu, d, s, e, coalesce(p, 0), coalesce(cb, 0), coalesce(f, 0),
    fi, su, na, vb, 'usda_fdc', id, dt, v, 'CC0-1.0', '${ATTRIBUTION}', true
  from fitx_food_seed
  on conflict (id) do nothing
  returning id
)
insert into public.food_portions (food_id, label, unit, grams, is_default, is_estimate, source, sort_order)
select s.id, x.value ->> 0, x.value ->> 1, (x.value ->> 2)::numeric, coalesce((x.value ->> 3)::boolean, false), true, 'usda_fdc',
  (x.ord - 1)::smallint
from fitx_food_seed s
join added on added.id = s.id
cross join lateral jsonb_array_elements(coalesce(s.po, '[]'::jsonb)) with ordinality as x(value, ord);

drop table fitx_food_seed;
`;
}

const summary = {
  fndds: { records: fndds.foods.length, expected: fndds.expected, source: fndds.source },
  foundation: { records: foundation.foods.length, expected: foundation.expected, source: foundation.source },
  staples: staples.foods.length,
  foods: ordered.length,
  portions: ordered.reduce((sum, row) => sum + row.portions.length, 0),
  indian: ordered.filter((row) => row.cuisine === "indian").length,
  byBasis: Object.fromEntries(["lab_analysed", "compiled", "recipe_calculated"].map((basis) => [basis, ordered.filter((row) => row.valueBasis === basis).length])),
  byDiet: Object.fromEntries(["vegan", "veg", "egg", "non_veg", null].map((diet) => [String(diet), ordered.filter((row) => row.dietType === diet).length])),
  skipped: Object.fromEntries(skipped),
  parts: parts.length,
  keptParts: append ? existingParts.length : 0,
  keptFoods: existingIds.size,
};

if (!check) {
  if (!append) for (const name of existingParts) rmSync(path.join(MIGRATIONS, name));
  let bytes = 0;
  parts.forEach((items, offset) => {
    const index = firstIndex + offset;
    const version = String(FIRST_PART_VERSION + index);
    const file = path.join(MIGRATIONS, `${version}_fitx_food_catalog_seed_part_${String(index + 1).padStart(2, "0")}.sql`);
    const sql = partSql(items, index);
    writeFileSync(file, sql);
    bytes += Buffer.byteLength(sql);
  });
  summary.bytes = bytes;
}
console.log(JSON.stringify(summary, null, 2));
