// Bug 40 (public-5): Back after signing in showed an empty sign-in form, from the browser's cache, while the member was
// still signed in. Every sign-in now leaves its page with location.replace, so the form is not in the history any more,
// and a sign-in page the browser still shows from the history asks the server again when the browser holds the
// signed-in hint, so the proxy sends the member on (src/lib/auth/restored-page.ts). The pages stay static.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AUTH_HINT_COOKIE } from "@/lib/auth/cookies";
import { hasSignedInHint, loadedFromHistory, shouldAskServerAgain, SIGNED_OUT_PAGES } from "@/lib/auth/restored-page";

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

test("the signed-in hint is fitx_auth=1 exactly, wherever it sits among the cookies", () => {
  assert.equal(AUTH_HINT_COOKIE, "fitx_auth");
  assert.equal(hasSignedInHint("fitx_auth=1"), true);
  assert.equal(hasSignedInHint("sb-x-auth-token=abc; fitx_auth=1; fitx_intro=seen"), true);
  assert.equal(hasSignedInHint("fitx_intro=seen;fitx_auth=1"), true);
  for (const cookie of ["", "fitx_auth=", "fitx_auth=0", "fitx_auth=10", "xfitx_auth=1", "fitx_authx=1", "fitx_onboarded=1"]) {
    assert.equal(hasSignedInHint(cookie), false, JSON.stringify(cookie));
  }
});

test("only a load from the tab's history counts as restored", () => {
  assert.equal(loadedFromHistory("back_forward"), true);
  for (const type of ["navigate", "reload", "prerender", undefined, null, ""]) assert.equal(loadedFromHistory(type), false, String(type));
});

test("a sign-in page shown from history asks the server again only when the member may be signed in", () => {
  const signedIn = "fitx_auth=1";
  for (const pathname of ["/signin", "/signup", "/forgot-password", "/signin/"]) {
    assert.equal(shouldAskServerAgain({ pathname, restored: true, cookie: signedIn }), true, pathname);
    assert.equal(shouldAskServerAgain({ pathname, restored: true, cookie: "" }), false, `${pathname}: signed out, the form is right`);
    assert.equal(shouldAskServerAgain({ pathname, restored: false, cookie: signedIn }), false, `${pathname}: a fresh load already went through the proxy`);
  }
  // The reset form is opened signed in by its link: reloading it would only empty the new password.
  assert.equal(shouldAskServerAgain({ pathname: "/reset-password", restored: true, cookie: signedIn }), false);
  assert.equal(shouldAskServerAgain({ pathname: "/onboarding", restored: true, cookie: signedIn }), false);
});

test("the pages that ask again are exactly those the proxy turns a signed-in member away from", () => {
  assert.deepEqual([...SIGNED_OUT_PAGES].sort(), ["/forgot-password", "/signin", "/signup"]);
  const proxy = read("src/proxy.ts");
  assert.match(proxy, /import \{ SIGNED_OUT_PAGES \} from "@\/lib\/auth\/restored-page";/);
  assert.match(proxy, /const AUTH_ENTRY = SIGNED_OUT_PAGES;/);
  assert.match(proxy, /if \(AUTH_ENTRY\.has\(pathname\)\) return redirect\(safeNext\(searchParams\.get\("next"\)\)\);/, "signed in: on to where they were going");
});

test("the frame of every sign-in page asks again on load and on pageshow, and only ever by reloading", () => {
  const screen = read("src/components/auth/AuthScreen.tsx");
  assert.match(screen, /^"use client";/);
  assert.match(screen, /export function AuthScreen\([^)]*\) \{\s*useAskServerWhenRestored\(\);/);
  const hook = read("src/components/auth/useAskServerWhenRestored.ts");
  assert.match(hook, /shouldAskServerAgain\(\{ pathname: window\.location\.pathname, restored, cookie: document\.cookie \}\)\) window\.location\.reload\(\);/);
  assert.match(hook, /askIf\(loadedFromHistory\(entry\?\.type\)\);/, "a page from the disk cache runs again: checked on load");
  assert.match(hook, /addEventListener\("pageshow", onPageShow\)/, "a page from the back-forward cache: checked on pageshow");
  assert.match(hook, /\(event: PageTransitionEvent\) => askIf\(event\.persisted\)/);
  assert.match(hook, /return \(\) => window\.removeEventListener\("pageshow", onPageShow\);/);
  for (const page of ["src/app/(auth)/signin/SignInForm.tsx", "src/app/(auth)/signup/SignUpForm.tsx", "src/app/(auth)/forgot-password/page.tsx", "src/app/(auth)/reset-password/page.tsx"]) {
    assert.match(read(page), /<AuthScreen\b/, `${page} draws the frame`);
  }
});

test("every sign-in leaves its page with location.replace, so Back never lands on the form", () => {
  const finish = read("src/lib/auth/finish-sign-in.ts");
  assert.match(finish, /export function leaveSignInPage\(destination: string\): void \{\s*window\.location\.replace\(destination\);\s*\}/);
  assert.match(finish, /void finishPasswordSignIn\(next\)\.then\(leaveSignInPage\);/, "a sign-in that went through late");
  const exits: Array<[file: string, call: RegExp]> = [
    ["src/app/(auth)/signin/SignInForm.tsx", /leaveSignInPage\(await finishPasswordSignIn\(requestedNext\(\)\)\);/],
    ["src/app/(auth)/signup/SignUpForm.tsx", /if \(data\.session\) leaveSignInPage\(await finishPasswordSignIn\("\/onboarding"\)\);/],
    ["src/components/auth/useEmailCode.ts", /leaveSignInPage\(await finishPasswordSignIn\(next\(\)\)\);/],
    ["src/components/auth/GoogleSignIn.tsx", /leaveSignInPage\(await finishPasswordSignIn\(callbacks\.current\.next\(\)\)\);/],
  ];
  for (const [file, call] of exits) {
    const text = read(file);
    assert.match(text, call, file);
    assert.doesNotMatch(text, /location\.assign\(/, `${file}: no sign-in adds a history entry on top of the form`);
  }
});
