#!/usr/bin/env node
// Which exercises get FITX's AI demonstrations first, and what that costs (wave 2, brief 3.5). Repo data only: the
// cleaned catalogue (scripts/catalog), the AI Form Check rules, the staples, the programmes and the Home collection.
//
//   node scripts/media/demo-priority.mjs            prints the tiers, the set and the prices
//   node scripts/media/demo-priority.mjs --write    writes scripts/media/demos/priority.json (committed)
//   node scripts/media/demo-priority.mjs --check    exits 1 when priority.json is out of date
//   node scripts/media/demo-priority.mjs --limit=all  the same for every active exercise (printed, never written)
//
// Tiers: T1 the AI Form Check exercises (form-rules `libraryIds`), T2 the staples, T3 the programmes' preferred
// exercises, T4 the Home collection of a member with no equipment. The default set is T1 ∪ T2 ∪ T4 (T3 is reported;
// it sits inside T2). Inactive or merged ids, and ids with no reference photo, are dropped with the reason.
// Nothing is fetched and nothing is generated here.
import "../../tests/setup/hooks.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { captionsFor } from "./demos/captions.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../..");
export const PRIORITY_FILE = path.join(ROOT, "scripts/media/demos/priority.json");
/** Male and female, start and end. */
export const IMAGES_PER_EXERCISE = 4;
/** gemini-2.5-flash-image, per image (generate-images.mjs COST_PER_IMAGE_USD). */
export const COST_PER_IMAGE_USD = 0.039;
/** The byte target of one demonstration file (brief 3.5), for the size estimate. */
export const TARGET_BYTES = 40 * 1024;
/** Same-movement stand-ins: the demonstration is made from the stand-in's photos (brief 3.5). */
export const SAME_MOVEMENT_STAND_INS = ["cable_fly", "split_squat", "step_up", "calf_raise"];
/** These keep their labelled stand-in photos (a different variation of the movement), with no AI demonstration. */
export const KEEP_STAND_IN = ["band_row", "dumbbell_rdl"];
/** jumping_jack has no public-domain photo; its reference is FITX's accepted pair from the AI Form Check. */
export const FITX_REFERENCES = {
  jumping_jack: ["public/media/form-check/jumping-jack-closed.webp", "public/media/form-check/jumping-jack-open.webp"],
};

const src = (file) => pathToFileURL(path.join(ROOT, "src", file)).href;

/** Every input, read from the repo. */
export async function loadRepoData() {
  const { loadCatalog } = await import(pathToFileURL(path.join(ROOT, "scripts/catalog/catalog.mjs")).href);
  const { loadSources } = await import(pathToFileURL(path.join(ROOT, "scripts/catalog/source.mjs")).href);
  const { toCatalogExercise } = await import(src("lib/training/catalog.ts"));
  const { homeCollection } = await import(src("lib/training/home-collection.ts"));
  const { expandOwnedEquipment } = await import(src("lib/training/equipment.ts"));
  const { EQUIPMENT } = await import(src("lib/training/taxonomy.ts"));
  const { STAPLE_EXERCISES } = await import(src("lib/training/staples.ts"));
  const { PROGRAMMES } = await import(src("data/programmes/index.ts"));
  const { EXERCISE_RULES } = await import(src("lib/form-rules/catalog.ts"));
  const { demoScript } = await import(src("lib/home-workout/demo-script.ts"));
  const { guideSteps } = await import(src("lib/training/exercise-guide.ts"));
  const media = await import(src("lib/training/media.ts"));

  const rows = loadCatalog();
  const active = rows.filter((row) => row.is_active).map(toCatalogExercise);
  const instructions = new Map(loadSources().liveRows.map((row) => [row.id, row.instructions ?? []]));
  const homeKeys = EQUIPMENT.filter((item) => item.homeFriendly).map((item) => item.key);
  const programmeIds = [];
  for (const programme of PROGRAMMES) for (const day of programme.days) for (const slot of day.slots) programmeIds.push(...(slot.preferred ?? []));
  return {
    rows: rows.map((row) => ({ id: row.id, name: row.name, is_active: row.is_active, merged_into: row.merged_into ?? null, source_ref: row.source_ref ?? null })),
    active,
    instructions,
    formCheck: EXERCISE_RULES.map((rule) => ({ id: rule.id, name: rule.name, libraryIds: [...rule.libraryIds], script: demoScript(rule.id) })),
    staples: Object.values(STAPLE_EXERCISES).flat(),
    programmeIds,
    homeBodyweight: homeCollection(active, { owned: new Set() }).map((exercise) => exercise.id),
    homeAllOwned: homeCollection(active, { owned: expandOwnedEquipment(homeKeys) }).map((exercise) => exercise.id),
    homeKeys,
    guideSteps,
    standIns: media.PHOTO_STAND_INS,
    pinnedPhotoUrl: media.pinnedPhotoUrl,
    revision: media.FREE_EXERCISE_DB_REVISION,
  };
}

const unique = (ids) => [...new Set(ids)];
const round2 = (value) => Math.round(value * 100) / 100;

/** Images, the call cap (retries and the pilot included) and the price, for a number of exercises. */
export function priceFor(exercises) {
  const images = exercises * IMAGES_PER_EXERCISE;
  const calls = images ? Math.ceil(1.25 * images) + 20 : 0;
  return {
    exercises,
    images,
    calls,
    usdFirstTry: round2(images * COST_PER_IMAGE_USD),
    usdCap: round2(calls * COST_PER_IMAGE_USD),
    estimatedBytes: images * TARGET_BYTES,
  };
}

/** The reference photos an exercise's demonstration is made from, or why it has none. */
export function referenceFor(id, data) {
  const row = data.rows.find((item) => item.id === id);
  if (KEEP_STAND_IN.includes(id)) return { drop: "keeps its labelled stand-in photos (a different variation of the movement)" };
  if (FITX_REFERENCES[id]) return { kind: "fitx", files: FITX_REFERENCES[id] };
  if (row?.source_ref) return { kind: "free-exercise-db", ref: row.source_ref, files: [0, 1].map((n) => data.pinnedPhotoUrl(row.source_ref, n)) };
  if (SAME_MOVEMENT_STAND_INS.includes(id) && data.standIns[id]) {
    const ref = data.standIns[id].ref;
    return { kind: "free-exercise-db-stand-in", ref, files: [0, 1].map((n) => data.pinnedPhotoUrl(ref, n)), note: data.standIns[id].note };
  }
  return { drop: "no reference photo" };
}

/** Keeps active, unmerged ids with a reference; the rest are listed with the reason. */
function selectIds(ids, data, tiersOf) {
  const set = [];
  const dropped = [];
  for (const id of ids) {
    const row = data.rows.find((item) => item.id === id);
    if (!row) { dropped.push({ id, reason: "not in the catalogue" }); continue; }
    if (!row.is_active) { dropped.push({ id, reason: row.merged_into ? `merged into ${row.merged_into}` : "inactive" }); continue; }
    const reference = referenceFor(id, data);
    if (reference.drop) { dropped.push({ id, reason: reference.drop }); continue; }
    const exercise = data.active.find((item) => item.id === id);
    set.push({ id, name: exercise.name, tiers: tiersOf(id), reference, captions: captionsFor(id, data) });
  }
  return { set, dropped };
}

/** The priority file's content (deterministic: the same repo gives the same file). */
export function buildPriority(data, { limit = "priority" } = {}) {
  const t1 = unique(data.formCheck.flatMap((rule) => rule.libraryIds));
  const t2 = unique(data.staples);
  const t3 = unique(data.programmeIds);
  const t4 = unique(data.homeBodyweight);
  const tiers = { T1: t1, T2: t2, T3: t3, T4: t4 };
  const tiersOf = (id) => Object.entries(tiers).filter(([, ids]) => ids.includes(id)).map(([name]) => name);
  const wanted = limit === "all" ? data.active.map((exercise) => exercise.id) : unique([...t1, ...t2, ...t4]);
  const { set, dropped } = selectIds(wanted, data, tiersOf);
  const inSet = new Set(set.map((item) => item.id));
  const homeLeftOut = data.homeAllOwned.filter((id) => !inSet.has(id));
  const all = selectIds(data.active.map((exercise) => exercise.id), data, tiersOf);
  return {
    version: 1,
    note: "Generated by scripts/media/demo-priority.mjs from repo data. Counts and prices are exact for this catalogue; nothing here has been generated yet.",
    source: { catalogue: "scripts/catalog (cleaned, active rows)", freeExerciseDbRevision: data.revision },
    limit,
    tiers: {
      T1: { what: "AI Form Check exercises (form-rules libraryIds)", count: t1.length, ids: t1 },
      T2: { what: "Staples (STAPLE_EXERCISES)", count: t2.length, ids: t2 },
      T3: { what: "Programme lists (preferred ids)", count: t3.length, outsideT2: t3.filter((id) => !t2.includes(id)), ids: t3 },
      T4: { what: "Home collection, no equipment (homeCollection with nothing owned)", count: t4.length, ids: t4 },
    },
    union: { T1_T2_T4: unique([...t1, ...t2, ...t4]).length },
    home: {
      bodyweightOnly: t4.length,
      everyHomeItemOwned: data.homeAllOwned.length,
      homeEquipment: data.homeKeys,
      leftOutCount: homeLeftOut.length,
      leftOut: homeLeftOut,
    },
    counts: { selected: set.length, dropped: dropped.length, allActive: data.active.length, allWithReference: all.set.length },
    price: {
      perImageUsd: COST_PER_IMAGE_USD,
      imagesPerExercise: IMAGES_PER_EXERCISE,
      callCapRule: "ceil(1.25 x images) + 20",
      priority: priceFor(set.length),
      all: priceFor(all.set.length),
    },
    captions: {
      withBoth: set.filter((item) => item.captions[0] && item.captions[1]).length,
      needsWriting: set.filter((item) => !item.captions[0] || !item.captions[1]).map((item) => item.id),
    },
    dropped,
    set,
  };
}

function summary(priority) {
  const { tiers, home, counts, price, captions } = priority;
  return [
    `T1 ${tiers.T1.count}, T2 ${tiers.T2.count}, T3 ${tiers.T3.count} (${tiers.T3.outsideT2.length} outside T2), T4 ${tiers.T4.count}; T1 ∪ T2 ∪ T4 ${priority.union.T1_T2_T4}`,
    `Home collection: ${home.bodyweightOnly} with no equipment, ${home.everyHomeItemOwned} with every home item; ${home.leftOutCount} left out of the set`,
    `Selected ${counts.selected} (${counts.dropped} dropped); all active ${counts.allActive}, of which ${counts.allWithReference} have a reference`,
    `Priority: ${price.priority.images} images, cap ${price.priority.calls} calls, US$${price.priority.usdFirstTry.toFixed(2)} at first try, US$${price.priority.usdCap.toFixed(2)} capped, ~${(price.priority.estimatedBytes / 1048576).toFixed(1)} MB`,
    `All: ${price.all.images} images, cap ${price.all.calls} calls, US$${price.all.usdFirstTry.toFixed(2)} at first try, US$${price.all.usdCap.toFixed(2)} capped, ~${(price.all.estimatedBytes / 1048576).toFixed(1)} MB`,
    `Captions: ${captions.withBoth} with both, ${captions.needsWriting.length} need a FITX-written caption`,
  ].join("\n");
}

export const serialise = (priority) => `${JSON.stringify(priority, null, 1)}\n`;

async function main(argv) {
  const limit = argv.find((arg) => arg.startsWith("--limit="))?.slice(8) ?? "priority";
  if (limit !== "priority" && limit !== "all") throw new Error("--limit=priority or --limit=all");
  const priority = buildPriority(await loadRepoData(), { limit });
  console.log(summary(priority));
  if (argv.includes("--write")) {
    if (limit !== "priority") throw new Error("Only the priority set is written");
    writeFileSync(PRIORITY_FILE, serialise(priority));
    console.log(`Wrote ${path.relative(ROOT, PRIORITY_FILE)}`);
  }
  if (argv.includes("--check")) {
    const current = readFileSync(PRIORITY_FILE, "utf8");
    if (current !== serialise(priority)) { console.error("priority.json is out of date: run with --write"); process.exitCode = 1; }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main(process.argv.slice(2));
