// Fix round 3d (open-3c-profile-save-timeout, the same mistake in Settings > Delete my account): a check that never
// answered left "Checking your account…" up for good, and a deletion that never answered held the member in the dialog
// on "Deleting…", with Cancel and Escape switched off, until the page was reloaded. The check now stops at 20 s and is
// cancelled (src/components/account/deletion-wait.ts). Deleting is never cancelled, since only its answer can say it
// worked: after 30 s the dialog says it is slow and may be closed, and the answer is still used when it comes.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DELETE_TAKING_LONG, DELETION_TIME_LIMIT_MS, canCloseDeletion, fetchDeletionStatus, type DeletionStep } from "@/components/account/deletion-wait";
import { RECENT_SIGN_IN_MINUTES } from "@/lib/account/deletion";

const source = readFileSync(new URL("../../src/components/account/DeleteAccount.tsx", import.meta.url), "utf8");
const turn = () => new Promise((resolve) => setImmediate(resolve));
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fetch that never answers until its signal is aborted, as a browser's does then. */
function hangingFetch() {
  const signals: AbortSignal[] = [];
  const request = (_input: string, init: RequestInit) => {
    const signal = init.signal as AbortSignal;
    signals.push(signal);
    return new Promise<Response>((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")), { once: true }));
  };
  return { request, signals };
}

describe("checking whether the account can be deleted waits at most 20 s", () => {
  test("a check that never answers stops at 20 s, not before, is cancelled, and counts as one that failed", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { request, signals } = hangingFetch();
    let settled = false;
    const checked = fetchDeletionStatus(request);
    void checked.then(() => { settled = true; });
    t.mock.timers.tick(DELETION_TIME_LIMIT_MS.status - 1);
    await turn();
    assert.equal(settled, false, "still waiting a moment before the limit");
    assert.equal(signals[0].aborted, false);
    t.mock.timers.tick(1);
    // The dialog then says "We couldn’t check whether your account can be deleted. Check your connection and try again."
    assert.deepEqual(await checked, { kind: "error" });
    assert.equal(signals[0].aborted, true, "the request is cancelled");
  });

  test("an answer whose body never finishes is cut off at the limit too", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let signal: AbortSignal | undefined;
    const stalledBody = (_input: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      const body = new ReadableStream({ start(controller) { signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError"))); } });
      return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "application/json" } }));
    };
    const checked = fetchDeletionStatus(stalledBody);
    await turn();
    t.mock.timers.tick(DELETION_TIME_LIMIT_MS.status);
    assert.deepEqual(await checked, { kind: "error" });
  });

  test("answers in time keep their meaning: deletable, signed out, an outage, a failure", async () => {
    const status = { available: true, recentSignIn: true, signedInAt: "2026-11-26T04:00:00.000Z", windowMinutes: RECENT_SIGN_IN_MINUTES, userId: "member", email: "a@example.com" };
    assert.deepEqual(await fetchDeletionStatus(async () => json(200, { deletion: status })), { kind: "ok", status, signedOut: false });
    const signedOut = await fetchDeletionStatus(async () => json(401, { error: "signed_out" }));
    assert.equal(signedOut.kind === "ok" && signedOut.signedOut, true);
    assert.deepEqual(await fetchDeletionStatus(async () => json(503, { error: "auth_unavailable" })), { kind: "outage" });
    assert.deepEqual(await fetchDeletionStatus(async () => json(500, {})), { kind: "error" });
    assert.deepEqual(await fetchDeletionStatus(async () => { throw new TypeError("Failed to fetch"); }), { kind: "error" });
    let init: RequestInit | undefined;
    await fetchDeletionStatus(async (_input, given) => { init = given; return json(200, { deletion: status }); });
    assert.equal(init?.cache, "no-store");
    assert.ok(init?.signal instanceof AbortSignal, "the request carries the signal the limit aborts");
  });
});

describe("deleting is never cancelled, but the member is not held in the dialog", () => {
  test("the dialog may close, except once deleted, while signing out, and while deleting until it is slow", () => {
    const steps: DeletionStep[] = ["checking", "unavailable", "reauth", "switched", "confirm", "deleting", "deleted", "error"];
    for (const step of steps) {
      const expected = step !== "deleted" && step !== "deleting";
      assert.equal(canCloseDeletion(step, { leaving: false, slow: false }), expected, step);
      assert.equal(canCloseDeletion(step, { leaving: true, slow: false }), false, `${step}, signing out`);
    }
    assert.equal(canCloseDeletion("deleting", { leaving: false, slow: true }), true, "slow: it may be closed");
    assert.equal(canCloseDeletion("deleted", { leaving: false, slow: true }), false);
    assert.equal(DELETION_TIME_LIMIT_MS.slow, 30_000);
    assert.equal(DELETION_TIME_LIMIT_MS.status, 20_000);
  });

  test("the slow note says what is happening and what to do, plainly", () => {
    assert.equal(DELETE_TAKING_LONG, "Deleting is taking longer than usual. You can close this now: if it goes through, you’ll be signed out. Reload the page later to check.");
    assert.doesNotMatch(DELETE_TAKING_LONG, /error|fail|timeout|timed out|request/i);
  });

  test("the dialog is wired to it: a slow timer, Close and Escape once slow, the note, and the answer used when it comes", () => {
    const remove = source.slice(source.indexOf("async function remove()"), source.indexOf("const unavailable ="));
    assert.match(remove, /const slowTimer = window\.setTimeout\(\(\) => setSlow\(true\), DELETION_TIME_LIMIT_MS\.slow\);/);
    assert.match(remove, /\} finally \{\s*(?:\/\/[^\n]*\n\s*)*deleting\.current = false;\s*\}/, "once answered, opening the dialog may start afresh");
    assert.match(remove, /\} finally \{\s*window\.clearTimeout\(slowTimer\);\s*setSlow\(false\);\s*\}\s*\}\s*$/, "slow until the answer is dealt with, its body included");
    const request = remove.slice(remove.indexOf('fetch("/api/account"'), remove.indexOf("} catch"));
    assert.doesNotMatch(request, /signal/, "the deletion itself is never cancelled");
    assert.match(remove, /if \(dialog\.current && !dialog\.current\.open\) \{\s*dialog\.current\.showModal\(\);\s*dialog\.current\.querySelector<HTMLElement>\("\[data-autofocus\]"\)\?\.focus\(\);\s*\}/, "a deletion that went through after closing says so");
    assert.match(source, /onCancel=\{\(event\) => \{ if \(!closable\) event\.preventDefault\(\); \}\}/, "Escape works once slow");
    assert.match(source, /\{step === "switched" \|\| \(step === "deleting" && slow\) \? "Close" : "Cancel"\}/);
    assert.match(source, /\{step === "deleting" && slow && <p role="status" [^>]*>\{DELETE_TAKING_LONG\}<\/p>\}/, "announced in the dialog (D6)");
    assert.match(source, /async function open\(\) \{\s*if \(deleting\.current\) \{\s*if \(!dialog\.current\?\.open\) dialog\.current\?\.showModal\(\);\s*return null;\s*\}/, "opening again while it goes on shows it, never a second deletion");
    assert.match(source, /void fetchDeletionStatus\(\)\.then/, "the Settings row's check has the limit too");
    assert.match(source, /const result = await fetchDeletionStatus\(\);/);
  });
});
