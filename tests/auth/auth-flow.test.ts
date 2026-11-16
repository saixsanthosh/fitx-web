import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeSupabase, SESSION_COOKIE, ssrCookieValue } from "../support/fake-supabase.ts";

const fake = await new FakeSupabase().start();
process.env.NEXT_PUBLIC_SUPABASE_URL = fake.url;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
delete process.env.VERCEL_ENV;

const { NextRequest } = await import("next/server");
const { proxy, config } = await import("@/proxy");
const callback = await import("@/app/auth/callback/route");
const sessionRoute = await import("@/app/api/auth/session/route");
const introRoute = await import("@/app/api/intro/complete/route");
const { unstable_doesMiddlewareMatch } = await import("next/experimental/testing/server.js");

const ONBOARDED = { id: "11111111-1111-4111-8111-111111111111", email: "done@example.test" };
const NEWCOMER = { id: "22222222-2222-4222-8222-222222222222", email: "new@example.test" };
const SITE = "https://fitnessx.vercel.app";
const CODE = "3b241101-e2bb-4255-8caf-4136c566a962";

function request(path: string, { cookies = {}, host = "fitnessx.vercel.app", method = "GET", body, headers = {} }: { cookies?: Record<string, string>; host?: string; method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const cookie = Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join("; ");
  return new NextRequest(new URL(path, `https://${host}`), {
    method,
    headers: { host, "x-forwarded-proto": "https", ...(cookie ? { cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function sessionCookies(userId: string, expiresIn = 3600) {
  return { [SESSION_COOKIE]: ssrCookieValue(fake.issueSession(userId, expiresIn)) };
}

const setCookies = (response: Response) => response.headers.getSetCookie();
const cookieNamed = (response: Response, name: string) => setCookies(response).find((line) => line.startsWith(`${name}=`));
const location = (response: Response) => {
  const value = response.headers.get("location");
  return value ? new URL(value).pathname + new URL(value).search : null;
};
const restCalls = () => fake.calls.filter((call) => call.path.startsWith("/rest/v1/"));

before(() => {
  fake.addUser(ONBOARDED, { onboarded: true, intro_completed_at: "2026-11-01T00:00:00Z" });
  fake.addUser(NEWCOMER, { onboarded: false, intro_completed_at: null });
});
beforeEach(() => fake.reset());
after(() => fake.stop());

describe("proxy", () => {
  test("matches pages but not assets, API routes or the film", async () => {
    for (const url of ["/", "/dashboard", "/signin", "/workouts/active"]) assert.equal(unstable_doesMiddlewareMatch({ config, url }), true, url);
    for (const url of ["/api/foods/search", "/brand/intro/fitx-intro-light-portrait-60.mp4", "/manifest.webmanifest", "/_next/static/chunks/a.js", "/icon.svg"]) {
      assert.equal(unstable_doesMiddlewareMatch({ config, url }), false, url);
    }
  });

  test("sends signed-out visitors from private pages to sign in, keeping where they were going", async () => {
    const response = await proxy(request("/workouts?plan=1"));
    assert.equal(response.status, 307);
    assert.equal(location(response), "/signin?next=%2Fworkouts%3Fplan%3D1");
  });

  test("lets signed-out visitors see the marketing home", async () => {
    const response = await proxy(request("/"));
    assert.equal(response.headers.get("x-middleware-next"), "1");
    assert.equal(location(response), null);
  });

  test("sends signed-in, onboarded visitors from the home page to the dashboard without a profile query", async () => {
    const response = await proxy(request("/", { cookies: { ...sessionCookies(ONBOARDED.id), fitx_onboarded: ONBOARDED.id } }));
    assert.equal(location(response), "/dashboard");
    assert.equal(restCalls().length, 0);
  });

  test("routes unfinished accounts to onboarding and caches finished ones", async () => {
    assert.equal(location(await proxy(request("/", { cookies: sessionCookies(NEWCOMER.id) }))), "/onboarding");
    const finished = await proxy(request("/dashboard", { cookies: sessionCookies(ONBOARDED.id) }));
    assert.equal(location(finished), null);
    assert.match(cookieNamed(finished, "fitx_onboarded") ?? "", new RegExp(`^fitx_onboarded=${ONBOARDED.id};.*HttpOnly`, "i"));
  });

  test("a signed-in visitor on the sign-in page goes where they asked, never off-site", async () => {
    const cookies = { ...sessionCookies(ONBOARDED.id), fitx_onboarded: ONBOARDED.id };
    assert.equal(location(await proxy(request("/signin?next=%2Fnutrition", { cookies }))), "/nutrition");
    assert.equal(location(await proxy(request("/signin?next=https%3A%2F%2Fevil.example", { cookies }))), "/dashboard");
    for (const next of ["/..//evil.example", "%2F.%2F%2Fevil.example%2Fphish", "/%2e%2e//evil.example"]) {
      const response = await proxy(request(`/signin?next=${next}`, { cookies }));
      assert.equal(new URL(response.headers.get("location")!).host, "fitnessx.vercel.app", next);
    }
  });

  test("never bounces anyone when the profile can't be read", async () => {
    fake.profileError = { status: 500, code: "XX000", message: "database unavailable" };
    const response = await proxy(request("/", { cookies: sessionCookies(ONBOARDED.id) }));
    assert.equal(location(response), null);
  });

  test("an expired session is refreshed and the new cookies ride on the redirect", async () => {
    const response = await proxy(request("/signin", { cookies: { ...sessionCookies(ONBOARDED.id, -60), fitx_onboarded: ONBOARDED.id } }));
    assert.equal(location(response), "/dashboard");
    assert.ok(cookieNamed(response, SESSION_COOKIE), "refreshed session cookie is set on the redirect");
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  });

  test("a revoked session signs out cleanly", async () => {
    const session = fake.issueSession(ONBOARDED.id, -60);
    fake.refreshTokens.get(session.refresh_token)!.used = true;
    const response = await proxy(request("/dashboard", { cookies: { [SESSION_COOKIE]: ssrCookieValue(session), fitx_auth: "1" } }));
    assert.equal(location(response), "/signin?next=%2Fdashboard");
    assert.match(cookieNamed(response, "fitx_auth") ?? "", /Max-Age=0/i);
  });

  test("recovers sign-in codes Supabase delivered to the wrong page", async () => {
    assert.equal(location(await proxy(request(`/?code=${CODE}`))), `/auth/callback?code=${CODE}`);
    assert.equal(location(await proxy(request(`/workouts?code=${CODE}&x=1`))), `/auth/callback?code=${CODE}&next=%2Fworkouts%3Fx%3D1`);
    assert.equal(location(await proxy(request("/nutrition?code=coupon42"))), "/signin?next=%2Fnutrition%3Fcode%3Dcoupon42");
    assert.equal(location(await proxy(request("/?error=access_denied&error_description=denied"))), "/auth/callback?error=access_denied&error_description=denied");
  });

  test("in production, other Vercel hosts are sent to the one sign-in host", async () => {
    process.env.VERCEL_ENV = "production";
    try {
      const response = await proxy(request("/signin?next=%2Fgoals", { host: "fitnessx-abc123-team.vercel.app" }));
      assert.equal(response.status, 307);
      assert.equal(response.headers.get("location"), `${SITE}/signin?next=%2Fgoals`);
      const sneaky = await proxy(request("//evil.example/phish", { host: "fitnessx-abc123-team.vercel.app" }));
      assert.equal(new URL(sneaky.headers.get("location")!).host, "fitnessx.vercel.app");
      const local = await proxy(request("/", { host: "localhost:3000" }));
      assert.equal(location(local), null, "non-Vercel hosts are never redirected");
    } finally {
      delete process.env.VERCEL_ENV;
    }
  });

  test("marks the sign-in hint and the intro state for existing sessions", async () => {
    const response = await proxy(request("/dashboard", { cookies: { ...sessionCookies(ONBOARDED.id), fitx_onboarded: ONBOARDED.id } }));
    assert.match(cookieNamed(response, "fitx_auth") ?? "", /^fitx_auth=1;/);
    assert.match(cookieNamed(response, "fitx_intro") ?? "", /^fitx_intro=seen;/);
  });
});

describe("auth callback", () => {
  test("exchanges the code, sets the session and hint cookies, and plays the film once for a new account", async () => {
    fake.codes.set(CODE, { userId: NEWCOMER.id, verifier: "verifier-123" });
    const response = await callback.GET(request(`/auth/callback?code=${CODE}&next=%2Fdashboard`, { cookies: { [`${SESSION_COOKIE}-code-verifier`]: ssrCookieValue("verifier-123/") } }));
    assert.equal(location(response), "/onboarding");
    assert.ok(cookieNamed(response, SESSION_COOKIE));
    assert.match(cookieNamed(response, "fitx_auth") ?? "", /^fitx_auth=1;/);
    assert.match(cookieNamed(response, "fitx_intro") ?? "", /^fitx_intro=play;.*Max-Age=86400/i);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  });

  test("returning accounts go to the page they asked for, with the film already seen", async () => {
    fake.codes.set(CODE, { userId: ONBOARDED.id, verifier: "v2" });
    const response = await callback.GET(request(`/auth/callback?code=${CODE}&next=%2Fprogress`, { cookies: { [`${SESSION_COOKIE}-code-verifier`]: ssrCookieValue("v2/") } }));
    assert.equal(location(response), "/progress");
    assert.match(cookieNamed(response, "fitx_onboarded") ?? "", new RegExp(`^fitx_onboarded=${ONBOARDED.id};`));
    assert.match(cookieNamed(response, "fitx_intro") ?? "", /^fitx_intro=seen;/);
  });

  test("password-reset links land on the reset form even before onboarding", async () => {
    fake.codes.set(CODE, { userId: NEWCOMER.id, verifier: "v3" });
    const response = await callback.GET(request(`/auth/callback?code=${CODE}&next=%2Freset-password`, { cookies: { [`${SESSION_COOKIE}-code-verifier`]: ssrCookieValue("v3/") } }));
    assert.equal(location(response), "/reset-password");
  });

  test("before the intro migration, nobody is shown the film by mistake", async () => {
    fake.introColumnMissing = true;
    fake.codes.set(CODE, { userId: NEWCOMER.id, verifier: "v4" });
    const response = await callback.GET(request(`/auth/callback?code=${CODE}`, { cookies: { [`${SESSION_COOKIE}-code-verifier`]: ssrCookieValue("v4/") } }));
    assert.equal(location(response), "/onboarding");
    assert.match(cookieNamed(response, "fitx_intro") ?? "", /^fitx_intro=seen;/);
  });

  test("explains a link opened in another browser, a cancelled Google sign-in and an expired link", async () => {
    assert.equal(location(await callback.GET(request(`/auth/callback?code=${CODE}`))), "/signin?error=browser");
    assert.equal(location(await callback.GET(request("/auth/callback?error=access_denied"))), "/signin?error=cancelled");
    assert.equal(location(await callback.GET(request("/auth/callback?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired"))), "/signin?error=expired");
    assert.equal(location(await callback.GET(request("/auth/callback?error=server_error&error_code=otp_expired"))), "/signin?error=expired");
  });

  test("never redirects off-site after sign-in", async () => {
    fake.codes.set(CODE, { userId: ONBOARDED.id, verifier: "v5" });
    const response = await callback.GET(request(`/auth/callback?code=${CODE}&next=%2F%09%2Fevil.example`, { cookies: { [`${SESSION_COOKIE}-code-verifier`]: ssrCookieValue("v5/") } }));
    assert.equal(location(response), "/dashboard");
  });
});

describe("session route", () => {
  test("re-sends the session cookies from the server with a long lifetime", async () => {
    const cookies = sessionCookies(ONBOARDED.id);
    const response = await sessionRoute.POST(request("/api/auth/session", { method: "POST", cookies, body: { intent: "refresh" }, headers: { "sec-fetch-site": "same-origin" } }));
    assert.equal(response.status, 200);
    const line = cookieNamed(response, SESSION_COOKIE) ?? "";
    assert.ok(line.startsWith(`${SESSION_COOKIE}=${cookies[SESSION_COOKIE]};`), "same value");
    assert.match(line, /Max-Age=34560000/i);
    assert.match(line, /Secure/i);
  });

  test("refuses requests from other sites", async () => {
    const response = await sessionRoute.POST(request("/api/auth/session", { method: "POST", cookies: sessionCookies(ONBOARDED.id), body: { intent: "refresh" }, headers: { "sec-fetch-site": "cross-site" } }));
    assert.equal(response.status, 403);
  });

  test("after a password sign-in, says where to go and sets the hint cookies", async () => {
    const response = await sessionRoute.POST(request("/api/auth/session", { method: "POST", cookies: sessionCookies(ONBOARDED.id), body: { intent: "sign-in", next: "/goals" }, headers: { "sec-fetch-site": "same-origin" } }));
    assert.deepEqual(await response.json(), { destination: "/goals" });
    assert.match(cookieNamed(response, "fitx_auth") ?? "", /^fitx_auth=1;/);
    const signedOut = await sessionRoute.POST(request("/api/auth/session", { method: "POST", body: { intent: "sign-in" }, headers: { "sec-fetch-site": "same-origin" } }));
    assert.equal(signedOut.status, 401);
  });
});

describe("intro completion route", () => {
  test("remembers the film on the device and on the account, only once", async () => {
    fake.profiles.set(NEWCOMER.id, { onboarded: true, intro_completed_at: null });
    const response = await introRoute.POST(request("/api/intro/complete", { method: "POST", cookies: sessionCookies(NEWCOMER.id), headers: { "sec-fetch-site": "same-origin" } }));
    assert.equal(response.status, 204);
    assert.match(cookieNamed(response, "fitx_intro") ?? "", /^fitx_intro=seen;/);
    assert.equal(fake.patches.length, 1);
    assert.match(fake.patches[0].query, /intro_completed_at=is\.null/);
    assert.ok(fake.profiles.get(NEWCOMER.id)?.intro_completed_at);
  });
});
