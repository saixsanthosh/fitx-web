#!/usr/bin/env node
// Makes the tiny film fixtures the e2e flows serve at /__fitx-fixture/films/... (BRIEF-2 3.4, "Fixtures"): a 2 s
// 64×64 test pattern as HEVC (60 fps) and H.264 (30 fps), its first frame as a WebP poster, and a 2 s 440 Hz tone
// as AAC in .m4a. Under 100 KB in all, never under public/. It writes fixtures.json with each file's size, SHA-256
// and codecs string (from ffprobe); src/components/brand/films/fixture.ts carries the same values and
// tests/brand/film-manifest.test.ts checks them against these files.
//
//   node tests/e2e/fixtures/films/make.mjs        (needs ffmpeg with libx265 and libx264, ffprobe and cwebp)
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const out = (name) => path.join(HERE, name);
const ffmpeg = (...args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
// The same picture in both codecs; deterministic flags so a re-run gives the same bytes on the same ffmpeg.
const pattern = ["-f", "lavfi", "-i", "testsrc2=size=64x64:rate=60:duration=2", "-pix_fmt", "yuv420p", "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:v", "+bitexact"];

ffmpeg(...pattern, "-c:v", "libx265", "-preset", "medium", "-crf", "34", "-tag:v", "hvc1", "-x265-params", "log-level=error:keyint=60", "-movflags", "+faststart", out("pattern-hevc60.mp4"));
ffmpeg(...pattern, "-r", "30", "-c:v", "libx264", "-profile:v", "high", "-preset", "medium", "-crf", "30", "-g", "30", "-movflags", "+faststart", out("pattern-avc30.mp4"));
ffmpeg("-i", out("pattern-avc30.mp4"), "-frames:v", "1", out("poster.png"));
execFileSync("cwebp", ["-quiet", "-q", "70", out("poster.png"), "-o", out("poster.webp")]);
rmSync(out("poster.png"));
ffmpeg("-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2", "-af", "volume=-12dB", "-c:a", "aac", "-b:a", "64k", "-map_metadata", "-1", "-fflags", "+bitexact", "-movflags", "+faststart", out("tone.m4a"));

/** The RFC 6381 codecs value of a video file's first stream, from ffprobe. */
function codecsOf(file) {
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,profile,level,codec_tag_string", "-of", "json", file], { encoding: "utf8" })).streams[0];
  if (probe.codec_name === "hevc") return `hvc1.1.6.L${probe.level}.B0`;
  const profile = { High: "64", Main: "4D", "Constrained Baseline": "42" }[probe.profile] ?? "64";
  return `avc1.${profile}00${Number(probe.level).toString(16).toUpperCase().padStart(2, "0")}`;
}

const files = {};
let total = 0;
for (const name of ["pattern-hevc60.mp4", "pattern-avc30.mp4", "poster.webp", "tone.m4a"]) {
  const file = out(name);
  const bytes = statSync(file).size;
  total += bytes;
  files[name] = { bytes, sha256: createHash("sha256").update(readFileSync(file)).digest("hex"), ...(name.endsWith(".mp4") ? { codecs: codecsOf(file) } : {}) };
}
if (total > 100_000) throw new Error(`the fixtures are ${total} bytes, over the 100 KB the brief allows`);
writeFileSync(out("fixtures.json"), `${JSON.stringify({ total, files }, null, 2)}\n`);
console.log(JSON.stringify({ total, files }, null, 2));
