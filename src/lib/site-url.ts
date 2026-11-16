import { safeNext } from "@/lib/auth/safe-next";

const DEFAULT_SITE_URL = "https://fitnessx.vercel.app";

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * The single production origin, or null outside Vercel Production. Sign-in only works on one host:
 * the PKCE verifier cookie and the session cookies are bound to the host that set them, and Supabase
 * only redirects back to allowed URLs. The proxy sends every other production host here.
 */
export function canonicalOrigin(): string | null {
  if (process.env.VERCEL_ENV !== "production") return null;
  return originOf(process.env.NEXT_PUBLIC_SITE_URL) ?? DEFAULT_SITE_URL;
}

/** Origin for auth redirects started in the browser: the canonical one in production, else this page's. */
export function browserAuthOrigin(): string {
  if (process.env.NEXT_PUBLIC_VERCEL_ENV === "production") {
    return originOf(process.env.NEXT_PUBLIC_SITE_URL) ?? DEFAULT_SITE_URL;
  }
  return window.location.origin;
}

/** Where Supabase should send the browser after Google sign-in, an e-mail link or a password reset. */
export function authCallbackUrl(next: string | null | undefined, origin: string = browserAuthOrigin()): string {
  const target = next === "/reset-password" ? next : safeNext(next);
  return `${origin}/auth/callback?next=${encodeURIComponent(target)}`;
}
