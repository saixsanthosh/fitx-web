// Google Identity Services sign-in (src/lib/auth/google-identity.ts, src/components/auth/GoogleSignIn.tsx): the nonce
// pair, the client id switch shared with the CSP, the fallback to the redirect flow and the shared finish.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { createNonce, googleClientIdFrom, GIS_SCRIPT_URL, idTokenProblem, sha256Hex } from "@/lib/auth/google-identity";
import { googleClientIdFrom as cspClientIdFrom } from "../../next.config.ts";

const source = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

test("the nonce pair: Google gets the SHA-256 hex of the value Supabase gets", async () => {
  const one = await createNonce(webcrypto as unknown as Crypto);
  const two = await createNonce(webcrypto as unknown as Crypto);
  assert.match(one.raw, /^[0-9a-f]{64}$/);
  assert.equal(one.hashed, createHash("sha256").update(one.raw).digest("hex"));
  assert.notEqual(one.raw, two.raw, "a fresh value per attempt");
  assert.equal(await sha256Hex("abc", webcrypto.subtle as unknown as SubtleCrypto), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("the client id switch is the same rule in the page and in the CSP", () => {
  const valid = "1234567890-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com";
  for (const value of [valid, ` ${valid} `, undefined, null, "", "abc", "123-abc.apps.googleusercontent.com.evil.example", "https://accounts.google.com"]) {
    assert.equal(googleClientIdFrom(value), cspClientIdFrom(value), String(value));
  }
  assert.equal(googleClientIdFrom(valid), valid);
  assert.equal(GIS_SCRIPT_URL, "https://accounts.google.com/gsi/client");
});

test("a project not set up for the client id falls back to the redirect flow; other failures retry with a new nonce", () => {
  assert.deepEqual(idTokenProblem({ message: "Provider (issuer \"https://accounts.google.com\") is not enabled" }).fallback, true);
  assert.equal(idTokenProblem({ message: "Unacceptable audience in id_token: [123.apps.googleusercontent.com]" }).fallback, true);
  assert.equal(idTokenProblem({ message: "Nonces mismatch" }).fallback, false);
  assert.match(idTokenProblem({ message: "Nonces mismatch" }).message, /try again/);
  assert.equal(idTokenProblem({ message: "Failed to fetch" }).fallback, false);
  assert.match(idTokenProblem({ message: "something else" }).message, /couldn’t complete Google sign-in/);
});

test("Google's button signs in with signInWithIdToken and the raw nonce, then finishes like every sign-in", () => {
  const component = source("src/components/auth/GoogleSignIn.tsx");
  assert.match(component, /nonce: nonce\.hashed/, "Google gets the hash");
  assert.match(component, /signInWithIdToken\(\{ provider: "google", token, nonce: raw \}\)/, "Supabase gets the raw value");
  assert.match(component, /finishPasswordSignIn\(callbacks\.current\.next\(\)\)/, "cookies, onboarding and the reveal as for other sign-ins");
  assert.match(component, /if \(mode === "redirect"\) return <GoogleButton/, "the redirect button is the fallback");
  assert.match(component, /clientId \? "loading" : "redirect"/, "no client id, no Google script");
  assert.match(component, /catch \{\s*if \(!cancelled\) setMode\("redirect"\)/, "a script that fails to load falls back");
  for (const page of ["src/app/(auth)/signin/SignInForm.tsx", "src/app/(auth)/signup/SignUpForm.tsx"]) {
    const form = source(page);
    assert.match(form, /<GoogleSignIn/, page);
    assert.match(form, /onRedirect=\{\(\) => void signInWith\("google"\)\}/, `${page} keeps the redirect flow`);
  }
  // The redirect flow and its accessible name stay as they were.
  assert.match(source("src/components/auth/GoogleButton.tsx"), /"Continue with Google"/);
});
