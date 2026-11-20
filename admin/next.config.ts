import type { NextConfig } from "next";
import { resolve } from "node:path";

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
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
        ],
      },
    ];
  },
};

export default nextConfig;
