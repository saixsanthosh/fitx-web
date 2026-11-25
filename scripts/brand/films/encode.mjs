#!/usr/bin/env node
// Encodes a composition's FFV1 master into the shipped rungs (BRIEF-2 3.2), holding the browser lane with keep-alive
// so an encode never runs during a render. Usage (through heavy.sh):
//   heavy.sh node scripts/brand/films/encode.mjs --master=<dir>/<comp>-<theme>/master.mkv --comp=laptop [--rungs=hevc60,avc30,poster]
//     [--budget] [--crf=<n>] [--avc-crf=<n>] [--tune=grain|none] [--out=<dir>] [--legacy]
// --crf and --avc-crf are the HEVC 60 and AVC 30 rungs' CRF (default ENCODER's 29 and 27): the one encode's, or with
// --budget the CRF it starts from, stepping each rung until its file fits its byte budget. They never change ENCODER
// (part of the film's rev); encoded.json records the CRF each file was made at. --legacy makes the old pipeline's HEVC
// (BT.601, x265 medium, crf 29, keyint 120) for gate A. Outputs go next to the master unless --out.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { HEAVY, laneHandle, stopChildrenOnSignal, track, withLane } from "./lane.mjs";
import { AVC30_SIZES, BUDGET, ENCODER, avc30Args, crfForBudget, cwebpArgs, hevc60Args, legacyHevcArgs, posterPngArgs, reelArgs } from "./lib/encoders.mjs";
import { CWEBP, FFMPEG } from "./lib/preflight.mjs";

const log = (line) => process.stderr.write(`[encode] ${line}\n`);

/** The CRFs `--crf` and `--avc-crf` take: whole numbers in the range `crfForBudget` steps in. */
export const CRF_RANGE = Object.freeze({ min: 20, max: 40 });

function crfArg(name, value) {
  const crf = /^\d+$/.test(value ?? "") ? Number(value) : Number.NaN;
  if (!(crf >= CRF_RANGE.min && crf <= CRF_RANGE.max)) throw new Error(`--${name} must be a whole number from ${CRF_RANGE.min} to ${CRF_RANGE.max}`);
  return crf;
}

export function parseEncodeArgs(argv) {
  const out = { master: null, comp: null, rungs: ["hevc60", "avc30", "poster"], budget: false, out: null, legacy: false, theme: null, tune: ENCODER.hevc60.tune, crf: null, avcCrf: null };
  for (const arg of argv) {
    const match = /^--([a-z]+(?:-[a-z]+)*)(?:=(.*))?$/.exec(arg);
    if (!match) throw new Error(`unknown argument ${arg}`);
    const [, name, value] = match;
    if (name === "master") out.master = value;
    else if (name === "comp") out.comp = value;
    else if (name === "theme") out.theme = value;
    else if (name === "rungs") out.rungs = value.split(",");
    else if (name === "budget") out.budget = true;
    else if (name === "legacy") out.legacy = true;
    else if (name === "out") out.out = value;
    else if (name === "tune") out.tune = value;
    else if (name === "crf") out.crf = crfArg(name, value);
    else if (name === "avc-crf") out.avcCrf = crfArg(name, value);
    else throw new Error(`unknown flag --${name}`);
  }
  if (!out.master) throw new Error("--master is required");
  for (const rung of out.rungs) if (!["hevc60", "avc30", "poster", "reel"].includes(rung)) throw new Error(`unknown rung ${rung}`);
  if (out.rungs.includes("reel")) {
    if (!["landscape", "portrait"].includes(out.comp) || !out.theme) throw new Error("a reel needs --comp=landscape|portrait and --theme");
  } else if (!out.legacy && !AVC30_SIZES[out.comp]) throw new Error("--comp must be a composition");
  return out;
}

/**
 * How each video rung is encoded: `start` is the CRF of its one encode, or with --budget the CRF it steps from, and
 * `budget` its byte cap under --budget (null: one encode).
 */
export function rungEncodes(request) {
  return {
    hevc60: { start: request.crf ?? ENCODER.hevc60.crf, budget: request.budget ? BUDGET.hevc60 : null },
    avc30: { start: request.avcCrf ?? ENCODER.avc30.crf, budget: request.budget ? BUDGET.avc30 : null },
  };
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = track(spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] }));
    let err = "";
    child.stderr.on("data", (chunk) => (err = (err + chunk).slice(-8000)));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(command)} ${code}: ${err}`))));
  });
}

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** Encodes with `args(crf, output)`, stepping the CRF to fit `budget` (null: one encode at `start`). */
async function encodeToBudget({ file, budget, start, lane, args }) {
  const tried = new Map();
  let crf = start;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const part = `${file}.crf${crf}.mp4`;
    const started = Date.now();
    await run(FFMPEG, args(crf, part));
    lane.touch();
    tried.set(crf, { part, bytes: statSync(part).size, seconds: (Date.now() - started) / 1000 });
    log(`${path.basename(file)} crf ${crf}: ${(tried.get(crf).bytes / 1024 / 1024).toFixed(2)} MB`);
    if (!budget) break;
    const next = crfForBudget(crf, tried.get(crf).bytes, budget);
    if (next === crf || tried.has(next)) break;
    crf = next;
  }
  const fitting = [...tried.entries()].filter(([, entry]) => !budget || entry.bytes <= budget).sort((a, b) => a[0] - b[0]);
  const [chosen, entry] = fitting[0] ?? [...tried.entries()].sort((a, b) => b[0] - a[0])[0];
  renameSync(entry.part, file);
  for (const [, other] of tried) if (other.part !== entry.part) rmSync(other.part, { force: true });
  return { crf: chosen, bytes: entry.bytes, seconds: entry.seconds, fits: budget ? entry.bytes <= budget : null };
}

async function work(request, lane) {
  const dir = request.out ? path.resolve(request.out) : path.dirname(path.resolve(request.master));
  mkdirSync(dir, { recursive: true });
  const name = request.comp && request.theme ? `${request.comp}-${request.theme}` : path.basename(path.dirname(path.resolve(request.master)));
  const outputs = {};
  if (request.legacy) {
    const file = path.join(dir, `${name}-legacy-hevc60.mp4`);
    const started = Date.now();
    await run(FFMPEG, legacyHevcArgs({ input: request.master, output: file }));
    outputs.legacy = { file, bytes: statSync(file).size, seconds: (Date.now() - started) / 1000, sha256: sha256(file) };
    lane.touch();
  } else {
    const plan = rungEncodes(request);
    for (const rung of request.rungs) {
      if (rung === "hevc60") {
        const file = path.join(dir, `${name}-hevc60.mp4`);
        outputs.hevc60 = { file, ...(await encodeToBudget({ file, ...plan.hevc60, lane, args: (crf, output) => hevc60Args({ input: request.master, output, crf, tune: request.tune }) })), sha256: null };
        outputs.hevc60.sha256 = sha256(file);
      } else if (rung === "avc30") {
        const file = path.join(dir, `${name}-avc30.mp4`);
        outputs.avc30 = { file, ...(await encodeToBudget({ file, ...plan.avc30, lane, args: (crf, output) => avc30Args({ input: request.master, output, comp: request.comp, crf }) })), sha256: null };
        outputs.avc30.sha256 = sha256(file);
      } else if (rung === "reel") {
        const file = path.join(dir, `reel-${request.theme}-${request.comp}.mp4`);
        const started = Date.now();
        await run(FFMPEG, reelArgs({ input: request.master, output: file, shape: request.comp }));
        outputs.reel = { file, bytes: statSync(file).size, seconds: (Date.now() - started) / 1000, sha256: sha256(file) };
      } else if (rung === "poster") {
        const png = path.join(dir, `${name}-poster.png`);
        const file = path.join(dir, `${name}.webp`);
        await run(FFMPEG, posterPngArgs({ input: request.master, output: png }));
        let quality = ENCODER.poster.quality;
        await run(CWEBP, cwebpArgs({ input: png, output: file, quality }));
        while (statSync(file).size > BUDGET.poster && quality > 40) {
          quality -= 6;
          await run(CWEBP, cwebpArgs({ input: png, output: file, quality }));
        }
        rmSync(png, { force: true });
        outputs.poster = { file, bytes: statSync(file).size, quality, sha256: sha256(file), fits: statSync(file).size <= BUDGET.poster };
      }
      lane.touch();
    }
  }
  writeFileSync(path.join(dir, "encoded.json"), JSON.stringify({ at: new Date().toISOString(), master: request.master, encoder: ENCODER, outputs }, null, 2));
  return outputs;
}

async function main() {
  const request = parseEncodeArgs(process.argv.slice(2));
  if (process.env.FITX_LANE_INNER === "1") {
    stopChildrenOnSignal();
    const lane = laneHandle({ dir: process.env.FITX_LANE_LOCK, pid: Number(process.env.FITX_LANE_PID) });
    const outputs = await work(request, lane);
    process.stdout.write(`${JSON.stringify(outputs)}\n`);
    return;
  }
  await withLane({ kind: "encode", label: path.basename(path.dirname(path.resolve(request.master))) }, (lane) => new Promise((resolve, reject) => {
    const env = { ...process.env, FITX_LANE_INNER: "1", FITX_LANE_LOCK: lane.dir, FITX_LANE_PID: String(process.pid) };
    delete env.FITX_HEAVY_SLOT;
    const child = spawn("/bin/zsh", [HEAVY, process.execPath, fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: "inherit", env });
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`the encode exited with ${code}`))));
  }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    log(error.message);
    process.exit(1);
  });
}
