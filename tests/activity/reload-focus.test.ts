// Release 3 fix round 3d (open item from round 3c, D5): a sport page's figures that came back by themselves (the
// "online" reload) took their alert and its Try again away without a press, and focus fell to the page: only a press
// of Try again handed it on. Now, when Try again had focus as it went, the figures take focus as after a press; focus
// anywhere else (another control, or the page it was already on) stays where it is.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { focusWitness, handsFocusOn, type FocusDocument } from "@/lib/activity/focus";

const read = (file: string) => readFileSync(file, "utf8");

/** A page that nothing has focused yet, and controls on it. */
function page() {
  const body = { name: "the page" };
  const doc: FocusDocument = { activeElement: body, body };
  const control = (name: string) => ({ name, ownerDocument: doc });
  return { doc, control };
}

/**
 * What React does when it draws something in a control's place: the control's ref is taken away (its cleanup runs)
 * while the control is still on the page, then the control leaves the page, and focus that was on it falls to the page.
 */
function takeAway(doc: FocusDocument, control: object, cleanup: (() => void) | undefined) {
  cleanup?.();
  if (doc.activeElement === control) doc.activeElement = doc.body;
}

describe("a control that goes without a press of it", () => {
  test("the figures come back while Try again has focus: the figures take it, as after a press", () => {
    const { doc, control } = page();
    const tryAgain = focusWitness();
    const button = control("Try again");
    const cleanup = tryAgain.ref(button);
    assert.equal(tryAgain.element(), button);
    doc.activeElement = button;
    // Back online: the figures load and their alert goes, Try again with it.
    takeAway(doc, button, cleanup);
    assert.equal(tryAgain.element(), null);
    assert.equal(doc.activeElement, doc.body, "the browser dropped focus to the page");
    assert.equal(handsFocusOn(doc, { pressed: false, wentWithFocus: tryAgain.wentWithFocus() }), true);
    assert.equal(tryAgain.wentWithFocus(), false, "said once, then forgotten");
  });

  test("focus elsewhere stays: on the page all along, on another control, or moved on before the figures came back", () => {
    {
      // Nobody was on Try again: the page had focus before the figures came back, and keeps it.
      const { doc, control } = page();
      const tryAgain = focusWitness();
      const button = control("Try again");
      takeAway(doc, button, tryAgain.ref(button));
      assert.equal(handsFocusOn(doc, { pressed: false, wentWithFocus: tryAgain.wentWithFocus() }), false);
    }
    {
      // On another control (the Activity link above the figures).
      const { doc, control } = page();
      const tryAgain = focusWitness();
      const button = control("Try again");
      const cleanup = tryAgain.ref(button);
      const back = control("Activity");
      doc.activeElement = back;
      takeAway(doc, button, cleanup);
      assert.equal(handsFocusOn(doc, { pressed: false, wentWithFocus: tryAgain.wentWithFocus() }), false);
      assert.equal(doc.activeElement, back);
    }
    {
      // On Try again, then the member tabbed on to Start walk before the figures came back.
      const { doc, control } = page();
      const tryAgain = focusWitness();
      const button = control("Try again");
      const cleanup = tryAgain.ref(button);
      doc.activeElement = button;
      doc.activeElement = control("Start walk");
      takeAway(doc, button, cleanup);
      assert.equal(tryAgain.wentWithFocus(), false);
    }
  });

  test("after a press, as before: focus moves while the page has it, never once the member moved it", () => {
    const { doc, control } = page();
    // A click that doesn't focus the button (Safari): the page has focus, and the press asked for the figures.
    assert.equal(handsFocusOn(doc, { pressed: true, wentWithFocus: false }), true);
    assert.equal(handsFocusOn(doc, { pressed: false, wentWithFocus: false }), false, "no press, nothing went with focus");
    doc.activeElement = control("Activity");
    assert.equal(handsFocusOn(doc, { pressed: true, wentWithFocus: true }), false);
  });

  test("what a control saw is kept until asked: one drawn again meanwhile, or React's second attach in development, never clears it", () => {
    const { doc, control } = page();
    const tryAgain = focusWitness();
    const first = control("Try again");
    doc.activeElement = first;
    takeAway(doc, first, tryAgain.ref(first));
    const again = control("Try again");
    const cleanupAgain = tryAgain.ref(again);
    // Development only: React takes a new ref away and gives it back once, to check the cleanup.
    cleanupAgain?.();
    tryAgain.ref(again);
    assert.equal(tryAgain.element(), again);
    assert.equal(tryAgain.wentWithFocus(), true);
    // A control that goes without focus says nothing.
    const plain = focusWitness();
    const button = control("Try again");
    const cleanup = plain.ref(button);
    cleanup?.();
    plain.ref(button);
    assert.equal(plain.wentWithFocus(), false);
    assert.equal(plain.ref(null), undefined, "nothing to clean up for no control");
  });
});

test("the React that Next ships takes a removed control's ref away before it takes the control out of the page", () => {
  // focusWitness depends on this order: the ref's cleanup runs while the control is still on the page and focused.
  const compiled = "node_modules/next/dist/compiled/react-dom/cjs";
  for (const build of ["react-dom-client.production.js", "react-dom-client.development.js"]) {
    const text = read(`${compiled}/${build}`);
    const deletion = text.indexOf("function commitDeletionEffectsOnFiber(");
    assert.ok(deletion > 0, `${build}: commitDeletionEffectsOnFiber`);
    const host = text.indexOf("case 5:", deletion);
    const element = text.slice(host, text.indexOf("case 18:", host));
    const detach = element.indexOf("safelyDetachRef(deletedFiber");
    const children = element.indexOf("recursivelyTraverseDeletionEffects(");
    const removal = element.indexOf("removeChild");
    assert.ok(host > deletion && detach >= 0 && children > detach && removal > children, `${build}: an element's ref goes, then its children's, then the element leaves the page`);
    const detachRef = text.slice(text.indexOf("function safelyDetachRef("), text.indexOf("function safelyDetachRef(") + 700);
    assert.match(detachRef, /if \("function" === typeof refCleanup\)\s+try \{[\s\S]{0,200}?(?:refCleanup\(\)|runWithFiberInDEV\(current, refCleanup\))/, `${build}: a ref function's cleanup is what runs`);
    assert.match(text, /\.refCleanup = ref\(instanceToUse\)/, `${build}: what a ref function returns is its cleanup`);
  }
});

describe("the sport page", () => {
  const sport = read("src/components/activity/SportScreen.tsx");

  test("one hand-off serves a press of Try again and figures that came back by themselves while it had focus", () => {
    assert.match(sport, /const \[\{ ref: figuresRetryRef, wentWithFocus: figuresRetryWent \}\] = useState\(\(\) => focusWitness<HTMLButtonElement>\(\)\);/);
    assert.match(sport, /<button type="button" ref=\{figuresRetryRef\} onClick=\{\(\) => void retryFigures\(\)\} aria-disabled=\{retrying \|\| undefined\}/);
    assert.match(sport, /useEffect\(\(\) => \{\s+if \(retrying\) return;\s+const pressed = refocusFigures\.current;\s+refocusFigures\.current = false;\s+const wentWithFocus = figuresRetryWent\(\);\s+if \(statsStatus === "ready" && handsFocusOn\(document, \{ pressed, wentWithFocus \}\)\) figuresRef\.current\?\.focus\(\);\s+\}, \[retrying, statsStatus, figuresRetryWent\]\);/);
    // The same place a press sends focus to: the figures' own region.
    assert.match(sport, /<section ref=\{figuresRef\} tabIndex=\{-1\} aria-label=\{`\$\{SPORT_LABEL\[sport\]\} statistics`\}/);
    // Made once, so React attaches Try again's ref once (a new function on every draw would take it away each time).
    assert.equal((sport.match(/focusWitness</g) ?? []).length, 1);
    assert.ok(sport.indexOf("const [{ ref: figuresRetryRef") < sport.indexOf('if (account.status === "loading")'), "before the early returns");
  });

  test("what brings the figures back by themselves: the feed reads everything again when the browser is back online", () => {
    const feed = read("src/components/activity/useActivityFeed.ts");
    assert.match(feed, /const retry = \(\) => void load\(userId\);\s+window\.addEventListener\("online", retry\);/);
    // The figures' alert stays while that reload runs (it is drawn from the last failure until new figures arrive).
    assert.match(feed, /setStats\(summaries\.status === "ok" \? summaries\.data : null\);\s+setStatsFailure\(summaries\.status === "ok" \? null : /);
  });
});
