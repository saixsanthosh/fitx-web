#!/usr/bin/env node
// FITX's AI demonstrations (wave 2, brief 3.5 and D6): for each exercise, a male and a female model in the exact
// start and end positions of the Free Exercise DB photos, made with Gemini image models ("Nano Banana").
//
//   node scripts/media/generate-demos.mjs --dry-run [--set=priority|all|ids:<a,b>] [--model=male|female|both] [--limit=N]
//   node scripts/media/generate-demos.mjs --personas --max-calls=6 --budget-usd=0.25
//   node scripts/media/generate-demos.mjs --set=ids:push_up,plank --model=both --max-calls=30 --budget-usd=1.20 [--resume]
//   node scripts/media/generate-demos.mjs --download-refs --set=priority     (only after the owner's download OK)
//
// Rules (never relaxed by a flag):
//  - Every real run needs explicit --max-calls and --budget-usd and stops hard before a call would pass either.
//  - A pose is never moved: the start frame reproduces the reference's start photo exactly (pose, grip, equipment,
//    camera) and changes only the person and the studio; the end frame reproduces the end photo, with the start
//    frame as the person reference. (The form-check lesson: asking a model to move a pose gave wrong technique.)
//  - The persona sheets are made first and need the owner's approval (personas/approved.json) before any exercise.
//  - The key is read from worktrees/.keys/gemini.env (or FITX_GEMINI_ENV) by this script alone and is sent only in
//    the x-goog-api-key header. It is never printed, logged, written or put in a request body.
//  - Everything this writes stays outside the repo, in .alteration/media/demos/ (or FITX_DEMO_WORK): raw images,
//    encoded files, references and the ledger. Accepted files reach the site only through demos/emit-index.mjs,
//    after the pose check and the eye check (nothing `pending` ships).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { COST_PER_IMAGE_USD, DEFAULT_KEY_FILE, pickImage, readKey, safeError } from "./generate-images.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../..");
/** Outside the repo: worktrees/.alteration/media/demos (brief 2, demo-media). */
export const DEFAULT_WORK_DIR = process.env.FITX_DEMO_WORK || path.resolve(ROOT, "..", ".alteration/media/demos");
export const PRIORITY_FILE = path.join(ROOT, "scripts/media/demos/priority.json");

export const DEFAULT_IMAGE_MODEL = "gemini-2.5-flash-image";
/** Known prices per image; another model needs the owner's OK and its price recorded here first. */
export const IMAGE_PRICES_USD = Object.freeze({ [DEFAULT_IMAGE_MODEL]: COST_PER_IMAGE_USD });
/**
 * The owner's spend limit is a hard total (D9), so each call is charged from its own usage counts (input tokens, and every
 * output token priced as image output), never less than the image price when an image came back. The reserve, the most
 * one call can cost, is held back before the call: a run stops while the budget still covers the dearest call.
 */
export const IMAGE_TOKEN_PRICES_USD = Object.freeze({ [DEFAULT_IMAGE_MODEL]: Object.freeze({ inputPerMillion: 0.3, outputPerMillion: 30 }) });
export const CALL_RESERVE_USD = Object.freeze({ [DEFAULT_IMAGE_MODEL]: 0.045 });
/** A refused request (an HTTP error: nothing was made) is still charged this much, to stay on the safe side. */
export const ERROR_CHARGE_USD = 0.002;
/** A request that has not answered by then is abandoned (and charged the reserve, as it may still be billed). */
export const CALL_TIMEOUT_MS = 180_000;
/** Google's temporary refusals ("high demand", rate limits): the same image is asked for again after these waits. */
export const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);
export const TRANSIENT_WAITS_MS = Object.freeze([20_000, 60_000, 120_000]);
export const endpointFor = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

/** The byte target of one demonstration file (brief 3.5). The coordinator may raise it to a measured value <= 60 KB. */
export const DEMO_MAX_BYTES = 40 * 1024;
export const DEMO_ASPECT = "4:3";
/** Long edges tried, largest first, and qualities, highest first. */
export const DEMO_EDGES = [1200, 1100, 1000];
export const DEMO_QUALITIES = [80, 75, 70, 65, 60, 55, 50, 45, 40, 35, 30];
export const MODELS = ["male", "female"];
export const FRAMES = [0, 1];
/** The pinned Free Exercise DB photos (the only URLs a reference download may fetch). */
export const PINNED_PREFIX = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/";
/** Statuses a ledger entry moves through; only `accepted` may ship. */
export const STATUSES = ["generated", "failed", "encode-over-target", "pose-pass", "pose-fail", "needs-eye", "accepted", "rejected"];
/** An end frame is made only from a start frame in one of these states. */
const START_USABLE = new Set(["generated", "pose-pass", "needs-eye", "accepted"]);

// ---------------------------------------------------------------- arguments

export function parseArgs(argv) {
  const args = { set: "priority", model: "both", limit: null, maxCalls: null, budgetUsd: null, imageModel: DEFAULT_IMAGE_MODEL, dryRun: false, resume: false, personas: false, downloadRefs: false, work: DEFAULT_WORK_DIR };
  for (const arg of argv) {
    const [flag, value = ""] = arg.split(/=(.*)/s);
    if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "--resume") args.resume = true;
    else if (flag === "--personas") args.personas = true;
    else if (flag === "--download-refs") args.downloadRefs = true;
    else if (flag === "--set") args.set = value;
    else if (flag === "--model") args.model = value;
    else if (flag === "--limit") args.limit = Number(value);
    else if (flag === "--max-calls") args.maxCalls = Number(value);
    else if (flag === "--budget-usd") args.budgetUsd = Number(value);
    else if (flag === "--image-model") args.imageModel = value;
    else if (flag === "--work") args.work = path.resolve(value);
    else throw new Error(`Unknown argument ${arg}`);
  }
  if (!/^(priority|all|ids:[A-Za-z0-9_,-]+)$/.test(args.set)) throw new Error("--set=priority, --set=all or --set=ids:<id,id>");
  if (!["male", "female", "both"].includes(args.model)) throw new Error("--model=male, female or both");
  if (args.limit !== null && !(Number.isInteger(args.limit) && args.limit > 0)) throw new Error("--limit needs a positive whole number");
  if (args.maxCalls !== null && !(Number.isInteger(args.maxCalls) && args.maxCalls >= 0)) throw new Error("--max-calls needs a whole number");
  if (args.budgetUsd !== null && !(Number.isFinite(args.budgetUsd) && args.budgetUsd >= 0)) throw new Error("--budget-usd needs a number");
  if (!IMAGE_PRICES_USD[args.imageModel]) throw new Error(`No recorded price for ${args.imageModel}: another model needs the owner's OK and its price in IMAGE_PRICES_USD`);
  return args;
}

/** A real run (anything that may call the model) must name both caps. */
export function requireCaps(args) {
  if (args.dryRun || args.downloadRefs) return;
  if (args.maxCalls === null || args.budgetUsd === null) throw new Error("A run that calls the model needs --max-calls and --budget-usd");
}

// ---------------------------------------------------------------- prompts and the request

/**
 * Plain, unbranded, not a real person. These describe the two sheets the owner approved (D9: Man 1 and Woman 2, saved as
 * personas/male.png and personas/female.png), so the words never contradict image 1 of a request.
 */
export const PERSONAS = Object.freeze({
  male: "An athletic man in his late twenties of Indian appearance, short dark hair and a neatly trimmed beard, an athletic but realistic build (not a bodybuilder). A plain charcoal crew-neck T-shirt with short sleeves (never a tank top or a sleeveless top), plain black training shorts above the knee, plain dark grey trainers with white soles and no brand mark. The T-shirt stays down over the waist in every position. No logos, no text, no jewellery.",
  female: "An athletic woman in her late twenties of Indian appearance, dark hair tied back in a low bun, a fit and realistic build. A plain terracotta short-sleeved fitted sports top that covers the midriff (never a crop top or a sports bra), plain black full-length leggings (never shorts), plain dark grey trainers with white soles and no brand mark. The top stays down over the waistband in every position, so no skin shows at the waist. No logos, no text, no jewellery.",
});
/** The approved sheets' own studio, so every frame looks like the same shoot. */
const STUDIO = "a seamless warm light-grey studio backdrop that curves into the floor, with soft even light from the front and a soft contact shadow under the body";
const RULES = "Photorealistic photograph, natural skin and fabric, correct anatomy and hands, the whole body and all equipment in frame. No text, letters, numbers, logos, watermarks or overlays.";

export function personaPrompt(model) {
  return `A full-body reference photograph of one person for a fitness app's exercise demonstrations: ${PERSONAS[model]} Standing relaxed, facing the camera, arms by the sides, in ${STUDIO}. ${RULES} This person is fictional and is not any real or famous person.`;
}

/** Bumped whenever the prompt or the order of the images changes; recorded on every ledger entry. */
export const PROMPT_VERSION = 6;

/**
 * Each frame is an edit of its own reference photo (image 1), with the approved persona as image 2, so the pose, camera
 * angle and framing carry over. What the pilot showed (D9):
 *  - prompt 1 (persona first) turned side-on push-ups into front views;
 *  - prompts 1 and 2 gave the end frame the start frame as a look reference, and the model copied its pose (no movement);
 *  - naming the exercise pulled poses towards the model's idea of it (a bridge's raised start came back flat).
 *  - prompt 3 kept the poses but made push-ups shallower than the photo and left a dark gym floor once.
 *  - prompt 4 fixed the depth, but in about a third of the frames the photo's own person showed through (their face, a
 *    tank top, a crop top, printed shorts, a logo on a mat), and once a plate stayed on the floor.
 *  - prompt 5's strict two-reviewer check still found numbers on dumbbells and plates, brand marks on shoes and tops
 *    riding up in lying poses: prompt 6 asks for plain unmarked weights, unbranded trainers and tops that stay down.
 * So the prompt names no exercise and no position, the end frame gets no image 3, and the words pin how bent each joint is,
 * how far the body is from the floor, the camera distance and a light floor. It never asks to move a pose.
 */
export function demoPrompt(item, model, frame) {
  void item;
  void frame;
  return `Edit image 1. Reproduce exactly the pose in image 1: keep the body position, how much each elbow, knee and hip is bent, how far the chest, hips and knees are from the floor, where the hands and feet are, the grip, the stance, the equipment and where it is, and the camera angle, camera height and framing exactly as they are in image 1, with the camera at the same distance so the person fills the same part of the frame. Change only the person and the background. Replace the person completely with the person in image 2: their face, hair, skin tone and build, dressed exactly like this: ${PERSONAS[model]} Nothing of the person in image 1 may remain: not their face, hair, skin tone, clothes, shoes or any print on them. Every piece of equipment stays in the same hands, under the same feet or under the same body as in image 1. Replace the whole background and the floor with ${STUDIO}; the floor is the same warm light grey as the backdrop, never a dark gym floor; remove the gym, racks, loose plates, walls, signs and other people, and keep only equipment the person is holding, touching, sitting or lying on, with every logo, letter and print removed from it: dumbbells, kettlebells and weight plates are plain matte black with no numbers, letters or markings, and bars, benches, mats, balls and machines carry no logo or print. Do not change, correct, exaggerate or move the pose in any way. ${RULES} Landscape 4:3.`;
}

/** The generateContent body: the prompt, then each reference image in order. The key is never part of it. */
export function demoRequestBody(prompt, parts) {
  const content = [{ text: prompt }];
  for (const part of parts) content.push({ inline_data: { mime_type: part.mimeType, data: part.data } });
  return { contents: [{ role: "user", parts: content }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: DEMO_ASPECT } } };
}

// ---------------------------------------------------------------- the ledger

export const ledgerFile = (work) => path.join(work, "ledger.json");
export const emptyLedger = (imageModel = DEFAULT_IMAGE_MODEL) => ({ version: 1, imageModel, calls: 0, spentUsd: 0, images: {}, refs: {}, personas: {} });

export function readLedger(work, io = defaultIo) {
  const file = ledgerFile(work);
  return io.exists(file) ? JSON.parse(io.read(file, "utf8")) : emptyLedger();
}

export function writeLedger(work, ledger, io = defaultIo) {
  io.mkdir(work);
  io.write(ledgerFile(work), `${JSON.stringify(ledger, null, 1)}\n`);
}

export const jobKey = (id, model, frame) => `${id}/${model}/${frame}`;
const round4 = (value) => Math.round(value * 10000) / 10000;
/** Up to the next 1/10,000 of a dollar, so a charge is never rounded down. */
const ceil4 = (value) => Math.ceil(Math.round(value * 1e8) / 1e4) / 10000;

/**
 * What one answered call cost (D9): its own token counts, every output token at the image-output price, and never less
 * than the image price when an image came back. With no usage counts it is charged the reserve.
 */
export function callCostUsd(imageModel, usage, { imageReturned }) {
  const reserve = CALL_RESERVE_USD[imageModel] ?? IMAGE_PRICES_USD[imageModel];
  const tokens = IMAGE_TOKEN_PRICES_USD[imageModel];
  if (!usage || typeof usage !== "object" || !tokens) return reserve;
  const input = Number(usage.promptTokenCount) || 0;
  const output = (Number(usage.candidatesTokenCount) || 0) + (Number(usage.thoughtsTokenCount) || 0);
  const cost = ceil4((input * tokens.inputPerMillion + output * tokens.outputPerMillion) / 1e6);
  return imageReturned ? Math.max(cost, IMAGE_PRICES_USD[imageModel]) : cost;
}

/** The usage counts kept in the ledger (numbers only). */
export function usageSummary(usage) {
  if (!usage || typeof usage !== "object") return null;
  return { input: Number(usage.promptTokenCount) || 0, output: Number(usage.candidatesTokenCount) || 0, thoughts: Number(usage.thoughtsTokenCount) || 0 };
}
export const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

// ---------------------------------------------------------------- the plan

/** The exercises of a set, from priority.json (priority), every active id with a reference (all), or listed ids. */
export function setItems(args, priority) {
  let items;
  if (args.set === "priority") items = priority.set;
  else if (args.set === "all") items = priority.all ?? null;
  else {
    const ids = args.set.slice(4).split(",").filter(Boolean);
    items = ids.map((id) => priority.set.find((item) => item.id === id) ?? (priority.all ?? []).find((item) => item.id === id) ?? null);
    const missing = ids.filter((id, index) => !items[index]);
    if (missing.length) throw new Error(`Not in the demonstration set: ${missing.join(", ")}`);
  }
  if (!items) throw new Error("--set=all needs the full list: build it with demo-priority.mjs --limit=all");
  return args.limit ? items.slice(0, args.limit) : items;
}

/** Every image a run would make, start before end, skipping what the ledger already has (with --resume). */
export function planJobs(items, args, ledger) {
  const models = args.model === "both" ? MODELS : [args.model];
  const jobs = [];
  for (const item of items) {
    for (const model of models) {
      for (const frame of FRAMES) {
        const key = jobKey(item.id, model, frame);
        const done = ledger.images[key];
        if (done && done.status !== "failed") continue;
        jobs.push({ key, item, model, frame });
      }
    }
  }
  return jobs;
}

/** Images planned, the call cap and the price, as the brief computes them. */
export function capsFor(images, price = COST_PER_IMAGE_USD) {
  const calls = images ? Math.ceil(1.25 * images) + 20 : 0;
  return { images, calls, usdFirstTry: Math.round(images * price * 100) / 100, usdCap: Math.round(calls * price * 100) / 100 };
}

/** Why the next call must not be made, or null. */
export function stopReason(ledger, { maxCalls, budgetUsd, price }) {
  if (ledger.calls + 1 > maxCalls) return `call cap reached (${ledger.calls} of ${maxCalls})`;
  if (round4(ledger.spentUsd + price) > budgetUsd) return `budget reached (US$${ledger.spentUsd.toFixed(3)} spent of US$${budgetUsd.toFixed(2)})`;
  return null;
}

// ---------------------------------------------------------------- the encoder

/**
 * The demonstration WebP: 4:3, long edge 1200 px, quality stepped down from 80 to 30, then the long edge down to
 * 1000 px, until it fits `maxBytes`. `ok: false` (with the smallest attempt) when nothing fits.
 */
export async function encodeDemo(sharp, input, { maxBytes = DEMO_MAX_BYTES } = {}) {
  let smallest = null;
  for (const edge of DEMO_EDGES) {
    const width = edge;
    const height = Math.round((edge * 3) / 4);
    for (const quality of DEMO_QUALITIES) {
      const data = await sharp(input).rotate().resize(width, height, { fit: "cover", position: "attention" }).webp({ quality, effort: 5, smartSubsample: true }).toBuffer();
      const attempt = { data, bytes: data.length, quality, width, height };
      if (!smallest || attempt.bytes < smallest.bytes) smallest = attempt;
      if (data.length <= maxBytes) return { ok: true, ...attempt };
    }
  }
  return { ok: false, ...smallest };
}

// ---------------------------------------------------------------- files

const defaultIo = {
  exists: existsSync,
  read: readFileSync,
  write: writeFileSync,
  mkdir: (dir) => mkdirSync(dir, { recursive: true }),
};

export const rawFile = (work, id, model, frame) => path.join(work, "raw", model, id, `${frame}.png`);
export const encodedFile = (work, id, model, frame) => path.join(work, "encoded", model, id, `${frame}.webp`);
export const personaFile = (work, model) => path.join(work, "personas", `${model}.png`);
export const approvedPersonasFile = (work) => path.join(work, "personas", "approved.json");

/** Where an exercise's reference photo lives once downloaded (or the repo file for FITX's own pair). */
export function referenceFile(work, item, frame) {
  if (item.reference.kind === "fitx") return path.join(ROOT, item.reference.files[frame]);
  return path.join(work, "refs", item.reference.ref, `${frame}.jpg`);
}

/** The approved persona images, or a reason the run must not start. */
export function approvedPersonas(work, models, io = defaultIo) {
  const file = approvedPersonasFile(work);
  if (!io.exists(file)) return { error: "The persona sheets are not approved yet: run --personas, show them to the owner, then record approved.json" };
  const approved = JSON.parse(io.read(file, "utf8"));
  const parts = {};
  for (const model of models) {
    const image = personaFile(work, model);
    if (!io.exists(image)) return { error: `No persona sheet for ${model}` };
    const data = io.read(image);
    if (approved[model] !== sha256(data)) return { error: `The ${model} persona sheet changed after approval` };
    parts[model] = { mimeType: "image/png", data: Buffer.from(data).toString("base64") };
  }
  return { parts };
}

// ---------------------------------------------------------------- the model call

/**
 * One generateContent call: `{ image, usage }`. Throws with a safe message; an HTTP error carries `httpStatus`, and an
 * answer without an image carries `answered` and its `usage`. The key goes only in the header.
 */
export async function requestImage({ fetchImpl, key, imageModel, prompt, parts }) {
  const response = await fetchImpl(endpointFor(imageModel), {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(demoRequestBody(prompt, parts)),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status} ${safeError(text, key)}`), { httpStatus: response.status });
  const answer = JSON.parse(text);
  const usage = answer?.usageMetadata ?? null;
  const picked = pickImage(answer);
  if (picked.error) throw Object.assign(new Error(safeError(picked.error, key)), { answered: true, usage });
  return { image: Buffer.from(picked.data, "base64"), usage };
}

/** One generateContent call, the image only. */
export async function callModel(options) {
  return (await requestImage(options)).image;
}

/**
 * Makes the planned images in order, writing the ledger after every call so a stopped run resumes where it ended.
 * Stops (and says why) before a call would pass --max-calls or --budget-usd.
 */
export async function runJobs({ jobs, args, ledger, key, fetchImpl, sharp, personas, io = defaultIo, now = () => new Date(), log = console.log, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), waits = TRANSIENT_WAITS_MS }) {
  const reserve = CALL_RESERVE_USD[args.imageModel] ?? IMAGE_PRICES_USD[args.imageModel];
  const work = args.work;
  let stopped = null;
  for (const job of jobs) {
    const { item, model, frame, key: id } = job;
    stopped = stopReason(ledger, { maxCalls: args.maxCalls, budgetUsd: args.budgetUsd, price: reserve });
    if (stopped) break;
    const refPath = referenceFile(work, item, frame);
    if (!io.exists(refPath)) { log(`skipped ${id}: no reference photo on disk (${path.basename(refPath)})`); continue; }
    // Image 1 is the photo being edited (its pose and camera carry over), image 2 the persona.
    const parts = [{ mimeType: refPath.endsWith(".webp") ? "image/webp" : "image/jpeg", data: Buffer.from(io.read(refPath)).toString("base64") }, personas[model]];
    if (frame === 1) {
      // The end frame is made only after a usable start frame (no money on half a pair), but it is not sent: the
      // model copied its pose (D9).
      const start = ledger.images[jobKey(item.id, model, 0)];
      if (!start || !START_USABLE.has(start.status) || !io.exists(rawFile(work, item.id, model, 0))) { log(`skipped ${id}: its start frame is not usable`); continue; }
    }
    ledger.calls += 1;
    const before = ledger.spentUsd;
    const earlierCost = ledger.images[id]?.costUsd ?? 0;
    // The reserve is held back while the call is out, so a run killed mid-call never under-counts.
    ledger.spentUsd = round4(before + reserve);
    const entry = { id: item.id, model, frame, imageModel: args.imageModel, prompt: PROMPT_VERSION, calls: (ledger.images[id]?.calls ?? 0) + 1, at: now().toISOString() };
    ledger.images[id] = { ...entry, costUsd: round4(earlierCost + reserve), status: "failed", reason: "in progress" };
    writeLedger(work, ledger, io);
    let answer = null;
    let charge = reserve;
    let refused = 0;
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          answer = await requestImage({ fetchImpl, key, imageModel: args.imageModel, prompt: demoPrompt(item, model, frame), parts });
          break;
        } catch (error) {
          // A temporary refusal is asked again after a wait, while the budget still covers the refusals and the reserve.
          const again = TRANSIENT_STATUSES.has(error?.httpStatus) && attempt < waits.length && round4(before + (refused + 1) * ERROR_CHARGE_USD + reserve) <= args.budgetUsd;
          if (!again) throw error;
          refused += 1;
          ledger.spentUsd = round4(before + refused * ERROR_CHARGE_USD + reserve);
          writeLedger(work, ledger, io);
          log(`busy ${id}: HTTP ${error.httpStatus}, asking again in ${Math.round(waits[attempt] / 1000)} s`);
          await sleep(waits[attempt]);
        }
      }
      charge = round4(callCostUsd(args.imageModel, answer.usage, { imageReturned: true }) + refused * ERROR_CHARGE_USD);
      const png = await sharp(answer.image).png().toBuffer();
      io.mkdir(path.dirname(rawFile(work, item.id, model, frame)));
      io.write(rawFile(work, item.id, model, frame), png);
      const encoded = await encodeDemo(sharp, png);
      io.mkdir(path.dirname(encodedFile(work, item.id, model, frame)));
      io.write(encodedFile(work, item.id, model, frame), encoded.data);
      ledger.spentUsd = round4(before + charge);
      ledger.images[id] = { ...entry, costUsd: round4(earlierCost + charge), usage: usageSummary(answer.usage), refused, status: encoded.ok ? "generated" : "encode-over-target", reason: encoded.ok ? null : `smallest ${encoded.bytes} bytes`, sha256: sha256(encoded.data), bytes: encoded.bytes, quality: encoded.quality, width: encoded.width, height: encoded.height };
      log(`made ${id} (${encoded.bytes} bytes, q${encoded.quality}; calls ${ledger.calls}, US$${ledger.spentUsd.toFixed(4)})`);
    } catch (error) {
      // An image that came back was billed in full; an answer without one, by its own counts; a refused request barely;
      // anything else (a timeout or a lost connection) may still be billed, so it keeps the reserve.
      if (!answer) charge = round4((error?.httpStatus ? ERROR_CHARGE_USD : error?.answered ? callCostUsd(args.imageModel, error.usage, { imageReturned: false }) : reserve) + refused * ERROR_CHARGE_USD);
      ledger.spentUsd = round4(before + charge);
      ledger.images[id] = { ...entry, costUsd: round4(earlierCost + charge), usage: usageSummary(answer?.usage ?? error?.usage), status: "failed", reason: safeError(error?.message ?? error, key) };
      log(`failed ${id}: ${ledger.images[id].reason}`);
    }
    writeLedger(work, ledger, io);
  }
  if (stopped) log(`stopped: ${stopped}`);
  return { ledger, stopped };
}

// ---------------------------------------------------------------- reference photos (only after the owner's download OK)

/** Downloads each item's two pinned Free Exercise DB photos into refs/, recording size and SHA-256. */
export async function downloadReferences({ items, work, ledger, fetchImpl, io = defaultIo, log = console.log }) {
  for (const item of items) {
    if (item.reference.kind === "fitx") continue;
    for (const frame of FRAMES) {
      const url = item.reference.files[frame];
      if (typeof url !== "string" || !url.startsWith(PINNED_PREFIX) || url.slice(PINNED_PREFIX.length).includes("..")) throw new Error(`Refusing to fetch ${url}`);
      const file = referenceFile(work, item, frame);
      if (io.exists(file)) continue;
      const response = await fetchImpl(url, { redirect: "error" });
      if (!response.ok) { log(`reference ${item.reference.ref}/${frame}: HTTP ${response.status}`); continue; }
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length > 2 * 1024 * 1024) throw new Error(`${url} is larger than 2 MB`);
      io.mkdir(path.dirname(file));
      io.write(file, data);
      ledger.refs[`${item.reference.ref}/${frame}`] = { url, bytes: data.length, sha256: sha256(data) };
      writeLedger(work, ledger, io);
    }
  }
  return ledger;
}

// ---------------------------------------------------------------- main

async function main(argv) {
  const args = parseArgs(argv);
  requireCaps(args);
  let priority = JSON.parse(readFileSync(PRIORITY_FILE, "utf8"));
  if (args.set !== "priority") {
    // Every active exercise with a reference, from the same repo data (demo-priority.mjs --limit=all).
    const builder = await import("./demo-priority.mjs");
    priority = { ...priority, all: builder.buildPriority(await builder.loadRepoData(), { limit: "all" }).set };
  }
  const items = setItems(args, priority);
  const ledger = readLedger(args.work);
  const models = args.model === "both" ? MODELS : [args.model];

  if (args.downloadRefs) {
    await downloadReferences({ items, work: args.work, ledger, fetchImpl: fetch });
    console.log(`references recorded: ${Object.keys(ledger.refs).length}`);
    return;
  }
  if (Object.keys(ledger.images).length && !args.resume && !args.dryRun && !args.personas) throw new Error("The ledger already has images: pass --resume to carry on from it");

  if (args.personas) {
    const caps = { maxCalls: args.maxCalls ?? 0, budgetUsd: args.budgetUsd ?? 0, price: IMAGE_PRICES_USD[args.imageModel] };
    if (args.dryRun) { console.log(`would make ${models.length} persona sheets (${models.length} calls, US$${(models.length * caps.price).toFixed(2)})`); return; }
    const key = readKey(readFileSync(process.env.FITX_GEMINI_ENV || DEFAULT_KEY_FILE, "utf8"));
    if (!key) throw new Error("No GEMINI_API_KEY in the key file");
    const sharp = (await import("sharp")).default;
    for (const model of models) {
      const stop = stopReason(ledger, caps);
      if (stop) { console.log(`stopped: ${stop}`); break; }
      ledger.calls += 1;
      ledger.spentUsd = round4(ledger.spentUsd + caps.price);
      writeLedger(args.work, ledger);
      try {
        const raw = await callModel({ fetchImpl: fetch, key, imageModel: args.imageModel, prompt: personaPrompt(model), parts: [] });
        mkdirSync(path.dirname(personaFile(args.work, model)), { recursive: true });
        const png = await sharp(raw).png().toBuffer();
        writeFileSync(personaFile(args.work, model), png);
        ledger.personas[model] = { sha256: sha256(png), status: "pending owner approval", at: new Date().toISOString() };
        console.log(`made the ${model} persona sheet`);
      } catch (error) {
        console.error(`failed ${model} persona: ${safeError(error?.message ?? error, key)}`);
      }
      writeLedger(args.work, ledger);
    }
    return;
  }

  const jobs = planJobs(items, args, ledger);
  const caps = capsFor(jobs.length, IMAGE_PRICES_USD[args.imageModel]);
  console.log(`${items.length} exercises, ${jobs.length} images to make (${models.join(" and ")}); brief cap ${caps.calls} calls, US$${caps.usdFirstTry.toFixed(2)} at first try, US$${caps.usdCap.toFixed(2)} capped`);
  console.log(`ledger so far: ${ledger.calls} calls, US$${ledger.spentUsd.toFixed(3)}`);
  if (args.dryRun) return;
  const personas = approvedPersonas(args.work, models);
  if (personas.error) throw new Error(personas.error);
  const key = readKey(readFileSync(process.env.FITX_GEMINI_ENV || DEFAULT_KEY_FILE, "utf8"));
  if (!key) throw new Error("No GEMINI_API_KEY in the key file");
  const sharp = (await import("sharp")).default;
  await runJobs({ jobs, args, ledger, key, fetchImpl: fetch, sharp, personas: personas.parts });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => { console.error(safeError(error?.message ?? error)); process.exitCode = 1; });
}
