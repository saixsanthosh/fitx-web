// Nutrition's review N7 (bug 13), an edit to explore's shared Sheet: a click whose target is the dialog closed the
// sheet, and a drag that starts in a field and ends over the backdrop sends its click there (the dialog is the nearest
// element holding both ends). Selecting a field's text and letting go outside the panel closed the form and lost what
// was typed, in every Sheet (Nutrition's food form, Edit entry, Daily targets and name dialogs among them).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { backdropTaps } from "@/components/ui/sheet-backdrop";

test("a tap on the backdrop closes the sheet", () => {
  const taps = backdropTaps();
  taps.press(true);
  assert.equal(taps.click(true), true);
});

test("a drag from inside the sheet that ends over the backdrop does not close it", () => {
  const taps = backdropTaps();
  taps.press(false);
  assert.equal(taps.click(true), false, "the click lands on the dialog, but the press began in the field");
  // The next real tap on the backdrop still closes it.
  taps.press(true);
  assert.equal(taps.click(true), true);
});

test("clicks inside the sheet never close it", () => {
  const taps = backdropTaps();
  taps.press(false);
  assert.equal(taps.click(false), false);
});

test("a click without its own press on the backdrop does not close it", () => {
  const taps = backdropTaps();
  taps.press(true); // a press on the backdrop that turned into a scroll: no click follows it
  assert.equal(taps.click(false), false, "the next click (Enter on a button inside, say) is not on the backdrop");
  assert.equal(taps.click(true), false, "and the old press is used up");
  assert.equal(backdropTaps().click(true), false, "nothing pressed yet");
});

test("Sheet closes from the backdrop only through that rule; Escape and Close are unchanged", () => {
  const sheet = readFileSync("src/components/ui/Sheet.tsx", "utf8");
  assert.match(sheet, /const \[taps\] = useState\(backdropTaps\);/);
  assert.match(sheet, /onPointerDown=\{\(event\) => taps\.press\(event\.target === event\.currentTarget\)\}/);
  assert.match(sheet, /onClick=\{\(event\) => \{ if \(taps\.click\(event\.target === event\.currentTarget\)\) onClose\(\); \}\}/);
  assert.doesNotMatch(sheet, /if \(event\.target === event\.currentTarget\) onClose\(\)/, "the old close on any click on the dialog is gone");
  assert.match(sheet, /dialog\.addEventListener\("cancel", cancel\);/, "Escape still closes");
  assert.match(sheet, /<button type="button" className=\{styles\.close\} onClick=\{onClose\} aria-label="Close">/);
  // Props are unchanged (additive edits only, D7).
  assert.match(sheet, /export function Sheet\(\{ open, onClose, title, description, children, footer, side = "auto", className = "", returnFocus, notice \}: SheetProps\)/);
});
