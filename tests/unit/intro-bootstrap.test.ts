import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { INTRO_BOOTSTRAP_SCRIPT } from "@/components/brand/introBootstrap";

type Run = { attrs: Map<string, string>; cookieWrites: string[]; window: Record<string, unknown>; preloads: string[] };

function run({ path = "/", search = "", cookie = "", reduce = false, theme = null as string | null } = {}): Run {
  const attrs = new Map<string, string>();
  const cookieWrites: string[] = [];
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
    addEventListener() {},
  };
  const window: Record<string, unknown> = {
    localStorage: { getItem: () => theme },
    matchMedia: (query: string) => ({ matches: query.includes("reduced-motion") ? reduce : false }),
    location: { pathname: path, search, protocol: "https:" },
    setTimeout: () => 0,
  };
  vm.runInNewContext(INTRO_BOOTSTRAP_SCRIPT, { window, document, Date });
  return { attrs, cookieWrites, window, preloads };
}

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

test("first-time visitors see the page itself: no film, no loader", () => {
  const { attrs } = run({ path: "/" });
  assert.equal(attrs.get("data-fitx-intro"), undefined);
  assert.equal(attrs.get("data-fitx-loader"), undefined);
  assert.equal(attrs.get("data-fitx-auth"), undefined);
});

test("reduced motion gets neither the film nor the loader", () => {
  for (const cookie of ["fitx_intro=play", "fitx_intro=seen"]) {
    const { attrs } = run({ path: "/dashboard", cookie, reduce: true });
    assert.equal(attrs.get("data-fitx-intro"), undefined, cookie);
    assert.equal(attrs.get("data-fitx-loader"), undefined, cookie);
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
