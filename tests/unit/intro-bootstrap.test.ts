import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { INTRO_BOOTSTRAP_SCRIPT } from "@/components/brand/introBootstrap";

type Listener = (event: unknown) => void;
type Run = {
  attrs: Map<string, string>;
  cookieWrites: string[];
  /** localStorage / sessionStorage writes, as "<storage>.<key>". */
  storageWrites: string[];
  /** What the script listens for on `document` (Skip clicks, Escape). */
  listeners: Map<string, Listener[]>;
  window: Record<string, unknown>;
  preloads: string[];
};

function run({ path = "/", search = "", cookie = "", reduce = false, theme = null as string | null } = {}): Run {
  const attrs = new Map<string, string>();
  const cookieWrites: string[] = [];
  const storageWrites: string[] = [];
  const listeners = new Map<string, Listener[]>();
  const preloads: string[] = [];
  const root = {
    setAttribute: (name: string, value: string) => void attrs.set(name, value),
    removeAttribute: (name: string) => void attrs.delete(name),
    getAttribute: (name: string) => attrs.get(name) ?? null,
  };
  const document = {
    documentElement: root,
    get cookie() { return cookie; },
    set cookie(value: string) { cookieWrites.push(value); },
    createElement: () => ({ setAttribute() {}, set href(value: string) { preloads.push(value); } }),
    head: { appendChild() {} },
    addEventListener: (type: string, listener: Listener) => void listeners.set(type, [...(listeners.get(type) ?? []), listener]),
  };
  const storage = (name: string) => ({
    getItem: (key: string) => (name === "localStorage" && key === "fitx-theme" ? theme : null),
    setItem: (key: string) => void storageWrites.push(`${name}.${key}`),
    removeItem: (key: string) => void storageWrites.push(`${name}.${key}`),
  });
  const window: Record<string, unknown> = {
    localStorage: storage("localStorage"),
    sessionStorage: storage("sessionStorage"),
    matchMedia: (query: string) => ({ matches: query.includes("reduced-motion") ? reduce : false }),
    location: { pathname: path, search, protocol: "https:" },
    setTimeout: () => 0,
  };
  vm.runInNewContext(INTRO_BOOTSTRAP_SCRIPT, { window, document, Date });
  return { attrs, cookieWrites, storageWrites, listeners, window, preloads };
}

const dispatch = ({ listeners }: Run, type: string, event: unknown) => {
  for (const listener of listeners.get(type) ?? []) listener(event);
};
/** A click on the overlay's Skip button (`data-fitx-skip`), as the script sees it. */
const skipClick = { target: { closest: (selector: string) => (selector === "[data-fitx-skip]" ? {} : null) } };

test("plays the account's one-time film on the first app page and consumes the cookie at once", () => {
  const { attrs, cookieWrites, preloads } = run({ path: "/dashboard", cookie: "fitx_auth=1; fitx_intro=play" });
  assert.equal(attrs.get("data-fitx-intro"), "pending");
  assert.equal(attrs.get("data-fitx-intro-gate"), "account");
  assert.equal(attrs.get("data-fitx-auth"), "1");
  assert.match(cookieWrites[0] ?? "", /^fitx_intro=seen; Path=\/; Max-Age=34560000; SameSite=Lax; Secure$/);
  assert.deepEqual(preloads, ["/brand/intro/fitx-intro-light-landscape.webp"]);
});

test("plays it on the first page of any app section, the newer ones included", () => {
  for (const path of ["/activity", "/activity/1b4e28ba-2fa1-41d2-883f-0016d3cca427", "/ai-coach", "/form-coach", "/workouts", "/exercises/bench_press"]) {
    const { attrs, cookieWrites } = run({ path, cookie: "fitx_intro=play" });
    assert.equal(attrs.get("data-fitx-intro"), "pending", path);
    assert.equal(attrs.get("data-fitx-intro-gate"), "account", path);
    assert.equal(cookieWrites.length, 1, path);
  }
});

test("never plays it on onboarding, during a live workout or on the activity recorder", () => {
  for (const path of ["/onboarding", "/workouts/active", "/activity/record"]) {
    const { attrs, cookieWrites } = run({ path, cookie: "fitx_intro=play" });
    assert.equal(attrs.get("data-fitx-intro"), undefined, path);
    assert.equal(cookieWrites.length, 0, `${path} leaves the film for the next app page`);
  }
});

test("Help never plays the account's film, which waits for the first app page after setup, but gets the loader", () => {
  // An account still in setup may open Help (src/lib/auth/before-onboarding.ts).
  for (const search of ["", "?from=%2Fonboarding"]) {
    const { attrs, cookieWrites } = run({ path: "/help", search, cookie: "fitx_auth=1; fitx_intro=play" });
    assert.equal(attrs.get("data-fitx-intro"), undefined, search);
    assert.equal(cookieWrites.length, 0, "the film's cookie is left for the next app page");
  }
  assert.equal(run({ path: "/dashboard", cookie: "fitx_intro=play" }).attrs.get("data-fitx-intro-gate"), "account", "where it then plays");
  assert.equal(run({ path: "/help", cookie: "fitx_intro=seen" }).attrs.get("data-fitx-loader"), "on");
});

test("focus screens get no brand loader either", () => {
  for (const path of ["/workouts/active", "/activity/record"]) {
    const { attrs } = run({ path, cookie: "fitx_intro=seen" });
    assert.equal(attrs.get("data-fitx-loader"), undefined, path);
  }
  assert.equal(run({ path: "/activity", cookie: "fitx_intro=seen" }).attrs.get("data-fitx-loader"), "on", "the Activity hub still gets it");
});

test("?intro= replays the film on the newer sections, but not on a focus screen", () => {
  assert.equal(run({ path: "/ai-coach", search: "?intro=live", cookie: "fitx_intro=seen" }).attrs.get("data-fitx-intro-gate"), "replay");
  assert.equal(run({ path: "/activity/record", search: "?intro=live", cookie: "fitx_intro=seen" }).attrs.get("data-fitx-intro"), undefined);
});

test("the script stays free of backslashes (it is a template literal)", () => {
  assert.equal(INTRO_BOOTSTRAP_SCRIPT.includes(String.fromCharCode(92)), false);
});

test("returning devices get the short brand loader instead", () => {
  const { attrs, window } = run({ path: "/nutrition", cookie: "fitx_intro=seen" });
  assert.equal(attrs.get("data-fitx-loader"), "on");
  assert.equal(attrs.get("data-fitx-intro"), undefined);
  assert.equal(typeof window.__fitxReleaseLoader, "function");
});

// Until 2026-11-17 a signed-out home page played no film; the owner asked for it on every visit again.
test("signed-out visitors get the film on every full load of the home page, and it records nothing", () => {
  // A first visit, a device that was signed in before (seen), and one whose account film is still pending (play).
  for (const cookie of ["", "fitx_intro=seen", "fitx_intro=play"]) {
    // Visits in a row: each starts from the same cookies, because none is written (checked below).
    for (const [visit, search] of [[1, ""], [2, ""], [3, "?utm_source=newsletter"]] as const) {
      const label = `${cookie || "no cookies"}, visit ${visit}${search}`;
      const { attrs, cookieWrites, storageWrites, preloads } = run({ path: "/", search, cookie });
      assert.equal(attrs.get("data-fitx-intro"), "pending", label);
      assert.equal(attrs.get("data-fitx-intro-gate"), "visitor", label);
      assert.equal(attrs.get("data-fitx-loader"), undefined, `${label}: the film, not the loader`);
      assert.equal(attrs.get("data-fitx-auth"), undefined, label);
      // Nothing is written, so the next visit plays it again and a pending account film is left alone.
      assert.deepEqual(cookieWrites, [], label);
      assert.deepEqual(storageWrites, [], label);
      assert.deepEqual(preloads, ["/brand/intro/fitx-intro-light-landscape.webp"], label);
    }
  }
});

test("Skip and Escape give the page back before React hydrates, the visitor's film included", () => {
  for (const [type, event] of [["keydown", { key: "Escape" }], ["click", skipClick]] as const) {
    for (const options of [{ path: "/" }, { path: "/dashboard", cookie: "fitx_auth=1; fitx_intro=play" }]) {
      const page = run(options);
      assert.equal(page.attrs.get("data-fitx-intro"), "pending", `${options.path} ${type}`);
      dispatch(page, type, type === "keydown" ? { key: "Enter" } : { target: { closest: () => null } });
      assert.equal(page.attrs.get("data-fitx-intro"), "pending", `${options.path}: another key or click keeps it`);
      dispatch(page, type, event);
      assert.equal(page.attrs.get("data-fitx-intro"), undefined, `${options.path} ${type}`);
    }
  }
});

test("a signed-in visitor never gets the visitor's film on the home page", () => {
  // The proxy sends a signed-in "/" to the dashboard; the fitx_auth hint guards the page if it ever renders.
  for (const cookie of ["fitx_auth=1", "fitx_auth=1; fitx_intro=seen", "fitx_auth=1; fitx_intro=play"]) {
    const { attrs, cookieWrites } = run({ path: "/", cookie });
    assert.equal(attrs.get("data-fitx-intro"), undefined, cookie);
    assert.equal(attrs.get("data-fitx-intro-gate"), undefined, cookie);
    assert.equal(attrs.get("data-fitx-auth"), "1", cookie);
    assert.deepEqual(cookieWrites, [], `${cookie}: the account's film waits for an app page`);
  }
  assert.equal(run({ path: "/", cookie: "fitx_auth=1; fitx_intro=seen" }).attrs.get("data-fitx-loader"), "on", "the loader, as on any cold load");
});

test("no other public page plays a film, signed out or not", () => {
  const pages = ["/features", "/pricing", "/about", "/for-gyms", "/privacy", "/terms", "/cookies", "/refunds", "/signin", "/signup", "/forgot-password", "/reset-password", "/helpful-tips"];
  for (const path of pages) {
    for (const [cookie, search] of [["", ""], ["fitx_intro=play", ""], ["fitx_auth=1; fitx_intro=play", ""], ["", "?intro=play"]]) {
      const { attrs, cookieWrites } = run({ path, search, cookie });
      assert.equal(attrs.get("data-fitx-intro"), undefined, `${path}${search} ${cookie}`);
      assert.equal(attrs.get("data-fitx-intro-gate"), undefined, `${path}${search} ${cookie}`);
      assert.deepEqual(cookieWrites, [], `${path}${search} ${cookie}`);
    }
  }
  assert.equal(run({ path: "/pricing", cookie: "fitx_intro=seen" }).attrs.get("data-fitx-loader"), "on", "returning devices keep the loader there");
});

test("reduced motion gets neither the film nor the loader, on the home page either", () => {
  for (const [path, search] of [["/dashboard", ""], ["/", ""], ["/", "?intro=play"], ["/dashboard", "?intro=live"]]) {
    for (const cookie of ["", "fitx_intro=play", "fitx_intro=seen", "fitx_auth=1; fitx_intro=play"]) {
      const label = `${path}${search} ${cookie}`;
      const { attrs, cookieWrites } = run({ path, search, cookie, reduce: true });
      assert.equal(attrs.get("data-fitx-intro"), undefined, label);
      assert.equal(attrs.get("data-fitx-intro-gate"), undefined, label);
      assert.equal(attrs.get("data-fitx-loader"), undefined, label);
      assert.deepEqual(cookieWrites, [], `${label}: a pending account film waits`);
    }
  }
});

test("?intro= still plays the film on request without touching the cookie", () => {
  const { attrs, cookieWrites } = run({ path: "/", search: "?intro=live", cookie: "fitx_intro=seen" });
  assert.equal(attrs.get("data-fitx-intro"), "pending");
  assert.equal(attrs.get("data-fitx-intro-gate"), "replay");
  assert.equal(cookieWrites.length, 0);
});

test("applies the saved theme before first paint", () => {
  assert.equal(run({ theme: "dark" }).attrs.get("data-theme"), "dark");
  assert.equal(run({ theme: "light" }).attrs.get("data-theme"), "light");
  // Visitors who never chose a theme (or whose saved value is unreadable) match their device.
  assert.equal(run({ theme: "bogus" }).attrs.get("data-theme"), "system");
  assert.equal(run().attrs.get("data-theme"), "system");
});
