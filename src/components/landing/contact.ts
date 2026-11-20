import { BRAND } from "@/config/brand";

/** The settings the landing page's contact block reads, in the order they win. */
export const CONTACT_SETTINGS = {
  instagram: ["Admin, Settings, Website information (Instagram)", "NEXT_PUBLIC_FITX_INSTAGRAM_URL", "BRAND.instagramUrl (src/config/brand.ts)"],
  email: ["Admin, Settings, Website information (support email)", "NEXT_PUBLIC_FITX_CONTACT_EMAIL", "BRAND.supportEmail (src/config/brand.ts)"],
} as const;

export type LandingContact = {
  instagram: { url: string; handle: string } | null;
  email: string | null;
  /** Settings the owner still has to fill for a part of the block to show. */
  missing: string[];
};

type ContactValues = { instagramUrl?: string | null; supportEmail?: string | null };
/** `site` is what was saved in FITX Admin (platform_settings.site), null where nothing was. */
type Source = { site?: ContactValues | null; env?: Record<string, string | undefined>; brand?: ContactValues };

/** An instagram.com profile address and its handle, or null. Nothing else is accepted. */
export function instagramProfile(value: string | null | undefined): { url: string; handle: string } | null {
  const text = value?.trim();
  if (!text) return null;
  let url: URL;
  try { url = new URL(text); } catch { return null; }
  if (url.protocol !== "https:" || !/^(www\.)?instagram\.com$/i.test(url.hostname)) return null;
  const handle = url.pathname.split("/").filter(Boolean)[0] ?? "";
  if (!/^[A-Za-z0-9._]{1,30}$/.test(handle)) return null;
  return { url: `https://www.instagram.com/${handle}/`, handle };
}

/** A plain e-mail address, or null. */
export function emailAddress(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text && /^[^\s@<>"']+@[^\s@<>"']+\.[A-Za-z]{2,}$/.test(text) ? text : null;
}

/**
 * The owner's Instagram and e-mail for the end of the landing page and the public footer: what was saved in
 * Admin's website information first, then the NEXT_PUBLIC_ variables, then the brand config. Nothing is
 * invented: an unset or malformed value hides that part and is listed in `missing`.
 */
export function landingContact({ site = null, env = process.env, brand = BRAND }: Source = {}): LandingContact {
  const instagram = instagramProfile(site?.instagramUrl) ?? instagramProfile(env.NEXT_PUBLIC_FITX_INSTAGRAM_URL) ?? instagramProfile(brand.instagramUrl);
  const email = emailAddress(site?.supportEmail) ?? emailAddress(env.NEXT_PUBLIC_FITX_CONTACT_EMAIL) ?? emailAddress(brand.supportEmail);
  const missing: string[] = [];
  if (!instagram) missing.push(CONTACT_SETTINGS.instagram.join(" or "));
  if (!email) missing.push(CONTACT_SETTINGS.email.join(" or "));
  return { instagram, email, missing };
}
