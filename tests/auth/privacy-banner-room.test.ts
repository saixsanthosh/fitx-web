// Bug 79 (the shell's), the part in the sign-in screens, made here at the shell stream's request (reports-3/shell.md,
// "Edits needed" 3): from 960 px the sign-in, sign-up and password screens are one window tall with a form panel that
// scrolls by itself, so the page's own scroll padding for the privacy banner doesn't reach it, and the room the page
// makes for the open banner let the whole screen scroll a strip of page colour. While the banner is open the shell sets
// --fitx-inset-consent on <html> (its height; unset, so 0, otherwise).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../src/components/auth/auth.module.css", import.meta.url), "utf8");

test("the desktop sign-in screen gives back the banner's room and keeps its panel's focus clear of it", () => {
  const start = css.indexOf("@media (min-width: 960px) {");
  assert.ok(start >= 0, "the desktop block");
  const block = css.slice(start, css.indexOf("\n}\n", start));
  assert.match(block, /\.screen \{ margin-bottom: calc\(-1 \* var\(--fitx-inset-consent, 0px\)\); \}/, "no page scroll while the banner is open");
  assert.match(block, /\.panel \{ scroll-padding-bottom: calc\(var\(--fitx-inset-consent, 0px\) \+ 12px\); \}/, "a focused control scrolls clear of it");
  assert.match(block, /\.panelInner \{ padding-bottom: calc\(28px \+ var\(--fitx-inset-consent, 0px\)\); \}/, "the last line can scroll above it");
  // With the banner shut (or before the shell's change) nothing moves: every value falls back to the old one.
  assert.match(block, /\.panelInner \{ justify-content: center; padding: 48px clamp\(24px, 4vw, 56px\) 28px; \}/);
});
