#!/usr/bin/env node
// Renders a film job through the committed lab (/lab/film) into FFV1 masters, outside the repo.
// Usage (always through heavy.sh, which this gives back while it waits for the browser lane):
//   heavy.sh node scripts/brand/films/render.mjs --job=intro --comp=laptop --theme=dark [--frames=0-714] [--shots=a,b]
//     [--step=30] [--ss=1] [--subframes=1] [--rev=<id>] [--out=<dir>] [--headed] [--port=3790]
//   heavy.sh node scripts/brand/films/render.mjs --preflight
// See scripts/brand/films/README.md (preconditions, the lane, outputs, resuming).
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, appendFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { HEAVY, WORKTREES, laneHandle, withLane } from "./lane.mjs";
import { COMP_SIZES, JOBS, framePlan, parseArgs, readSources, reelPlan, renderArgsForRev, revHash, segmentsOf } from "./lib/plan.mjs";
import { CHROME, CWEBP, FFMPEG, PLAYWRIGHT_CORE, preflightProblems, runPreflight, SOFTWARE_RENDERER } from "./lib/preflight.mjs";
import { ENCODER } from "./lib/encoders.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
export const RENDERS = path.join(WORKTREES, ".alteration/renders");

const log = (line) => process.stderr.write(`[render] ${line}\n`);

function chromeArgs(headed) {
  return [
    "--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--autoplay-policy=no-user-gesture-required",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE *.localhost, EXCLUDE 127.0.0.1",
    ...(headed ? ["--window-position=0,0"] : []),
  ];
}

async function loadPlaywright() {
  const { loadPlaywright: load } = await import(pathToFileURL(path.join(ROOT, "tests/e2e/support/browser.mjs")).href);
  process.env.E2E_PLAYWRIGHT_CORE ??= PLAYWRIGHT_CORE;
  return load();
}

/** Peak resident memory of this job's processes (node, next dev, Chrome, ffmpeg), sampled every 2 s. */
function memorySampler(rootPid) {
  let peak = 0;
  const sample = () => {
    try {
      const child = spawn("/bin/ps", ["-axo", "pid=,ppid=,rss="], { stdio: ["ignore", "pipe", "ignore"] });
      let out = "";
      child.stdout.on("data", (chunk) => (out += chunk));
      child.on("close", () => {
        const rows = out.trim().split("\n").map((line) => line.trim().split(/\s+/).map(Number));
        const children = new Map();
        for (const [pid, ppid] of rows) children.set(ppid, [...(children.get(ppid) ?? []), pid]);
        const rss = new Map(rows.map(([pid, , kb]) => [pid, kb]));
        let total = 0;
        const stack = [rootPid];
        const seen = new Set();
        while (stack.length) {
          const pid = stack.pop();
          if (seen.has(pid)) continue;
          seen.add(pid);
          total += rss.get(pid) ?? 0;
          stack.push(...(children.get(pid) ?? []));
        }
        peak = Math.max(peak, total * 1024);
      });
    } catch {
      // ps missing: no memory figure.
    }
  };
  sample();
  const timer = setInterval(sample, 2000);
  timer.unref();
  return { stop: () => clearInterval(timer), get peak() { return peak; } };
}

/** `next dev` with the lab on, on 127.0.0.1 (the browser uses fitx-lab.localhost, which Next allows by default). */
async function startDev(port) {
  const env = { ...process.env, FITX_LAB: "1", NEXT_TELEMETRY_DISABLED: "1", NODE_ENV: "development" };
  delete env.FITX_LANE_INNER;
  const child = spawn(path.join(ROOT, "node_modules/.bin/next"), ["dev", "-p", String(port), "-H", "127.0.0.1"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], detached: false });
  let output = "";
  child.stdout.on("data", (chunk) => (output = (output + chunk).slice(-8000)));
  child.stderr.on("data", (chunk) => (output = (output + chunk).slice(-8000)));
  const url = `http://127.0.0.1:${port}/lab/film`;
  const deadline = Date.now() + 240_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`next dev exited (${child.exitCode}):\n${output}`);
    try {
      const response = await fetch(url, { headers: { host: `fitx-lab.localhost:${port}` } });
      if (response.status === 200) break;
      if (response.status === 404) throw new Error("the lab answered 404: is FITX_LAB=1 reaching next dev?");
    } catch (error) {
      if (String(error.message).includes("404")) throw error;
    }
    if (Date.now() > deadline) throw new Error(`next dev did not serve the lab within 4 minutes:\n${output}`);
    await new Promise((done) => setTimeout(done, 1500));
  }
  return { child, stop: () => new Promise((done) => { if (child.exitCode !== null) return done(); child.once("exit", done); child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 5000).unref(); }) };
}

/** The 127.0.0.1 sink the lab POSTs raw frames to; each frame goes straight into the current ffmpeg's stdin. */
function startSink() {
  let target = null;
  let received = 0;
  const server = createServer((request, response) => {
    const headers = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST", "access-control-allow-headers": "*" };
    if (request.method === "OPTIONS") return response.writeHead(204, headers).end();
    if (request.method !== "POST" || !request.url.startsWith("/frame") || !target) {
      request.resume();
      return response.writeHead(409, headers).end();
    }
    let bytes = 0;
    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (!target.write(chunk)) {
        request.pause();
        target.once("drain", () => request.resume());
      }
    });
    request.on("end", () => {
      received += 1;
      response.writeHead(204, { ...headers, "x-bytes": String(bytes) }).end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        setTarget(stream) {
          target = stream;
        },
        get received() {
          return received;
        },
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function segmentFilter({ width, height, outWidth, outHeight, subframes, flip }) {
  const parts = [];
  if (flip) parts.push("vflip");
  if (subframes > 1) parts.push(`tmix=frames=${subframes}`, `select='eq(mod(n\\,${subframes})\\,${subframes - 1})'`, "setpts=N/FRAME_RATE/TB");
  parts.push(`scale=${outWidth}:${outHeight}:flags=lanczos:out_color_matrix=bt709:out_range=tv`, "format=yuv444p10le", "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv");
  void width;
  void height;
  return parts.join(",");
}

/** One ffmpeg reading raw RGBA (or PNG screenshots) on stdin into an FFV1 segment. */
function startSegmentEncoder({ file, width, height, outWidth, outHeight, fps, subframes, mode }) {
  const input = mode === "png"
    ? ["-f", "image2pipe", "-c:v", "png", "-framerate", String(fps * subframes), "-i", "-"]
    : ["-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${width}x${height}`, "-framerate", String(fps * subframes), "-i", "-"];
  const args = [
    "-hide_banner", "-loglevel", "error", "-y", ...input,
    "-vf", segmentFilter({ width, height, outWidth, outHeight, subframes, flip: mode !== "png" }),
    "-r", String(fps), "-c:v", "ffv1", "-level", "3", "-g", "1", "-slices", "4", "-slicecrc", "1",
    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv", file,
  ];
  const child = spawn(FFMPEG, args, { stdio: ["pipe", "ignore", "pipe"] });
  let errors = "";
  child.stderr.on("data", (chunk) => (errors = (errors + chunk).slice(-4000)));
  const done = new Promise((resolve, reject) => child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${errors}`)))));
  return { stdin: child.stdin, done, end: () => { child.stdin.end(); return done; } };
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err = (err + chunk).slice(-8000)));
    child.on("close", (code) => (code === 0 ? resolve({ out, err }) : reject(new Error(`ffmpeg ${code}: ${err}`))));
  });
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(command)} ${code}: ${err}`))));
  });
}

async function openLab(playwright, { port, headed, theme }) {
  const browser = await playwright.chromium.launch({ executablePath: CHROME, headless: !headed, args: chromeArgs(headed) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: theme, bypassCSP: true, serviceWorkers: "block" });
  const page = await context.newPage();
  const consoleLines = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") consoleLines.push(`${message.type()}: ${message.text()}`.slice(0, 400));
  });
  page.on("pageerror", (error) => consoleLines.push(`pageerror: ${String(error).slice(0, 400)}`));
  await page.goto(`http://fitx-lab.localhost:${port}/lab/film`, { waitUntil: "load", timeout: 240_000 });
  await page.waitForFunction(() => Boolean(window.__fitxLab), null, { timeout: 120_000 });
  return { browser, context, page, consoleLines };
}

/** The GPU renderer string from a blank page (preflight without next dev). */
async function gpuString(playwright, headed) {
  const browser = await playwright.chromium.launch({ executablePath: CHROME, headless: !headed, args: chromeArgs(headed) });
  try {
    const page = await browser.newPage();
    return await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      if (!gl) return null;
      const debug = gl.getExtension("WEBGL_debug_renderer_info");
      return String(debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    });
  } finally {
    await browser.close();
  }
}

function jobLog(dir) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "job.log");
  return (entry) => appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

/** Removes the masters of other compositions of this rev that encode.mjs has finished with (one composition on disk). */
function pruneEncodedMasters(revDir, keep) {
  if (!existsSync(revDir)) return;
  for (const name of readdirSync(revDir)) {
    const dir = path.join(revDir, name);
    if (name === keep || !statSync(dir).isDirectory() || !existsSync(path.join(dir, "encoded.json"))) continue;
    for (const file of ["master.mkv"]) rmSync(path.join(dir, file), { force: true });
    rmSync(path.join(dir, "segments"), { recursive: true, force: true });
  }
}

async function renderFilm({ request, page, sink, lane, rev, logEntry, compDir, comp, theme }) {
  const size = COMP_SIZES[comp];
  const loaded = await page.evaluate((args) => window.__fitxLab.load(args), { film: request.film, comp, theme, width: size.width, height: size.height, ss: request.ss, sink: sink.url });
  logEntry({ event: "loaded", comp, theme, renderer: loaded.renderer, vendor: loaded.vendor, quality: loaded.quality, width: loaded.width, height: loaded.height });
  if (SOFTWARE_RENDERER.test(loaded.renderer)) throw new Error(`software renderer ${loaded.renderer}: rerun with --headed`);
  const fps = JOBS[request.job].fps;
  const plan = framePlan(loaded.film, { fps, frames: request.frames, pick: request.pick, shots: request.shots, step: request.step, subframes: request.subframes });
  const segments = segmentsOf(plan);
  const segDir = path.join(compDir, "segments");
  mkdirSync(segDir, { recursive: true });
  const stats = { frames: 0, samples: 0, renderMs: 0, grabMs: 0, wallMs: 0, skipped: 0 };
  const warmed = new Set();
  for (const segment of segments) {
    const file = path.join(segDir, `${segment.name}.mkv`);
    const marker = `${file}.json`;
    const want = { frames: segment.frames.map((frame) => frame.index), subs: request.subframes, ss: request.ss, rev };
    if (existsSync(file) && existsSync(marker)) {
      try {
        if (JSON.stringify(JSON.parse(readFileSync(marker, "utf8")).want) === JSON.stringify(want)) {
          stats.skipped += segment.frames.length;
          continue;
        }
      } catch {
        // A broken marker: render the segment again.
      }
    }
    if (!warmed.has(segment.shot)) {
      // One warm-up seek per shot: shader variants and the shot's first-use buffers settle before frames count.
      await page.evaluate((time) => window.__fitxLab.seek(time), segment.frames[0].time);
      warmed.add(segment.shot);
    }
    const part = `${file}.part.mkv`;
    const encoder = startSegmentEncoder({ file: part, width: loaded.width, height: loaded.height, outWidth: size.width, outHeight: size.height, fps, subframes: request.subframes, mode: "raw" });
    sink.setTarget(encoder.stdin);
    const started = Date.now();
    for (const frame of segment.frames) {
      for (const time of frame.subs) {
        const result = await page.evaluate((t) => window.__fitxLab.frame(t), time);
        stats.renderMs += result.renderMs;
        stats.grabMs += result.grabMs;
        stats.samples += 1;
      }
      stats.frames += 1;
    }
    sink.setTarget(null);
    await encoder.end();
    stats.wallMs += Date.now() - started;
    renameSync(part, file);
    writeFileSync(marker, JSON.stringify({ want, at: new Date().toISOString() }));
    lane.touch();
    logEntry({ event: "segment", name: segment.name, frames: segment.frames.length, seconds: (Date.now() - started) / 1000 });
    log(`${comp}-${theme} ${segment.name}: ${segment.frames.length} frames, ${((Date.now() - started) / 1000 / segment.frames.length).toFixed(3)} s/frame`);
  }
  // The master: every segment in order, losslessly joined.
  const list = path.join(compDir, "segments.txt");
  writeFileSync(list, segments.map((segment) => `file '${path.join(segDir, `${segment.name}.mkv`).replace(/'/g, "'\\''")}'`).join("\n") + "\n");
  const master = path.join(compDir, "master.mkv");
  await runFfmpeg(["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", master]);
  await runFfmpeg(["-hide_banner", "-loglevel", "error", "-y", "-i", master, "-f", "framemd5", path.join(compDir, "master.framemd5")]);
  lane.touch();
  return { loaded, plan: { frames: plan.length, first: plan[0]?.index ?? null, last: plan[plan.length - 1]?.index ?? null }, stats, master };
}

async function renderReel({ request, page, sink, lane, logEntry, compDir, shape, theme }) {
  const def = JOBS["landing-reel"];
  const spec = def.shapes[shape];
  const loaded = await page.evaluate((args) => window.__fitxLab.load(args), { film: def.film, comp: spec.comp, theme, width: spec.width, height: spec.height, ss: request.ss, sink: sink.url });
  logEntry({ event: "loaded", shape, theme, renderer: loaded.renderer, width: loaded.width, height: loaded.height });
  const frames = reelPlan(def);
  mkdirSync(compDir, { recursive: true });
  const master = path.join(compDir, "master.mkv");
  const part = `${master}.part.mkv`;
  await page.evaluate((time) => window.__fitxLab.seek(time), frames[0].time);
  const encoder = startSegmentEncoder({ file: part, width: loaded.width, height: loaded.height, outWidth: spec.width, outHeight: spec.height, fps: def.fps, subframes: 1, mode: "raw" });
  sink.setTarget(encoder.stdin);
  const started = Date.now();
  for (const frame of frames) {
    await page.evaluate((t) => window.__fitxLab.frame(t), frame.time);
    if (frame.index % 60 === 0) lane.touch();
  }
  sink.setTarget(null);
  await encoder.end();
  renameSync(part, master);
  // The stills at their own (larger) sizes, rendered directly at that size.
  for (const [name, still] of Object.entries(def.stills)) {
    if (still.shape !== shape) continue;
    const stillLoaded = await page.evaluate((args) => window.__fitxLab.load(args), { film: def.film, comp: spec.comp, theme, width: still.width, height: still.height, ss: 1, sink: sink.url });
    const png = path.join(compDir, `${name}-${theme}.png`);
    const raw = path.join(compDir, `${name}.part.mkv`);
    const stillEncoder = startSegmentEncoder({ file: raw, width: stillLoaded.width, height: stillLoaded.height, outWidth: still.width, outHeight: still.height, fps: 1, subframes: 1, mode: "raw" });
    sink.setTarget(stillEncoder.stdin);
    await page.evaluate((t) => window.__fitxLab.seek(t), still.time);
    await page.evaluate((t) => window.__fitxLab.frame(t), still.time);
    sink.setTarget(null);
    await stillEncoder.end();
    await runFfmpeg(["-hide_banner", "-loglevel", "error", "-y", "-i", raw, "-frames:v", "1", "-vf", "scale=in_color_matrix=bt709:in_range=tv,format=rgb24", png]);
    rmSync(raw, { force: true });
    await run(CWEBP, ["-quiet", "-q", String(ENCODER.poster.quality), "-m", "6", "-sharp_yuv", png, "-o", path.join(compDir, still.file.replace("{theme}", theme))]);
  }
  lane.touch();
  logEntry({ event: "reel", shape, theme, frames: frames.length, seconds: (Date.now() - started) / 1000 });
  return { master, frames: frames.length };
}

async function renderLoginStills({ request, playwright, port, logEntry, outDir, theme }) {
  const def = JOBS["login-stills"];
  const browser = await playwright.chromium.launch({ executablePath: CHROME, headless: !request.headed, args: chromeArgs(request.headed) });
  const results = [];
  try {
    for (const name of request.comps) {
      const frame = def.frames[name];
      const context = await browser.newContext({ viewport: { width: Math.max(frame.width, 1100), height: Math.max(frame.height, 900) }, deviceScaleFactor: 1, colorScheme: theme, bypassCSP: true, serviceWorkers: "block" });
      await context.addInitScript(() => {
        try {
          window.localStorage.setItem("fitx-cookie-consent", "essential");
        } catch {
          // storage blocked
        }
      });
      const page = await context.newPage();
      await page.goto(`http://fitx-lab.localhost:${port}${def.page}`, { waitUntil: "load", timeout: 240_000 });
      await page.waitForFunction(() => Boolean(window.__fitxLoginScene), null, { timeout: 120_000 });
      // Pin the scene's host to the still's exact size, then render the still's moment and read it in the same task.
      const dataUrl = await page.evaluate(async ({ width, height, seconds }) => {
        const scene = window.__fitxLoginScene;
        const canvas = document.querySelector("canvas");
        const host = canvas?.parentElement;
        if (!scene || !canvas || !host) throw new Error("no sign-in scene on the page");
        Object.assign(host.style, { position: "fixed", left: "0px", top: "0px", width: `${width}px`, height: `${height}px`, zIndex: "2147483647" });
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        for (let tries = 0; tries < 50 && !scene.freeze(seconds); tries += 1) await new Promise((done) => setTimeout(done, 200));
        if (!scene.freeze(seconds)) throw new Error("the sign-in scene never became ready");
        return canvas.toDataURL("image/png");
      }, { width: frame.width, height: frame.height, seconds: def.seconds });
      const png = path.join(outDir, `still-${theme}-${name}.png`);
      writeFileSync(png, Buffer.from(dataUrl.split(",")[1], "base64"));
      const webp = path.join(outDir, `still-${theme}-${name}.webp`);
      await run(CWEBP, ["-quiet", "-q", "80", "-m", "6", "-sharp_yuv", "-resize", String(frame.width), String(frame.height), png, "-o", webp]);
      results.push({ name, theme, webp, bytes: statSync(webp).size });
      logEntry({ event: "still", name, theme, bytes: statSync(webp).size });
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return results;
}

async function inner(request) {
  const started = Date.now();
  const sources = readSources(ROOT);
  const rev = request.rev ?? revHash({ files: sources, args: renderArgsForRev(request), encoder: ENCODER }).slice(0, 8);
  const revDir = request.out ? path.resolve(request.out) : path.join(RENDERS, request.job, rev);
  mkdirSync(revDir, { recursive: true });
  const logEntry = jobLog(revDir);
  const report = runPreflight(revDir);
  const playwright = await loadPlaywright();
  report.gpu = await gpuString(playwright, request.headed);
  logEntry({ event: "preflight", report });
  const problems = preflightProblems(report);
  if (problems.length) throw new Error(`preflight failed:\n- ${problems.join("\n- ")}`);
  log(`preflight ok: ffmpeg ${report.ffmpeg.version}, GPU ${report.gpu}, ${(report.freeBytes / 1024 ** 3).toFixed(0)} GB free`);
  if (request.preflight) return { preflight: report };

  const lane = laneHandle({ dir: process.env.FITX_LANE_LOCK, pid: Number(process.env.FITX_LANE_PID) });
  const memory = memorySampler(process.pid);
  const dev = await startDev(request.port);
  const sink = await startSink();
  const results = [];
  let lab = null;
  try {
    lane.touch();
    if (request.kind === "stills") {
      for (const theme of request.themes) results.push(...(await renderLoginStills({ request, playwright, port: request.port, logEntry, outDir: revDir, theme })));
    } else {
      for (const theme of request.themes) {
        lab = await openLab(playwright, { port: request.port, headed: request.headed, theme });
        try {
          for (const comp of request.comps) {
            const compDir = path.join(revDir, `${comp}-${theme}`);
            pruneEncodedMasters(revDir, `${comp}-${theme}`);
            const t0 = Date.now();
            const result = request.kind === "reel"
              ? await renderReel({ request, page: lab.page, sink, lane, logEntry, compDir, shape: comp, theme })
              : await renderFilm({ request, page: lab.page, sink, lane, rev, logEntry, compDir, comp, theme });
            const seconds = (Date.now() - t0) / 1000;
            const frames = result.stats?.frames ?? result.frames;
            results.push({ comp, theme, ...result, seconds, secondsPerFrame: frames ? seconds / frames : null });
            writeFileSync(path.join(compDir, "render.json"), JSON.stringify({ rev, request, result, seconds, gpu: report.gpu, console: lab.consoleLines.slice(-20) }, null, 2));
          }
        } finally {
          await lab.browser.close();
          lab = null;
        }
      }
    }
  } finally {
    await sink.close();
    await dev.stop();
    memory.stop();
  }
  const summary = { rev, dir: revDir, job: request.job, gpu: report.gpu, ffmpeg: report.ffmpeg.version, seconds: (Date.now() - started) / 1000, peakMemoryBytes: memory.peak, results };
  writeFileSync(path.join(revDir, `summary-${request.label ?? request.job}.json`), JSON.stringify(summary, null, 2));
  logEntry({ event: "done", summary: { ...summary, results: results.length } });
  log(`done in ${summary.seconds.toFixed(0)} s, peak memory ${(memory.peak / 1024 ** 3).toFixed(2)} GB, out ${revDir}`);
  return summary;
}

/**
 * The outer half of a lane job: give the heavy slot back, wait for the lane, then run this same script again (with
 * the same arguments) under a fresh heavy.sh slot, as the inner half (FITX_LANE_INNER=1), touching the lock for it.
 * Resolves with the inner run's exit code.
 */
export function relaunchInLane({ kind, label, script, argv = process.argv.slice(2) }) {
  return withLane({ kind, label }, (lane) => new Promise((resolve) => {
    const env = { ...process.env, FITX_LANE_INNER: "1", FITX_LANE_LOCK: lane.dir, FITX_LANE_PID: String(process.pid) };
    delete env.FITX_HEAVY_SLOT;
    const child = spawn("/bin/zsh", [HEAVY, process.execPath, script, ...argv], { stdio: "inherit", env });
    const forward = (signal) => child.kill(signal);
    process.on("SIGINT", forward);
    process.on("SIGTERM", forward);
    child.on("close", (code) => resolve(code ?? 1));
  }));
}

/** Inner half only: `next dev` with the lab, one Chrome on the lab page, then `fn({ page })`, then cleanup. */
export async function withLabSession({ theme = "dark", port = 3790, headed = false }, fn) {
  if (process.env.FITX_LANE_INNER !== "1") throw new Error("withLabSession runs only inside a lane job (relaunchInLane)");
  const lane = laneHandle({ dir: process.env.FITX_LANE_LOCK, pid: Number(process.env.FITX_LANE_PID) });
  const playwright = await loadPlaywright();
  const dev = await startDev(port);
  let lab = null;
  try {
    lane.touch();
    lab = await openLab(playwright, { port, headed, theme });
    return await fn({ page: lab.page, lane });
  } finally {
    await lab?.browser.close();
    await dev.stop();
    lane.touch();
  }
}

async function main() {
  const request = parseArgs(process.argv.slice(2));
  if (process.env.FITX_LANE_INNER === "1") {
    const summary = await inner(request);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    return;
  }
  const code = await relaunchInLane({
    kind: request.preflight ? "preflight" : `render:${request.job}`,
    label: request.label ?? `${request.job} ${request.comps.join(",")} ${request.themes.join(",")}`,
    script: fileURLToPath(import.meta.url),
  });
  if (code !== 0) throw new Error(`the render job exited with ${code}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    log(error.message);
    process.exit(1);
  });
}
