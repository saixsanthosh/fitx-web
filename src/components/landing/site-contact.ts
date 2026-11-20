// The public pages' contact details from FITX Admin (Settings, Website information), without per-request
// rendering: the read is cached for SITE_CONTACT_REVALIDATE_SECONDS and the public pages are regenerated in the
// background on the same window (export const revalidate = 300 in src/app/(marketing)/layout.tsx).
import { unstable_cache } from "next/cache";
import { BRAND } from "@/config/brand";
import { readPlatformSettings } from "@/lib/platform/gate";
import type { PlatformSettings } from "@/lib/platform/settings";
import { landingContact, type LandingContact } from "./contact";

/** Keep equal to `revalidate` in src/app/(marketing)/layout.tsx (Next needs a literal there). */
export const SITE_CONTACT_REVALIDATE_SECONDS = 300;

type SavedSite = { supportEmail: string | null; instagramUrl: string | null };

/**
 * The values Admin saved. readPlatformSettings answers the brand config for anything unsaved, unreadable or
 * invalid, so a value equal to the brand's adds nothing and is left to the usual order (contact.ts).
 */
export function savedSite(site: PlatformSettings["site"], brand: { supportEmail: string; instagramUrl: string } = BRAND): SavedSite {
  return {
    supportEmail: site.supportEmail && site.supportEmail !== brand.supportEmail ? site.supportEmail : null,
    instagramUrl: site.instagramUrl && site.instagramUrl !== brand.instagramUrl ? site.instagramUrl : null,
  };
}

const cachedSite = unstable_cache(async (): Promise<SavedSite> => savedSite((await readPlatformSettings()).site), ["fitx-platform-site"], {
  revalidate: SITE_CONTACT_REVALIDATE_SECONDS,
  tags: ["platform-settings"],
});

/** The contact details for the landing page and the public footer. Never throws: a failure means the fallbacks. */
export async function publicContact(): Promise<LandingContact> {
  let site: SavedSite | null = null;
  try {
    site = await cachedSite();
  } catch {
    site = null;
  }
  return landingContact({ site });
}
