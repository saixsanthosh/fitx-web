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

/** Runs in every page before its own scripts: reports each CSP violation to the console for CspFlowSession. */
function watchCspViolations() {
  const report = (event) => {
    try {
      console.debug(`[e2e-csp] ${JSON.stringify({
        directive: event.effectiveDirective || event.violatedDirective || "",
        blocked: String(event.blockedURI || "").slice(0, 300),
        disposition: event.disposition || "",
        source: String(event.sourceFile || "").slice(0, 200),
        line: event.lineNumber || 0,
        sample: String(event.sample || "").slice(0, 120),
        page: String(location.href).slice(0, 300),
      })}`);
    } catch {
      // Reporting is best effort; Chrome's own console report is the backstop.
    }
  };
  window.addEventListener("securitypolicyviolation", report, true);
}

/** Chrome's console text for a CSP violation, enforced ("… violates the following Content Security Policy directive …",
 * an error) or report-only (the same text as info). */
const CSP_CONSOLE = /violates the following Content Security Policy directive|Refused to .*Content Security Policy/i;
const baseDirective = (name) => String(name).split(" ")[0].replace(/-(elem|attr)$/, "");

/** A FlowSession that also collects every CSP violation on every page (and its workers) of its context. */
class CspFlowSession extends FlowSession {
  constructor(options) {
    super(options);
    this.cspViolations = [];
  }

  async open(options) {
    const page = await super.open(options);
    // Added before the first navigation, so it runs in this page and in every page the flow opens later.
    await this.context.addInitScript(watchCspViolations);
    this.context.on("page", (other) => { if (other !== this.page) this.watchCsp(other); });
    return page;
  }

  instrument(page) {
    super.instrument(page);
    this.watchCsp(page);
  }

  watchCsp(page) {
    const fromConsole = (message, via) => {
      const text = message.text();
      if (text.startsWith("[e2e-csp] ")) {
        try {
          this.cspViolations.push({ ...JSON.parse(text.slice(10)), via: "event", label: this.label });
        } catch {
          this.cspViolations.push({ directive: "unknown", blocked: text.slice(10, 300), via: "event", label: this.label, page: page.url() });
        }
      } else if (["error", "warning", "info"].includes(message.type()) && CSP_CONSOLE.test(text)) {
        this.cspViolations.push({
          directive: /directive:? ["']([a-z-]+)/i.exec(text)?.[1] ?? "unknown",
          blocked: /^(?:Loading|Connecting to|Framing|Refused to \w+(?: the \w+)?) (?:the \w+ )?'([^']+)'/.exec(text)?.[1] ?? "",
          disposition: message.type() === "info" ? "report" : "enforce",
          text: text.slice(0, 400), via, label: this.label, page: page.url(),
        });
      }
    };
    page.on("console", (message) => fromConsole(message, "console"));
    // Workers get no init script; Chrome's own report of a violation inside one is the only signal.
    page.on("worker", (worker) => worker.on?.("console", (message) => fromConsole(message, `worker ${worker.url().slice(0, 160)}`)));
  }

  /** One failed step listing every violation. Chrome's console report of a violation the page event already gave is left out. */
  recordCspViolations() {
    const events = this.cspViolations.filter((violation) => violation.via === "event");
    const covered = new Set(events.map((violation) => `${violation.page}|${baseDirective(violation.directive)}`));
    const unique = new Map();
    for (const violation of [...events, ...this.cspViolations.filter((item) => item.via !== "event")]) {
      if (violation.via !== "event" && covered.has(`${violation.page}|${baseDirective(violation.directive)}`)) continue;
      const key = `${violation.via}|${violation.directive}|${violation.blocked}|${violation.page}`;
      if (!unique.has(key)) unique.set(key, violation);
    }
    const list = [...unique.values()];
    if (!list.length) return list;
    this.steps.push({
      name: "no Content-Security-Policy violations",
      status: "fail",
      ms: 0,
      error: list.map((violation) => `${violation.disposition === "report" ? "[report-only] " : ""}${violation.directive} blocked ${violation.blocked || "(inline)"} on ${violation.page} (${violation.label})`).join("\n").slice(0, 1200),
    });
    return list;
  }
}

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
const cspViolations = [];
try {
  for (const flow of flows) {
    for (const size of flow.sizes ?? sizes) {
      for (const scheme of flow.schemes?.(schemes) ?? schemes) {
        if (stopped) {
          notRun.push(`${flow.id} ${size} ${scheme}`);
          continue;
        }
        const t = new CspFlowSession({ browser, appUrl: APP_URL, dbUrl: standin.url, outDir: OUT, size, scheme, flowId: flow.id });
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
