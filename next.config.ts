import type { NextConfig } from "next";

/** The project's own Supabase Storage host (signed user media); any project only as a local fallback. */
function supabaseStorageHost() {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname || "*.supabase.co";
  } catch {
    return "*.supabase.co";
  }
}

const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  // Camera for the barcode scanner (and later form coaching), location for activity tracking; nothing else.
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=(), payment=(), usb=(), serial=(), hid=(), bluetooth=()" },
  // No script directives yet: Next's per-page inline scripts need nonces, which would make every page
  // dynamic. These still stop framing, base-tag injection, plugins and off-site form posts.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
];

const nextConfig: NextConfig = {
  // The route badge is useful during development, but should not sit on top of
  // the full-screen brand experience. Next still reports compile/runtime errors.
  devIndicators: false,
  poweredByHeader: false,
  images: {
    // Next 16: domains[] is deprecated — use remotePatterns.
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "d8j0ntlcm91z4.cloudfront.net" },
      { protocol: "https", hostname: "images.openfoodfacts.org" },
      { protocol: "https", hostname: "static.openfoodfacts.org" },
      { protocol: "https", hostname: "world.openfoodfacts.org" },
      { protocol: "https", hostname: "raw.githubusercontent.com", pathname: "/yuhonas/free-exercise-db/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/**" },
      // Supabase Storage for user uploads and exercise media.
      { protocol: "https", hostname: supabaseStorageHost(), pathname: "/storage/v1/object/**" },
    ],
    qualities: [50, 60, 75, 90, 100],
  },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // The form coach's self-hosted pose runtime and models (public/models/pose): versioned folder names,
      // so a new version is a new URL and the 11 MB runtime is downloaded once.
      { source: "/models/pose/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
};

export default nextConfig;
