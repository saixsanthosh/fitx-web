// Content-Security-Policy violations in the e2e browser pass (used by flows.mjs). Every page gets an init script
// that reports each securitypolicyviolation event (enforced and report-only alike); Chrome's own console reports are
// the backstop, also for workers, which get no init script. A flow run with any violation gets a failed step naming
// the directive and the blocked URL.
import { FlowSession } from "./support/browser.mjs";

/** Runs in every page before its own scripts: reports each CSP violation to the console for CspFlowSession. */
export function watchCspViolations() {
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

/** A FlowSession that also collects every CSP violation on every page (and its workers) of its context. */
export class CspFlowSession extends FlowSession {
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

  /**
   * One failed step listing every violation. Chrome's console report is only the backstop: it is left out for a page
   * whose own events already reported a violation of the same disposition (Chrome names the fallback directive, such
   * as default-src, where the event names the effective one).
   */
  recordCspViolations() {
    const events = this.cspViolations.filter((violation) => violation.via === "event");
    const covered = new Set(events.map((violation) => `${violation.page}|${violation.disposition}`));
    const unique = new Map();
    for (const violation of [...events, ...this.cspViolations.filter((item) => item.via !== "event")]) {
      if (violation.via === "console" && covered.has(`${violation.page}|${violation.disposition}`)) continue;
      const key = `${violation.via}|${violation.disposition}|${violation.directive}|${violation.blocked}|${violation.page}`;
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
