// Browser side of the e2e harness: headless system Chrome driven by playwright-core, one fresh context per
// flow run. Every request to a host other than the app and the Supabase stand-in is aborted as if the
// network were down and recorded; Chrome's own resolver also fails every other name as a backstop. Each
// checkpoint records console errors, failed and 4xx/5xx requests, horizontal overflow and a screenshot.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function loadPlaywright() {
  const spec = process.env.E2E_PLAYWRIGHT_CORE;
  try {
    const loaded = await import(spec ? (spec.startsWith("/") ? pathToFileURL(spec).href : spec) : "playwright-core");
    return loaded.chromium ? loaded : loaded.default;
  } catch (error) {
    throw new Error(`playwright-core could not be loaded; set E2E_PLAYWRIGHT_CORE to its index.mjs (${error.message})`);
  }
}

export const SIZES = {
  phone: {
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36",
  },
  tablet: {
    viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
};

/**
 * Headless system Chrome that resolves only the app and the stand-in. `autoplayPolicy` is Chrome's
 * `--autoplay-policy` value; "default" leaves the flag out, so Chrome's own policy applies (media with sound needs a
 * user gesture). `fakeMedia` gives the page a fake camera and microphone and answers their permission prompts.
 */
export async function launchChrome(playwright, { executablePath, appHost, dbHost, autoplayPolicy = "no-user-gesture-required", fakeMedia = false }) {
  const keep = [appHost, dbHost].map((host) => host.split(":")[0]);
  return playwright.chromium.launch({
    executablePath,
    headless: true,
    args: [
      // Only the two local hosts resolve; anything that slips past request routing fails to resolve.
      `--host-resolver-rules=MAP * ~NOTFOUND, ${keep.map((host) => `EXCLUDE ${host}`).join(", ")}, EXCLUDE localhost, EXCLUDE *.localhost`,
      "--disable-features=Translate,MediaRouter,OptimizationHints,AutofillServerCommunication,CertificateTransparencyComponentUpdater",
      "--disable-sync", "--no-pings", "--disable-domain-reliability",
      ...(autoplayPolicy === "default" ? [] : [`--autoplay-policy=${autoplayPolicy}`]),
      ...(fakeMedia ? ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] : []),
    ],
  });
}

const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

/** Overflow at the current width: the page's scroll width and the elements reaching past the right edge. */
function measureOverflow() {
  const doc = document.documentElement;
  const width = doc.clientWidth;
  const scrollWidth = Math.max(doc.scrollWidth, document.body?.scrollWidth ?? 0);
  const offenders = [];
  if (scrollWidth > width + 1) {
    const clipped = (element) => {
      for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) return true;
      }
      return false;
    };
    for (const element of document.body.querySelectorAll("*")) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.right <= width + 1 || getComputedStyle(element).position === "fixed" || clipped(element)) continue;
      const id = element.id ? `#${element.id}` : "";
      const cls = typeof element.className === "string" && element.className ? `.${element.className.trim().split(/\s+/).slice(0, 3).join(".")}` : "";
      offenders.push({ element: `${element.tagName.toLowerCase()}${id}${cls}`.slice(0, 140), right: Math.round(rect.right), text: (element.textContent ?? "").trim().slice(0, 60) });
      if (offenders.length >= 6) break;
    }
  }
  return { width, scrollWidth, overflow: scrollWidth > width + 1, offenders };
}

export class FlowSession {
  constructor({ browser, appUrl, dbUrl, outDir, size, scheme, flowId }) {
    this.browser = browser;
    this.appUrl = appUrl;
    this.dbUrl = dbUrl;
    this.appHost = new URL(appUrl).host;
    this.dbHost = new URL(dbUrl).host;
    this.size = size;
    this.scheme = scheme;
    this.flowId = flowId;
    this.dir = path.join(outDir, `${flowId}-${size}-${scheme}`);
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.dir, { recursive: true });
    this.label = "setup";
    this.events = [];
    this.blocked = [];
    this.checkpoints = [];
    this.steps = [];
    this.notes = [];
    this.shots = 0;
    this.dialogs = [];
    this.dialogAnswer = "dismiss";
  }

  /** `appUrl` points this flow at another app server (for example a second `next start` with other settings). */
  async open({ permissions = [], geolocation, consent = "essential", appUrl } = {}) {
    if (appUrl) {
      this.appUrl = appUrl;
      this.appHost = new URL(appUrl).host;
    }
    this.context = await this.browser.newContext({
      ...SIZES[this.size], colorScheme: this.scheme, locale: "en-IN", timezoneId: "Asia/Kolkata",
      acceptDownloads: true, serviceWorkers: "block", baseURL: this.appUrl, permissions, ...(geolocation ? { geolocation } : {}),
    });
    await this.context.route("**/*", (route) => this.route(route));
    if (consent) {
      await this.context.addInitScript((value) => {
        try { if (!window.localStorage.getItem("fitx-cookie-consent")) window.localStorage.setItem("fitx-cookie-consent", value); } catch { /* storage blocked */ }
      }, consent);
    }
    // What the head script does to <html> before first paint: intro film gate, short loader, theme.
    await this.context.addInitScript(() => {
      const log = [];
      Object.defineProperty(window, "__e2eRootLog", { value: log });
      new MutationObserver((records) => {
        for (const record of records) {
          if (record.target !== document.documentElement) continue;
          log.push({ t: Math.round(performance.now()), name: record.attributeName, value: document.documentElement.getAttribute(record.attributeName) });
        }
      }).observe(document, { attributes: true, subtree: true, attributeFilter: ["data-fitx-intro", "data-fitx-loader", "data-fitx-intro-gate", "data-theme"] });
    });
    this.page = await this.context.newPage();
    this.instrument(this.page);
    return this.page;
  }

  route(route) {
    const request = route.request();
    let url;
    try { url = new URL(request.url()); } catch { return route.continue(); }
    if (url.protocol === "data:" || url.protocol === "blob:" || url.host === this.appHost || url.host === this.dbHost) return route.continue();
    this.blocked.push({ url: `${url.protocol}//${url.host}${url.pathname}`.slice(0, 300), type: request.resourceType(), method: request.method(), label: this.label, page: this.page?.url() ?? null });
    return route.abort("internetdisconnected");
  }

  instrument(page) {
    page.on("console", (message) => {
      const type = message.type();
      if (type !== "error" && type !== "warning") return;
      const text = message.text();
      // Chrome logs each aborted outside request; those are already in `blocked`.
      const external = /ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED/.test(text);
      this.events.push({ kind: type === "error" ? "console.error" : "console.warning", text: text.slice(0, 800), source: message.location()?.url?.slice(0, 200) ?? null, external, label: this.label, page: page.url() });
    });
    page.on("pageerror", (error) => this.events.push({ kind: "pageerror", text: String(error?.stack ?? error).slice(0, 1500), label: this.label, page: page.url() }));
    page.on("requestfailed", (request) => {
      let url;
      try { url = new URL(request.url()); } catch { return; }
      if (url.host !== this.appHost && url.host !== this.dbHost) return; // outside hosts are in `blocked`
      this.events.push({ kind: "requestfailed", method: request.method(), url: `${url.pathname}${url.search}`.slice(0, 300), host: url.host, failure: request.failure()?.errorText ?? "", type: request.resourceType(), label: this.label, page: page.url() });
    });
    page.on("response", (response) => {
      if (response.status() < 400) return;
      let url;
      try { url = new URL(response.url()); } catch { return; }
      this.events.push({ kind: "http", status: response.status(), method: response.request().method(), url: `${url.pathname}${url.search}`.slice(0, 300), host: url.host, type: response.request().resourceType(), label: this.label, page: page.url() });
    });
    page.on("dialog", (dialog) => {
      this.dialogs.push({ type: dialog.type(), message: dialog.message(), label: this.label, answer: this.dialogAnswer });
      void (this.dialogAnswer === "accept" ? dialog.accept() : dialog.dismiss()).catch(() => undefined);
    });
  }

  /** Lets the page finish its requests (bounded: some pages poll or keep timers running). */
  async settle(ms = 4000) {
    await this.page.waitForLoadState("networkidle", { timeout: ms }).catch(() => undefined);
    await this.page.waitForTimeout(250);
  }

  async goto(pathname, { label, waitUntil = "load" } = {}) {
    if (label) this.label = label;
    const response = await this.page.goto(pathname, { waitUntil });
    await this.settle();
    return response;
  }

  /** Records what this page did since the last checkpoint, its overflow and a screenshot. */
  async checkpoint(name, { fullPage = true, settle = true } = {}) {
    if (settle) await this.settle();
    const overflow = await this.page.evaluate(measureOverflow).catch((error) => ({ error: String(error) }));
    this.shots += 1;
    const file = path.join(this.dir, `${String(this.shots).padStart(2, "0")}-${slug(name)}.jpg`);
    await this.page.screenshot({ path: file, fullPage, type: "jpeg", quality: 68, timeout: 20000 }).catch(async () => {
      await this.page.screenshot({ path: file, fullPage: false, type: "jpeg", quality: 68 }).catch(() => undefined);
    });
    const events = this.events.splice(0, this.events.length);
    const entry = { name, url: this.page.url(), overflow, screenshot: file, events };
    this.checkpoints.push(entry);
    return entry;
  }

  note(text, data) {
    this.notes.push(data === undefined ? { label: this.label, text } : { label: this.label, text, data });
  }

  /** Runs one step; a failure is recorded with a screenshot and ends the flow unless `soft`. */
  async step(name, fn, { soft = false } = {}) {
    this.label = name;
    const started = Date.now();
    try {
      const value = await fn();
      this.steps.push({ name, status: "pass", ms: Date.now() - started });
      return value;
    } catch (error) {
      this.steps.push({ name, status: "fail", ms: Date.now() - started, error: String(error?.message ?? error).slice(0, 1200) });
      await this.checkpoint(`FAILED ${name}`, { settle: false }).catch(() => undefined);
      if (!soft) throw Object.assign(error instanceof Error ? error : new Error(String(error)), { stepFailed: true });
      return undefined;
    }
  }

  expect(condition, message, data) {
    if (!condition) throw Object.assign(new Error(message), { data });
  }

  async rootLog() {
    return this.page.evaluate(() => window.__e2eRootLog ?? []).catch(() => []);
  }

  async close() {
    const leftover = this.events.splice(0, this.events.length);
    if (leftover.length) this.checkpoints.push({ name: "after last checkpoint", url: this.page?.url() ?? null, events: leftover });
    await this.context?.close().catch(() => undefined);
  }

  summary() {
    return {
      flow: this.flowId, size: this.size, scheme: this.scheme,
      status: this.steps.some((step) => step.status === "fail") ? "fail" : "pass",
      steps: this.steps, checkpoints: this.checkpoints, blocked: this.blocked, dialogs: this.dialogs, notes: this.notes,
    };
  }

  save() {
    writeFileSync(path.join(this.dir, "result.json"), JSON.stringify(this.summary(), null, 2));
  }
}
