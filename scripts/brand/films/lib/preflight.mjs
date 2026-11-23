// Preflight (BRIEF-2 3.2): what a render or encode needs from this Mac, checked before any work and written to the
// job log. The parsing is pure (tested); `runPreflight` gathers the outputs.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export const FFMPEG = process.env.FITX_FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
export const FFPROBE = process.env.FITX_FFPROBE ?? "/opt/homebrew/bin/ffprobe";
export const CWEBP = process.env.FITX_CWEBP ?? "/opt/homebrew/bin/cwebp";
export const CHROME = process.env.FITX_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const PLAYWRIGHT_CORE = process.env.E2E_PLAYWRIGHT_CORE ?? "/Users/alphinshaju/Documents/all files/Fitx/worktrees/.redesign/tools/node_modules/playwright-core/index.mjs";

/** The filters the lab, encode and verify use. `zscale` is deliberately absent: this Mac's ffmpeg has no libzimg. */
export const NEEDED_FILTERS = Object.freeze(["scale", "setparams", "tmix", "ssim", "psnr", "ebur128", "loudnorm", "freezedetect", "blackdetect", "vflip", "framemd5"]);
export const NEEDED_ENCODERS = Object.freeze(["libx265", "libx264", "ffv1"]);
/** Free space a film job needs: one composition's FFV1 masters (about 2 to 4 GB at 1080p) plus headroom. */
export const MIN_FREE_BYTES = 12 * 1024 ** 3;

export const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|lavapipe|software rasterizer|microsoft basic render|mesa offscreen/i;

/** `ffmpeg -version` first line → "8.1.1" (or the whole line when it has no number). */
export function parseFfmpegVersion(text) {
  const line = String(text).split("\n")[0] ?? "";
  const match = /ffmpeg version (\S+)/.exec(line);
  return { line: line.trim(), version: match ? match[1] : null };
}

/** Names from `ffmpeg -filters` (lines like " TSC ssim  VV->V  Calculate the SSIM between two video streams."). */
export function parseFilterList(text) {
  const names = new Set();
  for (const line of String(text).split("\n")) {
    const match = /^\s[TSC.]{2,3}\s+(\S+)\s+\S+->\S+/.exec(line);
    if (match) names.add(match[1]);
  }
  // framemd5 is a muxer, not a filter: the caller adds it from `-muxers`.
  return names;
}

/** Names from `ffmpeg -encoders` (lines like " V....D libx265   libx265 H.265 / HEVC (codec hevc)"). */
export function parseEncoderList(text) {
  const names = new Set();
  for (const line of String(text).split("\n")) {
    const match = /^\s[VAS][F.][S.][X.][B.][D.]\s+(\S+)\s/.exec(line);
    if (match) names.add(match[1]);
  }
  return names;
}

/** Muxer names from `ffmpeg -muxers` (lines like "  E  framemd5        Per-frame MD5 testing"). */
export function parseMuxerList(text) {
  const names = new Set();
  for (const line of String(text).split("\n")) {
    const match = /^\s+D?E\s+(\S+)\s/.exec(line);
    if (match) for (const name of match[1].split(",")) names.add(name);
  }
  return names;
}

/** Free bytes from `df -k <dir>` output (the "Available" column of the last line). */
export function parseDfFree(text) {
  const lines = String(text).trim().split("\n");
  const header = lines[0]?.split(/\s+/) ?? [];
  const row = lines[lines.length - 1]?.split(/\s+/) ?? [];
  let column = header.findIndex((name) => /^avail/i.test(name));
  if (column < 0) column = 3;
  // The filesystem name may contain spaces on other systems; count from the end when the row is longer.
  const shift = row.length - header.length;
  const value = Number(row[column + Math.max(0, shift)]);
  return Number.isFinite(value) ? value * 1024 : null;
}

/** The checks a preflight report fails on; an empty list passes. */
export function preflightProblems(report, { needGpu = true, needDisk = true } = {}) {
  const problems = [];
  if (!report.playwright) problems.push(`playwright-core not found at ${PLAYWRIGHT_CORE} (set E2E_PLAYWRIGHT_CORE)`);
  if (!report.chrome) problems.push(`system Chrome not found at ${CHROME}`);
  if (!report.ffmpeg?.version) problems.push("ffmpeg not found");
  if (!report.cwebp) problems.push("cwebp not found (posters and stills are WebP)");
  for (const name of NEEDED_FILTERS) if (!report.filters?.includes(name)) problems.push(`ffmpeg lacks ${name}`);
  for (const name of NEEDED_ENCODERS) if (!report.encoders?.includes(name)) problems.push(`ffmpeg lacks the ${name} encoder`);
  if (needDisk && (report.freeBytes === null || report.freeBytes < MIN_FREE_BYTES)) {
    problems.push(`only ${report.freeBytes === null ? "an unknown amount of" : `${(report.freeBytes / 1024 ** 3).toFixed(1)} GB`} free (needs ${MIN_FREE_BYTES / 1024 ** 3} GB)`);
  }
  if (needGpu) {
    if (!report.gpu) problems.push("no WebGL2 renderer string (Chrome has no GPU path)");
    else if (SOFTWARE_RENDERER.test(report.gpu)) problems.push(`software renderer (${report.gpu}): run with --headed`);
  }
  return problems;
}

const run = (command, args) => {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    return String(error.stdout ?? "");
  }
};

/** Gathers the report (everything except the GPU string, which needs Chrome: render.mjs adds it). */
export function runPreflight(dir) {
  const filters = parseFilterList(run(FFMPEG, ["-hide_banner", "-filters"]));
  const muxers = parseMuxerList(run(FFMPEG, ["-hide_banner", "-muxers"]));
  if (muxers.has("framemd5")) filters.add("framemd5");
  return {
    at: new Date().toISOString(),
    playwright: existsSync(PLAYWRIGHT_CORE),
    chrome: existsSync(CHROME),
    ffmpeg: parseFfmpegVersion(run(FFMPEG, ["-version"])),
    cwebp: existsSync(CWEBP),
    filters: [...filters].filter((name) => NEEDED_FILTERS.includes(name)).sort(),
    encoders: [...parseEncoderList(run(FFMPEG, ["-hide_banner", "-encoders"]))].filter((name) => NEEDED_ENCODERS.includes(name)).sort(),
    freeBytes: parseDfFree(run("/bin/df", ["-k", path.resolve(dir)])),
    gpu: null,
  };
}
