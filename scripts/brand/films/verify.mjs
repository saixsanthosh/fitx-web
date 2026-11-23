#!/usr/bin/env node
// Checks the lab's outputs (BRIEF-2 3.2). Every mode prints JSON and exits 1 when a check fails. Run through heavy.sh;
// --framing drives the lab and so takes the browser lane like render.mjs.
//   --cut=<mp4> --film=intro|welcome --comp=<c> --rung=hevc60|avc30 [--sha256=<hex>] [--fades=a-b,c-d]
//       ffprobe (codec, profile, level, frames, fps, bt709 tv tags, moov first, SHA-256), freezedetect and blackdetect
//       outside the authored fades and holds
//   --mix=<m4a> --duration=<s> [--sting]          ebur128: I −16 ± 1 LUFS (not the sting), TP ≤ −1 dBTP, length ± 10 ms
//   --compare=<a> --against=<b> [--a-matrix=bt709] [--b-matrix=bt601] [--frames=<n>]
//       SSIM and PSNR after bringing both to the same colour space (BT.709 limited YUV 4:2:0)
//   --determinism=<master2> --against=<master1> --pick=<frames in master2's order>
//       each re-rendered frame against the same frame of the first render, PSNR ≥ 55 dB
//   --contact=<video> --comp=<c> [--fps=2] [--available=a,b] [--out=<jpg>]
//       a contact sheet with the protected box drawn on
//   --framing --film=<f> --comp=<c> --theme=<t> [--available=a,b] [--zones=<json>]
//       project() at every 6th frame and each shot boundary ± 1; every must box inside the protected box at each served
//       band's real edges and outside the zones
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FILM_FRAMES, LEVELS, gateA, moovFirst, mixProblems, parseDetect, parseEbur128, parseSsimPsnr, probeProblems, topLevelBoxes, unexpectedIntervals } from "./lib/checks.mjs";
import { AVC30_SIZES } from "./lib/encoders.mjs";
import { boxFromNdc, framingFailures, framingFrames, protectedBox } from "./lib/framing.mjs";
import { COMP_SIZES } from "./lib/plan.mjs";
import { FFMPEG, FFPROBE } from "./lib/preflight.mjs";

function parse(argv) {
  const out = {};
  for (const arg of argv) {
    const match = /^--([a-z0-9-]+)(?:=(.*))?$/.exec(arg);
    if (!match) throw new Error(`unknown argument ${arg}`);
    out[match[1]] = match[2] ?? true;
  }
  return out;
}

function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("close", (code) => (code === 0 ? resolve({ out, err }) : reject(new Error(`${path.basename(command)} ${code}: ${err.slice(-4000)}`))));
  });
}

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

function headBytes(file, length = 1 << 20) {
  const fd = openSync(file, "r");
  try {
    const buffer = Buffer.alloc(length);
    const read = readSync(fd, buffer, 0, length, 0);
    return buffer.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

const ranges = (text) => (text ? String(text).split(",").map((part) => part.split("-").map(Number)).map(([start, end]) => ({ start, end })) : []);

async function verifyCut(args) {
  const file = path.resolve(args.cut);
  const rung = args.rung;
  const comp = args.comp;
  const size = rung === "avc30" ? AVC30_SIZES[comp] : COMP_SIZES[comp];
  if (!size) throw new Error("--comp must be a composition");
  const frames = FILM_FRAMES[args.film];
  const expect = rung === "avc30"
    ? { codec: "h264", profile: "High", width: size.width, height: size.height, fps: 30, frames: frames ? frames / 2 : null, maxLevel: LEVELS.h264["4.2"] }
    : { codec: "hevc", profile: "Main", width: size.width, height: size.height, fps: 60, frames, maxLevel: LEVELS.hevc["4.1"] };
  const { out } = await capture(FFPROBE, ["-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", file]);
  const actualSha256 = sha256(file);
  const problems = probeProblems(JSON.parse(out), { ...expect, sha256: args.sha256 === true ? null : args.sha256 ?? null, actualSha256 });
  const boxes = topLevelBoxes(headBytes(file));
  if (!moovFirst(boxes)) problems.push(`moov is not before mdat (boxes: ${boxes.join(", ")})`);
  const detect = await capture(FFMPEG, ["-hide_banner", "-nostats", "-i", file, "-vf", "freezedetect=n=0.0005:d=0.25,blackdetect=d=0.2:pix_th=0.04", "-an", "-f", "null", "-"]);
  const { freezes, blacks } = parseDetect(detect.err);
  // The authored holds: the brand tail (from the last stage) is a deliberate still; callers pass the fades.
  const allowed = ranges(args.fades);
  const strayFreezes = unexpectedIntervals(freezes, allowed);
  const strayBlacks = unexpectedIntervals(blacks, allowed);
  if (strayFreezes.length) problems.push(`frozen frames outside the authored holds: ${JSON.stringify(strayFreezes)}`);
  if (strayBlacks.length) problems.push(`black frames outside the authored fades: ${JSON.stringify(strayBlacks)}`);
  return { file, rung, comp, sha256: actualSha256, boxes, freezes, blacks, problems };
}

async function verifyMix(args) {
  const file = path.resolve(args.mix);
  const probe = JSON.parse((await capture(FFPROBE, ["-v", "error", "-show_format", "-of", "json", file])).out);
  const duration = Number(probe.format.duration);
  const { err } = await capture(FFMPEG, ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"]);
  const loudness = parseEbur128(err);
  return { file, duration, loudness, problems: mixProblems(loudness, { duration, expected: Number(args.duration), sting: args.sting === true }) };
}

const toCommon = (matrix) => `scale=in_color_matrix=${matrix}:in_range=tv:out_color_matrix=bt709:out_range=tv,format=yuv420p`;

async function compare(args) {
  const frames = args.frames ? ["-frames:v", String(args.frames)] : [];
  const filter = `[0:v]${toCommon(args["a-matrix"] ?? "bt709")},settb=AVTB,setpts=N/60/TB[a];[1:v]${toCommon(args["b-matrix"] ?? "bt709")},settb=AVTB,setpts=N/60/TB[b];[a]split[a1][a2];[b]split[b1][b2];[a1][b1]ssim[s];[a2][b2]psnr[p]`;
  const { err } = await capture(FFMPEG, ["-hide_banner", "-nostats", "-i", path.resolve(args.compare), "-i", path.resolve(args.against), "-filter_complex", filter, "-map", "[s]", ...frames, "-f", "null", "-", "-map", "[p]", ...frames, "-f", "null", "-"]);
  const measured = parseSsimPsnr(err);
  return { a: args.compare, b: args.against, ...measured, problems: [] };
}

async function frameAt(file, index, out) {
  await capture(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-i", file, "-vf", `select=eq(n\\,${index})`, "-frames:v", "1", "-c:v", "ffv1", out]);
}

async function determinism(args) {
  const pick = String(args.pick).split(",").map(Number);
  const scratch = path.dirname(path.resolve(args.determinism));
  const values = [];
  for (let k = 0; k < pick.length; k += 1) {
    const a = path.join(scratch, `det-a-${k}.mkv`);
    const b = path.join(scratch, `det-b-${k}.mkv`);
    await frameAt(path.resolve(args.against), pick[k], a);
    await frameAt(path.resolve(args.determinism), k, b);
    const { err } = await capture(FFMPEG, ["-hide_banner", "-nostats", "-i", a, "-i", b, "-lavfi", "psnr", "-f", "null", "-"]);
    values.push(parseSsimPsnr(err).psnr);
  }
  const problems = values.flatMap((value, k) => (value === null || value < 55 ? [`frame ${pick[k]}: ${value} dB`] : []));
  return { frames: pick, psnr: values, min: Math.min(...values), problems };
}

async function contact(args) {
  const comp = args.comp;
  const size = COMP_SIZES[comp];
  const available = args.available ? String(args.available).split(",") : undefined;
  const box = protectedBox(comp, available);
  const fps = Number(args.fps ?? 2);
  const thumbWidth = comp === "phone" || comp === "tablet-p" ? 240 : 400;
  const scale = thumbWidth / size.width;
  const out = path.resolve(args.out ?? `${args.contact}.contact.jpg`);
  const draw = `drawbox=x=${Math.round(box.x0 * size.width)}:y=${Math.round(box.y0 * size.height)}:w=${Math.round((box.x1 - box.x0) * size.width)}:h=${Math.round((box.y1 - box.y0) * size.height)}:color=yellow@0.8:t=4`;
  const filter = `fps=${fps},scale=in_color_matrix=bt709:in_range=tv,format=rgb24,${draw},scale=${thumbWidth}:${Math.round(size.height * scale)}:flags=lanczos,drawtext=text='%{pts\\:hms}':x=6:y=6:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.5,tile=6x5:padding=4`;
  await capture(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-i", path.resolve(args.contact), "-vf", filter, "-frames:v", "8", "-q:v", "4", out.replace(/\.jpg$/, "-%02d.jpg")]);
  return { out: out.replace(/\.jpg$/, "-NN.jpg"), protectedBox: box, problems: [] };
}

async function framing(args) {
  // A lab session like render.mjs's, under the lane.
  const render = await import(pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "render.mjs")).href);
  const available = args.available ? String(args.available).split(",") : undefined;
  const zones = args.zones ? JSON.parse(readFileSync(path.resolve(args.zones), "utf8")) : [];
  return render.withLabSession({ theme: args.theme ?? "dark", label: `framing ${args.film} ${args.comp}` }, async ({ page }) => {
    const size = COMP_SIZES[args.comp];
    const loaded = await page.evaluate((input) => window.__fitxLab.load(input), { film: args.film, comp: args.comp, theme: args.theme ?? "dark", width: size.width, height: size.height, ss: 1, sink: null });
    const failures = [];
    let checked = 0;
    let withoutSubjects = new Set();
    for (const index of framingFrames(loaded.film)) {
      const time = Math.min(loaded.film.duration, index / 60);
      const projected = await page.evaluate((t) => window.__fitxLab.project(t), time);
      if (!projected.subjects) {
        withoutSubjects.add(projected.shot);
        continue;
      }
      const subjects = projected.subjects.map((subject) => ({ id: subject.id, must: subject.must, box: boxFromNdc(subject.ndc) }));
      const active = zones.filter((zone) => (zone.comp ?? args.comp) === args.comp && time >= (zone.start ?? 0) && time < (zone.end ?? Infinity));
      checked += 1;
      for (const failure of framingFailures({ comp: args.comp, available, subjects, zones: active })) failures.push({ frame: index, shot: projected.shot, ...failure });
    }
    withoutSubjects = [...withoutSubjects];
    return {
      film: args.film, comp: args.comp, checked, shotsWithoutSubjects: withoutSubjects, failures,
      problems: [...failures.map((failure) => `frame ${failure.frame} ${failure.shot} ${failure.id}: ${failure.problem}`), ...(withoutSubjects.length ? [`no subjects() yet for ${withoutSubjects.join(", ")}`] : [])],
    };
  });
}

async function main() {
  const args = parse(process.argv.slice(2));
  let result;
  if (args.cut) result = await verifyCut(args);
  else if (args.mix) result = await verifyMix(args);
  else if (args.compare) result = await compare(args);
  else if (args.determinism) result = await determinism(args);
  else if (args.contact) result = await contact(args);
  else if (args.framing) {
    if (process.env.FITX_LANE_INNER !== "1") {
      const render = await import(pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "render.mjs")).href);
      process.exitCode = await render.relaunchInLane({ kind: "verify:framing", label: `framing ${args.film} ${args.comp}`, script: fileURLToPath(import.meta.url) });
      return;
    }
    result = await framing(args);
  }
  else if (args["gate-a"]) {
    const input = JSON.parse(readFileSync(path.resolve(args["gate-a"]), "utf8"));
    result = { ...gateA(input), problems: [] };
  } else throw new Error("choose a mode: --cut, --mix, --compare, --determinism, --contact, --framing or --gate-a");
  if (args.json && args.json !== true) writeFileSync(path.resolve(args.json), JSON.stringify(result, null, 2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.problems?.length) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`[verify] ${error.message}\n`);
    process.exit(1);
  });
}
