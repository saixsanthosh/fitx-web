// Content-Security-Policy for FITX Admin, built per request with a nonce. No imports.
// Next.js reads the nonce from the request's CSP header and adds it to its own scripts, so every
// page must render dynamically (the root layout forces that).

export type AdminCspOptions = {
  nonce: string;
  /** The Supabase project origin. The sign-in form's redirect goes there, then to Google. */
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

export function buildAdminCsp({ nonce, supabaseOrigin, isDev, upgradeInsecureRequests }: AdminCspOptions): string {
  const formTargets = ["'self'", supabaseOrigin, "https://accounts.google.com"].filter(Boolean).join(" ");
  const directives = [
    "default-src 'self'",
    // React needs eval in development only, for its debugging stacks.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    isDev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    // data: is for the authenticator QR code, which Supabase returns as an SVG data URL.
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    `form-action ${formTargets}`,
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
