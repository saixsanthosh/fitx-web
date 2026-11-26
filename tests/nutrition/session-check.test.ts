// Review finding R3X-2 (fix round 3a): when the sign-in check itself failed (offline, a timeout, an auth outage, where
// supabase-js answers user null with AuthRetryableFetchError), Nutrition told a member who was still signed in to
// "Sign in to track food and water." (also "Sign in to log food.", "Sign in to log water." and History's "Sign in to
// see your history."), with no sign-in link and no retry. The rest of release 3 tells an ended session from a check
// that failed (session-state.ts; the food search route, c76005c), and so does Nutrition now: signed out says so and
// offers Sign in; a check that failed says the session couldn't be checked, that nothing was done, and offers Try again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkSession, signInHref } from "@/components/account/session-state";
import { noMemberText, NUTRITION_PATH, sessionProblem, type SessionAction } from "@/lib/food/session-problem";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const ACTIONS: SessionAction[] = ["load", "log-food", "log-water", "history"];

test("signed out says so and offers Sign in; a check that failed never says signed out", () => {
  for (const action of ACTIONS) {
    assert.equal(sessionProblem("signed_in", action), null, action);
    const ended = sessionProblem("signed_out", action);
    assert.ok(ended, action);
    assert.match(ended.text, /^You're signed out/, action);
    assert.deepEqual([ended.signIn, ended.retry], [true, false], action);
    const unchecked = sessionProblem("unknown", action);
    assert.ok(unchecked, action);
    assert.match(unchecked.text, /^Your session couldn't be checked just now, so .+\. Try again in a moment\.$/, action);
    assert.doesNotMatch(unchecked.text, /sign/i, `${action}: never "sign in" while the member may well be signed in`);
    assert.equal(unchecked.signIn, false, action);
    assert.equal(unchecked.retry, action === "load" || action === "history", `${action}: a log is tried again with its own button`);
  }
  assert.equal(sessionProblem("unknown", "load")?.text, "Your session couldn't be checked just now, so this day didn't load. Try again in a moment.");
  assert.equal(sessionProblem("unknown", "log-food")?.text, "Your session couldn't be checked just now, so the food wasn't logged. Try again in a moment.");
  assert.equal(sessionProblem("signed_out", "load")?.text, "You're signed out. Sign in again to track food and water.");
  assert.equal(signInHref(NUTRITION_PATH), "/signin?next=%2Fnutrition", "Sign in comes back to Nutrition");
});

test("an auth outage is a check that failed, and an ended session is a sign-out", async () => {
  const answer = (error: unknown) => async () => ({ data: { user: null }, error });
  const outage = await checkSession(answer({ name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" }));
  assert.equal(sessionProblem(outage.state, "load")?.retry, true, "offline or a 5xx: Try again");
  const server = await checkSession(answer({ name: "AuthApiError", status: 503 }));
  assert.equal(server.state, "unknown");
  const thrown = await checkSession(async () => { throw new TypeError("network"); });
  assert.equal(sessionProblem(thrown.state, "log-water")?.signIn, false);
  const ended = await checkSession(answer({ name: "AuthSessionMissingError", status: 400 }));
  assert.equal(sessionProblem(ended.state, "load")?.signIn, true);
  const revoked = await checkSession(answer({ name: "AuthApiError", status: 403, code: "session_not_found" }));
  assert.equal(revoked.state, "signed_out");
  const signedIn = await checkSession(async () => ({ data: { user: { id: "u1" } }, error: null }));
  assert.deepEqual([signedIn.state, signedIn.user], ["signed_in", { id: "u1" }]);
});

test("a save made before the page has its member says signed out only when the check said so (the same mistake in the dialogs)", () => {
  assert.equal(noMemberText("signed_out", "save your own foods"), "You're signed out. Sign in again to save your own foods.");
  assert.equal(noMemberText("unknown", "save your own foods"), "Your session couldn't be checked just now, so nothing was saved. Try again in a moment.");
  assert.equal(noMemberText(null, "set your targets"), "Your session is still being checked, so nothing was saved. Try again in a moment.");
  const page = read("src/app/(dashboard)/nutrition/page.tsx");
  for (const old of ["Sign in to change your entries.", "Sign in to save your own foods.", "Sign in to save meals and routines.", "Sign in to set your targets."]) assert.ok(!page.includes(old), old);
  assert.equal((page.match(/noMemberText\(checkedSession, "/g) ?? []).length, 4, "Edit entry, the food form, the name dialog and Daily targets");
  assert.match(page.slice(page.indexOf("const load = useCallback("), page.indexOf("const refreshRecent")), /if \(!current\(\)\) return;\s*setCheckedSession\(state\);/);
});

test("the day, Add to log, the water buttons and History check the session this way and show its message", () => {
  const page = read("src/app/(dashboard)/nutrition/page.tsx");
  for (const old of ["Sign in to track food and water.", "Sign in to log food.", "Sign in to log water."]) assert.ok(!page.includes(old), old);
  const load = page.slice(page.indexOf("const load = useCallback("), page.indexOf("const refreshRecent"));
  assert.match(load, /const \{ state, user \} = await checkSession<User>\(\(\) => supabase\.auth\.getUser\(\)\);/);
  assert.match(load, /if \(!user\) return fail\(sessionProblem\(state, "load"\)/);
  const logFood = page.slice(page.indexOf("async function insertLoggedFood("), page.indexOf("async function addUsual("));
  assert.match(logFood, /if \(!user\) return setError\(sessionProblem\(state, "log-food"\)/);
  const water = page.slice(page.indexOf("async function addWater("), page.indexOf("async function removeMeal("));
  assert.match(water, /if \(!user\) return setError\(sessionProblem\(state, "log-water"\)/);
  // A log refused for an ended session offers Sign in next to the message; the day's own message (day-retry.test.ts)
  // offers Sign in or Try again for as long as the day stays failed.
  assert.match(page, /\{error\.signIn && <div className="mt-2 flex flex-wrap gap-2">\s*<Link href=\{signInHref\(NUTRITION_PATH\)\} className="fitx-button min-h-11 px-4 text-xs">Sign in<\/Link>/);
  assert.match(page, /\{said\.signIn && <Link href=\{signInHref\(NUTRITION_PATH\)\} className="fitx-button min-h-11 px-4 text-xs">Sign in<\/Link>\}/);
  assert.match(page, /\{said\.retry && <button type="button" [^>]*onClick=\{\(\) => \{ if \(!loading\) retryLoad\(\); \}\}>\{loading \? "Loading…" : "Try again"\}<\/button>\}/);
  const retry = page.slice(page.indexOf("function retryLoad("), page.indexOf("function showStart("));
  assert.match(retry, /focusIfLost\.current = \["#meals-title", "#routines-title", "\[data-food-add\]", "#history-title"\];\s*void load\(\);\s*void refreshRecent\(\);\s*if \(!browse\) void browseFoods\(\);/, "the button goes once the day is in: the focus moves on; Recent and the food list are read again too");
  assert.match(page.slice(page.indexOf("const browseFoods = useCallback("), page.indexOf("function retryLoad(")), /setError\(\(current\) => current \|\| message\);/, "the food list's failure never hides the day's message and its Try again");
  const history = read("src/components/nutrition/NutritionHistory.tsx");
  assert.ok(!history.includes("Sign in to see your history."));
  assert.match(history, /if \(!user\) \{ setProblem\(sessionProblem\(state, "history"\)\); setRows\(null\); return; \}/);
  assert.match(history, /\{problem\.signIn && <Link href=\{signInHref\(NUTRITION_PATH\)\}/);
  assert.match(history, /<h2 id="history-title" tabIndex=\{-1\}/, "Try again hands the focus to the heading");
});
