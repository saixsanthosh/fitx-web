// Home with an ended session (the bug-41 mistake, found in Home too): with no member id the quote area showed its
// loading lines for ever. It now says the member is signed out and offers sign-in; a failed check still waits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const home = readFileSync(new URL("../../src/components/home/DailyHome.tsx", import.meta.url), "utf8");

test("an ended session is told apart from a failed check, and Home says so", () => {
  assert.match(home, /const \{ state, user \} = await checkSession<User>\(\(\) => supabase\.auth\.getUser\(\)\);/);
  assert.match(home, /const signedOut = context\?\.status === "signed_out" \|\| session\.ended;/);
  assert.match(home, /You’re signed out\. <Link href=\{signInHref\("\/dashboard"\)\} className=\{styles\.signIn\}>Sign in again<\/Link> to see today’s quote\./);
  assert.match(home, /\) : signedOut \? \(/, "checked before the loading lines");
  assert.match(home, /aria-busy=\{\(pending && !signedOut\) \|\| undefined\}/);
});
