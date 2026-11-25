// Home's quote area and the session (bug 41's mistake on Home; review home-1). With an ended session the quote area
// used to show its loading lines for ever; then it said "You’re signed out" whenever the shared context did, and the
// context says that for a check that only failed (offline, a timeout, a 5xx) too. Home now asks the session itself
// whenever the context names no member, says "signed out" only when its own check does, and during an outage shows the
// day's quote this device keeps for the member its session names (src/lib/home/quote-area.ts).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homeMember, needsOwnCheck, quoteArea, type OwnCheck, type SharedMember } from "@/lib/home/quote-area";

const ID = "11111111-1111-4111-8111-111111111111";
const ready: SharedMember = { status: "ready", userId: ID };
// What UserContextProvider set for any getUser() answer without a user before release 3, offline too (it now says
// "error" for a check that failed); Home goes by its own check either way.
const contextSignedOut: SharedMember = { status: "signed_out", userId: null };
const signedOut: OwnCheck = { state: "signed_out", userId: null };
const offlineWithSession: OwnCheck = { state: "unknown", userId: ID };
const offlineNoSession: OwnCheck = { state: "unknown", userId: null };
const signedIn: OwnCheck = { state: "signed_in", userId: ID };

describe("when Home asks the session itself", () => {
  test("not while the shared context names its member, nor while it is still loading", () => {
    assert.equal(needsOwnCheck(ready), false);
    assert.equal(needsOwnCheck({ status: "error", userId: ID }), false, "a failed refresh keeps the member it loaded");
    assert.equal(needsOwnCheck({ status: "loading", userId: null }), false);
  });

  test("whenever the context names nobody: signed out (which may be a failed check), failed, unavailable or missing", () => {
    assert.equal(needsOwnCheck(contextSignedOut), true);
    assert.equal(needsOwnCheck({ status: "error", userId: null }), true);
    assert.equal(needsOwnCheck({ status: "unavailable", userId: null }), true);
    assert.equal(needsOwnCheck(null), true, "no provider mounted");
  });
});

describe("what the quote area says", () => {
  test("signed in: the member's quote, with loading lines until it arrives", () => {
    const member = homeMember(ready, null);
    assert.deepEqual(member, { kind: "member", userId: ID });
    assert.equal(quoteArea(member, "loading"), "loading");
    assert.equal(quoteArea(member, "shown"), "quote");
    assert.equal(quoteArea(member, "missing"), "unavailable", "Today’s quote could not be loaded…");
  });

  test("signed out: only when Home's own check says so, never on the context's word alone", () => {
    assert.deepEqual(homeMember(contextSignedOut, null), { kind: "waiting" }, "the check hasn't answered yet");
    assert.equal(quoteArea(homeMember(contextSignedOut, null), "loading"), "loading");
    assert.deepEqual(homeMember(contextSignedOut, signedOut), { kind: "signed_out" });
    assert.equal(quoteArea(homeMember(contextSignedOut, signedOut), "loading"), "signed_out", "You’re signed out. Sign in again…");
  });

  test("a check that failed (offline, a 5xx) never says signed out: the device's quote for its session's member shows", () => {
    const member = homeMember(contextSignedOut, offlineWithSession);
    assert.deepEqual(member, { kind: "member", userId: ID }, "getDailyQuote then falls back to this device's copy of the day's quote");
    assert.equal(quoteArea(member, "shown"), "quote");
  });

  test("a check that failed with no session member to go on says the quote couldn't be loaded, and doesn't load for ever", () => {
    const member = homeMember(contextSignedOut, offlineNoSession);
    assert.deepEqual(member, { kind: "unknown" });
    assert.equal(quoteArea(member, "loading"), "unavailable");
    assert.equal(quoteArea(homeMember({ status: "unavailable", userId: null }, offlineNoSession), "loading"), "unavailable", "no Supabase client");
  });

  test("a failed context load with a working session shows the member's quote", () => {
    assert.deepEqual(homeMember({ status: "error", userId: null }, signedIn), { kind: "member", userId: ID });
    assert.deepEqual(homeMember(null, signedIn), { kind: "member", userId: ID }, "no provider mounted");
  });

  test("the context's own member wins over an older check", () => {
    assert.deepEqual(homeMember(ready, signedOut), { kind: "member", userId: ID });
  });
});

describe("DailyHome uses it", () => {
  const home = readFileSync(new URL("../../src/components/home/DailyHome.tsx", import.meta.url), "utf8");

  test("the decision comes from quote-area.ts, not from the context's status", () => {
    assert.match(home, /const checkNeeded = needsOwnCheck\(shared\);/);
    assert.match(home, /checkSessionKeepingMember\(supabase\?\.auth \?\? null\)/);
    assert.match(home, /if \(event === "SIGNED_OUT" && live\) setOwn\(\{ state: "signed_out", userId: null \}\);/);
    assert.match(home, /const member = homeMember\(shared, own\);/);
    assert.match(home, /const area = quoteArea\(member, /);
    assert.doesNotMatch(home, /context\?\.status === "signed_out"/, "the context's \"signed_out\" is never taken as proof");
  });

  test("each area has its own text, and only loading is busy", () => {
    assert.match(home, /aria-busy=\{area === "loading" \|\| undefined\}/);
    assert.match(home, /\) : area === "signed_out" \? \(/);
    assert.match(home, /You’re signed out\. <Link href=\{signInHref\("\/dashboard"\)\} className=\{styles\.signIn\}>Sign in again<\/Link> to see today’s quote\./);
    assert.match(home, /Today’s quote could not be loaded\. It will be here when you come back\./);
  });
});
