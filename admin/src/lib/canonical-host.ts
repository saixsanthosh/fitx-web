// Pure host check for the proxy. No imports, so tests can load this file directly.

type CanonicalRedirectInput = {
  requestUrl: string;
  host: string | null;
  vercelEnv?: string;
  siteUrl?: string;
};

/**
 * In production, a request that arrives on any host other than ADMIN_SITE_URL is
 * sent to the same path there. Sign-in keeps its PKCE cookie on one host, so it
 * only works when it starts on the host that Google returns to.
 */
export function canonicalRedirectUrl({ requestUrl, host, vercelEnv, siteUrl }: CanonicalRedirectInput): URL | null {
  if (vercelEnv !== "production" || !siteUrl || !host) return null;

  let canonical: URL;
  try {
    canonical = new URL(siteUrl);
  } catch {
    return null;
  }
  if (canonical.protocol !== "https:" && canonical.protocol !== "http:") return null;
  if (host.trim().toLowerCase() === canonical.host.toLowerCase()) return null;

  const current = new URL(requestUrl);
  // Assign the path instead of resolving it, so "//other.example" stays a path on the canonical host.
  const target = new URL(canonical.origin);
  target.pathname = current.pathname;
  target.search = current.search;
  return target;
}
