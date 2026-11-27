// Review finding (fix round 3f, a11y-nutrition-day-alert-busy-label-inside-alert): the alert for a day that failed to
// load held its Try again button inside the role="alert" element, and the button's label changed to "Loading…" while
// the day was read. An alert is assertive and atomic, so pressing Try again read the old failure out again with the new
// label ("This day couldn't be loaded just now. Try again in a moment. Loading…") before anything had happened, and
// again when the label went back. Only the words are the alert now; Sign in and Try again sit beside them, outside it,
// as the barcode answer in Log food already does with its "Checking…" button.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../../src/app/(dashboard)/nutrition/page.tsx", import.meta.url), "utf8");
const alert = page.slice(page.indexOf("const dayAlert = "), page.indexOf("const foodList = ("));

/** The markup between an element's opening tag and its closing tag, for a tag that doesn't nest inside itself here. */
function inside(markup: string, open: string, close: string): string {
  const start = markup.indexOf(open);
  assert.ok(start >= 0, open);
  return markup.slice(start + open.length, markup.indexOf(close, start));
}

test("only the day's message is the alert, a new one per failure; its buttons are outside it", () => {
  assert.ok(alert.length > 0);
  assert.match(alert, /return <div className=\{styles\.alert\}>\s*<p key=\{attempt\} role="alert">\{said\.text\}<\/p>/, "the box is no live region; the paragraph is, re-keyed per failure");
  assert.equal((alert.match(/role="alert"/g) ?? []).length, 1, "one alert: the words");
  assert.doesNotMatch(alert, /aria-live|aria-atomic|role="status"/, "nothing else in the box is read out as it changes");
  const words = inside(alert, `<p key={attempt} role="alert">`, "</p>");
  assert.equal(words, "{said.text}", "the alert holds the words and nothing else");
  assert.doesNotMatch(words, /Loading…|Try again|Sign in/);
  // The buttons follow the paragraph, so their labels changing ("Loading…") is never part of what the alert says.
  const actions = alert.slice(alert.indexOf("</p>"));
  assert.match(actions, /\{said\.signIn && <Link href=\{signInHref\(NUTRITION_PATH\)\} className="fitx-button min-h-11 px-4 text-xs">Sign in<\/Link>\}/);
  assert.match(actions, /aria-disabled=\{loading \|\| undefined\} onClick=\{\(\) => \{ if \(!loading\) retryLoad\(\); \}\}>\{loading \? "Loading…" : "Try again"\}<\/button>/, "unavailable while the day is read, and the same button throughout (D5)");
});

test("the page's other messages keep their words and buttons as they were", () => {
  const messages = page.slice(page.indexOf("const messages = <>"), page.indexOf("const dayAlert = "));
  assert.match(messages, /<div role="alert" className=\{styles\.alert\}>\s*<p>\{error\.text\}<\/p>/, "a log refused for an ended session: its Sign in label never changes");
  const barcode = page.slice(page.indexOf("const said = barcodeMissText(barcodeMiss);"), page.indexOf("Search by name</button>"));
  assert.match(barcode, /<p role="status">\{said\.text\}<\/p>/, "the barcode answer's words are its live region, its \"Checking…\" button is outside it");
});
