// The platform gate: switched-off pages are rewritten to /unavailable, APIs get 503, settings are cached for a
// minute, and any failure to read them leaves everything open.
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { loadPlatformSettings, platformGate, readPlatformSettingsForStaticPage, resetPlatformSettingsCache } from "@/lib/platform/gate";

const realFetch = globalThis.fetch;
const env = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY };
let calls: string[] = [];

function serve(body: unknown, status = 200) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`${String(input)} ${new Headers(init?.headers).get("apikey")}`);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

const request = (path: string, method = "GET") => new NextRequest(new URL(path, "https://fitnessx.example"), { method });

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.example";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  resetPlatformSettingsCache();
  calls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env.NEXT_PUBLIC_SUPABASE_URL = env.url;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = env.key;
});

test("a switched-off page is rewritten to /unavailable and its API answers 503", async () => {
  serve([{ features: { ai_coach: false }, maintenance: null, site: {} }]);
  const page = await platformGate(request("/ai-coach"));
  assert.ok(page);
  assert.equal(new URL(page.headers.get("x-middleware-rewrite") ?? "").pathname, "/unavailable");
  assert.equal(new URL(page.headers.get("x-middleware-rewrite") ?? "").searchParams.get("feature"), "ai_coach");
  const api = await platformGate(request("/api/coach/chat", "POST"));
  assert.equal(api?.status, 503);
  assert.deepEqual(await api?.json(), { error: "feature_unavailable" });
  assert.equal(await platformGate(request("/activity")), null);
  assert.equal(await platformGate(request("/dashboard")), null);
  assert.equal(calls.length, 1, "one read serves every request for a minute");
  assert.match(calls[0], /\/rest\/v1\/platform_settings\?id=eq\.1&select=features,maintenance,site sb_publishable_test$/);
});

test("support switched off closes sending, not reading", async () => {
  serve([{ features: { support: false } }]);
  assert.equal((await platformGate(request("/api/support", "POST")))?.status, 503);
  assert.equal((await platformGate(request("/api/support/reply", "POST")))?.status, 503);
  assert.equal(await platformGate(request("/help")), null);
});

test("a missing table, an error or no configuration leave everything open", async () => {
  serve({ code: "PGRST205" }, 404);
  assert.equal(await platformGate(request("/ai-coach")), null);
  assert.equal((await loadPlatformSettings()).source, "defaults");

  resetPlatformSettingsCache();
  globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
  assert.equal(await platformGate(request("/subscription")), null);

  resetPlatformSettingsCache();
  calls = [];
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  serve([{ features: { activity: false } }]);
  assert.equal(await platformGate(request("/activity")), null);
  assert.equal(calls.length, 0);
});

test("settings read from the table say so (Help offers complaints only then)", async () => {
  serve([{ features: {}, maintenance: null, site: {} }]);
  const loaded = await loadPlatformSettings();
  assert.equal(loaded.source, "database");
  assert.equal(loaded.settings.features.support, true);
});

test("the pricing page's cached read sees a switch and fails open", async () => {
  let init: RequestInit | undefined;
  globalThis.fetch = (async (_input: RequestInfo | URL, given?: RequestInit) => {
    init = given;
    return new Response(JSON.stringify([{ features: { subscriptions: false } }]), { status: 200 });
  }) as typeof fetch;
  assert.equal((await readPlatformSettingsForStaticPage()).features.subscriptions, false);
  assert.equal(init?.cache, undefined, "no no-store, so the page stays prerendered");
  assert.deepEqual((init as { next?: unknown } | undefined)?.next, { revalidate: 60 });
  globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
  assert.equal((await readPlatformSettingsForStaticPage()).features.subscriptions, true);
});
