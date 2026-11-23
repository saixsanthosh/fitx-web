#!/usr/bin/env node
// The pose check (wave 2, brief 3.5): MediaPipe PoseLandmarker in IMAGE mode, with the bundled
// pose_landmarker_full.task and wasm-0.10.35 (public/models/pose), in headless system Chrome, in the browser lane.
// It only filters (compare.mjs); the eye check on the contact sheet is the gate.
//
//   node scripts/media/pose-check/run.mjs --pairs=<pairs.json> --out=<results.json>
//   node scripts/media/pose-check/run.mjs --self-test --out=<results.json>     (repo images only; checks the harness)
//
// pairs.json: [{ "id": "push_up/male", "focus": "upper" | "lower" | "full", "reference": [start, end], "candidate": [start, end] }]
// with image file paths. Nothing leaves this machine: Chrome resolves only 127.0.0.1, and the page loads only the
// files this script serves. Run it through heavy.sh: it gives that slot back while it waits for the lane, then runs
// Chrome under a fresh slot of its own.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { comparePair } from "./compare.mjs";
import { acquireLane } from "./lane.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const HEAVY = "/Users/alphinshaju/Documents/all files/Fitx/worktrees/heavy.sh";
const PLAYWRIGHT = "/Users/alphinshaju/Documents/all files/Fitx/worktrees/.redesign/tools/node_modules/playwright-core/index.mjs";
const CHROME = process.env.E2E_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TYPES = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm", ".task": "application/octet-stream", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

/** Repo images with known answers: the same pair passes, another movement fails, a symmetric mirror image passes. */
export function selfTestPairs(mirrorDir) {
  const jj = ["public/media/form-check/jumping-jack-closed.webp", "public/media/form-check/jumping-jack-open.webp"].map((file) => path.join(ROOT, file));
  const squat = ["public/media/form-check/squat-start.webp", "public/media/home-workout-1/squat.webp"].map((file) => path.join(ROOT, file));
  return [
    { id: "jumping-jack, same photos", focus: "full", reference: jj, candidate: jj, expect: ["pass", "needs-eye"] },
    { id: "squat, same photos", focus: "lower", reference: squat, candidate: squat, expect: ["pass", "needs-eye"] },
    { id: "jumping-jack against squat", focus: "full", reference: jj, candidate: squat, expect: ["fail"] },
    // A symmetric pose and its mirror image are the same pose: the swap rule must not fire on it (asymmetric swaps
    // are covered by compare.test.mjs).
    { id: "jumping-jack against its mirror image", focus: "full", reference: jj, candidate: jj.map((_, frame) => path.join(mirrorDir, `jj-${frame}.png`)), expect: ["pass"], mirror: jj },
  ];
}

function serve(images) {
  const files = new Map([
    ["/page.html", path.join(HERE, "page.html")],
    ["/vendor/vision_bundle.mjs", path.join(ROOT, "node_modules/@mediapipe/tasks-vision/vision_bundle.mjs")],
    ["/wasm/vision_wasm_internal.js", path.join(ROOT, "public/models/pose/wasm-0.10.35/vision_wasm_internal.js")],
    ["/wasm/vision_wasm_internal.wasm", path.join(ROOT, "public/models/pose/wasm-0.10.35/vision_wasm_internal.wasm")],
    ["/model/pose_landmarker_full.task", path.join(ROOT, "public/models/pose/landmarker-float16-v1/pose_landmarker_full.task")],
  ]);
  images.forEach((file, index) => files.set(`/img/${index}${path.extname(file)}`, file));
  const server = http.createServer((request, response) => {
    const file = files.get(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
    if (!file || !existsSync(file)) { response.writeHead(404).end(); return; }
    response.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    response.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function detectAll(pairs) {
  const images = [...new Set(pairs.flatMap((pair) => [...pair.reference, ...pair.candidate]))];
  const server = await serve(images);
  const host = `127.0.0.1:${server.address().port}`;
  process.env.E2E_PLAYWRIGHT_CORE ??= PLAYWRIGHT;
  const { launchChrome, loadPlaywright } = await import(pathToFileURL(path.join(ROOT, "tests/e2e/support/browser.mjs")).href);
  const browser = await launchChrome(await loadPlaywright(), { executablePath: CHROME, appHost: host, dbHost: host });
  const landmarks = new Map();
  try {
    const page = await browser.newPage();
    await page.route("**/*", (route) => (new URL(route.request().url()).host === host ? route.continue() : route.abort("internetdisconnected")));
    await page.goto(`http://${host}/page.html`);
    await page.waitForFunction(() => window.poseReady === true, null, { timeout: 120000 });
    for (const [index, file] of images.entries()) {
      landmarks.set(file, await page.evaluate((url) => window.detectPose(url), `/img/${index}${path.extname(file)}`));
    }
  } finally {
    await browser.close();
    server.close();
  }
  return landmarks;
}

async function inner(args) {
  let pairs;
  if (args.selfTest) {
    const mirrorDir = path.join(path.dirname(args.out), "pose-mirror");
    mkdirSync(mirrorDir, { recursive: true });
    pairs = selfTestPairs(mirrorDir);
    const sharp = (await import("sharp")).default;
    for (const pair of pairs.filter((item) => item.mirror)) {
      for (const [frame, file] of pair.mirror.entries()) await sharp(file).flop().png().toFile(pair.candidate[frame]);
    }
  } else {
    pairs = JSON.parse(readFileSync(args.pairs, "utf8"));
  }
  const started = Date.now();
  const landmarks = await detectAll(pairs);
  const results = pairs.map((pair) => {
    const result = comparePair({ reference: pair.reference.map((file) => landmarks.get(file)), candidate: pair.candidate.map((file) => landmarks.get(file)), focus: pair.focus ?? "full" });
    return { id: pair.id, focus: pair.focus ?? "full", ...result, ...(pair.expect ? { expected: pair.expect, asExpected: pair.expect.includes(result.verdict) } : {}) };
  });
  mkdirSync(path.dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify({ at: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 100) / 10, results }, null, 1)}\n`);
  for (const result of results) console.log(`[pose-check] ${result.id}: ${result.verdict}${result.asExpected === false ? " (NOT as expected)" : ""}${result.reasons.length ? ` (${result.reasons.slice(0, 3).join("; ")})` : ""}`);
  if (results.some((result) => result.asExpected === false)) process.exitCode = 1;
}

function parse(argv) {
  const args = { pairs: null, out: null, selfTest: false, inner: false };
  for (const arg of argv) {
    if (arg === "--self-test") args.selfTest = true;
    else if (arg === "--inner") args.inner = true;
    else if (arg.startsWith("--pairs=")) args.pairs = path.resolve(arg.slice(8));
    else if (arg.startsWith("--out=")) args.out = path.resolve(arg.slice(6));
    else throw new Error(`Unknown argument ${arg}`);
  }
  if (!args.out || (!args.pairs && !args.selfTest)) throw new Error("Pass --out=<results.json> and --pairs=<pairs.json> or --self-test");
  return args;
}

async function main(argv) {
  const args = parse(argv);
  if (args.inner) return inner(args);
  const release = await acquireLane({ job: { kind: "pose-check", label: args.selfTest ? "self-test" : path.basename(args.pairs) } });
  try {
    const code = await new Promise((resolve) => {
      const child = spawn(HEAVY, [process.execPath, fileURLToPath(import.meta.url), ...argv, "--inner"], { stdio: "inherit" });
      child.on("exit", (status) => resolve(status ?? 1));
    });
    process.exitCode = code;
  } finally {
    release();
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => { console.error(`[pose-check] ${error?.message ?? error}`); process.exitCode = 1; });
}
