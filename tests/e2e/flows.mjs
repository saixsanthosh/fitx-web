// The browser pass of the FITX signed-in e2e run, against an app and a Supabase stand-in that are already
// running (tests/e2e/run.mjs starts both). Each flow runs in a fresh browser context at each size.
//
//   node tests/e2e/flows.mjs --out=<dir> [--flows=01,02] [--sizes=phone,desktop] [--schemes=light,dark]
//
// Every page is watched for Content-Security-Policy violations (enforced and report-only alike, from the page's
// securitypolicyviolation events and Chrome's own console reports, which also cover workers). Any violation fails
// that flow run with the directive and the blocked URL, and all of them are listed in <out>/csp-violations.json.
//   env: E2E_APP_URL (http://fitx-e2e.localhost:3720), E2E_STANDIN (<out>/standin.json),
//        E2E_CHROME (system Chrome), E2E_PLAYWRIGHT_CORE (path to playwright-core's index.mjs)
//
// A flow may set `sizes` (any of "phone", "tablet" and "desktop"; the default is phone and desktop), `schemes` and
// `browser: { autoplayPolicy?, fakeMedia? }`. A flow with `browser` runs in its own Chrome, launched with those options
// (see launchChrome in support/browser.mjs) and closed after the flow; every other flow shares one Chrome.
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CspFlowSession } from "./csp-watch.mjs";
import { launchChrome, loadPlaywright } from "./support/browser.mjs";
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
const chromeHosts = { executablePath: CHROME, appHost: new URL(APP_URL).host, dbHost: new URL(standin.url).host };
const browser = await launchChrome(playwright, chromeHosts);

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
const cspViolations = [];

/** A flow's own Chrome, when it sets `browser`; null for the shared one. */
async function ownBrowserFor(flow) {
  if (!flow.browser) return null;
  const { autoplayPolicy, fakeMedia } = flow.browser;
  return launchChrome(playwright, { ...chromeHosts, ...(autoplayPolicy ? { autoplayPolicy } : {}), ...(fakeMedia ? { fakeMedia: true } : {}) });
}

/** Every size and scheme of one flow, in `flowBrowser`; when its own Chrome did not start, each run fails with why. */
async function runFlow(flow, flowBrowser, launchError) {
  for (const size of flow.sizes ?? sizes) {
    for (const scheme of flow.schemes?.(schemes) ?? schemes) {
      if (stopped) {
        notRun.push(`${flow.id} ${size} ${scheme}`);
        continue;
      }
      if (launchError) {
        const why = String(launchError?.message ?? launchError).split("\n")[0].slice(0, 300);
        results.push({
          flow: flow.id, size, scheme, status: "fail", title: flow.title, ms: 0,
          steps: [{ name: "launch the flow's own Chrome", status: "fail", error: why }], checkpoints: [], blocked: [], dialogs: [], notes: [],
        });
        console.log(`[e2e] ${flow.id} ${size} ${scheme} … fail (0 s) — its own Chrome did not start: ${why}`);
        continue;
      }
      const t = new CspFlowSession({ browser: flowBrowser, appUrl: APP_URL, dbUrl: standin.url, outDir: OUT, size, scheme, flowId: flow.id });
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
      for (const violation of t.recordCspViolations()) {
        cspViolations.push({ flow: flow.id, size, scheme, ...violation });
        console.log(`[e2e] CSP violation in ${flow.id} ${size} ${scheme}: ${violation.directive} blocked ${violation.blocked || "(inline)"} on ${violation.page}`);
      }
      const summary = { ...t.summary(), title: flow.title, ms: Date.now() - started, ...(stopped ? { stopped } : {}) };
      t.save();
      results.push(summary);
      const why = crash ? ` — ${String(crash.message).split("\n")[0].slice(0, 160)}` : "";
      console.log(`${summary.status} (${Math.round(summary.ms / 1000)} s)${why}${stopped ? ` [run stopped: ${stopped}]` : ""}`);
    }
  }
}

try {
  for (const flow of flows) {
    let own = null;
    let launchError = null;
    if (!stopped) {
      try {
        own = await ownBrowserFor(flow);
      } catch (error) {
        launchError = error;
      }
    }
    try {
      await runFlow(flow, own ?? browser, launchError);
    } finally {
      if (own) await own.close().catch(() => undefined);
    }
  }
} finally {
  closing = true;
  await browser.close().catch(() => undefined);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
writeFileSync(path.join(OUT, `results-${stamp}.json`), JSON.stringify(results, null, 2));
writeFileSync(path.join(OUT, "results-latest.json"), JSON.stringify(results, null, 2));
writeFileSync(path.join(OUT, "csp-violations.json"), JSON.stringify(cspViolations, null, 2));
console.log(`[e2e] CSP violations: ${cspViolations.length}`);
const failed = results.filter((result) => result.status === "fail");
console.log(`[e2e] ${results.length - failed.length}/${results.length} flow runs passed; results in ${OUT}`);
if (stopped) console.log(`[e2e] run stopped early (${stopped}); not run: ${notRun.join(", ") || "none"}`);
process.exitCode = failed.length || stopped ? 1 : 0;
