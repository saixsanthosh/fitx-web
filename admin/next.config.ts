import type { NextConfig } from "next";
import { resolve } from "node:path";

/** Security headers for every Admin path (exported for tests/security-headers.test.mjs). */
export const ADMIN_SECURITY_HEADERS = [
  // HTTPS only, for a year, on this host and its subdomains; no preload.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Admin addresses (member ids, filters) never leave in a Referer, not even to the app.
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  // No popups or payment windows: Admin keeps its window to itself, and its files to its own pages.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), midi=(), display-capture=(), browsing-topics=()",
  },
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  { key: "Cache-Control", value: "private, no-store, max-age=0" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: { root: resolve(process.cwd(), "..") },
  // forbidden() and src/app/forbidden.tsx for pages a role may not open.
  experimental: { authInterrupts: true },
  // The Google, allowlist and authenticator sign-in is gone; its addresses lead to /login (307).
  async redirects() {
    return ["/signin", "/auth/callback", "/auth/expired", "/mfa", "/mfa/setup", "/access"].map((source) => ({
      source,
      destination: "/login",
      permanent: false,
    }));
  },
  async headers() {
    return [
      {
        source: "/:path*",
        // The nonce Content-Security-Policy is set per response in src/proxy.ts; these are the same for every path.
        headers: ADMIN_SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
