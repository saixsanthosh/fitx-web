import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeSupabase, SESSION_COOKIE, ssrCookieValue } from "../support/fake-supabase.ts";

const fake = await new FakeSupabase().start();
process.env.NEXT_PUBLIC_SUPABASE_URL = fake.url;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
delete process.env.VERCEL_ENV;

const { NextRequest } = await import("next/server");
const { proxy, config } = await import("@/proxy");
const { ACCOUNT_NAV, MAIN_NAV } = await import("@/config/navigation");
const callback = await import("@/app/auth/callback/route");
const sessionRoute = await import("@/app/api/auth/session/route");
const introRoute = await import("@/app/api/intro/complete/route");
const { unstable_doesMiddlewareMatch } = await import("next/experimental/testing/server.js");

const ONBOARDED = { id: "11111111-1111-4111-8111-111111111111", email: "done@example.test" };
const NEWCOMER = { id: "22222222-2222-4222-8222-222222222222", email: "new@example.test" };
/** Set up long ago, but its film was reset (intro_completed_at null), like the 7 accounts on 2026-11-17. */
const RESET = { id: "33333333-3333-4333-8333-333333333333", email: "reset@example.test" };
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
/** The columns each profile query asked for. */
const profileSelects = () => restCalls().map((call) => new URL(call.path, fake.url).searchParams.get("select"));
const filmCookies = (response: Response) => setCookies(response).filter((line) => /^fitx_(intro|intro_checked|onboarded)=/.test(line));

before(() => {
  fake.addUser(ONBOARDED, { onboarded: true, intro_completed_at: "2026-11-01T00:00:00Z" });
  fake.addUser(NEWCOMER, { onboarded: false, intro_completed_at: null });
  fake.addUser(RESET, { onboarded: true, intro_completed_at: null });
});
beforeEach(() => fake.reset());
after(() => fake.stop());

describe("proxy", () => {
  test("matches pages but not assets, API routes, the film or the pose runtime", async () => {
    for (const url of ["/", "/dashboard", "/signin", "/workouts/active", "/activity/record", "/form-coach", "/help"]) {
      assert.equal(unstable_doesMiddlewareMatch({ config, url }), true, url);
    }
    for (const url of [
      "/api/foods/search", "/brand/intro/fitx-intro-light-portrait-60.mp4", "/manifest.webmanifest", "/_next/static/chunks/a.js", "/icon.svg",
      // The camera form coach's self-hosted MediaPipe runtime (11 MB) and models skip the session check.
      "/models/pose/wasm-0.10.35/vision_wasm_internal.js", "/models/pose/wasm-0.10.35/vision_wasm_internal.wasm",
      "/models/pose/landmarker-float16-v1/pose_landmarker_lite.task",
    ]) {
      assert.equal(unstable_doesMiddlewareMatch({ config, url }), false, url);
    }
  });

  test("sends signed-out visitors from private pages to sign in, keeping where they were going", async () => {
    const response = await proxy(request("/workouts?plan=1"));
    assert.equal(response.status, 307);
    assert.equal(location(response), "/signin?next=%2Fworkouts%3Fplan%3D1");
  });

  test("activity, the form coach and help need a sign-in too", async () => {
    for (const [path, next] of [
      ["/activity", "%2Factivity"],
      ["/activity/record", "%2Factivity%2Frecord"],
      ["/form-coach?exercise=squat", "%2Fform-coach%3Fexercise%3Dsquat"],
      ["/help?from=%2Fworkouts", "%2Fhelp%3Ffrom%3D%252Fworkouts"],
    ]) {
      const response = await proxy(request(path));
      assert.equal(response.status, 307, path);
      assert.equal(location(response), `/signin?next=${next}`, path);
    }
    // A public page that only starts with a private root's name stays public.
    assert.equal(location(await proxy(request("/helpful-tips"))), null);
  });

  test("every page in the app navigation is private", async () => {
    for (const { href } of [...MAIN_NAV, ...ACCOUNT_NAV]) {
      assert.equal(location(await proxy(request(href))), `/signin?next=${encodeURIComponent(href)}`, href);
    }
  });

  test("lets signed-out visitors see the marketing home", async () => {
    const response = await proxy(request("/"));
    assert.equal(response.headers.get("x-middleware-next"), "1");
    assert.equal(location(response), null);
  });

  test("sends signed-in, onboarded visitors from the home page to the dashboard without a profile query", async () => {
    // The device already knows both answers: onboarding (fitx_onboarded) and the film (fitx_intro_checked + fitx_intro).
    const cookies = { ...sessionCookies(ONBOARDED.id), fitx_onboarded: ONBOARDED.id, fitx_intro: "seen", fitx_intro_checked: ONBOARDED.id };
    const response = await proxy(request("/", { cookies }));
    assert.equal(location(response), "/dashboard");
    assert.equal(restCalls().length, 0);
  });

  test("routes unfinished accounts to onboarding and caches finished ones", async () => {
    assert.equal(location(await proxy(request("/", { cookies: sessionCookies(NEWCOMER.id) }))), "/onboarding");
    const finished = await proxy(request("/dashboard", { cookies: sessionCookies(ONBOARDED.id) }));
    assert.equal(location(finished), null);
    assert.match(cookieNamed(finished, "fitx_onboarded") ?? "", new RegExp(`^fitx_onboarded=${ONBOARDED.id};.*HttpOnly`, "i"));
  });

  test("an account still in setup can open Help, but no other app page", async () => {
    const cookies = sessionCookies(NEWCOMER.id);
    for (const path of ["/help", "/help?from=%2Fonboarding", "/onboarding"]) {
      const response = await proxy(request(path, { cookies }));
      assert.equal(location(response), null, path);
      assert.equal(response.headers.get("x-middleware-next"), "1", path);
      assert.equal(cookieNamed(response, "fitx_onboarded"), undefined, `${path} does not mark the account as set up`);
    }
    // Every other app page, the sign-in pages, the home page and anything below Help go back to setup.
    for (const path of ["/dashboard", "/settings", "/profile", "/workouts", "/ai-coach", "/activity/record", "/subscription", "/help/anything", "/signin", "/"]) {
      assert.equal(location(await proxy(request(path, { cookies }))), "/onboarding", path);
    }
    // Finished accounts open Help as before, and are sent on from onboarding.
    const finished = { ...sessionCookies(ONBOARDED.id), fitx_onboarded: ONBOARDED.id };
    assert.equal(location(await proxy(request("/help", { cookies: finished }))), null);
    assert.equal(location(await proxy(request("/onboarding", { cookies: finished }))), "/dashboard");
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

  test("marks the sign-in hint for existing sessions and takes the film's state from the account", async () => {
    // Until 2026-11-17 a device without fitx_intro was simply marked seen; now the account says.
    const response = await proxy(request("/dashboard", { cookies: { ...sessionCookies(ONBOARDED.id), fitx_onboarded: ONBOARDED.id } }));
    assert.match(cookieNamed(response, "fitx_auth") ?? "", /^fitx_auth=1;/);
    assert.match(cookieNamed(response, "fitx_intro") ?? "", /^fitx_intro=seen;/);
    assert.match(cookieNamed(response, "fitx_intro_checked") ?? "", new RegExp(`^fitx_intro_checked=${ONBOARDED.id};`));
  });
});

describe("proxy: the account's one-time film on a device that is already signed in", () => {
  // The 7 reset accounts' devices hold fitx_intro=seen, because the server only says "play" at sign-in.
  const resetDevice = () => ({ ...sessionCookies(RESET.id), fitx_auth: "1", fitx_onboarded: RESET.id, fitx_intro: "seen" });
  beforeEach(() => fake.profiles.set(RESET.id, { onboarded: true, intro_completed_at: null }));

  test("plays it on the next app page when the account hasn't seen it, and remembers the check", async () => {
    const response = await proxy(request("/dashboard", { cookies: resetDevice() }));
    assert.equal(location(response), null);
    assert.equal(response.headers.get("x-middleware-next"), "1");
    const play = cookieNamed(response, "fitx_intro") ?? "";
    assert.match(play, /^fitx_intro=play;/);
    assert.match(play, /Max-Age=86400/i, "a pending play lasts a day, as at sign-in");
    assert.doesNotMatch(play, /HttpOnly/i, "the head script reads it");
    const checked = cookieNamed(response, "fitx_intro_checked") ?? "";
    assert.match(checked, new RegExp(`^fitx_intro_checked=${RESET.id};`));
    assert.match(checked, /HttpOnly/i);
    assert.match(checked, /Secure/i);
    assert.match(checked, /SameSite=lax/i);
    assert.match(checked, /Max-Age=34560000/i);
    assert.deepEqual(profileSelects(), ["intro_completed_at"], "one query, for the film only: onboarding is cached");
  });

  test("on the home page the play rides on the redirect to the dashboard", async () => {
    const response = await proxy(request("/", { cookies: resetDevice() }));
    assert.equal(location(response), "/dashboard");
    assert.match(cookieNamed(response, "fitx_intro") ?? "", /^fitx_intro=play;/);
    assert.match(cookieNamed(response, "fitx_intro_checked") ?? "", new RegExp(`^fitx_intro_checked=${RESET.id};`));
  });

  test("an account that has seen it gets seen", async () => {
    const response = await proxy(request("/workouts", { cookies: { ...sessionCookies(ONBOARDED.id), fitx_auth: "1", fitx_onboarded: ONBOARDED.id, fitx_intro: "seen" } }));
    const seen = cookieNamed(response, "fitx_intro") ?? "";
    assert.match(seen, /^fitx_intro=seen;/);
    assert.match(seen, /Max-Age=34560000/i);
    assert.match(cookieNamed(response, "fitx_intro_checked") ?? "", new RegExp(`^fitx_intro_checked=${ONBOARDED.id};`));
  });

  test("a device already checked for this account makes no profile query and changes nothing", async () => {
    for (const film of ["seen", "play"]) {
      const cookies = { ...resetDevice(), fitx_intro: film, fitx_intro_checked: RESET.id };
      for (const path of ["/dashboard", "/workouts", "/activity/record", "/help", "/", "/signin"]) {
        const response = await proxy(request(path, { cookies }));
        assert.deepEqual(filmCookies(response), [], `${film} ${path}`);
      }
    }
    assert.equal(restCalls().length, 0);
  });

  test("a second account on the same device is checked for itself, in the one onboarding query", async () => {
    // The device was checked for someone else, and doesn't know this account's onboarding yet.
    const cookies = { ...sessionCookies(RESET.id), fitx_auth: "1", fitx_intro: "seen", fitx_intro_checked: ONBOARDED.id };
    const response = await proxy(request("/nutrition", { cookies }));
    assert.equal(location(response), null);
    assert.match(cookieNamed(response, "fitx_intro") ?? "", /^fitx_intro=play;/);
    assert.match(cookieNamed(response, "fitx_intro_checked") ?? "", new RegExp(`^fitx_intro_checked=${RESET.id};`));
    assert.match(cookieNamed(response, "fitx_onboarded") ?? "", new RegExp(`^fitx_onboarded=${RESET.id};`));
    assert.deepEqual(profileSelects(), ["onboarded,intro_completed_at"], "never a second profile query");
  });

  test("a play that expired unwatched is checked again on the next request", async () => {
    // fitx_intro=play lasts a day; the check stays, but the device no longer knows the film's state.
    const cookies = { ...sessionCookies(RESET.id), fitx_auth: "1", fitx_onboarded: RESET.id, fitx_intro_checked: RESET.id };
    const response = await proxy(request("/dashboard", { cookies }));
    assert.match(cookieNamed(response, "fitx_intro") ?? "", /^fitx_intro=play;/);
    assert.equal(restCalls().length, 1);
  });

  test("a failed profile read changes no cookie, and a later request tries again", async () => {
    fake.profileError = { status: 500, code: "XX000", message: "database unavailable" };
    const uncached = { ...sessionCookies(RESET.id), fitx_auth: "1", fitx_intro: "seen" };
    for (const cookies of [resetDevice(), uncached]) {
      const response = await proxy(request("/dashboard", { cookies }));
      assert.equal(location(response), null, "never bounced");
      assert.deepEqual(setCookies(response), [], "no cookie set or cleared");
    }
    fake.profileError = null;
    const retried = await proxy(request("/dashboard", { cookies: resetDevice() }));
    assert.match(cookieNamed(retried, "fitx_intro") ?? "", /^fitx_intro=play;/);
    assert.match(cookieNamed(retried, "fitx_intro_checked") ?? "", new RegExp(`^fitx_intro_checked=${RESET.id};`));
  });

  test("before the intro migration the film counts as seen, still with one profile query per request", async () => {
    fake.introColumnMissing = true;
    const response = await proxy(request("/dashboard", { cookies: resetDevice() }));
    assert.equal(location(response), null);
    assert.match(cookieNamed(response, "fitx_intro") ?? "", /^fitx_intro=seen;/);
    assert.match(cookieNamed(response, "fitx_intro_checked") ?? "", new RegExp(`^fitx_intro_checked=${RESET.id};`));

    // Onboarding not cached either: the one query for both fails, so this request can't tell onboarding
    // (like any unreadable profile, it isn't bounced) and the next one reads onboarding alone.
    fake.reset();
    fake.introColumnMissing = true;
    fake.profiles.set(NEWCOMER.id, { onboarded: false, intro_completed_at: null });
    const first = await proxy(request("/dashboard", { cookies: { ...sessionCookies(NEWCOMER.id), fitx_auth: "1" } }));
    assert.equal(location(first), null);
    assert.match(cookieNamed(first, "fitx_intro") ?? "", /^fitx_intro=seen;/);
    assert.equal(cookieNamed(first, "fitx_onboarded"), undefined);
    const next = await proxy(request("/dashboard", { cookies: { ...sessionCookies(NEWCOMER.id), fitx_auth: "1", fitx_intro: "seen", fitx_intro_checked: NEWCOMER.id } }));
    assert.equal(location(next), "/onboarding");
    assert.deepEqual(profileSelects(), ["onboarded,intro_completed_at", "onboarded"]);
  });

  test("plays once: after the film starts, no check on any device says play again", async () => {
    const first = await proxy(request("/dashboard", { cookies: resetDevice() }));
    assert.match(cookieNamed(first, "fitx_intro") ?? "", /^fitx_intro=play;/);
    // The head script consumes the play (fitx_intro=seen) and the dashboard reports that the film started.
    const device = { ...resetDevice(), fitx_intro: "seen", fitx_intro_checked: RESET.id };
    const started = await introRoute.POST(request("/api/intro/complete", { method: "POST", cookies: device, headers: { "sec-fetch-site": "same-origin" } }));
    assert.equal(started.status, 204);
    assert.ok(fake.profiles.get(RESET.id)?.intro_completed_at, "recorded on the account");
    fake.reset();
    for (const path of ["/dashboard", "/workouts", "/"]) assert.deepEqual(filmCookies(await proxy(request(path, { cookies: device }))), [], path);
    assert.equal(restCalls().length, 0, "this device asks no more");
    // Another device of the account (or this one once its cookie is gone) is told seen.
    const other = await proxy(request("/dashboard", { cookies: { ...sessionCookies(RESET.id), fitx_auth: "1", fitx_onboarded: RESET.id } }));
    assert.match(cookieNamed(other, "fitx_intro") ?? "", /^fitx_intro=seen;/);
  });

  test("a signed-in visit to a public page makes no profile query and leaves the film's cookies alone", async () => {
    for (const path of ["/features", "/pricing", "/privacy", "/cookies", "/reset-password"]) {
      const response = await proxy(request(path, { cookies: { ...sessionCookies(RESET.id), fitx_auth: "1" } }));
      assert.equal(location(response), null, path);
      assert.deepEqual(filmCookies(response), [], path);
    }
    assert.equal(restCalls().length, 0);
  });

  test("signing out clears the account's cookies on the next request, but keeps the film's state", async () => {
    // Log out signs out in the browser, clears fitx_auth, then opens /signin?signed_out=1.
    const response = await proxy(request("/signin?signed_out=1", { cookies: { fitx_auth: "1", fitx_onboarded: RESET.id, fitx_intro_checked: RESET.id, fitx_intro: "play" } }));
    assert.equal(location(response), null);
    for (const name of ["fitx_auth", "fitx_onboarded", "fitx_intro_checked"]) {
      const line = cookieNamed(response, name) ?? "";
      assert.match(line, new RegExp(`^${name}=;`), name);
      assert.match(line, /Max-Age=0/i, name);
    }
    assert.match(cookieNamed(response, "fitx_intro_checked") ?? "", /HttpOnly/i);
    assert.equal(cookieNamed(response, "fitx_intro"), undefined, "the film's state stays on the device");
    // A signed-out visitor without them gets nothing to clear.
    assert.deepEqual(setCookies(await proxy(request("/"))), []);
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
    // The film's state was just read from the account, so the proxy doesn't read it again for this device.
    assert.match(cookieNamed(response, "fitx_intro_checked") ?? "", new RegExp(`^fitx_intro_checked=${NEWCOMER.id};.*HttpOnly`, "i"));
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  });

  test("returning accounts go to the page they asked for, with the film already seen", async () => {
    fake.codes.set(CODE, { userId: ONBOARDED.id, verifier: "v2" });
    const response = await callback.GET(request(`/auth/callback?code=${CODE}&next=%2Fprogress`, { cookies: { [`${SESSION_COOKIE}-code-verifier`]: ssrCookieValue("v2/") } }));
    assert.equal(location(response), "/progress");
    assert.match(cookieNamed(response, "fitx_onboarded") ?? "", new RegExp(`^fitx_onboarded=${ONBOARDED.id};`));
    assert.match(cookieNamed(response, "fitx_intro") ?? "", /^fitx_intro=seen;/);
    assert.match(cookieNamed(response, "fitx_intro_checked") ?? "", new RegExp(`^fitx_intro_checked=${ONBOARDED.id};.*HttpOnly`, "i"));
  });

  test("an account whose film was reset gets it once more at sign-in, and the device is checked for it", async () => {
    fake.profiles.set(RESET.id, { onboarded: true, intro_completed_at: null });
    // The device was last checked for another account.
    fake.codes.set(CODE, { userId: RESET.id, verifier: "v8" });
    const response = await callback.GET(request(`/auth/callback?code=${CODE}`, { cookies: { [`${SESSION_COOKIE}-code-verifier`]: ssrCookieValue("v8/"), fitx_intro: "seen", fitx_intro_checked: ONBOARDED.id } }));
    assert.equal(location(response), "/dashboard");
    assert.match(cookieNamed(response, "fitx_intro") ?? "", /^fitx_intro=play;/);
    assert.match(cookieNamed(response, "fitx_intro_checked") ?? "", new RegExp(`^fitx_intro_checked=${RESET.id};`));
  });

  test("a profile that can't be read at sign-in leaves the film's check to the proxy", async () => {
    fake.profiles.set(RESET.id, { onboarded: true, intro_completed_at: null });
    fake.profileError = { status: 500, code: "XX000", message: "database unavailable" };
    fake.codes.set(CODE, { userId: RESET.id, verifier: "v9" });
    const response = await callback.GET(request(`/auth/callback?code=${CODE}`, { cookies: { [`${SESSION_COOKIE}-code-verifier`]: ssrCookieValue("v9/"), fitx_intro_checked: RESET.id } }));
    assert.match(cookieNamed(response, "fitx_intro") ?? "", /^fitx_intro=seen;/, "unknown counts as seen for now");
    assert.match(cookieNamed(response, "fitx_intro_checked") ?? "", /^fitx_intro_checked=;.*Max-Age=0/i, "an older check is cleared");
    // Once the profile reads again, the proxy finds the account hasn't seen the film.
    fake.profileError = null;
    const next = await proxy(request("/dashboard", { cookies: { ...sessionCookies(RESET.id), fitx_auth: "1", fitx_intro: "seen" } }));
    assert.match(cookieNamed(next, "fitx_intro") ?? "", /^fitx_intro=play;/);
  });

  test("an account still in setup that asked for Help goes there; any other page waits for setup", async () => {
    fake.codes.set(CODE, { userId: NEWCOMER.id, verifier: "v6" });
    const help = await callback.GET(request(`/auth/callback?code=${CODE}&next=${encodeURIComponent("/help?from=%2Fonboarding")}`, { cookies: { [`${SESSION_COOKIE}-code-verifier`]: ssrCookieValue("v6/") } }));
    assert.equal(location(help), "/help?from=%2Fonboarding");
    assert.match(cookieNamed(help, "fitx_onboarded") ?? "", /Max-Age=0/i, "not marked as set up");
    fake.codes.set(CODE, { userId: NEWCOMER.id, verifier: "v7" });
    const other = await callback.GET(request(`/auth/callback?code=${CODE}&next=%2Fhelp%2Fanything`, { cookies: { [`${SESSION_COOKIE}-code-verifier`]: ssrCookieValue("v7/") } }));
    assert.equal(location(other), "/onboarding");
  });

  test("where an account still in setup may go after signing in", async () => {
    const { destinationBeforeOnboarding, openBeforeOnboarding } = await import("@/lib/auth/before-onboarding");
    assert.equal(destinationBeforeOnboarding("/help"), "/help");
    assert.equal(destinationBeforeOnboarding("/help?from=%2Fonboarding#form"), "/help?from=%2Fonboarding#form");
    for (const next of [null, "", "/dashboard", "/helpdesk", "/help/anything", "https://evil.example/help", "//evil.example/help", "/api/support"]) {
      assert.equal(destinationBeforeOnboarding(next), "/onboarding", String(next));
    }
    assert.equal(openBeforeOnboarding("/onboarding"), true);
    assert.equal(openBeforeOnboarding("/settings"), false);
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
    assert.match(cookieNamed(response, "fitx_intro_checked") ?? "", new RegExp(`^fitx_intro_checked=${NEWCOMER.id};`));
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
    assert.match(cookieNamed(response, "fitx_intro") ?? "", /^fitx_intro=seen;/);
    assert.match(cookieNamed(response, "fitx_intro_checked") ?? "", new RegExp(`^fitx_intro_checked=${ONBOARDED.id};.*HttpOnly`, "i"));
    const signedOut = await sessionRoute.POST(request("/api/auth/session", { method: "POST", body: { intent: "sign-in" }, headers: { "sec-fetch-site": "same-origin" } }));
    assert.equal(signedOut.status, 401);
  });

  test("a password sign-in of an account whose film was reset plays it once and checks the device", async () => {
    fake.profiles.set(RESET.id, { onboarded: true, intro_completed_at: null });
    const response = await sessionRoute.POST(request("/api/auth/session", { method: "POST", cookies: { ...sessionCookies(RESET.id), fitx_intro: "seen" }, body: { intent: "sign-in" }, headers: { "sec-fetch-site": "same-origin" } }));
    assert.deepEqual(await response.json(), { destination: "/dashboard" });
    assert.match(cookieNamed(response, "fitx_intro") ?? "", /^fitx_intro=play;.*Max-Age=86400/i);
    assert.match(cookieNamed(response, "fitx_intro_checked") ?? "", new RegExp(`^fitx_intro_checked=${RESET.id};.*HttpOnly`, "i"));
    // A token refresh only re-sends the session: it never touches the film.
    const refresh = await sessionRoute.POST(request("/api/auth/session", { method: "POST", cookies: sessionCookies(RESET.id), body: { intent: "refresh" }, headers: { "sec-fetch-site": "same-origin" } }));
    assert.deepEqual(filmCookies(refresh), []);
  });

  test("after a password sign-in, an account still in setup goes to onboarding unless it asked for Help", async () => {
    const cookies = sessionCookies(NEWCOMER.id);
    const destination = async (next: string) => (await (await sessionRoute.POST(request("/api/auth/session", { method: "POST", cookies, body: { intent: "sign-in", next }, headers: { "sec-fetch-site": "same-origin" } }))).json()).destination;
    assert.equal(await destination("/help"), "/help");
    assert.equal(await destination("/goals"), "/onboarding");
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
