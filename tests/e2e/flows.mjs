// The browser pass of the FITX signed-in e2e run, against an app and a Supabase stand-in that are already
// running (tests/e2e/run.mjs starts both). Each flow runs in a fresh browser context at each size.
//
//   node tests/e2e/flows.mjs --out=<dir> [--flows=01,02] [--sizes=phone,desktop] [--schemes=light,dark]
//   env: E2E_APP_URL (http://fitx-e2e.localhost:3720), E2E_STANDIN (<out>/standin.json),
//        E2E_CHROME (system Chrome), E2E_PLAYWRIGHT_CORE (path to playwright-core's index.mjs)
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FlowSession, launchChrome, loadPlaywright } from "./support/browser.mjs";
import { Standin } from "./support/standin-client.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.join("=") || "true"];
}));
const OUT = path.resolve(args.out ?? process.env.E2E_OUT ?? path.join(HERE, ".out"));
const APP_URL = process.env.E2E_APP_URL ?? "http://fitx-e2e.localhost:3720";
const STANDIN_FILE = process.env.E2E_STANDIN ?? path.join(OUT, "standin.json");
const CHROME = process.env.E2E_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sizes = (args.sizes ?? "phone,desktop").split(",");
const schemes = (args.schemes ?? "light").split(",");
const only = args.flows ? args.flows.split(",") : null;

mkdirSync(OUT, { recursive: true });
const standin = Standin.fromFile(STANDIN_FILE);
const playwright = await loadPlaywright();
const browser = await launchChrome(playwright, { executablePath: CHROME, appHost: new URL(APP_URL).host, dbHost: new URL(standin.url).host });

// Playwright answers SIGTERM and SIGHUP by closing the browser and leaves this process running, so a stopped run
// used to go on and report every later flow as failed ("Target page, context or browser has been closed").
// Stop instead: the flows not run are listed as not run, never as failures of the app.
let stopped = null;
let closing = false;
for (const signal of ["SIGTERM", "SIGHUP"]) process.on(signal, () => { stopped ??= `this run received ${signal}`; });
browser.on("disconnected", () => { if (!closing) stopped ??= "the browser closed"; });

const files = readdirSync(path.join(HERE, "flows")).filter((name) => /^\d\d[a-z]?-.*\.mjs$/.test(name)).sort();
const flows = [];
for (const file of files) {
  const { flow } = await import(pathToFileURL(path.join(HERE, "flows", file)).href);
  if (!only || only.some((prefix) => file.startsWith(prefix))) flows.push(flow);
}

const results = [];
const notRun = [];
try {
  for (const flow of flows) {
    for (const size of flow.sizes ?? sizes) {
      for (const scheme of flow.schemes?.(schemes) ?? schemes) {
        if (stopped) {
          notRun.push(`${flow.id} ${size} ${scheme}`);
          continue;
        }
        const t = new FlowSession({ browser, appUrl: APP_URL, dbUrl: standin.url, outDir: OUT, size, scheme, flowId: flow.id });
        const started = Date.now();
        process.stdout.write(`[e2e] ${flow.id} ${size} ${scheme} … `);
        let crash = null;
        try {
          await flow.run(t, { standin, size, scheme, appUrl: APP_URL, outDir: t.dir });
        } catch (error) {
          crash = error;
          if (!error?.stepFailed) t.steps.push({ name: "unexpected error", status: "fail", error: String(error?.stack ?? error).slice(0, 1500) });
        } finally {
          await t.close();
        }
        const summary = { ...t.summary(), title: flow.title, ms: Date.now() - started, ...(stopped ? { stopped } : {}) };
        t.save();
        results.push(summary);
        const why = crash ? ` — ${String(crash.message).split("\n")[0].slice(0, 160)}` : "";
        console.log(`${summary.status} (${Math.round(summary.ms / 1000)} s)${why}${stopped ? ` [run stopped: ${stopped}]` : ""}`);
      }
    }
  }
} finally {
  closing = true;
  await browser.close().catch(() => undefined);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
writeFileSync(path.join(OUT, `results-${stamp}.json`), JSON.stringify(results, null, 2));
writeFileSync(path.join(OUT, "results-latest.json"), JSON.stringify(results, null, 2));
const failed = results.filter((result) => result.status === "fail");
console.log(`[e2e] ${results.length - failed.length}/${results.length} flow runs passed; results in ${OUT}`);
if (stopped) console.log(`[e2e] run stopped early (${stopped}); not run: ${notRun.join(", ") || "none"}`);
process.exitCode = failed.length || stopped ? 1 : 0;
