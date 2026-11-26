import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Bug 12, re-check of release 3. With the phone's bar kept clear (scroll-padding-bottom 79 px at 390 x 844), Tab to
// Nutrition's "Search foods" still left the field's lower edge and focus ring under the bar: the page scrolled 19 px,
// the input ended at 776.6 against the bar's 777, and its visible box (the form, 5 px round it) and ring went on
// under it. Chrome brings a focused text field into view in two scrolls, the field's box and then its caret. Both
// were smooth (html { scroll-behavior: smooth }), and the caret's scroll replaced the box's before the page had moved,
// so the scroll stopped once the caret cleared the padding. Instant, the box's scroll stands. Checked in Chromium 156
// (a page with the same padding and a 67 px bar, 1024 x 768): smooth 17 px with the box 7 px under the bar, instant
// 30 px with the box and ring clear, and the same 30 px from a Tab with the rule below, also as the first Tab.
const globals = readFileSync("src/app/globals.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

type Span = { top: number; bottom: number };
type Screen = { viewport: number; padTop: number; padBottom: number };

/** How far the page must scroll so `span` sits inside the window less its scroll padding: 0 when it already does; a
 *  span partly outside goes to the nearest edge (Chrome's "if needed" alignment). */
function scrollToReveal(span: Span, { viewport, padTop, padBottom }: Screen): number {
  const top = padTop;
  const bottom = viewport - padBottom;
  if (span.top >= top && span.bottom <= bottom) return 0;
  return span.bottom > bottom ? span.bottom - bottom : span.top - top;
}

/**
 * Where Chrome's focus scroll for a text field ends, from the top of the page: the field's box first, then its caret.
 * Smooth, both are worked out before the page has moved and the caret's replaces the box's; instant, the box's moves
 * the page and the caret is then already in view.
 */
function focusTextField(field: Span, caret: Span, screen: Screen, smooth: boolean): number {
  const boxScroll = scrollToReveal(field, screen);
  if (smooth) {
    const caretScroll = scrollToReveal(caret, screen);
    return caretScroll || boxScroll;
  }
  return boxScroll + scrollToReveal({ top: caret.top - boxScroll, bottom: caret.bottom - boxScroll }, screen);
}

const round = (value: number) => Math.round(value * 10) / 10;

test("smooth focus scrolling stops at the caret, leaving the field's edge and ring under the bar (the re-check)", () => {
  // Chromium 156, 1024 x 768, bar 67 px (top at 701), scroll padding 79 px: the field 675-719, its caret 688-706, the
  // field's visible box 6 px round it and a 3 px ring.
  const screen = { viewport: 768, padTop: 84, padBottom: 79 };
  const field = { top: 675, bottom: 719 };
  const caret = { top: 688, bottom: 706 };
  const barTop = 768 - 67;
  const smooth = focusTextField(field, caret, screen, true);
  assert.equal(smooth, 17, "as measured");
  assert.ok(field.bottom - smooth + 6 > barTop, "the field's box ends under the bar");
  const instant = focusTextField(field, caret, screen, false);
  assert.equal(instant, 30, "as measured");
  assert.equal(field.bottom - instant, 768 - 79, "the field's box at the padding's edge");
  assert.ok(field.bottom - instant + 6 + 3 < barTop, "the box and its ring above the bar");

  // The re-check at 390 x 844 (bar top 777, padding 79): the field 751.6-795.6 before the scroll, its caret about
  // 764-784. Smooth: 19 px, the field ending at the bar's top and its box 5 px round it under it. Instant: 30.6 px.
  const phone = { viewport: 844, padTop: 84, padBottom: 79 };
  const search = { top: 751.6, bottom: 795.6 };
  const searchCaret = { top: 764, bottom: 784 };
  assert.equal(focusTextField(search, searchCaret, phone, true), 19);
  assert.equal(round(search.bottom - 19), 776.6);
  const settled = round(focusTextField(search, searchCaret, phone, false));
  assert.equal(settled, 30.6);
  assert.ok(search.bottom - settled + 5 + 3 < 777, "the form's box and ring clear the bar");
});

test("scrolling that follows a visible focus is instant; other in-page scrolling stays smooth", () => {
  const motion = globals.match(/@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  const smooth = motion.indexOf("html { scroll-behavior: smooth; }");
  const instant = motion.indexOf("html:has(:focus-visible) { scroll-behavior: auto; }");
  assert.ok(smooth >= 0, "anchor links and scripted scrolls stay smooth");
  assert.ok(instant > smooth, "the focus rule comes after it (and is more specific: html plus a pseudo-class)");
  // Nothing else sets the root's scroll-behavior, apart from the reduced-motion rule that turns all of it off.
  const setters = [...globals.matchAll(/([^{}]+)\{[^{}]*(?<![\w-])scroll-behavior:[^{}]*\}/g)].map((match) => match[1].trim());
  assert.deepEqual(setters, ["html", "html:has(:focus-visible)", "*, *::before, *::after"]);
  assert.match(globals, /@media \(prefers-reduced-motion: reduce\) \{\s*\*, \*::before, \*::after \{ scroll-behavior: auto !important;/);
  // Next's route changes still scroll at once (it reads this attribute).
  assert.match(readFileSync("src/app/layout.tsx", "utf8"), /data-scroll-behavior="smooth"/);
});
