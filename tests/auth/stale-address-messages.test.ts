// Bug 44 (public-9): an old "That link has expired…" (or ?error=callback, ?error=browser, ?signed_out=1) came back on the
// email step after a new code was sent and "Change email" was pressed, and after any reload, because the sign-in page
// read it from its address whenever the form had no error of its own, and nothing took it out of the address. Once the
// member acts on the page the page stops showing it and removes it from the address, keeping ?next=.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addressError, addressNotice, withoutAddressMessages } from "@/lib/auth/address-messages";

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

test("the address loses its one-time messages and keeps everything else", () => {
  assert.equal(withoutAddressMessages("?error=expired"), "");
  assert.equal(withoutAddressMessages("?signed_out=1"), "");
  assert.equal(withoutAddressMessages("?signed_out=everywhere&error=callback"), "");
  assert.equal(withoutAddressMessages("?error=expired&next=%2Fnutrition"), "?next=%2Fnutrition");
  assert.equal(withoutAddressMessages("?next=%2Fworkouts%3Fplan%3D1&error=browser"), "?next=%2Fworkouts%3Fplan%3D1", "a next with its own query survives");
  assert.equal(withoutAddressMessages("?next=%2Fprogress&signed_out=1&setup=supabase"), "?next=%2Fprogress&setup=supabase");
  assert.equal(withoutAddressMessages(""), "");
  assert.equal(withoutAddressMessages("?next=%2Fhelp"), "?next=%2Fhelp", "nothing to take out: the same query");
});

test("once taken out, a reload of the address shows nothing old", () => {
  for (const search of ["?error=expired", "?error=callback&next=%2Factivity", "?error=browser", "?signed_out=1", "?signed_out=everywhere"]) {
    assert.ok(addressError(search) || addressNotice(search), `${search} carries a message`);
    const after = withoutAddressMessages(search);
    assert.equal(addressError(after), "", `${search} → ${after}`);
    assert.equal(addressNotice(after), "", `${search} → ${after}`);
    assert.equal(new URLSearchParams(after).get("next"), new URLSearchParams(search).get("next"), "next is kept");
  }
});

test("every way of acting on the sign-in page dismisses the address's messages first", () => {
  const form = read("src/app/(auth)/signin/SignInForm.tsx");
  assert.match(form, /async function submit\(event: FormEvent<HTMLFormElement>\) \{\s*event\.preventDefault\(\);\s*if \(loading\) return;\s*dismissAddressMessages\(\);/, "a code or a password sign-in");
  assert.match(form, /async function signInWith\(provider: OAuthProvider\) \{\s*if \(loading\) return;\s*dismissAddressMessages\(\);/, "Google's redirect or Apple");
  assert.match(form, /onBusy=\{\(busy\) => \{\s*if \(busy\) dismissAddressMessages\(\);/, "Google's own button");
  // Dismissed for the page's life: the email step that comes back after Change email can't show it again.
  assert.match(form, /const notice = addressDismissed \? "" : locationNotice;/);
  assert.match(form, /const pageError = providerError \|\| \(addressDismissed \? "" : locationError\);/);
  // And out of the address, with the page's own path and hash, so a reload is clean too.
  assert.match(form, /setAddressDismissed\(true\);\s*const search = withoutAddressMessages\(window\.location\.search\);\s*if \(search !== window\.location\.search\) window\.history\.replaceState\(null, "", `\$\{window\.location\.pathname\}\$\{search\}\$\{window\.location\.hash\}`\);/);
});
