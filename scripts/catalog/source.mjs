// Reads the exercise catalogue exactly as the existing migrations create it (read-only, no network):
//  - the 30 FITX starter rows from 20260924170604_fitx_v1_core_product.sql;
//  - the 876 Free Exercise DB rows (base64 JSON) from the nine 20260930…_free_exercise_db_part_0N.sql files.
// The import used `ON CONFLICT (name) DO NOTHING`, so imported rows whose name equals a starter name
// never reached the database; `liveRows` leaves them out (30 + 868 = 898 rows).
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const MIGRATIONS_DIR = "supabase/migrations";
export const STARTER_MIGRATION = "20260924170604_fitx_v1_core_product.sql";
export const IMPORT_MIGRATION_PATTERN = /^\d{14}_free_exercise_db_part_\d{2}\.sql$/;
export const IMPORT_ID_PREFIX = "free-exercise-db-";
export const UPSTREAM_REVISION = "f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5";

/** What the import migrations wrote for every Free Exercise DB row. */
export const IMPORT_DEFAULTS = Object.freeze({
  locations: ["gym", "home"], recommended_sets: 3, reps_min: 8, reps_max: 12, rest_seconds: 90, alternatives: [],
});

const STARTER_COLUMNS = [
  "id", "name", "description", "primary_muscle", "secondary_muscles", "equipment", "locations", "difficulty",
  "movement_pattern", "instructions", "recommended_sets", "reps_min", "reps_max", "rest_seconds", "alternatives",
];
const IMPORT_COLUMNS = [
  "id", "name", "description", "primary_muscle", "secondary_muscles", "equipment", "difficulty", "movement_pattern", "instructions",
];

/** The upstream Free Exercise DB id of an imported row ("free-exercise-db-Pullups" -> "Pullups"). */
export function upstreamIdOf(id) {
  return id.startsWith(IMPORT_ID_PREFIX) ? id.slice(IMPORT_ID_PREFIX.length) : null;
}

/** The migration file names the catalogue is read from, in the order they run. */
export function sourceMigrations(root = REPO_ROOT) {
  const imports = readdirSync(path.join(root, MIGRATIONS_DIR)).filter((name) => IMPORT_MIGRATION_PATTERN.test(name)).sort();
  return [STARTER_MIGRATION, ...imports];
}

// ---------------------------------------------------------------- starter rows

/** Splits `('a', array['b','c'], 3), (...)` into value tuples; strings may contain doubled quotes. */
export function parseSqlTuples(text) {
  const tuples = [];
  let index = 0;
  const peek = () => text[index];
  const skipSpace = () => { while (index < text.length && /[\s,]/.test(text[index])) index += 1; };
  const readString = () => {
    index += 1; // opening quote
    let value = "";
    for (;;) {
      if (index >= text.length) throw new Error("Unterminated string in starter rows");
      const char = text[index];
      if (char === "'") {
        if (text[index + 1] === "'") { value += "'"; index += 2; continue; }
        index += 1;
        return value;
      }
      value += char;
      index += 1;
    }
  };
  const readArray = () => {
    index += "array[".length;
    const items = [];
    for (;;) {
      while (/[\s,]/.test(peek())) index += 1;
      if (peek() === "]") { index += 1; break; }
      if (peek() !== "'") throw new Error(`Unexpected array element at ${index}: ${text.slice(index, index + 20)}`);
      items.push(readString());
    }
    const cast = /^::text\[\]/.exec(text.slice(index));
    if (cast) index += cast[0].length;
    return items;
  };
  const readValue = () => {
    if (peek() === "'") return readString();
    if (text.startsWith("array[", index)) return readArray();
    const number = /^-?\d+/.exec(text.slice(index));
    if (number) { index += number[0].length; return Number(number[0]); }
    throw new Error(`Unexpected value at ${index}: ${text.slice(index, index + 20)}`);
  };
  for (;;) {
    skipSpace();
    if (index >= text.length) break;
    if (peek() !== "(") throw new Error(`Expected a tuple at ${index}: ${text.slice(index, index + 20)}`);
    index += 1;
    const values = [];
    for (;;) {
      while (/\s/.test(peek())) index += 1;
      if (peek() === ")") { index += 1; break; }
      if (peek() === ",") { index += 1; continue; }
      values.push(readValue());
    }
    tuples.push(values);
  }
  return tuples;
}

export function parseStarterRows(sql) {
  const start = sql.indexOf("('bench_press'");
  const end = sql.indexOf("on conflict (id) do update", start);
  if (start < 0 || end < 0) throw new Error("Starter exercise rows not found in the core migration");
  return parseSqlTuples(sql.slice(start, end)).map((values) => {
    if (values.length !== STARTER_COLUMNS.length) throw new Error(`Starter row has ${values.length} values: ${values[0]}`);
    return Object.fromEntries(STARTER_COLUMNS.map((column, i) => [column, values[i]]));
  });
}

// ---------------------------------------------------------------- imported rows

const IMPORT_ARRAY_COLUMNS = new Set(["secondary_muscles", "equipment", "instructions"]);

export function parseImportRows(sql) {
  const rows = [];
  for (const match of sql.matchAll(/decode\('([A-Za-z0-9+/=]+)'/g)) {
    for (const row of JSON.parse(Buffer.from(match[1], "base64").toString("utf8"))) {
      rows.push(Object.fromEntries(IMPORT_COLUMNS.map((column) => [column, row[column] ?? (IMPORT_ARRAY_COLUMNS.has(column) ? [] : "")])));
    }
  }
  return rows;
}

// ---------------------------------------------------------------- the live catalogue

/**
 * The catalogue as the database holds it after the existing migrations:
 * `starter` (30), `imported` (all 876 source rows), `skippedImports` (the 8 whose name equals a
 * starter row), and `liveRows` (898; imported rows carry the import's blanket defaults).
 */
export function loadSources(root = REPO_ROOT) {
  const read = (name) => readFileSync(path.join(root, MIGRATIONS_DIR, name), "utf8");
  const [starterFile, ...importFiles] = sourceMigrations(root);
  const starter = parseStarterRows(read(starterFile)).map((row) => ({ ...row, origin: "starter" }));
  const imported = importFiles.flatMap((name) => parseImportRows(read(name))).map((row) => ({ ...row, origin: "free_exercise_db" }));
  const starterNames = new Set(starter.map((row) => row.name));
  const seenNames = new Set(starterNames);
  const live = [...starter];
  const skippedImports = [];
  for (const row of imported) {
    if (seenNames.has(row.name)) { skippedImports.push(row); continue; }
    seenNames.add(row.name);
    live.push({ ...row, ...structuredClone(IMPORT_DEFAULTS) });
  }
  return { starter, imported, skippedImports, liveRows: live, migrations: [starterFile, ...importFiles] };
}
