import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { drawsOwnScreen, OWN_SCREEN_PATHS } from "@/components/auth/screen-paths";

const source = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

test("sign-in pages draw their own screen; onboarding keeps the group's frame", () => {
  assert.deepEqual([...OWN_SCREEN_PATHS], ["/signin", "/signup", "/forgot-password", "/reset-password"]);
  assert.equal(drawsOwnScreen("/signin"), true);
  assert.equal(drawsOwnScreen("/signin/"), true);
  assert.equal(drawsOwnScreen("/reset-password"), true);
  assert.equal(drawsOwnScreen("/onboarding"), false);
  assert.equal(drawsOwnScreen(null), false);
});

test("the names other flows sign in with stay the same", () => {
  const signIn = source("src/app/(auth)/signin/SignInForm.tsx");
  for (const name of ["Other sign-in options", ">Email address", ">Password", "Sign in with email", "<GoogleSignIn", "You’re signed out on this device."]) {
    assert.ok(signIn.includes(name), `sign-in keeps "${name}"`);
  }
  const signUp = source("src/app/(auth)/signup/SignUpForm.tsx");
  for (const name of ["Other sign-up options", ">Your name", ">Email address", ">Password", ">Confirm password", "Create account with email"]) {
    assert.ok(signUp.includes(name), `sign-up keeps "${name}"`);
  }
});

test("the e-mail code uses Supabase's free OTP with the canonical callback and the server's sign-in finish", () => {
  const hook = source("src/components/auth/useEmailCode.ts");
  assert.match(hook, /signInWithOtp\(\{\s*email: address,\s*options: \{ shouldCreateUser: true, emailRedirectTo: authCallbackUrl\(next\(\)\) \}/);
  assert.match(hook, /verifyOtp\(\{ email, token: value, type: "email" \}\)/);
  assert.match(hook, /finishPasswordSignIn\(next\(\)\)/);
  const google = source("src/components/auth/GoogleButton.tsx");
  assert.match(google, /redirectTo: authCallbackUrl\(next\)/, "OAuth returns through the canonical auth origin");
  const field = source("src/components/auth/CodeField.tsx");
  assert.match(field, /autoComplete="one-time-code"/);
  assert.match(field, /inputMode="numeric"/);
  assert.doesNotMatch(field, /maxLength/, "a length cap would cut a pasted \"123 456\" before it is cleaned");
});

test("no Apple or SMS buttons advertise paid sign-in methods", () => {
  for (const file of ["src/app/(auth)/signin/SignInForm.tsx", "src/app/(auth)/signup/SignUpForm.tsx"]) {
    const text = source(file);
    assert.doesNotMatch(text, /signInWithOtp\(\{\s*phone|SMS|text message/i, `${file} has no SMS sign-in`);
    assert.match(text, /appleEnabled && \(/, `${file} shows Apple only when the owner turns it on`);
  }
});
