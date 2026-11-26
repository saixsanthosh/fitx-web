// Fix round 3c, an open item from round 3a: a day that failed to load for a data reason (its meals, water, profile,
// preferences or foods couldn't be read) said "Your nutrition data could not be loaded. Please try again." with no
// way to try again, and the meals line said "Reload the page to try again." The day's failure is now its own message
// under the tabs, kept for as long as that day stays failed (opening Log food or any other message no longer takes it
// away), with Try again, which reads just that day again: the button stays, unavailable, while it reads, a failure
// again is read out again, and once the day is in the focus moves to the tab's heading (D5). The meals line no longer
// sends the member to reload.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mealsStatusText } from "@/lib/domain/nutrition-day";
import { dayReadProblem, sessionProblem } from "@/lib/food/session-problem";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("a day whose reads failed offers Try again, and names the connection when a read never reached FITX", () => {
  assert.deepEqual(dayReadProblem([500]), { text: "This day couldn't be loaded just now. Try again in a moment.", signIn: false, retry: true });
  assert.deepEqual(dayReadProblem([]), { text: "This day couldn't be loaded just now. Try again in a moment.", signIn: false, retry: true }, "only the member's foods failed");
  assert.deepEqual(dayReadProblem([0, 0, 0]), { text: "FITX couldn't be reached, so this day didn't load. Check your connection and try again.", signIn: false, retry: true }, "supabase-js gives status 0 to a request that never reached FITX");
  assert.equal(dayReadProblem([503, 0]).text.startsWith("FITX couldn't be reached"), true);
  for (const problem of [dayReadProblem([400]), dayReadProblem([0])]) {
    assert.doesNotMatch(problem.text, /reload|refresh the page|sign in|failed to fetch/i, problem.text);
  }
  assert.equal(sessionProblem("unknown", "load")?.retry, true, "the sign-in check that failed keeps its own words and its Try again");
});

test("the meals line says only that the meals couldn't be loaded", () => {
  assert.equal(mealsStatusText("failed"), "This day's meals couldn't be loaded.");
  assert.doesNotMatch(mealsStatusText("failed"), /reload/i);
  assert.equal(mealsStatusText("loading"), "Loading meals…");
});

test("the day's failure is its own message, kept while the day stays failed, with a Try again that keeps the focus", () => {
  const page = read("src/app/(dashboard)/nutrition/page.tsx");
  assert.ok(!page.includes("Your nutrition data could not be loaded"), "the old line with no way to try again is gone");
  const load = page.slice(page.indexOf("const load = useCallback("), page.indexOf("const refreshRecent"));
  const fail = load.slice(load.indexOf("const fail = (message: string | SessionProblem) => {"), load.indexOf("setLoading(true);"));
  assert.match(fail, /setDayProblem\(\(old\) => \(\{ problem: message, attempt: \(old\?\.attempt \?\? 0\) \+ 1 \}\)\);\s*setFailedKey\(dateKey\);/);
  assert.doesNotMatch(fail, /setError\(/, "not the page's message about the last action, which other actions clear");
  assert.match(load, /const failed = \[mealResult, waterResult, profileResult, prefsResult\]\.filter\(\(result\) => result\.error\);\s*if \(failed\.length \|\| custom\.error\) return fail\(dayReadProblem\(failed\.map\(\(result\) => result\.status\)\)\);/);
  assert.match(load, /if \(!user\) return fail\(sessionProblem\(state, "load"\) \?\? dayReadProblem\(\[\]\)\);/);
  assert.match(load, /setFailedKey\(null\);\s*setDayProblem\(null\);/, "once the day is in, its message goes");
  const alert = page.slice(page.indexOf("const dayAlert = "), page.indexOf("const foodList = ("));
  assert.match(alert, /failedKey === dateKey && dayProblem &&/, "shown for as long as this day's load stays failed, on every tab");
  assert.match(alert, /<p key=\{attempt\} role="alert">\{said\.text\}<\/p>/, "a new paragraph per failure: read out again after Try again (only the words are the alert since fix round 3f: day-alert-live.test.ts)");
  assert.match(alert, /aria-disabled=\{loading \|\| undefined\} onClick=\{\(\) => \{ if \(!loading\) retryLoad\(\); \}\}>\{loading \? "Loading…" : "Try again"\}/, "unavailable, not removed or disabled, while the day is read");
  assert.match(page, /<\/nav>\s*\{dayAlert\}\s*\{!logOpen && messages\}/, "under the tabs, beside the page's other messages");
  const messages = page.slice(page.indexOf("const messages = <>"), page.indexOf("const dayAlert = "));
  assert.doesNotMatch(messages, /retryLoad/, "a log's message never offers to reload the day");
  const retry = page.slice(page.indexOf("function retryLoad("), page.indexOf("function showStart("));
  assert.match(retry, /focusIfLost\.current = \["#meals-title", "#routines-title", "\[data-food-add\]", "#history-title"\];/, "the focus goes to the tab's heading when the message goes, History too");
  assert.match(read("src/components/nutrition/MealLog.tsx"), /mealsStatusText\(state\)/);
});
