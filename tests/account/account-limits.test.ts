// Account deletion with the real burst limit and a bounded body: abuse gets 413 or 429, never 500.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import "../billing/support/server-only.mjs";
import { FakeAccountServer, SESSION_COOKIE, ssrCookieValue } from "../support/fake-account-server.ts";

const fake = await new FakeAccountServer().start();
process.env.NEXT_PUBLIC_SUPABASE_URL = fake.url;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
const { NextRequest } = await import("next/server");
const route = await import("@/app/api/account/route");

const ME = { id: "55555555-5555-4555-8555-555555555555", email: "limits@example.test" };

function remove(body: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL("/api/account", "https://fitnessx.vercel.app"), {
    method: "DELETE",
    headers: {
      host: "fitnessx.vercel.app", "x-forwarded-proto": "https", "content-type": "application/json", "sec-fetch-site": "same-origin",
      cookie: `${SESSION_COOKIE}=${ssrCookieValue(fake.session(ME.id, 60))}`, ...headers,
    },
    body,
  });
}

before(() => {
  fake.addUser(ME.id, ME.email);
  process.env.SUPABASE_SECRET_KEY = fake.secretKey;
});
after(() => fake.stop());

test("an oversized body is 413 and deletes nothing", async () => {
  const response = await route.DELETE(remove(JSON.stringify({ confirm: "DELETE", expectedUserId: ME.id, pad: "x".repeat(5000) })));
  assert.equal(response.status, 413);
  assert.ok(fake.users.has(ME.id));
});

test("after five attempts in ten minutes the sixth is 429 with Retry-After", async () => {
  // Wrong confirmations: refused with 400, but each still counts as an attempt (one was taken above).
  for (let i = 0; i < 4; i += 1) assert.equal((await route.DELETE(remove(JSON.stringify({ confirm: "nope" })))).status, 400);
  const limited = await route.DELETE(remove(JSON.stringify({ confirm: "DELETE", expectedUserId: ME.id })));
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  assert.equal(limited.headers.get("cache-control"), "private, no-store");
  assert.ok(fake.users.has(ME.id), "nothing was deleted");
});
