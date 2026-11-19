import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emailAddress, instagramProfile, landingContact } from "@/components/landing/contact";

test("the contact block uses the brand config when no NEXT_PUBLIC_ variable is set", () => {
  const contact = landingContact({ env: {}, brand: { instagramUrl: "https://www.instagram.com/fitx.example/", supportEmail: "hello@example.com" } });
  assert.deepEqual(contact.instagram, { url: "https://www.instagram.com/fitx.example/", handle: "fitx.example" });
  assert.equal(contact.email, "hello@example.com");
  assert.deepEqual(contact.missing, []);
});

test("NEXT_PUBLIC_ variables win over the brand config", () => {
  const contact = landingContact({
    env: { NEXT_PUBLIC_FITX_INSTAGRAM_URL: "https://instagram.com/other_handle", NEXT_PUBLIC_FITX_CONTACT_EMAIL: "other@example.com" },
    brand: { instagramUrl: "https://www.instagram.com/fitx.example/", supportEmail: "hello@example.com" },
  });
  assert.equal(contact.instagram?.handle, "other_handle");
  assert.equal(contact.email, "other@example.com");
});

test("nothing is invented: unset or malformed values hide that part and name the setting to fill", () => {
  const contact = landingContact({ env: {}, brand: { instagramUrl: "", supportEmail: null } });
  assert.equal(contact.instagram, null);
  assert.equal(contact.email, null);
  assert.equal(contact.missing.length, 2);
  assert.match(contact.missing[0], /NEXT_PUBLIC_FITX_INSTAGRAM_URL/);
  assert.match(contact.missing[1], /NEXT_PUBLIC_FITX_CONTACT_EMAIL/);
});

test("only https instagram.com profiles and plain addresses are accepted", () => {
  assert.equal(instagramProfile("http://instagram.com/a"), null);
  assert.equal(instagramProfile("https://evil.example/instagram.com/a"), null);
  assert.equal(instagramProfile("javascript:alert(1)"), null);
  assert.equal(instagramProfile("https://www.instagram.com/"), null);
  assert.equal(instagramProfile("https://www.instagram.com/a b/"), null);
  assert.equal(emailAddress("not an address"), null);
  assert.equal(emailAddress("a@b"), null);
  assert.equal(emailAddress("<a@b.com>"), null);
  assert.equal(emailAddress(" a@b.com "), "a@b.com");
});

test("the block hides itself when nothing is set, and the footer reads the same settings", () => {
  const block = readFileSync(new URL("../../src/components/landing/ContactBlock.tsx", import.meta.url), "utf8");
  assert.match(block, /if \(!contact\.instagram && !contact\.email\) return null;/);
  const footer = readFileSync(new URL("../../src/components/layout/PublicFooter.tsx", import.meta.url), "utf8");
  assert.match(footer, /landingContact\(\)/);
  assert.doesNotMatch(footer, /BRAND\.(instagramUrl|supportEmail)/, "no second source of truth");
});
