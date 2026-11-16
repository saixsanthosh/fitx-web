const BASE = "https://fitx.invalid";
/** Pages a sign-in must never "return" to: they would loop or show a signed-out screen to a signed-in user. */
const BLOCKED_PATHS = new Set(["/", "/signin", "/signup", "/forgot-password"]);

/**
 * The in-app path to open after signing in, or `fallback` when `value` is missing or unsafe.
 *
 * Only same-site paths pass. Control characters are rejected before parsing because the WHATWG URL
 * parser silently strips tab, CR and LF, which turns `/%09/evil.example` style input into an
 * off-site URL. Auth and API routes are never a destination. Shared by the sign-in forms, the OAuth
 * callback, the proxy and the session route, so they all agree.
 */
export function safeNext(value: string | null | undefined, fallback = "/dashboard"): string {
  if (typeof value !== "string" || !value || value.length > 2048) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;
  // Dot segments resolve "/..//evil.example" to "//evil.example": a protocol-relative URL once returned.
  if (url.pathname.startsWith("//") || url.pathname.includes("\\")) return fallback;
  if (BLOCKED_PATHS.has(url.pathname) || url.pathname.startsWith("/auth/") || url.pathname.startsWith("/api/")) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
