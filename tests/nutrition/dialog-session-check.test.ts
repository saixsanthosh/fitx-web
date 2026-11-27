// Review finding (fix round 3f, a11y-copy-nutrition-unchecked-session-dialog-retry): when Nutrition's first sign-in
// check failed (offline, an auth outage), every save in a dialog (Add a food, Edit entry, a meal or routine name, Daily
// targets) said "Your session couldn't be checked just now, so nothing was saved. Try again in a moment." and trying
// again could never work: those saves used the page's member, which only a day load whose check succeeded sets, and
// never checked the session themselves. The only way out was to close the dialog, losing what was typed, and press the
// day's Try again behind it. A save with no member yet now makes the check itself, as logging does, so Save pressed
// again works once the check can be made. The food preferences' Save, which did nothing at all then, does the same.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkSession, type SessionState } from "@/components/account/session-state";
import { memberForSave, noMemberText } from "@/lib/food/session-problem";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const page = read("src/app/(dashboard)/nutrition/page.tsx");
const between = (from: string, to: string) => {
  const start = page.indexOf(from);
  assert.ok(start >= 0, from);
  const end = page.indexOf(to, start + from.length);
  assert.ok(end > start, to);
  return page.slice(start, end);
};

/** A sign-in check that answers in turn, counting how often it was made. */
function checks(...answers: Array<{ state: SessionState; user: { id: string } | null }>) {
  const made = { count: 0 };
  const check = async () => answers[Math.min(made.count++, answers.length - 1)];
  return { made, check };
}

test("with no member yet a dialog's save checks the session itself, every time, so Save again works once it can", async () => {
  const { made, check } = checks({ state: "unknown", user: null }, { state: "unknown", user: null }, { state: "signed_in", user: { id: "u1" } });
  const first = await memberForSave(null, check, "save your own foods");
  assert.deepEqual(first, { ok: false, refused: "Your session couldn't be checked just now, so nothing was saved. Try again in a moment.", state: "unknown" });
  assert.deepEqual(await memberForSave(null, check, "save your own foods"), first, "still failing: the same words, a new check");
  assert.deepEqual(await memberForSave(null, check, "save your own foods"), { ok: true, uid: "u1", found: true }, "Save pressed again once the check can be made: saved");
  assert.equal(made.count, 3, "nothing is kept from a check that gave no member");
  const ended = await memberForSave(null, checks({ state: "signed_out", user: null }).check, "set your targets");
  assert.deepEqual(ended, { ok: false, refused: noMemberText("signed_out", "set your targets"), state: "signed_out" });
  assert.equal(ended.ok === false && ended.refused, "You're signed out. Sign in again to set your targets.");
  const known = checks({ state: "unknown", user: null });
  assert.deepEqual(await memberForSave("u1", known.check, "change your entries"), { ok: true, uid: "u1", found: false }, "the member the day's load found");
  assert.equal(known.made.count, 0, "and no check of its own");
});

test("the real check: an auth outage is refused with words that are now true, and the next Save finds the member", async () => {
  const outage = () => checkSession<{ id: string }>(async () => ({ data: { user: null }, error: { name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" } }));
  const back = () => checkSession<{ id: string }>(async () => ({ data: { user: { id: "u1" } }, error: null }));
  const refused = await memberForSave(null, outage, "save meals and routines");
  assert.equal(refused.ok, false);
  assert.match(refused.ok === false ? refused.refused : "", /^Your session couldn't be checked just now, so nothing was saved\. Try again in a moment\.$/);
  assert.doesNotMatch(refused.ok === false ? refused.refused : "", /sign in/i, "never a sign-out while the member may well be signed in");
  assert.deepEqual(await memberForSave(null, back, "save meals and routines"), { ok: true, uid: "u1", found: true });
});

test("every dialog's save goes through saveMember, which makes the member found the page's, with what the database has", () => {
  const helper = between("async function saveMember(", "/** Saves an edited entry.");
  assert.match(helper, /const member = await memberForSave\(userId, \(\) => checkSession<User>\(\(\) => supabase\.auth\.getUser\(\)\), what\);/);
  assert.match(helper, /if \(!member\.ok\) \{ setCheckedSession\(member\.state\); return \{ ok: false, refused: member\.refused \}; \}/);
  assert.match(helper, /if \(!member\.found\) return \{ ok: true, uid: member\.uid, caps: capabilities \};/, "a member the day's load found keeps what that load detected");
  assert.match(helper, /const caps = await detectCapabilities\(supabase\);\s*setCheckedSession\("signed_in"\);\s*setUserId\(member\.uid\);\s*setCapabilities\(caps\);/, "found by the save: the page's member from then on");
  for (const [from, to, what] of [
    ["async function saveEntry(", "async function saveFood(", "change your entries"],
    ["async function saveFood(", "async function removeFood(", "save your own foods"],
    ["async function saveNamed(", "async function applyTemplate(", "save meals and routines"],
    ["async function updateTargets(", "function saveSelectedAsFood(", "set your targets"],
  ] as const) {
    const save = between(from, to);
    assert.match(save, new RegExp(`setBusy\\(true\\); setError\\(""\\);\\s*const member = await saveMember\\(supabase, "${what}"\\);\\s*if \\(!member\\.ok\\) \\{ setBusy\\(false\\); return `), `${from}: busy while it checks (a second press does nothing), and the refusal stays in the dialog`);
    assert.doesNotMatch(save, /!userId/, `${from}: never refused for want of the day's member alone`);
    assert.doesNotMatch(save, /[(, ]userId[,)]/, `${from}: saves for the member it checked`);
  }
  const food = between("async function saveFood(", "async function removeFood(");
  assert.match(food, /const v2 = member\.caps\.customFoodsV2;/, "a food saved this way gets every column the database has");
  assert.doesNotMatch(food, /capabilities\.customFoodsV2/);
  const setup = between("async function finishSetup(", "function laterSetup(");
  assert.match(setup, /const member = await saveMember\(supabase, "save your food preferences"\);\s*if \(!member\.ok\) \{ setSetupError\(member\.refused\); return; \}/, "the food preferences say why, inside the dialog, instead of doing nothing");
  assert.match(setup, /saveSetup\(supabase, member\.uid, answers,/);
  assert.match(setup, /writeSnooze\(member\.uid, null\);/);
});
