// Bug 43's last point (review auth-r3): "At 1280x720 on a first visit, the privacy banner covers most of the error." A
// request's failure appears right under the button that sent it, and the button keeps focus (bug 80). Tab to the button
// scrolls it to the bottom of what shows, just above the open banner (bug 79's scroll padding), so the failure under it
// started at the banner's edge and sat behind it. It is now brought into view as it appears, without moving focus
// (src/lib/auth/into-view.ts, src/components/auth/useBringIntoView.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bringIntoView, INTO_VIEW } from "@/lib/auth/into-view";

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

function element() {
  const scrolls: unknown[] = [];
  let focused = 0;
  return {
    scrolls,
    focused: () => focused,
    scrollIntoView(options?: boolean | ScrollIntoViewOptions) {
      scrolls.push(options);
    },
    focus() {
      focused += 1;
    },
  };
}

test("a failure just shown is brought into view, only as far as needed, and focus stays where it is", () => {
  const failure = element();
  assert.equal(bringIntoView(failure, "That email may already have a FITX account."), true);
  assert.deepEqual(failure.scrolls, [{ block: "nearest", inline: "nearest" }]);
  assert.equal(failure.focused(), 0, "the button keeps focus (bug 80)");
  // nearest: nothing moves when the message already shows, and the page's own scroll-behavior (instant with reduced
  // motion) decides how it moves.
  assert.deepEqual(INTO_VIEW, { block: "nearest", inline: "nearest" });
  assert.equal("behavior" in INTO_VIEW, false);
});

test("no message, or nothing drawn for it, moves nothing", () => {
  const failure = element();
  assert.equal(bringIntoView(failure, ""), false);
  assert.equal(bringIntoView(null, "Too many tries. Wait a few minutes, then try again."), false);
  assert.equal(bringIntoView(undefined, "x"), false);
  assert.deepEqual(failure.scrolls, []);
});

test("the hook brings the failure into view before paint, each time it says something new", () => {
  const hook = read("src/components/auth/useBringIntoView.ts");
  assert.match(hook, /useLayoutEffect\(\(\) => \{\s*bringIntoView\(target\.current, message\);\s*\}, \[target, message\]\);/);
});

test("every request failure under its button is brought into view as it appears", () => {
  const forms: Array<[file: string, alerts: number]> = [
    ["src/app/(auth)/signin/SignInForm.tsx", 2], // under "Email me a code", or "Sign in with email" with the options open
    ["src/app/(auth)/signup/SignUpForm.tsx", 2], // under "Email me a code", or "Create account with email"
    ["src/app/(auth)/forgot-password/page.tsx", 1],
    ["src/app/(auth)/reset-password/page.tsx", 1],
  ];
  for (const [file, alerts] of forms) {
    const text = read(file);
    assert.match(text, /const failureText = useRef<HTMLParagraphElement>\(null\);/, file);
    assert.match(text, /useBringIntoView\(failureText, error\);/, `${file}: with the failure's own text`);
    assert.equal(text.match(/<p ref=\{failureText\} role="alert" className=\{s\.error\}>/g)?.length, alerts, `${file}: every failure under a button`);
    assert.doesNotMatch(text, /\{error && \(?\s*<p role="alert"/, `${file}: no failure under a button left without it`);
  }
});

test("the edge it stops at is clear of the open privacy banner, on the page and in the desktop form panel", () => {
  const css = read("src/components/auth/auth.module.css");
  const desktop = css.slice(css.indexOf("@media (min-width: 960px) {"));
  // From 960 px the form panel scrolls by itself: its own scroll padding keeps the banner's height free (bug 79).
  assert.match(desktop, /\.panel \{ overflow-y: auto; \}/);
  assert.match(desktop, /\.panel \{ scroll-padding-bottom: calc\(var\(--fitx-inset-consent, 0px\) \+ 12px\); \}/);
  assert.match(desktop, /\.panelInner \{ padding-bottom: calc\(28px \+ var\(--fitx-inset-consent, 0px\)\); \}/, "with room to scroll it there");
});
