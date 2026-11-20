// The proxy and the sign-in callback against hostile input: session cookies that are not sessions, broken percent
// escapes, oversized codes. Nothing may answer 500 or loop; an unreadable session signs the device out cleanly.
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeSupabase, SESSION_COOKIE, ssrCookieValue } from "../support/fake-supabase.ts";

const fake = await new FakeSupabase().start();
process.env.NEXT_PUBLIC_SUPABASE_URL = fake.url;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
delete process.env.VERCEL_ENV;

const { NextRequest } = await import("next/server");
const { proxy } = await import("@/proxy");
const callback = await import("@/app/auth/callback/route");

after(() => fake.stop());

const b64 = (text: string) => `base64-${Buffer.from(text).toString("base64url")}`;
const HOSTILE_COOKIES: Record<string, string> = {
  "not base64": `${SESSION_COOKIE}=base64-!!!!`,
  "not JSON": `${SESSION_COOKIE}=${b64("{nope")}`,
  "broken escape": `${SESSION_COOKIE}=%E0%A4%A`,
  "an array": `${SESSION_COOKIE}=${b64("[1,2]")}`,
  "null": `${SESSION_COOKIE}=${b64("null")}`,
  "wrong field types": `${SESSION_COOKIE}=${ssrCookieValue({ access_token: 5, refresh_token: {}, expires_at: "soon", user: [] })}`,
  "broken chunks": `${SESSION_COOKIE}.0=base64-abc; ${SESSION_COOKIE}.1=%%%`,
  "broken hint cookies": "fitx_onboarded=%; fitx_intro=%ZZ; fitx_auth=%",
};
const PATHS = ["/dashboard", "/", "/signin?next=%E0%A4%A", "/?code=3b241101-e2bb-4255-8caf-4136c566a962&next=%ZZ", "/dashboard?x=%%%", "/pricing"];

function request(path: string, cookie: string) {
  return new NextRequest(new URL(path, "https://fitnessx.vercel.app"), { headers: { host: "fitnessx.vercel.app", "x-forwarded-proto": "https", cookie } });
}
const cleared = (response: Response) => response.headers.getSetCookie().filter((line) => line.startsWith(SESSION_COOKIE) && /Max-Age=0/i.test(line));

describe("proxy: hostile cookies and query strings", () => {
  for (const [name, cookie] of Object.entries(HOSTILE_COOKIES)) {
    test(`a session cookie that is ${name} never fails a page`, async () => {
      for (const path of PATHS) {
        const response = await proxy(request(path, cookie));
        assert.ok(response.status < 500, `${path}: ${response.status}`);
        const location = response.headers.get("location");
        if (location) assert.equal(new URL(location).origin, "https://fitnessx.vercel.app", `${path} stays on the site`);
      }
    });
  }

  test("an unreadable session signs the device out: private pages go to sign in and the cookie is cleared", async () => {
    const cookie = HOSTILE_COOKIES["wrong field types"];
    const page = await proxy(request("/dashboard?tab=week", cookie));
    assert.equal(page.status, 307);
    assert.equal(new URL(page.headers.get("location")!).pathname + new URL(page.headers.get("location")!).search, "/signin?next=%2Fdashboard%3Ftab%3Dweek");
    assert.equal(cleared(page).length, 1, "the unreadable session cookie is cleared");
    const signIn = await proxy(request("/signin", cookie));
    assert.equal(signIn.status, 200, "sign-in opens, so the person can sign in again");
    assert.equal(cleared(signIn).length, 1);
    // The page renders without the cookie too (Next passes the edited request cookies on).
    assert.doesNotMatch(signIn.headers.get("x-middleware-request-cookie") ?? "", new RegExp(SESSION_COOKIE));
  });
});

describe("sign-in callback: codes", () => {
  const callbackRequest = (query: string) => new NextRequest(new URL(`/auth/callback?${query}`, "https://fitnessx.vercel.app"), { headers: { host: "fitnessx.vercel.app" } });
  test("a code that is too long or not code-shaped goes back to sign in without reaching Supabase", async () => {
    fake.reset();
    for (const code of ["x".repeat(600), "abc def", "<script>", "a/b"]) {
      const response = await callback.GET(callbackRequest(`code=${encodeURIComponent(code)}`));
      assert.equal(response.status, 307, code);
      assert.equal(new URL(response.headers.get("location")!).pathname + new URL(response.headers.get("location")!).search, "/signin?error=callback");
    }
    assert.equal(fake.calls.length, 0);
  });

  test("an off-site next is never followed", async () => {
    const response = await callback.GET(callbackRequest("code=unknown-code&next=%2F%2Fevil.example"));
    assert.equal(new URL(response.headers.get("location")!).origin, "https://fitnessx.vercel.app");
  });
});
