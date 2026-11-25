// A member suspended in FITX Admin (banned in Supabase Auth, error code user_banned) is told so at every sign-in
// step: a password, sending or checking an email code, and the Google or email-link callback.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FakeSupabase, SESSION_COOKIE, ssrCookieValue } from "../support/fake-supabase.ts";

const fake = await new FakeSupabase().start();
process.env.NEXT_PUBLIC_SUPABASE_URL = fake.url;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
delete process.env.VERCEL_ENV;

const { NextRequest } = await import("next/server");
const callback = await import("@/app/auth/callback/route");
const { passwordSignInProblem, sendCodeProblem, verifyCodeProblem } = await import("@/lib/auth/email-code");
const { SUSPENDED_MESSAGE } = await import("@/lib/platform/account-status");

const source = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const BANNED = { name: "AuthApiError", code: "user_banned", status: 403, message: "User is banned" };
const CODE = "5d1e2c8a-0b7f-4c3e-9a61-2f4b8d7e6c10";

const realFetch = globalThis.fetch;
/** Supabase refusing the code exchange for a banned account. */
let banExchange = false;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (banExchange && target.includes("/auth/v1/token") && target.includes("grant_type=pkce")) {
    return new Response(JSON.stringify({ code: 403, error_code: "user_banned", msg: "User is banned" }), { status: 403, headers: { "Content-Type": "application/json" } });
  }
  return realFetch(input, init);
}) as typeof fetch;

after(async () => {
  globalThis.fetch = realFetch;
  await fake.stop();
});

const request = (path: string, cookies: Record<string, string> = {}) => {
  const cookie = Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join("; ");
  return new NextRequest(new URL(path, "https://fitnessx.vercel.app"), {
    headers: { host: "fitnessx.vercel.app", "x-forwarded-proto": "https", ...(cookie ? { cookie } : {}) },
  });
};
const location = (response: Response) => {
  const value = response.headers.get("location");
  return value ? new URL(value).pathname + new URL(value).search : null;
};

test("a password sign-in of a suspended account says it is suspended", () => {
  assert.equal(passwordSignInProblem(BANNED), SUSPENDED_MESSAGE);
  // The other answers are as before.
  assert.equal(passwordSignInProblem({ message: "Invalid login credentials" }), "That email and password don’t match. Try again, or use a code.");
  assert.equal(passwordSignInProblem({ message: "Email not confirmed" }), "Confirm your email address first, or sign in with a code.");
  assert.equal(passwordSignInProblem({ message: "Something else" }), "We couldn’t sign you in. Please try again.");
  assert.equal(passwordSignInProblem(null), "We couldn’t sign you in. Please try again.");
});

test("sending or checking an email code for a suspended account says it is suspended", () => {
  assert.deepEqual(sendCodeProblem(BANNED), { message: SUSPENDED_MESSAGE, retryAfter: null });
  assert.equal(verifyCodeProblem(BANNED), SUSPENDED_MESSAGE);
  // A rate limit or a wrong code still reads as before.
  assert.equal(sendCodeProblem({ code: "over_email_send_rate_limit", status: 429, message: "email rate limit exceeded" }).message, "Too many codes asked for. Try again in a few minutes.");
  assert.equal(verifyCodeProblem({ code: "otp_expired", message: "Token has expired or is invalid" }), "That code is wrong or has expired. Check it, or send a new one.");
});

test("the Google or email-link callback sends a suspended account to sign-in with the reason", async () => {
  for (const query of [
    "error=access_denied&error_code=user_banned&error_description=User+is+banned",
    "error=server_error&error_code=user_banned",
    "error_code=user_banned",
  ]) {
    const response = await callback.GET(request(`/auth/callback?${query}`));
    assert.equal(location(response), "/signin?error=suspended", query);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/, query);
  }
  // Other provider errors keep their own reasons.
  assert.equal(location(await callback.GET(request("/auth/callback?error=access_denied"))), "/signin?error=cancelled");
  assert.equal(location(await callback.GET(request("/auth/callback?error=access_denied&error_code=otp_expired"))), "/signin?error=expired");
});

test("a code exchange Supabase refuses for a banned account is explained too", async () => {
  banExchange = true;
  try {
    fake.codes.set(CODE, { userId: "unused", verifier: "v-banned" });
    const response = await callback.GET(request(`/auth/callback?code=${CODE}`, { [`${SESSION_COOKIE}-code-verifier`]: ssrCookieValue("v-banned/") }));
    assert.equal(location(response), "/signin?error=suspended");
  } finally {
    banExchange = false;
  }
});

test("the sign-in page shows the message for ?error=suspended and for password and code failures", () => {
  // The address's messages live in src/lib/auth/address-messages.ts since bug 42; the sign-in page shows them.
  assert.match(source("src/lib/auth/address-messages.ts"), /suspended: SUSPENDED_MESSAGE,/);
  const form = source("src/app/(auth)/signin/SignInForm.tsx");
  assert.match(form, /addressError\(window\.location\.search\)/);
  assert.match(form, /setError\(passwordSignInProblem\(authError\)\)/);
  const codeFlow = source("src/components/auth/useEmailCode.ts");
  assert.match(codeFlow, /sendCodeProblem\(authError\)/);
  assert.match(codeFlow, /setError\(verifyCodeProblem\(authError\)\)/);
});
