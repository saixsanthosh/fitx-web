// The cleaned-up exercise catalogue: every live row (30 starter + 868 imported) with the Workouts v2
// columns derived by rules.mjs and corrected by curation.mjs. Pure apart from reading the migrations
// (and the optional upstream classification snapshot); importable from tests:
//   import { loadCatalog } from "../../scripts/catalog/catalog.mjs";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as curation from "./curation.mjs";
import {
  UPSTREAM_CATEGORY, ruleCategory, ruleDosage, ruleDuration, ruleEquipment, ruleMechanic, rulePrescription,
} from "./rules.mjs";
import { REPO_ROOT, loadSources, upstreamIdOf } from "./source.mjs";
import {
  EQUIPMENT_KEYS, EXERCISE_CATEGORIES, MECHANICS, MUSCLE_TO_GROUP, PRESCRIPTION_TYPES, locationsFor, muscleGroupFor,
  normalizeEquipment,
} from "./vocabulary.mjs";

export const CATALOG_VERSION = 1;
/** Upstream category/mechanic per Free Exercise DB id, written by `build-catalog.mjs --upstream`. */
export const UPSTREAM_SNAPSHOT = "scripts/catalog/upstream-classification.json";
const UNTIMED = new Set(["stretching", "cardio"]);

// ---------------------------------------------------------------- upstream classification (optional)

/**
 * Category and mechanic from an upstream Free Exercise DB checkout: a dist/exercises.json array, or the
 * exercises/ folder of one JSON file per exercise. Returns Map(upstream id -> { category, mechanic }).
 */
export function readUpstreamExercises(source) {
  const files = statSync(source).isDirectory()
    ? (existsSync(path.join(source, "dist", "exercises.json")) ? [path.join(source, "dist", "exercises.json")]
      : readdirSync(source).filter((name) => name.endsWith(".json")).map((name) => path.join(source, name)))
    : [source];
  const classes = new Map();
  for (const file of files) {
    for (const item of [JSON.parse(readFileSync(file, "utf8"))].flat()) {
      if (!item?.id) continue;
      const category = UPSTREAM_CATEGORY[String(item.category ?? "").toLowerCase()] ?? null;
      const mechanic = MECHANICS.includes(item.mechanic) ? item.mechanic : null;
      if (category || mechanic) classes.set(item.id, { category, mechanic });
    }
  }
  if (!classes.size) throw new Error(`No Free Exercise DB exercises with a category found in ${source}`);
  return classes;
}

export function readUpstreamSnapshot(root = REPO_ROOT, file = path.join(root, UPSTREAM_SNAPSHOT)) {
  if (!existsSync(file)) return null;
  const { exercises } = JSON.parse(readFileSync(file, "utf8"));
  return new Map(Object.entries(exercises).map(([id, [category, mechanic]]) => [id, { category, mechanic }]));
}

/** Keeps only the catalogue's ids and writes them, sorted, so builds stay reproducible without the checkout. */
export function writeUpstreamSnapshot(classes, { root = REPO_ROOT, file = path.join(root, UPSTREAM_SNAPSHOT) } = {}) {
  const wanted = new Set(loadSources(root).liveRows.map((row) => upstreamIdOf(row.id)).filter(Boolean));
  const exercises = Object.fromEntries([...classes].filter(([id]) => wanted.has(id)).sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([id, value]) => [id, [value.category, value.mechanic]]));
  const body = { source: "Free Exercise DB (Unlicense), category and mechanic per exercise id", exercises };
  writeFileSync(file, `${JSON.stringify(body, null, 1)}\n`);
  return Object.keys(exercises).length;
}

// ---------------------------------------------------------------- the catalogue

function curatedTable(table, label, byName) {
  const resolved = new Map();
  for (const [name, entry] of Object.entries(table)) {
    if (!byName.has(name)) throw new Error(`curation.${label}: no exercise named "${name}"`);
    const [value, reason] = entry;
    if (!reason) throw new Error(`curation.${label}["${name}"] needs a reason`);
    resolved.set(name, { value, why: `curated: ${reason}` });
  }
  return resolved;
}

/**
 * Every live catalogue row with the derived columns:
 *   id, name, origin, primary_muscle, secondary_muscles, difficulty, movement_pattern, equipment (legacy tags),
 *   muscle_group, category, mechanic, prescription_type, default_duration_seconds, recommended_sets, reps_min,
 *   reps_max, rest_seconds, required_equipment, locations, alternatives, source_ref, is_active, merged_into,
 *   catalog_version, and `derivation` (where each value came from).
 * `upstream`: a Map from readUpstreamExercises(), null to ignore the snapshot, or undefined to use the
 * committed snapshot when there is one.
 */
export function loadCatalog({ root = REPO_ROOT, upstream } = {}) {
  const sources = loadSources(root);
  const upstreamClasses = upstream === undefined ? readUpstreamSnapshot(root) : upstream;
  const live = sources.liveRows;
  const byName = new Map(live.map((row) => [row.name, row]));
  const byId = new Map(live.map((row) => [row.id, row]));
  const curated = {
    category: curatedTable(curation.CATEGORY, "CATEGORY", byName),
    mechanic: curatedTable(curation.MECHANIC, "MECHANIC", byName),
    prescription: curatedTable(curation.PRESCRIPTION, "PRESCRIPTION", byName),
    duration: curatedTable(curation.DURATION, "DURATION", byName),
    equipment: curatedTable(curation.EQUIPMENT, "EQUIPMENT", byName),
  };

  // Duplicates: the imported row is hidden and merged into the starter row.
  const mergedInto = new Map();
  const mergedFrom = new Map();
  for (const [duplicateName, survivorId, reason] of curation.DUPLICATES) {
    const duplicate = byName.get(duplicateName);
    const survivor = byId.get(survivorId);
    if (!duplicate || duplicate.origin !== "free_exercise_db") throw new Error(`DUPLICATES: "${duplicateName}" is not an imported row`);
    if (!survivor || survivor.origin !== "starter") throw new Error(`DUPLICATES: survivor "${survivorId}" is not a starter row`);
    if (!reason) throw new Error(`DUPLICATES: "${duplicateName}" needs a reason`);
    mergedInto.set(duplicate.id, { survivorId, reason });
    if (!mergedFrom.has(survivorId)) mergedFrom.set(survivorId, duplicate.id);
  }
  // Starter rows whose exact-name import never reached the database still get its photos.
  const skippedByName = new Map(sources.skippedImports.map((row) => [row.name, row]));

  const rows = live.map((row) => {
    const derivation = {};
    const pick = (field, curatedValue, upstreamValue, ruled) => {
      if (curatedValue) { derivation[field] = curatedValue.why; return curatedValue.value; }
      if (upstreamValue !== undefined && upstreamValue !== null) { derivation[field] = "upstream Free Exercise DB"; return upstreamValue; }
      derivation[field] = `rule: ${ruled.why}`;
      return ruled.value;
    };
    const upstreamId = upstreamIdOf(row.id);
    const upstreamClass = row.origin === "free_exercise_db" ? upstreamClasses?.get(upstreamId) : undefined;

    const equipmentRule = ruleEquipment(row);
    let required = normalizeEquipment(pick("required_equipment", curated.equipment.get(row.name), null,
      { value: equipmentRule.keys, why: equipmentRule.why.join("; ") }));
    const category = pick("category", curated.category.get(row.name), upstreamClass?.category, ruleCategory(row, required));
    if (category === "stretching" && required.length === 1 && required[0] === "specialty" && !curated.equipment.has(row.name)) {
      required = [];
      derivation.required_equipment += "; a stretch needs no special equipment (a belt, towel or partner at most)";
    }
    const mechanic = UNTIMED.has(category) ? null
      : pick("mechanic", curated.mechanic.get(row.name), upstreamClass?.mechanic, ruleMechanic(row, category));
    if (UNTIMED.has(category)) derivation.mechanic = `none for ${category}`;
    const prescriptionType = pick("prescription_type", curated.prescription.get(row.name), null, rulePrescription(row, category));
    const duration = prescriptionType === "time"
      ? pick("default_duration_seconds", curated.duration.get(row.name), null, { value: ruleDuration(row, category, prescriptionType), why: "default time" })
      : null;

    let dosage;
    if (row.origin === "starter") {
      dosage = { recommended_sets: row.recommended_sets, reps_min: row.reps_min, reps_max: row.reps_max, rest_seconds: row.rest_seconds };
      if (prescriptionType === "time") Object.assign(dosage, curation.STARTER_TIMED_REPS);
      derivation.dosage = prescriptionType === "time" ? "starter values; timed, so one effort per set" : "starter values kept";
    } else {
      dosage = ruleDosage(category, mechanic, prescriptionType, duration);
      derivation.dosage = `rule: ${prescriptionType === "time" ? "timed" : category} ${mechanic ?? ""}`.trim();
    }

    const merge = mergedInto.get(row.id);
    let sourceRef = upstreamId;
    if (row.origin === "starter") {
      const twin = skippedByName.get(row.name);
      sourceRef = twin ? upstreamIdOf(twin.id) : (mergedFrom.has(row.id) ? upstreamIdOf(mergedFrom.get(row.id)) : null);
      derivation.source_ref = twin ? "the exact-name Free Exercise DB row the import skipped" : sourceRef ? "the merged duplicate" : "no Free Exercise DB match";
    }
    if (merge) derivation.merged_into = `curated: ${merge.reason}`;
    const primaryOverride = curation.PRIMARY_MUSCLE[row.id];
    const primaryMuscle = primaryOverride ? primaryOverride[0] : row.primary_muscle;
    if (primaryOverride) derivation.primary_muscle = `curated: ${primaryOverride[1]}`;

    return {
      id: row.id,
      name: row.name,
      origin: row.origin,
      primary_muscle: primaryMuscle,
      secondary_muscles: row.secondary_muscles,
      difficulty: row.difficulty,
      movement_pattern: row.movement_pattern,
      equipment: row.equipment,
      muscle_group: muscleGroupFor(primaryMuscle),
      category,
      mechanic,
      prescription_type: prescriptionType,
      default_duration_seconds: duration,
      ...dosage,
      required_equipment: required,
      locations: locationsFor(required),
      alternatives: row.alternatives,
      source_ref: sourceRef,
      is_active: !merge,
      merged_into: merge ? merge.survivorId : null,
      catalog_version: CATALOG_VERSION,
      derivation,
    };
  });

  // Alternatives: keep real ids, replace the ones that never existed, follow merges, drop repeats and self.
  const rowById = new Map(rows.map((row) => [row.id, row]));
  for (const row of rows) {
    const resolved = [];
    for (const alternative of row.alternatives) {
      let target = alternative;
      if (!rowById.has(target)) {
        if (!(target in curation.ALTERNATIVES)) throw new Error(`${row.id}: alternative "${target}" does not exist and has no replacement in curation.ALTERNATIVES`);
        const [name] = curation.ALTERNATIVES[target];
        if (name === null) continue;
        if (!byName.has(name)) throw new Error(`ALTERNATIVES: no exercise named "${name}"`);
        target = byName.get(name).id;
      }
      target = rowById.get(target).merged_into ?? target;
      if (target !== row.id && !resolved.includes(target)) resolved.push(target);
    }
    row.alternatives = resolved;
  }
  return rows;
}

// ---------------------------------------------------------------- checks

/** Everything the migration and the app rely on; returns a list of problems (empty when valid). */
export function validateCatalog(rows) {
  const problems = [];
  const fail = (row, message) => problems.push(`${row.id}: ${message}`);
  const byId = new Map();
  for (const row of rows) {
    if (byId.has(row.id)) fail(row, "duplicate id");
    byId.set(row.id, row);
  }
  const int = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
  for (const row of rows) {
    if (!EXERCISE_CATEGORIES.includes(row.category)) fail(row, `category ${row.category}`);
    if (UNTIMED.has(row.category) ? row.mechanic !== null : !MECHANICS.includes(row.mechanic)) fail(row, `mechanic ${row.mechanic} for ${row.category}`);
    if (row.muscle_group !== MUSCLE_TO_GROUP[row.primary_muscle]) fail(row, `muscle_group ${row.muscle_group} for ${row.primary_muscle}`);
    if (!PRESCRIPTION_TYPES.includes(row.prescription_type)) fail(row, `prescription_type ${row.prescription_type}`);
    if (UNTIMED.has(row.category) && row.prescription_type !== "time") fail(row, `${row.category} must be timed`);
    if (row.prescription_type === "time" ? !int(row.default_duration_seconds, 5, 7200) : row.default_duration_seconds !== null) {
      fail(row, `default_duration_seconds ${row.default_duration_seconds} for ${row.prescription_type}`);
    }
    if (row.prescription_type === "time" && (row.reps_min !== 1 || row.reps_max !== 1)) fail(row, "timed rows log one effort per set (reps 1-1)");
    if (!int(row.recommended_sets, 1, 10)) fail(row, `recommended_sets ${row.recommended_sets}`);
    if (!int(row.reps_min, 1, 100) || !int(row.reps_max, row.reps_min, 100)) fail(row, `reps ${row.reps_min}-${row.reps_max}`);
    if (!int(row.rest_seconds, 15, 600)) fail(row, `rest_seconds ${row.rest_seconds}`);
    for (const key of row.required_equipment) if (!EQUIPMENT_KEYS.has(key)) fail(row, `unknown equipment key ${key}`);
    if (row.required_equipment.every((key) => EQUIPMENT_KEYS.has(key))
      && JSON.stringify(normalizeEquipment(row.required_equipment)) !== JSON.stringify(row.required_equipment)) {
      fail(row, "required_equipment not normalised (order, repeats or covered items)");
    }
    if (JSON.stringify(row.locations) !== JSON.stringify(locationsFor(row.required_equipment))) fail(row, `locations ${row.locations}`);
    for (const alternative of row.alternatives) {
      const target = byId.get(alternative);
      if (!target) fail(row, `alternative ${alternative} does not exist`);
      else if (!target.is_active) fail(row, `alternative ${alternative} is inactive`);
      if (alternative === row.id) fail(row, "lists itself as an alternative");
    }
    if (new Set(row.alternatives).size !== row.alternatives.length) fail(row, "repeated alternative");
    if (row.merged_into !== null) {
      const survivor = byId.get(row.merged_into);
      if (row.is_active) fail(row, "merged but still active");
      if (!survivor || !survivor.is_active || survivor.merged_into !== null) fail(row, `merged into ${row.merged_into}, which is not an active survivor`);
    } else if (!row.is_active) fail(row, "inactive without merged_into");
    if (row.origin === "free_exercise_db" && row.source_ref !== upstreamIdOf(row.id)) fail(row, `source_ref ${row.source_ref}`);
    if (row.source_ref !== null && !/^[A-Za-z0-9_'(),.-]+$/.test(row.source_ref)) fail(row, `source_ref ${row.source_ref} has unexpected characters`);
    if (row.catalog_version !== CATALOG_VERSION) fail(row, `catalog_version ${row.catalog_version}`);
  }
  return problems;
}

/** Counts for reports and the migration header. */
export function summarizeCatalog(rows) {
  const count = (values) => Object.fromEntries([...values.reduce((map, value) => map.set(value, (map.get(value) ?? 0) + 1), new Map())]
    .sort(([a], [b]) => String(a).localeCompare(String(b))));
  const active = rows.filter((row) => row.is_active);
  return {
    rows: rows.length,
    active: active.length,
    merged: rows.length - active.length,
    category: count(rows.map((row) => row.category)),
    mechanic: count(rows.map((row) => row.mechanic ?? "none")),
    prescription: count(rows.map((row) => row.prescription_type)),
    location: count(rows.map((row) => (row.locations.includes("home") ? "home and gym" : "gym only"))),
  };
}
