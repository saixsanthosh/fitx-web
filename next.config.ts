import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

/**
 * Security headers and the Content-Security-Policy, built here (not in the proxy) so that pages stay static: no
 * per-request nonce. Everything below is decided at build time from the environment, and the builders are exported
 * for tests/unit/security-headers.test.ts.
 */

/** The project's Supabase origin and its realtime websocket origin, from NEXT_PUBLIC_SUPABASE_URL. */
export function supabaseOrigins(value: string | undefined | null): { http: string; ws: string } {
  try {
    const url = new URL(value ?? "");
    if (url.protocol === "https:" || url.protocol === "http:") {
      // http (the local stand-in) talks ws://, https talks wss://: the same rule the real host follows.
      return { http: url.origin, ws: `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}` };
    }
  } catch {
    // Not set or not a URL: fall back to Supabase-hosted projects.
  }
  return { http: "https://*.supabase.co", ws: "wss://*.supabase.co" };
}

/** The project's own Supabase Storage host (signed user media); any project only as a local fallback. */
function supabaseStorageHost() {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname || "*.supabase.co";
  } catch {
    return "*.supabase.co";
  }
}

/**
 * Outside origins the browser may use, each proven by the code (see the security report's inventory):
 *  - Razorpay Checkout: its loader script (subscription page), the payment iframe, the calls the loader makes and its
 *    images. The loader is Razorpay's documented checkout.js; its own iframe has its own policy.
 *  - OpenFreeMap: the activity map's style, tiles, glyphs and sprites (fetched by maplibre).
 *  - Photos shown without the image optimiser: the pinned Free Exercise DB revision on GitHub and Open Food Facts
 *    product photos (the same hosts the server-side checks accept).
 *  - Google profile photos: Google sign-in stores its avatar_url (lh3.googleusercontent.com) as profiles.avatar,
 *    and the account menu and Profile show it as it is (unoptimised). Google serves them from lh3 to lh6.
 */
const RAZORPAY = {
  script: ["https://checkout.razorpay.com"],
  frame: ["https://api.razorpay.com", "https://checkout.razorpay.com"],
  connect: ["https://api.razorpay.com", "https://lumberjack.razorpay.com"],
  img: ["https://cdn.razorpay.com"],
};
const MAP_TILES = ["https://tiles.openfreemap.org"];
const PHOTO_HOSTS = [
  "https://raw.githubusercontent.com",
  "https://images.openfoodfacts.org",
  "https://static.openfoodfacts.org",
  "https://world.openfoodfacts.org",
];
const GOOGLE_AVATAR_HOSTS = ["https://lh3.googleusercontent.com", "https://lh4.googleusercontent.com", "https://lh5.googleusercontent.com", "https://lh6.googleusercontent.com"];
/**
 * Google Identity Services (the "Sign in with Google" button that shows FITX instead of the Supabase address), exactly
 * the entries Google documents for it: its client script, and its button iframe, credential calls and button styles
 * under /gsi/. Only when NEXT_PUBLIC_GOOGLE_CLIENT_ID is set; otherwise sign-in uses the redirect flow and loads nothing
 * from Google here.
 */
const GOOGLE_GSI = { script: "https://accounts.google.com/gsi/client", base: "https://accounts.google.com/gsi/" };
/** Vercel's toolbar and comments, injected on preview deployments only. */
const VERCEL_LIVE = "https://vercel.live";

export type CspOptions = {
  supabaseUrl: string | undefined | null;
  /** `next dev`: React needs eval for its debugging stacks. */
  isDev?: boolean;
  /** A Vercel preview deployment (VERCEL_ENV=preview), which carries the Vercel toolbar. */
  isPreview?: boolean;
  /** NEXT_PUBLIC_GOOGLE_CLIENT_ID: when set, the Google Identity Services entries are added. */
  googleClientId?: string | null;
};

/** A plausible OAuth web client id (…apps.googleusercontent.com); anything else counts as unset. */
export function googleClientIdFrom(value: string | undefined | null): string | null {
  const text = value?.trim() ?? "";
  return /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(text) ? text : null;
}

export function buildContentSecurityPolicy({ supabaseUrl, isDev = false, isPreview = false, googleClientId = null }: CspOptions): string {
  const supabase = supabaseOrigins(supabaseUrl);
  const preview = isPreview ? [VERCEL_LIVE] : [];
  const gsi = googleClientIdFrom(googleClientId) ? { script: [GOOGLE_GSI.script], base: [GOOGLE_GSI.base] } : { script: [], base: [] };
  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    // Next's inline bootstrap and page data scripts differ on every page and static pages carry no nonce, so inline
    // scripts are allowed; outside scripts are limited to Razorpay's loader. The pose model is WebAssembly.
    // Known trade-off: an injected inline script would run (no sink exists today: the only raw HTML is the constant
    // intro bootstrap and escaped JSON-LD). Closing it needs a per-request nonce with 'strict-dynamic' set in the
    // proxy for the signed-in pages, which makes them dynamic, as Admin does (admin/src/lib/csp.ts).
    ["script-src", ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", ...(isDev ? ["'unsafe-eval'"] : []), ...RAZORPAY.script, ...gsi.script, ...preview]],
    // Server-rendered style attributes (React style props, motion start values).
    ["style-src", ["'self'", "'unsafe-inline'", ...gsi.base]],
    ["img-src", ["'self'", "data:", "blob:", supabase.http, ...PHOTO_HOSTS, ...GOOGLE_AVATAR_HOSTS, ...RAZORPAY.img, ...preview]],
    ["font-src", ["'self'", ...preview]],
    ["connect-src", ["'self'", supabase.http, supabase.ws, ...MAP_TILES, ...RAZORPAY.connect, ...gsi.base, ...preview]],
    ["media-src", ["'self'", "blob:", supabase.http]],
    ["worker-src", ["'self'", "blob:"]],
    ["frame-src", [...RAZORPAY.frame, ...gsi.base, ...preview]],
    ["manifest-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  return directives.map(([name, sources]) => `${name} ${sources.join(" ")}`).join("; ");
}

/**
 * Whether the policy blocks (Content-Security-Policy) or only reports (Content-Security-Policy-Report-Only).
 * Enforced once the full e2e run saw no violation. FITX_CSP_REPORT_ONLY=1 at build time switches back to reporting
 * without a code change (headers are fixed at build, so it needs a redeploy).
 */
export const CSP_ENFORCED = true;

export type HeaderOptions = CspOptions & { reportOnly?: boolean };

export function securityHeaders(options: HeaderOptions): Array<{ key: string; value: string }> {
  const reportOnly = options.reportOnly ?? !CSP_ENFORCED;
  return [
    // HTTPS for a year on this host and its subdomains (fitnessx.vercel.app has none of its own); no preload.
    { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    // Razorpay may open a bank or card window from its checkout; that window must still reach its opener.
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
    { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
    // Camera for the barcode scanner and AI Form Check, location for activity tracking, the screen kept awake during
    // workouts and recordings, payment only for Razorpay's iframe, the microphone for the AI Coach's push-to-talk voice,
    // and the motion sensors (accelerometer, gyroscope) for the sign-in page's scene, which reads them on the device
    // only (iOS asks on a tap). Every other device feature stays off.
    {
      key: "Permissions-Policy",
      value: [
        "camera=(self)", "geolocation=(self)", "screen-wake-lock=(self)", "fullscreen=(self)",
        'payment=(self "https://api.razorpay.com")',
        "microphone=(self)", "accelerometer=(self)", "gyroscope=(self)",
        "usb=()", "serial=()", "hid=()", "bluetooth=()", "midi=()", "display-capture=()",
        "magnetometer=()", "browsing-topics=()",
      ].join(", "),
    },
    { key: reportOnly ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy", value: buildContentSecurityPolicy(options) },
  ];
}

const SECURITY_HEADERS = securityHeaders({
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  isDev: process.env.NODE_ENV === "development",
  isPreview: process.env.VERCEL_ENV === "preview",
  googleClientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
  reportOnly: process.env.FITX_CSP_REPORT_ONLY === "1" ? true : undefined,
});

/** Where AI Form Check lives (brief 3.5 and 3.7). */
export const FORM_CHECK_PATH = "/workouts/form-check";

/**
 * The retired camera addresses, 308s that keep the query (?exercise=). Old Form coach links and Home workout both end
 * on AI Form Check once its page is part of the build; a build without that page (a branch cut before it) keeps the
 * previous target, so no link ever ends on a missing page.
 */
export function cameraRedirects(hasFormCheckPage: boolean) {
  const target = hasFormCheckPage ? FORM_CHECK_PATH : "/home-workout";
  return [
    ...(hasFormCheckPage ? [{ source: "/home-workout", destination: target, permanent: true }] : []),
    { source: "/form-coach", destination: target, permanent: true },
    { source: "/form-coach/:path*", destination: target, permanent: true },
  ];
}

const HAS_FORM_CHECK_PAGE = existsSync(path.join(process.cwd(), "src/app/(dashboard)/workouts/form-check/page.tsx"));

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
    formats: ["image/avif", "image/webp"],
  },
  async redirects() {
    return cameraRedirects(HAS_FORM_CHECK_PAGE);
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
