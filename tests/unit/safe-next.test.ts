import { test } from "node:test";
import assert from "node:assert/strict";
import { safeNext } from "@/lib/auth/safe-next";
import { authCallbackUrl } from "@/lib/site-url";

test("keeps ordinary in-app paths with their query and hash", () => {
  assert.equal(safeNext("/workouts"), "/workouts");
  assert.equal(safeNext("/nutrition?date=2026-11-17#lunch"), "/nutrition?date=2026-11-17#lunch");
  assert.equal(safeNext("/reset-password"), "/reset-password");
});

test("rejects off-site and protocol-relative targets", () => {
  for (const value of ["https://evil.example", "//evil.example", "/\\evil.example", "\\\\evil.example", "javascript:alert(1)", "evil.example"]) {
    assert.equal(safeNext(value), "/dashboard", value);
  }
});

test("rejects control characters the URL parser would strip", () => {
  for (const value of ["/\t/evil.example", "/\n/evil.example", "/\r/evil.example", "/%09/x".replace("%09", "\t"), "/\u0000x", "/\u007fx"]) {
    assert.equal(safeNext(value), "/dashboard", JSON.stringify(value));
  }
});

test("rejects dot segments that resolve to a protocol-relative URL", () => {
  for (const value of ["/..//evil.example", "/.//evil.example", "/%2e%2e//evil.example", "/a/../..//evil.example", "/././/evil.example/phish"]) {
    assert.equal(safeNext(value), "/dashboard", value);
  }
});

test("never returns to sign-in, auth, API or the marketing home", () => {
  for (const value of ["/", "/signin", "/signup", "/forgot-password", "/auth/callback?code=1", "/api/foods/search"]) {
    assert.equal(safeNext(value), "/dashboard", value);
  }
});

test("handles empty, missing and oversized input", () => {
  assert.equal(safeNext(null), "/dashboard");
  assert.equal(safeNext(undefined), "/dashboard");
  assert.equal(safeNext(""), "/dashboard");
  assert.equal(safeNext(`/${"a".repeat(3000)}`), "/dashboard");
  assert.equal(safeNext("nope", "/onboarding"), "/onboarding");
});

test("builds the auth callback URL on the given origin", () => {
  assert.equal(authCallbackUrl("/workouts", "https://fitnessx.vercel.app"), "https://fitnessx.vercel.app/auth/callback?next=%2Fworkouts");
  assert.equal(authCallbackUrl("https://evil.example", "https://fitnessx.vercel.app"), "https://fitnessx.vercel.app/auth/callback?next=%2Fdashboard");
  assert.equal(authCallbackUrl("/reset-password", "http://localhost:3000"), "http://localhost:3000/auth/callback?next=%2Freset-password");
});
