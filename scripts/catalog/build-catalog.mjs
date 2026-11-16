// Regenerates supabase/migrations/20261118130010_fitx_exercise_catalog_cleanup.sql from the existing
// catalogue migrations, the rules (rules.mjs) and the curated corrections (curation.mjs).
//
//   node scripts/catalog/build-catalog.mjs                      write the migration
//   node scripts/catalog/build-catalog.mjs --check              exit 1 if the committed file is out of date
//   node scripts/catalog/build-catalog.mjs --upstream <path>    first take category and mechanic from an upstream
//                                                               Free Exercise DB exercises.json (or checkout)
//
// --upstream stores what it read in scripts/catalog/upstream-classification.json so later builds and the
// tests reproduce the same migration without the upstream files. Nothing is downloaded.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

// taxonomy.ts is TypeScript in a package without "type": "module"; Node loads it fine but warns.
process.removeAllListeners("warning");
process.on("warning", (warning) => {
  if (warning.code !== "MODULE_TYPELESS_PACKAGE_JSON") console.warn(`${warning.name}: ${warning.message}`);
});

const { values } = parseArgs({ options: { upstream: { type: "string" }, check: { type: "boolean", default: false } } });
const { readUpstreamExercises, summarizeCatalog, writeUpstreamSnapshot, UPSTREAM_SNAPSHOT } = await import("./catalog.mjs");
const { MIGRATION_PATH, generateMigration } = await import("./migration.mjs");
const { REPO_ROOT } = await import("./source.mjs");

if (values.upstream) {
  const saved = writeUpstreamSnapshot(readUpstreamExercises(path.resolve(values.upstream)));
  console.log(`Saved the upstream category and mechanic of ${saved} exercises to ${UPSTREAM_SNAPSHOT}.`);
}

const { rows, text } = generateMigration();
const target = path.join(REPO_ROOT, MIGRATION_PATH);
const current = existsSync(target) ? readFileSync(target, "utf8") : null;
const summary = summarizeCatalog(rows);
console.log(`${summary.rows} rows (${summary.active} active, ${summary.merged} merged).`);
for (const field of ["category", "mechanic", "prescription", "location"]) {
  console.log(`  ${field}: ${Object.entries(summary[field]).map(([key, value]) => `${key} ${value}`).join(", ")}`);
}

if (values.check) {
  if (current !== text) {
    console.error(`${MIGRATION_PATH} is out of date. Run: node scripts/catalog/build-catalog.mjs`);
    process.exit(1);
  }
  console.log(`${MIGRATION_PATH} is up to date.`);
} else if (current === text) {
  console.log(`${MIGRATION_PATH} is already up to date.`);
} else {
  writeFileSync(target, text);
  console.log(`Wrote ${MIGRATION_PATH}.`);
}
