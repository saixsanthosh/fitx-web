// The proxy and a session that has ended in Supabase Auth while its access token is still within its lifetime
// (a suspension in FITX Admin, "Sign out everywhere"). With an asymmetric signing key, getClaims checks the token on
// this machine and still sees a member, while pages that ask Auth send them to sign in. The sign-in pages must not
// send them straight back (a redirect loop): they ask Auth, clear the session and open, or say the account is suspended.
import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { ssrCookieValue, SESSION_COOKIE } from "../support/fake-supabase.ts";

const USER_ID = "8f6c3c2e-0d1a-4c7e-9a51-3c1f2b7d9e40";
const KID = "test-es256-key";

const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const publicJwk = { ...(await crypto.subtle.exportKey("jwk", keys.publicKey)), kid: KID, alg: "ES256", use: "sig" };

const b64url = (value: string | Uint8Array) => Buffer.from(value).toString("base64url");
async function es256Jwt(sub: string, expiresInSeconds: number) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid: KID }));
  const payload = b64url(JSON.stringify({ sub, role: "authenticated", aud: "authenticated", iat: now, exp: now + expiresInSeconds, session_id: `s-${sub}` }));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(new Uint8Array(signature))}`;
}

/** What GET /auth/v1/user answers: the member, an ended session, a banned account, or an outage. */
let userAnswer: "active" | "ended" | "banned" | "outage" = "active";
const calls: string[] = [];

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  calls.push(url.pathname);
  const send = (status: number, payload: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  };
  if (url.pathname === "/auth/v1/.well-known/jwks.json") return send(200, { keys: [publicJwk] });
  if (url.pathname === "/auth/v1/user") {
    if (userAnswer === "active") return send(200, { id: USER_ID, email: "member@example.test", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} });
    if (userAnswer === "ended") return send(403, { code: 403, error_code: "session_not_found", msg: "Session from session_id claim in JWT does not exist" });
    if (userAnswer === "banned") return send(403, { code: 403, error_code: "user_banned", msg: "User is banned" });
    return send(503, { code: 503, msg: "Service unavailable" });
  }
  return send(404, { message: `no route for ${url.pathname}` });
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
delete process.env.VERCEL_ENV;

const { NextRequest } = await import("next/server");
const { proxy } = await import("@/proxy");

after(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  userAnswer = "active";
  calls.length = 0;
});

async function memberCookies() {
  const access = await es256Jwt(USER_ID, 3600);
  const session = {
    access_token: access,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "refresh-token",
    user: { id: USER_ID, email: "member@example.test", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  };
  // An onboarded member whose intro was already checked, so the proxy needs no profile read.
  return [`${SESSION_COOKIE}=${ssrCookieValue(session)}`, "fitx_auth=1", `fitx_onboarded=${USER_ID}`, `fitx_intro_checked=${USER_ID}`, "fitx_intro=seen"].join("; ");
}

const request = (path: string, cookie: string) =>
  new NextRequest(new URL(path, "https://fitnessx.vercel.app"), { headers: { host: "fitnessx.vercel.app", "x-forwarded-proto": "https", cookie } });
const location = (response: Response) => {
  const value = response.headers.get("location");
  return value ? `${new URL(value).pathname}${new URL(value).search}` : null;
};
const clearedCookies = (response: Response) =>
  response.headers.getSetCookie().filter((line) => /Max-Age=0/i.test(line)).map((line) => line.split("=")[0]);

describe("proxy: a locally verified token whose session has ended", () => {
  test("private pages trust the locally verified token without asking Auth", async () => {
    const response = await proxy(request("/dashboard", await memberCookies()));
    assert.equal(response.status, 200);
    assert.ok(!calls.includes("/auth/v1/user"), "no Auth round trip on ordinary pages");
  });

  test("a live session on /signin still goes straight to next", async () => {
    const response = await proxy(request("/signin?next=%2Fai-coach", await memberCookies()));
    assert.equal(response.status, 307);
    assert.equal(location(response), "/ai-coach");
    assert.ok(calls.includes("/auth/v1/user"), "Auth confirmed the session");
  });

  test("an ended session opens /signin and clears the session instead of looping back to next", async () => {
    userAnswer = "ended";
    const response = await proxy(request("/signin?next=%2Fai-coach", await memberCookies()));
    assert.equal(response.status, 200, "the sign-in page renders");
    assert.equal(location(response), null);
    const cleared = clearedCookies(response);
    for (const name of [SESSION_COOKIE, "fitx_auth", "fitx_onboarded", "fitx_intro_checked"]) assert.ok(cleared.includes(name), `${name} is cleared`);
    assert.doesNotMatch(response.headers.get("x-middleware-request-cookie") ?? "", new RegExp(SESSION_COOKIE), "the page renders signed out");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  });

  test("the same holds for sign-up and forgot password", async () => {
    userAnswer = "ended";
    for (const path of ["/signup", "/forgot-password"]) {
      const response = await proxy(request(path, await memberCookies()));
      assert.equal(response.status, 200, path);
      assert.ok(clearedCookies(response).includes(SESSION_COOKIE), `${path} clears the session`);
    }
  });

  test("a suspended account is sent to /signin?error=suspended with its next kept, and signed out", async () => {
    userAnswer = "banned";
    const response = await proxy(request("/signin?next=%2Fhelp", await memberCookies()));
    assert.equal(response.status, 307);
    assert.equal(location(response), "/signin?error=suspended&next=%2Fhelp");
    assert.ok(clearedCookies(response).includes(SESSION_COOKIE));
    // Already on the suspended notice: render it, never redirect again.
    const notice = await proxy(request("/signin?error=suspended&next=%2Fhelp", await memberCookies()));
    assert.equal(notice.status, 200);
    assert.ok(clearedCookies(notice).includes(SESSION_COOKIE));
  });

  test("when Auth can't answer, /signin renders and the session is kept", async () => {
    userAnswer = "outage";
    const response = await proxy(request("/signin?next=%2Fai-coach", await memberCookies()));
    assert.equal(response.status, 200, "no redirect, so no loop");
    assert.ok(!clearedCookies(response).includes(SESSION_COOKIE), "an outage never signs anyone out");
  });
});
