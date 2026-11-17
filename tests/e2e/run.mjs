// The FITX signed-in e2e run, start to finish: starts the Supabase stand-in (a throwaway PostgreSQL 17 cluster
// with every migration), builds the app against it when needed, serves it with `next start` on its own
// *.localhost name, runs the browser pass (tests/e2e/flows.mjs) and stops everything again, also on failure.
//
//   npm run test:e2e -- [--build] [--flows=01,02] [--sizes=phone,desktop] [--schemes=light,dark] [--out=<dir>]
//
// Needs PostgreSQL 17 server binaries on PATH (Homebrew: LC_ALL=C is set for them), Google Chrome, and
// playwright-core (E2E_PLAYWRIGHT_CORE=<path to its index.mjs> when it is not installed in this repo).
// E2E_WRAP names a command that wraps the heavy steps (the build and the browser pass), for example a script
// that runs one heavy job at a time at low priority. The servers themselves run at low priority (nice).
// Nothing here talks to the internet: the browser blocks outside hosts and the app server is preloaded with
// support/block-outbound.mjs; both record what they refused.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.join("=") || "true"];
}));
const OUT = path.resolve(args.out ?? mkdtempSync(path.join(tmpdir(), "fitx-e2e-")));
const APP_HOST = "fitx-e2e.localhost";
const APP_PORT = 3720;
const DB_HOST = "fitx-e2e-db.localhost";
const DB_PORT = 3721;
const APP_URL = `http://${APP_HOST}:${APP_PORT}`;
const COACH_HOST = "fitx-e2e-coach.localhost";
const COACH_PORT = 3722;
const COACH_URL = `http://${COACH_HOST}:${COACH_PORT}`;
const OLLAMA_PORT = 3724;
const DB_URL = `http://${DB_HOST}:${DB_PORT}`;
const lowPriority = process.platform === "darwin" && existsSync("/usr/sbin/taskpolicy") ? ["nice", "-n", "10", "/usr/sbin/taskpolicy", "-c", "utility"] : ["nice", "-n", "10"];
const wrap = (process.env.E2E_WRAP ?? "").trim();

/** Only what the tools need, so no AI, Razorpay or USDA key from the shell reaches the app. */
function cleanEnv(extra = {}) {
  const keep = ["PATH", "HOME", "TMPDIR", "USER", "SHELL"];
  return { ...Object.fromEntries(keep.filter((key) => process.env[key]).map((key) => [key, process.env[key]])), LANG: "en_US.UTF-8", NEXT_TELEMETRY_DISABLED: "1", ...extra };
}

const children = [];
function start(command, commandArgs, options) {
  const child = spawn(command, commandArgs, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], ...options });
  children.push(child);
  return child;
}

function run(command, commandArgs, options) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, { cwd: ROOT, stdio: "inherit", ...options });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

const wrapped = (command, commandArgs) => (wrap ? [wrap, [command, ...commandArgs]] : [command, commandArgs]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, what, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await check().catch(() => false)) return;
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function stopAll() {
  for (const child of children.reverse()) {
    if (child.exitCode !== null) continue;
    child.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(15000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => void stopAll().then(() => process.exit(130)));

let exitCode = 1;
try {
  mkdirSync(OUT, { recursive: true });
  rmSync(path.join(OUT, "standin.json"), { force: true });
  console.log(`[e2e] output in ${OUT}`);

  const standin = start(lowPriority[0], [...lowPriority.slice(1), process.execPath, path.join(HERE, "support", "server.mjs")], {
    env: { ...process.env, E2E_OUT: OUT, E2E_DB_HOST: DB_HOST, E2E_DB_PORT: String(DB_PORT), LC_ALL: "C" },
  });
  standin.stdout.on("data", (chunk) => process.stdout.write(chunk));
  standin.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await waitFor(async () => existsSync(path.join(OUT, "standin.json")), "the Supabase stand-in", 120000);
  const info = JSON.parse(readFileSync(path.join(OUT, "standin.json"), "utf8"));

  const appEnv = { NEXT_PUBLIC_SUPABASE_URL: DB_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: info.anonKey, SUPABASE_SECRET_KEY: info.serviceRoleKey };
  const marker = path.join(ROOT, ".next", "e2e-build.json");
  const built = existsSync(path.join(ROOT, ".next", "BUILD_ID")) && existsSync(marker) && readFileSync(marker, "utf8") === JSON.stringify(appEnv);
  if (args.build === "true" || !built) {
    console.log("[e2e] building the app against the stand-in");
    const [command, commandArgs] = wrapped(path.join(ROOT, "node_modules", ".bin", "next"), ["build"]);
    const code = await run(command, commandArgs, { env: cleanEnv(appEnv) });
    if (code !== 0) throw new Error(`next build failed (${code})`);
    writeFileSync(marker, JSON.stringify(appEnv));
  }

  const blocker = pathToFileURL(path.join(HERE, "support", "block-outbound.mjs")).href;
  const app = start(lowPriority[0], [...lowPriority.slice(1), path.join(ROOT, "node_modules", ".bin", "next"), "start", "-H", APP_HOST, "-p", String(APP_PORT)], {
    env: cleanEnv({ ...appEnv, TZ: "UTC", NODE_OPTIONS: `--import=${blocker}`, E2E_OUTBOUND_LOG: path.join(OUT, "server-outbound.jsonl") }),
  });
  const appLog = [];
  app.stdout.on("data", (chunk) => appLog.push(chunk));
  app.stderr.on("data", (chunk) => appLog.push(chunk));
  app.on("exit", () => writeFileSync(path.join(OUT, "next-start.log"), Buffer.concat(appLog)));
  await waitFor(async () => (await fetch(`${APP_URL}/`)).ok, "next start", 60000);

  // The AI coach's consent screen needs a set-up provider: a second server uses a fake Ollama on 127.0.0.1.
  start(lowPriority[0], [...lowPriority.slice(1), process.execPath, path.join(HERE, "support", "fake-ollama.mjs")], {
    env: { ...process.env, E2E_OUT: OUT, E2E_OLLAMA_PORT: String(OLLAMA_PORT) },
  });
  start(lowPriority[0], [...lowPriority.slice(1), path.join(ROOT, "node_modules", ".bin", "next"), "start", "-H", COACH_HOST, "-p", String(COACH_PORT)], {
    env: cleanEnv({
      ...appEnv, TZ: "UTC", NODE_OPTIONS: `--import=${blocker}`, E2E_OUTBOUND_LOG: path.join(OUT, "server-outbound-coach.jsonl"),
      OLLAMA_BASE_URL: `http://127.0.0.1:${OLLAMA_PORT}`, OLLAMA_MODEL: "fitx-e2e-fake",
    }),
  });
  await waitFor(async () => (await fetch(`${COACH_URL}/`)).ok, "the coach app server", 60000);

  const flowArgs = Object.entries(args).filter(([key]) => ["flows", "sizes", "schemes"].includes(key)).map(([key, value]) => `--${key}=${value}`);
  const [command, commandArgs] = wrapped(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", path.join(HERE, "flows.mjs"), `--out=${OUT}`, ...flowArgs]);
  exitCode = await run(command, commandArgs, { env: { ...process.env, E2E_APP_URL: APP_URL, E2E_COACH_URL: COACH_URL, E2E_STANDIN: path.join(OUT, "standin.json") } });
  if (existsSync(path.join(OUT, "results-latest.json"))) await run(process.execPath, [path.join(HERE, "summarize.mjs"), OUT], { env: process.env });
} catch (error) {
  console.error(`[e2e] ${error.message}`);
  exitCode = 1;
} finally {
  await stopAll();
}
process.exit(exitCode);
