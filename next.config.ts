import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Next 16: domains[] is deprecated — use remotePatterns.
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "images.higgs.ai" },
      { protocol: "https", hostname: "d8j0ntlcm91z4.cloudfront.net" },
      { protocol: "https", hostname: "images.openfoodfacts.org" },
      { protocol: "https", hostname: "static.openfoodfacts.org" },
      { protocol: "https", hostname: "world.openfoodfacts.org" },
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
