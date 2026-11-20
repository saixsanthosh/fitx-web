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
  const page = readFileSync(new URL("../../src/app/(marketing)/page.tsx", import.meta.url), "utf8");
  // Both read the one cached source (site-contact.ts), which ends in landingContact.
  assert.match(footer, /await publicContact\(\)/);
  assert.match(page, /await publicContact\(\)/);
  assert.doesNotMatch(footer, /BRAND\.(instagramUrl|supportEmail)/, "no second source of truth");
  assert.doesNotMatch(page, /BRAND\.(instagramUrl|supportEmail)/, "no second source of truth");
});

test("what was saved in Admin wins over the NEXT_PUBLIC_ variables and the brand config", () => {
  const brand = { instagramUrl: "https://www.instagram.com/fitx.example/", supportEmail: "hello@example.com" };
  const env = { NEXT_PUBLIC_FITX_INSTAGRAM_URL: "https://instagram.com/env_handle", NEXT_PUBLIC_FITX_CONTACT_EMAIL: "env@example.com" };
  const saved = landingContact({ site: { instagramUrl: "https://instagram.com/admin_handle", supportEmail: "admin@example.com" }, env, brand });
  assert.equal(saved.instagram?.handle, "admin_handle");
  assert.equal(saved.email, "admin@example.com");
  // Nothing saved, or a malformed value, falls through to the next source.
  const unsaved = landingContact({ site: { instagramUrl: null, supportEmail: "not an address" }, env, brand });
  assert.equal(unsaved.instagram?.handle, "env_handle");
  assert.equal(unsaved.email, "env@example.com");
  assert.equal(landingContact({ site: null, env: {}, brand }).email, "hello@example.com");
  assert.match(landingContact({ site: null, env: {}, brand: {} }).missing[0], /^Admin, Settings, Website information/);
});
