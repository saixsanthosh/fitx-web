// The platform gate as the app runs it: src/proxy.ts calls platformGate right after its sign-in redirect, so a
// feature switched off in FITX Admin rewrites its pages to /unavailable and answers its APIs with 503, while a
// failed settings read leaves every feature on.
import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeSupabase, SESSION_COOKIE, ssrCookieValue } from "../support/fake-supabase.ts";

const fake = await new FakeSupabase().start();
process.env.NEXT_PUBLIC_SUPABASE_URL = fake.url;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
delete process.env.VERCEL_ENV;

const { NextRequest } = await import("next/server");
const { proxy, config } = await import("@/proxy");
const { resetPlatformSettingsCache } = await import("@/lib/platform/gate");
const { FEATURE_KEYS, FEATURE_ROUTES } = await import("@/lib/platform/settings");
const { unstable_doesMiddlewareMatch } = await import("next/experimental/testing/server.js");

const MEMBER = { id: "44444444-4444-4444-8444-444444444444", email: "member@example.test" };
fake.addUser(MEMBER, { onboarded: true, intro_completed_at: "2026-11-01T00:00:00Z" });

/** What the platform_settings read answers: a row, an HTTP failure, or a network error. */
let settings: { status: number; body: unknown } | "offline" = { status: 200, body: [] };
let settingsReads = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!target.includes("/rest/v1/platform_settings")) return realFetch(input, init);
  settingsReads += 1;
  if (settings === "offline") throw new TypeError("fetch failed");
  return new Response(JSON.stringify(settings.body), { status: settings.status, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

const switchedOff = (...keys: string[]) => ({ status: 200, body: [{ features: Object.fromEntries(keys.map((key) => [key, false])), maintenance: null, site: {} }] });

function request(path: string, { method = "GET", signedIn = true, expired = false }: { method?: string; signedIn?: boolean; expired?: boolean } = {}) {
  const headers: Record<string, string> = { host: "fitnessx.vercel.app", "x-forwarded-proto": "https" };
  if (signedIn) {
    const session = fake.issueSession(MEMBER.id, expired ? -60 : 3600);
    // The device already knows the account is set up and has seen the film, so no profile read is needed.
    headers.cookie = `${SESSION_COOKIE}=${ssrCookieValue(session)}; fitx_onboarded=${MEMBER.id}; fitx_intro=seen; fitx_intro_checked=${MEMBER.id}`;
  }
  return new NextRequest(new URL(path, "https://fitnessx.vercel.app"), { method, headers });
}

const rewrittenTo = (response: Response) => {
  const value = response.headers.get("x-middleware-rewrite");
  return value ? new URL(value).pathname + new URL(value).search : null;
};
const location = (response: Response) => {
  const value = response.headers.get("location");
  return value ? new URL(value).pathname + new URL(value).search : null;
};

beforeEach(() => {
  fake.reset();
  resetPlatformSettingsCache();
  settings = { status: 200, body: [] };
  settingsReads = 0;
});
after(async () => {
  globalThis.fetch = realFetch;
  await fake.stop();
});

describe("proxy: features switched off in Admin", () => {
  test("the proxy runs on every API a switch can close, and still skips the others", () => {
    for (const url of ["/api/coach", "/api/coach/chat", "/api/coach/threads/abc", "/api/billing/checkout", "/api/support", "/api/support/reply"]) {
      assert.equal(unstable_doesMiddlewareMatch({ config, url }), true, url);
    }
    for (const url of ["/api/foods/search", "/api/billing/webhook", "/api/billing/status", "/api/auth/session", "/api/intro/complete"]) {
      assert.equal(unstable_doesMiddlewareMatch({ config, url }), false, url);
    }
    // Every API path in FEATURE_ROUTES reaches the proxy.
    for (const key of FEATURE_KEYS) {
      for (const route of FEATURE_ROUTES[key]) {
        if (route.path.startsWith("/api/")) assert.equal(unstable_doesMiddlewareMatch({ config, url: route.path }), true, route.path);
      }
    }
  });

  test("each switched-off feature rewrites its pages to /unavailable?feature=<key>", async () => {
    settings = switchedOff(...FEATURE_KEYS);
    for (const [path, key] of [
      ["/ai-coach", "ai_coach"],
      ["/ai-coach/threads", "ai_coach"],
      ["/home-workout?exercise=squat", "home_workout"],
      ["/activity/record", "activity"],
      ["/activity/import", "activity"],
      ["/activity/hike", "activity"],
      ["/activity/paddle", "activity"],
    ]) {
      const response = await proxy(request(path));
      assert.equal(response.status, 200, path);
      assert.equal(rewrittenTo(response), `/unavailable?feature=${key}`, path);
      assert.equal(location(response), null, `${path} keeps its address`);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/, path);
    }
    // Cancelling, saved activities and the coach's data controls stay reachable.
    for (const path of ["/subscription", "/activity", "/activity/00000000-0000-4000-8000-000000000000"]) {
      const response = await proxy(request(path));
      assert.equal(rewrittenTo(response), null, path);
      assert.equal(response.headers.get("x-middleware-next"), "1", path);
    }
    assert.equal(settingsReads, 1, "one settings read serves every request for a minute");
  });

  test("their APIs answer 503 feature_unavailable", async () => {
    settings = switchedOff(...FEATURE_KEYS);
    for (const [path, method] of [
      ["/api/coach/chat", "POST"],
      ["/api/coach/swap", "POST"],
      ["/api/billing/checkout", "POST"],
      ["/api/support", "POST"],
      ["/api/support/reply", "POST"],
    ]) {
      const response = await proxy(request(path, { method }));
      assert.equal(response.status, 503, `${method} ${path}`);
      assert.deepEqual(await response.json(), { error: "feature_unavailable" }, `${method} ${path}`);
      assert.equal(rewrittenTo(response), null, `${method} ${path}`);
    }
    for (const [path, method] of [
      ["/api/coach/consent", "DELETE"],
      ["/api/coach/data", "DELETE"],
      ["/api/coach/threads/abc", "DELETE"],
    ]) {
      const response = await proxy(request(path, { method }));
      assert.notEqual(response.status, 503, `${method} ${path}`);
      assert.equal(response.headers.get("x-middleware-next"), "1", `${method} ${path}`);
    }
    // Help messages switched off stop sending, not reading.
    const reading = await proxy(request("/api/support", { method: "GET" }));
    assert.equal(reading.status, 200);
    assert.equal(reading.headers.get("x-middleware-next"), "1");
  });

  test("only the switched-off feature closes; everything else goes through as before", async () => {
    settings = switchedOff("ai_coach");
    assert.equal(rewrittenTo(await proxy(request("/ai-coach"))), "/unavailable?feature=ai_coach");
    for (const path of ["/activity", "/home-workout", "/subscription", "/dashboard", "/help", "/unavailable"]) {
      const response = await proxy(request(path));
      assert.equal(rewrittenTo(response), null, path);
      assert.equal(location(response), null, path);
      assert.equal(response.headers.get("x-middleware-next"), "1", path);
    }
    const checkout = await proxy(request("/api/billing/checkout", { method: "POST" }));
    assert.equal(checkout.headers.get("x-middleware-next"), "1");
  });

  test("signed-out visitors are still sent to sign in first", async () => {
    settings = switchedOff("ai_coach");
    const response = await proxy(request("/ai-coach", { signedIn: false }));
    assert.equal(location(response), "/signin?next=%2Fai-coach");
    // A signed-out API call reaches its route, which answers 401 itself.
    const api = await proxy(request("/api/coach/chat", { method: "POST", signedIn: false }));
    assert.equal(api.headers.get("x-middleware-next"), "1");
  });

  test("a rewrite keeps the refreshed session cookies, for the browser and for the page", async () => {
    settings = switchedOff("activity");
    const response = await proxy(request("/activity/record", { expired: true }));
    assert.equal(rewrittenTo(response), "/unavailable?feature=activity");
    const refreshed = response.headers.getSetCookie().find((line) => line.startsWith(`${SESSION_COOKIE}=`));
    assert.ok(refreshed, "the refreshed session cookie is set on the rewrite");
    assert.ok(response.headers.get("x-middleware-request-cookie")?.includes(SESSION_COOKIE), "the page renders with the refreshed cookie");
  });

  test("a failed settings read leaves every feature on", async () => {
    for (const failure of [{ status: 404, body: { code: "PGRST205" } }, { status: 500, body: { message: "down" } }, "offline"] as const) {
      resetPlatformSettingsCache();
      settings = failure;
      for (const path of ["/ai-coach", "/home-workout", "/activity", "/subscription"]) {
        const response = await proxy(request(path));
        assert.equal(rewrittenTo(response), null, `${path} with ${JSON.stringify(failure)}`);
        assert.equal(response.headers.get("x-middleware-next"), "1", path);
      }
      for (const path of ["/api/coach/chat", "/api/billing/checkout", "/api/support", "/api/support/reply"]) {
        const response = await proxy(request(path, { method: "POST" }));
        assert.notEqual(response.status, 503, `${path} with ${JSON.stringify(failure)}`);
      }
    }
    // No row yet (the migration seeds one): defaults, everything on.
    resetPlatformSettingsCache();
    settings = { status: 200, body: [] };
    assert.equal(rewrittenTo(await proxy(request("/ai-coach"))), null);
  });
});
