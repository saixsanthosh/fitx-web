import { test } from "node:test";
import assert from "node:assert/strict";
import { DURATION, EASE, REDUCED_FADE, REDUCED_MOTION_QUERY, SPRING, WIDE_QUERY } from "@/components/motion/tokens";
import { countStart, defaultCountFormat, displayCount, isKnown, UNKNOWN_LABEL, UNKNOWN_MARK } from "@/components/motion/count-format";
import { startsBelowFold } from "@/components/motion/reveal-core";
import { parallaxRange } from "@/components/motion/scroll-math";
import { nextChipIndex } from "@/components/ui/chip-keys";

test("motion tokens are the brief's values", () => {
  assert.deepEqual(EASE, { out: [0.22, 1, 0.36, 1], inOut: [0.65, 0, 0.35, 1] });
  assert.deepEqual(DURATION, { fast: 0.18, base: 0.32, slow: 0.6 });
  assert.deepEqual(SPRING, { type: "spring", stiffness: 260, damping: 30 });
  assert.ok(REDUCED_FADE <= 0.15, "reduced motion fades last at most 150 ms");
  assert.equal(REDUCED_MOTION_QUERY, "(prefers-reduced-motion: reduce)");
  assert.equal(WIDE_QUERY, "(min-width: 768px)");
});

test("an unknown value is an en dash labelled Not known, never 0", () => {
  assert.equal(UNKNOWN_MARK, "–");
  assert.equal(UNKNOWN_LABEL, "Not known");
  for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(isKnown(value), false);
    assert.equal(displayCount(value), "–");
  }
  assert.equal(isKnown(0), true, "a logged zero is a real zero");
  assert.equal(displayCount(0), "0");
});

test("counts are whole numbers with British thousands separators unless a format is given", () => {
  assert.equal(defaultCountFormat(1240.4), "1,240");
  assert.equal(displayCount(12345.6), "12,346");
  assert.equal(displayCount(5.25, (n) => n.toFixed(1)), "5.3");
});

test("a count-up starts from the value shown before, or from 0 when nothing was known", () => {
  assert.equal(countStart(null), 0);
  assert.equal(countStart(undefined), 0);
  assert.equal(countStart(42), 42);
});

test("only content below the fold is hidden before it reveals", () => {
  assert.equal(startsBelowFold(900, 844), true);
  assert.equal(startsBelowFold(844, 844), true);
  assert.equal(startsBelowFold(400, 844), false);
  assert.equal(startsBelowFold(-200, 844), false, "content scrolled past stays visible");
});

test("parallax travels at most speed × 100 px in all", () => {
  assert.deepEqual(parallaxRange(0.15), [8, -8]);
  assert.deepEqual(parallaxRange(0.4), [20, -20]);
  assert.equal(parallaxRange(-1).every((n) => n === 0), true);
  const [from, to] = parallaxRange(0.3);
  assert.ok(from - to <= 30);
});

test("chip keys move focus, wrap and jump to the ends", () => {
  assert.equal(nextChipIndex("ArrowRight", 0, 3), 1);
  assert.equal(nextChipIndex("ArrowRight", 2, 3), 0);
  assert.equal(nextChipIndex("ArrowLeft", 0, 3), 2);
  assert.equal(nextChipIndex("ArrowDown", 1, 3), 2);
  assert.equal(nextChipIndex("Home", 2, 3), 0);
  assert.equal(nextChipIndex("End", 0, 3), 2);
  assert.equal(nextChipIndex("ArrowRight", -1, 3), 0, "from outside the group, the first chip");
  assert.equal(nextChipIndex("Enter", 0, 3), null);
  assert.equal(nextChipIndex("ArrowRight", 0, 0), null);
});
