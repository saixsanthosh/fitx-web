import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { revealBy, type Span } from "@/components/ui/sheet-focus";

const source = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");
const span = (top: number, height: number): Span => ({ top, bottom: top + height });
const moved = (target: Span, by: number): Span => ({ top: target.top - by, bottom: target.bottom - by });
const inView = (view: Span, target: Span) => target.top >= view.top && target.bottom <= view.bottom;

// Re-check of release 3 (reg-explore-1): Edit post's failure message appeared in the sheet's new notice area, between
// the content and the actions. The content lost about 55 px from below and did not scroll, so the focused Save changes
// button, at the end of the content, was 0 of 48 px in view at 1280x720 and 375x812, focus ring and all.
test("when a notice takes room from a sheet's content, the focused control is scrolled back into full view", () => {
  // The content box after the shrink, and the 48 px button now just under its bottom (0 of 48 px in view, as re-checked).
  const view = span(82, 556);
  const save = span(650, 48);
  assert.equal(inView(view, save), false);
  const by = revealBy(view, save);
  assert.ok(by > 0, "it scrolls down");
  assert.equal(inView(view, moved(save, by)), true, "the whole button is in view again");
  assert.equal(moved(save, by).bottom, view.bottom - 12, "with room for its focus ring, and no more than that");
  // Partly hidden is not in view either.
  const half = span(view.bottom - 20, 48);
  assert.equal(moved(half, revealBy(view, half)).bottom, view.bottom - 12);
  // Already in full view: nothing moves, even close to the edge (the member's own scrolling is left alone).
  assert.equal(revealBy(view, span(view.bottom - 48, 48)), 0);
  assert.equal(revealBy(view, span(view.top, 48)), 0);
  // Above the view (scrolled past): back down to it, the top first.
  const above = span(40, 48);
  assert.equal(moved(above, revealBy(view, above)).top, view.top + 12);
  // Taller than the view: its top lines up, so its start is what shows.
  const tall = span(700, 600);
  assert.equal(moved(tall, revealBy(view, tall)).top, view.top + 12);
});

test("Sheet keeps the focused control in view only when a notice comes, and only inside its content (additive)", () => {
  const sheet = source("src/components/ui/Sheet.tsx");
  assert.match(sheet, /import \{ returnFocusTarget, revealBy \} from "\.\/sheet-focus";/);
  assert.match(sheet, /const noticeKey = notice \? `\$\{notice\.tone\}:\$\{notice\.id \?\? ""\}:\$\{notice\.text\}` : null;/,
    "a new message (or the same words said again) is what counts, not a new render");
  const effect = sheet.slice(sheet.indexOf("useLayoutEffect(() => {\n    const box = content.current;"), sheet.indexOf("}, [noticeKey]);"));
  assert.ok(effect.length > 0, "one layout effect, run before the message is painted");
  assert.match(effect, /if \(!noticeKey \|\| !box \|\| !\(focused instanceof HTMLElement\) \|\| !box\.contains\(focused\)\) return;/,
    "nothing for sheets without a notice, when a notice goes, or when focus is not in the content (the actions row)");
  assert.match(effect, /const by = revealBy\(box\.getBoundingClientRect\(\), focused\.getBoundingClientRect\(\)\);\s*if \(by\) box\.scrollTop \+= by;/);
  assert.match(sheet, /<div ref=\{content\} className=\{styles\.content\}>\{children\}<\/div>/);
});

test("Edit post's Save changes sits in the actions row, under the message about it, and submits the form", () => {
  const edit = source("src/components/social/EditPostSheet.tsx");
  const footer = edit.slice(edit.indexOf("footer={"), edit.indexOf("</Sheet>"));
  assert.match(footer, /<button type="submit" form=\{formId\} className="fitx-button w-full aria-disabled:opacity-60" aria-disabled=\{busy \|\| undefined\}>/,
    "in the footer, still focusable while saving (D5)");
  assert.match(footer, /\{busy \? "Saving…" : "Save changes"\}/);
  assert.match(edit, /const formId = `\$\{useId\(\)\}-edit-post`;/);
  const form = edit.slice(edit.indexOf("function EditForm("));
  assert.match(form, /<form id=\{id\} className=\{styles\.form\} onSubmit=\{\(event\) => void save\(event\)\} noValidate>/);
  assert.doesNotMatch(form, /<button/, "no button left at the end of the scrolling form");
  assert.match(form, /event\.preventDefault\(\);\s*if \(busy\) return;\s*onBusy\(true\);/, "a second press while saving does nothing");
  assert.match(form, /\} finally \{\s*onBusy\(false\);\s*\}/);
  assert.match(edit, /<EditForm key=\{post\.id\} id=\{formId\} [^>]*busy=\{busy\} onBusy=\{setBusy\}/);
  // The failure still goes to the sheet's own notice, which Sheet draws between the content and the actions.
  assert.match(edit, /title="Edit post"\s*notice=\{notice\}/);
  assert.match(edit, /onFailed=\{\(text\) => show\("error", text\)\}/);
});
