// Bug 42 (home-settings-2): after "Sign out everywhere" the sign-in page said "You're signed out on this device.", the
// same address and words as a plain Log out, so the member couldn't tell their other devices were signed out too. Each
// kind of sign-out now lands on its own address, and the sign-in page says which one happened ("everywhere" only with
// this browser's own proof of it: tests/auth/address-claims.test.ts, review security:R3-SEC-1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ADDRESS_ERRORS,
  addressError,
  addressNotice,
  SETUP_MISSING,
  SIGNED_OUT_EVERYWHERE,
  SIGNED_OUT_HERE,
  signedOutAddress,
} from "@/lib/auth/address-messages";
import { SUSPENDED_MESSAGE } from "@/lib/platform/account-status";

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

test("Log out and Sign out everywhere each land on their own address", () => {
  assert.equal(signedOutAddress("local"), "/signin?signed_out=1", "Log out's address is unchanged (flow 08 waits for it)");
  assert.equal(signedOutAddress("global"), "/signin?signed_out=everywhere");
});

test("the sign-in page says which sign-out happened", () => {
  assert.equal(addressNotice("?signed_out=1"), SIGNED_OUT_HERE);
  assert.equal(SIGNED_OUT_HERE, "You’re signed out on this device.");
  assert.equal(addressNotice("?signed_out=everywhere", "everywhere"), SIGNED_OUT_EVERYWHERE);
  assert.equal(addressNotice("?signed_out=everywhere"), SIGNED_OUT_HERE, "without this browser's proof, this device only");
  assert.match(SIGNED_OUT_EVERYWHERE, /signed out everywhere/, "the words of the button the member pressed");
  assert.match(SIGNED_OUT_EVERYWHERE, /including this device/, "and the confirmation's own: every device, this one too");
  assert.equal(addressNotice(new URL(signedOutAddress("global"), "https://fitx.test").search, "everywhere"), SIGNED_OUT_EVERYWHERE, "the round trip");
  assert.equal(addressNotice(new URL(signedOutAddress("local"), "https://fitx.test").search), SIGNED_OUT_HERE);
  assert.equal(addressNotice("?signed_out=anything"), SIGNED_OUT_HERE, "an unknown value never claims more than this device");
  assert.equal(addressNotice("?signed_out=anything", "everywhere"), SIGNED_OUT_HERE, "not even with the proof");
  assert.equal(addressNotice(""), "");
  assert.equal(addressNotice("?next=%2Fworkouts"), "");
});

test("the address's errors are the known ones only, never text from the address", () => {
  assert.equal(addressError("?error=suspended"), SUSPENDED_MESSAGE);
  assert.match(addressError("?error=expired"), /^That link has expired or was already used\./);
  for (const code of Object.keys(ADDRESS_ERRORS)) assert.equal(addressError(`?error=${code}`), ADDRESS_ERRORS[code], code);
  for (const code of ["", "unknown", "constructor", "__proto__", "toString", "hasOwnProperty", "Your session has ended"]) {
    assert.equal(addressError(`?error=${encodeURIComponent(code)}`), "", `?error=${code}: an inherited name or free text is not a message`);
  }
  assert.equal(addressError("?setup=supabase", false), SETUP_MISSING, "where the page finds Supabase unset");
  assert.equal(addressError(""), "");
});

test("both sign-out buttons go through the one address helper", () => {
  const button = read("src/components/app/LogoutButton.tsx");
  assert.match(button, /window\.location\.replace\(signedOutAddress\(scope, outcome\)\);/);
  assert.doesNotMatch(button, /signed_out=1/, "no address of its own");
  assert.match(button, /const text = label \?\? \(everywhere \? "Sign out everywhere" : "Log out"\);/);
  assert.match(read("src/app/(auth)/signin/SignInForm.tsx"), /addressNotice\(window\.location\.search, noticeProof\(\)\)/);
});
