// The public pages read the website information saved in FITX Admin through one cached read, and stay static.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BRAND } from "@/config/brand";
import { PLATFORM_DEFAULTS, parsePlatformSettings } from "@/lib/platform/settings";

const source = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

// site-contact.ts imports next/cache, which needs Next's runtime only when the cached read is called.
const { SITE_CONTACT_REVALIDATE_SECONDS, savedSite } = await import("@/components/landing/site-contact");

test("only values Admin saved count as saved; the defaults (the brand config) leave the usual order", () => {
  assert.deepEqual(savedSite(PLATFORM_DEFAULTS.site), { supportEmail: null, instagramUrl: null });
  const saved = parsePlatformSettings({ site: { supportEmail: "team@example.com", instagramUrl: "https://www.instagram.com/fitx_team/" } }).site;
  assert.deepEqual(savedSite(saved), { supportEmail: "team@example.com", instagramUrl: "https://www.instagram.com/fitx_team/" });
  // An invalid saved value is already the brand's after parsing, so it is not counted as saved.
  const invalid = parsePlatformSettings({ site: { supportEmail: "nope", instagramUrl: "https://evil.example/x" } }).site;
  assert.deepEqual(savedSite(invalid), { supportEmail: null, instagramUrl: null });
  assert.equal(invalid.supportEmail, BRAND.supportEmail);
});

test("the public pages stay static: a cached read, regenerated on the same five-minute window", () => {
  const reader = source("src/components/landing/site-contact.ts");
  assert.match(reader, /unstable_cache\(/);
  assert.match(reader, /revalidate: SITE_CONTACT_REVALIDATE_SECONDS/);
  assert.match(reader, /readPlatformSettings\(\)/);
  assert.equal(SITE_CONTACT_REVALIDATE_SECONDS, 300);
  const layout = source("src/app/(marketing)/layout.tsx");
  assert.match(layout, new RegExp(`^export const revalidate = ${SITE_CONTACT_REVALIDATE_SECONDS};$`, "m"));
  for (const file of ["src/app/(marketing)/layout.tsx", "src/app/(marketing)/page.tsx", "src/components/layout/PublicFooter.tsx", "src/components/landing/site-contact.ts"]) {
    assert.doesNotMatch(source(file), /force-dynamic|cookies\(\)|headers\(\)|connection\(\)/, `${file} stays static`);
  }
});
