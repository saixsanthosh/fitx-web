import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The route badge is useful during development, but should not sit on top of
  // the full-screen brand experience. Next still reports compile/runtime errors.
  devIndicators: false,
  images: {
    // Next 16: domains[] is deprecated — use remotePatterns.
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "images.higgs.ai" },
      { protocol: "https", hostname: "d8j0ntlcm91z4.cloudfront.net" },
      { protocol: "https", hostname: "images.openfoodfacts.org" },
      { protocol: "https", hostname: "static.openfoodfacts.org" },
      { protocol: "https", hostname: "world.openfoodfacts.org" },
      { protocol: "https", hostname: "raw.githubusercontent.com", pathname: "/yuhonas/free-exercise-db/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/**" },
      // Supabase Storage (any project ref) for user uploads / exercise media
      { protocol: "https", hostname: "*.supabase.co" },
    ],
    qualities: [50, 60, 75, 90, 100],
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [{ key: "Strict-Transport-Security", value: "max-age=31536000" }],
    }];
  },
};

export default nextConfig;
