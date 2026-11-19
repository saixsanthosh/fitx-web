import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { drawsOwnScreen, OWN_SCREEN_PATHS } from "@/components/auth/screen-paths";
import { cueFor, hipPath, jointPoints, kneeAngle, squatDepth, squatPose } from "@/components/auth/squat-pose";

const source = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

test("the squat loops: tall at 0 and 1, deepest half-way, never outside 0..1", () => {
  assert.equal(squatDepth(0), 0);
  assert.ok(Math.abs(squatDepth(1)) < 1e-9);
  assert.ok(Math.abs(squatDepth(0.5) - 1) < 1e-9);
  assert.ok(Math.abs(squatDepth(0.25) - squatDepth(0.75)) < 1e-9, "down and up mirror each other");
  assert.ok(Math.abs(squatDepth(1.25) - squatDepth(0.25)) < 1e-9, "phases past 1 wrap");
  assert.ok(Math.abs(squatDepth(-0.25) - squatDepth(0.75)) < 1e-9, "negative phases wrap");
  for (let i = 0; i <= 100; i += 1) {
    const depth = squatDepth(i / 100);
    assert.ok(depth >= 0 && depth <= 1, `depth ${depth} at ${i / 100}`);
  }
});

test("the knee readout describes the drawing: about straight standing, below parallel at the bottom", () => {
  assert.equal(kneeAngle(squatPose(0)), 174);
  assert.equal(kneeAngle(squatPose(1)), 70);
  assert.ok(kneeAngle(squatPose(0.5)) < 174 && kneeAngle(squatPose(0.5)) > 70);
  assert.deepEqual(squatPose(2), squatPose(1), "depth is clamped");
});

test("the hip drops and moves back while the feet stay put", () => {
  const tall = jointPoints(squatPose(0));
  const deep = jointPoints(squatPose(1));
  assert.deepEqual(tall.ankle, deep.ankle);
  assert.ok(deep.hip.y > tall.hip.y + 40, "the hip lowers");
  assert.ok(deep.hip.x < tall.hip.x, "the hip sits back");
  assert.ok(deep.knee.x > tall.knee.x, "the knee travels forward");
  assert.ok(deep.shoulder.x > deep.hip.x, "the chest stays over the feet");
  assert.match(hipPath(4), /^M[\d.-]+ [\d.-]+( L[\d.-]+ [\d.-]+){4}$/);
});

test("cues follow the rep: tall, lowering, bottom, rising", () => {
  assert.equal(cueFor(0), "Chest up");
  assert.equal(cueFor(0.25), "Sit back");
  assert.equal(cueFor(0.5), "Knees out");
  assert.equal(cueFor(0.75), "Drive up");
  assert.equal(cueFor(0.95), "Chest up");
  assert.equal(cueFor(1.25), "Sit back");
});

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
  for (const name of ["Other sign-in options", ">Email address", ">Password", "Sign in with email", "<GoogleButton", "You’re signed out on this device."]) {
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
