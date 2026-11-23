/**
 * FITX film audio: file and ffmpeg helpers shared by `mix.mjs` and `analyse.mjs`. Run both through
 * `worktrees/heavy.sh` (they decode and encode with ffmpeg on the CPU).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkSourcesAgainstCredits, MIX, parseCredits } from "./lib.mjs";
import { SOURCES } from "./sources.mjs";

export const AUDIO_SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(AUDIO_SCRIPTS, "..", "..", "..", "..");

/** `.alteration/audio` next to the worktrees (CREDITS.md and raw/), unless `--audio-dir` or FITX_AUDIO_DIR says otherwise. */
export function audioDir(flag) {
  return path.resolve(flag ?? process.env.FITX_AUDIO_DIR ?? path.join(REPO, "..", ".alteration", "audio"));
}


export const sha256Hex = (data) => createHash("sha256").update(data).digest("hex");

/**
 * Checks every original against sources.json and CREDITS.md (size and SHA-256) before anything is decoded.
 * Returns a Map id → source with `path` set to the file on disk; throws on any mismatch.
 */
export function verifiedSources(dir) {
  const sources = [...SOURCES.values()];
  const creditsFile = path.join(dir, "CREDITS.md");
  if (!existsSync(creditsFile)) throw new Error(`No CREDITS.md in ${dir} (pass --audio-dir)`);
  const problems = checkSourcesAgainstCredits(sources, parseCredits(readFileSync(creditsFile, "utf8")));
  const byId = new Map();
  for (const source of sources) {
    const file = path.join(dir, source.file);
    if (!existsSync(file)) { problems.push(`#${source.n} ${source.id}: missing ${file}`); continue; }
    const data = readFileSync(file);
    if (data.length !== source.bytes) problems.push(`#${source.n} ${source.id}: ${data.length} bytes on disk, expected ${source.bytes}`);
    if (sha256Hex(data) !== source.sha256) problems.push(`#${source.n} ${source.id}: SHA-256 on disk differs`);
    byId.set(source.id, { ...source, path: file });
  }
  if (problems.length) throw new Error(`Source check failed:\n- ${problems.join("\n- ")}`);
  return byId;
}

export const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
export const FFPROBE = process.env.FFPROBE ?? "ffprobe";

/** Runs ffmpeg and returns its stderr (where the meters print). Throws with the tail of the log on failure. */
export function ffmpeg(args, { quiet = false } = {}) {
  const result = spawnSync(FFMPEG, ["-hide_banner", "-nostdin", ...args], { encoding: "utf8", maxBuffer: 1 << 28 });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed (${result.status}):\n${String(result.stderr).split("\n").slice(-20).join("\n")}`);
  }
  if (!quiet && process.env.FITX_AUDIO_DEBUG) process.stderr.write(result.stderr);
  return String(result.stderr);
}

/** Decodes a file (optionally through `filter`) to mono float samples at the mix rate. */
export function decodeMono(file, filter = null) {
  const args = ["-v", "error", "-i", file];
  if (filter) args.push("-af", filter);
  args.push("-ac", "1", "-ar", String(MIX.sampleRate), "-f", "f32le", "-");
  const buffer = execFileSync(FFMPEG, args, { maxBuffer: 1 << 28 });
  return new Float32Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length));
}

/**
 * Length of an audio file in samples at the mix rate, as its container declares it (for .m4a, the edit list that
 * drops AAC's priming and trailing padding; browsers play this length). `decoded` is what ffmpeg's decoder returns,
 * which still includes the last frame's padding (up to 1,023 samples).
 */
export function audioLength(file) {
  const out = execFileSync(FFPROBE, ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=duration_ts,time_base", "-of", "json", file], { encoding: "utf8" });
  const stream = JSON.parse(out).streams?.[0];
  const [num, den] = String(stream?.time_base ?? "").split("/").map(Number);
  const declared = Math.round((Number(stream?.duration_ts) * num * MIX.sampleRate) / den);
  const buffer = execFileSync(FFMPEG, ["-v", "error", "-i", file, "-ac", "1", "-ar", String(MIX.sampleRate), "-f", "f32le", "-"], { maxBuffer: 1 << 28 });
  return { declared, decoded: buffer.length / 4 };
}

/** RMS level in dB per hop. */
export function levelsDb(samples, hopSeconds) {
  const hop = Math.round(hopSeconds * MIX.sampleRate);
  const levels = [];
  for (let start = 0; start + hop <= samples.length; start += hop) {
    let energy = 0;
    for (let index = start; index < start + hop; index += 1) energy += samples[index] * samples[index];
    levels.push(10 * Math.log10(energy / hop + 1e-12));
  }
  return levels;
}

/** C0's three bands for the onset scan. */
export const BANDS = Object.freeze({
  low: "lowpass=f=150,lowpass=f=150",
  mid: "highpass=f=150,lowpass=f=2500",
  high: "highpass=f=2500,highpass=f=2500",
});

export function bandLevels(file, hopSeconds) {
  return Object.values(BANDS).map((filter) => levelsDb(decodeMono(file, filter), hopSeconds));
}

export function probeDuration(file) {
  const out = execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { encoding: "utf8" });
  return Number(out.trim());
}

/** Parses `--name=value` and `--flag` arguments; repeated `--name=a=b` pairs collect into an object. */
export function parseArgs(argv) {
  const args = { _: [] };
  for (const arg of argv) {
    const match = arg.match(/^--([a-z-]+)(?:=(.*))?$/);
    if (!match) { args._.push(arg); continue; }
    const [, name, value] = match;
    if (value === undefined) { args[name] = true; continue; }
    const pair = value.match(/^([a-z]+)=(.+)$/);
    if (pair && ["rev", "video"].includes(name)) args[name] = { ...(args[name] ?? {}), [pair[1]]: pair[2] };
    else args[name] = value;
  }
  return args;
}
