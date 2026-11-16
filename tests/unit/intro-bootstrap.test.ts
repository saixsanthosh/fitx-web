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

test("never plays it on onboarding or during a live workout", () => {
  for (const path of ["/onboarding", "/workouts/active"]) {
    const { attrs, cookieWrites } = run({ path, cookie: "fitx_intro=play" });
    assert.equal(attrs.get("data-fitx-intro"), undefined, path);
    assert.equal(cookieWrites.length, 0, path);
  }
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
