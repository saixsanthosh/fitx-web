// Review finding (fix round 3f, a11y-nutrition-day-retry-to-sign-in-drops-focus): sometimes the day's Try again finds
// that the session has ended meanwhile (after a long time offline, say). Its message then offers Sign in instead of Try
// again, the focused Try again goes with it, and nothing moved the focus on: it fell to the page, against D5. History
// (its heading) and Profile (its alert's Sign in) already handle the same case. Once a Try again has its answer, a
// failure that took the button pressed away now hands the focus to the message's own control, Sign in here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DAY_ACTIONS, dayRetryFocusTargets, focusFellToPage } from "@/lib/food/reload-focus";
import { dayReadProblem, sessionProblem } from "@/lib/food/session-problem";

const page = readFileSync(new URL("../../src/app/(dashboard)/nutrition/page.tsx", import.meta.url), "utf8");
const between = (from: string, to: string) => {
  const start = page.indexOf(from);
  assert.ok(start >= 0, from);
  const end = page.indexOf(to, start + from.length);
  assert.ok(end > start, to);
  return page.slice(start, end);
};

/** Whether the Try again that was pressed is still drawn once the day's answer is in: only when the answer offers one. */
const tryAgainStays = (answer: { retry: boolean }) => answer.retry;

test("a Try again whose answer is \"signed out\" hands the focus to Sign in; one that stays keeps it", () => {
  const body = {};
  // The session ended meanwhile: the answer offers Sign in only, so the button pressed is gone and the focus fell.
  const ended = sessionProblem("signed_out", "load");
  assert.ok(ended);
  assert.deepEqual([ended.signIn, ended.retry], [true, false]);
  const fell = focusFellToPage(tryAgainStays(ended) ? {} : body, body);
  assert.equal(fell, true);
  assert.deepEqual(dayRetryFocusTargets(true, fell), [DAY_ACTIONS, "#meals-title", "#routines-title", "[data-food-add]", "#history-title"], "the message's own control first (Sign in), else the tab's heading");
  // A failure that offers Try again again keeps the very same button, and the focus on it.
  for (const again of [sessionProblem("unknown", "load"), dayReadProblem([500]), dayReadProblem([0])]) {
    assert.ok(again);
    assert.equal(tryAgainStays(again), true);
    assert.deepEqual(dayRetryFocusTargets(true, focusFellToPage({}, body)), [], again.text);
  }
  assert.deepEqual(dayRetryFocusTargets(false, true), [], "the day loaded: retryLoad's own targets hand it to the heading (reloadFocusTargets)");
  assert.deepEqual(dayRetryFocusTargets(false, false), []);
  assert.deepEqual(dayRetryFocusTargets(true, false), [], "the member moved the focus on meanwhile: it stays there");
});

test("the page remembers the press until the answer is drawn, then moves the focus only where it fell", () => {
  const retry = between("function retryLoad(", "function showStart(");
  assert.match(retry, /dayRetried\.current = true;\s*focusIfLost\.current = \[/, "set by Try again, before the day is read");
  assert.match(page, /const dayFailed = failedKey === dateKey && dayProblem !== null;/, "the same rule that shows the message");
  const effect = between("useEffect(() => {\n    if (!dayRetried.current || loading) return;", "/** \"Type the number\"");
  assert.match(effect, /dayRetried\.current = false;\s*for \(const selector of dayRetryFocusTargets\(dayFailed, focusFellToPage\(document\.activeElement, document\.body\)\)\) \{\s*const target = document\.querySelector<HTMLElement>\(selector\);\s*if \(target\) \{ target\.focus\(\); return; \}/);
  assert.match(effect, /\}, \[loading, dayFailed\]\);/, "run once the read is over (loading ends), whatever the answer");
  // Only the press waits for its answer: while the day is read it does nothing, and Try again keeps the focus (aria-disabled).
  assert.ok(page.indexOf("if (!dayRetried.current || loading) return;") > page.indexOf("}, [entries, customRows, templates]);"), "after the reload's own focus step, which hands a loaded day to its heading");
});

test("the message's controls are marked for it, Sign in first", () => {
  const alert = between("const dayAlert = ", "const foodList = (");
  assert.match(alert, /<div className="mt-2 flex flex-wrap gap-2" data-day-actions="">/);
  const actions = alert.slice(alert.indexOf("data-day-actions"));
  assert.ok(actions.indexOf("Sign in</Link>") > 0 && actions.indexOf("Sign in</Link>") < actions.indexOf("retryLoad()"), "Sign in comes before Try again");
  assert.equal(DAY_ACTIONS, "[data-day-actions] a, [data-day-actions] button");
  assert.match(between("const fail = (message: string | SessionProblem) => {", "};"), /focusIfLost\.current = null;/, "a failure never uses the heading targets meant for a day that loaded");
});
