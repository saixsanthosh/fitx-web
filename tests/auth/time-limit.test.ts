// Time limits on the sign-in pages' requests (src/lib/auth/time-limit.ts, hotfix 2d): a request that never answers
// ends after a sensible limit with a plain message, and the form's button works again; never "Sending code…" for ever.
// A late answer is not lost: a code or link sent late counts for this browser's email limit, a sign-in that went
// through late carries on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { finishPasswordSignIn } from "@/lib/auth/finish-sign-in";
import { isTimeLimit, TIME_LIMIT_MS, TIMED_OUT, TimeLimitError, withTimeLimit } from "@/lib/auth/time-limit";

const source = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const never = () => new Promise<never>(() => {});
const turn = () => new Promise((resolve) => setImmediate(resolve));

test("a request that never answers ends at its limit, not before", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const limited = withTimeLimit(never(), TIME_LIMIT_MS.email);
  let settled = false;
  limited.catch(() => { settled = true; });
  t.mock.timers.tick(TIME_LIMIT_MS.email - 1);
  await turn();
  assert.equal(settled, false, "still waiting a moment before the limit");
  t.mock.timers.tick(1);
  await assert.rejects(limited, (error: unknown) => isTimeLimit(error) && error.ms === TIME_LIMIT_MS.email);
  assert.equal(isTimeLimit(new Error("offline")), false);
  assert.ok(new TimeLimitError(5) instanceof Error);
});

test("an answer in time passes straight through, and the timer goes with it", async (t) => {
  const cleared = t.mock.method(globalThis, "clearTimeout");
  let late = 0;
  assert.deepEqual(await withTimeLimit(Promise.resolve({ error: null }), 1000, () => { late += 1; }), { error: null });
  await assert.rejects(withTimeLimit(Promise.reject(new Error("offline")), 1000), /offline/, "a failure stays that failure");
  assert.equal(cleared.mock.callCount(), 2, "no timer is left running after either");
  assert.equal(late, 0, "an answer in time is not a late answer");
});

test("an answer after the limit goes to the late handler; a late failure is dropped; a failing handler is contained", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let answer: (value: { error: null | string }) => void = () => {};
  const seen: unknown[] = [];
  const limited = withTimeLimit(new Promise<{ error: null | string }>((resolve) => { answer = resolve; }), 1000, (value) => seen.push(value));
  t.mock.timers.tick(1000);
  await assert.rejects(limited, isTimeLimit);
  assert.deepEqual(seen, [], "nothing yet");
  answer({ error: null });
  await turn();
  assert.deepEqual(seen, [{ error: null }], "the late answer arrives");

  let fail: (error: Error) => void = () => {};
  const failing = withTimeLimit(new Promise<never>((_resolve, reject) => { fail = reject; }), 1000, (value) => seen.push(value));
  t.mock.timers.tick(1000);
  await assert.rejects(failing, isTimeLimit);
  fail(new Error("offline"));
  await turn();
  assert.equal(seen.length, 1, "a late failure changes nothing");

  let finish: (value: number) => void = () => {};
  const throwing = withTimeLimit(new Promise<number>((resolve) => { finish = resolve; }), 1000, () => { throw new Error("handler"); });
  t.mock.timers.tick(1000);
  await assert.rejects(throwing, isTimeLimit);
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  finish(1);
  await turn();
  await turn();
  process.off("unhandledRejection", onUnhandled);
  assert.deepEqual(unhandled, [], "a late handler that throws never surfaces as an unhandled rejection");
});

test("the limits are sensible: long enough for a slow phone network, short enough to be worth waiting for", () => {
  assert.equal(TIME_LIMIT_MS.email, 30_000);
  assert.equal(TIME_LIMIT_MS.check, 20_000);
  assert.equal(TIME_LIMIT_MS.finish, 15_000);
  for (const [name, message] of Object.entries(TIMED_OUT)) {
    assert.match(message, /is taking too long, so we stopped waiting\./, `${name} says what happened`);
    assert.match(message, /Check your connection and try again\./, `${name} says what to do`);
    assert.match(message, /\. If (a code|a link|the check|it) (arrives meanwhile|still goes through)/, `${name} says what a late answer does`);
    assert.doesNotMatch(message, /error|failed|timeout|timed out/i, `${name} is in plain words`);
    assert.ok(message.length < 200, `${name} is short`);
  }
  assert.match(TIMED_OUT.sendCode, /If a code arrives meanwhile, it still works\./, "honest: the code may still be on its way");
  assert.match(TIMED_OUT.resetLink, /If a link arrives meanwhile, it still works\./);
  assert.match(TIMED_OUT.signIn, /you’ll be signed in\./);
});

test("the sign-in finish stops waiting for FITX at its limit, cancels the request and goes on", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal: AbortSignal | null | undefined;
  t.mock.method(globalThis, "fetch", (_input: unknown, init?: RequestInit) => {
    signal = init?.signal;
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
    });
  });
  const destination = finishPasswordSignIn("/progress");
  t.mock.timers.tick(TIME_LIMIT_MS.finish - 1);
  await turn();
  assert.equal(signal?.aborted, false, "not before the limit");
  t.mock.timers.tick(1);
  assert.equal(await destination, "/progress", "the page asked for (the proxy still routes new accounts to onboarding)");
  assert.equal(signal?.aborted, true, "the hung request is cancelled");
});

test("the sign-in finish still uses the server's answer when it comes in time", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ destination: "/onboarding" }), { status: 200, headers: { "content-type": "application/json" } }));
  assert.equal(await finishPasswordSignIn("/progress"), "/onboarding");
});

// Every Supabase Auth request on the sign-in pages: the file, the call, its limit, and the message its catch shows.
const REQUESTS: [file: string, call: string, limit: keyof typeof TIME_LIMIT_MS, message: keyof typeof TIMED_OUT][] = [
  ["src/components/auth/useEmailCode.ts", "signInWithOtp", "email", "sendCode"],
  ["src/components/auth/useEmailCode.ts", "verifyOtp", "check", "verifyCode"],
  ["src/app/(auth)/signin/SignInForm.tsx", "signInWithPassword", "check", "signIn"],
  ["src/components/auth/GoogleSignIn.tsx", "signInWithIdToken", "check", "google"],
  ["src/app/(auth)/signup/SignUpForm.tsx", "signUp", "email", "signUp"],
  ["src/app/(auth)/forgot-password/page.tsx", "resetPasswordForEmail", "email", "resetLink"],
  ["src/app/(auth)/reset-password/page.tsx", "updateUser", "check", "newPassword"],
];

test("every auth request on the sign-in pages has a time limit and a plain message for it", () => {
  for (const [file, call, limit, message] of REQUESTS) {
    const text = source(file);
    assert.match(text, new RegExp(`withTimeLimit\\(\\s*supabase\\.auth\\.${call}\\([\\s\\S]*?\\),\\s*TIME_LIMIT_MS\\.${limit},`), `${file}: ${call} is limited to TIME_LIMIT_MS.${limit}`);
    assert.match(text, new RegExp(`catch \\(problem\\) \\{\\s*(?:return |setError\\(|callbacks\\.current\\.onError\\()isTimeLimit\\(problem\\) \\? TIMED_OUT\\.${message} : `), `${file}: running out of time says TIMED_OUT.${message}`);
  }
  // No Supabase Auth call on these pages waits without a limit.
  for (const file of new Set(REQUESTS.map(([name]) => name))) {
    const text = source(file);
    const calls = text.match(/supabase\.auth\.\w+\(/g) ?? [];
    const limited = text.match(/withTimeLimit\(\s*supabase\.auth\.\w+\(/g) ?? [];
    assert.ok(calls.length > 0, file);
    assert.equal(limited.length, calls.length, `${file}: every supabase.auth call is inside withTimeLimit (${calls.join(", ")})`);
  }
  const finish = source("src/lib/auth/finish-sign-in.ts");
  assert.match(finish, /setTimeout\(\(\) => controller\.abort\(\), TIME_LIMIT_MS\.finish\)/);
  assert.match(finish, /signal: controller\.signal/);
  assert.match(finish, /finally \{\s*clearTimeout\(timer\);\s*\}/);
});

test("a late answer is not lost: emails sent late count for this browser's limit, late sign-ins carry on", () => {
  const code = source("src/components/auth/useEmailCode.ts");
  assert.match(code, /TIME_LIMIT_MS\.email,[\s\S]{0,200}\(\{ error: late \}\) => \{\s*if \(!late\) browserEmailCooldown\(\)\.record\(address\);\s*\}/, "a code sent late");
  assert.match(code, /TIME_LIMIT_MS\.check,[\s\S]{0,200}\(\{ error: late \}\) => \{\s*if \(late\) return;\s*setSigningIn\(true\);\s*finishLateSignIn\(next\(\)\);\s*\}/, "a code checked late");
  assert.match(source("src/app/(auth)/signin/SignInForm.tsx"), /TIME_LIMIT_MS\.check,\s*\(\{ error: late \}\) => \{\s*if \(!late\) finishLateSignIn\(requestedNext\(\)\);\s*\}/);
  assert.match(source("src/components/auth/GoogleSignIn.tsx"), /TIME_LIMIT_MS\.check,\s*\(\{ error: late \}\) => \{\s*if \(!late\) finishLateSignIn\(callbacks\.current\.next\(\)\);\s*\}/);
  assert.match(source("src/app/(auth)/signup/SignUpForm.tsx"), /if \(lateError\) return;\s*if \(late\.session\) return finishLateSignIn\("\/onboarding"\);\s*browserEmailCooldown\(\)\.record\(address\);\s*setSent\(true\);/);
  assert.match(source("src/app/(auth)/forgot-password/page.tsx"), /\(\{ error: late \}\) => \{\s*if \(late\) return;\s*browserEmailCooldown\(\)\.record\(address\);\s*setSent\(true\);\s*\}/);
  assert.match(source("src/app/(auth)/reset-password/page.tsx"), /\(\{ error: late \}\) => \{\s*if \(late\) return;\s*void stampSessionCookies\(\);\s*setSaved\(true\);\s*\}/);
  const finish = source("src/lib/auth/finish-sign-in.ts");
  assert.match(finish, /export function finishLateSignIn\(next: string \| null\): void \{\s*void finishPasswordSignIn\(next\)\.then\(\(destination\) => window\.location\.assign\(destination\)\);\s*\}/);
});

test("the buttons work again after a time-out: the busy state is cleared on every path", () => {
  const code = source("src/components/auth/useEmailCode.ts");
  assert.match(code, /catch \(problem\) \{\s*return isTimeLimit\(problem\) \? TIMED_OUT\.sendCode : OFFLINE;\s*\} finally \{\s*busy\.current = false;\s*setSending\(false\);/, "Sending code… ends");
  assert.match(code, /TIMED_OUT\.verifyCode : OFFLINE\);\s*setVerifying\(false\);\s*busy\.current = false;/, "Checking… ends");
  assert.match(source("src/app/(auth)/signin/SignInForm.tsx"), /TIMED_OUT\.signIn : [^;]*;\s*setPending\(null\);/, "Signing in… ends");
  assert.match(source("src/app/(auth)/signup/SignUpForm.tsx"), /TIMED_OUT\.signUp : [^;]*;\s*setPending\(null\);/);
  assert.match(source("src/components/auth/GoogleSignIn.tsx"), /TIMED_OUT\.google : [^;]*;\s*setBusy\(false\);\s*callbacks\.current\.onBusy\?\.\(false\);/);
  for (const file of ["src/app/(auth)/forgot-password/page.tsx", "src/app/(auth)/reset-password/page.tsx"]) {
    assert.match(source(file), /TIMED_OUT\.\w+ : [^;]*;\s*\} finally \{\s*setLoading\(false\);/, file);
  }
});
