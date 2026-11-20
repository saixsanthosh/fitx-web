// Content-Security-Policy for FITX Admin, built per request with a nonce. No imports.
// Next.js reads the nonce from the request's CSP header and adds it to its own scripts, so every
// page must render dynamically (the root layout forces that).

export type AdminCspOptions = {
  nonce: string;
  /** The Supabase project origin: images and videos from Storage, and signed Storage uploads. */
  supabaseOrigin: string | null;
  isDev: boolean;
  upgradeInsecureRequests: boolean;
};

export function originOf(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Catalogue photos not yet mirrored to FITX Storage are still served from the free-exercise-db repository on
 * GitHub, the same pinned source the app's next.config.ts allows; Workouts previews them. Images only.
 */
export const EXERCISE_CATALOGUE_IMAGES = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/";

/** A catalogue original that img-src allows, or null (anything else stays unshown). */
export function catalogueImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith(EXERCISE_CATALOGUE_IMAGES)) return null;
  const rest = value.slice(EXERCISE_CATALOGUE_IMAGES.length);
  return /^[A-Za-z0-9._~/-]+\.(?:jpe?g|png|webp|gif)$/i.test(rest) && !rest.includes("..") ? value : null;
}

export function buildAdminCsp({ nonce, supabaseOrigin, isDev, upgradeInsecureRequests }: AdminCspOptions): string {
  const supabase = supabaseOrigin ? ` ${supabaseOrigin}` : "";
  const directives = [
    "default-src 'self'",
    // React needs eval in development only, for its debugging stacks.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    isDev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    `img-src 'self' data: blob:${supabase} ${EXERCISE_CATALOGUE_IMAGES}`,
    `media-src 'self' blob:${supabase}`,
    "font-src 'self'",
    // Supabase only for signed Storage uploads from the browser; all data reads stay on the server.
    `connect-src 'self'${supabase}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "worker-src 'self'",
    "manifest-src 'self'",
  ];
  if (upgradeInsecureRequests) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

/** A fresh, unguessable nonce for one response. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
