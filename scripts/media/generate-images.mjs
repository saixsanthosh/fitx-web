#!/usr/bin/env node
// Generates a set of site images with Google's Gemini 2.5 Flash Image model ("Nano Banana") and saves them,
// optimised, under public/media/<set>/ with a typed manifest in src/data/<set>-media.ts.
//
//   node scripts/media/generate-images.mjs --set=landing [--only=hero,food] [--dry-run] [--encode-only] [--raw=<dir>]
//
// The key is read from worktrees/.keys/gemini.env (or FITX_GEMINI_ENV) by this script alone and is sent only in the
// x-goog-api-key header. It is never printed, logged or written anywhere. Raw model output goes to a scratch
// folder (not committed); a ledger there counts API calls so a set never goes over its caps.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
export const DEFAULT_KEY_FILE = "/Users/alphinshaju/Documents/all files/Fitx/worktrees/.keys/gemini.env";
export const MODEL = "gemini-2.5-flash-image";
export const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
/** Caps per set and run (brief section 5): committed images and API calls, retries included. */
export const MAX_IMAGES = 12;
export const MAX_CALLS = 24;
export const MAX_BYTES = 350 * 1024;
export const MAX_SET_BYTES = 4 * 1024 * 1024;
export const COST_PER_IMAGE_USD = 0.039;

export function parseArgs(argv) {
  const args = { set: null, only: null, dryRun: false, encodeOnly: false, raw: null };
  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--encode-only") args.encodeOnly = true;
    else if (arg.startsWith("--set=")) args.set = arg.slice(6);
    else if (arg.startsWith("--only=")) args.only = arg.slice(7).split(",").filter(Boolean);
    else if (arg.startsWith("--raw=")) args.raw = arg.slice(6);
    else throw new Error(`Unknown argument ${arg}`);
  }
  if (!args.set || !/^[a-z0-9-]+$/.test(args.set)) throw new Error("Pass --set=<name> (lower case, digits and dashes)");
  return args;
}

/** The key from a dotenv-style file, or null. Never echoes the file's contents. */
export function readKey(text) {
  for (const line of String(text).split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?GEMINI_API_KEY\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const value = match[1].replace(/^(['"])(.*)\1$/, "$2").trim();
    return value || null;
  }
  return null;
}

/** Fills {man}/{woman} placeholders and appends the shared style. */
export function composePrompt(manifest, image) {
  const body = image.prompt.replace(/\{(\w+)\}/g, (whole, name) => manifest.people?.[name] ?? whole);
  if (/\{\w+\}/.test(body)) throw new Error(`${image.id}: unknown placeholder in prompt`);
  return `${body}\n\n${manifest.style}`;
}

/** A hex colour code in a prompt (the model can print it on the picture, as it once did on a bench rail). */
export const HEX_COLOUR = /#[0-9a-f]{3,8}\b/i;

export function validateManifest(manifest) {
  const ids = new Set();
  if (!Array.isArray(manifest.images) || !manifest.images.length) throw new Error("The manifest has no images");
  if (HEX_COLOUR.test(manifest.style ?? "")) throw new Error("The style names a hex colour code; describe the colour in words");
  if (manifest.images.length > MAX_IMAGES) throw new Error(`At most ${MAX_IMAGES} images per set`);
  for (const image of manifest.images) {
    if (!/^[a-z0-9-]+$/.test(image.id ?? "")) throw new Error(`Bad image id ${image.id}`);
    if (ids.has(image.id)) throw new Error(`Duplicate image id ${image.id}`);
    if (!image.prompt || !image.alt) throw new Error(`${image.id}: prompt and alt are required`);
    if (HEX_COLOUR.test(image.prompt)) throw new Error(`${image.id}: the prompt names a hex colour code; describe the colour in words`);
    if (!/^\d+:\d+$/.test(image.aspect ?? "")) throw new Error(`${image.id}: aspect like 4:5`);
    if (image.ref && !ids.has(image.ref)) throw new Error(`${image.id}: ref ${image.ref} must come earlier`);
    if ((image.longEdge ?? 0) > 2400) throw new Error(`${image.id}: long edge at most 2400 px`);
    ids.add(image.id);
  }
  return manifest;
}

/** The generateContent body. The key is not part of it. */
export function requestBody(prompt, aspect, reference) {
  const parts = [{ text: prompt }];
  if (reference) parts.push({ inline_data: { mime_type: reference.mimeType, data: reference.data } });
  return { contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: aspect } } };
}

/** The first image in a generateContent answer, or a reason there is none. */
export function pickImage(json) {
  const parts = json?.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const data = part.inlineData ?? part.inline_data;
    if (data?.data) return { mimeType: data.mimeType ?? data.mime_type ?? "image/png", data: data.data };
  }
  const reason = json?.candidates?.[0]?.finishReason ?? json?.promptFeedback?.blockReason ?? "no image in the answer";
  return { error: String(reason) };
}

/** An error message that can be logged: the key (if it somehow appears) is masked and the text is cut short. */
export function safeError(text, key) {
  let out = String(text ?? "");
  if (key) out = out.split(key).join("[key]");
  return out.replace(/AIza[0-9A-Za-z_-]{20,}/g, "[key]").slice(0, 400);
}

function ledgerPath(rawDir) { return path.join(rawDir, "calls.json"); }
function readLedger(rawDir) {
  try { return JSON.parse(readFileSync(ledgerPath(rawDir), "utf8")); } catch { return { calls: 0, images: {} }; }
}

async function generate({ manifest, image, key, rawDir, ledger }) {
  if (ledger.calls >= MAX_CALLS) throw new Error(`API call cap (${MAX_CALLS}) reached for this set`);
  let reference = null;
  if (image.ref) {
    const refFile = path.join(rawDir, `${image.ref}.png`);
    if (!existsSync(refFile)) throw new Error(`${image.id}: generate ${image.ref} first`);
    reference = { mimeType: "image/png", data: readFileSync(refFile).toString("base64") };
  }
  ledger.calls += 1;
  writeFileSync(ledgerPath(rawDir), JSON.stringify(ledger, null, 2));
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(requestBody(composePrompt(manifest, image), image.aspect, reference)),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${image.id}: HTTP ${response.status} ${safeError(text, key)}`);
  const picked = pickImage(JSON.parse(text));
  if (picked.error) throw new Error(`${image.id}: ${safeError(picked.error, key)}`);
  const sharp = (await import("sharp")).default;
  // Normalise to PNG so later reference calls and re-encodes read one format.
  const png = await sharp(Buffer.from(picked.data, "base64")).png().toBuffer();
  writeFileSync(path.join(rawDir, `${image.id}.png`), png);
  ledger.images[image.id] = (ledger.images[image.id] ?? 0) + 1;
  writeFileSync(ledgerPath(rawDir), JSON.stringify(ledger, null, 2));
}

/**
 * Pixel boxes from fractions of the frame, clamped inside it. A box may also name `from` (the top-left corner, as
 * fractions, of a clean patch of the same size to copy over the box instead of blurring it), `feather` (pixels over
 * which the patch fades into the photo) and `ellipse` (patch only the ellipse inside the box).
 */
export function retouchBoxes(width, height, retouch) {
  return retouch.map(({ x, y, w, h, sigma = 12, from, feather, ellipse }) => {
    const left = Math.max(0, Math.round(x * width));
    const top = Math.max(0, Math.round(y * height));
    const box = { left, top, width: Math.max(1, Math.min(width - left, Math.round(w * width))), height: Math.max(1, Math.min(height - top, Math.round(h * height))), sigma };
    if (from) {
      box.from = {
        left: Math.max(0, Math.min(width - box.width, Math.round(from.x * width))),
        top: Math.max(0, Math.min(height - box.height, Math.round(from.y * height))),
      };
    }
    if (feather) box.feather = feather;
    if (ellipse) box.ellipse = true;
    return box;
  });
}

/** How much of the patch shows at pixel (px, py) inside a box: 1 well inside, fading to 0 at the edge over `feather`. */
export function retouchWeight(box, px, py) {
  const feather = Math.max(0, box.feather ?? 0);
  let inside;
  if (box.ellipse) {
    const rx = box.width / 2;
    const ry = box.height / 2;
    const dx = (px + 0.5 - box.left - rx) / rx;
    const dy = (py + 0.5 - box.top - ry) / ry;
    const r = Math.sqrt(dx * dx + dy * dy);
    if (r >= 1) return 0;
    inside = (1 - r) * Math.min(rx, ry);
  } else {
    if (px < box.left || py < box.top || px >= box.left + box.width || py >= box.top + box.height) return 0;
    inside = Math.min(px - box.left + 0.5, py - box.top + 0.5, box.left + box.width - px - 0.5, box.top + box.height - py - 0.5);
  }
  return feather ? Math.max(0, Math.min(1, inside / feather)) : 1;
}

/** Copies a clean patch (or a blurred copy of the photo) into each masked box, blended by retouchWeight. */
async function maskedPatches(sharp, png, boxes) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const { width, channels } = info;
  const original = Buffer.from(data);
  for (const box of boxes) {
    const source = box.from ? original : (await sharp(png).blur(box.sigma).raw().toBuffer());
    for (let py = box.top; py < box.top + box.height; py += 1) {
      for (let px = box.left; px < box.left + box.width; px += 1) {
        const weight = retouchWeight(box, px, py);
        if (!weight) continue;
        const sx = box.from ? box.from.left + (px - box.left) : px;
        const sy = box.from ? box.from.top + (py - box.top) : py;
        const at = (py * width + px) * channels;
        const from = (sy * width + sx) * channels;
        for (let c = 0; c < Math.min(3, channels); c += 1) data[at + c] = Math.round(weight * source[from + c] + (1 - weight) * data[at + c]);
      }
    }
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

/** Softens small areas (stray lettering the model drew despite the prompt) with a heavy blur or a clean patch; returns a buffer. */
async function retouched(sharp, rawFile, retouch) {
  if (!retouch?.length) return rawFile;
  const meta = await sharp(rawFile).metadata();
  const patches = [];
  const masked = [];
  for (const box of retouchBoxes(meta.width, meta.height, retouch)) {
    if (box.from || box.feather || box.ellipse) { masked.push(box); continue; }
    const pad = Math.ceil(box.sigma * 3);
    const outer = { left: Math.max(0, box.left - pad), top: Math.max(0, box.top - pad) };
    outer.width = Math.min(meta.width - outer.left, box.width + 2 * pad);
    outer.height = Math.min(meta.height - outer.top, box.height + 2 * pad);
    const blurred = await sharp(rawFile).extract(outer).blur(box.sigma).toBuffer();
    const inner = await sharp(blurred).extract({ left: box.left - outer.left, top: box.top - outer.top, width: box.width, height: box.height }).toBuffer();
    patches.push({ input: inner, left: box.left, top: box.top });
  }
  if (!masked.length) return sharp(rawFile).composite(patches).png().toBuffer();
  const base = patches.length ? await sharp(rawFile).composite(patches).png().toBuffer() : await sharp(rawFile).png().toBuffer();
  return maskedPatches(sharp, base, masked);
}

/** Encodes one raw file to WebP under the byte budget; returns its size and a tiny blur placeholder. */
export async function encode(rawFile, outFile, longEdge, retouch = []) {
  const sharp = (await import("sharp")).default;
  rawFile = await retouched(sharp, rawFile, retouch);
  const meta = await sharp(rawFile).metadata();
  const scale = Math.min(1, longEdge / Math.max(meta.width, meta.height));
  const width = Math.round(meta.width * scale);
  const height = Math.round(meta.height * scale);
  let quality = 78;
  let buffer;
  for (;;) {
    buffer = await sharp(rawFile).resize(width, height).webp({ quality, effort: 6, smartSubsample: true }).toBuffer();
    if (buffer.length <= MAX_BYTES || quality <= 46) break;
    quality -= 6;
  }
  if (buffer.length > MAX_BYTES) throw new Error(`${path.basename(outFile)} is over ${MAX_BYTES} bytes`);
  writeFileSync(outFile, buffer);
  const blur = await sharp(rawFile).resize(16, Math.max(1, Math.round((16 * height) / width))).webp({ quality: 40 }).toBuffer();
  return { width, height, bytes: buffer.length, quality, blurDataURL: `data:image/webp;base64,${blur.toString("base64")}` };
}

export function mediaModule(set, entries) {
  const name = `${set.replace(/-([a-z0-9])/g, (_m, c) => c.toUpperCase()).toUpperCase()}_MEDIA`;
  const lines = entries.map((entry) => `  ${JSON.stringify(entry.id)}: { src: ${JSON.stringify(entry.src)}, width: ${entry.width}, height: ${entry.height}, alt: ${JSON.stringify(entry.alt)}, blurDataURL: ${JSON.stringify(entry.blurDataURL)} },`);
  return `// Generated by scripts/media/generate-images.mjs --set=${set} (${MODEL}). Do not edit by hand.\n` +
    `export type SiteImage = { src: string; width: number; height: number; alt: string; blurDataURL: string };\n\n` +
    `export const ${name} = {\n${lines.join("\n")}\n} as const satisfies Record<string, SiteImage>;\n\n` +
    `export type ${name.replace(/_MEDIA$/, "").replace(/(^|_)([A-Z])([A-Z]*)/g, (_m, _s, a, b) => a + b.toLowerCase())}MediaId = keyof typeof ${name};\n`;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const manifest = validateManifest(JSON.parse(readFileSync(path.join(HERE, `${args.set}.prompts.json`), "utf8")));
  const rawDir = args.raw ?? path.join(process.env.FITX_MEDIA_RAW ?? path.join(os.tmpdir(), "fitx-media-raw"), args.set);
  mkdirSync(rawDir, { recursive: true });
  const wanted = manifest.images.filter((image) => !args.only || args.only.includes(image.id));
  if (args.dryRun) {
    for (const image of wanted) console.log(`[dry-run] ${image.id} ${image.aspect}${image.ref ? ` ref=${image.ref}` : ""}\n${composePrompt(manifest, image)}\n`);
    console.log(`[dry-run] ${wanted.length} images, about US$${(wanted.length * COST_PER_IMAGE_USD).toFixed(2)}`);
    return;
  }
  const ledger = readLedger(rawDir);
  if (!args.encodeOnly) {
    const keyFile = process.env.FITX_GEMINI_ENV ?? DEFAULT_KEY_FILE;
    if (!existsSync(keyFile)) { console.error("No Gemini key yet"); process.exitCode = 3; return; }
    const key = readKey(readFileSync(keyFile, "utf8"));
    if (!key) { console.error("No Gemini key yet"); process.exitCode = 3; return; }
    for (const image of wanted) {
      try {
        await generate({ manifest, image, key, rawDir, ledger });
        console.log(`generated ${image.id} (calls so far: ${ledger.calls})`);
      } catch (error) {
        console.error(`failed ${safeError(error?.message ?? error, key)}`);
      }
    }
  }
  const outDir = path.join(ROOT, "public/media", args.set);
  mkdirSync(outDir, { recursive: true });
  const entries = [];
  let total = 0;
  for (const image of manifest.images) {
    const raw = path.join(rawDir, `${image.id}.png`);
    if (!existsSync(raw)) continue;
    const file = `${image.id}.webp`;
    const out = await encode(raw, path.join(outDir, file), image.longEdge ?? 1600, image.retouch);
    total += out.bytes;
    entries.push({ id: image.id, src: `/media/${args.set}/${file}`, alt: image.alt, ...out });
    console.log(`encoded ${file} ${out.width}x${out.height} ${(out.bytes / 1024).toFixed(0)} KB q${out.quality}`);
  }
  if (total > MAX_SET_BYTES) throw new Error(`The set is ${total} bytes, over ${MAX_SET_BYTES}`);
  writeFileSync(path.join(ROOT, "src/data", `${args.set}-media.ts`), mediaModule(args.set, entries));
  console.log(`${entries.length} images, ${(total / 1024).toFixed(0)} KB; API calls in this set's ledger: ${ledger.calls} (about US$${(ledger.calls * COST_PER_IMAGE_USD).toFixed(2)})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(safeError(error?.message ?? error)); process.exitCode = 1; });
}
