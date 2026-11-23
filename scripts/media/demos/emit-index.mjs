#!/usr/bin/env node
// Publishes the accepted demonstrations inside the site (wave 2, D6): copies each accepted frame to
// public/media/demos/<model>/<exercise_id>/<0|1>.webp and writes public/media/demos/index.json, which the app reads
// once per page (src/lib/training/use-demo-model.ts). No upload, no database rows, no secret key.
//
//   node scripts/media/demos/emit-index.mjs [--from=<encoded dir>]   copy the accepted files and write the index
//   node scripts/media/demos/emit-index.mjs --check                  exit 1 when the index or a file does not match
//
// scripts/media/demos/accepted.json is the gate: { version, items: [{ id, model, frame, sha256, bytes, caption }] }.
// Only frames listed there ship, and a model appears for an exercise only when both its frames are accepted (a loop
// never shows one frame of a person). Captions are edited in accepted.json and re-emitted; Admin edits only rows.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../../..");
export const ACCEPTED_FILE = path.join(ROOT, "scripts/media/demos/accepted.json");
export const PUBLIC_DIR = path.join(ROOT, "public/media/demos");
export const INDEX_FILE = path.join(PUBLIC_DIR, "index.json");
export const DEFAULT_FROM = path.join(process.env.FITX_DEMO_WORK || path.resolve(ROOT, "..", ".alteration/media/demos"), "encoded");
/** The same values as src/lib/training/media.ts (tests keep them equal). */
export const INDEX_VERSION = 1;
export const CREDIT = Object.freeze({ attribution: "FITX demonstration (AI image made with Google Gemini from a Free Exercise DB photo)", license: "FITX" });
export const MAX_BYTES = 40 * 1024;
export const CAPTION_MAX = 120;
const ID = /^[A-Za-z0-9_-]{1,200}$/;
const MODELS = ["male", "female"];

export const framePath = (model, id, frame) => `/media/demos/${model}/${id}/${frame}.webp`;
export const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** Throws on the first entry that is not a well-formed accepted frame. */
export function validateAccepted(accepted) {
  if (accepted?.version !== 1 || !Array.isArray(accepted.items)) throw new Error("accepted.json needs { version: 1, items: [] }");
  const seen = new Set();
  for (const item of accepted.items) {
    const where = `${item?.id}/${item?.model}/${item?.frame}`;
    if (!ID.test(item?.id ?? "")) throw new Error(`${where}: bad exercise id`);
    if (!MODELS.includes(item.model)) throw new Error(`${where}: model must be male or female`);
    if (item.frame !== 0 && item.frame !== 1) throw new Error(`${where}: frame must be 0 or 1`);
    if (!/^[0-9a-f]{64}$/.test(item.sha256 ?? "")) throw new Error(`${where}: sha256 missing`);
    if (!Number.isInteger(item.bytes) || item.bytes <= 0 || item.bytes > MAX_BYTES) throw new Error(`${where}: ${item.bytes} bytes (at most ${MAX_BYTES})`);
    if (typeof item.caption !== "string" || item.caption.length > CAPTION_MAX) throw new Error(`${where}: caption missing or over ${CAPTION_MAX} characters`);
    if (seen.has(where)) throw new Error(`${where}: listed twice`);
    seen.add(where);
  }
  return accepted;
}

/** The index the app reads, sorted so the same accepted list always gives the same file. */
export function buildIndex(accepted) {
  validateAccepted(accepted);
  const byKey = new Map(accepted.items.map((item) => [`${item.id}/${item.model}/${item.frame}`, item]));
  const ids = [...new Set(accepted.items.map((item) => item.id))].sort();
  const items = {};
  for (const id of ids) {
    const entry = {};
    for (const model of MODELS) {
      const start = byKey.get(`${id}/${model}/0`);
      const end = byKey.get(`${id}/${model}/1`);
      if (!start || !end) continue;
      entry[model] = { frames: [framePath(model, id, 0), framePath(model, id, 1)], captions: [start.caption, end.caption] };
    }
    if (Object.keys(entry).length) items[id] = entry;
  }
  return { version: INDEX_VERSION, items, credit: { ...CREDIT } };
}

export const serialiseIndex = (index) => `${JSON.stringify(index, null, 1)}\n`;

/** Every .webp under public/media/demos, as served paths. */
export function publishedFiles(dir = PUBLIC_DIR) {
  const found = [];
  const walk = (folder) => {
    if (!existsSync(folder)) return;
    for (const name of readdirSync(folder)) {
      const full = path.join(folder, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".webp")) found.push(`/media/demos/${path.relative(dir, full).split(path.sep).join("/")}`);
    }
  };
  walk(dir);
  return found.sort();
}

/** Problems between accepted.json, the published files and index.json (empty when all match). */
export function checkPublished({ accepted, dir = PUBLIC_DIR, indexText }) {
  const problems = [];
  const index = buildIndex(accepted);
  if (indexText !== serialiseIndex(index)) problems.push("index.json does not match accepted.json: run emit-index.mjs");
  const listed = new Set();
  for (const [id, entry] of Object.entries(index.items)) {
    for (const [model, value] of Object.entries(entry)) {
      value.frames.forEach((served, frame) => {
        listed.add(served);
        const file = path.join(dir, model, id, `${frame}.webp`);
        const want = accepted.items.find((item) => item.id === id && item.model === model && item.frame === frame);
        if (!existsSync(file)) { problems.push(`${served} is missing`); return; }
        const data = readFileSync(file);
        if (data.length !== want.bytes || sha256(data) !== want.sha256) problems.push(`${served} differs from accepted.json`);
      });
    }
  }
  for (const served of publishedFiles(dir)) if (!listed.has(served)) problems.push(`${served} is not in the index (not accepted, or its other frame is missing)`);
  return problems;
}

function main(argv) {
  const accepted = JSON.parse(readFileSync(ACCEPTED_FILE, "utf8"));
  if (argv.includes("--check")) {
    const problems = checkPublished({ accepted, indexText: existsSync(INDEX_FILE) ? readFileSync(INDEX_FILE, "utf8") : "" });
    for (const problem of problems) console.error(problem);
    if (problems.length) process.exitCode = 1;
    else console.log("index.json and the published files match accepted.json");
    return;
  }
  const from = argv.find((arg) => arg.startsWith("--from="))?.slice(7) ?? DEFAULT_FROM;
  const index = buildIndex(accepted);
  for (const [id, entry] of Object.entries(index.items)) {
    for (const model of Object.keys(entry)) {
      for (const frame of [0, 1]) {
        const want = accepted.items.find((item) => item.id === id && item.model === model && item.frame === frame);
        const target = path.join(PUBLIC_DIR, model, id, `${frame}.webp`);
        if (existsSync(target) && sha256(readFileSync(target)) === want.sha256) continue;
        const source = path.join(from, model, id, `${frame}.webp`);
        if (!existsSync(source)) throw new Error(`${source} is missing`);
        const data = readFileSync(source);
        if (sha256(data) !== want.sha256 || data.length !== want.bytes) throw new Error(`${source} differs from accepted.json (sha256 or size)`);
        mkdirSync(path.dirname(target), { recursive: true });
        copyFileSync(source, target);
      }
    }
  }
  mkdirSync(PUBLIC_DIR, { recursive: true });
  writeFileSync(INDEX_FILE, serialiseIndex(index));
  const problems = checkPublished({ accepted, indexText: readFileSync(INDEX_FILE, "utf8") });
  for (const problem of problems) console.error(problem);
  if (problems.length) process.exitCode = 1;
  console.log(`index.json: ${Object.keys(index.items).length} exercises`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main(process.argv.slice(2));
