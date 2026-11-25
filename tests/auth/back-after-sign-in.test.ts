// Bug 40 (public-5): Back after signing in showed an empty sign-in form, from the browser's cache, while the member was
// still signed in. Every sign-in now leaves its page with location.replace, so the form is not in the history any more,
// and a sign-in page the browser still shows from the history asks the server again when the browser holds the
// signed-in hint, so the proxy sends the member on (src/lib/auth/restored-page.ts). The pages stay static.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AUTH_HINT_COOKIE } from "@/lib/auth/cookies";
import { drawCounter, hasSignedInHint, loadedFromHistory, restoredOnMount, shouldAskServerAgain, SIGNED_OUT_PAGES } from "@/lib/auth/restored-page";

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

// Review auth-r2: Back or Forward between pages of one document (/signin, then Terms by a link, then Back) is drawn by
// Next's router from its own copy, with no request: the document's own load stays "navigate", and no pageshow fires. So
// is a link to a sign-in page it prefetched while the member was signed out (static pages stay cached for five minutes).
const SITE = "https://fitx.example";
test("only the document's first sign-in page, at the document's own address, is the server's answer", () => {
  const documentAddress = `${SITE}/signin?next=%2Fnutrition`;
  const at = (address: string, firstDraw: boolean, navigationType = "navigate") => restoredOnMount({ navigationType, documentAddress, firstDraw, address: `${SITE}${address}` });
  assert.equal(at("/signin?next=%2Fnutrition", true), false, "the server drew it, through the proxy");
  assert.equal(at("/signin?next=%2Fnutrition#main-content", true), false, "the skip link's #fragment is the same page");
  assert.equal(at("/signin?next=%2Fnutrition", false), true, "drawn again for Back after Terms: the router's copy");
  assert.equal(at("/signup", false), true, "a link to another sign-in page, drawn by the router");
  assert.equal(at("/signin?next=%2Fnutrition", true, "back_forward"), true, "the document came from the history");
  assert.equal(restoredOnMount({ navigationType: "navigate", documentAddress: `${SITE}/`, firstDraw: true, address: `${SITE}/signin` }), true, "the document began on the home page: a prefetched link");
  for (const unknown of [undefined, null, "", "http://["]) {
    assert.equal(restoredOnMount({ navigationType: "navigate", documentAddress: unknown, firstDraw: true, address: `${SITE}/signin` }), false, `unknown ${String(unknown)}: no reason to reload`);
  }
  // A reload is a new document, and its first sign-in page is at its own address: it never asks again for itself.
  assert.equal(restoredOnMount({ navigationType: "reload", documentAddress: `${SITE}/signin`, firstDraw: true, address: `${SITE}/signin` }), false);
});

test("a document counts its sign-in pages once each, also when React runs a page's effect twice", () => {
  const firstDraw = drawCounter();
  const signIn = { current: null as boolean | null };
  assert.equal(firstDraw(signIn), true);
  assert.equal(firstDraw(signIn), true, "React's development double run asks again: the same answer");
  const terms = drawCounter();
  assert.equal(terms({ current: null }), true, "each document has its own count");
  const backToSignIn = { current: null as boolean | null };
  assert.equal(firstDraw(backToSignIn), false, "the next sign-in page drawn in the document");
  assert.equal(firstDraw({ current: null }), false);
});

test("the reviewer's case: /signin, then Terms by a link, another tab signs in, then Back", () => {
  const firstDraw = drawCounter();
  const documentAddress = `${SITE}/signin`;
  const shown = (page: { current: boolean | null }) => restoredOnMount({ navigationType: "navigate", documentAddress, firstDraw: firstDraw(page), address: `${SITE}/signin` });
  // Opened signed out: the server's answer, the form is right.
  assert.equal(shouldAskServerAgain({ pathname: "/signin", restored: shown({ current: null }), cookie: "" }), false);
  // Back from Terms draws /signin again while the other tab's sign-in left the hint: it asks the server, which sends the
  // member on. Still signed out, it shows the form without a reload.
  const back = shown({ current: null });
  assert.equal(shouldAskServerAgain({ pathname: "/signin", restored: back, cookie: "fitx_auth=1" }), true);
  assert.equal(shouldAskServerAgain({ pathname: "/signin", restored: back, cookie: "" }), false);
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

test("the frame of every sign-in page asks again on mount and on pageshow, and only ever by reloading", () => {
  const screen = read("src/components/auth/AuthScreen.tsx");
  assert.match(screen, /^"use client";/);
  assert.match(screen, /export function AuthScreen\([^)]*\) \{\s*useAskServerWhenRestored\(\);/);
  const hook = read("src/components/auth/useAskServerWhenRestored.ts");
  assert.match(hook, /shouldAskServerAgain\(\{ pathname: window\.location\.pathname, restored, cookie: document\.cookie \}\)\) window\.location\.reload\(\);/);
  assert.match(hook, /askIf\(restoredOnMount\(\{ navigationType: entry\?\.type, firstDraw: firstDraw\(page\), documentAddress: entry\?\.name, address: window\.location\.href \}\)\);/, "checked on mount: a page from the disk cache, or one the router drew");
  assert.match(hook, /^const firstDraw = drawCounter\(\);$/m, "one count for the document");
  assert.match(hook, /const page = useRef<boolean \| null>\(null\);/, "each page keeps its own answer");
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
  // The same for the new-password form: once saved, "Open FITX" takes its place in the history.
  assert.match(read("src/app/(auth)/reset-password/page.tsx"), /<Link href="\/dashboard" replace className=\{`fitx-button \$\{s\.primary\}`\}>Open FITX<\/Link>/);
});
