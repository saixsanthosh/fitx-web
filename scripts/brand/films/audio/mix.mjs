#!/usr/bin/env node
/**
 * FITX film audio mixer (BRIEF-2 3.4): builds the intro and welcome film mixes and the returning-reveal sting from the
 * cue sheets, with ffmpeg only (CPU; run it through worktrees/heavy.sh, never in the browser lane).
 *
 *   # Preview mixes for the owner's listen-through (outside the repo; default .alteration/audio/previews/):
 *   worktrees/heavy.sh node scripts/brand/films/audio/mix.mjs --preview [--films=intro,welcome,sting]
 *       [--intro-duration=12.6] [--video=intro=<mp4>] [--video=welcome=<animatic.mp4>] [--out=<dir>]
 *
 *   # Finals (S6, coordinator only): writes public/brand/films/<film>/<rev8>/sound.m4a and
 *   # public/brand/films/return/<rev8>/sting.m4a, and the FilmAudio entries for cuts.generated.ts:
 *   worktrees/heavy.sh node scripts/brand/films/audio/mix.mjs --final --rev=intro=<rev8> --rev=welcome=<rev8>
 *       [--json=<file>] [--out=<dir>]
 *
 * Common: --audio-dir=<.alteration/audio> (CREDITS.md and raw/), --work=<dir> (temporary WAVs; deleted unless
 * --keep), --dry-run (print the sheets and the filter graphs, run nothing).
 *
 * Steps for each output:
 * 1. Every source is checked against sources.json and .alteration/audio/CREDITS.md (size and SHA-256).
 * 2. Levelling, two passes: loudnorm measures each cue's segment (trim and low-pass applied), then the linear gain
 *    that brings it to −23 LUFS is applied in the mix graph as `volume` (what loudnorm's linear pass does, without its
 *    192 kHz round trip, so every cue stays sample-exact on its film time).
 * 3. Placement: atrim, afade, volume (levelling plus the cue's gain), adelay, then amix (no normalisation), padded or
 *    cut to the film length to the sample.
 * 4. Mastering: a gain to the target (−16 LUFS films, −20 LUFS sting); only when the true peak would pass −1.5 dBTP, a
 *    4× oversampled limiter; repeated until the integrated loudness is within 0.2 LU.
 * 5. AAC-LC 128 kbps, 48 kHz stereo .m4a (bit-exact flags, no metadata, faststart), then decoded and checked:
 *    I within ± 1 LU of the target, true peak ≤ −1 dBTP, length within ± 10 ms, bytes under the cap. A true peak
 *    over the ceiling after encoding lowers the limiter by 0.5 dB and tries again.
 * Never writes a .wav or .mp3 outside the work folder; the originals are never copied.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { INTRO_ACCENTS, introSheet } from "./intro.cues.mjs";
import { audioDir, audioLength, bandLevels, ffmpeg, parseArgs, probeDuration, REPO, sha256Hex, verifiedSources } from "./io.mjs";
import {
  buildMixGraph,
  checkOutput,
  cueSpan,
  describeSheet,
  levellingGain,
  masterFilter,
  MIX,
  parseEbur128,
  parseLoudnormJson,
  rev8,
  segmentFilter,
  segmentKey,
  strongestOnset,
  validateSheet,
} from "./lib.mjs";
import { stingSheet } from "./sting.cues.mjs";
import { WELCOME_SEATS, welcomeSheet } from "./welcome.cues.mjs";
import { SHOTS } from "../../../../src/components/brand/intro/timeline.ts";
import { WELCOME_SHOTS } from "../../../../src/components/brand/intro/films/welcome/timeline.ts";
import { FILM_MANIFESTS } from "../../../../src/components/brand/films/cuts.generated.ts";

const PUBLIC_FILMS = path.join(REPO, "public", "brand", "films");

/** A film's shipped light cut (laptop, dark, AVC 30, from cuts.generated.ts): a preview's picture when no --video is given. */
export function shippedCut(film, manifests = FILM_MANIFESTS) {
  const cut = manifests[film]?.cuts.find((entry) => entry.comp === "laptop" && entry.theme === "dark" && entry.rung === "avc30");
  const file = cut ? path.join(REPO, "public", cut.src) : null;
  return file && existsSync(file) ? file : null;
}

const r = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

/** The sting's file name hashes everything that makes it, so a change in the sheet, the source or the settings renames it. */
export function stingRev(sheet, sourcesById) {
  return rev8({ sheet: describeSheet(sheet, sourcesById), source: sourcesById.get("impact").sha256, mix: MIX }, sha256Hex);
}

function measure(file) {
  return parseEbur128(ffmpeg(["-i", file, "-af", "ebur128=peak=true:framelog=info", "-f", "null", "-"], { quiet: true }));
}

/** Pass 1 of the levelling: each distinct segment measured once. */
function levelCues(sheet, sources) {
  const cache = new Map();
  const levels = {};
  const notes = {};
  for (const cue of sheet.cues) {
    const source = sources.get(cue.source);
    const key = segmentKey(cue, source);
    if (!cache.has(key)) {
      const span = cueSpan(cue, source);
      let basis = "its segment";
      let filter = segmentFilter(cue, source);
      // Integrated loudness needs at least one 400 ms block; a cue cut short by the film's end is levelled on the
      // same span run to the source's end, so the cut never makes it louder.
      if (span.length < 0.5) {
        filter = segmentFilter({ ...cue, to: undefined }, source);
        basis = "its segment run to the source's end (the cue is cut short by the film's end)";
      }
      const measured = parseLoudnormJson(ffmpeg(["-i", source.path, "-af", `${filter},loudnorm=I=${MIX.cueLufs}:TP=-2:LRA=20:print_format=json`, "-f", "null", "-"], { quiet: true }));
      if (!Number.isFinite(measured.integrated)) throw new Error(`${sheet.film}/${cue.id}: no loudness measured`);
      cache.set(key, { gain: levellingGain(measured.integrated), measured, basis });
    }
    const entry = cache.get(key);
    levels[cue.id] = entry.gain;
    notes[cue.id] = { measuredLufs: entry.measured.integrated, measuredTruePeak: entry.measured.truePeak, levellingGainDb: r(entry.gain), basis: entry.basis };
  }
  return { levels, notes };
}

function renderSum(sheet, sources, levels, file) {
  const graph = buildMixGraph(sheet, sources, levels);
  const inputs = sheet.cues.flatMap((cue) => ["-i", sources.get(cue.source).path]);
  ffmpeg([...inputs, "-filter_complex", graph, "-map", "[mix]", "-ar", String(MIX.sampleRate), "-c:a", "pcm_f32le", "-y", file]);
}

function master(sumFile, target, work, name, ceilingStart) {
  const sum = measure(sumFile);
  let gainDb = target - sum.integrated;
  let ceilingDb = sum.truePeak + gainDb > MIX.limiterCeiling ? ceilingStart : null;
  const file = path.join(work, `${name}-master.wav`);
  let result = null;
  for (let pass = 0; pass < 6; pass += 1) {
    ffmpeg(["-i", sumFile, "-af", masterFilter({ gainDb, ceilingDb }), "-ar", String(MIX.sampleRate), "-c:a", "pcm_f32le", "-y", file]);
    result = measure(file);
    if (ceilingDb === null && result.truePeak > MIX.limiterCeiling) { ceilingDb = ceilingStart; continue; }
    if (Math.abs(result.integrated - target) <= 0.2) break;
    gainDb += target - result.integrated;
  }
  return { file, gainDb: r(gainDb, 3), ceilingDb, sum, mastered: result };
}

function encode(input, output) {
  ffmpeg([
    "-i", input, "-c:a", MIX.aac.codec, "-b:a", MIX.aac.bitrate, "-ar", String(MIX.sampleRate), "-ac", String(MIX.aac.channels),
    "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact", "-movflags", "+faststart", "-y", output,
  ]);
}

/**
 * Where each transient cue's onset landed in the decoded output, against where the sheet put it (ms; the strongest
 * onset within 80 ms of the cue's time). Informational: a louder sound at the same moment can mask a cue.
 */
function syncCheck(sheet, sources, output) {
  const hop = 0.01;
  const bands = bandLevels(output, hop);
  const sync = {};
  for (const cue of sheet.cues) {
    const kind = sources.get(cue.source).anchor.kind;
    if (kind !== "hit" && kind !== "boom") continue;
    // The onset scan compares each hop with the 80 ms before it, so it cannot see the first 80 ms of a file.
    if (cue.at < 0.09) { sync[cue.id] = "inside the first 80 ms (not measurable)"; continue; }
    const found = strongestOnset(bands, hop, { after: cue.at - 0.08, before: cue.at + 0.08 });
    sync[cue.id] = found.at === null ? null : { offsetMs: r((found.at - cue.at) * 1000, 0), riseDb: found.rise };
  }
  return sync;
}

/** Mixes one sheet to `output` (.m4a) and checks it. */
function mixSheet(sheet, sources, work, output) {
  const problems = validateSheet(sheet, sources);
  if (problems.length) throw new Error(`Cue sheet ${sheet.film}:\n- ${problems.join("\n- ")}`);
  const { levels, notes } = levelCues(sheet, sources);
  const sumFile = path.join(work, `${sheet.film}-sum.wav`);
  renderSum(sheet, sources, levels, sumFile);
  const maxBytes = sheet.film === "sting" ? MIX.maxStingBytes : MIX.maxFilmBytes;
  let ceiling = MIX.limiterCeiling;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const mastered = master(sumFile, sheet.lufs, work, sheet.film, ceiling);
    encode(mastered.file, output);
    const measured = measure(output);
    const length = audioLength(output);
    const samples = length.declared;
    const data = readFileSync(output);
    const failures = checkOutput({ measured, samples, expectedSeconds: sheet.duration, lufs: sheet.lufs, bytes: data.length, maxBytes });
    const overPeak = measured.truePeak !== null && measured.truePeak > MIX.truePeak;
    if (overPeak && attempt < 3) { ceiling -= 0.5; continue; }
    return {
      film: sheet.film,
      file: output,
      sync: syncCheck(sheet, sources, output),
      bytes: data.length,
      sha256: sha256Hex(data),
      lufs: r(measured.integrated, 1),
      truePeak: measured.truePeak,
      range: measured.range,
      shortTermMax: measured.shortTermMax,
      momentaryMax: measured.momentaryMax,
      duration: r(samples / MIX.sampleRate, 3),
      decodedDuration: r(length.decoded / MIX.sampleRate, 3),
      expectedDuration: sheet.duration,
      master: {
        sumLufs: mastered.sum.integrated,
        sumTruePeak: mastered.sum.truePeak,
        gainDb: mastered.gainDb,
        limiterCeilingDb: mastered.ceilingDb,
        // How far the loudest peak would have gone over the ceiling: what the limiter takes off it (0: untouched).
        limiterReductionDb: mastered.ceilingDb === null ? 0 : r(Math.max(0, mastered.sum.truePeak + mastered.gainDb - mastered.ceilingDb), 1),
      },
      levelling: notes,
      problems: failures,
    };
  }
  throw new Error(`${sheet.film}: true peak still above ${MIX.truePeak} dBTP after lowering the limiter`);
}

// ---------------------------------------------------------------------------------------------- preview videos

const STRIP = { width: 960, height: 160, bg: "0x121412", wave: "0x8f988f", shade: "white@0.07", line: "white@0.35", cue: "0xff6a3d", playhead: "white" };

/** A timing strip: the mix's waveform, the shots as alternating shaded blocks with lines on the cuts, a mark per cue. */
function stripPng(audioFile, sheet, shots, png) {
  const x = (time) => Math.round((time / sheet.duration) * STRIP.width);
  const boxes = [];
  shots.forEach((shot, index) => {
    const end = Math.min(shot.end, sheet.duration);
    if (index % 2 === 1) boxes.push(`drawbox=x=${x(shot.start)}:y=0:w=${Math.max(1, x(end) - x(shot.start))}:h=${STRIP.height}:color=${STRIP.shade}:t=fill`);
    if (shot.start > 0) boxes.push(`drawbox=x=${x(shot.start)}:y=0:w=1:h=${STRIP.height}:color=${STRIP.line}:t=fill`);
  });
  for (const cue of sheet.cues) boxes.push(`drawbox=x=${Math.max(0, x(cue.at) - 1)}:y=0:w=3:h=22:color=${STRIP.cue}:t=fill`);
  const graph = [
    `color=c=${STRIP.bg}:s=${STRIP.width}x${STRIP.height}:d=1[bg]`,
    `[0:a]showwavespic=s=${STRIP.width}x${STRIP.height}:colors=${STRIP.wave}:scale=sqrt[w]`,
    `[bg][w]overlay=format=auto${boxes.length ? `,${boxes.join(",")}` : ""}[out]`,
  ].join(";");
  ffmpeg(["-i", audioFile, "-filter_complex", graph, "-map", "[out]", "-frames:v", "1", "-update", "1", "-y", png]);
}

/**
 * The listen-through file: the film's own picture when one exists (with the timing strip under it), else the strip
 * alone, and the encoded mix. MPEG-4 Part 2 video (light on the CPU, no x264 or x265, plays in QuickTime).
 */
function previewVideo({ audioFile, sheet, shots, video, output, work }) {
  const png = path.join(work, `${sheet.film}-strip.png`);
  stripPng(audioFile, sheet, shots, png);
  const D = sheet.duration;
  const fps = 30;
  const playhead = `color=c=${STRIP.playhead}:s=2x${STRIP.height}:r=${fps}:d=${D}[ph]`;
  const stripChain = `[1:v]fps=${fps},format=yuv420p[st];${playhead};[st][ph]overlay=x='(t/${D})*main_w':y=0:shortest=1[strip]`;
  const inputs = [];
  let graph;
  if (video) {
    const pad = Math.max(0, D - probeDuration(video)) + 0.1;
    inputs.push("-i", video, "-loop", "1", "-framerate", String(fps), "-t", String(D), "-i", png, "-i", audioFile);
    graph = `[0:v]scale=${STRIP.width}:-2,fps=${fps},tpad=stop_mode=clone:stop_duration=${r(pad, 3)},trim=duration=${D},setpts=PTS-STARTPTS,format=yuv420p[top];${stripChain};[top][strip]vstack[v]`;
  } else {
    inputs.push("-f", "lavfi", "-i", `color=c=${STRIP.bg}:s=${STRIP.width}x8:r=${fps}:d=${D}`, "-loop", "1", "-framerate", String(fps), "-t", String(D), "-i", png, "-i", audioFile);
    graph = `${stripChain};[strip]null[v]`;
  }
  ffmpeg([...inputs, "-filter_complex", graph, "-map", "[v]", "-map", "2:a", "-c:v", "mpeg4", "-q:v", "4", "-tag:v", "mp4v", "-c:a", "copy", "-t", String(D), "-movflags", "+faststart", "-y", output]);
}

// ---------------------------------------------------------------------------------------------- main

function sheetsFor(args) {
  const films = String(args.films ?? "intro,welcome,sting").split(",").map((film) => film.trim()).filter(Boolean);
  const introDuration = args["intro-duration"] ? Number(args["intro-duration"]) : undefined;
  const sheets = { intro: () => introSheet(introDuration), welcome: () => welcomeSheet(), sting: () => stingSheet() };
  return films.map((film) => {
    if (!sheets[film]) throw new Error(`Unknown film ${film} (intro, welcome, sting)`);
    return sheets[film]();
  });
}

const shotsFor = (sheet) => {
  if (sheet.film === "intro") return SHOTS.map((shot) => ({ start: shot.start, end: shot.id === "6-brand" ? sheet.duration : shot.end }));
  if (sheet.film === "welcome") return WELCOME_SHOTS.map((shot) => ({ start: shot.start, end: shot.end }));
  return [{ start: 0, end: sheet.duration }];
};

function main() {
  const args = parseArgs(process.argv.slice(2));
  const final = Boolean(args.final);
  // A final always has the timeline's own length (FILM_DURATION), so the mix matches the encoded film.
  if (final && args["intro-duration"]) throw new Error("--intro-duration is for previews only; a final uses FILM_DURATION");
  const dir = audioDir(args["audio-dir"]);
  const sources = verifiedSources(dir);
  const sheets = sheetsFor(args);
  if (!process.env.FITX_HEAVY_SLOT) console.warn("Note: not inside a heavy.sh slot (run through worktrees/heavy.sh on the shared Mac).");

  if (args["dry-run"]) {
    for (const sheet of sheets) {
      const problems = validateSheet(sheet, sources);
      console.log(JSON.stringify(describeSheet(sheet, sources), null, 2));
      if (problems.length) console.log(`PROBLEMS:\n- ${problems.join("\n- ")}`);
      console.log(buildMixGraph(sheet, sources, Object.fromEntries(sheet.cues.map((cue) => [cue.id, 0]))));
    }
    return;
  }

  const out = path.resolve(args.out ?? (final ? PUBLIC_FILMS : path.join(dir, "previews")));
  const work = args.work ? path.resolve(args.work) : mkdtempSync(path.join(os.tmpdir(), "fitx-audio-"));
  mkdirSync(work, { recursive: true });
  const results = [];
  try {
    for (const sheet of sheets) {
      let output;
      if (final) {
        const rev = sheet.film === "sting" ? stingRev(sheet, sources) : args.rev?.[sheet.film];
        if (!rev || !/^[0-9a-f]{8}$/.test(rev)) throw new Error(`--final needs --rev=${sheet.film}=<rev8> (the film's encode rev)`);
        output = path.join(out, sheet.film === "sting" ? "return" : sheet.film, rev, sheet.film === "sting" ? "sting.m4a" : "sound.m4a");
      } else {
        output = path.join(out, `${sheet.film}.m4a`);
      }
      mkdirSync(path.dirname(output), { recursive: true });
      const result = mixSheet(sheet, sources, work, output);
      if (!final) {
        const video = args.video?.[sheet.film] ?? (sheet.film === "sting" ? null : shippedCut(sheet.film));
        const previewFile = path.join(out, `${sheet.film}-preview.mp4`);
        previewVideo({ audioFile: output, sheet, shots: shotsFor(sheet), video, output: previewFile, work });
        result.preview = { file: previewFile, picture: video ? path.relative(REPO, video).startsWith("..") ? video : path.relative(REPO, video) : "timing strip only" };
      }
      result.sheet = describeSheet(sheet, sources);
      results.push(result);
      const status = result.problems.length ? `FAIL: ${result.problems.join("; ")}` : "ok";
      console.log(`${sheet.film}: ${result.duration} s, I ${result.lufs} LUFS, TP ${result.truePeak} dBTP, ${result.bytes} bytes -> ${result.file} [${status}]`);
    }
  } finally {
    if (!args.keep && !args.work) rmSync(work, { recursive: true, force: true });
  }

  const failed = results.filter((result) => result.problems.length);
  if (final) {
    const audio = Object.fromEntries(results.map((result) => {
      const src = out === PUBLIC_FILMS ? `/${path.relative(path.join(REPO, "public"), result.file).split(path.sep).join("/")}` : result.file;
      return [result.film, { src, bytes: result.bytes, sha256: result.sha256, lufs: result.lufs, duration: result.duration }];
    }));
    const json = `${JSON.stringify(audio, null, 2)}\n`;
    if (args.json) writeFileSync(path.resolve(args.json), json);
    process.stdout.write(json);
  } else {
    const summary = {
      made: new Date().toISOString(),
      note: "Preview mixes for the owner's listen-through (BRIEF-2 6.2 item 6). Outside the repository; S6 makes the finals.",
      accents: { intro: INTRO_ACCENTS, welcomePlateSeats: WELCOME_SEATS },
      settings: MIX,
      results,
    };
    writeFileSync(path.join(out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  }
  if (failed.length) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
